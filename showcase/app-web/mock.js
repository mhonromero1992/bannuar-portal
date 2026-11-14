/**
 * The showcase's stand-in for Bannuar's Supabase project (https://mock.supabase.test): demo records for
 * the employee app, answered the way Supabase answers. Same demo people as the portal's tests (Bea Lim
 * on the Main Gate's night shift, Dante Cruz her detachment commander). Every record is demo data.
 *
 * Open the app as the guard (default) or the commander: index.html?as=commander
 */
const MOCK = 'https://mock.supabase.test';
const as = new URLSearchParams(location.search).get('as') === 'commander' ? 'commander' : 'guard';
const day = 86400000;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const dateOnly = (t) => iso(t).slice(0, 10);
/** Manila time of day on a day relative to today, as an ISO timestamp */
const at = (days, h, m = 0) => {
  const d = new Date(now + days * day);
  const manila = new Date(d.getTime() + 8 * 3600000);
  manila.setUTCHours(h, m, 0, 0);
  return new Date(manila.getTime() - 8 * 3600000).toISOString();
};

const SITE = { id: 's1', name: 'Acme Mart · Main Gate', code: 'AM-MG', address: 'National Highway, Urbiztondo', city: 'San Juan', province: 'La Union', latitude: 16.66912, longitude: 120.32218, geofence_radius_m: 150 };
const AREA = { id: 'a1', name: 'La Union' };
const person = (id, no, first, last, position, extra = {}) => ({
  id, employee_no: no, first_name: first, middle_name: null, last_name: last, suffix: null, position, status: 'active', site_id: 's1', ...extra,
});
const BEA = person('e2', 'G-002', 'Bea', 'Lim', 'Lady Guard', { middle_name: 'Santos' });
const DANTE = person('e1', 'G-001', 'Dante', 'Cruz', 'Detachment Commander', { middle_name: 'Reyes' });
const GUARDS = [
  DANTE, BEA,
  person('e3', 'G-003', 'Carlo', 'Diaz', 'Security Guard'),
  person('e4', 'G-004', 'Jose', 'Ramos', 'Security Guard'),
  person('e5', 'G-005', 'Ana', 'Reyes', 'Lady Guard'),
  person('e6', 'G-006', 'Pedro', 'Bautista', 'Security Guard', { status: 'on_leave' }),
];
const ME = as === 'commander' ? DANTE : BEA;
const USER_ID = as === 'commander' ? 'u-dante' : 'u-bea';
const loginEmail = `${ME.employee_no.toLowerCase()}@employees.bannuar.invalid`;
const meRow = {
  ...ME, birthdate: as === 'commander' ? '1986-04-12' : '1992-02-02', sex: as === 'commander' ? 'male' : 'female', civil_status: as === 'commander' ? 'married' : 'single',
  mobile_no: as === 'commander' ? '0917 111 0001' : '0917 111 0002', email: null, present_address: 'Urbiztondo, San Juan, La Union', provincial_address: 'Bauang, La Union',
  employment_type: 'regular', date_hired: as === 'commander' ? '2018-01-15' : '2023-01-10', date_regularized: as === 'commander' ? '2018-07-15' : '2023-07-10', floating_since: null,
  area_id: 'a1', emergency_contact_name: as === 'commander' ? 'Liza Cruz' : 'Rosa Lim', emergency_contact_relation: as === 'commander' ? 'Wife' : 'Mother', emergency_contact_phone: '0918 222 3344',
  site: SITE, area: AREA,
};
const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(now / 1000) + 86400, email: loginEmail })}.sig`;
const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: loginEmail, email_confirmed_at: iso(now - 30 * day), user_metadata: { account_type: 'employee', employee_no: ME.employee_no }, app_metadata: { provider: 'email' }, created_at: iso(now - 30 * day) };
const session = () => ({ access_token: jwt(), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, refresh_token: 'refresh-showcase', user });
const access = {
  user_id: USER_ID, roles: as === 'commander' ? ['employee', 'supervisor'] : ['employee'], full_name: `${ME.first_name} ${ME.last_name}`, email: loginEmail, must_change_password: false,
  employee: { id: ME.id, employee_no: ME.employee_no, full_name: `${ME.first_name} ${ME.last_name}`, position: ME.position, status: 'active', site_id: 's1' },
};

// ------------------------------------------------------------------ demo records
const periods = [
  { id: 'p0', label: 'Oct 16 to 31, 2026', period_start: '2026-10-16', period_end: '2026-10-31', pay_date: '2026-11-05' },
  { id: 'p9', label: 'Oct 1 to 15, 2026', period_start: '2026-10-01', period_end: '2026-10-15', pay_date: '2026-10-20' },
  { id: 'p8', label: 'Sep 16 to 30, 2026', period_start: '2026-09-16', period_end: '2026-09-30', pay_date: '2026-10-05' },
];
const slip = (id, period, days, extra = {}) => {
  const basic = days * 8 * 100;
  const ot = days * 4 * 125;
  const nd = days * 8 * 10;
  const allow = days * 25;
  const gross = basic + ot + nd + allow;
  const ded = { sss: 750, philhealth: 412.5, pagibig: 200, withholding_tax: 0, loans: 0, other_deductions: 150 };
  const total = Object.values(ded).reduce((t, v) => t + v, 0);
  return {
    id, payroll_period_id: period.id, employee_id: ME.id, site_name: SITE.name, days_worked: days, hours_worked: days * 8, overtime_hours: days * 4, night_diff_hours: days * 8,
    basic_pay: basic, overtime_pay: ot, night_diff_pay: nd, holiday_pay: 0, allowances: allow, other_earnings: 0, gross_pay: gross, ...ded, total_deductions: total, net_pay: gross - total,
    earnings_detail: [], deductions_detail: [{ label: 'Uniform', amount: 150 }], remarks: `${SITE.name}: ${days} duties of 12 hours at ₱100.00 an hour`, created_at: iso(now - 10 * day), period, ...extra,
  };
};
const tables = {
  employees: [meRow, ...GUARDS.filter((g) => g.id !== ME.id)],
  sites: [SITE],
  announcements: [
    { id: 'an1', title: 'Fire and earthquake drill on Friday', body: 'Every post joins the drill at 10 AM on Friday. Commanders: brief your guards at the start of the shift and report the drill in the app.', category: 'advisory', priority: 'important', requires_ack: true, pinned: true, published_at: at(-1, 9), expires_at: null },
    { id: 'an2', title: 'New uniforms ready for pickup', body: 'New uniforms are at the office on Diversion Road, Monday to Saturday, 8 AM to 5 PM. Bring your old ID.', category: 'general', priority: 'normal', requires_ack: false, pinned: false, published_at: at(-3, 14), expires_at: null },
    { id: 'an3', title: 'Holiday duty schedule for December', body: 'The December schedule is posted at each post. Talk to your commander about leave before December 1.', category: 'schedule', priority: 'normal', requires_ack: false, pinned: false, published_at: at(-6, 10), expires_at: null },
  ],
  announcement_receipts: [{ announcement_id: 'an2', employee_id: ME.id, read_at: at(-3, 15), acknowledged_at: null }, { announcement_id: 'an3', employee_id: ME.id, read_at: at(-5, 8), acknowledged_at: null }],
  payroll_periods: periods,
  payslips: [slip('ps1', periods[0], 13), slip('ps2', periods[1], 14), slip('ps3', periods[2], 13)],
  payroll_concerns: [{ id: 'pq1', employee_id: ME.id, payslip_id: 'ps2', category: 'overtime', description: 'Two hours of overtime on Oct 9 are missing.', status: 'resolved', resolution: 'Added to the Oct 16 to 31 cutoff.', resolved_at: at(-12, 11), created_at: at(-20, 9) }],
  leave_types: [
    { id: 'lt1', code: 'SIL', name: 'Service incentive leave', description: 'Five days with pay a year, after a year of service.', days_per_year: 5, max_days_per_request: null, is_paid: true, requires_attachment: false, applies_to_sex: null, min_service_months: 12, sort_order: 10, is_active: true },
    { id: 'lt2', code: 'SICK', name: 'Sick leave', description: 'With a medical certificate for two days or more.', days_per_year: 5, max_days_per_request: null, is_paid: true, requires_attachment: true, applies_to_sex: null, min_service_months: 0, sort_order: 20, is_active: true },
    { id: 'lt3', code: 'SOLO', name: 'Solo parent leave', description: 'Seven days a year (RA 11861).', days_per_year: 7, max_days_per_request: null, is_paid: true, requires_attachment: true, applies_to_sex: null, min_service_months: 6, sort_order: 30, is_active: true },
  ],
  leave_balances: [
    { employee_id: ME.id, leave_type_id: 'lt1', code: 'SIL', name: 'Service incentive leave', year: 2026, credits: 5, used: 2, pending: 0 },
    { employee_id: ME.id, leave_type_id: 'lt2', code: 'SICK', name: 'Sick leave', year: 2026, credits: 5, used: 1, pending: 0 },
  ],
  leave_requests: [
    { id: 'lr0', employee_id: ME.id, leave_type_id: 'lt1', start_date: '2026-10-02', end_date: '2026-10-03', days: 2, reason: 'Family gathering', attachment_path: null, status: 'approved', reliever_employee_id: 'e4', supervisor_note: 'Jose Ramos relieves.', supervisor_decided_at: at(-45, 9), hr_note: null, hr_decided_at: at(-44, 10), created_at: at(-47, 8), site_id: 's1', type: { code: 'SIL', name: 'Service incentive leave' }, reliever: { first_name: 'Jose', middle_name: null, last_name: 'Ramos', suffix: null }, employee: { id: ME.id, employee_no: ME.employee_no, first_name: ME.first_name, middle_name: null, last_name: ME.last_name, suffix: null } },
    // a guard's leave waiting for the commander
    { id: 'lr1', employee_id: 'e5', leave_type_id: 'lt1', start_date: dateOnly(now + 9 * day), end_date: dateOnly(now + 10 * day), days: 2, reason: 'My daughter\'s graduation', attachment_path: null, status: 'pending_supervisor', reliever_employee_id: null, supervisor_note: null, supervisor_decided_at: null, hr_note: null, hr_decided_at: null, created_at: at(-1, 7), site_id: 's1', type: { code: 'SIL', name: 'Service incentive leave' }, reliever: null, employee: { id: 'e5', employee_no: 'G-005', first_name: 'Ana', middle_name: null, last_name: 'Reyes', suffix: null } },
  ],
  coe_requests: [
    { id: 'cq1', employee_id: ME.id, purpose: 'bank_loan', purpose_details: 'Housing loan', include_compensation: true, addressee: 'Pag-IBIG Fund', status: 'issued', due_at: at(-8, 17), decision_note: null, decided_at: at(-9, 10), created_at: at(-11, 9), certificate_id: 'cert1', certificate: { id: 'cert1', certificate_no: 'COE-2026-000041', verification_code: 'K7QM-3XPD-8RTA', file_path: 'employees/G-002/certificates/COE-2026-000041.pdf', issued_at: at(-9, 10), revoked_at: null } },
  ],
  certificates: [{ id: 'cert1', employee_id: ME.id, certificate_no: 'COE-2026-000041', verification_code: 'K7QM-3XPD-8RTA', purpose: 'bank_loan', include_compensation: true, file_path: 'employees/G-002/certificates/COE-2026-000041.pdf', issued_at: at(-9, 10), revoked_at: null, revoked_reason: null, coe_request_id: 'cq1' }],
  profile_change_requests: [],
  document_types: [
    { id: 'dt1', code: 'SECURITY_LICENSE', name: 'Security guard license (LESP)', category: 'license', has_expiry: true, employee_can_upload: true, sort_order: 10, ai_check: 'lesp', is_active: true, visible_to_employee: true },
    { id: 'dt2', code: 'NBI_CLEARANCE', name: 'NBI clearance', category: 'clearance', has_expiry: true, employee_can_upload: true, sort_order: 20, ai_check: null, is_active: true, visible_to_employee: true },
    { id: 'dt3', code: 'NEURO', name: 'Neuro-psychiatric examination', category: 'medical', has_expiry: true, employee_can_upload: true, sort_order: 30, ai_check: null, is_active: true, visible_to_employee: true },
    { id: 'dt4', code: 'DRUG_TEST', name: 'Drug test result', category: 'medical', has_expiry: true, employee_can_upload: true, sort_order: 40, ai_check: null, is_active: true, visible_to_employee: true },
  ],
  employee_documents: [
    { id: 'd1', employee_id: ME.id, document_type_id: 'dt1', document_no: 'R01-202312-004567', issued_on: '2023-12-04', expires_on: dateOnly(now + 18 * day), file_path: 'employees/G-002/lesp/lesp-2023.jpg', status: 'verified', review_note: null, created_at: at(-340, 10), type: { id: 'dt1', code: 'SECURITY_LICENSE', name: 'Security guard license (LESP)', has_expiry: true, employee_can_upload: true } },
    { id: 'd2', employee_id: ME.id, document_type_id: 'dt2', document_no: 'NBI-8841-2026', issued_on: '2026-03-02', expires_on: '2027-03-02', file_path: 'employees/G-002/work-requirements/nbi.jpg', status: 'verified', review_note: null, created_at: at(-250, 10), type: { id: 'dt2', code: 'NBI_CLEARANCE', name: 'NBI clearance', has_expiry: true, employee_can_upload: true } },
    { id: 'd3', employee_id: ME.id, document_type_id: 'dt3', document_no: null, issued_on: '2026-01-20', expires_on: '2027-01-20', file_path: 'employees/G-002/201-file/neuro.jpg', status: 'verified', review_note: null, created_at: at(-290, 10), type: { id: 'dt3', code: 'NEURO', name: 'Neuro-psychiatric examination', has_expiry: true, employee_can_upload: true } },
  ],
  document_alerts: [{ id: 'd1', employee_id: ME.id, type_name: 'Security guard license (LESP)', expires_on: dateOnly(now + 18 * day), days_left: 18, state: 'expiring' }],
  notifications: [
    { id: 'n1', title: 'Your payslip is ready', body: 'Oct 16 to 31, 2026. Open the app to see it.', kind: 'payslip', link: { screen: 'Payslip', id: 'ps1' }, read_at: null, created_at: at(-2, 9) },
    { id: 'n2', title: 'Announcement to acknowledge', body: 'Fire and earthquake drill on Friday', kind: 'announcement', link: { screen: 'Announcement', id: 'an1' }, read_at: null, created_at: at(-1, 9) },
    { id: 'n3', title: 'Your license expires in 18 days', body: 'Upload the renewed LESP from My records.', kind: 'document', link: { screen: 'Records' }, read_at: at(-1, 12), created_at: at(-1, 8) },
    { id: 'n4', title: 'Certificate of employment ready', body: 'COE-2026-000041 · open it in the app', kind: 'coe', link: { screen: 'Certificate', id: 'cert1' }, read_at: at(-9, 12), created_at: at(-9, 10) },
  ],
  attendance_logs: [],
  device_tokens: [],
};
// the last six nights at the post (6 PM to 6 AM), all from the guard's own phone, at the post
for (let d = 6; d >= 1; d--) {
  tables.attendance_logs.push(
    { id: `in${d}`, employee_id: ME.id, kind: 'time_in', logged_at: at(-d, 17, 52 + (d % 5)), location_check: 'at_post', distance_m: 20 + d * 7, accuracy_m: 8 + d, radius_m: 150, mock_location: false, source: 'self', manual_reason: null, site: { name: SITE.name } },
    { id: `out${d}`, employee_id: ME.id, kind: 'time_out', logged_at: at(-d + 1, 6, 3 + d), location_check: 'at_post', distance_m: 30 + d * 5, accuracy_m: 9, radius_m: 150, mock_location: false, source: 'self', manual_reason: null, site: { name: SITE.name } },
  );
}
tables.attendance_logs.sort((a, b) => b.logged_at.localeCompare(a.logged_at));

const notices = [
  {
    id: 'case2', case_no: 'DC-2026-000002', status: 'nte_issued', rule: { ref: 'B-2', title: 'Tardiness' }, offense_no: 1,
    nte_text: 'This notice is about November 9, when your time in at the Main Gate was 6:41 PM, 41 minutes after the start of your shift. This may violate rule B-2 (Tardiness) of the Code of Discipline. Please explain in writing why no disciplinary action should be taken.',
    nte_issued_at: at(-1, 10), explain_by: at(5, 17), nte_received_at: null, explanation: null, explained_at: null, wants_hearing: false, hearing_at: null, hearing_place: null, hearing_held_at: null,
    decision: null, suspension_days: null, suspension_from: null, decision_text: null, decided_at: null, decision_received_at: null, preventive_from: null, preventive_to: null, preventive_reason: null, withdrawn_reason: null,
  },
];

// ------------------------------------------------------------------ answers
const json = (status, body, headers = {}) => new Response(body === undefined || status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function filterRows(rows, q) {
  let out = rows;
  q.forEach((v, k) => {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'].includes(k)) return;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'neq') out = out.filter((r) => r[k] !== null && r[k] !== undefined && String(r[k]) !== val);
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] === null || r[k] === undefined);
    else if (op === 'gte') out = out.filter((r) => String(r[k]) >= val);
  });
  return out;
}
const logged = (args, forWhom) => {
  const kind = args.p_kind;
  const row = {
    id: `live-${Date.now()}`, employee_id: forWhom ?? ME.id, kind, logged_at: iso(Date.now()), location_check: 'at_post', distance_m: 38, accuracy_m: 9, radius_m: 150, mock_location: false,
    source: forWhom ? 'commander' : 'self', manual_reason: null, site: { name: SITE.name },
  };
  if (!forWhom) tables.attendance_logs.unshift(row);
  return { id: row.id, kind, logged_at: row.logged_at, location_check: 'at_post', distance_m: 38, accuracy_m: 9, radius_m: 150, site_name: SITE.name, employee_name: forWhom ? 'Carlo Diaz' : undefined };
};
const RPC = {
  my_access: () => access,
  mark_password_changed: () => null,
  mark_announcement_read: (a) => {
    const r = tables.announcement_receipts.find((x) => x.announcement_id === a.p_announcement_id);
    const stamp = iso(Date.now());
    if (r) { r.read_at ??= stamp; if (a.p_acknowledge) r.acknowledged_at = stamp; } else tables.announcement_receipts.push({ announcement_id: a.p_announcement_id, employee_id: ME.id, read_at: stamp, acknowledged_at: a.p_acknowledge ? stamp : null });
    return null;
  },
  cancel_leave_request: () => null,
  cancel_coe_request: () => null,
  decide_leave_request: (a) => { const r = tables.leave_requests.find((x) => x.id === a.p_request_id); if (r) r.status = a.p_approve ? 'pending_hr' : 'rejected'; return { id: a.p_request_id, status: a.p_approve ? 'pending_hr' : 'rejected' }; },
  get_government_ids: () => [{ sss_no: '02-2345678-9', philhealth_no: '12-345678901-2', pagibig_no: '1212-3434-5656', tin: '123-456-789-000', updated_at: at(-100, 9) }],
  register_device_token: () => null,
  my_supervised_site_ids: () => (as === 'commander' ? ['s1'] : []),
  log_attendance: (a) => logged(a),
  log_attendance_for: (a) => logged(a, a.p_employee_id),
  my_disciplinary_cases: () => (as === 'guard' ? notices : []),
  acknowledge_case_notice: () => { notices[0].nte_received_at = iso(Date.now()); return null; },
  submit_case_explanation: () => null,
  active_discipline_code: () => ({ id: 'dc0', title: 'Code of Discipline 2026', effective_on: '2026-01-01', file_key: 'company/code-of-discipline/code.pdf', rules: [] }),
  file_incident_report: () => ({ id: 'ir-9', report_no: 'IR-2026-000014', status: 'received' }),
};

const realFetch = window.fetch.bind(window);
window.__showcaseRequests = [];
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  if (url.origin !== MOCK) return realFetch(input, init);
  const method = (init.method ?? 'GET').toUpperCase();
  let body = init.body ?? null;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* text */ } }
  window.__showcaseRequests.push({ method, path: url.pathname, query: url.search, body });
  await new Promise((r) => setTimeout(r, 120)); // a phone on mobile data
  const path = url.pathname;
  const headers = new Headers(init.headers ?? {});
  if (path === '/auth/v1/token') return json(200, session());
  if (path === '/auth/v1/user') return json(200, user);
  if (path === '/auth/v1/logout') return json(204);
  if (path === '/functions/v1/activate-employee') return json(200, { status: 'activated', login_email: loginEmail });
  if (path === '/functions/v1/document-ai') {
    await new Promise((r) => setTimeout(r, 1400)); // Claude reads the photo
    return json(200, { status: 'checked', type_ok: true, legibility: 'clear', holder_name: 'LIM, BEA SANTOS', name_match: 'match', document_no: 'R01-202611-008842', issued_on: '2026-11-10', expires_on: '2028-11-09', expiry: 'valid', concerns: [] });
  }
  if (path === '/functions/v1/files') {
    if (body && typeof body === 'object' && body.action === 'sign') {
      const photos = window.__showcasePhotos || {};
      return json(200, { urls: Object.fromEntries((body.keys ?? []).map((k) => [k, /attendance/.test(k) ? photos.camera : photos.library || photos.camera])), expires_in: 300 });
    }
    return json(200, { id: `sf-${Date.now()}`, key: `employees/${ME.employee_no}/attendance/2026/11/selfie.jpg`, name: 'selfie.jpg', content_type: 'image/jpeg', size_bytes: 184320 });
  }
  if (path === '/functions/v1/payslip-pdf') return new Response('%PDF-1.4\n', { status: 200, headers: { 'content-type': 'application/pdf' } });
  if (path.startsWith('/storage/v1/object/sign/')) return json(200, { signedURL: '/object/sign/x?token=t' });
  if (path.startsWith('/rest/v1/rpc/')) {
    const h = RPC[path.slice('/rest/v1/rpc/'.length)];
    return h ? json(200, h(body ?? {})) : json(404, { code: 'PGRST202', message: 'no mock' });
  }
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    const single = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
    if (method === 'GET' || method === 'HEAD') {
      const rows = filterRows(tables[table] ?? [], url.searchParams);
      const range = { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` };
      if (method === 'HEAD') return new Response(null, { status: 200, headers: range });
      if (single) return rows[0] ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return json(200, rows, range);
    }
    if (method === 'POST') {
      const row = { id: `new-${Date.now()}`, created_at: iso(Date.now()), status: 'pending', ...(Array.isArray(body) ? body[0] : body) };
      if (table === 'leave_requests') Object.assign(row, { status: 'pending_supervisor', days: 2, type: tables.leave_types.find((t) => t.id === row.leave_type_id) ?? null, reliever: null, employee: null });
      if (table === 'coe_requests') Object.assign(row, { status: 'pending', due_at: iso(Date.now() + 3 * day), certificate: null });
      if (tables[table]) tables[table].unshift(row);
      const wantRow = (headers.get('prefer') ?? '').includes('return=representation');
      return wantRow ? json(201, single ? row : [row]) : json(201);
    }
    if (method === 'PATCH') {
      if (table === 'notifications') for (const n of filterRows(tables.notifications, url.searchParams)) n.read_at = body.read_at;
      return json(204);
    }
    return json(204);
  }
  return json(404, { message: 'no mock' });
};

// Realtime (live notifications) has no server here: its socket stays closed and quiet
const RealSocket = window.WebSocket;
window.WebSocket = function ShowcaseSocket(u, p) {
  if (String(u).includes('mock.supabase.test')) {
    return { readyState: 3, send() {}, close() {}, addEventListener() {}, removeEventListener() {}, set onopen(_) {}, set onclose(_) {}, set onerror(_) {}, set onmessage(_) {} };
  }
  return new RealSocket(u, p);
};
Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
