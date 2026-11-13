// discipline-ai against a fake database, a fake S3 and a fake Claude. Nothing reaches the network: any
// fetch (api.anthropic.com included) fails the test.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { S3 } from '../_shared/s3.ts';
import { answerJson, type BatchOutcome, type ClaudeApi, createDisciplineAiHandler, MESSAGES, READING_FAILED, type Rpc, toBase64 } from './handler.ts';
import { CODE_SCHEMA, MODEL, SUGGESTION_SCHEMA } from './prompts.ts';

globalThis.fetch = () => {
  throw new Error('discipline-ai tests must not reach the network');
};

const CODE = '11111111-2222-4333-8444-555555555555';
const CASE = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const RULE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const RULE_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const KEY = 'company/code-of-discipline/2026-11-13_code-of-discipline_0a1b2c3d4e.pdf';
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF');

type Call = { fn: string; args?: Record<string, unknown>; jwt?: string };
type Answers = Record<string, { data?: unknown; error?: { message: string; code?: string } }>;

function fakeDb(answers: Answers) {
  const calls: Call[] = [];
  const client = (jwt?: string): Rpc => ({
    rpc(fn, args) {
      calls.push({ fn, args, jwt });
      const a = answers[fn] ?? { data: null };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  });
  return { calls, userClient: (jwt: string) => client(jwt), admin: client() };
}

const s3With = (objects: Record<string, Uint8Array>, failGet = false): S3 => ({
  put: () => Promise.resolve(),
  get: (key) => (failGet ? Promise.reject(new Error('nope')) : Promise.resolve(objects[key] ?? new Uint8Array())),
  remove: () => Promise.resolve(),
  presignGet: () => Promise.resolve(''),
  publicUrl: () => '',
});

function message(json: unknown, over: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: JSON.stringify(json), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 800 },
    ...over,
  } as Anthropic.Message;
}

function fakeClaude(opts: { status?: string; outcome?: BatchOutcome | null; reply?: Anthropic.Message; throws?: boolean } = {}) {
  const sent: { batch?: Anthropic.MessageCreateParamsNonStreaming; customId?: string; message?: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming } = {};
  const claude: ClaudeApi = {
    createBatch(params, customId) {
      if (opts.throws) return Promise.reject(Object.assign(new Error('overloaded'), { status: 529 }));
      sent.batch = params;
      sent.customId = customId;
      return Promise.resolve({ id: 'msgbatch_01' });
    },
    batchStatus: () => Promise.resolve(opts.status ?? 'ended'),
    batchResult: () => Promise.resolve(opts.outcome === undefined ? null : opts.outcome),
    message(params) {
      if (opts.throws) return Promise.reject(Object.assign(new Error('rate limited'), { status: 429 }));
      sent.message = params;
      return Promise.resolve((opts.reply ?? message({})) as unknown as Anthropic.Beta.Messages.BetaMessage);
    },
  };
  return { claude, sent };
}

function setup(o: { answers?: Answers; claude?: ClaudeApi | null; s3?: S3 | null } = {}) {
  const db = fakeDb(o.answers ?? {});
  const logs: string[] = [];
  const h = createDisciplineAiHandler({
    userClient: db.userClient,
    admin: db.admin,
    s3: o.s3 === undefined ? s3With({ [KEY]: PDF }) : o.s3,
    claude: o.claude === undefined ? fakeClaude().claude : o.claude,
    log: (e, f) => logs.push(JSON.stringify({ e, ...f })),
  });
  return { h, calls: db.calls, logs };
}

const post = (body: unknown, token = 'user-jwt') =>
  new Request('https://fn.test/discipline-ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

Deno.test('the request to read the code: Claude Opus 5.5, the PDF itself, structured output, high effort', async () => {
  const fake = fakeClaude();
  const { h, calls } = setup({ claude: fake.claude, answers: { start_code_reading: { data: { id: CODE, title: 'Code 2026', file_key: KEY } } } });
  const res = await h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 'reading' });
  assertEquals(calls[0], { fn: 'start_code_reading', args: { p_code_id: CODE }, jwt: 'user-jwt' });
  const p = fake.sent.batch!;
  assertEquals(p.model, 'claude-opus-5-5');
  assertEquals(fake.sent.customId, CODE);
  assertEquals(p.output_config?.effort, 'high');
  assertEquals(p.output_config?.format, { type: 'json_schema', schema: CODE_SCHEMA });
  assert(!('temperature' in p) && !('thinking' in p), 'no sampling or thinking settings (Opus 5.5 thinks adaptively)');
  const doc = (p.messages[0].content as Anthropic.ContentBlockParam[])[0] as Anthropic.DocumentBlockParam;
  assertEquals(doc.source, { type: 'base64', media_type: 'application/pdf', data: toBase64(PDF) });
  assertStringIncludes(String(p.system), 'Do not invent offenses');
  assertStringIncludes(String(p.system), 'Department Order 147-15');
  const job = calls.find((c) => c.fn === 'set_code_reading_job')!;
  assertEquals(job.args, { p_code_id: CODE, p_job: 'msgbatch_01', p_model: 'claude-opus-5-5' });
  assertEquals(job.jwt, undefined, 'the job is recorded with the service role');
});

Deno.test('every object in the schemas is closed and lists every field (what structured outputs need)', () => {
  const walk = (s: Record<string, unknown>) => {
    if (s.type === 'object') {
      assertEquals(s.additionalProperties, false);
      assertEquals(new Set(s.required as string[]), new Set(Object.keys(s.properties as object)));
      for (const v of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(v);
    }
    if (s.type === 'array') walk(s.items as Record<string, unknown>);
  };
  walk(CODE_SCHEMA);
  walk(SUGGESTION_SCHEMA);
});

Deno.test('reading: the database refuses non-HR, and nothing goes to Claude', async () => {
  const fake = fakeClaude();
  const { h } = setup({ claude: fake.claude, answers: { start_code_reading: { error: { message: 'Only HR can have the code read', code: '42501' } } } });
  const res = await h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).message, 'Only HR can have the code read');
  assertEquals(fake.sent.batch, undefined);
});

Deno.test('reading: a missing PDF or an unreachable Claude marks the reading failed', async () => {
  const started = { start_code_reading: { data: { id: CODE, title: 'Code', file_key: KEY } } };
  let s = setup({ answers: started, s3: s3With({}, true) });
  let res = await s.h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 502);
  assertEquals(s.calls.at(-1), { fn: 'fail_code_reading', args: { p_code_id: CODE, p_error: MESSAGES.pdf_missing }, jwt: undefined });

  s = setup({ answers: started, s3: s3With({ [KEY]: new TextEncoder().encode('not a pdf') }) });
  res = await s.h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 502);

  s = setup({ answers: started, claude: fakeClaude({ throws: true }).claude });
  res = await s.h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).code, 'claude_failed');
  assertEquals(s.calls.at(-1)?.fn, 'fail_code_reading');
  assert(s.logs.some((l) => l.includes('"status":529')));
});

Deno.test('without the API key or S3 the portal is told what to set up', async () => {
  let res = await setup({ claude: null }).h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 503);
  assertStringIncludes((await res.json()).message, 'Anthropic API key');
  res = await setup({ s3: null }).h(post({ action: 'read_code', code_id: CODE }));
  assertEquals(res.status, 503);
});

const reading = { code_reading_status: { data: { read_status: 'reading', read_job: 'msgbatch_01', read_error: null } } };
const RULES = [
  { ref: 'A-1', title: 'Sleeping on post', description: '', category: 'post_duty', gravity: 'grave', penalties: [], just_cause: 'gross_neglect', source_text: 'x', page: 3 },
];

Deno.test('checking: still reading while the batch runs', async () => {
  const { h, calls } = setup({ answers: reading, claude: fakeClaude({ status: 'in_progress' }).claude });
  assertEquals(await (await h(post({ action: 'check_code', code_id: CODE }))).json(), { status: 'reading' });
  assert(!calls.some((c) => c.fn === 'finish_code_reading'));
});

Deno.test('checking: when the batch ends, Claude\'s rules are saved as proposals', async () => {
  const outcome: BatchOutcome = {
    type: 'succeeded',
    message: message({ readable: true, summary: 'Covers duty.', rules: RULES, compliance_notes: [{ ref: 'D-1', note: 'Fines from wages' }] }),
  };
  const { h, calls } = setup({ answers: { ...reading, finish_code_reading: { data: 1 } }, claude: fakeClaude({ outcome }).claude });
  assertEquals(await (await h(post({ action: 'check_code', code_id: CODE }))).json(), { status: 'read', rules: 1 });
  const fin = calls.find((c) => c.fn === 'finish_code_reading')!;
  assertEquals(fin.jwt, undefined);
  assertEquals(fin.args, { p_code_id: CODE, p_rules: RULES, p_summary: 'Covers duty.', p_notes: [{ ref: 'D-1', note: 'Fines from wages' }], p_model: MODEL });
});

Deno.test('checking: a refusal, a cut-off answer, a non-code or a failed batch is reported plainly', async () => {
  const cases: [BatchOutcome | null, string][] = [
    [{ type: 'succeeded', message: message({}, { stop_reason: 'refusal' }) }, READING_FAILED.refusal],
    [{ type: 'succeeded', message: message({}, { stop_reason: 'max_tokens' }) }, READING_FAILED.max_tokens],
    [{ type: 'succeeded', message: message({ readable: false, summary: '', rules: [], compliance_notes: [] }) }, READING_FAILED.not_a_code],
    [{ type: 'succeeded', message: { ...message({}), content: [{ type: 'text', text: '{oops', citations: null }] } as Anthropic.Message }, READING_FAILED.bad_json],
    [{ type: 'expired' }, READING_FAILED.expired],
    [null, READING_FAILED.errored],
  ];
  for (const [outcome, why] of cases) {
    const { h, calls } = setup({ answers: reading, claude: fakeClaude({ outcome }).claude });
    const body = await (await h(post({ action: 'check_code', code_id: CODE }))).json();
    assertEquals(body, { status: 'failed', message: why });
    assertEquals(calls.at(-1), { fn: 'fail_code_reading', args: { p_code_id: CODE, p_error: why }, jwt: undefined });
  }
});

Deno.test('checking: a finished or failed reading just reports its state', async () => {
  const { h } = setup({ answers: { code_reading_status: { data: { read_status: 'failed', read_job: null, read_error: 'Claude could not read the PDF.' } } } });
  assertEquals(await (await h(post({ action: 'check_code', code_id: CODE }))).json(), { status: 'failed', message: 'Claude could not read the PDF.' });
});

const context = {
  case_id: CASE,
  facts: 'Found asleep at the main gate at 2 AM.',
  report: null,
  rules: [
    { id: RULE_A, ref: 'A-1', title: 'Sleeping on post', description: '', gravity: 'grave', penalties: [], source_text: '' },
    { id: RULE_B, ref: 'B-2', title: 'Tardiness', description: '', gravity: 'light', penalties: [], source_text: '' },
  ],
  earlier_findings: [],
};

Deno.test('a suggestion: facts and approved rules only, fallbacks on, rules Claude made up are dropped', async () => {
  const reply = message({
    matches: [
      { rule_id: RULE_A, confidence: 'high', why: 'Asleep while on duty.' },
      { rule_id: 'not-a-rule', confidence: 'high', why: 'Invented.' },
    ],
    missing_facts: ['Who found him'],
    nte_draft: 'Dear {{employee_name}}, ...',
    cautions: [],
  });
  const fake = fakeClaude({ reply });
  const { h, calls } = setup({ answers: { case_ai_context: { data: context } }, claude: fake.claude });
  const res = await h(post({ action: 'suggest', case_id: CASE }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.matches, [{ rule_id: RULE_A, confidence: 'high', why: 'Asleep while on duty.' }]);
  assertEquals(body.missing_facts, ['Who found him']);
  const p = fake.sent.message!;
  assertEquals(p.model, 'claude-opus-5-5');
  assertEquals(p.fallbacks, 'default');
  assertEquals(p.betas, ['server-side-fallback-2026-07-01']);
  assertEquals(p.output_config?.format, { type: 'json_schema', schema: SUGGESTION_SCHEMA });
  const sentText = JSON.stringify(p.messages);
  assertStringIncludes(sentText, 'Found asleep at the main gate');
  assert(!sentText.includes(CASE), 'the case id stays here');
  assertStringIncludes(String(p.system), '{{employee_name}}');
  const saved = calls.find((c) => c.fn === 'save_case_suggestion')!;
  assertEquals(saved.jwt, undefined);
  assertEquals((saved.args!.p_suggestion as { matches: unknown[] }).matches.length, 1);
});

Deno.test('a suggestion: refused, unreachable or not HR', async () => {
  let s = setup({ answers: { case_ai_context: { data: context } }, claude: fakeClaude({ reply: message({}, { stop_reason: 'refusal' }) }).claude });
  let res = await s.h(post({ action: 'suggest', case_id: CASE }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).code, 'declined');
  assert(!s.calls.some((c) => c.fn === 'save_case_suggestion'));

  s = setup({ answers: { case_ai_context: { data: context } }, claude: fakeClaude({ throws: true }).claude });
  res = await s.h(post({ action: 'suggest', case_id: CASE }));
  assertEquals(res.status, 502);

  s = setup({ answers: { case_ai_context: { error: { message: 'Only HR asks for suggestions', code: '42501' } } } });
  res = await s.h(post({ action: 'suggest', case_id: CASE }));
  assertEquals(res.status, 403);
});

Deno.test('signed out, a bad id or a GET is refused', async () => {
  const { h } = setup();
  assertEquals((await h(post({ action: 'read_code', code_id: CODE }, ''))).status, 401);
  assertEquals((await h(post({ action: 'read_code', code_id: 'x' }))).status, 400);
  assertEquals((await h(post({ action: 'other' }))).status, 400);
  assertEquals((await h(new Request('https://fn.test/discipline-ai'))).status, 405);
});

Deno.test('logs carry counts and statuses, never the facts', async () => {
  const reply = message({ matches: [], missing_facts: [], nte_draft: '', cautions: [] });
  const { h, logs } = setup({ answers: { case_ai_context: { data: context } }, claude: fakeClaude({ reply }).claude });
  await h(post({ action: 'suggest', case_id: CASE }));
  assert(logs.length > 0);
  assert(logs.every((l) => !l.includes('asleep') && !l.includes(CASE)));
});

Deno.test('helpers: base64 of a large file, and the JSON of a reply', () => {
  const big = new Uint8Array(200_000).map((_, i) => i % 256);
  assertEquals(atob(toBase64(big)).length, big.length);
  assertEquals(answerJson([{ type: 'thinking' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }]), { a: 1 });
  assertEquals(answerJson([{ type: 'text', text: 'nope' }]), null);
});
