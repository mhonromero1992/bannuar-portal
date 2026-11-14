/**
 * Shared by the showcase captures: a static file server, and Shots, which saves each screenshot with
 * the boxes of the things the video points at (marks), into showcase/.out/shots and manifest.json.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHOWCASE = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const OUT = join(SHOWCASE, '.out');
export const SHOTS = join(OUT, 'shots');
export const { chromium } = createRequire(import.meta.url)('playwright');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

/** Serve a folder (single-page apps fall back to index.html). Resolves to { url, close }. */
export function serve(dir, port = 0) {
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = join(dir, path);
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) file = join(dir, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    }).listen(port, '127.0.0.1', () => done({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}

export const svgData = (file) => `data:image/svg+xml;base64,${readFileSync(join(SHOWCASE, 'assets', file)).toString('base64')}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Screenshots of one device with their marks. */
/** Parts of a screen the video can zoom into, found on every shot: name prefix → selector. */
export const PORTAL_PARTS = { head: '.page-head', tabs: '.tabs, .client-tabs', tiles: '.tiles', panel: '.panel', table: 'table', dialog: 'dialog[open]', callout: '.callout', grid: '.client-grid', toolbar: '.toolbar' };
export const WEBSITE_PARTS = { form: 'form', opening: '.opening', h1: 'h1', h2: 'h2', card: '.card, .panel' };

export class Shots {
  constructor(device, page, parts = {}) {
    this.device = device;
    this.page = page;
    this.parts = parts;
    this.taken = {};
    mkdirSync(SHOTS, { recursive: true });
  }

  /** marks: { name: Locator | {x,y,w,h} } in CSS pixels of the viewport */
  async take(id, marks = {}, { settle = 350 } = {}) {
    await sleep(settle);
    const vp = this.page.viewportSize();
    const boxes = {};
    for (const [name, m] of Object.entries(marks)) {
      if (!m) continue;
      if (typeof m.boundingBox === 'function') {
        const b = await m.boundingBox().catch(() => null);
        if (b) boxes[name] = { x: b.x, y: b.y, w: b.width, h: b.height };
        else console.warn(`  (mark ${name} of ${id} not found)`);
      } else boxes[name] = m;
    }
    // every visible part of the screen, so the video can zoom into it by name (panel0, table1, ...)
    for (const [prefix, selector] of Object.entries(this.parts)) {
      const found = await this.page.evaluate(([sel, w, h]) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < h && r.right > 0 && r.left < w)
        .slice(0, 8).map((r) => ({ x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(w, r.right) - Math.max(0, r.left), h: Math.min(h, r.bottom) - Math.max(0, r.top) })), [selector, vp.width, vp.height]);
      found.forEach((b, i) => { boxes[`${prefix}${i}`] ??= b; });
    }
    await this.page.screenshot({ path: join(SHOTS, `${id}.png`) });
    this.taken[id] = { device: this.device, file: `shots/${id}.png`, w: vp.width, h: vp.height, marks: boxes };
    console.log(`  shot ${id}${Object.keys(boxes).length ? ` · marks ${Object.keys(boxes).join(', ')}` : ''}`);
    return boxes;
  }

  /** Add these shots to showcase/.out/manifest.json (other captures keep theirs). */
  save() {
    const file = join(OUT, 'manifest.json');
    const all = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { shots: {} };
    Object.assign(all.shots, this.taken);
    writeFileSync(file, JSON.stringify(all, null, 1));
  }
}

/**
 * An illustrated guard at the gate (a stand-in for time-in photos, never a real person): man or woman,
 * a skin tone, the cap; the same person always gets the same picture.
 */
export function guardSvg({ female = false, tone = 0, dusk = true } = {}) {
  const skins = ['#c99470', '#b07a52', '#d9a982', '#9c6b48'];
  const skin = skins[tone % skins.length];
  const shade = '#00000022';
  const sky = dusk ? ['#13253d', '#7a4b3a', '#f2a65a'] : ['#7fb3e0', '#cfe3f0', '#f7d9a8'];
  const hair = female
    ? `<ellipse cx="540" cy="745" rx="165" ry="95" fill="#1d1410"/><circle cx="540" cy="640" r="70" fill="#1d1410"/>`
    : `<path d="M385 800 C380 690 700 690 695 800 Z" fill="#1d1410"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1440" width="1080" height="1440">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".55" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>
<linearGradient id="u" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b3150"/><stop offset="1" stop-color="#0b1626"/></linearGradient></defs>
<rect width="1080" height="1440" fill="url(#s)"/>
<circle cx="830" cy="990" r="120" fill="#f2c230" opacity=".5"/>
<rect y="1010" width="1080" height="430" fill="#2a2f3a"/>
<g fill="#3a4150"><rect x="40" y="760" width="60" height="420"/><rect x="980" y="760" width="60" height="420"/><rect x="100" y="800" width="880" height="26"/><rect x="100" y="960" width="880" height="26"/></g>
<g fill="#4a5262"><rect x="160" y="826" width="14" height="134"/><rect x="260" y="826" width="14" height="134"/><rect x="800" y="826" width="14" height="134"/><rect x="900" y="826" width="14" height="134"/></g>
<path d="M250 1440 C250 1180 360 1080 540 1080 C720 1080 830 1180 830 1440 Z" fill="url(#u)"/>
<path d="M470 1090 L540 1190 L610 1090 Z" fill="#eef2f7"/>
${female ? '' : '<path d="M520 1110 L540 1250 L560 1110 Z" fill="#0b1626"/>'}
<rect x="640" y="1180" width="90" height="70" rx="10" fill="#f2c230"/>
<rect x="330" y="1190" width="120" height="16" rx="8" fill="#c4161c"/>
<rect x="490" y="960" width="100" height="140" rx="40" fill="${skin}"/><rect x="490" y="960" width="100" height="40" fill="${shade}"/>
${hair}
<ellipse cx="540" cy="860" rx="${female ? 140 : 150}" ry="175" fill="${skin}"/>
<path d="M380 760 C390 640 690 640 700 760 L700 790 L380 790 Z" fill="#0b1626"/>
<rect x="360" y="770" width="360" height="40" rx="18" fill="#13253d"/>
<circle cx="540" cy="730" r="26" fill="#f2c230"/>
<ellipse cx="485" cy="875" rx="16" ry="12" fill="#2b1d15"/><ellipse cx="595" cy="875" rx="16" ry="12" fill="#2b1d15"/>
${female ? '<path d="M455 845 Q485 832 512 845" stroke="#2b1d15" stroke-width="7" fill="none"/><path d="M568 845 Q595 832 625 845" stroke="#2b1d15" stroke-width="7" fill="none"/>' : '<path d="M455 842 L512 842" stroke="#2b1d15" stroke-width="9"/><path d="M568 842 L625 842" stroke="#2b1d15" stroke-width="9"/>'}
<path d="M495 950 Q540 ${female ? 990 : 982} 585 950" stroke="${female ? '#a8433a' : '#6b3d2a'}" stroke-width="12" fill="none" stroke-linecap="round"/>
<text x="540" y="120" text-anchor="middle" font-family="Arial" font-size="40" fill="#eef2f7" opacity=".7">ILLUSTRATION</text>
</svg>`;
}
export const svgString = (s) => `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`;

/** Who is who in the demo: the same picture for the same guard everywhere. */
export const DEMO_PEOPLE = {
  'G-001': { female: false, tone: 1 }, 'G-002': { female: true, tone: 0 }, 'G-003': { female: false, tone: 3 }, 'G-004': { female: false, tone: 0 },
  'G-005': { female: true, tone: 2 }, 'G-006': { female: false, tone: 2 }, 'G-007': { female: true, tone: 1 }, 'G-008': { female: false, tone: 3 },
  'G-009': { female: false, tone: 2 }, 'G-010': { female: true, tone: 3 }, 'G-011': { female: false, tone: 1 },
};
