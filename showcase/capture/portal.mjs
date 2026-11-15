/**
 * Captures the HR portal (desktop) and the client portal (tablet) for the showcase video. The portal is
 * built against the stand-in Supabase API of tests/e2e.mjs (its demo records are read from that file,
 * so the video follows the portal's own tests), with a few more demo people, posts and time logs.
 *   node showcase/capture/portal.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_PEOPLE, OUT, PORTAL_PARTS, SHOTS, SHOWCASE, Shots, chromium, guardSvg, serve, sleep } from './kit.mjs';

const PORTAL = join(SHOWCASE, '..');
const MOCK = 'https://mock.supabase.test';

console.log('Building the portal against the stand-in API');
execFileSync('npx', ['vite', 'build', '--outDir', join(OUT, 'portal-dist'), '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: PORTAL, stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: 'eyJmock.anon.key', VITE_WEBSITE_URL: 'https://bannuar-website.vercel.app', VITE_PORTAL_URL: 'https://bannuar-portal.vercel.app' },
});

// the e2e suite's demo records and stand-in API, as a module
const src = readFileSync(join(PORTAL, 'tests/e2e.mjs'), 'utf8');
const from = src.indexOf('// ------------------------------------------------------------------ fixtures');
const to = src.indexOf('// ------------------------------------------------------------------ run');
mkdirSync(OUT, { recursive: true });
// its clock reads Saturday 14 November 2026, 5:52 PM in Manila (when Bea times in, in the app), and runs on
const NOW = Date.parse('2026-11-14T09:52:00Z');
const timed = src.slice(from, to).replace(/\bDate\.now\(\)/g, '__now()').replace(/new Date\(\)/g, 'new Date(__now())');
writeFileSync(join(OUT, 'portal-mock.mjs'), `import { readFileSync, writeFileSync } from 'node:fs';\nconst MOCK = '${MOCK}';\nconst __t0 = Date.now();\nconst __now = () => ${NOW} + (Date.now() - __t0);\n${timed}\nexport { T, E, RPC, api, emp, empMini, access, clientAccess, dashboard, certificate };\n`);
/** The browser's clock in the portal shots: half an hour later, the night shift on duty. */
const CLOCK = new Date('2026-11-14T18:25:00+08:00');
const M = await import(join(OUT, 'portal-mock.mjs'));
const { T, E, RPC, emp, empMini } = M;
// Bea is the Main Gate's lady guard, as in the app
E.e2.position = 'Lady Guard';
M.certificate.position = 'Lady Guard';

// ------------------------------------------------------------------ a few more demo people, posts and logs
const SITES = { s1: { id: 's1', name: 'Post A · Main Gate', city: 'San Juan' }, s2: { id: 's2', name: 'Post B · Warehouse', city: 'San Juan' }, s3: { id: 's3', name: 'Post C · Lobby', city: 'San Juan' } };
const at = (id, no, first, last, site, extra = {}) => emp(id, no, first, last, { site_id: site, site: SITES[site], sex: extra.position === 'Lady Guard' ? 'female' : 'male', ...extra });
const more = [
  at('e4', 'G-004', 'Jose', 'Ramos', 's1', { date_hired: '2021-06-01' }),
  at('e5', 'G-005', 'Ana', 'Reyes', 's1', { position: 'Lady Guard', date_hired: '2024-02-12' }),
  at('e6', 'G-006', 'Pedro', 'Bautista', 's2', { status: 'on_leave', date_hired: '2019-09-16' }),
  at('e7', 'G-007', 'Liza', 'Garcia', 's2', { position: 'Lady Guard', date_hired: '2022-03-07' }),
  at('e8', 'G-008', 'Ramon', 'Santos', 's2', { date_hired: '2020-11-02' }),
  at('e9', 'G-009', 'Mark', 'Soriano', 's3', { date_hired: '2025-01-20' }),
  at('e10', 'G-010', 'Joy', 'Mendoza', 's3', { position: 'Lady Guard', date_hired: '2023-08-14' }),
  at('e11', 'G-011', 'Noel', 'Aquino', 's3', { date_hired: '2024-10-01' }),
  emp('e12', 'O-001', 'Grace', 'Navarro', { position: 'HR Officer', is_field: false, site_id: null, site: null, date_hired: '2017-04-03' }),
];
T.employees.push(...more);
T.site_staffing = [
  { ...T.site_staffing[0], guards_assigned: 4, guards_required: 4 },
  { id: 's2', name: 'Post B · Warehouse', code: 'PB', client_id: 'c1', client_name: 'Acme Mart', area_id: 'a1', area_name: 'La Union', city: 'San Juan', province: 'La Union', guards_required: 4, is_active: true, guards_assigned: 3, supervisors: 0 },
  { id: 's3', name: 'Post C · Lobby', code: 'PC', client_id: 'c1', client_name: 'Acme Mart', area_id: 'a1', area_name: 'La Union', city: 'San Juan', province: 'La Union', guards_required: 3, is_active: true, guards_assigned: 3, supervisors: 0 },
];
const today = (h, m) => new Date(`2026-11-14T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+08:00`).toISOString();
const log = (id, e, site, kind, h, m, extra = {}) => ({
  id, employee_id: e.id, site_id: site, kind, logged_at: today(h, m), photo_path: `employees/${e.employee_no}/attendance/2026/11/selfie-${h < 12 ? 'am' : 'pm'}-${id}.jpg`, latitude: 16.6694, longitude: 120.3224, accuracy_m: 8 + (h % 7),
  distance_m: 20 + (m % 50), radius_m: 150, location_check: 'at_post', mock_location: false, source: 'self', manual_reason: null, logger: null, employee: empMini(e), site: SITES[site], ...extra,
});
const people = Object.fromEntries(T.employees.map((e) => [e.id, e]));
// the day shift (6 AM to 6 PM) in and out, the night shift in; Noel late and away from the Lobby
T.attendance_logs.push(
  log('at11', people.e4, 's1', 'time_in', 5, 52), log('at12', people.e5, 's1', 'time_in', 5, 49),
  log('at13', people.e7, 's2', 'time_in', 5, 55), log('at15', people.e9, 's3', 'time_in', 6, 2),
  log('at21', people.e4, 's1', 'time_out', 18, 4), log('at22', people.e5, 's1', 'time_out', 18, 2),
  log('at23', people.e7, 's2', 'time_out', 18, 3), log('at25', people.e9, 's3', 'time_out', 18, 1),
  log('at14', people.e8, 's2', 'time_in', 17, 58), log('at16', people.e10, 's3', 'time_in', 17, 47),
  log('at17', people.e11, 's3', 'time_in', 18, 21, { distance_m: 410, location_check: 'away' }),
);
T.attendance_logs.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
Object.assign(M.dashboard, {
  employees_by_status: { active: 10, on_leave: 1, floating: 1 }, employees_current: 12, sites_active: 3, guards_required: 11, guards_deployed: 10, sites_short: 1,
});

// test placeholders read as people and places in the video
const NAMES = [
  ['Post A · Main Gate', 'Acme Mart · Main Gate'], ['Post B · Warehouse', 'Acme Mart · Warehouse'], ['Post C · Lobby', 'Acme Mart · Lobby'],
  ['"Post A"', '"Acme Mart · Main Gate"'], ['Ana Admin', 'Ana Villanueva'], ['Hector HR', 'Hector Ramos'], ['Mia Manager', 'Mia Santiago'],
  ['Jun Desk', 'Jun Dela Paz'], ['ana@bannuar.test', 'ana.villanueva@bannuar.example'], ['@bannuar.test', '@bannuar.example'], ['@acme.test', '@acme.example'], ['acme.ph', 'acme.example'],
];
const polish = (s) => NAMES.reduce((t, [a, b]) => t.split(a).join(b), s);

async function stand(ctx) {
  // every real Supabase or AWS host is cut: the capture never touches Bannuar's live project
  await ctx.route(/^https:\/\/[a-z0-9-]+\.supabase\.co\//, (r) => r.abort('blockedbyclient'));
  await ctx.route(/amazonaws\.com\//, (r) => r.abort('blockedbyclient'));
  await ctx.route(`${MOCK}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    // time-in photos show the illustrated guard (never a real person)
    if ((path.startsWith('/s3-mock/') && /\.(jpe?g|png|webp)$/.test(path)) || (path.startsWith('/storage/v1/object/sign/') && route.request().method() === 'GET')) {
      const no = /G-\d{3}/.exec(path)?.[0] ?? E[/\/(e\d+)\//.exec(path)?.[1]]?.employee_no ?? 'G-002';
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: guardSvg({ ...(DEMO_PEOPLE[no] ?? {}), dusk: !path.includes('-am-') }) });
    }
    const wrapped = new Proxy(route, {
      get(target, key) {
        if (key === 'fulfill') return (o) => target.fulfill(typeof o.body === 'string' ? { ...o, body: polish(o.body) } : o);
        const v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    // the stand-in skips "or" filters: keep only the logs that need a look when that is what is asked
    const url = new URL(route.request().url());
    if (path === '/rest/v1/attendance_logs' && (url.searchParams.get('or') ?? '').includes('location_check.in.')) {
      const all = T.attendance_logs;
      T.attendance_logs = all.filter((r) => ['away', 'unsure', 'no_location'].includes(r.location_check) || r.mock_location === true);
      const answered = M.api(wrapped); // reads the rows before its first await
      T.attendance_logs = all;
      return answered;
    }
    return M.api(wrapped);
  });
}

const site = await serve(join(OUT, 'portal-dist'));
const browser = await chromium.launch();

// ------------------------------------------------------------------ the HR portal, on a desktop
console.log('HR portal');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true, timezoneId: 'Asia/Manila', locale: 'en-PH', colorScheme: 'light' });
  await ctx.clock.install({ time: CLOCK });
  await stand(ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Typo in the name' : undefined));
  page.on('pageerror', (e) => console.warn(`  page error: ${e.message.slice(0, 160)}`));
  const shots = new Shots('desktop', page, PORTAL_PARTS);
  const go = async (path, wait) => { await page.goto(site.url + path); await page.waitForLoadState('networkidle').catch(() => null); if (wait) await page.getByText(wait).first().waitFor(); await sleep(500); };
  const dlg = () => page.locator('dialog[open]').last();

  await go('/setup');
  await page.getByLabel('Email').fill('hector.ramos@bannuar.example');
  await page.getByLabel('Invitation code').fill('K7QM-3XPD');
  await page.getByLabel('Your name').fill('Hector Ramos');
  await page.getByLabel('Password', { exact: true }).fill('a-good-password');
  await page.getByLabel('Password again').fill('a-good-password');
  await shots.take('hr-setup', { email: page.getByLabel('Email'), code: page.getByLabel('Invitation code'), name: page.getByLabel('Your name'), password: page.getByLabel('Password', { exact: true }), make: page.getByRole('button', { name: 'Make my account' }) });
  await go('/sign-in');
  await page.getByLabel('Email').fill('ana.villanueva@bannuar.example');
  await page.getByLabel('Password').fill('right-password');
  await shots.take('hr-signin', { signin: page.getByRole('button', { name: 'Sign in' }), email: page.getByLabel('Email'), password: page.getByLabel('Password'), forgot: page.getByRole('link', { name: 'Forgot your password?' }), setup: page.getByRole('link', { name: 'Set up your account' }) });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(`${site.url}/`);
  await page.waitForLoadState('networkidle');
  await sleep(900);
  await shots.take('hr-dashboard', { jump: page.getByText('Jump to').first(), nav: page.locator('.nav'), bell: page.getByRole('button', { name: /^Notifications/ }), waiting: page.locator('.panel', { hasText: 'Waiting for you' }).first() });
  await page.mouse.wheel(0, 700);
  await shots.take('hr-dashboard-2', {}, { settle: 700 });

  await go('/employees');
  await shots.take('hr-employees', { first: page.getByRole('link', { name: 'Bea Lim' }).first(), add: page.getByRole('button', { name: 'Add an employee' }), search: page.getByRole('searchbox').first() });
  await go('/employees/e2');
  await shots.take('hr-employee', { tabs: page.getByRole('tablist').first(), edit: page.getByRole('button', { name: 'Edit the profile' }) });
  await go('/employees/e2?tab=documents');
  await shots.take('hr-employee-docs', { claude: page.getByText(/Claude/).first(), verify: page.getByRole('button', { name: 'Verify' }).first(), adddoc: page.getByRole('button', { name: 'Add a document' }) });
  await go('/employees/e2?tab=account');
  await shots.take('hr-employee-account', { temp: page.getByRole('button', { name: 'Give a temporary password' }), tabs: page.getByRole('tablist').first() });
  await go('/employees/e1?tab=deployment');
  await page.getByText('Assignment history').waitFor();
  await page.mouse.wheel(0, 500);
  await shots.take('hr-employee-deploy', { history: page.locator('.panel', { hasText: 'Assignment history' }) }, { settle: 700 });

  await go('/posts');
  await shots.take('hr-posts', { addpost: page.getByRole('button', { name: 'Add a post' }), tabs: page.getByRole('tablist').first() });
  await go('/posts/s1');
  await shots.take('hr-post', { deploy: page.getByRole('button', { name: 'Deploy guards here' }), edit: page.getByRole('button', { name: 'Edit the post' }), guards: page.locator('.panel', { hasText: 'Guards at this post' }).first(), location: page.locator('.panel', { hasText: 'Location for time in and out' }).first() });
  await page.getByRole('button', { name: 'Deploy guards here' }).click();
  await sleep(600);
  await dlg().getByRole('checkbox').first().check();
  await sleep(300);
  await shots.take('hr-deploy', { pick: dlg().getByRole('checkbox').first(), deploy: dlg().getByRole('button', { name: /^Deploy \d/ }) });
  await page.keyboard.press('Escape');
  await page.mouse.wheel(0, 900);
  await shots.take('hr-post-pay', { pay: page.locator('.panel', { hasText: 'Pay at this post' }) }, { settle: 700 });

  await go('/attendance');
  await page.locator('.thumb img').first().waitFor();
  await sleep(600);
  await shots.take('hr-attendance', { away: page.getByText('Away from the post').first(), bea: page.getByRole('row', { name: /Bea Lim/ }).first(), which: page.getByLabel('Which logs'), manual: page.getByRole('button', { name: 'Add a manual log' }), photo: page.locator('.thumb').first() });
  await page.locator('.thumb').first().click();
  await sleep(700);
  await shots.take('hr-attendance-log', { dialog: dlg() });
  await page.keyboard.press('Escape');

  await go('/requests?tab=leave');
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await sleep(500);
  await shots.take('hr-leave-approve', { save: page.getByRole('button', { name: 'Save the decision' }) });
  await page.keyboard.press('Escape');
  await go('/requests?tab=coe');
  await shots.take('hr-coe', { issue: page.getByRole('button', { name: 'Issue', exact: true }), overdue: page.getByText('Overdue').first() });
  await page.getByRole('button', { name: 'Issue', exact: true }).click();
  await sleep(600);
  await dlg().getByLabel('Signed by').fill('Hector Ramos');
  await dlg().getByLabel('Title').fill('HR Manager');
  await dlg().getByLabel('Compensation as printed').fill('₱540.00 a day');
  await shots.take('hr-coe-issue', { issue: page.getByRole('button', { name: 'Issue the certificate' }), signed: dlg().getByLabel('Signed by'), comp: dlg().getByLabel('Compensation as printed') });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Issue the certificate' }).click();
  const pdf = join(OUT, 'coe.pdf');
  await (await download).saveAs(pdf);
  execFileSync('pdftoppm', ['-r', '200', '-png', '-singlefile', pdf, join(SHOTS, 'hr-coe-pdf')]);
  console.log('  shot hr-coe-pdf (the certificate the portal made)');
  await sleep(400);
  await page.keyboard.press('Escape');

  await go('/requests?tab=changes');
  await shots.take('hr-changes', { apply: page.getByRole('button', { name: 'Apply' }).first(), tabs: page.getByRole('tablist').first() });
  await go('/requests?tab=concerns');
  await shots.take('hr-concerns', { answer: page.getByRole('button', { name: 'Answer' }).first(), tabs: page.getByRole('tablist').first() });
  await go('/requests?tab=clients');
  await shots.take('hr-client-requests', { tabs: page.getByRole('tablist').first() });
  await go('/compliance');
  await shots.take('hr-compliance', { tabs: page.getByRole('tablist').first() });

  await go('/settings');
  await page.getByRole('tab', { name: 'Pay rules and rates' }).click();
  await page.getByText('Agency default', { exact: true }).waitFor();
  await shots.take('hr-pay-rules', { edit: page.getByRole('row', { name: /Acme Mart standard/ }).getByRole('button', { name: 'Edit' }), tabs: page.getByRole('tablist').first() });
  await page.getByRole('row', { name: /Acme Mart standard/ }).getByRole('button', { name: 'Edit' }).click();
  await dlg().getByText('Example: ₱100.00 an hour').waitFor();
  await shots.take('hr-pay-rule', { formula: dlg().getByLabel('Line 3 formula'), example: dlg().locator('.callout').first() });
  await dlg().locator('.dialog-body').evaluate((e) => e.scrollBy(0, 420));
  await shots.take('hr-pay-rule-2', { example: dlg().locator('.callout').first() });
  await page.keyboard.press('Escape');

  await go('/payroll');
  await shots.take('hr-payroll', { new: page.getByRole('button', { name: 'New cutoff' }) });
  await go('/payroll/p1');
  await shots.take('hr-cutoff', { work: page.getByRole('button', { name: 'Work out pay' }), import: page.getByRole('button', { name: 'Import the payroll file' }), publish: page.getByRole('button', { name: 'Publish to employees' }) });
  await page.mouse.wheel(0, 650);
  await shots.take('hr-cutoff-2', { ask: page.getByRole('button', { name: /Ask the client to confirm/ }), count: page.getByRole('button', { name: /^Count\b/ }).first(), notcount: page.getByRole('button', { name: /^Do not count/ }).first() }, { settle: 700 });
  await page.mouse.wheel(0, -2000);
  await page.getByRole('button', { name: 'Import the payroll file' }).click();
  await sleep(600);
  await shots.take('hr-import', { template: dlg().getByRole('button', { name: 'Download the template' }), file: dlg().getByLabel('Payroll file (CSV)') });
  await page.keyboard.press('Escape');
  await sleep(300);
  await page.getByRole('button', { name: 'Work out pay' }).click();
  await dlg().getByText('Payslips ready').waitFor();
  await sleep(500);
  await shots.take('hr-work-out-pay', { ready: dlg().locator('.tiles'), fill: dlg().getByRole('button', { name: 'Fill the days from time in and out' }), sheet: dlg().getByRole('button', { name: 'Download the attendance sheet' }), save: dlg().getByRole('button', { name: /^Save \d+ payslip/ }) });
  await page.keyboard.press('Escape');
  await go('/payroll/13th-month');
  await page.getByText('Dante Cruz').first().waitFor();
  await sleep(500);
  await shots.take('hr-13th', { dante: page.getByText('Dante Cruz').first(), create: page.getByRole('button', { name: 'Create the payout cutoff' }), tabs: page.getByRole('tablist').first() });

  await go('/discipline?tab=code');
  await shots.take('hr-discipline-code', { upload: page.getByRole('button', { name: 'Upload the code (PDF)' }), inforce: page.getByRole('button', { name: 'Put this code in force' }), tabs: page.getByRole('tablist').first() });
  await go('/discipline?tab=cases');
  await shots.take('hr-discipline-cases', { open: page.getByRole('button', { name: 'Open a case' }).first(), tabs: page.getByRole('tablist').first() });
  await go('/discipline?tab=reports');
  await shots.take('hr-reports', { file: page.getByRole('button', { name: 'File a report' }), first: page.getByRole('button', { name: 'Guard asleep at the gate' }) });
  await page.getByRole('button', { name: 'Guard asleep at the gate' }).click();
  await sleep(600);
  await shots.take('hr-report', { status: dlg().getByLabel('Status'), update: dlg().getByLabel(/Update for the client/), opencase: dlg().getByRole('button', { name: 'Open a case from this report' }) });
  await page.keyboard.press('Escape');
  await go('/discipline?tab=cases&case=case3');
  await sleep(600);
  await shots.take('hr-discipline-case', { dialog: dlg() });
  await page.keyboard.press('Escape');

  await go('/announcements');
  await shots.take('hr-announcements', { write: page.getByRole('button', { name: 'Write an announcement' }) });
  await page.getByRole('button', { name: 'Write an announcement' }).click();
  await sleep(500);
  await dlg().getByLabel('Title').fill('Uniform inspection on Monday');
  await dlg().getByLabel('Message').fill('All posts: complete uniform and ID at the 7 AM change of shift. Commanders, report who is missing.');
  await shots.take('hr-announce-write', { audience: dlg().getByLabel('Who it is for'), publish: dlg().getByRole('button', { name: 'Publish now' }), draft: dlg().getByRole('button', { name: 'Save as a draft' }) });
  await page.keyboard.press('Escape');
  await sleep(300);
  await go('/recruitment');
  await page.getByRole('button', { name: 'Abad, Rico' }).click();
  await sleep(500);
  await shots.take('hr-recruitment', { hire: page.getByRole('button', { name: 'Hire' }), file: page.getByRole('button', { name: 'Open the attached file' }) });
  await go('/inquiries');
  await shots.take('hr-inquiries', {});
  await go('/users');
  await shots.take('hr-users', { invite: page.getByRole('button', { name: 'Invite someone' }), roles: page.getByRole('button', { name: 'Change roles' }).first() });
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await sleep(500);
  await dlg().getByLabel('Name').fill('Hector Ramos');
  await dlg().getByLabel('Email').fill('hector.ramos@bannuar.example');
  await shots.take('hr-invite', { name: dlg().getByLabel('Name'), email: dlg().getByLabel('Email'), make: dlg().getByRole('button', { name: 'Make the invitation' }) });
  await page.keyboard.press('Escape');
  await sleep(300);
  await go('/audit');
  await shots.take('hr-audit', {});
  await go('/posts');
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByRole('button', { name: 'Portal access' }).first().click();
  await dlg().getByText('Mia Santiago').waitFor();
  await shots.take('hr-client-access', { dialog: dlg(), name: dlg().getByLabel('Name'), email: dlg().getByLabel('Email'), invite: dlg().getByRole('button', { name: 'Invite to the client portal' }), off: dlg().getByRole('button', { name: 'Turn off' }).first() });
  shots.save();
  await ctx.close();
}

// ------------------------------------------------------------------ the client portal, on a tablet
console.log('Client portal');
{
  RPC.my_access = () => M.clientAccess;
  const g = (e, onDuty) => ({ id: e.id, name: `${e.first_name} ${e.last_name}`, position: e.position, on_duty_since: onDuty });
  const posts = RPC.client_overview().posts;
  RPC.client_overview = () => ({
    client: { id: 'c1', name: 'Acme Mart' },
    posts: [
      { ...posts[0], guards_required: 4, guards: [g(people.e2, today(17, 52)), g(people.e1, today(17, 52)), g(people.e4, null), g(people.e5, null)] },
      { ...posts[0], id: 's2', name: 'Post B · Warehouse', city: 'San Juan', guards_required: 4, guards: [g(people.e8, today(17, 58)), g(people.e7, null), g(people.e6, null)] },
      { ...posts[0], id: 's3', name: 'Post C · Lobby', city: 'San Juan', guards_required: 3, guards: [g(people.e10, today(17, 47)), g(people.e11, today(18, 21)), g(people.e9, null)] },
    ],
  });
  RPC.client_attendance = () => T.attendance_logs.filter((l) => l.site_id).map((l) => ({
    post: SITES[l.site_id].name, guard: `${l.employee.first_name} ${l.employee.last_name}`, kind: l.kind, logged_at: l.logged_at, at_post: l.location_check === 'at_post', by: l.source === 'self' ? 'self' : 'commander',
  }));
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, timezoneId: 'Asia/Manila', locale: 'en-PH', colorScheme: 'light' });
  await ctx.clock.install({ time: CLOCK });
  await stand(ctx);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'No guard at the gate after 2 PM; we called your office' : undefined));
  const shots = new Shots('tablet', page, PORTAL_PARTS);
  // signed in already (the client opens the portal from the tablet's home screen)
  await page.goto(`${site.url}/sign-in`);
  await page.getByLabel('Email').fill('mia.santiago@acme.example');
  await page.getByLabel('Password').fill('right-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('.client').waitFor();
  await page.getByText('On duty since').first().waitFor();
  await sleep(600);
  const tab = async (name) => { await page.locator('.client-tab', { hasText: name }).click(); await sleep(800); };
  await shots.take('client-posts', { onduty: page.getByText('On duty since').first(), bea: page.getByText('Bea Lim', { exact: true }).first(), tabs: page.locator('.client-tabs') });
  await tab('Attendance');
  await shots.take('client-attendance', { day: page.getByLabel('Day') });
  await tab('Incident reports');
  await shots.take('client-reports', { report: page.getByRole('button', { name: 'Report an incident' }) });
  await page.getByRole('button', { name: 'Report an incident' }).click();
  await sleep(500);
  await page.locator('dialog[open]').getByLabel('What it is about').fill('Guard on the phone at the gate');
  await page.locator('dialog[open]').getByLabel('What happened').fill('The guard at the main gate was on the phone for most of the afternoon.');
  await shots.take('client-report-form', { send: page.locator('dialog[open]').getByRole('button', { name: 'Send the report' }) });
  await page.keyboard.press('Escape');
  await sleep(300);
  await tab('Requests');
  await shots.take('client-requests', { ask: page.getByRole('button', { name: 'Ask for something' }) });
  await page.getByRole('button', { name: 'Ask for something' }).click();
  await sleep(500);
  await page.locator('dialog[open]').getByLabel('How many guards').fill('2');
  await page.locator('dialog[open]').getByLabel('Details').fill('Two more guards for the Christmas sale, 8 AM to 10 PM, from December 1.');
  await shots.take('client-request-form', { send: page.locator('dialog[open]').getByRole('button', { name: 'Send the request' }) });
  await page.keyboard.press('Escape');
  await sleep(300);
  await tab('Cutoffs to confirm');
  await page.getByText('Confirm or dispute by').waitFor();
  await shots.take('client-cutoff', { dispute: page.getByRole('button', { name: /^Dispute Dante Cruz/ }), confirm: page.getByRole('button', { name: 'Confirm the cutoff' }) });
  await page.getByRole('button', { name: /^Dispute Dante Cruz/ }).click();
  await page.getByRole('button', { name: 'Send with 1 disputed' }).waitFor();
  await shots.take('client-cutoff-disputed', { send: page.getByRole('button', { name: 'Send with 1 disputed' }) });
  shots.save();
  await ctx.close();
}

await browser.close();
site.close();
console.log('Portals captured.');
