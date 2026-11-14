/**
 * Captures the public website (bannuar-website, built with `npm run build`) for the showcase video.
 * Its calls to Bannuar's Supabase project are answered here in the browser with demo answers; nothing
 * reaches the live project.   WEBSITE_DIR=/path/to/bannuar-website node showcase/capture/website.mjs
 */
import { join, resolve } from 'node:path';
import { SHOWCASE, Shots, WEBSITE_PARTS, chromium, serve, sleep } from './kit.mjs';

const WEBSITE = resolve(process.env.WEBSITE_DIR || join(SHOWCASE, '../../bannuar-website'));
const site = await serve(join(WEBSITE, 'dist'));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const OPENINGS = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Security Guard', location: 'San Fernando, La Union', employment_type: 'full_time', summary: 'Day and night shifts at a commercial post. Licensed guards with a valid LESP.', qualifications: ['Licensed (LESP)', 'Senior high school graduate'], requirements: ['NBI clearance', 'Drug test result'], slots: 4, closes_on: '2026-12-15' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Lady Guard', location: 'San Juan, La Union', employment_type: 'full_time', summary: 'Lobby and inspection duty at a retail post.', qualifications: ['Licensed (LESP)'], requirements: ['NBI clearance'], slots: 2, closes_on: null },
  { id: '33333333-3333-4333-8333-333333333333', title: 'Reliever Guard', location: 'Bauang, La Union', employment_type: 'reliever', summary: 'Covers posts on rest days and leave.', qualifications: [], requirements: [], slots: null, closes_on: null },
];
const CERTIFICATE = { status: 'valid', certificate_no: 'COE-2026-000001', employee_name: 'Bea Lim', position: 'Lady Guard', date_hired: '2023-01-10', date_separated: null, issued_at: '2026-11-14T10:20:00Z' };

async function stand(ctx) {
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });
  await ctx.route(/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\//, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    await sleep(250);
    if (path === '/rest/v1/job_openings') return json(route, 200, OPENINGS);
    if (path === '/rest/v1/rpc/verify_certificate') return json(route, 200, JSON.parse(req.postData() || '{}').p_code?.replace(/[^A-Z0-9]/gi, '').toUpperCase() === 'K7QM3XPD8RTA' ? CERTIFICATE : { status: 'not_found' });
    if (path === '/rest/v1/job_applications' || path === '/rest/v1/inquiries') return route.fulfill({ status: 201, body: '' });
    if (path.startsWith('/storage/v1/object/applications/')) return json(route, 200, { Key: 'applications/incoming/demo.pdf' });
    return route.abort('blockedbyclient');
  });
}

/** clock: Saturday evening in Manila, as in the portal and the app. The 3D night scene does not run
 *  under a fake clock (its frames stall), so shots with a clock also turn motion off (no 3D scene). */
async function open(viewport, dsf, { clock = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, timezoneId: 'Asia/Manila', locale: 'en-PH', colorScheme: 'light', reducedMotion: clock ? 'reduce' : 'no-preference' });
  if (clock) await ctx.clock.install({ time: new Date('2026-11-14T18:40:00+08:00') });
  await stand(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.warn(`  page error: ${e.message.slice(0, 160)}`));
  return { ctx, page };
}
const toSection = async (page, sel, offset = 0) => {
  await page.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY + o); }, [sel, offset]);
  await sleep(1400);
};

console.log('Website, desktop');
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 2);
  const shots = new Shots('desktop', page, WEBSITE_PARTS);
  await page.goto(`${site.url}/`, { waitUntil: 'networkidle' });
  await sleep(6000); // the night scene loads when the browser is idle
  await shots.take('web-hero', {});
  const heroH = await page.evaluate(() => document.querySelector('.hero').offsetHeight);
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(heroH * 0.45));
  await sleep(2500);
  await shots.take('web-hero-mid', {});
  shots.save();
  await ctx.close();
}
{
  const { ctx, page } = await open({ width: 1440, height: 900 }, 2, { clock: true });
  const shots = new Shots('desktop', page, WEBSITE_PARTS);
  await page.goto(`${site.url}/`, { waitUntil: 'networkidle' });
  await sleep(1500);
  await toSection(page, '#companies');
  await shots.take('web-companies', {});
  await toSection(page, '#careers');
  await shots.take('web-careers-home', {});
  await toSection(page, '#verify');
  await shots.take('web-verify-home', {});

  await page.goto(`${site.url}/careers/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.opening');
  await sleep(800);
  await shots.take('web-careers', {});
  await page.locator('.opening').first().evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 160));
  await sleep(900);
  await shots.take('web-openings', { pick: page.locator('[data-pick="22222222-2222-4222-8222-222222222222"]') });
  await page.locator('[data-pick="22222222-2222-4222-8222-222222222222"]').click();
  await sleep(900);
  await page.fill('#a-first', 'Rica');
  await page.fill('#a-last', 'Abad');
  await page.fill('#a-mobile', '0918 222 3333');
  await page.fill('#a-city', 'Agoo');
  await page.locator('label.choice__item:has(input[name="has_license"][value="yes"])').click();
  await page.fill('#a-lic-no', 'R01-202503-001122');
  await page.setInputFiles('#a-file', { name: 'Rica Abad resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });
  await page.locator('form[data-form="application"] .consent-field input').check();
  await page.locator('form[data-form="application"] [type="submit"]').scrollIntoViewIfNeeded();
  await sleep(500);
  await shots.take('web-apply', { send: page.locator('form[data-form="application"] [type="submit"]') });
  await page.locator('form[data-form="application"] [type="submit"]').click();
  await page.waitForSelector('#application-done:not([hidden])', { timeout: 8000 });
  await page.locator('#application-done').scrollIntoViewIfNeeded();
  await sleep(700);
  await shots.take('web-applied', { done: page.locator('#application-done') });

  await page.goto(`${site.url}/proposal/`, { waitUntil: 'networkidle' });
  await sleep(800);
  await page.fill('#p-company', 'Acme Mart');
  await page.fill('#p-name', 'Lorna Cruz');
  await page.fill('#p-phone', '0917 555 0101');
  await page.locator('.consent-field input').check();
  await sleep(400);
  await shots.take('web-proposal', { send: page.locator('form[data-form="proposal"] [type="submit"]') });

  await page.goto(`${site.url}/verify/?code=K7QM-3XPD-8RTA`, { waitUntil: 'networkidle' });
  await page.locator('#page-verify-result').filter({ hasText: /Bea Lim/ }).waitFor({ timeout: 8000 }).catch(() => null);
  await page.locator('#page-verify-result').evaluate((e) => window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - 330));
  await sleep(900);
  await shots.take('web-verify', { result: page.locator('#page-verify-result') });
  shots.save();
  await ctx.close();
}

console.log('Website, phone');
{
  const { ctx, page } = await open({ width: 390, height: 844 }, 3);
  const shots = new Shots('phone-web', page);
  await page.goto(`${site.url}/`, { waitUntil: 'networkidle' });
  await sleep(6000);
  await shots.take('web-phone', {});
  await toSection(page, '#careers');
  await shots.take('web-phone-careers', {});
  shots.save();
  await ctx.close();
}

await browser.close();
site.close();
console.log('Website captured.');
