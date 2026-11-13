/**
 * discipline-ai: Claude reads the Code of Discipline and suggests how a case fits it. The Anthropic API
 * key lives only in this function's secrets (ANTHROPIC_API_KEY); the portal never sees it. HR only: the
 * database checks every request with the person's own token.
 *
 * POST { action: 'read_code', code_id }
 *   start_code_reading (HR, a draft code), the PDF from S3, then a Message Batch to Claude: a long code
 *   can take longer than a function may run, and a batch has no such limit (and costs half). Answers
 *   { status: 'reading' }.
 * POST { action: 'check_code', code_id }
 *   Asks Anthropic whether the batch is done; when it is, finish_code_reading saves the rules Claude
 *   proposed (HR then approves each). Answers { status: 'reading' | 'read' | 'failed', rules?, message? }.
 * POST { action: 'suggest', case_id }
 *   case_ai_context (HR; facts and approved rules, no names), one request to Claude, and the suggestion
 *   saved on the case. Answers the suggestion: { matches, missing_facts, nte_draft, cautions, model }.
 *
 * Errors are { code, message }. Nothing about a case or a person is logged.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { bearer, CORS_HEADERS, json } from '../_shared/http.ts';
import type { S3 } from '../_shared/s3.ts';
import { type CaseContext, codeReadingRequest, MODEL, suggestionRequest } from './prompts.ts';

type RpcError = { message: string; code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
export interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>;
}

export type BatchOutcome =
  | { type: 'succeeded'; message: Anthropic.Message }
  | { type: 'errored' | 'canceled' | 'expired' };

/** The four Anthropic calls this function makes (index.ts wires the SDK; tests pass a fake). */
export interface ClaudeApi {
  createBatch(params: Anthropic.MessageCreateParamsNonStreaming, customId: string): Promise<{ id: string }>;
  batchStatus(id: string): Promise<string>;
  batchResult(id: string): Promise<BatchOutcome | null>;
  message(params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.Messages.BetaMessage>;
}

export interface DisciplineAiDeps {
  userClient: (jwt: string) => Rpc;
  admin: Rpc;
  s3: S3 | null;
  /** null until ANTHROPIC_API_KEY is set */
  claude: ClaudeApi | null;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

export const MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  not_configured: 'Claude is not set up yet. Ask the administrator to add the Anthropic API key (supabase/SETUP.md, step 10).',
  no_storage: 'File storage is not set up yet. Ask the administrator to finish the Amazon S3 set-up.',
  invalid_input: 'Something is missing from the request. Try again.',
  pdf_missing: 'The PDF could not be read from storage. Upload it again.',
  claude_failed: 'Claude could not be reached. Try again in a minute.',
  declined: 'Claude declined this request. Carry on without a suggestion.',
  unreadable: 'Claude could not use the answer it gave. Try again.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;
type Code = keyof typeof MESSAGES;

/** Why a reading failed, as HR reads it on the code's page. */
export const READING_FAILED = {
  errored: 'Claude could not read the PDF. Try again; if it fails again, upload a clearer copy.',
  canceled: 'The reading was stopped. Start it again.',
  expired: 'The reading took too long and was dropped. Start it again.',
  refusal: 'Claude declined to read this document.',
  max_tokens: 'The code is too long to read in one go. Split the PDF into parts and upload each as its own version.',
  not_a_code: 'This PDF does not look like a Code of Discipline, or it could not be read. Upload a clearer copy.',
  bad_json: 'Claude\'s answer could not be used. Start the reading again.',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, code: Code) => json(status, { code, message: MESSAGES[code] });

function dbFail(error: NonNullable<RpcError>, log?: DisciplineAiDeps['log']): Response {
  const code = error.code ?? '';
  if (code.startsWith('PGRST30') || /\bjwt\b/i.test(error.message)) return fail(401, 'signed_out');
  if (code === '42501') return json(403, { code: 'refused', message: error.message });
  if (code === '22023' || code === 'P0001') return json(400, { code: 'rejected', message: error.message });
  if (code === 'P0002') return json(404, { code: 'not_found', message: error.message });
  log?.('db_error', { sqlstate: code.slice(0, 12) });
  return fail(500, 'server');
}

/** Base64 without a library: in chunks, so a 10 MB PDF does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** The JSON Claude wrote (structured outputs put it in the text blocks). */
export function answerJson(content: readonly { type: string; text?: string }[]): unknown {
  const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max).map((x) => x.slice(0, 500)) : [];

export function createDisciplineAiHandler(deps: DisciplineAiDeps) {
  const log = deps.log;

  async function failReading(codeId: string, why: string): Promise<void> {
    await deps.admin.rpc('fail_code_reading', { p_code_id: codeId, p_error: why });
  }

  async function readCode(codeId: string, jwt: string): Promise<Response> {
    if (!deps.claude) return fail(503, 'not_configured');
    if (!deps.s3) return fail(503, 'no_storage');
    const started = await deps.userClient(jwt).rpc('start_code_reading', { p_code_id: codeId });
    if (started.error) return dbFail(started.error, log);
    const { file_key: key, title } = started.data as { file_key: string; title: string };

    let pdf: Uint8Array;
    try {
      pdf = await deps.s3.get(key);
    } catch {
      await failReading(codeId, MESSAGES.pdf_missing);
      return fail(502, 'pdf_missing');
    }
    if (pdf.length < 5 || new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
      await failReading(codeId, MESSAGES.pdf_missing);
      return fail(502, 'pdf_missing');
    }
    try {
      const batch = await deps.claude.createBatch(codeReadingRequest(toBase64(pdf), title), codeId);
      const noted = await deps.admin.rpc('set_code_reading_job', { p_code_id: codeId, p_job: batch.id, p_model: MODEL });
      if (noted.error) return dbFail(noted.error, log);
    } catch (e) {
      log?.('claude_failed', { step: 'batch', status: (e as { status?: number }).status ?? 0 });
      await failReading(codeId, MESSAGES.claude_failed);
      return fail(502, 'claude_failed');
    }
    log?.('reading_started', { bytes: pdf.length });
    return json(200, { status: 'reading' });
  }

  async function checkCode(codeId: string, jwt: string): Promise<Response> {
    const st = await deps.userClient(jwt).rpc('code_reading_status', { p_code_id: codeId });
    if (st.error) return dbFail(st.error, log);
    const { read_status: status, read_job: job, read_error: error } = st.data as {
      read_status: string;
      read_job: string | null;
      read_error: string | null;
    };
    if (status !== 'reading') return json(200, { status, ...(error ? { message: error } : {}) });
    if (!job) return json(200, { status: 'reading' });
    if (!deps.claude) return fail(503, 'not_configured');

    let outcome: BatchOutcome | null;
    try {
      if ((await deps.claude.batchStatus(job)) !== 'ended') return json(200, { status: 'reading' });
      outcome = await deps.claude.batchResult(job);
    } catch (e) {
      log?.('claude_failed', { step: 'check', status: (e as { status?: number }).status ?? 0 });
      return fail(502, 'claude_failed');
    }
    const failed = async (why: keyof typeof READING_FAILED) => {
      log?.('reading_failed', { why });
      await failReading(codeId, READING_FAILED[why]);
      return json(200, { status: 'failed', message: READING_FAILED[why] });
    };
    if (!outcome || outcome.type !== 'succeeded') return failed(outcome?.type ?? 'errored');
    const msg = outcome.message;
    if (msg.stop_reason === 'refusal') return failed('refusal');
    if (msg.stop_reason === 'max_tokens') return failed('max_tokens');
    const answer = answerJson(msg.content);
    if (!isObj(answer) || !Array.isArray(answer.rules)) return failed('bad_json');
    if (answer.readable === false || answer.rules.length === 0) return failed('not_a_code');

    const saved = await deps.admin.rpc('finish_code_reading', {
      p_code_id: codeId,
      p_rules: answer.rules.filter(isObj).slice(0, 500),
      p_summary: typeof answer.summary === 'string' ? answer.summary : '',
      p_notes: Array.isArray(answer.compliance_notes) ? answer.compliance_notes.filter(isObj).slice(0, 100) : [],
      p_model: msg.model,
    });
    if (saved.error) return dbFail(saved.error, log);
    log?.('reading_done', { rules: Number(saved.data) || 0, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens });
    return json(200, { status: 'read', rules: Number(saved.data) || 0 });
  }

  async function suggest(caseId: string, jwt: string): Promise<Response> {
    if (!deps.claude) return fail(503, 'not_configured');
    const c = await deps.userClient(jwt).rpc('case_ai_context', { p_case_id: caseId });
    if (c.error) return dbFail(c.error, log);
    const ctx = c.data as CaseContext;

    let msg: Anthropic.Beta.Messages.BetaMessage;
    try {
      msg = await deps.claude.message(suggestionRequest(ctx));
    } catch (e) {
      log?.('claude_failed', { step: 'suggest', status: (e as { status?: number }).status ?? 0 });
      return fail(502, 'claude_failed');
    }
    if (msg.stop_reason === 'refusal') return json(422, { code: 'declined', message: MESSAGES.declined });
    const answer = answerJson(msg.content);
    if (!isObj(answer) || msg.stop_reason === 'max_tokens') return fail(502, 'unreadable');

    // only rules HR approved, by their ids: anything else Claude wrote is dropped
    const ids = new Set(ctx.rules.map((r) => r.id));
    const matches = (Array.isArray(answer.matches) ? answer.matches : [])
      .filter(isObj)
      .filter((m) => typeof m.rule_id === 'string' && ids.has(m.rule_id))
      .slice(0, 3)
      .map((m) => ({
        rule_id: m.rule_id as string,
        confidence: ['high', 'medium', 'low'].includes(m.confidence as string) ? (m.confidence as string) : 'low',
        why: typeof m.why === 'string' ? m.why.slice(0, 1000) : '',
      }));
    const suggestion = {
      matches,
      missing_facts: strings(answer.missing_facts, 10),
      nte_draft: typeof answer.nte_draft === 'string' ? answer.nte_draft.slice(0, 8000) : '',
      cautions: strings(answer.cautions, 10),
      model: msg.model,
    };
    const saved = await deps.admin.rpc('save_case_suggestion', { p_case_id: caseId, p_suggestion: suggestion });
    if (saved.error) return dbFail(saved.error, log);
    log?.('suggested', { matches: matches.length, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens });
    return json(200, suggestion);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method');
    const jwt = bearer(req);
    if (!jwt) return fail(401, 'signed_out');
    try {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const id = (k: string) => (typeof body?.[k] === 'string' && UUID.test(body[k] as string) ? (body[k] as string) : null);
      if (body?.action === 'read_code' && id('code_id')) return await readCode(id('code_id')!, jwt);
      if (body?.action === 'check_code' && id('code_id')) return await checkCode(id('code_id')!, jwt);
      if (body?.action === 'suggest' && id('case_id')) return await suggest(id('case_id')!, jwt);
      return fail(400, 'invalid_input');
    } catch (e) {
      log?.('error', { name: e instanceof Error ? e.name : 'unknown' });
      return fail(500, 'server');
    }
  };
}
