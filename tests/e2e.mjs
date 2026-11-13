/**
 * Portal end-to-end check in Chromium, against a mocked Supabase API:  npm run test:e2e
 *
 * It builds the portal pointed at https://mock.supabase.test, serves it, signs in and works through
 * every main screen. The mock answers like Supabase; every request the portal makes is recorded and
 * then checked against the real schema (tests/schema-snapshot.json, exported from a database where
 * supabase/schema.sql ran): each table, view, column, embedded relation, filter, function and
 * argument must exist. The database rules themselves are tested by supabase/tests/run-tests.sh.
 *
 * Refresh the snapshot after changing schema.sql: see the comment at the end of this file.
 */
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RUN = fileURLToPath(new URL('./.run/', import.meta.url));
const MOCK = 'https://mock.supabase.test';
const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(RUN, { recursive: true });
const schema = JSON.parse(readFileSync(new URL('./schema-snapshot.json', import.meta.url), 'utf8'));

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) passed++;
  else failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${!ok && detail ? ` (${detail})` : ''}`);
};

// ------------------------------------------------------------------ build and serve with the mock address
execFileSync('npx', ['vite', 'build', '--outDir', `${RUN}dist`, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: ROOT, stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: 'eyJmock.anon.key', VITE_WEBSITE_URL: 'https://bannuar.example' },
});
const server = spawn('npx', ['vite', 'preview', '--outDir', `${RUN}dist`, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 250));
}

// ------------------------------------------------------------------ fixtures
const now = new Date().toISOString();
// one selfie in Amazon S3 (the files function signs it), one from before S3 (Supabase Storage)
const S3_SELFIE = 'employees/G-002/attendance/2026/11/2026-11-12_0226_time-in_0a1b2c3d4e.jpg';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, email: 'ana@bannuar.test' })}.sig`;
const user = { id: 'u-admin', aud: 'authenticated', role: 'authenticated', email: 'ana@bannuar.test', email_confirmed_at: now, user_metadata: {}, app_metadata: { provider: 'email' }, created_at: now };
const session = () => ({ access_token: jwt('u-admin'), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-1', user });
const emp = (id, no, first, last, extra = {}) => ({ id, employee_no: no, first_name: first, middle_name: null, last_name: last, suffix: null, position: 'Security Guard', status: 'active', date_hired: '2023-01-10', floating_since: null, user_id: null, site_id: 's1', is_field: true, birthdate: '1992-02-02', sex: 'female', civil_status: 'single', mobile_no: '09171110002', email: null, present_address: 'Bauang, La Union', provincial_address: null, employment_type: 'regular', date_regularized: null, date_separated: null, separation_reason: null, area_id: 'a1', emergency_contact_name: null, emergency_contact_relation: null, emergency_contact_phone: null, notes: null, created_at: now, updated_at: now, site: { id: 's1', name: 'Post A · Main Gate', city: 'San Fernando' }, area: { id: 'a1', name: 'La Union' }, ...extra });
const E = {
  e1: emp('e1', 'G-001', 'Dante', 'Cruz', { position: 'Detachment Commander', sex: 'male', user_id: 'u-dc' }),
  e2: emp('e2', 'G-002', 'Bea', 'Lim'),
  e3: emp('e3', 'G-003', 'Carlo', 'Diaz', { status: 'floating', site_id: null, site: null, floating_since: '2026-05-01', sex: 'male' }),
};
const empMini = (e) => ({ id: e.id, employee_no: e.employee_no, first_name: e.first_name, middle_name: null, last_name: e.last_name, suffix: null, site_id: e.site_id });
const T = {
  areas: [{ id: 'a1', name: 'La Union', region: 'Region I', office_address: null, is_active: true }],
  sites: [
    { id: 's1', name: 'Post A · Main Gate', code: 'PA', city: 'San Fernando', area_id: 'a1', is_active: true, client_id: 'c1', address: null, province: 'La Union', region: 'Region I', guards_required: 3, notes: null, latitude: null, longitude: null, geofence_radius_m: 150, pay_rule_id: null, duty_hours: 12, first_shift_start: '06:00:00', client: { name: 'Acme Mart' }, area: { name: 'La Union' } },
    { id: 's2', name: 'Post B · Warehouse', code: 'PB', city: 'San Juan', area_id: 'a1', is_active: true, client_id: 'c1', address: null, province: 'La Union', region: 'Region I', guards_required: 2, notes: null, latitude: null, longitude: null, geofence_radius_m: 150, pay_rule_id: null, duty_hours: 12, first_shift_start: '06:00:00', client: { name: 'Acme Mart' }, area: { name: 'La Union' } },
    { id: 's3', name: 'Post C · Lobby', code: 'PC', city: 'San Juan', area_id: 'a1', is_active: true, client_id: 'c1', address: null, province: 'La Union', region: 'Region I', guards_required: 2, notes: null, latitude: null, longitude: null, geofence_radius_m: 150, pay_rule_id: null, duty_hours: 12, first_shift_start: '06:00:00', client: { name: 'Acme Mart' }, area: { name: 'La Union' } },
  ],
  pay_rules: [
    { id: 'pr-std', client_id: null, name: 'Standard', is_default: true, regular_hours: 8, night_diff: 'last_shift', night_diff_hours: 8, days_per_month: 26, notes: null, is_active: true, formulas: [
      { code: 'basic', label: 'Basic pay', formula: 'rate * regular_hours', kind: 'earning', thirteenth: true },
      { code: 'overtime', label: 'Overtime pay', formula: 'rate * 125% * overtime_hours', kind: 'earning', thirteenth: false },
      { code: 'night_diff', label: 'Night differential', formula: 'rate * 10% * night_hours', kind: 'earning', thirteenth: false }] },
    { id: 'pr-acme', client_id: 'c1', name: 'Acme Mart standard', is_default: true, regular_hours: 8, night_diff: 'last_shift', night_diff_hours: 8, days_per_month: 26, notes: null, is_active: true, formulas: [
      { code: 'basic', label: 'Basic pay', formula: 'rate * regular_hours', kind: 'earning', thirteenth: true },
      { code: 'overtime', label: 'Overtime pay', formula: 'rate * 125% * overtime_hours', kind: 'earning', thirteenth: false },
      { code: 'night_diff', label: 'Night differential', formula: 'rate * 10% * night_hours', kind: 'earning', thirteenth: false },
      { code: 'allowances', label: 'Allowance', formula: 'days * 25', kind: 'earning', thirteenth: false }] },
  ],
  pay_rates: [
    { id: 'rt1', site_id: 's1', client_id: null, effective_from: '2026-01-01', hourly_rate: 100, note: null },
    { id: 'rt2', site_id: 's2', client_id: null, effective_from: '2026-01-01', hourly_rate: 90, note: null },
    { id: 'rt3', site_id: 's3', client_id: null, effective_from: '2026-01-01', hourly_rate: 150, note: null },
    { id: 'rt4', site_id: null, client_id: 'c1', effective_from: '2026-01-01', hourly_rate: 80, note: '2026 contract' },
  ],
  employee_assignments: [
    { id: 'as1', employee_id: 'e1', site_id: 's1', start_date: '2026-01-01', end_date: '2026-03-31', duty_hours: 12, shift_start: '06:00:00', note: null, site: { name: 'Post A · Main Gate' } },
    { id: 'as2', employee_id: 'e1', site_id: 's2', start_date: '2026-04-01', end_date: '2026-10-31', duty_hours: 12, shift_start: '06:00:00', note: null, site: { name: 'Post B · Warehouse' } },
    { id: 'as3', employee_id: 'e1', site_id: 's3', start_date: '2026-11-01', end_date: null, duty_hours: 12, shift_start: '06:00:00', note: null, site: { name: 'Post C · Lobby' } },
    { id: 'as4', employee_id: 'e2', site_id: 's1', start_date: '2023-01-10', end_date: null, duty_hours: 12, shift_start: '18:00:00', note: null, site: { name: 'Post A · Main Gate' } },
  ],
  site_staffing: [{ id: 's1', name: 'Post A · Main Gate', code: 'PA', client_id: 'c1', client_name: 'Acme Mart', area_id: 'a1', area_name: 'La Union', city: 'San Fernando', province: 'La Union', guards_required: 3, is_active: true, guards_assigned: 2, supervisors: 1 }],
  site_supervisors: [{ employee_id: 'e1', role: 'detachment_commander' }],
  clients: [{ id: 'c1', name: 'Acme Mart', industry: 'Retail', contact_person: 'Lorna', contact_phone: '0917 555 0101', contact_email: null, address: null, contract_start: '2026-01-01', contract_end: null, status: 'active', notes: null }],
  employees: Object.values(E),
  document_types: [
    { id: 'dt1', code: 'SECURITY_LICENSE', name: 'Security guard license (LESP)', category: 'license', has_expiry: true, required_for_deployment: true, remind_days_before: 60, visible_to_employee: true, employee_can_upload: true, sort_order: 10, is_active: true, storage_folder: 'lesp' },
    { id: 'dt2', code: 'NBI_CLEARANCE', name: 'NBI clearance', category: 'clearance', has_expiry: true, required_for_deployment: true, remind_days_before: 30, visible_to_employee: true, employee_can_upload: true, sort_order: 20, is_active: true, storage_folder: 'work-requirements' },
  ],
  employee_documents: [{ id: 'd1', employee_id: 'e2', document_type_id: 'dt1', document_no: 'LIC-1', issued_on: '2025-01-01', expires_on: '2026-11-28', file_path: 'e2/uploads/lic.jpg', status: 'pending_review', review_note: null, created_at: now, type: { name: 'Security guard license (LESP)', has_expiry: true } }],
  leave_types: [{ id: 'lt1', code: 'SIL', name: 'Service incentive leave', description: 'Five days a year.', days_per_year: 5, max_days_per_request: null, is_paid: true, requires_attachment: false, applies_to_sex: null, min_service_months: 12, is_active: true, sort_order: 10 }],
  leave_balances: [{ employee_id: 'e2', leave_type_id: 'lt1', code: 'SIL', name: 'Service incentive leave', year: 2026, credits: 5, used: 2, pending: 1 }],
  leave_requests: [{ id: 'lr1', employee_id: 'e2', leave_type_id: 'lt1', start_date: '2026-11-20', end_date: '2026-11-21', days: 2, reason: 'Family', status: 'pending_hr', site_id: 's1', created_at: now, employee: empMini(E.e2), type: { name: 'Service incentive leave' }, reliever: null, site: { name: 'Post A · Main Gate' } }],
  coe_requests: [{ id: 'cr1', employee_id: 'e2', purpose: 'bank_loan', purpose_details: 'Housing loan', include_compensation: true, status: 'pending', due_at: new Date(Date.now() - 86400000).toISOString(), created_at: now, employee: empMini(E.e2), certificate: null }],
  profile_change_requests: [{ id: 'pc1', employee_id: 'e2', changes: { mobile_no: '09179998888' }, reason: 'New SIM', status: 'pending', created_at: now, employee: { ...empMini(E.e2), mobile_no: '09171110002' } }],
  payroll_concerns: [{ id: 'pq1', employee_id: 'e2', category: 'overtime', description: 'Missing 4 hours OT', status: 'open', resolution: null, created_at: now, employee: empMini(E.e2), payslip: { net_pay: 9530, period: { label: 'Oct 16 to 31, 2026' } } }],
  announcements: [{ id: 'an1', title: 'Fire drill Friday', body: 'Every post joins the drill.', category: 'advisory', priority: 'important', audience: 'all', area_ids: [], site_ids: [], requires_ack: true, pinned: false, status: 'published', published_at: now, expires_at: null, created_at: now }],
  payroll_periods: [{ id: 'p1', label: 'Nov 1 to 15, 2026', period_start: '2026-11-01', period_end: '2026-11-15', pay_date: '2026-11-20', status: 'draft', published_at: null, created_at: now, payslips: [{ count: 2 }] }],
  payslips: [
    { id: 'ps1', payroll_period_id: 'p1', employee_id: 'e2', site_name: 'Post A', days_worked: 13, hours_worked: 104, overtime_hours: 52, night_diff_hours: 56, basic_pay: 7020, overtime_pay: 3510, night_diff_pay: 378, holiday_pay: 540, allowances: 0, other_earnings: 0, gross_pay: 11448, sss: 450, philhealth: 250, pagibig: 100, withholding_tax: 0, loans: 0, other_deductions: 200, total_deductions: 1000, net_pay: 10448, deductions_detail: [{ label: 'Uniform', amount: 200 }], earnings_detail: [], created_at: now, employee: empMini(E.e2), period: { label: 'Nov 1 to 15, 2026', status: 'draft', pay_date: '2026-11-20', period_end: '2026-11-15' } },
  ],
  employee_compensation: [{ employee_id: 'e2', pay_basis: 'daily', daily_rate: 540, monthly_rate: null, allowance_note: null, effective_on: '2026-01-01', updated_at: now }],
  certificates: [],
  job_applications: [{ id: 'ja1', job_opening_id: null, first_name: 'Rico', middle_name: null, last_name: 'Abad', birthdate: '1999-03-03', sex: 'male', mobile_no: '09182223333', email: null, city: 'Agoo', province: 'La Union', education: 'senior_high', has_license: true, license_no: 'LIC-9', license_expires_on: '2027-01-01', years_experience: 2, previous_agency: null, preferred_location: null, message: null, resume_path: 'incoming/x-resume.pdf', privacy_consent: true, status: 'new', staff_notes: null, employee_id: null, created_at: now, opening: null }],
  job_openings: [{ id: 'jo1', title: 'Security Guard', slug: 'security-guard-x1', location: 'San Fernando, La Union', area_id: 'a1', employment_type: 'full_time', summary: 'Day and night shifts.', description: null, qualifications: ['Licensed'], requirements: ['NBI clearance'], slots: 3, status: 'open', closes_on: null, created_at: now }],
  inquiries: [{ id: 'iq1', company: 'Acme Mart', contact_name: 'Lorna', position: 'Admin', email: 'lorna@acme.ph', phone: '0917 555 0101', site_address: 'San Fernando', site_type: 'commercial', guards_needed: 4, coverage: '24h', start_on: null, message: 'Need guards', status: 'new', assigned_to: null, staff_notes: null, created_at: now }],
  staff_invitations: [],
  audit_log: [{ id: 1, occurred_at: now, actor_id: 'u-admin', action: 'UPDATE', table_name: 'employees', record_id: 'e2', old_data: { mobile_no: 'x' }, new_data: { mobile_no: 'y' }, note: null }],
  profiles: [{ id: 'u-admin', full_name: 'Ana Admin', email: 'ana@bannuar.test' }],
  notifications: [{ id: 'n1', title: 'New COE request', body: 'Bea Lim · due Nov 11', kind: 'coe_request', read_at: null, created_at: now }],
  document_alerts: [{ id: 'd1', employee_id: 'e2', employee_no: 'G-002', first_name: 'Bea', last_name: 'Lim', site_id: 's1', site_name: 'Post A', type_code: 'SECURITY_LICENSE', type_name: 'Security guard license (LESP)', document_no: 'LIC-1', expires_on: '2026-11-28', days_left: 20, state: 'expiring' }],
  attendance_logs: [
    { id: 'at1', employee_id: 'e2', site_id: 's1', kind: 'time_in', logged_at: now, photo_path: S3_SELFIE, latitude: 14.5552, longitude: 121.0244, accuracy_m: 12, distance_m: 56, radius_m: 150, location_check: 'at_post', mock_location: false, source: 'self', manual_reason: null, logger: null, employee: empMini(E.e2), site: { id: 's1', name: 'Post A · Main Gate' } },
    { id: 'at2', employee_id: 'e1', site_id: 's1', kind: 'time_in', logged_at: now, photo_path: 'e1/selfie-2.jpg', latitude: 14.5647, longitude: 121.0244, accuracy_m: 20, distance_m: 1112, radius_m: 150, location_check: 'away', mock_location: true, source: 'self', manual_reason: null, logger: null, employee: empMini(E.e1), site: { id: 's1', name: 'Post A · Main Gate' } },
    { id: 'at3', employee_id: 'e3', site_id: null, kind: 'time_out', logged_at: now, photo_path: null, latitude: null, longitude: null, accuracy_m: null, distance_m: null, radius_m: null, location_check: 'manual', mock_location: null, source: 'manual', manual_reason: 'Phone lost; from the post logbook', logger: null, employee: empMini(E.e3), site: null },
  ],
  compliance_gaps: [{ employee_id: 'e3', employee_no: 'G-003', first_name: 'Carlo', last_name: 'Diaz', status: 'floating', site_id: null, site_name: null, document_type_id: 'dt2', type_code: 'NBI_CLEARANCE', type_name: 'NBI clearance', last_expiry: null }],
  stored_files: [
    { id: 'sf1', folder: 'lesp', status: 'stored' }, { id: 'sf2', folder: 'attendance', status: 'stored' },
    { id: 'sf3', folder: 'attendance', status: 'stored' }, { id: 'sf4', folder: 'leave', status: 'pending' },
  ],
};
const access = { user_id: 'u-admin', roles: ['super_admin'], full_name: 'Ana Admin', email: 'ana@bannuar.test', must_change_password: false, employee: null };
const dashboard = { employees_by_status: { active: 2, floating: 1 }, employees_current: 3, sites_active: 1, guards_required: 3, guards_deployed: 2, sites_short: 1, floating: 1, floating_over_150_days: 1, leave_pending_supervisor: 0, leave_pending_hr: 1, on_leave_today: 0, coe_pending: 1, coe_overdue: 1, profile_changes_pending: 1, payroll_concerns_open: 1, documents_expired: 0, documents_expiring: 1, compliance_gaps: 1, applications_new: 1, inquiries_new: 1, latest_period: { id: 'p1', label: 'Nov 1 to 15, 2026', status: 'draft', pay_date: '2026-11-20', payslips: 2 } };
const certificate = { id: 'cert1', certificate_no: 'COE-2026-000001', verification_code: 'K7QM-3XPD-8RTA', employee_id: 'e2', employee_name: 'Bea Lim', position: 'Security Guard', date_hired: '2023-01-10', date_separated: null, purpose: 'bank_loan', include_compensation: true, compensation_text: '₱540.00 a day', signatory_name: 'Hector HR', signatory_title: 'HR Manager', issued_at: now, file_path: null };
const RPC = {
  my_access: () => access,
  portal_dashboard: () => dashboard,
  get_government_ids: () => [{ sss_no: '02-2345678-9', philhealth_no: null, pagibig_no: null, tin: '123-456-789-000', updated_at: now }],
  save_government_ids: () => null,
  decide_leave_request: () => ({ ...T.leave_requests[0], status: 'approved' }),
  issue_certificate: () => certificate,
  issue_certificate_for: () => certificate,
  attach_certificate_file: () => null,
  reject_coe_request: () => null,
  decide_profile_change: () => null,
  import_payslips: () => ({ inserted: 1, updated: 1, errors: [{ row: 3, employee_no: 'NOPE', message: 'No employee with this number' }], warnings: [] }),
  publish_payroll_period: () => 2,
  unpublish_payroll_period: () => null,
  invite_staff: () => 'K7QM-3XPD',
  check_staff_invitation: (b) => b.p_code === 'K7QM-3XPD',
  announcement_stats: () => [{ audience_count: 3, read_count: 1, acknowledged_count: 1 }],
  list_users: () => [{ user_id: 'u-admin', email: 'ana@bannuar.test', full_name: 'Ana Admin', roles: ['super_admin'], employee_id: null, last_sign_in_at: now, created_at: now }],
  set_user_roles: () => null,
  admin_reset_password: () => null,
  deploy_employees: () => 1,
  hire_applicant: () => 'e3',
  add_manual_attendance: () => ({ id: 'at9', kind: 'time_in', logged_at: now, location_check: 'manual', source: 'manual' }),
  mark_password_changed: () => null,
  revoke_certificate: () => null,
  set_site_pay_rule: () => null,
};

// ------------------------------------------------------------------ the mock API
const requests = [];
const stored = new Map();
const uploads = []; // what the portal sent the files function
function filterRows(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'].includes(k) || k.includes('.')) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => r[k] !== null && r[k] !== undefined && String(r[k]) !== val); // SQL: null <> x is not true
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (op === 'not' && val === 'is.null') out = out.filter((r) => r[k] !== null && r[k] !== undefined);
  }
  return out;
}
async function api(route) {
  const req = route.request();
  const url = new URL(req.url());
  const path = url.pathname;
  const method = req.method();
  const body = req.postData() ? (() => { try { return JSON.parse(req.postData()); } catch { return req.postData(); } })() : null;
  requests.push({ method, path, url: url.toString(), body, headers: req.headers() });
  // like Supabase, let the page read the row count (Content-Range) across origins
  const json = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'Content-Range', ...headers }, body: data === undefined ? '' : JSON.stringify(data) });

  if (path === '/auth/v1/token') {
    if (url.searchParams.get('grant_type') === 'password' && body?.password !== 'right-password') return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return json(200, session());
  }
  if (path === '/auth/v1/signup') return json(200, session());
  if (path === '/auth/v1/user') return json(200, user);
  if (path === '/auth/v1/logout') return route.fulfill({ status: 204 });
  if (path === '/auth/v1/recover') return json(200, {});

  // the files Edge Function (Amazon S3): uploads, five-minute links, the storage check
  if (path === '/functions/v1/files') {
    if ((req.headers()['content-type'] ?? '').startsWith('multipart/form-data')) {
      const raw = req.postDataBuffer();
      const text = raw.toString('latin1');
      const field = (n) => new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)`).exec(text)?.[1] ?? '';
      const purpose = field('purpose');
      const no = (E[field('employee_id')] ?? E.e2).employee_no;
      const dt = T.document_types.find((d) => d.id === field('document_type_id'));
      const folder = purpose === 'document' ? dt.storage_folder : purpose === 'certificate' ? 'certificates' : purpose;
      const name = purpose === 'certificate' ? `${certificate.certificate_no}.pdf` : `2026-11-12_${(dt?.code ?? purpose).toLowerCase().replace(/_/g, '-')}_mock${requests.length}.pdf`;
      const key = `employees/${no}/${folder}/${name}`;
      const start = text.indexOf('\r\n\r\n', text.indexOf('name="file"')) + 4;
      stored.set(`s3/${key}`, raw.subarray(start, text.lastIndexOf('\r\n--')));
      uploads.push({ purpose, employee_id: field('employee_id'), document_type_id: field('document_type_id'), certificate_id: field('certificate_id'), key });
      return json(200, { id: `sf-${requests.length}`, key, name, content_type: 'application/pdf', size_bytes: start > 3 ? text.lastIndexOf('\r\n--') - start : 0 });
    }
    if (body?.action === 'sign') return json(200, { urls: Object.fromEntries(body.keys.map((k) => [k, `${MOCK}/s3-mock/${k}?X-Amz-Expires=300&download=${body.download ? 1 : 0}`])), expires_in: 300 });
    if (body?.action === 'check') return json(200, { ok: true, bucket: 'bannuar-hr-files', region: 'ap-southeast-1' });
    return json(400, { code: 'invalid_input', message: 'Something is missing from the request. Try again.' });
  }
  // the payslip-pdf Edge Function: a PDF made on request, never stored
  if (path === '/functions/v1/payslip-pdf') {
    return route.fulfill({
      status: 200, contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="payslip-G-002-2026-11-01-to-2026-11-15.pdf"', 'access-control-expose-headers': 'content-disposition' },
      body: Buffer.from('%PDF-1.7\n% mock payslip\n%%EOF\n'),
    });
  }
  // a five-minute S3 link being opened (the mock's stand-in for the bucket)
  if (path.startsWith('/s3-mock/')) {
    const key = decodeURIComponent(path.slice('/s3-mock/'.length));
    if (/\.(jpe?g|png|webp)$/.test(key)) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    return route.fulfill({ status: 200, contentType: 'application/pdf', body: stored.get(`s3/${key}`) ?? Buffer.from('%PDF-1.7\n%%EOF\n') });
  }

  if (path.startsWith('/storage/v1/object/sign/')) {
    // a signed link being opened (the selfie thumbnails): a 1x1 picture
    if (method === 'GET') return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    // createSignedUrls: one link for each path, relative to /storage/v1
    if (Array.isArray(body?.paths)) return json(200, body.paths.map((p) => ({ path: p, signedURL: `/object/sign/${path.slice(24)}/${p}?token=t`, error: null })));
    return json(200, { signedURL: `/storage/v1/object/sign/${path.slice(24)}?token=t` });
  }
  if (path.startsWith('/storage/v1/object/')) {
    const key = decodeURIComponent(path.slice('/storage/v1/object/'.length));
    if (method === 'POST' || method === 'PUT') {
      stored.set(key, req.postDataBuffer());
      return json(200, { Key: key, Id: 'x' });
    }
    const buf = stored.get(key) ?? stored.get(key.replace(/^authenticated\//, ''));
    return buf ? route.fulfill({ status: 200, contentType: 'application/pdf', body: buf }) : json(404, { message: 'Object not found' });
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    const name = path.slice('/rest/v1/rpc/'.length);
    const h = RPC[name];
    return h ? json(200, h(body ?? {})) : json(404, { message: `no mock for rpc ${name}` });
  }
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    const single = (req.headers().accept ?? '').includes('vnd.pgrst.object');
    if (method === 'GET' || method === 'HEAD') {
      const rows = filterRows(T[table] ?? [], url);
      if (single) return rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return json(200, rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` });
    }
    if (method === 'POST') {
      const row = Array.isArray(body) ? body[0] : body;
      const out = { id: `new-${requests.length}`, ...row };
      return single ? json(201, out) : json(201, (req.headers().prefer ?? '').includes('return=representation') ? [out] : undefined);
    }
    if (method === 'PATCH') return single ? json(200, { id: url.searchParams.get('id')?.slice(3), ...body }) : json(204);
    if (method === 'DELETE') return json(204);
  }
  return json(404, { message: 'no mock' });
}

// ------------------------------------------------------------------ run
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
// the built-in project is Bannuar's live one, and its files are in Amazon S3: cut and record anything
// that tries to reach either
const realHits = [];
const blockReal = async (ctx) => {
  const cut = (route) => { realHits.push(route.request().url()); return route.abort('blockedbyclient'); };
  await ctx.route(/^https:\/\/[a-z0-9-]+\.supabase\.co\//, cut);
  await ctx.route(/^https:\/\/([a-z0-9.-]+\.)?amazonaws\.com\//, cut);
};
await blockReal(context);
await context.route(`${MOCK}/**`, api);
const page = await context.newPage();
const consoleErrors = [];
// 400 is the deliberate wrong-password sign-in; 404/406 are answers the mock gives on purpose
page.on('console', (m) => { if (m.type() === 'error' && !/websocket|realtime|ERR_NAME_NOT_RESOLVED|status of 40[046]/i.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Typo in the name' : undefined));
const rpcCalls = (name) => requests.filter((r) => r.path === `/rest/v1/rpc/${name}`);

console.log('Sign-in');
await page.goto(`${BASE}/employees`);
await page.waitForURL(/sign-in/);
check('signed out: a protected page goes to sign-in', page.url().includes('/sign-in?next=%2Femployees'));
await page.getByLabel('Email').fill('ana@bannuar.test');
await page.getByLabel('Password').fill('wrong');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByRole('alert').waitFor();
check('wrong password: a plain message', /email or password is wrong/i.test(await page.getByRole('alert').innerText()));
await page.getByLabel('Password').fill('right-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(`${BASE}/employees`);
check('signed in: back to the page asked for', page.url() === `${BASE}/employees`);

console.log('Screens');
const screens = [
  ['/', 'Good'], ['/employees', 'Employees'], ['/employees/e2', 'Bea Lim'], ['/posts', 'Posts and clients'], ['/posts/s1', 'Post A'],
  ['/requests', 'Requests'], ['/attendance', 'Attendance'], ['/announcements', 'Announcements'], ['/payroll', 'Payroll'], ['/payroll/p1', 'Nov 1 to 15, 2026'],
  ['/recruitment', 'Recruitment'], ['/inquiries', 'Proposal requests'], ['/compliance', 'Licenses and documents'], ['/users', 'Users and roles'],
  ['/audit', 'Audit log'], ['/settings', 'Settings'], ['/account', 'Change your password'], ['/nowhere', 'This page is not on the roster'],
  ['/payroll/13th-month', '13th month pay'],
];
for (const [path, heading] of screens) {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle');
  const h = await page.locator('h1, .state b').first().innerText().catch(() => '');
  check(`${path} shows "${heading}"`, h.includes(heading), h);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check(`${path} no sideways scroll`, !overflow);
  mkdirSync(`${ROOT}tests/shots`, { recursive: true });
  await page.screenshot({ path: `${ROOT}tests/shots/${path.replace(/\//g, '_') || 'home'}.png` });
}
await page.goto(`${BASE}/`);
await page.waitForLoadState('networkidle');
check('dashboard: overdue COE flagged', (await page.getByText('1 past the three-day limit').count()) === 1);
await page.getByText(/need a look: away from the post/).waitFor();
const todayTile = await page.locator('.tile', { hasText: 'Time in and out today' }).innerText();
const todayReqs = requests.filter((r) => r.method === 'HEAD' && r.path === '/rest/v1/attendance_logs');
check('dashboard: today\'s time in and out is counted by the database, with those needing a look', /\b3\b/.test(todayTile) && todayReqs.length >= 2 && todayReqs.every((r) => /logged_at=gte\./.test(r.url) && /logged_at=lt\./.test(r.url)) && todayReqs.some((r) => /or=/.test(r.url)), todayTile.replace(/\s+/g, ' '));
const meterRow = await page.locator('.meters li').first().innerText();
check('dashboard: each post shows its guards against the number needed, short posts first', /Post A · Main Gate/.test(meterRow) && /2 of 3/.test(meterRow) && /1 short/.test(meterRow), meterRow.replace(/\s+/g, ' '));
check('dashboard: the roll by status adds up to the employees on the roll', /Active\s*2/.test(await page.locator('.legend').innerText()) && /Floating\s*1/.test(await page.locator('.legend').innerText()));
check('sidebar: waiting counts shown', (await page.locator('.nav-count').count()) >= 3);

console.log('Employees');
await page.goto(`${BASE}/employees`);
await page.getByRole('button', { name: 'Add an employee' }).click();
await page.getByRole('button', { name: 'Add employee' }).click();
check('add employee: empty form is refused', (await page.locator('.dialog .field-error').count()) >= 3);
await page.screenshot({ path: `${ROOT}tests/shots/dialog.png` });
const dialog = page.locator('dialog[open]');
await dialog.getByLabel('Employee number').fill('G-010');
await dialog.getByLabel('First name').fill('Nora');
await dialog.getByLabel('Last name', { exact: true }).fill('Santos');
await dialog.getByLabel('Mobile number').fill('0917 123');
await page.getByRole('button', { name: 'Add employee' }).click();
check('add employee: a short mobile is caught', /0917 123 4567/.test(await dialog.innerText()));
await dialog.getByLabel('Mobile number').fill('0917 123 4567');
await page.getByRole('button', { name: 'Add employee' }).click();
await page.waitForURL(/\/employees\/new-/);
const ins = requests.find((r) => r.method === 'POST' && r.path === '/rest/v1/employees');
check('add employee: the row is sent', ins?.body.employee_no === 'G-010' && ins?.body.first_name === 'Nora' && ins?.body.is_field === true, JSON.stringify(ins?.body));

await page.goto(`${BASE}/employees/e2?tab=ids`);
await page.getByRole('button', { name: 'Show the numbers' }).click();
await page.getByText('02-2345678-9').waitFor();
check('government numbers: shown through the logged function', rpcCalls('get_government_ids').at(-1)?.body.p_employee_id === 'e2');
await page.goto(`${BASE}/employees/e2?tab=documents`);
await page.getByRole('button', { name: 'Verify' }).click();
await page.waitForTimeout(300);
const ver = requests.find((r) => r.method === 'PATCH' && r.path === '/rest/v1/employee_documents');
check('documents: verify an upload from the app', ver?.body.status === 'verified');
await page.getByRole('button', { name: 'Add a document' }).click();
const docDialog = page.locator('dialog[open]');
await docDialog.getByLabel('Kind of document').selectOption('dt2');
await docDialog.getByLabel('Expires').fill('2027-06-30');
await docDialog.getByLabel(/Scan or photo/).setInputFiles({ name: 'nbi.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% NBI clearance scan\n%%EOF\n') });
await docDialog.getByRole('button', { name: 'Add the document' }).click();
await page.getByText('Document added.').waitFor();
const docUp = uploads.at(-1);
check('documents: the scan goes to S3 through the files function, in the type\'s folder', docUp?.purpose === 'document' && docUp?.employee_id === 'e2' && docUp?.document_type_id === 'dt2' && docUp?.key.startsWith('employees/G-002/work-requirements/') && stored.get(`s3/${docUp?.key}`)?.subarray(0, 5).toString() === '%PDF-', JSON.stringify(docUp));
const docIns = requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/employee_documents').at(-1);
const docRow = Array.isArray(docIns?.body) ? docIns.body[0] : docIns?.body;
check('documents: the record points at the S3 key', docRow?.file_path === docUp?.key && docRow?.document_type_id === 'dt2', JSON.stringify(docRow));
check('documents: nothing goes to Supabase Storage any more', !requests.some((r) => r.method === 'POST' && r.path.startsWith('/storage/v1/object/employee-files')));
await page.goto(`${BASE}/employees/e2?tab=certificates`);
await page.getByRole('button', { name: 'Issue a certificate' }).click();
await page.getByLabel('Signed by').fill('Hector HR');
const dl = page.waitForEvent('download');
await page.getByRole('button', { name: 'Issue the certificate' }).click();
const file = await dl;
const pdf = readFileSync(await file.path());
check('walk-in COE: a PDF is made and downloaded', pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 5000, `${pdf.length} bytes`);
check('walk-in COE: issued through the database', rpcCalls('issue_certificate_for').length === 1);
const certUp = uploads.find((u) => u.purpose === 'certificate');
check('walk-in COE: the PDF goes to the employee\'s S3 certificates folder, its key recorded for the app', certUp?.certificate_id === 'cert1' && certUp?.key === 'employees/G-002/certificates/COE-2026-000001.pdf' && stored.get(`s3/${certUp?.key}`)?.subarray(0, 5).toString() === '%PDF-' && rpcCalls('attach_certificate_file')[0]?.body.p_path === certUp?.key, JSON.stringify(certUp));

console.log('Requests');
await page.goto(`${BASE}/requests?tab=leave`);
await page.getByRole('button', { name: 'Approve' }).click();
await page.getByRole('button', { name: 'Save the decision' }).click();
await page.waitForTimeout(300);
check('leave: HR approval goes to decide_leave_request', rpcCalls('decide_leave_request')[0]?.body.p_approve === true && rpcCalls('decide_leave_request')[0]?.body.p_request_id === 'lr1');
await page.goto(`${BASE}/requests?tab=coe`);
await page.getByRole('button', { name: 'Issue', exact: true }).waitFor();
check('COE: overdue request flagged', (await page.getByText('Overdue').count()) === 1);
await page.getByRole('button', { name: 'Issue', exact: true }).click();
check('COE: the employee asked for compensation', (await page.getByText('asked for the compensation').count()) === 1);
const dl2 = page.waitForEvent('download');
await page.getByRole('button', { name: 'Issue the certificate' }).click();
await dl2;
check('COE: issued for the request', rpcCalls('issue_certificate')[0]?.body.p_request_id === 'cr1' && rpcCalls('issue_certificate')[0]?.body.p_compensation_text === '₱540.00 a day', JSON.stringify(rpcCalls('issue_certificate')[0]?.body));
await page.goto(`${BASE}/requests?tab=changes`);
await page.getByRole('button', { name: 'Apply' }).click();
await page.waitForTimeout(300);
check('contact change: applied through the database', rpcCalls('decide_profile_change')[0]?.body.p_approve === true);
await page.goto(`${BASE}/requests?tab=concerns`);
await page.getByRole('button', { name: 'Answer' }).click();
await page.getByLabel('Status').selectOption('resolved');
await page.getByLabel('Answer to the employee').fill('Added to the next cutoff.');
await page.getByRole('button', { name: 'Save' }).click();
await page.waitForTimeout(300);
const pq = requests.find((r) => r.method === 'PATCH' && r.path === '/rest/v1/payroll_concerns');
check('payroll concern: answered', pq?.body.status === 'resolved' && pq?.body.resolution === 'Added to the next cutoff.');

console.log('Payroll');
await page.goto(`${BASE}/payroll/p1`);
await page.getByRole('button', { name: 'Import the payroll file' }).click();
const csv = `${RUN}payroll.csv`;
writeFileSync(csv, 'Emp No,Basic Pay,OT Pay,SSS,PHIC,HDMF,deduction: Cash advance,Net Pay,Mystery\nG-002,"7,020.00",3510,450,250,100,200,9530,x\nG-001,9000,0,450,250,100,,8200,y\nNOPE,1,0,0,0,0,,1,z\n');
await page.getByLabel('Payroll file (CSV)').setInputFiles(csv);
await page.getByText('3 rows found').waitFor();
check('import: unknown columns are named', /Mystery/.test(await page.locator('.callout.warn').innerText()));
await page.getByRole('button', { name: 'Import 3 payslips' }).click();
await page.getByText('1 rows were not imported').waitFor();
const imp = rpcCalls('import_payslips')[0]?.body;
check('import: headers mapped to the database columns', imp?.p_rows[0].employee_no === 'G-002' && imp?.p_rows[0].pagibig === '100' && imp?.p_rows[0].philhealth === '250' && imp?.p_rows[0]['deduction: Cash advance'] === '200' && !('Mystery' in imp.p_rows[0]), JSON.stringify(imp?.p_rows[0]));
check('import: the problem rows are listed', (await page.getByText('No employee with this number').count()) === 1);
await page.getByRole('button', { name: 'Done' }).click();
await page.getByRole('button', { name: 'Publish to employees' }).click();
await page.waitForTimeout(300);
check('payroll: publish goes through the database', rpcCalls('publish_payroll_period')[0]?.body.p_period_id === 'p1');
await page.getByRole('row', { name: /Bea Lim/ }).getByRole('button', { name: 'View' }).click();
const slipDialog = page.locator('dialog[open]');
await slipDialog.getByRole('button', { name: 'Download PDF' }).waitFor();
await page.screenshot({ path: `${ROOT}tests/shots/payslip-dialog.png` });
const dlSlip = page.waitForEvent('download');
await slipDialog.getByRole('button', { name: 'Download PDF' }).click();
const slipFile = await dlSlip;
const slipReq = requests.filter((r) => r.path === '/functions/v1/payslip-pdf').at(-1);
check('payslip PDF: made on request by the payslip-pdf function, for this payslip', slipReq?.body?.payslip_id === 'ps1' && slipFile.suggestedFilename() === 'payslip-G-002-2026-11-01-to-2026-11-15.pdf' && readFileSync(await slipFile.path()).subarray(0, 5).toString() === '%PDF-', `${JSON.stringify(slipReq?.body)} ${slipFile.suggestedFilename()}`);
check('payslip PDF: never uploaded or stored', !uploads.some((u) => !['document', 'certificate'].includes(u.purpose)) && !requests.some((r) => r.method !== 'GET' && /payslip/i.test(r.path) && r.path.includes('storage')));
await slipDialog.getByRole('button', { name: 'Close' }).click();

console.log('Files in Amazon S3: folders and the storage check');
await page.goto(`${BASE}/settings`);
await page.getByRole('tab', { name: 'Document types' }).click();
const nbiFolder = page.getByLabel('NBI clearance folder in S3');
await nbiFolder.waitFor();
await page.waitForTimeout(500); // let the tab underline finish sliding
await page.screenshot({ path: `${ROOT}tests/shots/document-types.png` });
check('document types: each files into its S3 folder', (await page.getByLabel('Security guard license (LESP) folder in S3').inputValue()) === 'lesp' && (await nbiFolder.inputValue()) === 'work-requirements');
await nbiFolder.selectOption('201-file');
await page.waitForTimeout(300);
const folderPatch = requests.filter((r) => r.method === 'PATCH' && r.path === '/rest/v1/document_types').at(-1);
check('document types: HR moves a type to another folder', folderPatch?.body.storage_folder === '201-file' && /id=eq\.dt2/.test(folderPatch?.url), JSON.stringify(folderPatch?.body));
await page.getByRole('tab', { name: 'File storage' }).click();
const countIn = (name) => page.getByRole('row', { name: new RegExp(`^${name} `) }).locator('td.num');
await page.waitForFunction(() => [...document.querySelectorAll('td.num')].length === 6 && ![...document.querySelectorAll('td.num')].some((td) => td.textContent === '·'));
check('file storage: files counted by folder, stored ones only', (await countIn('LESP').innerText()) === '1' && (await countIn('Attendance').innerText()) === '2' && (await countIn('Leave').innerText()) === '0');
await page.getByRole('button', { name: 'Check S3 now' }).click();
await page.getByText('Connected', { exact: true }).waitFor();
const storageText = await page.locator('.panel').last().innerText();
check('file storage: the live check names the bucket and the region', /bannuar-hr-files/.test(storageText) && /ap-southeast-1/.test(storageText) && /refused a public read/.test(storageText), storageText.replace(/\s+/g, ' ').slice(0, 160));
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${ROOT}tests/shots/file-storage.png` });

console.log('Pay rules, rates, assignments, worked-out pay and the 13th month');
await page.goto(`${BASE}/settings`);
await page.getByRole('tab', { name: 'Pay rules and rates' }).click();
await page.getByText('Agency default', { exact: true }).waitFor();
check('pay rules: the agency and client rules are listed', (await page.getByText('Acme Mart standard').count()) === 1);
await page.getByRole('row', { name: /Acme Mart standard/ }).getByRole('button', { name: 'Edit' }).click();
const ruleDialog = page.locator('dialog[open]');
await ruleDialog.getByText('Example: ₱100.00 an hour').waitFor();
await page.screenshot({ path: `${ROOT}tests/shots/pay-rule.png`, fullPage: true });
check('pay rules: the example pays the last shift night differential', /Night differential\s*₱1,040\.00/.test(await ruleDialog.innerText()), (await ruleDialog.locator('.callout').innerText()).replace(/\s+/g, ' '));
await ruleDialog.getByLabel('Line 1 formula').fill('rate * regular_hourz');
check('pay rules: a typo is caught while typing', /Unknown name "regular_hourz"/.test(await ruleDialog.innerText()));
await ruleDialog.getByRole('button', { name: 'Save the rule' }).click();
check('pay rules: a rule with a mistake is not saved', /Fix the lines/.test(await ruleDialog.innerText()) && !requests.some((r) => r.method === 'PATCH' && r.path === '/rest/v1/pay_rules'));
await ruleDialog.getByLabel('Line 1 formula').fill('rate * regular_hours');
await ruleDialog.getByRole('button', { name: 'Add a line' }).click();
await ruleDialog.getByLabel('Line 5 code').fill('cola');
await ruleDialog.getByLabel('Line 5 name').fill('COLA');
await ruleDialog.getByLabel('Line 5 formula').fill('days * 25');
await ruleDialog.getByRole('button', { name: 'Save the rule' }).click();
await page.waitForTimeout(300);
const ruleSaved = requests.find((r) => r.method === 'PATCH' && r.path === '/rest/v1/pay_rules');
check('pay rules: saved with the new line', ruleSaved?.body.formulas.length === 5 && ruleSaved?.body.formulas[4].code === 'cola' && ruleSaved?.body.formulas[0].formula === 'rate * regular_hours' && ruleSaved?.body.night_diff === 'last_shift', JSON.stringify(ruleSaved?.body).slice(0, 160));

await page.goto(`${BASE}/posts/s1`);
const payPanel = page.locator('.panel', { hasText: 'Pay at this post' });
await payPanel.getByText('₱100.00').first().waitFor();
await payPanel.screenshot({ path: `${ROOT}tests/shots/post-pay.png` });
check('post pay: the rule, shifts and rate are shown', /Acme Mart standard|client's default/i.test(await payPanel.innerText()) && /6:00 PM to 6:00 AM \(night differential\)/.test(await payPanel.innerText()), (await payPanel.innerText()).slice(0, 200));
await payPanel.getByLabel('New rate from').fill('2027-01-01');
await payPanel.getByLabel('Hourly rate (₱)').fill('110');
await payPanel.getByRole('button', { name: 'Add the rate' }).click();
await page.waitForTimeout(300);
const rateAdded = requests.find((r) => r.method === 'POST' && r.path === '/rest/v1/pay_rates');
check('post pay: a new rate from its first day', rateAdded?.body.site_id === 's1' && rateAdded?.body.hourly_rate === 110 && rateAdded?.body.effective_from === '2027-01-01', JSON.stringify(rateAdded?.body));
await payPanel.getByLabel('Pay rule').selectOption({ label: 'Standard' });
await page.waitForTimeout(300);
check('post pay: payroll picks the post\'s rule', rpcCalls('set_site_pay_rule')[0]?.body.p_site_id === 's1' && rpcCalls('set_site_pay_rule')[0]?.body.p_pay_rule_id === 'pr-std');

await page.goto(`${BASE}/employees/e1?tab=deployment`);
const history = page.locator('.panel', { hasText: 'Assignment history' });
await history.getByText('Post C · Lobby').waitFor();
check('assignment history: each stretch at a post is listed', (await history.locator('tbody tr').count()) === 3 && (await history.getByText('Now').count()) === 1);

await page.goto(`${BASE}/payroll/13th-month`);
const danteBars = page.getByRole('button', { name: /^Dante Cruz, / });
await danteBars.first().waitFor();
check('13th month: the timeline opens first', (await page.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')) === 'true');
const barNames = await danteBars.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check('13th month timeline: a bar for each stretch, named with its post, dates, rate and share', barNames.length === 3
  && /^Dante Cruz, Post A · Main Gate, Jan 1, 2026 to Mar 31, 2026, ₱100\.00 an hour, 13th month ₱5,200\.00$/.test(barNames[0])
  && /Post B · Warehouse, Apr 1, 2026 to Oct 31, 2026, ₱90\.00 an hour, 13th month ₱10,920\.00$/.test(barNames[1])
  && /Post C · Lobby, Nov 1, 2026 to Dec 31, 2026, ₱150\.00 an hour, 13th month ₱5,200\.00$/.test(barNames[2]), barNames.join(' | '));
const barText = await danteBars.evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const danteTotal = await page.locator('.tl-row', { hasText: 'Dante Cruz' }).locator('.tl-line > .tl-amount').innerText();
check('13th month timeline: each bar shows its pro-rated 13th month, the total at the right', barText[0].startsWith('₱5,200.00') && barText[1].startsWith('₱10,920.00') && /₱(5,200\.00|5\.2K)/.test(barText[2]) && /₱21,320\.00/.test(danteTotal), `${barText.join(' | ')} = ${danteTotal}`);
const barGeometry = await page.evaluate(() => {
  const bars = [...document.querySelectorAll('.tl-bar')].filter((b) => b.getAttribute('aria-label').startsWith('Dante Cruz'));
  const t = bars[0].parentElement.getBoundingClientRect();
  return bars.map((b) => { const r = b.getBoundingClientRect(); return [(r.left - t.left) / t.width, (r.right - t.left) / t.width]; });
});
check('13th month timeline: each bar sits on the year by its dates (April 1 to October 31)', Math.abs(barGeometry[1][0] - 90 / 365) < 0.01 && Math.abs(barGeometry[1][1] - 304 / 365) < 0.01, JSON.stringify(barGeometry));
await danteBars.nth(1).hover();
const tipText = await page.locator('.tl-tip').innerText();
check('13th month timeline: pointing at a bar shows its share and its working', /₱10,920\.00/.test(tipText) && /Post B · Warehouse/.test(tipText) && /₱90\.00 an hour/.test(tipText), tipText.replace(/\s+/g, ' '));
await page.getByRole('group', { name: 'Posts' }).getByRole('button', { name: 'Post C · Lobby' }).click();
check('13th month timeline: the legend picks out one post', (await page.locator('.tl-bar.is-picked').count()) === 1 && (await page.locator('.tl-bar.is-dim').count()) === 3);
await page.locator('.tl-row', { hasText: 'Dante Cruz' }).getByRole('button', { name: 'How' }).click();
check('13th month timeline: "How" opens the working under the row', /₱21,320\.00/.test(await page.locator('.tl-more').innerText()));
await page.locator('.tl-row', { hasText: 'Dante Cruz' }).getByRole('button', { name: 'Hide' }).click();
check('13th month timeline: "Hide" closes it', (await page.locator('.tl-more').count()) === 0);
await page.getByRole('tab', { name: 'List' }).click();
check('13th month: the list view is a tab away, and stays on reload', page.url().includes('view=list'));
const dante = page.getByRole('row', { name: /Dante Cruz/ });
await dante.waitFor();
check('13th month: pro-rated at each post and added up (the DEMO-0001 example)', /₱21,320\.00/.test(await dante.innerText()), (await dante.innerText()).replace(/\s+/g, ' '));
await dante.getByRole('button', { name: 'How' }).click();
const how = await page.locator('td[colspan="5"]').innerText();
check('13th month: the breakdown shows each post, rate and share', /₱5,200\.00/.test(how) && /₱10,920\.00/.test(how) && /₱150\.00/.test(how) && /₱62,400\.00/.test(how), how.replace(/\s+/g, ' ').slice(0, 300));
await page.getByRole('button', { name: 'Create the payout cutoff' }).click();
await page.getByRole('button', { name: 'Create the payout', exact: true }).click();
await page.waitForURL(/\/payroll\/new-/);
const payout = rpcCalls('import_payslips').at(-1)?.body;
check('13th month: the payout cutoff gets a 13th month line for each employee', payout?.p_rows.some((r) => r.employee_no === 'G-001' && r['earning: 13th month pay'] === 21320) && payout?.p_rows.some((r) => r.employee_no === 'G-002'), JSON.stringify(payout?.p_rows?.[0]));
const payoutPeriod = requests.find((r) => r.method === 'POST' && r.path === '/rest/v1/payroll_periods' && r.body.label === '13th month pay 2026');
check('13th month: the payout is due by 24 December', payoutPeriod?.body.pay_date === '2026-12-24' && payoutPeriod?.body.period_start === '2026-01-01');

await page.goto(`${BASE}/payroll/p1`);
await page.getByRole('button', { name: 'Work out pay' }).click();
const work = page.locator('dialog[open]');
await work.getByText('Payslips ready').waitFor();
await page.screenshot({ path: `${ROOT}tests/shots/work-out-pay.png` });
check('work out pay: everyone on duty in the cutoff', /Payslips ready\s*2\b/i.test(await work.innerText()), (await work.locator('.tiles').innerText()).replace(/\s+/g, ' '));
const sheetDownload = page.waitForEvent('download');
await work.getByRole('button', { name: 'Download the attendance sheet' }).click();
const sheetCsv = readFileSync(await (await sheetDownload).path(), 'utf8');
check('work out pay: the attendance sheet comes from the assignments', sheetCsv.includes('G-002,Bea Lim,PA,Post A · Main Gate,2026-11-01,2026-11-15,13,12,18:00') && sheetCsv.includes('G-001,Dante Cruz,PC,Post C · Lobby,2026-11-01,2026-11-15,13,12,06:00'), sheetCsv.split('\n').slice(0, 3).join(' | '));
const edited = `${RUN}attendance.csv`;
writeFileSync(edited, 'Employee number,Name,Post code,Post,From,To,Days,Duty hours,Shift start\nG-002,Bea Lim,PA,Post A · Main Gate,2026-11-01,2026-11-15,10,12,18:00\n');
await work.getByLabel('Upload the filled sheet (CSV)').setInputFiles(edited);
await work.getByText('1 row read').waitFor();
await work.getByRole('button', { name: 'Save 1 payslip' }).click();
await work.getByText('payslips added').waitFor();
const computed = rpcCalls('import_payslips').at(-1)?.body.p_rows;
check('work out pay: the last shift earns night differential, at the post rate and the client rule', computed?.length === 1 && computed[0].employee_no === 'G-002' && computed[0].basic_pay === 8000 && computed[0].overtime_pay === 5000 && computed[0].night_diff_pay === 800 && computed[0].night_diff_hours === 80 && computed[0].allowances === 250, JSON.stringify(computed?.[0]));
await work.getByRole('button', { name: 'Done' }).click();

console.log('Announcements, recruitment, users, posts');
await page.goto(`${BASE}/announcements`);
await page.getByText('1 of 3 read').waitFor({ timeout: 5000 }).catch(() => null);
check('announcement reach is shown', (await page.getByText('1 of 3 read · 1 acknowledged').count()) === 1);
await page.getByRole('button', { name: 'Write an announcement' }).click();
await page.getByLabel('Title').fill('Uniform inspection');
await page.getByLabel('Message').fill('All posts, Monday 7 AM.');
await page.getByLabel('Who it is for').selectOption('sites');
await page.getByRole('button', { name: 'Publish now' }).click();
check('announcement: a post must be chosen for post audiences', /at least one post/.test(await page.locator('dialog[open]').innerText()));
await page.getByLabel('Post A · Main Gate').check();
await page.getByRole('button', { name: 'Publish now' }).click();
await page.waitForTimeout(300);
const an = requests.find((r) => r.method === 'POST' && r.path === '/rest/v1/announcements');
check('announcement: published to the chosen post', an?.body.status === 'published' && an?.body.audience === 'sites' && an?.body.site_ids[0] === 's1', JSON.stringify(an?.body));

await page.goto(`${BASE}/recruitment`);
await page.getByRole('button', { name: 'Abad, Rico' }).click();
await page.getByRole('button', { name: 'Hire' }).click();
await page.getByLabel('New employee number').fill('G-011');
await page.getByRole('button', { name: 'Create the employee record' }).click();
await page.waitForURL(/\/employees\/e3/);
check('hire: the applicant becomes an employee', rpcCalls('hire_applicant')[0]?.body.p_employee_no === 'G-011');

await page.goto(`${BASE}/users`);
await page.getByRole('button', { name: 'Invite someone' }).click();
await page.getByLabel('Name').fill('Hector HR');
await page.getByLabel('Email').fill('hector@bannuar.test');
await page.getByRole('button', { name: 'Make the invitation' }).click();
await page.getByText('K7QM-3XPD').waitFor();
check('invite: the code is shown to pass on', rpcCalls('invite_staff')[0]?.body.p_roles.includes('hr_staff'));

await page.goto(`${BASE}/posts/s1`);
await page.getByRole('button', { name: 'Deploy guards here' }).click();
await page.getByLabel('Pick Carlo Diaz').check();
await page.getByRole('button', { name: 'Deploy 1 guard' }).click();
await page.waitForTimeout(300);
check('deploy: floating guard sent to the post on its shift', JSON.stringify(rpcCalls('deploy_employees')[0]?.body) === JSON.stringify({ p_employee_ids: ['e3'], p_site_id: 's1', p_duty_hours: 12, p_shift_start: '06:00' }), JSON.stringify(rpcCalls('deploy_employees')[0]?.body));

console.log('Attendance');
await page.goto(`${BASE}/posts/s1`);
await page.getByRole('button', { name: 'Set the location' }).waitFor();
check('post: a missing location is pointed out', (await page.getByText('Post location not set').count()) === 1);
await page.getByRole('button', { name: 'Set the location' }).click();
let postDialog = page.locator('dialog[open]');
await postDialog.getByLabel('Location for time in and out').fill('121.024445, 14.554729');
await postDialog.getByRole('button', { name: 'Save the post' }).click();
check('post location: swapped numbers are caught', /look swapped/.test(await postDialog.locator('.field-error').first().innerText()));
await postDialog.getByLabel('Location for time in and out').fill('14.554729, 121.024445');
await postDialog.getByLabel('Allowed distance (metres)').fill('200');
await postDialog.getByRole('button', { name: 'Save the post' }).click();
await page.waitForTimeout(300);
const sitePatch = requests.filter((r) => r.path === '/rest/v1/sites' && r.method === 'PATCH').at(-1);
check('post location: pasted from Google Maps, saved with the allowed distance', sitePatch?.body.latitude === 14.554729 && sitePatch?.body.longitude === 121.024445 && sitePatch?.body.geofence_radius_m === 200, JSON.stringify(sitePatch?.body));
await page.goto(`${BASE}/attendance`);
await page.locator('.thumb img').first().waitFor();
check('attendance: the day\'s logs with their photos', (await page.locator('.thumb img').count()) === 2);
const attReq = requests.filter((r) => r.path === '/rest/v1/attendance_logs').at(-1);
check('attendance: one day in Manila, newest first', /logged_at=gte\./.test(attReq?.url) && /logged_at=lt\./.test(attReq?.url) && /order=logged_at\.desc/.test(attReq?.url), attReq?.url);
const signReq = requests.filter((r) => r.path === '/storage/v1/object/sign/attendance-photos' && r.method === 'POST').at(-1);
check('attendance: a photo from before S3 is signed by Supabase Storage, for ten minutes', JSON.stringify(signReq?.body.paths) === '["e1/selfie-2.jpg"]' && signReq?.body.expiresIn === 600, JSON.stringify(signReq?.body));
const s3Sign = requests.filter((r) => r.path === '/functions/v1/files' && r.body?.action === 'sign').at(-1);
check('attendance: an S3 selfie gets a five-minute link from the files function', JSON.stringify(s3Sign?.body.keys) === JSON.stringify([S3_SELFIE]) && !s3Sign?.body.download, JSON.stringify(s3Sign?.body));
check('attendance: the S3 thumbnail loads from the signed link', (await page.locator(`.thumb img[src*="s3-mock/${S3_SELFIE}"]`).count()) === 1);
check('attendance: a mock location app is flagged', (await page.getByText('Mock location app').count()) === 1);
check('attendance: away shows how far', (await page.getByText('1.1 km from the post, GPS accurate to 20 m').count()) === 1);
await page.getByLabel('Which logs').selectOption('look');
await page.waitForTimeout(400);
const lookReq = requests.filter((r) => r.path === '/rest/v1/attendance_logs').at(-1);
check('attendance: "Needs a look" asks for away, unclear, no location or a mock app', decodeURIComponent(lookReq?.url ?? '').includes('or=(location_check.in.(away,unsure,no_location),mock_location.is.true)'), lookReq?.url);
await page.locator('.thumb').nth(1).click();
const attDialog = page.locator('dialog[open]');
check('attendance: the photo opens with the place and a caution', await attDialog.locator('img.photo-large').isVisible() && /Open in Google Maps/.test(await attDialog.innerText()) && /mock location app on/.test(await attDialog.innerText()));
await attDialog.getByRole('button', { name: 'Close' }).click();
check('attendance: a log entered by hand shows its reason, with no photo', (await page.getByText('Reason: Phone lost; from the post logbook').count()) === 1 && (await page.getByText('By hand', { exact: true }).count()) >= 1);
await page.getByLabel('Which logs').selectOption('other');
await page.waitForTimeout(400);
check('attendance: "By the commander or by hand" asks for logs not from the own phone', /source=neq\.self/.test(requests.filter((r) => r.path === '/rest/v1/attendance_logs').at(-1)?.url ?? ''));
await page.getByRole('button', { name: 'Add a manual log' }).click();
const manual = page.locator('dialog[open]');
await manual.getByLabel('Find the employee').fill('Lim');
await manual.getByLabel('Employee', { exact: true }).selectOption('e2');
await manual.getByLabel('Date').fill('2026-11-10');
await manual.getByLabel('Time (Manila)').fill('07:05');
await manual.getByRole('button', { name: 'Add the log' }).click();
check('manual log: a reason is required', /Say why/.test(await manual.innerText()));
await manual.getByLabel('Reason').fill('Phone lost; time from the post logbook');
await manual.getByRole('button', { name: 'Add the log' }).click();
await page.getByText('Manual log added. The employee is told.').waitFor();
const ml = rpcCalls('add_manual_attendance').at(-1)?.body;
check('manual log: sent to the database with Manila time and the reason', ml?.p_employee_id === 'e2' && ml?.p_kind === 'time_in' && ml?.p_logged_at === '2026-11-09T23:05:00.000Z' && ml?.p_reason === 'Phone lost; time from the post logbook', JSON.stringify(ml));
await page.goto(`${BASE}/employees/e2?tab=attendance`);
await page.getByText('Time in and out from the app').waitFor();
const empAtt = requests.filter((r) => r.path === '/rest/v1/attendance_logs').at(-1);
check('employee page: their own logs', /employee_id=eq\.e2/.test(empAtt?.url ?? ''), empAtt?.url);

console.log('Jump to, keyboard, every width, reduced motion');
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: /^Good/ }).waitFor();
await page.keyboard.press('Control+k');
const palette = page.getByRole('dialog', { name: 'Jump to' });
await palette.getByRole('combobox').fill('Lim');
await palette.getByRole('option', { name: /Bea Lim/ }).waitFor();
check('jump to: Ctrl K finds an employee by name', (await palette.getByRole('option', { name: /Bea Lim/ }).count()) === 1);
await page.screenshot({ path: `${ROOT}tests/shots/jump-to.png` });
await palette.getByRole('option', { name: /Bea Lim/ }).click();
await page.waitForURL(`${BASE}/employees/e2`);
check('jump to: choosing a result opens it', page.url().endsWith('/employees/e2'));
const jumpReq = requests.filter((r) => r.path === '/rest/v1/employees' && /or=/.test(r.url)).at(-1);
check('jump to: the search goes through the database by name and number', decodeURIComponent(jumpReq?.url ?? '').includes('last_name.ilike.%Lim%'), jumpReq?.url);
await page.goto(`${BASE}/`);
await page.getByRole('heading', { name: /^Good/ }).waitFor();
await page.keyboard.press('Tab');
await page.waitForTimeout(350);
const skip = await page.evaluate(() => ({ cls: document.activeElement?.className ?? '', top: document.activeElement?.getBoundingClientRect().top ?? -1 }));
check('keyboard: Tab reaches the skip link first, and it shows', skip.cls.includes('skip-link') && skip.top >= 0, JSON.stringify(skip));
await page.keyboard.press('Tab');
check('keyboard: every focused control shows a ring', await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow !== 'none'));
await page.getByRole('link', { name: 'Requests' }).first().click();
await page.waitForURL(/\/requests/);
await page.waitForTimeout(450);
const lamp = await page.evaluate(() => {
  const l = document.querySelector('.nav-lamp')?.getBoundingClientRect();
  const a = document.querySelector('.nav-link.active')?.getBoundingClientRect();
  return l && a ? Math.abs(l.top - a.top) : null;
});
check('menu: the lamp moves to the page opened', lamp !== null && lamp < 1.5, String(lamp));

const sweep = ['/', '/employees', '/employees/e2', '/posts/s1', '/requests', '/attendance', '/payroll', '/payroll/13th-month'];
for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const path of sweep) {
    await page.goto(BASE + path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`${w}px ${path}: no sideways scroll`, !wide);
    mkdirSync(`${ROOT}tests/shots/${w}`, { recursive: true });
    await page.screenshot({ path: `${ROOT}tests/shots/${w}/${path.replace(/\//g, '_') || 'home'}.png` });
  }
}
await page.setViewportSize({ width: 1280, height: 860 });

const out = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await blockReal(out);
await out.route(`${MOCK}/**`, api);
const p3 = await out.newPage();
p3.on('pageerror', (e) => consoleErrors.push(e.message));
await p3.goto(`${BASE}/sign-in`);
await p3.locator('.clock__lamp').waitFor();
const clockLabel = await p3.getByRole('img', { name: /24-hour dial/ }).getAttribute('aria-label');
check('sign-in: the duty clock says the time in Manila and the duty', /in Manila, (day|night) duty, .* to the (6 AM|6 PM) change of shift/.test(clockLabel ?? ''), clockLabel);
await p3.mouse.move(200, 200);
await p3.waitForTimeout(800);
check('sign-in: the dial leans towards the pointer', await p3.evaluate(() => getComputedStyle(document.querySelector('.clock__stage')).transform !== 'none'));
await p3.screenshot({ path: `${ROOT}tests/shots/sign-in-1440.png` });
await p3.setViewportSize({ width: 390, height: 844 });
check('sign-in, phone: no sideways scroll', !(await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
await p3.screenshot({ path: `${ROOT}tests/shots/sign-in-390.png` });
await out.close();

const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
await blockReal(calm);
await calm.route(`${MOCK}/**`, api);
const p4 = await calm.newPage();
await p4.goto(`${BASE}/sign-in`);
await p4.getByLabel('Email').fill('ana@bannuar.test');
await p4.getByLabel('Password').fill('right-password');
await p4.getByRole('button', { name: 'Sign in' }).click();
await p4.getByRole('heading', { name: /^Good/ }).waitFor();
check('reduced motion: figures show at once, no count-up', /^3$/.test((await p4.locator('.tile.night .big').innerText()).trim()));
await p4.goto(`${BASE}/sign-in?next=/`);
check('reduced motion: the duty clock stays flat', await p4.evaluate(() => { const s = document.querySelector('.clock__stage'); return !s || getComputedStyle(s).transform === 'none'; }));
await calm.close();

console.log('Sign-up, phone width, sign-out');
const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
await blockReal(p2.context());
await p2.context().route(`${MOCK}/**`, api);
await p2.goto(`${BASE}/setup`);
await p2.getByLabel('Email').fill('hector@bannuar.test');
await p2.getByLabel('Invitation code').fill('wrong-code');
await p2.getByLabel('Your name').fill('Hector HR');
await p2.getByLabel('Password', { exact: true }).fill('a-good-password');
await p2.getByLabel('Password again').fill('a-good-password');
await p2.getByRole('button', { name: 'Make my account' }).click();
check('setup: a malformed code is caught', /8 letters/.test(await p2.locator('.field-error').first().innerText()));
await p2.getByLabel('Invitation code').fill('AAAA-BBBB');
await p2.getByRole('button', { name: 'Make my account' }).click();
await p2.getByRole('alert').waitFor();
check('setup: an unknown code is refused before sign-up', /no open invitation/.test(await p2.getByRole('alert').innerText()) && !requests.some((r) => r.path === '/auth/v1/signup'));
await p2.getByLabel('Invitation code').fill('k7qm 3xpd');
await p2.getByRole('button', { name: 'Make my account' }).click();
await p2.waitForURL(`${BASE}/`);
const su = requests.find((r) => r.path === '/auth/v1/signup');
check('setup: signs up with the code in the metadata', su?.body.data.invite_code === 'K7QM-3XPD' && su?.body.data.full_name === 'Hector HR', JSON.stringify(su?.body.data));
check('phone: no sideways scroll on the dashboard', !(await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
await p2.getByRole('button', { name: 'Menu' }).click();
check('phone: the menu opens the sections', await p2.locator('.side.open').isVisible());
await p2.waitForTimeout(400);
await p2.screenshot({ path: `${ROOT}tests/shots/390-menu.png` });
await p2.getByRole('button', { name: 'Sign out' }).click();
await p2.waitForURL(/sign-in/);
check('sign out: back to sign-in', p2.url().includes('/sign-in'));

check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('the test build talked only to the mock, never to the live project', realHits.length === 0 && requests.length > 50, realHits.slice(0, 2).join(', '));

// ------------------------------------------------------------------ every request against the real schema
console.log('\nRequests against the schema');
const cols = schema.columns;
const fkNames = new Set(schema.fks.map((f) => f.name));
const pks = schema.pks;
const problems = new Set();
/** The links PostgREST sees between two tables: each foreign key either way, and every junction table
 *  whose primary key holds a foreign key to each side (many-to-many). An embed must resolve to one. */
function links(from, to) {
  const out = [];
  for (const f of schema.fks) {
    if (f.from === from && f.to === to) out.push({ kind: 'many-to-one', names: [f.name], cols: f.cols });
    if (f.from === to && f.to === from) out.push({ kind: 'one-to-many', names: [f.name], cols: f.cols });
  }
  for (const a of schema.fks) for (const b of schema.fks) {
    if (from === to || a.from !== b.from || a.name === b.name || a.to !== from || b.to !== to) continue;
    const pk = pks[a.from] ?? [];
    if ([...a.cols, ...b.cols].every((c) => pk.includes(c))) out.push({ kind: `many-to-many through ${a.from}`, names: [a.name, b.name], cols: [], junction: a.from });
  }
  return out;
}
const hintMatches = (link, hint) => link.names.includes(hint) || (link.cols.length === 1 && link.cols[0] === hint) || link.junction === hint;
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function checkSelect(table, select, where) {
  if (!cols[table]) return problems.add(`${where}: no table or view "${table}"`);
  for (const item of splitTop(select)) {
    if (item === '*') continue;
    const m = item.match(/^(?:(\w+):)?(\w+)(?:!([\w]+))?(?:!(inner|left))?(?:\((.*)\))?$/s);
    if (!m) { problems.add(`${where}: cannot read "${item}"`); continue; }
    const [, , name, hint, , inner] = m;
    if (inner !== undefined) {
      if (inner.trim() === 'count') { if (!cols[name]) problems.add(`${where}: no table "${name}" to count`); continue; }
      const fk = hint === 'inner' || hint === 'left' ? undefined : hint;
      if (!cols[name]) { problems.add(`${where}: no table "${name}" to embed`); continue; }
      if (!pks[table] || !pks[name]) {
        // a view: PostgREST follows the foreign keys of the tables underneath
        if (fk && !fkNames.has(fk)) problems.add(`${where}: no foreign key "${fk}"`);
      } else {
        const all = links(table, name);
        const chosen = fk ? all.filter((l) => hintMatches(l, fk)) : all;
        if (all.length === 0) problems.add(`${where}: no foreign key between ${table} and ${name}`);
        else if (chosen.length === 0) problems.add(`${where}: "${fk}" is none of the links between ${table} and ${name}`);
        else if (chosen.length > 1) problems.add(`${where}: ${table} and ${name} are linked ${chosen.length} ways (${chosen.map((l) => `${l.names.join(' + ')}, ${l.kind}`).join('; ')}), so PostgREST refuses the embed; name one, e.g. ${name}!${chosen[0].names[0]}(...)`);
      }
      checkSelect(name, inner, `${where} > ${name}`);
    } else if (name !== '*' && !cols[table].includes(name)) problems.add(`${where}: no column ${table}.${name}`);
  }
}
for (const r of requests.filter((x) => x.path.startsWith('/rest/v1/'))) {
  const url = new URL(r.url);
  const where = `${r.method} ${url.pathname.slice(9)}`;
  if (r.path.startsWith('/rest/v1/rpc/')) {
    const name = r.path.slice(13);
    const fn = schema.functions[name];
    if (!fn) { problems.add(`${where}: no function ${name}`); continue; }
    const keys = Object.keys(r.body ?? {});
    for (const k of keys) if (!fn.args.includes(k)) problems.add(`${where}: ${name} has no argument ${k}`);
    for (const a of fn.args.slice(0, fn.args.length - fn.defaults)) if (!keys.includes(a)) problems.add(`${where}: ${name} needs ${a}`);
    continue;
  }
  const table = r.path.slice(9);
  if (!cols[table]) { problems.add(`${where}: no table or view "${table}"`); continue; }
  if (url.searchParams.get('select')) checkSelect(table, url.searchParams.get('select'), where);
  for (const [k, v] of url.searchParams) {
    if (['select', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'order') { for (const o of v.split(',')) if (!cols[table].includes(o.split('.')[0])) problems.add(`${where}: cannot order by ${o}`); continue; }
    if (k.endsWith('or')) {
      const target = k.includes('.') ? 'employees' : table;
      for (const c of [...v.matchAll(/(\w+)\.(?:ilike|eq|is|neq|in|gte|lte|gt|lt)\./g)].map((x) => x[1])) if (!cols[target].includes(c)) problems.add(`${where}: or-filter on missing ${target}.${c}`);
      continue;
    }
    if (!cols[table].includes(k)) problems.add(`${where}: filter on missing ${table}.${k}`);
  }
  if ((r.method === 'POST' || r.method === 'PATCH') && r.body && typeof r.body === 'object') {
    for (const k of Object.keys(Array.isArray(r.body) ? r.body[0] : r.body)) if (!cols[table].includes(k)) problems.add(`${where}: writes missing column ${table}.${k}`);
  }
}
const restCount = requests.filter((x) => x.path.startsWith('/rest/v1/')).length;
check(`all ${restCount} database requests match the schema`, problems.size === 0, [...problems].slice(0, 12).join('\n       '));

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ` - ${f}`).join('\n'));
  process.exit(1);
}

/* Refresh tests/schema-snapshot.json after changing supabase/schema.sql: see tests/schema-snapshot.sql. */
