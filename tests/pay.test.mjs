// Unit tests for the pay engine (src/lib/pay.ts). Run: npm run test:pay
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFormula, evaluate, compileLines, runLines, nightOverlap, nightHoursPerDuty, dutyVariables, monthsCovered,
  scheduledDays, thirteenthMonth, scheduleSheet, readSheet, computePay, toPayrollRow, toCsv, ruleFor, rateBook, VARIABLES, shiftSlots, timeLabel,
} from '../src/lib/pay.ts';

const NAMES = new Set(VARIABLES.map((v) => v.name));
const calc = (src, vars = {}) => evaluate(parseFormula(src, new Set([...NAMES, ...Object.keys(vars)])), vars);
const STANDARD = [
  { code: 'basic', label: 'Basic pay', formula: 'rate * regular_hours', kind: 'earning', thirteenth: true },
  { code: 'overtime', label: 'Overtime pay', formula: 'rate * 125% * overtime_hours', kind: 'earning' },
  { code: 'night_diff', label: 'Night differential', formula: 'rate * 10% * night_hours', kind: 'earning' },
];
const rule = (over = {}) => ({ id: 'r1', client_id: 'c1', name: 'Acme', is_default: true, regular_hours: 8, night_diff: 'last_shift', night_diff_hours: 8, days_per_month: 26, formulas: STANDARD, ...over });

test('formulas: arithmetic, percent, functions', () => {
  assert.equal(calc('2 + 3 * 4'), 14);
  assert.equal(calc('(2 + 3) * 4'), 20);
  assert.equal(calc('10%'), 0.1);
  assert.equal(calc('-2^2'), -4);
  assert.equal(calc('2^3^2'), 512);
  assert.equal(calc('rate * 125% * overtime_hours', { rate: 100, overtime_hours: 52 }), 6500);
  assert.equal(calc('if(days > 10, 1, 2)', { days: 13 }), 1);
  assert.equal(calc('min(3, 1, 2) + max(4, 9)'), 10);
  assert.equal(calc('round(2.345, 2)'), 2.35);
  assert.equal(calc('round(-2.5)'), -3);
  assert.equal(calc('floor(2.9) + ceil(2.1) + abs(-1)'), 6);
  assert.equal(calc('RATE * 2', { rate: 5 }), 10, 'names ignore capital letters');
});

test('formulas: mistakes are explained', () => {
  assert.throws(() => calc('rat * 2'), /Unknown name "rat" at character 1/);
  assert.throws(() => calc('(rate * 2', { rate: 1 }), /Missing "\)" at the end/);
  assert.throws(() => calc('rate *', { rate: 1 }), /ends too early/);
  assert.throws(() => calc('rate $ 2', { rate: 1 }), /"\$" cannot be used/);
  assert.throws(() => calc('sqrt(4)'), /no function "sqrt"/);
  assert.throws(() => calc('round()'), /round\(\) takes 1 to 2 values/);
  assert.throws(() => calc('1 / 0'), /Division by zero/);
  assert.throws(() => calc(''), /Write a formula/);
});

test('rule lines use the codes of the lines above them, and codes are checked', () => {
  const ok = compileLines([...STANDARD, { code: 'cola', label: 'COLA', formula: 'days * 25' }, { code: 'bonus', label: 'Night bonus', formula: 'night_diff * 50%' }]);
  assert.deepEqual(ok.errors, {});
  const out = runLines(ok.lines, dutyVariables(rule(), 100, 13, 12, '18:00'));
  assert.deepEqual(out.map((l) => [l.code, l.amount]), [['basic', 10400], ['overtime', 6500], ['night_diff', 1040], ['cola', 325], ['bonus', 520]]);
  const bad = compileLines([
    { code: 'rate', label: 'x', formula: '1' },
    { code: 'Basic Pay', label: 'x', formula: '1' },
    { code: 'a', label: 'A', formula: '1' },
    { code: 'a', label: 'B', formula: '2' },
    { code: 'b', label: 'B', formula: 'later * 2' },
    { code: 'later', label: 'L', formula: '1' },
  ]);
  assert.match(bad.errors[0], /already a name/);
  assert.match(bad.errors[1], /small letters/);
  assert.match(bad.errors[3], /already uses the code "a"/);
  assert.match(bad.errors[4], /Unknown name "later"/, 'a line cannot use a line below it');
  assert.equal(bad.errors[5], undefined);
});

test('night differential: the last guard of the day earns 8 hours', () => {
  const last = { night_diff: 'last_shift', night_diff_hours: 8 };
  assert.equal(nightHoursPerDuty(last, '06:00', 24), 8, '24-hour duty');
  assert.equal(nightHoursPerDuty(last, '18:00', 12), 8, '12-hour shift from 6pm');
  assert.equal(nightHoursPerDuty(last, '06:00', 12), 0, '12-hour day shift');
  assert.equal(nightHoursPerDuty(last, '22:00', 8), 8, '8-hour shift from 10pm');
  assert.equal(nightHoursPerDuty(last, '14:00', 8), 0, '8-hour afternoon shift');
  assert.equal(nightHoursPerDuty(last, '06:00', 8), 0, '8-hour morning shift');
  assert.equal(nightHoursPerDuty(last, '19:00', 12), 8, '12-hour shift from 7pm');
  assert.equal(nightHoursPerDuty(last, '23:00', 8), 8, '8-hour shift from 11pm');
  assert.equal(nightHoursPerDuty(last, '15:00', 8), 0, '8-hour shift to 11pm');
  const law = { night_diff: 'night_hours', night_diff_hours: 8 };
  assert.equal(nightHoursPerDuty(law, '15:00', 8), 1, 'Labor Code: 10pm to 11pm');
  assert.equal(nightHoursPerDuty(law, '23:00', 8), 7);
  assert.equal(nightHoursPerDuty(law, '00:00', 24), 8, 'midnight to midnight: two parts of the night');
  assert.equal(nightHoursPerDuty({ night_diff: 'none', night_diff_hours: 8 }, '18:00', 12), 0);
  assert.equal(nightOverlap('18:00', 12), 8);
});

test('a 12-hour night guard at ₱100 an hour for 13 duties', () => {
  const v = dutyVariables(rule(), 100, 13, 12, '18:00');
  assert.deepEqual(v, { rate: 100, daily_rate: 800, days: 13, duty_length: 12, duty_hours: 156, regular_hours: 104, overtime_hours: 52, night_hours: 104 });
  const day = dutyVariables(rule(), 100, 13, 12, '06:00');
  assert.equal(day.night_hours, 0, 'the day shift earns no night differential');
});

test('months and scheduled days', () => {
  assert.equal(monthsCovered('2026-01-01', '2026-03-31'), 3);
  assert.equal(monthsCovered('2026-04-16', '2026-04-30'), 0.5);
  assert.equal(monthsCovered('2026-02-01', '2026-02-28'), 1);
  assert.equal(Math.round(scheduledDays('2026-11-01', '2026-11-15', 26)), 13);
});

// The example from Bannuar: DEMO-0001 at Area1 (₱100/h) Jan to Mar, Area2 (₱90/h) Apr to Oct, Area3 (₱150/h) Nov to Dec
const posts = [
  { id: 'a1', name: 'Area1', code: 'A1', client_id: 'c1', pay_rule_id: null },
  { id: 'a2', name: 'Area2', code: 'A2', client_id: 'c1', pay_rule_id: null },
  { id: 'a3', name: 'Area3', code: 'A3', client_id: 'c1', pay_rule_id: null },
];
const rates = [
  { site_id: 'a1', client_id: null, effective_from: '2026-01-01', hourly_rate: 100 },
  { site_id: 'a2', client_id: null, effective_from: '2026-01-01', hourly_rate: 90 },
  { site_id: 'a3', client_id: null, effective_from: '2026-01-01', hourly_rate: 150 },
];
const juan = { id: 'e1', employee_no: 'DEMO-0001', name: 'Demo Juan S. Dela Cruz', date_hired: '2019-02-01', date_separated: null };
const history = [
  { employee_id: 'e1', site_id: 'a1', start_date: '2026-01-01', end_date: '2026-03-31', duty_hours: 12, shift_start: '06:00:00' },
  { employee_id: 'e1', site_id: 'a2', start_date: '2026-04-01', end_date: '2026-10-31', duty_hours: 12, shift_start: '18:00:00' },
  { employee_id: 'e1', site_id: 'a3', start_date: '2026-11-01', end_date: null, duty_hours: 12, shift_start: '06:00:00' },
];

test('13th month: pro-rated at each post, then added up (the DEMO-0001 example)', () => {
  const [row] = thirteenthMonth(2026, [juan], history, posts, [rule()], rates);
  assert.deepEqual(row.pieces.map((p) => [p.post, p.from, p.to, p.rate, p.months, p.basic, p.share]), [
    ['Area1', '2026-01-01', '2026-03-31', 100, 3, 62400, 5200],
    ['Area2', '2026-04-01', '2026-10-31', 90, 7, 131040, 10920],
    ['Area3', '2026-11-01', '2026-12-31', 150, 2, 62400, 5200],
  ]);
  assert.equal(row.amount, 21320);
  assert.deepEqual(row.problems, []);
});

test('13th month: a rate change, a separation, a missing rate and earlier years', () => {
  const r2 = [...rates, { site_id: 'a2', client_id: null, effective_from: '2026-07-01', hourly_rate: 95 }];
  const [row] = thirteenthMonth(2026, [juan], history, posts, [rule()], r2);
  assert.deepEqual(row.pieces.map((p) => [p.post, p.from, p.to, p.rate]).slice(1, 3), [['Area2', '2026-04-01', '2026-06-30', 90], ['Area2', '2026-07-01', '2026-10-31', 95]]);
  const [left] = thirteenthMonth(2026, [{ ...juan, date_separated: '2026-02-15' }], history, posts, [rule()], rates);
  assert.equal(left.pieces.length, 1);
  assert.equal(left.pieces[0].to, '2026-02-15');
  const [noRate] = thirteenthMonth(2026, [juan], history, posts, [rule()], rates.filter((r) => r.site_id !== 'a3'));
  assert.match(noRate.problems[0], /Area3 has no hourly rate on 2026-11-01/);
  assert.equal(thirteenthMonth(2025, [juan], history, posts, [rule()], rates).length, 0, 'no assignment in 2025');
  const clientRate = [{ site_id: null, client_id: 'c1', effective_from: '2026-01-01', hourly_rate: 80 }];
  assert.equal(rateBook(clientRate).on(posts[0], '2026-05-01'), 80, 'a post without its own rate uses its client\'s');
});

test('rule for a post: its own, its client default, the agency default', () => {
  const agency = rule({ id: 'std', client_id: null, name: 'Standard' });
  const client = rule({ id: 'acme', client_id: 'c1' });
  const special = rule({ id: 'night', client_id: 'c1', is_default: false });
  assert.equal(ruleFor({ ...posts[0], pay_rule_id: 'night' }, [agency, client, special]).id, 'night');
  assert.equal(ruleFor(posts[0], [agency, client, special]).id, 'acme');
  assert.equal(ruleFor({ ...posts[0], client_id: 'other' }, [agency, client]).id, 'std');
});

test('a cutoff: the schedule, the sheet read back, and pay with night differential', () => {
  const sheet = scheduleSheet({ start: '2026-11-01', end: '2026-11-15' }, [juan], history, posts, [rule()]);
  assert.deepEqual(sheet.map((r) => [r.employee_no, r.post, r.from, r.to, r.days, r.duty_hours, r.shift_start]), [['DEMO-0001', 'Area3', '2026-11-01', '2026-11-15', 13, 12, '06:00']]);
  const csv = toCsv(sheet.map((r) => ({ ...r, shift_start: '18:00' })));
  assert.match(csv.split('\n')[0], /employee_no,name,post_code,post,site_id,from,to,days,duty_hours,shift_start/);
  const back = readSheet([{ 'Employee number': 'demo-0001', Post: 'Area3', From: '2026-11-01', To: '2026-11-15', Days: '13', 'Duty hours': '12', 'Shift start': '18:00' }], { start: '2026-11-01', end: '2026-11-15' });
  assert.deepEqual(back.errors, []);
  const [pay] = computePay(back.rows, [juan], posts, [rule({ formulas: [...STANDARD, { code: 'cola', label: 'COLA', formula: 'days * 25' }, { code: 'insurance', label: 'Insurance', formula: '50', kind: 'deduction' }] })], rates);
  assert.deepEqual(pay.problems, []);
  assert.deepEqual(pay.lines.map((l) => [l.code, l.amount]), [['basic', 15600], ['overtime', 9750], ['night_diff', 1560], ['cola', 325], ['insurance', 50]]);
  const row = toPayrollRow(pay);
  assert.equal(row.basic_pay, 15600);
  assert.equal(row.overtime_pay, 9750);
  assert.equal(row.night_diff_pay, 1560);
  assert.equal(row.night_diff_hours, 104);
  assert.equal(row['earning: COLA'], 325);
  assert.equal(row['deduction: Insurance'], 50);
  assert.match(row.remarks, /Area3: 13 duties of 12 hours at ₱150.00 an hour/);
});

test('the attendance sheet: mistakes are listed by line', () => {
  const p = { start: '2026-11-01', end: '2026-11-15' };
  const { rows, errors } = readSheet([
    { employee_no: 'G-1', post: 'Area1', days: 'x' },
    { employee_no: 'G-2', post: 'Area1', days: '40', duty_hours: '24' },
    { employee_no: 'G-3', post: 'Area1', days: '5', duty_hours: '10' },
    { employee_no: 'G-4', post: '', days: '5' },
    { employee_no: 'G-5', post: 'Area1', days: '5', from: '11/01/2026' },
    { employee_no: '', post: 'Area1', days: '5' },
    { employee_no: 'G-6', post: 'Area1', days: '5' },
  ], p);
  assert.deepEqual(errors.map((e) => e.row), [2, 3, 4, 5, 6]);
  assert.deepEqual(rows.map((r) => [r.employee_no, r.from, r.to, r.duty_hours]), [['G-6', '2026-11-01', '2026-11-15', 12]]);
  const [unknown] = computePay([{ employee_no: 'NOPE', post: 'Area1', from: p.start, to: p.end, days: 5, duty_hours: 12, shift_start: '06:00' }], [juan], posts, [rule()], rates);
  assert.match(unknown.problems[0], /No employee has the number NOPE/);
});

test('CSV cells are quoted, and text that looks like a formula stays text', () => {
  const csv = toCsv([{ a: 'Dela Cruz, Juan', b: 'say "hi"', c: '=HYPERLINK("x")', d: -5 }]);
  assert.equal(csv, 'a,b,c,d\n"Dela Cruz, Juan","say ""hi""","\'=HYPERLINK(""x"")",-5\n');
});

test('shift choices for 8, 12 and 24-hour duties', () => {
  assert.deepEqual(shiftSlots(12, '06:00:00').map((x) => [x.label, x.night]), [['6:00 AM to 6:00 PM', false], ['6:00 PM to 6:00 AM', true]]);
  assert.deepEqual(shiftSlots(8, '06:00').map((x) => [x.start, x.night]), [['06:00', false], ['14:00', false], ['22:00', true]]);
  assert.deepEqual(shiftSlots(24, '07:00').map((x) => [x.label, x.night]), [['24 hours from 7:00 AM', true]]);
  assert.equal(timeLabel('00:00'), '12:00 AM');
  assert.equal(timeLabel('12:30'), '12:30 PM');
});
