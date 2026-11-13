/**
 * files: keeps employee files in Amazon S3 and hands out five-minute links to open them. The AWS keys
 * live only in this function's secrets; the database decides who may store or open what.
 *
 * POST multipart/form-data: purpose, file, and as needed employee_id, document_type_id, kind, certificate_id
 *   1. the person must be signed in (their own token), and the file must really be a PDF or a photo
 *      (read from its first bytes, sniff.ts), up to 10 MB
 *   2. begin_file_upload with their token: may they store it, and under which key
 *      (employees/<employee number>/<201-file | work-requirements | lesp | attendance | leave | certificates>/...)
 *   3. puts it in S3, encrypted, then finish_file_upload with the service role
 *   Answers { id, key, name, content_type, size_bytes }.
 * POST { action: 'sign', keys: [...], download?: true }
 *   authorize_file_reads with their token, then a five-minute link for each key they may open (employees/...,
 *   or company/code-of-discipline/... for the code in force); the
 *   rest are left out. Answers { urls: { <key>: <link> }, expires_in: 300 }.
 * POST { action: 'check' } (super admins)
 *   stores, reads back and deletes healthcheck/<time>.txt, and makes sure the bucket refuses a plain
 *   unsigned read. Answers { ok: true, bucket, region } or { ok: false, step, aws_code, message }.
 *
 * Errors are { code, message } with 400, 401, 403, 404, 405, 413, 415, 500, 502 or 503. Nothing personal
 * is logged: no names, employee numbers or keys.
 */
import { bearer, CORS_HEADERS, json } from '../_shared/http.ts';
import { type S3, S3Error } from '../_shared/s3.ts';
import { sniffType } from '../_shared/sniff.ts';

type RpcError = { message: string; code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };

/** The part of a Supabase client this function uses (structural, so tests can pass a fake). */
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

export interface FilesDeps {
  /** A client that calls the API as the person whose token this is, so the database's checks apply. */
  userClient: (jwt: string) => Rpc;
  /** The service role, for finish_file_upload. */
  admin: Rpc;
  /** null until the AWS secrets are set. */
  s3: S3 | null;
  bucket?: string;
  region?: string;
  /** Plain fetch, for the check's unsigned read. */
  fetch?: typeof fetch;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

export const LINK_SECONDS = 300;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_TEXT = 'Bannuar file storage check';

export const MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  not_configured: 'File storage is not set up yet. Ask the administrator to finish the Amazon S3 set-up.',
  too_large: 'The file is too large: up to 10 MB.',
  bad_type: 'Upload a PDF or a photo (JPEG, PNG, WebP or HEIC).',
  invalid_input: 'Something is missing from the request. Try again.',
  storage_failed: 'The file could not be saved. Try again in a minute.',
  only_super_admin: 'Only a super admin can check the file storage.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;
export type FilesCode = keyof typeof MESSAGES;

/** What to tell the super admin when the check fails, by AWS error code. */
export const HINTS: Record<string, string> = {
  settings:
    'Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION and S3_BUCKET in the Edge Function secrets (supabase/SETUP.md, step 9).',
  public: 'The bucket lets anyone read its files. Turn Block Public Access back on for the bucket.',
  mismatch: 'S3 returned a different file. Check that S3_BUCKET names the right bucket.',
  AccessDenied: 'AWS refused: the access key’s IAM policy does not allow this. Compare it with the policy in supabase/SETUP.md.',
  NoSuchBucket: 'There is no bucket with that name. Check S3_BUCKET.',
  InvalidAccessKeyId: 'AWS does not know this access key. Check AWS_ACCESS_KEY_ID.',
  SignatureDoesNotMatch: 'The secret access key does not match the access key. Check AWS_SECRET_ACCESS_KEY.',
  AuthorizationHeaderMalformed: 'The region is wrong. Set AWS_REGION to the bucket’s region.',
  PermanentRedirect: 'The region is wrong. Set AWS_REGION to the bucket’s region.',
  network: 'Could not reach Amazon S3. Check AWS_REGION, then try again.',
};
const hint = (code: string) => HINTS[code] ?? `Amazon S3 answered ${code}.`;

const fail = (status: number, code: FilesCode) => json(status, { code, message: MESSAGES[code] });
const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '');

/** A database refusal keeps its own message (written for people); anything unexpected does not. */
function dbFail(error: NonNullable<RpcError>, log?: FilesDeps['log']): Response {
  const code = error.code ?? '';
  if (code.startsWith('PGRST30') || /\bjwt\b/i.test(error.message)) return fail(401, 'signed_out');
  if (code === '42501') return json(403, { code: 'refused', message: error.message });
  if (code === '22023' || code === 'P0001') return json(400, { code: 'rejected', message: error.message });
  if (code === 'P0002') return json(404, { code: 'not_found', message: error.message });
  log?.('db_error', { sqlstate: code.slice(0, 12) });
  return fail(500, 'server');
}

export function createFilesHandler(deps: FilesDeps) {
  const log = deps.log;
  const now = deps.now ?? (() => new Date());

  async function signedIn(jwt: string): Promise<{ roles: string[] } | Response> {
    const r = await deps.userClient(jwt).rpc('my_access');
    if (r.error) return dbFail(r.error, log);
    const access = r.data as { user_id?: string | null; roles?: string[] } | null;
    if (!access?.user_id) return fail(401, 'signed_out');
    return { roles: access.roles ?? [] };
  }

  async function upload(req: Request, jwt: string): Promise<Response> {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail(413, 'too_large');
    if (!deps.s3) return fail(503, 'not_configured');
    const who = await signedIn(jwt); // before reading a body of up to 10 MB
    if (who instanceof Response) return who;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, 'invalid_input');
    }
    const file = form.get('file');
    const purpose = text(form.get('purpose'));
    if (!(file instanceof Blob) || !purpose) return fail(400, 'invalid_input');
    if (file.size > MAX_FILE_BYTES) return fail(413, 'too_large');
    const ids: Record<string, string | null> = {};
    for (const name of ['employee_id', 'document_type_id', 'certificate_id']) {
      const v = text(form.get(name));
      if (v && !UUID.test(v)) return fail(400, 'invalid_input');
      ids[name] = v || null;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return fail(400, 'invalid_input');
    const type = sniffType(bytes);
    if (!type) return fail(415, 'bad_type');

    const begun = await deps.userClient(jwt).rpc('begin_file_upload', {
      p_purpose: purpose,
      p_content_type: type,
      p_size_bytes: bytes.length,
      p_employee_id: ids.employee_id,
      p_document_type_id: ids.document_type_id,
      p_kind: text(form.get('kind')) || null,
      p_certificate_id: ids.certificate_id,
    });
    if (begun.error) return dbFail(begun.error, log);
    const { id, key } = begun.data as { id: string; key: string };

    try {
      await deps.s3.put(key, bytes, type);
    } catch (e) {
      log?.('s3_put_failed', { status: e instanceof S3Error ? e.status : 0, aws_code: e instanceof S3Error ? e.awsCode : 'network' });
      return fail(502, 'storage_failed');
    }
    const done = await deps.admin.rpc('finish_file_upload', { p_file_id: id, p_size_bytes: bytes.length });
    if (done.error) return dbFail(done.error, log);
    log?.('stored', { purpose, bytes: bytes.length });
    return json(200, { id, key, name: key.slice(key.lastIndexOf('/') + 1), content_type: type, size_bytes: bytes.length });
  }

  async function sign(body: Record<string, unknown>, jwt: string): Promise<Response> {
    const raw = Array.isArray(body.keys) ? body.keys : null;
    if (!raw || raw.length === 0 || raw.length > 200) return fail(400, 'invalid_input');
    if (!deps.s3) return fail(503, 'not_configured');
    const keys = [...new Set(raw.filter((k): k is string => typeof k === 'string' && /^(employees|company)\//.test(k) && k.length <= 300))];
    if (keys.length === 0) return json(200, { urls: {}, expires_in: LINK_SECONDS });
    const r = await deps.userClient(jwt).rpc('authorize_file_reads', { p_keys: keys });
    if (r.error) return dbFail(r.error, log);
    const how = body.download === true ? 'attachment' : 'inline';
    const urls: Record<string, string> = {};
    for (const row of (r.data ?? []) as { object_key: string; file_name: string }[]) {
      const name = row.file_name.replace(/["\\\r\n]/g, '');
      urls[row.object_key] = await deps.s3.presignGet(row.object_key, { expiresIn: LINK_SECONDS, disposition: `${how}; filename="${name}"` });
    }
    return json(200, { urls, expires_in: LINK_SECONDS });
  }

  async function check(jwt: string): Promise<Response> {
    const who = await signedIn(jwt);
    if (who instanceof Response) return who;
    if (!who.roles.includes('super_admin')) return fail(403, 'only_super_admin');
    const where = { bucket: deps.bucket ?? null, region: deps.region ?? null };
    if (!deps.s3) return json(200, { ok: false, step: 'settings', ...where, message: HINTS.settings });

    const key = `healthcheck/${now().toISOString().replace(/[:.]/g, '-')}.txt`;
    let step = 'put';
    try {
      await deps.s3.put(key, new TextEncoder().encode(CHECK_TEXT), 'text/plain');
      step = 'get';
      const back = new TextDecoder().decode(await deps.s3.get(key));
      step = 'private';
      const plain = await (deps.fetch ?? fetch)(deps.s3.publicUrl(key));
      await plain.body?.cancel();
      step = 'delete';
      await deps.s3.remove(key);
      if (back !== CHECK_TEXT) return json(200, { ok: false, step: 'get', ...where, message: HINTS.mismatch });
      if (plain.ok) return json(200, { ok: false, step: 'private', ...where, message: HINTS.public });
    } catch (e) {
      const awsCode = e instanceof S3Error ? e.awsCode : 'network';
      log?.('check_failed', { step, aws_code: awsCode });
      return json(200, { ok: false, step, aws_code: awsCode, ...where, message: hint(awsCode) });
    }
    log?.('check_ok');
    return json(200, { ok: true, ...where });
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method');
    const jwt = bearer(req);
    if (!jwt) return fail(401, 'signed_out');
    try {
      if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return await upload(req, jwt);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (body?.action === 'sign') return await sign(body, jwt);
      if (body?.action === 'check') return await check(jwt);
      return fail(400, 'invalid_input');
    } catch (e) {
      log?.('error', { name: e instanceof Error ? e.name : 'unknown' });
      return fail(500, 'server');
    }
  };
}
