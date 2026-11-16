// logbook-ai against a fake database, S3 and Claude. Nothing reaches the network.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { S3 } from '../_shared/s3.ts';
import { type ClaudeMessages, createLogbookAiHandler, MESSAGES, parseReading, type Rpc, toBase64 } from './handler.ts';
import { LOGBOOK_SCHEMA, MAX_IMAGE_BYTES } from './prompts.ts';

globalThis.fetch = () => {
  throw new Error('logbook-ai tests must not reach the network');
};

const SITE = '7d0f6a52-3c1e-4d7a-9b1e-0a2b3c4d5e6f';
const PAGE = '2f6e1c3a-8b7d-4e5f-9a0b-1c2d3e4f5a6b';
const KEY = 'company/logbooks/pa/2026/11/2026-11-16_0915_logbook_0a1b2c3d4e.jpg';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]);
const PDF = new TextEncoder().encode('%PDF-1.7\n...');
const READING = {
  legibility: 'clear', page_date: '2026-11-15', post_written: 'Main Gate',
  lines: [
    { name: 'J. Dela Cruz', employee_no: '', date: '2026-11-15', time_in: '06:02', time_out: '18:05', remarks: '', unclear: false },
    { name: 'Ma. Santos', employee_no: '', date: '2026-11-15', time_in: '18:00', time_out: '', remarks: 'relieved late', unclear: true },
  ],
  concerns: ['Line 2 time in looks overwritten'],
};
const PAGE_DETAIL = { id: PAGE, post: 'Post A · Main Gate', status: 'read', lines: [{ line_no: 1, match: 'confirmed' }, { line_no: 2, match: 'not_in_app' }] };

type Call = { fn: string; args?: Record<string, unknown>; jwt?: string };
function fakeDb(o: { beginError?: { message: string; code: string }; context?: unknown } = {}) {
  const calls: Call[] = [];
  const client = (jwt?: string): Rpc => ({
    rpc(fn, args) {
      calls.push({ fn, args, jwt });
      if (fn === 'begin_logbook_page') {
        return Promise.resolve(o.beginError ? { data: null, error: o.beginError } : {
          data: { page_id: PAGE, file_id: 'file-1', key: KEY, content_type: 'image/jpeg', post: 'Post A · Main Gate', today: '2026-11-16' },
          error: null,
        });
      }
      if (fn === 'logbook_page_context') {
        return Promise.resolve({ data: o.context ?? { page_id: PAGE, key: KEY, content_type: 'image/jpeg', size_bytes: 10, post: 'Post A · Main Gate', today: '2026-11-16' }, error: null });
      }
      if (fn === 'save_logbook_reading') return Promise.resolve({ data: args?.p_reading ? PAGE_DETAIL : { page_id: PAGE, status: 'failed' }, error: null });
      return Promise.resolve({ data: { id: 'file-1' }, error: null });
    },
  });
  return { calls, userClient: (jwt: string) => client(jwt), admin: client() };
}
function fakeS3() {
  const puts: { key: string; type: string; bytes: number }[] = [];
  const s3: S3 = {
    put: (key, bytes, type) => {
      puts.push({ key, type, bytes: bytes.length });
      return Promise.resolve();
    },
    get: () => Promise.resolve(JPEG),
    remove: () => Promise.resolve(),
    presignGet: () => Promise.resolve(''),
    publicUrl: () => '',
  };
  return { s3, puts };
}
const reply = (answer: unknown, over: Partial<Anthropic.Beta.Messages.BetaMessage> = {}) =>
  ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(answer), citations: null }], usage: { input_tokens: 1800, output_tokens: 400 }, ...over,
  }) as Anthropic.Beta.Messages.BetaMessage;

function setup(o: { answer?: Anthropic.Beta.Messages.BetaMessage; claude?: ClaudeMessages | null; throws?: boolean; s3?: S3 | null; beginError?: { message: string; code: string }; context?: unknown } = {}) {
  const db = fakeDb(o);
  const store = fakeS3();
  const sent: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const claude: ClaudeMessages = {
    message(p) {
      if (o.throws) return Promise.reject(Object.assign(new Error('overloaded'), { status: 529 }));
      sent.push(p);
      return Promise.resolve(o.answer ?? reply(READING));
    },
  };
  const logs: string[] = [];
  const h = createLogbookAiHandler({
    userClient: db.userClient, admin: db.admin, s3: o.s3 === undefined ? store.s3 : o.s3, claude: o.claude === undefined ? claude : o.claude,
    log: (e, f) => logs.push(JSON.stringify({ e, ...f })),
  });
  return { h, calls: db.calls, sent, logs, puts: store.puts };
}
const send = (bytes: Uint8Array, site = SITE, token = 'client-jwt') => {
  const form = new FormData();
  form.append('site_id', site);
  form.append('file', new Blob([new Uint8Array(bytes)]), 'page.jpg');
  return new Request('https://fn.test/logbook-ai', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
};
const post = (body: unknown, token = 'hr-jwt') =>
  new Request('https://fn.test/logbook-ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

Deno.test('a client sends a page: kept in S3 under the post, read by Claude, matched by the database', async () => {
  const { h, calls, sent, puts } = setup();
  const res = await h(send(JPEG));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 'read', page: PAGE_DETAIL });
  assertEquals(calls[0], { fn: 'begin_logbook_page', args: { p_site_id: SITE, p_content_type: 'image/jpeg', p_size_bytes: JPEG.length }, jwt: 'client-jwt' });
  assertEquals(puts, [{ key: KEY, type: 'image/jpeg', bytes: JPEG.length }]);
  assertEquals(calls[1], { fn: 'finish_file_upload', args: { p_file_id: 'file-1', p_size_bytes: JPEG.length }, jwt: undefined });
  const p = sent[0];
  assertEquals(p.model, 'claude-opus-5-5');
  assertEquals(p.fallbacks, 'default');
  assertEquals(p.output_config, { effort: 'high', format: { type: 'json_schema', schema: LOGBOOK_SCHEMA } });
  const content = p.messages[0].content as Anthropic.Beta.Messages.BetaContentBlockParam[];
  assertEquals((content[0] as Anthropic.Beta.Messages.BetaImageBlockParam).source, { type: 'base64', media_type: 'image/jpeg', data: toBase64(JPEG) });
  assertStringIncludes((content[1] as Anthropic.Beta.Messages.BetaTextBlockParam).text, 'Today in Manila is 2026-11-16');
  assertStringIncludes((content[1] as Anthropic.Beta.Messages.BetaTextBlockParam).text, 'Post A · Main Gate');
  assertStringIncludes(String(p.system), 'Copy what is written');
  const saved = calls.find((c) => c.fn === 'save_logbook_reading')!;
  assertEquals(saved.jwt, undefined, 'saved with the service role');
  assertEquals((saved.args!.p_reading as { lines: unknown[]; model: string }).lines.length, 2);
  assertEquals((saved.args!.p_reading as { model: string }).model, 'claude-opus-5-5');
});

Deno.test('no guard names go to Anthropic: only the photo, the post and the date', async () => {
  const { h, sent } = setup();
  await h(send(JPEG));
  const text = JSON.stringify(sent[0].messages);
  assert(!/Dela Cruz|Santos|employee_id/i.test(text));
});

Deno.test('the photo must be a JPEG, PNG or WebP up to 5 MB; HEIC is explained; nothing is stored otherwise', async () => {
  let s = setup();
  let res = await s.h(send(HEIC));
  assertEquals(res.status, 415);
  assertEquals((await res.json()).message, MESSAGES.heic);
  res = await s.h(send(PDF));
  assertEquals(res.status, 415);
  assertEquals((await res.json()).code, 'bad_type');
  res = await s.h(send(new Uint8Array(MAX_IMAGE_BYTES + 1).fill(0xff)));
  assertEquals(res.status, 413);
  assertEquals(s.calls.length, 0);
  assertEquals(s.puts.length, 0);

  s = setup();
  res = await s.h(send(JPEG, 'not-a-post'));
  assertEquals(res.status, 400);
});

Deno.test('the database decides who may send for a post: a refusal stores nothing', async () => {
  const s = setup({ beginError: { message: 'Only HR, operations, or the client of this post can send its logbook', code: '42501' } });
  const res = await s.h(send(JPEG));
  assertEquals(res.status, 403);
  assertStringIncludes((await res.json()).message, 'client of this post');
  assertEquals(s.puts.length, 0);
  assertEquals(s.sent.length, 0);
});

Deno.test('Claude unreachable, declining, or answering in another shape: the photo is kept, the page marked failed', async () => {
  for (const [o, code] of [
    [{ throws: true }, 'claude_failed'],
    [{ answer: reply({}, { stop_reason: 'refusal' }) }, 'declined'],
    [{ answer: reply({ lines: 'none' }) }, 'claude_failed'],
    [{ answer: reply('not json at all') }, 'claude_failed'],
    [{ claude: null }, 'not_configured'],
  ] as const) {
    const s = setup(o);
    const res = await s.h(send(JPEG));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { status: 'failed', page_id: PAGE, code, message: MESSAGES[code] });
    assertEquals(s.puts.length, 1, 'the photo is kept');
    const saved = s.calls.find((c) => c.fn === 'save_logbook_reading')!;
    assertEquals(saved.args!.p_reading, null);
  }
});

Deno.test('a stored page is read again from S3, for someone the database lets see it', async () => {
  const s = setup();
  const res = await s.h(post({ action: 'read', page_id: PAGE }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, 'read');
  assertEquals(s.calls[0], { fn: 'logbook_page_context', args: { p_page_id: PAGE }, jwt: 'hr-jwt' });
  assertEquals(s.puts.length, 0);
  assertEquals(s.sent.length, 1);
});

Deno.test('no storage, no token, wrong method or input', async () => {
  assertEquals((await setup({ s3: null }).h(send(JPEG))).status, 503);
  const { h } = setup();
  assertEquals((await h(send(JPEG, SITE, ''))).status, 401);
  assertEquals((await h(post({ action: 'read', page_id: 'x' }))).status, 400);
  assertEquals((await h(post({ action: 'other' }))).status, 400);
  assertEquals((await h(new Request('https://fn.test/logbook-ai'))).status, 405);
});

Deno.test('logs carry the outcome, never names, keys or posts', async () => {
  const { h, logs } = setup();
  await h(send(JPEG));
  assert(logs.length > 0);
  assert(logs.every((l) => !/Dela|Santos|logbooks\/|Main Gate/i.test(l)));
});

Deno.test('parseReading wants the asked-for object with its lines', () => {
  assertEquals(parseReading(reply(READING))?.legibility, 'clear');
  assertEquals(parseReading(reply([1, 2])), null);
  assertEquals(parseReading(reply({ legibility: 'clear' })), null);
});
