/**
 * logbook-ai: Claude reads a photo of a page of the written logbook kept at a post, so the guards' time
 * in and out there can be checked against the app, and the duties the app missed can be added.
 *
 * POST multipart/form-data: site_id, file   with the sender's own token (HR, operations, or the client
 *   whose post it is; the database decides)
 *   1. the photo must really be a JPEG, PNG or WebP (read from its first bytes), up to 5 MB
 *   2. begin_logbook_page with their token: may they send it for this post, and under which key
 *      (company/logbooks/<post>/<yyyy>/<mm>/...)
 *   3. puts it in S3, then finish_file_upload with the service role
 *   4. Claude reads the lines; save_logbook_reading (service role) keeps them, each matched to the post's
 *      guards and compared with the app's time in and out (schema.sql, section 21)
 *   Answers { status: 'read', page }. When Claude cannot read it the photo is still kept:
 *   { status: 'failed', page_id, message }, and the page can be read again.
 * POST { action: 'read', page_id }   reads a stored page again (its photo from S3).
 * Errors are { code, message }. Nothing personal is logged.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { bearer, CORS_HEADERS, json } from '../_shared/http.ts';
import { type S3, S3Error } from '../_shared/s3.ts';
import { sniffType } from '../_shared/sniff.ts';
import { IMAGE_TYPES, type ImageType, logbookRequest, MAX_IMAGE_BYTES } from './prompts.ts';

type RpcError = { message: string; code?: string } | null;
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
}
export interface ClaudeMessages {
  message(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>;
}
export interface LogbookAiDeps {
  userClient: (jwt: string) => Rpc;
  admin: Rpc;
  s3: S3 | null;
  claude: ClaudeMessages | null;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

export const MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  storage_off: 'File storage is not set up yet. Ask the administrator to finish the Amazon S3 set-up.',
  not_configured: 'The photo is saved, but Claude is not set up yet to read it. HR can read the page once it is.',
  claude_failed: 'The photo is saved, but Claude could not read it right now. Try reading it again in a minute.',
  declined: 'The photo is saved, but Claude could not read this page. HR will check it by hand.',
  heic: 'Claude cannot read this photo format (HEIC). Take the photo again as JPEG (on an iPhone: Settings, Camera, Formats, Most Compatible).',
  bad_type: 'Send a photo of the page: JPEG, PNG or WebP.',
  too_large: 'The photo is too large: up to 5 MB. Take it again at a lower resolution.',
  storage_failed: 'The photo could not be saved. Try again in a minute.',
  invalid_input: 'Something is missing from the request. Try again.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;
type Code = keyof typeof MESSAGES;
const fail = (status: number, code: Code) => json(status, { code, message: MESSAGES[code] });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

/** A database refusal keeps its own message (written for people); anything unexpected does not. */
function dbFail(error: NonNullable<RpcError>, log?: LogbookAiDeps['log']): Response {
  const code = error.code ?? '';
  if (code.startsWith('PGRST30') || /\bjwt\b/i.test(error.message)) return fail(401, 'signed_out');
  if (code === '42501') return json(403, { code: 'refused', message: error.message });
  if (code === '22023' || code === 'P0001') return json(400, { code: 'rejected', message: error.message });
  if (code === 'P0002') return json(404, { code: 'not_found', message: error.message });
  log?.('db_error', { sqlstate: code.slice(0, 12) });
  return fail(500, 'server');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What Claude answered, as the JSON it was asked for; null when it is not that. */
export function parseReading(msg: Anthropic.Beta.Messages.BetaMessage): Record<string, unknown> | null {
  try {
    const a = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(''));
    return a && typeof a === 'object' && !Array.isArray(a) && Array.isArray(a.lines) ? a : null;
  } catch {
    return null;
  }
}

export function createLogbookAiHandler(deps: LogbookAiDeps) {
  const log = deps.log;

  /** Claude reads the photo; what it read (or that it could not) is saved with the page. */
  async function read(pageId: string, bytes: Uint8Array, type: ImageType, post: string, today: string): Promise<Response> {
    let failed: Code | null = null;
    let reading: Record<string, unknown> | null = null;
    if (!deps.claude) {
      failed = 'not_configured';
    } else {
      try {
        const msg = await deps.claude.message(logbookRequest(toBase64(bytes), type, post, today));
        if (msg.stop_reason === 'refusal') failed = 'declined';
        else {
          reading = parseReading(msg);
          if (reading) reading.model = msg.model;
          else failed = 'claude_failed';
        }
      } catch (e) {
        log?.('claude_failed', { status: (e as { status?: number }).status ?? 0 });
        failed = 'claude_failed';
      }
    }
    const saved = await deps.admin.rpc('save_logbook_reading', { p_page_id: pageId, p_reading: failed ? null : reading });
    if (saved.error) return dbFail(saved.error, log);
    if (failed) {
      log?.('not_read', { reason: failed });
      return json(200, { status: 'failed', page_id: pageId, code: failed, message: MESSAGES[failed] });
    }
    const page = saved.data as { lines?: unknown[] } | null;
    log?.('read', { lines: page?.lines?.length ?? 0 });
    return json(200, { status: 'read', page });
  }

  async function upload(req: Request, jwt: string): Promise<Response> {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return fail(413, 'too_large');
    if (!deps.s3) return fail(503, 'storage_off');
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, 'invalid_input');
    }
    const file = form.get('file');
    const site = form.get('site_id');
    if (!(file instanceof Blob) || typeof site !== 'string' || !UUID.test(site.trim())) return fail(400, 'invalid_input');
    if (file.size > MAX_IMAGE_BYTES) return fail(413, 'too_large');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) return fail(400, 'invalid_input');
    const sniffed = sniffType(bytes);
    if (sniffed === 'image/heic') return fail(415, 'heic');
    if (!sniffed || !IMAGE_TYPES.includes(sniffed as ImageType)) return fail(415, 'bad_type');
    const type = sniffed as ImageType;

    const begun = await deps.userClient(jwt).rpc('begin_logbook_page', { p_site_id: site.trim(), p_content_type: type, p_size_bytes: bytes.length });
    if (begun.error) return dbFail(begun.error, log);
    const b = begun.data as { page_id: string; file_id: string; key: string; post?: string; today?: string };
    try {
      await deps.s3.put(b.key, bytes, type);
    } catch (e) {
      log?.('s3_put_failed', { status: e instanceof S3Error ? e.status : 0, aws_code: e instanceof S3Error ? e.awsCode : 'network' });
      return fail(502, 'storage_failed');
    }
    const done = await deps.admin.rpc('finish_file_upload', { p_file_id: b.file_id, p_size_bytes: bytes.length });
    if (done.error) return dbFail(done.error, log);
    return await read(b.page_id, bytes, type, b.post ?? '', b.today ?? '');
  }

  async function readAgain(pageId: string, jwt: string): Promise<Response> {
    if (!deps.s3) return fail(503, 'storage_off');
    const c = await deps.userClient(jwt).rpc('logbook_page_context', { p_page_id: pageId });
    if (c.error) return dbFail(c.error, log);
    const ctx = c.data as { key: string; content_type: string; post?: string; today?: string };
    if (!IMAGE_TYPES.includes(ctx.content_type as ImageType)) return fail(415, 'bad_type');
    let bytes: Uint8Array;
    try {
      bytes = await deps.s3.get(ctx.key);
    } catch (e) {
      log?.('s3_get_failed', { status: e instanceof S3Error ? e.status : 0 });
      return fail(502, 'storage_failed');
    }
    return await read(pageId, bytes, ctx.content_type as ImageType, ctx.post ?? '', ctx.today ?? '');
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method');
    const jwt = bearer(req);
    if (!jwt) return fail(401, 'signed_out');
    try {
      if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) return await upload(req, jwt);
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (body?.action === 'read' && typeof body.page_id === 'string' && UUID.test(body.page_id)) return await readAgain(body.page_id, jwt);
      return fail(400, 'invalid_input');
    } catch (e) {
      log?.('error', { name: e instanceof Error ? e.name : 'unknown' });
      return fail(500, 'server');
    }
  };
}
