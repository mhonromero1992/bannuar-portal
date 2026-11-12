// payslip-pdf against a fake database (no network). The PDF itself is opened again with pdf-lib.
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
import { createPayslipPdfHandler, type LoadPayslip, PAYSLIP_SELECT } from './handler.ts';
import { day, fileName, fullName, money, payslipLines, type PayslipRow } from './pdf.ts';

const ID = '9b2f4d1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const SLIP: PayslipRow = {
  site_name: 'Demo Post · Main Gate', days_worked: '13.00', hours_worked: '104.00', overtime_hours: '52.00', night_diff_hours: '56.00',
  basic_pay: '7020.00', overtime_pay: '3510.00', night_diff_pay: '378.00', holiday_pay: '540.00', allowances: '0', other_earnings: '0',
  gross_pay: '11448.00', sss: '450.00', philhealth: '250.00', pagibig: '100.00', withholding_tax: '0', loans: '0',
  other_deductions: '200.00', total_deductions: '1000.00', net_pay: '10448.00', earnings_detail: [],
  deductions_detail: [{ label: 'Uniform (demo)', amount: 200 }], remarks: 'Demo payslip. Peñafrancia — test ✓',
  period: { label: 'Demo · Oct 16 to 31, 2026', period_start: '2026-10-16', period_end: '2026-10-31', pay_date: '2026-11-05', status: 'published' },
  employee: { employee_no: 'DEMO-0002', first_name: 'Maria', middle_name: 'Luz', last_name: 'Santos', suffix: null, position: 'Lady Guard' },
};

function handler(answer: Awaited<ReturnType<LoadPayslip>>) {
  const asked: { jwt: string; id: string }[] = [];
  const logs: string[] = [];
  const h = createPayslipPdfHandler({
    load: (jwt, id) => {
      asked.push({ jwt, id });
      return Promise.resolve(answer);
    },
    now: () => new Date('2026-11-12T07:04:00Z'),
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
  });
  return { h, asked, logs };
}
const req = (body: unknown, token = 'user-jwt') =>
  new Request('https://x.supabase.co/functions/v1/payslip-pdf', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test('a guard’s own published payslip comes back as a one-page PDF download, read with her own token', async () => {
  const { h, asked, logs } = handler({ data: SLIP, error: null });
  const res = await h(req({ payslip_id: ID }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('content-type'), 'application/pdf');
  assertEquals(res.headers.get('content-disposition'), 'attachment; filename="payslip-DEMO-0002-2026-10-16-to-2026-10-31.pdf"');
  assertEquals(res.headers.get('cache-control'), 'no-store');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assertEquals(doc.getPageCount(), 1);
  assertEquals(doc.getTitle(), 'Payslip Demo · Oct 16 to 31, 2026'); // the middle dot is Latin-1; the remarks' — and ✓ become ?
  assertEquals(asked, [{ jwt: 'user-jwt', id: ID }]);
  assert(logs.every((l) => !l.includes('DEMO-0002') && !l.includes('10448')), 'nothing personal in the logs');
});

Deno.test('someone else’s payslip, or a draft cutoff for a guard, is simply not there', async () => {
  const { h } = handler({ data: null, error: null });
  const res = await h(req({ payslip_id: ID }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).code, 'not_found');
});

Deno.test('signed out, an expired token, a bad id, or the wrong method', async () => {
  assertEquals((await handler({ data: SLIP, error: null }).h(req({ payslip_id: ID }, ''))).status, 401);
  assertEquals((await handler({ data: null, error: { message: 'JWT expired', code: 'PGRST303' } }).h(req({ payslip_id: ID }))).status, 401);
  assertEquals((await handler({ data: SLIP, error: null }).h(req({ payslip_id: 'payslip-1' }))).status, 400);
  assertEquals((await handler({ data: SLIP, error: null }).h(new Request('https://x/payslip-pdf'))).status, 405);
  assertEquals((await handler({ data: null, error: { message: 'boom', code: 'XX000' } }).h(req({ payslip_id: ID }))).status, 500);
});

Deno.test('a draft cutoff still makes a PDF for payroll (marked DRAFT inside)', async () => {
  const draft = { ...SLIP, period: { ...SLIP.period!, status: 'draft' } };
  const res = await handler({ data: draft, error: null }).h(req({ payslip_id: ID }));
  assertEquals(res.status, 200);
  assertEquals((await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount(), 1);
});

Deno.test('the lines match the app: fixed columns, extra lines, the rest as Other, zeros left out', () => {
  const { earnings, deductions } = payslipLines(SLIP);
  assertEquals(earnings.map((l) => `${l.label} ${l.amount}`), ['Basic pay 7020', 'Overtime 3510', 'Night differential 378', 'Holiday pay 540']);
  assertEquals(deductions.map((l) => `${l.label} ${l.amount}`), ['SSS 450', 'PhilHealth 250', 'Pag-IBIG 100', 'Uniform (demo) 200']);
  assertEquals(money(10448), '10,448.00');
  assertEquals(money(-1234.5), '-1,234.50');
  assertEquals(day('2026-11-05'), '5 Nov 2026');
  assertEquals(fullName(SLIP.employee), 'Maria L. Santos');
  assertEquals(fileName({ ...SLIP, employee: { ...SLIP.employee!, employee_no: 'G 002/B' } }), 'payslip-G-002-B-2026-10-16-to-2026-10-31.pdf');
});

Deno.test('every column the PDF reads exists in the real schema', async () => {
  const snap = JSON.parse(await Deno.readTextFile(new URL('../../../tests/schema-snapshot.json', import.meta.url)));
  const cols = (t: string) => new Set<string>(snap.columns[t]);
  const top = PAYSLIP_SELECT.replace(/\w+:\w+\([^)]*\)/g, '').split(',').filter(Boolean);
  for (const c of top) assert(cols('payslips').has(c), `payslips.${c}`);
  for (const [, table, inner] of PAYSLIP_SELECT.matchAll(/\w+:(\w+)\(([^)]*)\)/g)) {
    for (const c of inner.split(',')) assert(cols(table).has(c), `${table}.${c}`);
  }
  assertStringIncludes(PAYSLIP_SELECT, 'status'); // drafts are marked
});
