/**
 * document-ai: Claude reads a document as soon as it is uploaded (document types with ai_check: the
 * LESP to start with) and the function checks what it read:
 *   - is it the expected kind of document, and is it legible
 *   - the holder's name against the 201 file (compared here; the 201 name is not sent to Anthropic)
 *   - the expiry date against today in Manila (expired, expiring within 60 days, valid)
 * The check is kept with the file for HR's review and returned to the app to fill in the form. HR still
 * verifies the document: Claude cannot tell whether it is genuine (only the PNP SOSIA can).
 *
 * POST { action: 'check', key }   with the person's own token (their own upload, or any for HR)
 * Answers { status: 'checked', ...check } or { status: 'unsupported', message }; errors are { code, message }.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { bearer, CORS_HEADERS, json } from '../_shared/http.ts';
import type { S3 } from '../_shared/s3.ts';
import { documentRequest, IMAGE_TYPES, MAX_IMAGE_BYTES } from './prompts.ts';

type RpcError = { message: string; code?: string } | null;
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError }>;
}
export interface ClaudeMessages {
  message(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>;
}
export interface DocumentAiDeps {
  userClient: (jwt: string) => Rpc;
  admin: Rpc;
  s3: S3 | null;
  claude: ClaudeMessages | null;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

interface Context {
  key: string;
  content_type: string;
  size_bytes: number;
  type_code: string;
  type_name: string;
  has_expiry: boolean;
  first_name: string;
  last_name: string;
}

export const MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  not_configured: 'Claude is not set up yet. Send the document to HR as it is.',
  invalid_input: 'Something is missing from the request. Try again.',
  claude_failed: 'Claude could not read it right now. Send it to HR as it is, or try again.',
  declined: 'Claude could not read this document. Send it to HR as it is.',
  heic: 'Claude cannot read this photo format (HEIC). Send it to HR as it is, or take the photo again.',
  too_big: 'The photo is too large for Claude to read. Send it to HR as it is.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;
type Code = keyof typeof MESSAGES;
const fail = (status: number, code: Code) => json(status, { code, message: MESSAGES[code] });

function dbFail(error: NonNullable<RpcError>, log?: DocumentAiDeps['log']): Response {
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

const words = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);

/**
 * The name on the document against the 201 file: every word of the surname and at least one word of the
 * first name is a match; only one of the two is partial; neither is a mismatch.
 */
export function nameMatch(holder: string, first: string, last: string): 'match' | 'partial' | 'mismatch' | 'unknown' {
  const on = new Set(words(holder));
  if (on.size === 0) return 'unknown';
  const lastOk = words(last).length > 0 && words(last).every((w) => on.has(w));
  const firstOk = words(first).some((w) => on.has(w));
  return lastOk && firstOk ? 'match' : lastOk || firstOk ? 'partial' : 'mismatch';
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isoDate = (v: unknown) => (typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : '');

/** Today in Manila as YYYY-MM-DD. */
export const manilaToday = (now: Date) => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export function expiryStatus(expires: string, hasExpiry: boolean, now: Date): 'expired' | 'expiring' | 'valid' | 'unknown' | 'none' {
  if (!hasExpiry) return 'none';
  if (!expires) return 'unknown';
  const today = manilaToday(now);
  if (expires < today) return 'expired';
  const in60 = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10);
  return expires <= in60 ? 'expiring' : 'valid';
}

export function createDocumentAiHandler(deps: DocumentAiDeps) {
  const log = deps.log;
  const now = deps.now ?? (() => new Date());

  async function check(key: string, jwt: string): Promise<Response> {
    if (!deps.claude || !deps.s3) return fail(503, 'not_configured');
    const c = await deps.userClient(jwt).rpc('document_ai_context', { p_file_key: key });
    if (c.error) return dbFail(c.error, log);
    const ctx = c.data as Context;
    if (ctx.content_type === 'image/heic') return json(200, { status: 'unsupported', message: MESSAGES.heic });
    if (IMAGE_TYPES.includes(ctx.content_type as (typeof IMAGE_TYPES)[number]) && ctx.size_bytes > MAX_IMAGE_BYTES) {
      return json(200, { status: 'unsupported', message: MESSAGES.too_big });
    }

    let msg: Anthropic.Beta.Messages.BetaMessage;
    try {
      const bytes = await deps.s3.get(key);
      msg = await deps.claude.message(documentRequest(toBase64(bytes), ctx.content_type, ctx.type_name));
    } catch (e) {
      log?.('claude_failed', { status: (e as { status?: number }).status ?? 0 });
      return fail(502, 'claude_failed');
    }
    if (msg.stop_reason === 'refusal') return json(422, { code: 'declined', message: MESSAGES.declined });
    let a: Record<string, unknown> | null = null;
    try {
      a = JSON.parse(msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join(''));
    } catch {
      a = null;
    }
    if (!a || typeof a !== 'object') return fail(502, 'claude_failed');

    const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const holder = text(a.holder_name);
    const expires = isoDate(a.expires_on);
    const result = {
      status: 'checked' as const,
      type_ok: a.matches_type === true,
      legibility: ['clear', 'partly_readable', 'unreadable'].includes(a.legibility as string) ? (a.legibility as string) : 'unreadable',
      holder_name: holder,
      name_match: nameMatch(holder, ctx.first_name, ctx.last_name),
      document_no: text(a.document_no, 80),
      issued_on: isoDate(a.issued_on),
      expires_on: expires,
      expiry: expiryStatus(expires, ctx.has_expiry, now()),
      issuer: text(a.issuer),
      concerns: Array.isArray(a.concerns) ? a.concerns.filter((x): x is string => typeof x === 'string').slice(0, 6).map((x) => x.slice(0, 300)) : [],
      model: msg.model,
      checked_at: now().toISOString(),
    };
    const saved = await deps.admin.rpc('save_document_check', { p_file_key: key, p_check: result });
    if (saved.error) return dbFail(saved.error, log);
    log?.('checked', { expiry: result.expiry, name: result.name_match, legibility: result.legibility, type_ok: result.type_ok });
    return json(200, result);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method');
    const jwt = bearer(req);
    if (!jwt) return fail(401, 'signed_out');
    try {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const key = typeof body?.key === 'string' && /^employees\/[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(body.key) && body.key.length <= 300 ? body.key : null;
      if (body?.action === 'check' && key) return await check(key, jwt);
      return fail(400, 'invalid_input');
    } catch (e) {
      log?.('error', { name: e instanceof Error ? e.name : 'unknown' });
      return fail(500, 'server');
    }
  };
}
