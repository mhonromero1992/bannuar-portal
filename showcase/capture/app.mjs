/**
 * Captures the real employee app (built for the browser by app-web/build.mjs) as the guard and as the
 * commander, at phone size, on a Saturday evening in Manila before the night shift. Demo data only.
 *   node showcase/capture/app.mjs
 */
import { join } from 'node:path';
import { DEMO_PEOPLE, OUT, Shots, chromium, guardSvg, serve, sleep, svgData, svgString } from './kit.mjs';

const site = await serve(join(OUT, 'app-web'));
const browser = await chromium.launch();

async function phone({ as = 'guard', scheme = 'light', time = '2026-11-14T17:52:00+08:00' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 763 }, deviceScaleFactor: 3, colorScheme: scheme, timezoneId: 'Asia/Manila', locale: 'en-PH' });
  await ctx.clock.install({ time: new Date(time) });
  // the photo the camera takes: the guard herself (Bea), or the guard the commander logs for (Carlo)
  const camera = svgString(guardSvg({ ...DEMO_PEOPLE[as === 'commander' ? 'G-003' : 'G-002'], dusk: as !== 'commander' }));
  await ctx.addInitScript(([cam, library]) => { window.__showcasePhotos = { camera: cam, library }; }, [camera, svgData('license.svg')]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn(`  page error: ${e.message.slice(0, 200)}`));
  await page.goto(`${site.url}/index.html?as=${as}`);
  await page.getByText('Employee number').waitFor();
  // tab screens stay mounted behind the one in view: only ever pick what is visible
  const btn = (name, exact = true) => page.getByRole('button', { name, exact }).filter({ visible: true }).last();
  const txt = (t, exact = false) => page.getByText(t, { exact }).filter({ visible: true }).first();
  // scroll the screen in view: the scroll area under the middle of the phone
  const scroll = async (dy) => {
    await page.evaluate((by) => {
      let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      while (el && !(/(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4)) el = el.parentElement;
      el?.scrollBy({ top: by });
    }, dy);
    await sleep(500);
  };
  // a confirmation stays five seconds: wait for it to go before the next screen
  const waitToast = async () => { await page.getByRole('alert').filter({ visible: true }).first().waitFor({ state: 'hidden', timeout: 8000 }).catch(() => null); await sleep(200); };
  const back = async () => { await page.getByRole('button', { name: 'Back' }).filter({ visible: true }).last().click(); await sleep(700); };
  const tab = async (name) => { await page.getByText(name, { exact: true }).last().click(); await sleep(900); };
  return { ctx, page, btn, txt, scroll, back, tab, waitToast };
}

async function signIn(ui, shots, number, prefix) {
  const { page, btn } = ui;
  const inputs = page.locator('input');
  if (shots) await shots.take(`${prefix}-signin`, { number: inputs.nth(0), password: inputs.nth(1), activate: btn('First time? Activate your account'), forgot: btn('Forgot your password?') });
  if (shots && prefix === 'app') {
    // the first-time activation screen, filled with Bea's details on file (shown, never sent)
    try {
      await btn('First time? Activate your account').click();
      await sleep(900);
      const field = (label) => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();
      await field('Employee number').fill('G-002');
      await field('Birthdate, day').fill('12');
      await page.getByRole('button', { name: /^Month/ }).filter({ visible: true }).first().click();
      await sleep(500);
      await page.getByRole('radio', { name: 'March' }).click();
      await sleep(400);
      await field('Birthdate, year').fill('1996');
      await field('Mobile number').fill('0917 555 0102');
      await field('New password').fill('a-good-password');
      await field('New password again').fill('a-good-password');
      await shots.take('app-activate', { number: field('Employee number'), birthdate: page.getByLabel('Birthdate', { exact: true }).filter({ visible: true }).first(), mobile: field('Mobile number'), password: field('New password'), activate: btn('Activate') });
      await ui.back();
    } catch (e) {
      console.warn(`  (activation screen not captured: ${e.message.slice(0, 120)})`);
      await page.goto(page.url());
      await page.getByText('Employee number').waitFor();
    }
  }
  await inputs.nth(0).fill(number);
  await inputs.nth(1).fill('a-good-password');
  if (shots) await shots.take(`${prefix}-signin-filled`, { signin: btn('Sign in') });
  await btn('Sign in').click();
  await page.getByText('ATTENDANCE').first().waitFor();
  await sleep(900);
}

// ------------------------------------------------------------------ the guard
console.log('The guard: Bea Lim, Main Gate, night shift');
{
  const ui = await phone();
  const { page, btn, txt, scroll, back, tab, waitToast } = ui;
  const shots = new Shots('phone', page);
  await signIn(ui, shots, 'G-002', 'app');
  await shots.take('app-home', { timein: btn('Time in'), bell: page.getByRole('button', { name: /notification/i }).filter({ visible: true }).first(), notice: txt('A notice waits for you'), tabbar: page.getByRole('tablist').filter({ visible: true }).first(), post: txt('YOUR POST') });

  // time in: location, photo, logged
  await btn('Time in').click();
  await sleep(250);
  await shots.take('app-timein-locating', {}, { settle: 50 });
  await txt('At the post', true).waitFor();
  await shots.take('app-timein-located', { atpost: txt('At the post', true), photo: btn('Take my photo') });
  await btn('Take my photo').click();
  await sleep(700);
  await shots.take('app-timein-photo', { log: btn('Log time in') });
  await btn('Log time in').click();
  await txt('Time in logged').waitFor();
  await shots.take('app-timein-logged', { done: btn('Done') });
  await btn('Done').click();
  await txt('Timed in at').waitFor();
  await shots.take('app-home-in', { status: txt('Timed in at'), timeout: btn('Time out') });

  // the rest of Home: the payslip hidden until tapped
  await scroll(430);
  await shots.take('app-home-more', { show: txt('Tap to show') });
  await txt('Tap to show').click();
  await sleep(500);
  await shots.take('app-home-pay', { net: txt('Net pay'), open: btn('Open the payslip') });
  await scroll(-1000);

  // payslips
  await tab('Payslips');
  await shots.take('app-payslips', { first: txt('Oct 16 to 31, 2026') });
  await txt('Oct 16 to 31, 2026').click();
  await sleep(900);
  await shots.take('app-payslip-hidden', { eye: btn('Show the amounts') });
  await btn('Show the amounts').click();
  await sleep(500);
  await shots.take('app-payslip', { net: txt('Net pay') });
  await scroll(520);
  await shots.take('app-payslip-lines', { report: btn('Report a concern', false) });
  await back();

  // leave
  await tab('Leave');
  await shots.take('app-leave', { file: btn('File leave') });
  await btn('File leave').click();
  await sleep(800);
  await page.getByRole('button', { name: /Kind of leave/ }).click();
  await sleep(600);
  await shots.take('app-leave-kinds', { sil: page.getByRole('radio', { name: /Service incentive leave/ }) });
  await page.getByRole('radio', { name: /Service incentive leave/ }).click();
  await sleep(500);
  const month = async (i, name) => { await page.getByRole('button', { name: /^Month/ }).nth(i).click(); await sleep(500); await page.getByRole('radio', { name }).click(); await sleep(400); };
  await page.getByLabel('First day, day').fill('24');
  await month(0, 'November');
  await page.getByLabel('First day, year').fill('2026');
  await page.getByLabel('Last day, day').fill('25');
  await month(1, 'November');
  await page.getByLabel('Last day, year').fill('2026');
  await page.getByLabel('Reason (optional)').fill("My son's school program");
  await shots.take('app-leave-form', { submit: btn('File leave') });
  await btn('File leave').click();
  await sleep(1400);
  await shots.take('app-leave-filed', { request: txt('With the commander') });
  await waitToast();

  // certificates of employment
  await tab('More');
  await shots.take('app-more', { coe: txt('Certificates of employment'), records: txt('My records'), notices: txt('Notices from HR'), announcements: txt('Announcements', true), concerns: txt('Payroll concerns', true), documents: txt('Licenses and documents', true), details: txt('Change my details', true), account: txt('Account', true) });
  await txt('Certificates of employment').click();
  await sleep(900);
  await shots.take('app-coe', { request: btn('Request a certificate'), open: btn('Open the certificate') });
  await btn('Request a certificate').click();
  await sleep(800);
  await page.getByRole('button', { name: /What is it for/ }).click();
  await sleep(600);
  await page.getByRole('radio').nth(1).click();
  await sleep(500);
  await page.getByLabel('Addressed to (optional)').fill('BDO Unibank, San Juan branch');
  await shots.take('app-coe-form', { submit: btn('Request a certificate') });
  await btn('Request a certificate').click();
  await sleep(1400);
  await shots.take('app-coe-requested', { pending: txt('Pending', true) });
  await waitToast();
  await btn('Open the certificate').click();
  await sleep(900);
  await shots.take('app-cert', { code: txt('K7QM-3XPD-8RTA') });
  await back();
  await back();

  // announcements
  await txt('Announcements', true).click();
  await sleep(900);
  await shots.take('app-announcements', { first: txt('Fire and earthquake drill on Friday') });
  await txt('Fire and earthquake drill on Friday').click();
  await sleep(900);
  await shots.take('app-announcement', { ack: btn('I acknowledge') });
  await btn('I acknowledge').click();
  await sleep(1000);
  await waitToast();
  await shots.take('app-announcement-acked', {});
  await back();
  await back();

  // my records: the license renewal, read by Claude
  await txt('Licenses and documents').click();
  await sleep(900);
  await shots.take('app-documents', { lesp: txt('Security guard license (LESP)'), upload: btn('Upload a renewal') });
  await btn('Upload a renewal').first().click();
  await sleep(900);
  await page.getByRole('button', { name: /^Document:/ }).filter({ visible: true }).first().click();
  await sleep(600);
  await page.getByRole('radio', { name: /Security guard license/ }).click();
  await sleep(600);
  await shots.take('app-upload', { photo: btn('Take a photo', false) });
  await btn('Take a photo', false).click();
  await sleep(500);
  await shots.take('app-upload-reading', {}, { settle: 100 });
  await txt('R01-202611-008842').waitFor({ timeout: 8000 }).catch(() => null);
  await sleep(600);
  await shots.take('app-upload-checked', { send: btn('Send to HR') });
  await scroll(500);
  await shots.take('app-upload-checked-2', { send: btn('Send to HR') });
  await back();
  await back();

  // notices from HR
  await txt('Notices from HR').click();
  await sleep(900);
  await shots.take('app-notices', { first: txt('Tardiness') });
  await txt('Tardiness').click();
  await sleep(900);
  await shots.take('app-notice', { received: btn('I received this notice'), by: txt('Answer by') });
  await btn('I received this notice').click();
  await sleep(1000);
  await waitToast();
  await page.locator('textarea').first().fill('A jeepney broke down on the national highway and I walked the last two kilometers. I called my commander at 6:05 PM.');
  await sleep(300);
  await shots.take('app-notice-explain', { send: btn('Send my explanation') });
  await back();
  await back();

  // notifications
  await tab('Home');
  await page.getByRole('button', { name: /notification/i }).filter({ visible: true }).first().click();
  await sleep(900);
  await shots.take('app-notifications', {});
  shots.save();
  await ui.ctx.close();
}

// ------------------------------------------------------------------ dark mode, the same guard after dark
console.log('Dark mode');
{
  const ui = await phone({ scheme: 'dark', time: '2026-11-14T21:10:00+08:00' });
  const shots = new Shots('phone', ui.page);
  await signIn(ui, null, 'G-002');
  await shots.take('app-home-dark', {});
  shots.save();
  await ui.ctx.close();
}

// ------------------------------------------------------------------ the commander
console.log('The commander: Dante Cruz, detachment commander of the Main Gate');
{
  const ui = await phone({ as: 'commander', time: '2026-11-14T06:20:00+08:00' });
  const { page, btn, txt, back, scroll, waitToast } = ui;
  const shots = new Shots('phone', page);
  await signIn(ui, null, 'G-001');
  await shots.take('cmd-home', { mypost: txt('My post', true) });
  await txt('My post', true).click();
  await sleep(1100);
  await shots.take('cmd-mypost', { leave: txt('Ana Reyes'), guard: txt('Carlo Diaz'), report: btn('Report an incident') });
  await txt('Ana Reyes').click();
  await sleep(900);
  await page.getByRole('button', { name: /Reliever/ }).click();
  await sleep(600);
  await page.getByRole('radio', { name: /Jose Ramos/ }).click();
  await sleep(500);
  await shots.take('cmd-endorse', { endorse: btn('Endorse to HR') });
  await btn('Endorse to HR').click();
  await sleep(1200);
  await shots.take('cmd-endorsed', { guard: txt('Carlo Diaz') });
  await waitToast();
  await txt('Carlo Diaz').click();
  await sleep(900);
  await shots.take('cmd-guard', { log: btn('Log time in for them') });
  await btn('Log time in for them').click();
  await txt('At the post', true).waitFor();
  await btn("Take the guard's photo").click();
  await sleep(700);
  await shots.take('cmd-log-for', { log: btn('Log time in') });
  await back();
  await back().catch(() => null);
  await page.getByRole('button', { name: 'Report an incident' }).last().click();
  await sleep(900);
  await page.getByLabel('Title').fill('Gate barrier stuck open');
  await page.getByLabel('What happened').fill('The vehicle barrier at the main gate stayed open from 5:40 AM. Guard on foot control until the technician comes.');
  await scroll(-2000);
  await shots.take('cmd-incident', { send: btn('Send to HR') });
  shots.save();
  await ui.ctx.close();
}

await browser.close();
site.close();
console.log('App captured.');
