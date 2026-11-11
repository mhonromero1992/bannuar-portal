import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { type ActivateAdmin, createActivateHandler, MESSAGES, normalizeMobile, parseInput } from './handler.ts';

type Call = { kind: 'rpc' | 'createUser'; args: Record<string, unknown> };

/** A stand-in for the service-role client: records calls and answers what each test says. */
function fakeAdmin(opts: {
  check?: { data: unknown; error: { message: string; code?: string } | null };
  create?: { error: { message: string; code?: string; status?: number } | null };
}) {
  const calls: Call[] = [];
  const admin: ActivateAdmin = {
    rpc(_fn, args) {
      calls.push({ kind: 'rpc', args });
      return Promise.resolve(opts.check ?? { data: { status: 'ok', ticket: 'a'.repeat(64) }, error: null });
    },
    auth: {
      admin: {
        createUser(attrs) {
          calls.push({ kind: 'createUser', args: attrs as unknown as Record<string, unknown> });
          const error = opts.create?.error ?? null;
          return Promise.resolve({ data: { user: error ? null : { id: 'u1' } }, error });
        },
      },
    },
  };
  return { admin, calls };
}

const logs: string[] = [];
const handler = (admin: ActivateAdmin) =>
  createActivateHandler({ admin, loginDomain: 'employees.bannuar.invalid', log: (e, f) => logs.push(`${e} ${JSON.stringify(f ?? {})}`) });

const good = { employee_no: ' g-002 ', birthdate: '1992-02-02', mobile_no: '+63 917 111 0002', password: 'a-good-pass-1' };
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/activate-employee', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

Deno.test('a match creates the login with the ticket, the synthetic email and confirmed email', async () => {
  const { admin, calls } = fakeAdmin({});
  const res = await handler(admin)(post(good));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: 'activated', login_email: 'g-002@employees.bannuar.invalid' });
  assertEquals(calls[0], {
    kind: 'rpc',
    args: { p_employee_no: 'G-002', p_birthdate: '1992-02-02', p_mobile: '09171110002', p_ip: '203.0.113.9' },
  });
  assertEquals(calls[1], {
    kind: 'createUser',
    args: {
      email: 'g-002@employees.bannuar.invalid',
      password: 'a-good-pass-1',
      email_confirm: true,
      user_metadata: {
        account_type: 'employee',
        employee_no: 'G-002',
        birthdate: '1992-02-02',
        mobile_no: '09171110002',
        activation_ticket: 'a'.repeat(64),
      },
    },
  });
});

Deno.test('each answer of the check has its own plain message, and nothing is created', async () => {
  for (const [status, code, http] of [
    ['no_match', 'no_match', 400],
    ['already_active', 'already_active', 409],
    ['rate_limited', 'rate_limited', 429],
  ] as const) {
    const { admin, calls } = fakeAdmin({ check: { data: { status }, error: null } });
    const res = await handler(admin)(post(good));
    assertEquals(res.status, http);
    assertEquals(await res.json(), { code, message: MESSAGES[code] });
    assertEquals(calls.filter((c) => c.kind === 'createUser').length, 0);
  }
});

Deno.test('a mismatch never says which fact was wrong', () => {
  assert(!/birthdate is|mobile number is|number is wrong|not found/i.test(MESSAGES.no_match));
});

Deno.test('BANNUAR_ACTIVATION_FAILED (as Auth reports it) becomes a clear 400', async () => {
  for (const message of ['Database error creating new user', 'BANNUAR_ACTIVATION_FAILED']) {
    const { admin } = fakeAdmin({ create: { error: { message, code: 'unexpected_failure', status: 500 } } });
    const res = await handler(admin)(post(good));
    assertEquals(res.status, 400);
    assertEquals((await res.json()).code, 'activation_failed');
  }
});

Deno.test('an existing login and a weak password are told apart', async () => {
  let r = await handler(fakeAdmin({ create: { error: { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 } } }).admin)(post(good));
  assertEquals([r.status, (await r.json()).code], [409, 'already_active']);
  r = await handler(fakeAdmin({ create: { error: { message: 'Password should contain at least one character of each', code: 'weak_password', status: 422 } } }).admin)(post(good));
  assertEquals([r.status, (await r.json()).code], [400, 'weak_password']);
  r = await handler(fakeAdmin({ create: { error: { message: 'connection reset', status: 503 } } }).admin)(post(good));
  assertEquals([r.status, (await r.json()).code], [500, 'server']);
});

Deno.test('bad input is refused before the database is asked', async () => {
  const bad = [
    {},
    { ...good, employee_no: '' },
    { ...good, birthdate: '02/02/1992' },
    { ...good, birthdate: '1992-02-30' },
    { ...good, birthdate: '2999-01-01' },
    { ...good, mobile_no: '12345' },
    { ...good, mobile_no: '0817 111 0002' },
    { ...good, employee_no: 'X'.repeat(41) },
    { ...good, password: 'x'.repeat(80) },
  ];
  for (const body of bad) {
    const { admin, calls } = fakeAdmin({});
    const res = await handler(admin)(post(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals((await res.json()).code, 'invalid_input');
    assertEquals(calls.length, 0);
  }
  const { admin, calls } = fakeAdmin({});
  let res = await handler(admin)(post({ ...good, password: 'short' }));
  assertEquals([res.status, (await res.json()).code], [400, 'weak_password']);
  res = await handler(admin)(post('{not json'));
  assertEquals([res.status, (await res.json()).code], [400, 'invalid_input']);
  res = await handler(admin)(new Request('http://localhost/x', { method: 'GET' }));
  assertEquals(res.status, 405);
  assertEquals(calls.length, 0);
});

Deno.test('the IP comes from cf-connecting-ip, else the first x-forwarded-for entry', async () => {
  let f = fakeAdmin({ check: { data: { status: 'no_match' }, error: null } });
  await handler(f.admin)(post(good, { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '10.0.0.1' }));
  assertEquals(f.calls[0].args.p_ip, '198.51.100.1');
  f = fakeAdmin({ check: { data: { status: 'no_match' }, error: null } });
  await handler(f.admin)(new Request('http://localhost/x', { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }, body: JSON.stringify(good) }));
  assertEquals(f.calls[0].args.p_ip, '198.51.100.2');
});

Deno.test('a database failure is a 500, and logs carry nothing personal', async () => {
  logs.length = 0;
  const { admin } = fakeAdmin({ check: { data: null, error: { message: 'boom', code: '57014' } } });
  const res = await handler(admin)(post(good));
  assertEquals(res.status, 500);
  await handler(fakeAdmin({}).admin)(post(good));
  const all = logs.join('\n');
  for (const secret of ['G-002', '1992', '0917', '111', 'a-good-pass', 'aaaa']) assert(!all.includes(secret), `log leaked ${secret}: ${all}`);
  assertStringIncludes(all, 'activation_done');
});

Deno.test('mobile numbers are read the way the database reads them', () => {
  assertEquals(normalizeMobile('0917 123 4567'), '09171234567');
  assertEquals(normalizeMobile('+63 917 123 4567'), '09171234567');
  assertEquals(normalizeMobile('9171234567'), '09171234567');
  assertEquals(normalizeMobile('0917-123-456'), null);
  assertEquals(parseInput({ ...good, employee_no: 'bsa 2024/001' })?.employee_no, 'BSA 2024/001');
});
