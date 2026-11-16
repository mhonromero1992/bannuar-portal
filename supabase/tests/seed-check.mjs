// The demo year (seed-demo.sql) against the portal's own pay engine: every published payslip must be
// exactly what Payroll → Work out pay gives from the same time in and out, the draft cutoff must work
// out with its paid leave and leave its undecided exception out, and the 13th month must follow from
// what was published. run-tests.sh runs it on the demo database:
//   DEMO_PSQL="psql -h … -d bannuar_test_demo -U postgres" node seed-check.mjs
import { execFileSync } from 'node:child_process';
import { computePay, scheduleSheet, sheetFromDuties, thirteenthFromPayroll, toPayrollRow } from '../../src/lib/pay.ts';

const PSQL = (process.env.DEMO_PSQL ?? 'psql -d bannuar_test_demo -U postgres').split(/\s+/).filter(Boolean);
let admin = '';
const q = (sql, asAdmin = false) => {
  const pre = asAdmin ? `set request.jwt.claims = '{"sub":"${admin}","role":"authenticated"}'; ` : '';
  const out = execFileSync(PSQL[0], [...PSQL.slice(1), '-tA', '-q', '-v', 'ON_ERROR_STOP=1', '-c', pre + sql], { encoding: 'utf8' });
  const last = out.trim().split('\n').filter(Boolean).pop();
  return last ? JSON.parse(last) : null;
};
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n       ${detail}`}`);
};

admin = q("select to_json(id) from auth.users where email = 'bannuar@ibits.digital'");
if (!admin) throw new Error('Load demo-login.sql first: the check reads payroll-only functions as the demo admin.');
const year = q("select to_json(extract(year from public.manila_today() - 20)::int)");
const people = q("select json_agg(json_build_object('id', id, 'employee_no', employee_no, 'name', first_name || ' ' || last_name, 'date_hired', date_hired, 'date_separated', date_separated)) from public.employees");
const assignments = q("select json_agg(json_build_object('employee_id', employee_id, 'site_id', site_id, 'start_date', start_date, 'end_date', end_date, 'duty_hours', duty_hours, 'shift_start', shift_start::text)) from public.employee_assignments");
const posts = q("select json_agg(json_build_object('id', id, 'name', name, 'code', code, 'client_id', client_id, 'pay_rule_id', pay_rule_id)) from public.sites");
const rules = q('select json_agg(to_json(r)) from public.pay_rules r');
const rates = q("select json_agg(json_build_object('site_id', site_id, 'client_id', client_id, 'effective_from', effective_from, 'hourly_rate', hourly_rate)) from public.pay_rates");
const periods = q("select json_agg(json_build_object('id', id, 'start', period_start, 'end', period_end, 'status', status) order by period_start) from public.payroll_periods where label like 'Demo · %'");
check(`the demo year ${year} has its cutoffs, all published but the latest`, periods.length >= 2 && periods.slice(0, -1).every((p) => p.status === 'published') && periods.at(-1).status === 'draft', JSON.stringify(periods.map((p) => p.status)));

/** What Work out pay gives for a cutoff, from its counted duties and paid leave. */
const workOut = (p) => {
  const counted = q(`select coalesce(json_agg(json_build_object('employee_no', employee_no, 'site_id', site_id, 'dates', dates)), '[]') from public.cutoff_counted_duties('${p.id}')`, true);
  const leave = q(`select coalesce(json_agg(json_build_object('employee_no', employee_no, 'day', day, 'share', share)), '[]') from public.cutoff_paid_leave('${p.id}')`, true);
  const schedule = scheduleSheet({ start: p.start, end: p.end }, people, assignments, posts, rules);
  const { rows, unplaced } = sheetFromDuties(schedule, counted, leave);
  const results = computePay(rows, people, posts, rules, rates);
  const earn = (r) => r.lines.filter((l) => l.kind === 'earning').reduce((t, l) => t + l.amount, 0);
  return { rows, unplaced, ready: results.filter((r) => !r.problems.length && earn(r) > 0), problems: results.flatMap((r) => r.problems) };
};

const FIELDS = ['days_worked', 'hours_worked', 'overtime_hours', 'night_diff_hours', 'basic_pay', 'overtime_pay', 'night_diff_pay', 'allowances', 'sss', 'philhealth', 'pagibig', 'thirteenth_basic'];
const near = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005;
let compared = 0;
const differences = [];
for (const p of periods.filter((x) => x.status === 'published')) {
  const w = workOut(p);
  if (w.problems.length || w.unplaced.length) differences.push(`${p.start}: ${[...w.problems, ...w.unplaced.map((u) => `unplaced ${u.employee_no}`)].join('; ')}`);
  const slips = q(`select coalesce(json_agg(json_build_object('employee_no', e.employee_no, 'days_worked', s.days_worked, 'hours_worked', s.hours_worked,
      'overtime_hours', s.overtime_hours, 'night_diff_hours', s.night_diff_hours, 'basic_pay', s.basic_pay, 'overtime_pay', s.overtime_pay,
      'night_diff_pay', s.night_diff_pay, 'allowances', s.allowances, 'sss', s.sss, 'philhealth', s.philhealth, 'pagibig', s.pagibig,
      'gross_pay', s.gross_pay, 'total_deductions', s.total_deductions, 'net_pay', s.net_pay, 'thirteenth_basic', s.thirteenth_basic,
      'remarks', s.remarks, 'site_name', s.site_name, 'posts_detail', s.posts_detail)), '[]')
    from public.payslips s join public.employees e on e.id = s.employee_id where s.payroll_period_id = '${p.id}'`);
  const byNo = new Map(slips.map((s) => [s.employee_no, s]));
  if (byNo.size !== w.ready.length) differences.push(`${p.start}: ${byNo.size} payslips seeded, the engine pays ${w.ready.length}`);
  for (const r of w.ready) {
    const row = toPayrollRow(r);
    const s = byNo.get(r.employee_no);
    if (!s) { differences.push(`${p.start} ${r.employee_no}: no payslip seeded`); continue; }
    compared += 1;
    for (const f of FIELDS) if (!near(s[f], row[f])) differences.push(`${p.start} ${r.employee_no} ${f}: seeded ${s[f]}, engine ${row[f]}`);
    const gross = r.lines.filter((l) => l.kind === 'earning').reduce((t, l) => t + l.amount, 0);
    const ded = r.lines.filter((l) => l.kind === 'deduction').reduce((t, l) => t + l.amount, 0);
    if (!near(s.gross_pay, gross) || !near(s.total_deductions, ded) || !near(s.net_pay, gross - ded)) differences.push(`${p.start} ${r.employee_no}: gross/deductions/net ${s.gross_pay}/${s.total_deductions}/${s.net_pay}, engine ${gross}/${ded}/${gross - ded}`);
    if (s.remarks !== row.remarks) differences.push(`${p.start} ${r.employee_no} remarks: "${s.remarks}" vs "${row.remarks}"`);
    if (s.site_name !== row.site_name) differences.push(`${p.start} ${r.employee_no} site_name: "${s.site_name}" vs "${row.site_name}"`);
    const pd = (x) => JSON.stringify(x.map((d) => [d.site_id, d.post, d.from, d.to, Number(d.rate), Number(d.days), Number(d.leave_days), Number(d.basic)]));
    if (pd(s.posts_detail) !== pd(row.posts_detail)) differences.push(`${p.start} ${r.employee_no} posts: ${pd(s.posts_detail)} vs ${pd(row.posts_detail)}`);
  }
}
check(`every published payslip (${compared}) is what Work out pay gives from the time in and out, figure for figure`, compared > 40 && differences.length === 0, differences.slice(0, 6).join('\n       '));

// the draft: paid leave paid, the undecided exception left out until payroll decides it
const draft = periods.at(-1);
const d = workOut(draft);
const maria = d.ready.find((r) => r.employee_no === 'DEMO-0002');
const leaveLine = maria?.lines.find((l) => l.code === 'paid_leave');
check('the draft cutoff works out: DEMO-0002\'s approved day of leave is paid at ₱100 × 8 hours', leaveLine?.amount === 800 && maria?.leave_days === 1, JSON.stringify(maria?.lines));
const joseDays = q(`select count(*) from public.period_duties('${draft.start}', '${draft.end}') d join public.employees e on e.id = d.employee_id where e.employee_no = 'DEMO-0003'`);
const jose = d.ready.find((r) => r.employee_no === 'DEMO-0003');
check('the draft cutoff: DEMO-0003\'s duty logged away from the post waits for payroll\'s decision, not paid yet', jose && jose.days === Number(joseDays) - 1, `${jose?.days} of ${joseDays}`);
const review = q(`select row_to_json(x) from (select r.response, r.due_at > now() as open from public.cutoff_client_reviews r where r.period_id = '${draft.id}') x`);
check('the draft cutoff waits for the client\'s confirmation', review?.response === null && review?.open === true, JSON.stringify(review));

// the 13th month from what was published, the rest of the year projected
const released = q(`select public.thirteenth_month_released(${year})`, true);
const rows = thirteenthFromPayroll(year, released, people, assignments, posts, rules, rates);
const juan = rows.find((r) => r.person.employee_no === 'DEMO-0001');
const full = periods.filter((p) => p.status === 'published').at(-1)?.end === `${year}-10-31`;
check('13th month: DEMO-0001 (Bannuar\'s example) from published payroll, the rest projected', !full || (juan?.released === 16120 && juan?.projected === 5200 && juan?.amount === 21320),
  JSON.stringify(juan?.pieces.map((p) => [p.kind, p.post, p.from, p.to, p.basic, p.share])));
const shares = rows.every((r) => r.pieces.filter((p) => p.kind === 'released').every((p) => Math.abs(p.share - p.basic / 12) < 0.006));
const fewer = (no) => rows.find((r) => r.person.employee_no === no)?.released ?? 0;
check('13th month: released shares are a twelfth of the basic pay published, and days missed lower them', shares && rows.length >= 4 && (!full || (fewer('DEMO-0002') < fewer('DEMO-0003') && fewer('DEMO-0003') < 17333.34)),
  rows.map((r) => `${r.person.employee_no} ${r.released}+${r.projected}`).join(', '));

console.log(`SEED-CHECK pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
