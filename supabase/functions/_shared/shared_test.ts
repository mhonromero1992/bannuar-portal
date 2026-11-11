import { assert, assertEquals } from 'jsr:@std/assert@1';
import { DEFAULT_LOGIN_DOMAIN, loginEmail, loginEmailFits } from './loginEmail.ts';
import { channelFor, GENERIC_BODY, pushText, redact } from './pushText.ts';
import { clientIp, sameSecret, serviceKey } from './http.ts';

// The app (bannuar-app __tests__/loginEmail.test.ts) checks the same table: keep them in step.
const LOGIN_EMAILS: Array<[string, string]> = [
  ['G-001', 'g-001@employees.bannuar.invalid'],
  [' g-001 ', 'g-001@employees.bannuar.invalid'],
  ['2019-0001', '2019-0001@employees.bannuar.invalid'],
  ['BSA 2024/001', 'bsa_00202024_002f001@employees.bannuar.invalid'],
  ['A_1', 'a_005f1@employees.bannuar.invalid'],
  ['A.1', 'a_002e1@employees.bannuar.invalid'],
  ['DEMO-0002', 'demo-0002@employees.bannuar.invalid'],
];

Deno.test('login email from the employee number', () => {
  assertEquals(DEFAULT_LOGIN_DOMAIN, 'employees.bannuar.invalid');
  for (const [no, email] of LOGIN_EMAILS) assertEquals(loginEmail(no), email);
  assertEquals(loginEmail('G-001', 'staff.bannuar.ph'), 'g-001@staff.bannuar.ph');
});

Deno.test('two employee numbers never share a login', () => {
  const nos = ['A-1', 'A_1', 'A 1', 'A/1', 'A.1', 'A1', 'A_0020 1', 'A__1'];
  const emails = new Set(nos.map((n) => loginEmail(n)));
  assertEquals(emails.size, nos.length);
});

Deno.test('the part before @ stays within 64 characters', () => {
  assert(loginEmailFits('G-001'));
  assert(!loginEmailFits(''));
  assert(!loginEmailFits('/'.repeat(13)));
});

Deno.test('push text never carries amounts or personal numbers', () => {
  assertEquals(redact('Net pay ₱9,530.00 for Oct 16 to 31, 2026'), 'Net pay … for Oct 16 to 31, 2026');
  assertEquals(redact('PHP 1,000 and P 2,500.50 and P540.00 and 540.00'), '… and … and … and …');
  assertEquals(redact('SSS 02-2345678-9, TIN 123-456-789-000, call 0917 123 4567'), 'SSS …, TIN …, call …');
  assertEquals(redact('Drill at 8.30 on Nov 20, 2026 at Post 2'), 'Drill at 8.30 on Nov 20, 2026 at Post 2');
  const slip = pushText({ id: 'n1', user_id: 'u', kind: 'payslip', title: 'Your payslip is ready', body: 'Oct 16 to 31, 2026' });
  assertEquals(slip, { title: 'Your payslip is ready', body: 'Oct 16 to 31, 2026' });
  const sneaky = pushText({ id: 'n1', user_id: 'u', kind: 'payslip', title: 'Your payslip is ready', body: 'Net ₱9,530.00' });
  assert(!/9,530|9530/.test(sneaky.body));
});

Deno.test('bodies typed freely by staff are replaced by a pointer to the app', () => {
  for (const kind of ['payroll_concern', 'profile_change', 'coe', 'something_new']) {
    const t = pushText({ id: 'n', user_id: 'u', kind, title: 'Your payroll concern is resolved', body: 'We added ₱540 for 4 hours OT' });
    assertEquals(t.body, GENERIC_BODY);
  }
  assertEquals(pushText({ id: 'n', user_id: 'u', kind: 'leave', title: 'Leave approved', body: 'Service incentive leave · Nov 20 to 21, 2026' }).body,
    'Service incentive leave · Nov 20 to 21, 2026');
  assertEquals(pushText({ id: 'n', user_id: 'u', kind: 'leave', title: 'Leave not approved', body: 'Too many guards off that week.' }).body, GENERIC_BODY);
});

Deno.test('long text is clipped and urgent announcements get their own channel', () => {
  const t = pushText({ id: 'n', user_id: 'u', kind: 'announcement', title: 'T'.repeat(100), body: 'B'.repeat(300) });
  assert(t.title.length <= 65 && t.body.length <= 160);
  assertEquals(channelFor({ id: 'n', user_id: 'u', kind: 'announcement', title: 'Urgent: typhoon signal 3' }), 'bannuar-urgent');
  assertEquals(channelFor({ id: 'n', user_id: 'u', kind: 'payslip', title: 'Your payslip is ready' }), 'bannuar-updates');
});

Deno.test('helpers: secret compare, IP, service key', () => {
  assert(sameSecret('abc', 'abc'));
  assert(!sameSecret('abc', 'abd'));
  assert(!sameSecret('abc', 'abcd'));
  assertEquals(clientIp(new Request('http://x', { headers: { 'x-real-ip': '192.0.2.1' } })), '192.0.2.1');
  assertEquals(clientIp(new Request('http://x')), null);
  assertEquals(serviceKey((n) => ({ SUPABASE_SERVICE_ROLE_KEY: 'legacy' } as Record<string, string>)[n]), 'legacy');
  assertEquals(serviceKey((n) => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' } as Record<string, string>)[n]), 'sb_secret_x');
  assertEquals(serviceKey(() => undefined), undefined);
});
