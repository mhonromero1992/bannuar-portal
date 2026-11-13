// document-ai against a fake database, S3 and Claude. Nothing reaches the network.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { S3 } from '../_shared/s3.ts';
import { type ClaudeMessages, createDocumentAiHandler, expiryStatus, isoDate, MESSAGES, nameMatch, type Rpc, toBase64 } from './handler.ts';
import { DOCUMENT_SCHEMA } from './prompts.ts';

globalThis.fetch = () => {
  throw new Error('document-ai tests must not reach the network');
};

const KEY = 'employees/G-002/lesp/2026-11-13_security-license_0a1b2c3d4e.jpg';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const NOW = new Date('2026-11-13T04:00:00Z'); // noon in Manila
const ctx = {
  key: KEY, content_type: 'image/jpeg', size_bytes: 200000, type_code: 'SECURITY_LICENSE',
  type_name: 'Security guard license (LESP)', has_expiry: true, first_name: 'Bea', last_name: 'Lim',
};

type Call = { fn: string; args?: Record<string, unknown>; jwt?: string };
function fakeDb(context: unknown, error?: { message: string; code: string }) {
  const calls: Call[] = [];
  const client = (jwt?: string): Rpc => ({
    rpc(fn, args) {
      calls.push({ fn, args, jwt });
      if (fn === 'document_ai_context') return Promise.resolve({ data: error ? null : context, error: error ?? null });
      return Promise.resolve({ data: null, error: null });
    },
  });
  return { calls, userClient: (jwt: string) => client(jwt), admin: client() };
}
const s3: S3 = {
  put: () => Promise.resolve(),
  get: () => Promise.resolve(JPEG),
  remove: () => Promise.resolve(),
  presignGet: () => Promise.resolve(''),
  publicUrl: () => '',
};
const reply = (answer: unknown, over: Partial<Anthropic.Beta.Messages.BetaMessage> = {}) =>
  ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(answer), citations: null }], usage: { input_tokens: 1500, output_tokens: 300 }, ...over,
  }) as Anthropic.Beta.Messages.BetaMessage;

function setup(o: { context?: unknown; error?: { message: string; code: string }; answer?: Anthropic.Beta.Messages.BetaMessage; claude?: ClaudeMessages | null; throws?: boolean } = {}) {
  const db = fakeDb(o.context ?? ctx, o.error);
  const sent: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const claude: ClaudeMessages = {
    message(p) {
      if (o.throws) return Promise.reject(Object.assign(new Error('overloaded'), { status: 529 }));
      sent.push(p);
      return Promise.resolve(o.answer ?? reply({ matches_type: true, legibility: 'clear', holder_name: 'LIM, BEA SANTOS', document_no: 'R01-202611-000123', issued_on: '2025-03-06', expires_on: '2027-03-05', issuer: 'PNP SOSIA', concerns: [] }));
    },
  };
  const logs: string[] = [];
  const h = createDocumentAiHandler({
    userClient: db.userClient, admin: db.admin, s3, claude: o.claude === undefined ? claude : o.claude, now: () => NOW,
    log: (e, f) => logs.push(JSON.stringify({ e, ...f })),
  });
  return { h, calls: db.calls, sent, logs };
}
const post = (body: unknown, token = 'guard-jwt') =>
  new Request('https://fn.test/document-ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

Deno.test('a guard\'s LESP photo: read by Claude Opus 5.5, then checked here against her record and today', async () => {
  const { h, calls, sent } = setup();
  const res = await h(post({ action: 'check', key: KEY }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'checked');
  assertEquals(body.document_no, 'R01-202611-000123');
  assertEquals(body.expires_on, '2027-03-05');
  assertEquals(body.expiry, 'valid');
  assertEquals(body.name_match, 'match');
  assertEquals(body.type_ok, true);
  assertEquals(calls[0], { fn: 'document_ai_context', args: { p_file_key: KEY }, jwt: 'guard-jwt' });
  const p = sent[0];
  assertEquals(p.model, 'claude-opus-5-5');
  assertEquals(p.fallbacks, 'default');
  assertEquals(p.output_config?.format, { type: 'json_schema', schema: DOCUMENT_SCHEMA });
  const img = (p.messages[0].content as Anthropic.Beta.Messages.BetaContentBlockParam[])[0] as Anthropic.Beta.Messages.BetaImageBlockParam;
  assertEquals(img.source, { type: 'base64', media_type: 'image/jpeg', data: toBase64(JPEG) });
  assertStringIncludes(String(p.system), 'Security guard license (LESP)');
  assertStringIncludes(String(p.system), 'never say that it is');
  assert(!JSON.stringify(p).includes('Bea') && !JSON.stringify(p).includes('Lim'), 'the 201 name is not sent to Anthropic');
  const saved = calls.find((c) => c.fn === 'save_document_check')!;
  assertEquals(saved.jwt, undefined, 'saved with the service role');
  assertEquals((saved.args!.p_check as { expiry: string }).expiry, 'valid');
});

Deno.test('an expired license, or one about to expire, is called out', async () => {
  for (const [expires, status] of [['2026-11-01', 'expired'], ['2026-12-20', 'expiring'], ['', 'unknown']] as const) {
    const { h } = setup({ answer: reply({ matches_type: true, legibility: 'clear', holder_name: 'BEA LIM', document_no: 'X', issued_on: '', expires_on: expires, issuer: '', concerns: [] }) });
    assertEquals((await (await h(post({ action: 'check', key: KEY }))).json()).expiry, status);
  }
});

Deno.test('a PDF goes as a document; HEIC and over-large photos are not sent', async () => {
  let s = setup({ context: { ...ctx, content_type: 'application/pdf' } });
  await s.h(post({ action: 'check', key: KEY }));
  const doc = (s.sent[0].messages[0].content as Anthropic.Beta.Messages.BetaContentBlockParam[])[0];
  assertEquals(doc.type, 'document');

  s = setup({ context: { ...ctx, content_type: 'image/heic' } });
  assertEquals(await (await s.h(post({ action: 'check', key: KEY }))).json(), { status: 'unsupported', message: MESSAGES.heic });
  assertEquals(s.sent.length, 0);

  s = setup({ context: { ...ctx, size_bytes: 6 * 1024 * 1024 } });
  assertEquals((await (await s.h(post({ action: 'check', key: KEY }))).json()).status, 'unsupported');
  assertEquals(s.sent.length, 0);
});

Deno.test('refused by the database, declined by Claude, or Claude unreachable', async () => {
  let s = setup({ error: { message: 'File not found', code: 'P0002' } });
  let res = await s.h(post({ action: 'check', key: KEY }));
  assertEquals(res.status, 404);
  assertEquals(s.sent.length, 0);

  s = setup({ answer: reply({}, { stop_reason: 'refusal' }) });
  res = await s.h(post({ action: 'check', key: KEY }));
  assertEquals(res.status, 422);
  assert(!s.calls.some((c) => c.fn === 'save_document_check'));

  s = setup({ throws: true });
  res = await s.h(post({ action: 'check', key: KEY }));
  assertEquals(res.status, 502);
  assert(s.logs.some((l) => l.includes('529')));

  res = await setup({ claude: null }).h(post({ action: 'check', key: KEY }));
  assertEquals(res.status, 503);
});

Deno.test('only keys in an employee folder; signed in; POST', async () => {
  const { h } = setup();
  assertEquals((await h(post({ action: 'check', key: 'company/code-of-discipline/x.pdf' }))).status, 400);
  assertEquals((await h(post({ action: 'check', key: '../etc/passwd' }))).status, 400);
  assertEquals((await h(post({ action: 'check', key: KEY }, ''))).status, 401);
  assertEquals((await h(new Request('https://fn.test/document-ai'))).status, 405);
});

Deno.test('logs carry the outcome, never the name or the number', async () => {
  const { h, logs } = setup();
  await h(post({ action: 'check', key: KEY }));
  assert(logs.every((l) => !/BEA|LIM|R01-/i.test(l)));
});

Deno.test('name matching: surname and a first name; dates; expiry in Manila', () => {
  assertEquals(nameMatch('LIM, BEA SANTOS', 'Bea', 'Lim'), 'match');
  assertEquals(nameMatch('DELA CRUZ, JUAN P.', 'Juan', 'Dela Cruz'), 'match');
  assertEquals(nameMatch('LIM, ANNA', 'Bea', 'Lim'), 'partial');
  assertEquals(nameMatch('CRUZ, DANTE', 'Bea', 'Lim'), 'mismatch');
  assertEquals(nameMatch('', 'Bea', 'Lim'), 'unknown');
  assertEquals(nameMatch('PEÑA, JOSÉ', 'Jose', 'Pena'), 'match');
  assertEquals(isoDate('2027-03-05'), '2027-03-05');
  assertEquals(isoDate('March 5, 2027'), '');
  assertEquals(expiryStatus('2026-11-13', true, NOW), 'expiring');
  assertEquals(expiryStatus('2026-11-12', true, NOW), 'expired');
  // 11:30 PM on the 12th in UTC is already the 13th in Manila
  assertEquals(expiryStatus('2026-11-12', true, new Date('2026-11-12T16:30:00Z')), 'expired');
  assertEquals(expiryStatus('', false, NOW), 'none');
});
