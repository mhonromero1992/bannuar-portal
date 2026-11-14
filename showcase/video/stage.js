/**
 * The showcase video's stage: draws any moment t (seconds) of the storyboard on a 1920×1080 page, from
 * the screenshots in showcase/.out (real screens, demo data). render.mjs steps through t frame by frame.
 *   window.renderAt(t) → Promise (resolves once the frame is drawn)
 *   window.timeline   → { duration, taps, chapters, scenes, beats } (seconds)
 */
import { STORYBOARD } from './storyboard.js';

const W = 1920;
const H = 1080;
const T_ENTER = 0.9; // a scene's device rises in
const T_EXIT = 0.6;
const GAP = 0.3; // between scenes
const ZOOM_AT = 1.1; // a beat's zoom starts this long after the beat, once the screen has settled
const ZOOM_DUR = 1.9;
const TR = { fade: 0.6, tab: 0.35, push: 0.55, pop: 0.55, none: 0 };
const CHAPTERS = [['website', 'Website'], ['portal', 'HR portal'], ['client', 'Client portal'], ['app', 'Employee app']];

const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const prog = (t, a, d) => (d <= 0 ? (t >= a ? 1 : 0) : cl((t - a) / d));
const lerp = (a, b, k) => a + (b - a) * k;
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out = (x) => 1 - Math.pow(1 - x, 3);
const px = (v) => `${v}px`;
const el = (tag, cls, parent, style = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(style)) if (v !== undefined) e.style[k] = v;
  if (parent) parent.appendChild(e);
  return e;
};
const stage = document.getElementById('stage');

const manifest = await (await fetch('../.out/manifest.json', { cache: 'no-store' })).json();
const info = (id) => manifest.shots[id] ?? { file: `shots/${id}.png`, marks: {} };
const urlOf = (id) => `../.out/${info(id).file}`;

// ------------------------------------------------------------------ the colours at a shot's top and bottom edge
// (a phone's status bar and home bar take them, so each screen looks native)
const EDGE = {};
async function sample(id) {
  if (EDGE[id]) return EDGE[id];
  const img = new Image();
  img.src = urlOf(id);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  const at = (x, y) => {
    g.clearRect(0, 0, 1, 1);
    g.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  EDGE[id] = { top: at(Math.round(img.naturalWidth / 2), 2), bottom: at(8, img.naturalHeight - 3) };
  return EDGE[id];
}
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const dark = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 140;

// ------------------------------------------------------------------ device geometry (stage px; shots in CSS px)
function geometry(kind, o = {}) {
  if (kind === 'browser') {
    const sw = o.sw ?? 1200;
    const k = sw / 1440;
    const bar = o.bar ?? 46;
    const fh = bar + 900 * k;
    const f = { x: o.x ?? 640, y: o.y ?? (H - fh) / 2, w: sw, h: fh };
    return { kind, cssW: 1440, cssH: 900, sw, sh: 900 * k, base: k, maxS: k * 2.4, frame: f, screen: { x: 0, y: bar, w: sw, h: 900 * k }, top: 0, bar, radius: sw > 1000 ? 16 : 12, cap: { x: 80, w: 500 } };
  }
  if (kind === 'phone') {
    const k = o.k ?? 1.06;
    const u = k / 1.06;
    const bez = 13 * u;
    const sw = 390 * k;
    const sH = 844 * k;
    const f = { x: o.x ?? 1180, y: o.y ?? (H - (sH + 2 * bez)) / 2, w: sw + 2 * bez, h: sH + 2 * bez };
    return { kind, cssW: 390, cssH: 763, sw, sh: 763 * k, base: k, maxS: k * 1.8, frame: f, screen: { x: bez, y: bez, w: sw, h: sH }, top: 47 * k, statusH: 47 * k, homeH: 34 * k, k, radius: 64 * u, screenRadius: 52 * u, cap: { x: 300, w: 660 } };
  }
  if (kind === 'tablet') {
    const k = o.k ?? 0.94;
    const u = k / 0.97;
    const bez = 20 * u;
    const sw = 1180 * k;
    const sH = 844 * k;
    const f = { x: o.x ?? 680, y: o.y ?? (H - (sH + 2 * bez)) / 2, w: sw + 2 * bez, h: sH + 2 * bez };
    return { kind, cssW: 1180, cssH: 820, sw, sh: 820 * k, base: k, maxS: k * 2.2, frame: f, screen: { x: bez, y: bez, w: sw, h: sH }, top: 24 * k, statusH: 24 * k, k, radius: 40 * u, screenRadius: 22 * u, cap: { x: 90, w: 520 } };
  }
  // paper: a page of the certificate PDF
  const k = 880 / 2200;
  const f = { x: 1060, y: 100, w: 1700 * k, h: 2200 * k };
  return { kind, cssW: 1700, cssH: 2200, sw: f.w, sh: f.h, base: k, maxS: k * 2.6, frame: f, screen: { x: 0, y: 0, w: f.w, h: f.h }, top: 0, radius: 4, cap: { x: 200, w: 700 } };
}
const fullCam = (g) => ({ s: g.base, cx: g.cssW / 2, cy: g.cssH / 2 });
function camFor(g, r, pad = 1.12) {
  const s = cl(Math.min(g.sw / (r.w * pad), g.sh / (r.h * pad)), g.base, g.maxS);
  // a page is white past its edges, so a close-up of paper can centre on its subject
  if (g.kind === 'paper') return { s, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
  const hw = g.sw / (2 * s);
  const hh = g.sh / (2 * s);
  const cx = hw * 2 >= g.cssW - 0.5 ? g.cssW / 2 : cl(r.x + r.w / 2, hw, g.cssW - hw);
  const cy = hh * 2 >= g.cssH - 0.5 ? g.cssH / 2 : cl(r.y + r.h / 2, hh, g.cssH - hh);
  return { s, cx, cy };
}
const mixCam = (a, b, k) => ({ s: Math.exp(lerp(Math.log(a.s), Math.log(b.s), k)), cx: lerp(a.cx, b.cx, k), cy: lerp(a.cy, b.cy, k) });
const toScreen = (g, cam, x, y) => ({ x: g.sw / 2 + (x - cam.cx) * cam.s, y: g.sh / 2 + (y - cam.cy) * cam.s });
const box = (shot, name) => info(shot).marks?.[name] ?? null;
function region(shot, z, g) {
  if (!z) return null;
  if (typeof z === 'string') return box(shot, z);
  if (Array.isArray(z)) {
    const bs = z.map((n) => box(shot, n)).filter(Boolean);
    if (!bs.length) return null;
    const x0 = Math.min(...bs.map((b) => b.x));
    const y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w));
    const y1 = Math.max(...bs.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (z.w <= 1 && z.h <= 1) return { x: z.x * g.cssW, y: z.y * g.cssH, w: z.w * g.cssW, h: z.h * g.cssH };
  return z;
}

// ------------------------------------------------------------------ building a device
const ICONS = {
  cursor: '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 2 L3 20 L8 15.5 L11.5 22.5 L14.5 21 L11 14 L18 14 Z" fill="#fff" stroke="#0b1626" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="#4f5b6b"/><path d="M5 7 V5 a3 3 0 0 1 6 0 V7" stroke="#4f5b6b" stroke-width="1.6" fill="none"/></svg>',
  status: (c, k) => `<svg viewBox="0 0 80 14" width="${80 * k}" height="${14 * k}"><g fill="${c}"><rect x="0" y="9" width="3" height="5" rx="1"/><rect x="5" y="6" width="3" height="8" rx="1"/><rect x="10" y="3" width="3" height="11" rx="1"/><rect x="15" y="0" width="3" height="14" rx="1"/><path d="M30 4 a12 12 0 0 1 16 0 l-2 2 a9 9 0 0 0 -12 0 Z M33 7.5 a7 7 0 0 1 10 0 l-2 2 a4 4 0 0 0 -6 0 Z M36.5 11 a2 2 0 0 1 3 0 l-1.5 1.8 Z"/><rect x="54" y="2" width="22" height="11" rx="3" fill="none" stroke="${c}" stroke-width="1.4"/><rect x="56" y="4" width="16" height="7" rx="1.6"/><rect x="77" y="5.5" width="2" height="4" rx="1"/></g></svg>`,
};

function makeDevice(parent, g) {
  const d = { g };
  const f = g.frame;
  d.root = el('div', `device ${g.kind}`, parent, { left: px(f.x), top: px(f.y), width: px(f.w), height: px(f.h), borderRadius: px(g.radius) });
  if (g.kind === 'browser') {
    const bar = el('div', 'bar', d.root, { height: px(g.bar), gap: px(g.bar * 0.2) });
    for (const c of ['#e46a5f', '#e6b84d', '#5fb35f']) el('i', '', bar, { background: c, width: px(g.bar * 0.28), height: px(g.bar * 0.28) });
    d.url = el('div', 'url', bar, { height: px(g.bar * 0.65), fontSize: px(g.bar * 0.35) });
  }
  d.screen = el('div', 'screen', d.root, { left: px(g.screen.x), top: px(g.screen.y), width: px(g.screen.w), height: px(g.screen.h), borderRadius: g.screenRadius ? px(g.screenRadius) : undefined });
  if (g.kind === 'phone') {
    d.sbar = el('div', 'sbar', d.screen, { height: px(g.statusH), padding: `0 ${30 * g.k}px 0 ${44 * g.k}px`, fontSize: px(16 * g.k), zIndex: 5 });
    d.clock = el('span', '', d.sbar);
    d.icons = el('span', '', d.sbar, { display: 'flex' });
    d.home = el('div', 'homebar', d.screen, { height: px(g.homeH), zIndex: 5 });
    d.homeI = el('i', '', d.home, { width: px(130 * g.k), marginLeft: px(-65 * g.k), height: px(5 * g.k), bottom: px(9 * g.k) });
    el('div', 'island', d.screen, { width: px(118 * g.k), height: px(34 * g.k), borderRadius: px(17 * g.k), left: px((g.screen.w - 118 * g.k) / 2), top: px(10 * g.k), zIndex: 6 });
  }
  if (g.kind === 'tablet') {
    d.sbar = el('div', 'sbar', d.screen, { height: px(g.statusH), padding: `0 ${22 * g.k}px`, fontSize: px(13 * g.k), zIndex: 5 });
    d.clock = el('span', '', d.sbar);
    d.icons = el('span', '', d.sbar, { display: 'flex' });
    el('div', 'cam', d.root, { left: px(f.w / 2 - 4.5), top: px(Math.max(4, (g.screen.y - 9) / 2)) });
  }
  d.layers = [0, 1].map(() => {
    const L = { el: el('div', 'layer', d.screen, { top: px(g.top), width: px(g.sw), height: px(g.sh) }) };
    L.content = el('div', 'content', L.el, { width: px(g.cssW), height: px(g.cssH) });
    L.img = el('img', '', L.content);
    L.shade = el('div', 'shade', L.el, { opacity: 0 });
    L.src = null;
    return L;
  });
  d.overlay = el('div', 'overlay', d.screen, { top: px(g.top), height: px(g.sh), zIndex: 7 });
  d.rings = [el('div', 'ring', d.overlay, { opacity: 0 })];
  d.ripple = el('div', 'ripple', d.overlay, { opacity: 0 });
  d.touch = el('div', 'touch', d.overlay, { opacity: 0 });
  d.cursor = el('div', 'cursor', d.overlay, { opacity: 0 });
  d.cursor.innerHTML = ICONS.cursor;
  return d;
}

/** Show a shot on a layer with a camera; returns the promises of pictures still decoding. */
function paint(d, L, shot, cam, extra = {}) {
  const g = d.g;
  const jobs = [];
  if (L.src !== shot) {
    L.src = shot;
    L.img.src = urlOf(shot);
    jobs.push(L.img.decode().catch(() => null));
  }
  L.content.style.transform = `translate(${g.sw / 2 - cam.cx * cam.s}px, ${g.sh / 2 - cam.cy * cam.s}px) scale(${cam.s})`;
  L.el.style.opacity = extra.opacity ?? 1;
  L.el.style.transform = `translateX(${extra.x ?? 0}px)`;
  L.el.style.zIndex = extra.z ?? 1;
  L.el.style.display = 'block';
  L.shade.style.opacity = extra.shade ?? 0;
  return jobs;
}
function ringAt(d, b, cam, opacity, i = 0) {
  const r = d.rings[i];
  if (!b || opacity <= 0.001) {
    r.style.opacity = 0;
    return;
  }
  const p = 7;
  const a = toScreen(d.g, cam, b.x - p, b.y - p);
  const z = toScreen(d.g, cam, b.x + b.w + p, b.y + b.h + p);
  Object.assign(r.style, { left: px(a.x), top: px(a.y), width: px(z.x - a.x), height: px(z.y - a.y), opacity });
}
function statusBar(d, shot, clock) {
  if (!d.sbar) return;
  const e = EDGE[shot];
  const bgc = e ? e.top : [246, 243, 236];
  const fg = dark(bgc) ? '#ffffff' : '#0d1a2b';
  d.sbar.style.background = rgb(bgc);
  d.sbar.style.color = fg;
  if (d.clock.textContent !== clock) d.clock.textContent = clock;
  if (d.icons.dataset.key !== fg) {
    d.icons.innerHTML = ICONS.status(fg, d.g.k ?? 1);
    d.icons.dataset.key = fg;
  }
  if (d.home) {
    const hb = e ? e.bottom : [255, 255, 255];
    d.home.style.background = rgb(hb);
    d.homeI.style.background = dark(hb) ? 'rgba(255,255,255,.85)' : 'rgba(13,26,43,.85)';
  }
}

// ------------------------------------------------------------------ the timeline
const SB = STORYBOARD.map((s) => ({ ...s, beats: s.beats?.map((b) => ({ ...b })) }));
let t0 = 0;
const taps = [];
for (const sc of SB) {
  sc.start = t0;
  if (sc.type === 'screens') {
    sc.g = geometry(sc.device);
    let bt = t0 + T_ENTER;
    let prev = null;
    sc.beats.forEach((b, i) => {
      b.start = bt;
      b.end = bt + b.hold;
      bt = b.end;
      b.trans = i === 0 ? 'none' : b.transition ?? (sc.device === 'phone' ? 'push' : 'fade');
      b.same = b.trans === 'none' && prev && prev.shot === b.shot;
      b.layer = i === 0 ? 0 : b.same ? prev.layer : prev.layer ^ 1;
      b.full = fullCam(sc.g);
      b.camStart = b.same ? prev.camEnd : b.full;
      const late = region(b.shot, b.zoomLate, sc.g);
      const z = late ?? region(b.shot, b.zoom, sc.g);
      b.camEnd = z ? camFor(sc.g, z) : b.drift ? { ...b.full, s: sc.g.base * 1.045 } : b.camStart;
      b.zoomStart = late ? b.start + b.hold * 0.42 : b.start + (b.same ? 0.35 : ZOOM_AT);
      b.zooms = Boolean(z);
      b.ringBox = b.ring ? box(b.shot, b.ring) : null;
      b.ringAt = b.zooms ? b.zoomStart + ZOOM_DUR - 0.2 : b.start + 1.2;
      if (b.tap) {
        const m = box(b.shot, b.tap);
        if (m) {
          b.tapPt = { x: m.x + m.w / 2, y: m.y + m.h / 2 };
          b.tClick = b.end - 0.95;
          taps.push(b.tClick);
        } else console.warn(`no mark ${b.tap} on ${b.shot}`);
      }
      if (b.ring && !b.ringBox) console.warn(`no mark ${b.ring} on ${b.shot}`);
      const p = prev?.cap ?? { title: '', body: '' };
      b.cap = {
        title: b.title ?? p.title,
        body: b.title !== undefined ? b.body ?? '' : b.body ?? p.body,
        steps: b.steps ?? null,
        step: b.step ?? 0,
      };
      prev = b;
    });
    sc.end = bt + T_EXIT;
  } else {
    sc.end = t0 + sc.hold;
  }
  t0 = sc.end + GAP;
}
const DURATION = t0 + 0.5;
const chapters = CHAPTERS.map(([id, label]) => {
  const own = SB.filter((s) => s.chapter === id);
  return { id, label, start: own[0].start, end: own.at(-1).end };
});

// ------------------------------------------------------------------ the DOM
const bg = el('div', '', stage);
bg.id = 'bg';
const stars = [];
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 70; i++) {
  const size = 1.5 + rnd() * 2;
  stars.push({ e: el('div', 'star', bg, { left: px(rnd() * W), top: px(rnd() * H * 0.72), width: px(size), height: px(size), opacity: 0 }), base: 0.25 + rnd() * 0.55, ph: rnd() * 6.28, sp: 0.4 + rnd() });
}

const caption = el('div', 'caption', stage, { top: '50%' });
const capKicker = el('div', 'kicker', caption);
const capTitle = el('h2', 'ctitle', caption);
const capBody = el('p', 'cbody', caption);
const capSteps = el('div', 'steps', caption);

for (const sc of SB) {
  sc.root = el('div', 'abs', stage, { inset: 0, display: 'none' });
  if (sc.type === 'screens') sc.dev = makeDevice(sc.root, sc.g);
  if (sc.type === 'intro' || sc.type === 'outro') {
    const c = el('div', 'card', sc.root);
    sc.badge = el('img', 'badge-img', c);
    sc.badge.src = 'assets/badge.png';
    sc.big = el('div', 'big', c);
    sc.big.textContent = 'Bannuar Security Agency, Inc.';
    sc.lineEl = el('p', 'line', c);
    sc.lineEl.textContent = sc.type === 'intro' ? 'One system for the office, its clients and its guards' : 'The office, the clients and the guards, on one system';
    const pills = el('div', 'pills', c);
    sc.pills = ['Website', 'HR portal', 'Client portal', 'Employee app'].map((p) => {
      const e = el('div', 'pill', pills);
      e.textContent = p;
      return e;
    });
    if (sc.type === 'outro') {
      sc.small = el('div', 'small', c);
      sc.small.textContent = 'Shown with demo records. Every screen is the real software.';
    }
  }
  if (sc.type === 'chapter') {
    const c = el('div', 'card', sc.root);
    sc.num = el('div', 'chapter-n', c);
    sc.num.textContent = sc.n;
    sc.big = el('div', 'big', c);
    sc.big.textContent = sc.title;
    sc.lineEl = el('p', 'line', c);
    sc.lineEl.textContent = sc.line;
  }
  if (sc.type === 'connect') {
    sc.capEl = el('div', 'caption', sc.root, { left: '50%', top: '92px', width: '1500px', marginLeft: '-750px', textAlign: 'center' });
    el('div', 'kicker', sc.capEl, { justifyContent: 'center' }).textContent = sc.kicker;
    el('h2', 'ctitle', sc.capEl).textContent = sc.title;
    el('p', 'cbody', sc.capEl).textContent = sc.body;
    sc.devs = {
      phone: makeDevice(sc.root, geometry('phone', { k: 0.66, x: 85, y: 354 })),
      browser: makeDevice(sc.root, geometry('browser', { sw: 820, x: 418, y: 367, bar: 34 })),
      tablet: makeDevice(sc.root, geometry('tablet', { k: 0.44, x: 1298, y: 445 })),
    };
    const ns = 'http://www.w3.org/2000/svg';
    sc.svg = document.createElementNS(ns, 'svg');
    sc.svg.setAttribute('class', 'links');
    sc.svg.setAttribute('width', W);
    sc.svg.setAttribute('height', H);
    sc.root.appendChild(sc.svg);
    sc.paths = [0, 1].map(() => {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#f2c230');
      p.setAttribute('stroke-width', '3');
      p.setAttribute('stroke-linecap', 'round');
      sc.svg.appendChild(p);
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', '9');
      dot.setAttribute('fill', '#f2c230');
      dot.setAttribute('style', 'filter: drop-shadow(0 0 10px rgba(242,194,48,.9))');
      sc.svg.appendChild(dot);
      return { p, dot };
    });
  }
}
const progress = el('div', '', stage);
progress.id = 'progress';
const segs = chapters.map((c) => {
  const s = el('div', 'seg', progress);
  s.appendChild(document.createTextNode(c.label));
  const tr = el('div', 'track', s);
  return { s, fill: el('div', 'fill', tr) };
});
const tag = el('div', '', stage);
tag.id = 'tag';
tag.textContent = 'Demo data';
const black = el('div', 'abs', stage, { inset: 0, background: '#000', zIndex: 50 });

// ------------------------------------------------------------------ drawing one frame
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, k) => a.map((v, i) => Math.round(lerp(v, b[i], k)));

/** Night to dawn over the whole video, with the stars fading out. */
function drawBackground(t) {
  const dawn = Math.pow(cl(t / DURATION), 1.7);
  const top = mix(hex('#081220'), hex('#1a2c48'), dawn);
  const low = mix(hex('#0f1d31'), hex('#3a2b2e'), dawn);
  bg.style.background = `radial-gradient(1500px 760px at 28% 118%, rgba(242,166,90,${0.06 + 0.34 * dawn}), transparent 72%),`
    + ` radial-gradient(900px 520px at 30% 112%, rgba(242,194,48,${0.03 + 0.16 * dawn}), transparent 70%),`
    + ` radial-gradient(1100px 700px at 92% -12%, rgba(27,49,80,.75), transparent 70%), linear-gradient(180deg, ${rgb(top)}, ${rgb(low)})`;
  for (const s of stars) s.e.style.opacity = (s.base * (0.75 + 0.25 * Math.sin(t * s.sp + s.ph)) * (1 - dawn * 0.9)).toFixed(3);
}

function drawCaption(sc, b, t, vis) {
  const g = sc.g;
  const bs = sc.beats;
  const i = bs.indexOf(b);
  const prevB = bs[i - 1];
  const nextB = bs[i + 1];
  const titleIn = !prevB || prevB.cap.title !== b.cap.title ? out(prog(t, b.start + 0.1, 0.5)) : 1;
  const bodyIn = !prevB || prevB.cap.body !== b.cap.body ? out(prog(t, b.start + 0.15, 0.55)) : 1;
  const titleOut = nextB && nextB.cap.title !== b.cap.title ? 1 - prog(t, b.end - 0.3, 0.3) : 1;
  const bodyOut = nextB && nextB.cap.body !== b.cap.body ? 1 - prog(t, b.end - 0.3, 0.3) : 1;
  caption.style.left = px(g.cap.x);
  caption.style.width = px(g.cap.w);
  caption.style.opacity = vis;
  caption.style.transform = `translateY(-50%) translateY(${(1 - vis) * 16}px)`;
  if (capKicker.textContent !== sc.kicker) capKicker.textContent = sc.kicker;
  if (capTitle.textContent !== b.cap.title) capTitle.textContent = b.cap.title;
  if (capBody.textContent !== b.cap.body) capBody.textContent = b.cap.body;
  capTitle.style.opacity = Math.min(titleIn, titleOut);
  capTitle.style.transform = `translateY(${(1 - titleIn) * 14}px)`;
  capBody.style.opacity = Math.min(bodyIn, bodyOut);
  capBody.style.transform = `translateY(${(1 - bodyIn) * 12}px)`;
  const steps = b.cap.steps;
  const key = steps ? `${steps.join('|')}#${b.cap.step}` : '';
  if (capSteps.dataset.key !== key) {
    capSteps.dataset.key = key;
    capSteps.innerHTML = '';
    (steps ?? []).forEach((label, n) => {
      const last = n === b.cap.step && n === steps.length - 1;
      const s = el('div', `step ${n < b.cap.step || last ? 'done' : n === b.cap.step ? 'now' : ''}`, capSteps);
      el('span', 'dot', s).textContent = n < b.cap.step || last ? '✓' : String(n + 1);
      s.appendChild(document.createTextNode(label));
    });
  }
  capSteps.style.display = steps ? 'grid' : 'none';
}

function camAt(b, t) {
  if (b.drift) return mixCam(b.full, b.camEnd, prog(t, b.start, b.hold));
  return mixCam(b.camStart, b.camEnd, inOut(prog(t, b.zoomStart, ZOOM_DUR)));
}

function drawScreens(sc, t, vis) {
  const d = sc.dev;
  const g = sc.g;
  const bs = sc.beats;
  let i = 0;
  while (i + 1 < bs.length && t >= bs[i + 1].start) i++;
  const b = bs[i];
  const p = bs[i - 1];
  const jobs = [];
  const enter = out(prog(t, sc.start, T_ENTER));
  const exit = prog(t, sc.end - T_EXIT, T_EXIT);
  d.root.style.opacity = vis;
  d.root.style.transform = `translateY(${(1 - enter) * 50 - exit * 20}px) scale(${lerp(0.97, 1, enter)})`;
  if (d.url) {
    const path = b.url ?? bs.slice(0, i).reverse().find((x) => x.url)?.url ?? '/';
    const html = `${ICONS.lock}<span><b>${sc.host}</b>${path === '/' ? '' : path}</span>`;
    if (d.url.dataset.html !== html) {
      d.url.innerHTML = html;
      d.url.dataset.html = html;
    }
  }
  // the screen in view, and the one it replaces
  const dur = TR[b.trans] ?? 0.6;
  const q = dur ? (b.trans === 'push' || b.trans === 'pop' ? out : inOut)(prog(t, b.start, dur)) : 1;
  const cur = d.layers[b.layer];
  const old = d.layers[b.layer ^ 1];
  const camB = camAt(b, t);
  const showOld = p && !b.same && q < 1;
  if (showOld) {
    const camP = camAt(p, p.end);
    if (b.trans === 'push') {
      jobs.push(...paint(d, cur, b.shot, camB, { x: (1 - q) * g.sw, z: 2 }));
      jobs.push(...paint(d, old, p.shot, camP, { x: -0.28 * g.sw * q, z: 1, shade: 0.3 * q }));
    } else if (b.trans === 'pop') {
      jobs.push(...paint(d, cur, b.shot, camB, { x: -0.28 * g.sw * (1 - q), z: 1, shade: 0.3 * (1 - q) }));
      jobs.push(...paint(d, old, p.shot, camP, { x: q * g.sw, z: 2 }));
    } else {
      jobs.push(...paint(d, cur, b.shot, camB, { opacity: q, z: 2 }));
      jobs.push(...paint(d, old, p.shot, camP, { opacity: 1, z: 1 }));
    }
  } else {
    jobs.push(...paint(d, cur, b.shot, camB, { z: 2 }));
    old.el.style.display = 'none';
  }
  statusBar(d, q > 0.5 || !showOld ? b.shot : p.shot, sc.clock ?? '');
  // the highlight ring, once the zoom has settled
  const ringV = b.ringBox ? out(prog(t, b.ringAt, 0.45)) * (1 - prog(t, b.end - 0.4, 0.35)) : 0;
  ringAt(d, b.ringBox, camB, ringV);
  // the tap: a finger on a phone or a tablet, a pointer in a browser
  d.ripple.style.opacity = 0;
  d.touch.style.opacity = 0;
  d.cursor.style.opacity = 0;
  if (b.tapPt && t >= b.tClick - 1.8) {
    const tc = b.tClick;
    const target = toScreen(g, camB, b.tapPt.x, b.tapPt.y);
    const kk = g.kind === 'browser' ? 1 : g.k ?? 1;
    if (g.kind === 'browser') {
      const mv = inOut(prog(t, tc - 1.4, 1.2));
      const v = prog(t, tc - 1.8, 0.35) * (1 - prog(t, tc + 0.45, 0.35));
      const press = t >= tc && t < tc + 0.16 ? 0.85 : 1;
      Object.assign(d.cursor.style, { left: px(target.x + 150 * (1 - mv)), top: px(target.y + 110 * (1 - mv)), opacity: v, transform: `scale(${press})` });
    } else {
      const a = prog(t, tc - 0.5, 0.3);
      const z = 1 - prog(t, tc + 0.3, 0.4);
      const size = 56 * kk * (t < tc ? lerp(1.3, 1, a) : lerp(0.84, 1, prog(t, tc, 0.22)));
      Object.assign(d.touch.style, { left: px(target.x - size / 2), top: px(target.y - size / 2), width: px(size), height: px(size), opacity: Math.min(a, z) });
    }
    const r = prog(t, tc, 0.6);
    if (t >= tc && r < 1) {
      const rad = lerp(10, 48, out(r)) * kk;
      Object.assign(d.ripple.style, { left: px(target.x - rad), top: px(target.y - rad), width: px(rad * 2), height: px(rad * 2), opacity: 0.9 * (1 - r) });
    }
  }
  drawCaption(sc, b, t, vis);
  return jobs;
}

/** One time in, seen on the guard's phone, in HR's attendance list and on the client's tablet. */
function drawConnect(sc, t, vis) {
  const lt = t - sc.start;
  const jobs = [];
  sc.root.style.opacity = vis;
  const ci = out(prog(lt, 0.1, 0.7));
  sc.capEl.style.opacity = ci;
  sc.capEl.style.transform = `translateY(${(1 - ci) * 14}px)`;
  const D = sc.devs;
  const shots = { phone: 'app-home-in', browser: 'hr-attendance', tablet: 'client-posts' };
  const bea = box('hr-attendance', 'bea') ?? { x: 284, y: 560, w: 1124, h: 48 };
  const cams = {
    phone: fullCam(D.phone.g),
    browser: camFor(D.browser.g, { x: 284, y: bea.y - 70, w: 760, h: bea.h + 140 }, 1.05),
    tablet: camFor(D.tablet.g, box('client-posts', 'panel0') ?? { x: 16, y: 170, w: 566, h: 373 }, 1.05),
  };
  const appear = { phone: 0.4, browser: 1.2, tablet: 3.2 };
  const ringIn = { phone: 1.2, browser: 2.85, tablet: 4.85 };
  const rings = { phone: box('app-home-in', 'status'), browser: bea, tablet: box('client-posts', 'bea') };
  const edges = {};
  for (const k of ['phone', 'browser', 'tablet']) {
    const d = D[k];
    const a = out(prog(lt, appear[k], 0.8));
    d.root.style.opacity = a;
    d.root.style.transform = `translateY(${(1 - a) * 30}px)`;
    jobs.push(...paint(d, d.layers[0], shots[k], cams[k], { z: 2 }));
    d.layers[1].el.style.display = 'none';
    statusBar(d, shots[k], k === 'phone' ? '5:52' : '6:25');
    if (d.url) {
      const html = `${ICONS.lock}<span><b>bannuar-portal.vercel.app</b>/attendance</span>`;
      if (d.url.dataset.html !== html) {
        d.url.innerHTML = html;
        d.url.dataset.html = html;
      }
    }
    ringAt(d, rings[k], cams[k], out(prog(lt, ringIn[k], 0.45)));
    const r = rings[k];
    if (r) {
      // the ring's left and right ends on the stage, kept within the screen
      const g = d.g;
      const a0 = toScreen(g, cams[k], r.x - 7, r.y - 7);
      const z0 = toScreen(g, cams[k], r.x + r.w + 7, r.y + r.h + 7);
      const ox = g.frame.x + g.screen.x;
      const oy = g.frame.y + g.screen.y + g.top;
      edges[k] = { l: ox + Math.max(0, a0.x), r: ox + Math.min(g.sw, z0.x), y: oy + (a0.y + z0.y) / 2 };
    }
  }
  // short links from one highlighted row to the next, through the gaps between the devices
  const legs = [['phone', 'browser', 2.0], ['browser', 'tablet', 4.0]];
  legs.forEach(([a, b, at], n) => {
    const A = edges[a] && { x: edges[a].r, y: edges[a].y };
    const B = edges[b] && { x: edges[b].l, y: edges[b].y };
    const { p, dot } = sc.paths[n];
    if (!A || !B) return;
    const dx = Math.max(60, (B.x - A.x) * 0.6);
    p.setAttribute('d', `M${A.x},${A.y} C${A.x + dx},${A.y} ${B.x - dx},${B.y} ${B.x},${B.y}`);
    const len = p.getTotalLength();
    const k = inOut(prog(lt, at, 1.0));
    p.setAttribute('stroke-dasharray', `${len}`);
    p.setAttribute('stroke-dashoffset', `${len * (1 - k)}`);
    p.style.opacity = k > 0 ? 0.95 : 0;
    const pt = p.getPointAtLength(len * k);
    dot.setAttribute('cx', pt.x);
    dot.setAttribute('cy', pt.y);
    dot.style.opacity = k > 0 && k < 1 ? 1 : 0;
  });
  return jobs;
}

function drawCard(sc, t) {
  const lt = t - sc.start;
  if (sc.type === 'chapter') {
    sc.root.style.opacity = 1 - prog(lt, sc.hold - 0.8, 0.8);
    const a = out(prog(lt, 0.1, 0.6));
    sc.num.style.opacity = a;
    sc.num.style.transform = `scale(${lerp(0.7, 1, a)})`;
    const b = out(prog(lt, 0.45, 0.7));
    sc.big.style.opacity = b;
    sc.big.style.transform = `translateY(${(1 - b) * 24}px)`;
    const c = out(prog(lt, 0.9, 0.7));
    sc.lineEl.style.opacity = c;
    sc.lineEl.style.transform = `translateY(${(1 - c) * 18}px)`;
    return;
  }
  const intro = sc.type === 'intro';
  sc.root.style.opacity = intro ? 1 - prog(lt, sc.hold - 0.8, 0.8) : 1 - prog(lt, sc.hold - 1.4, 1.4);
  const a = out(prog(lt, 0.2, 1.1));
  sc.badge.style.opacity = a;
  sc.badge.style.transform = `scale(${lerp(0.85, 1, a)})`;
  const b = out(prog(lt, intro ? 1.1 : 0.6, 0.8));
  sc.big.style.opacity = b;
  sc.big.style.transform = `translateY(${(1 - b) * 22}px)`;
  const c = out(prog(lt, intro ? 2.0 : 1.2, 0.8));
  sc.lineEl.style.opacity = c;
  sc.pills.forEach((p, i) => {
    const k = out(prog(lt, (intro ? 3.1 : 1.9) + i * 0.5, 0.6));
    p.style.opacity = k;
    p.style.transform = `translateY(${(1 - k) * 16}px)`;
  });
  if (sc.small) sc.small.style.opacity = out(prog(lt, 4.2, 0.8));
}

window.timeline = {
  duration: DURATION,
  taps,
  chapters: chapters.map(({ id, start, end }) => ({ id, start, end })),
  scenes: SB.map((s) => ({ type: s.type, chapter: s.chapter ?? null, start: s.start, end: s.end })),
  beats: SB.flatMap((s) => (s.beats ?? []).map((b) => ({ shot: b.shot, start: b.start, end: b.end, tClick: b.tClick ?? null }))),
};

window.renderAt = async (t) => {
  drawBackground(t);
  const jobs = [];
  let product = 0;
  let screens = false;
  for (const sc of SB) {
    const on = t >= sc.start && t <= sc.end;
    sc.root.style.display = on ? 'block' : 'none';
    if (!on) continue;
    const vis = out(prog(t, sc.start, T_ENTER)) * (1 - prog(t, sc.end - T_EXIT, T_EXIT));
    if (sc.type === 'screens') {
      jobs.push(...drawScreens(sc, t, vis));
      product = Math.max(product, vis);
      screens = true;
    } else if (sc.type === 'connect') {
      jobs.push(...drawConnect(sc, t, vis));
      product = Math.max(product, vis);
    } else drawCard(sc, t);
  }
  if (!screens) caption.style.opacity = 0;
  // where we are: the four parts
  progress.style.opacity = prog(t, chapters[0].start, 0.6) * (1 - prog(t, chapters.at(-1).end - 0.4, 0.6));
  chapters.forEach((c, i) => {
    segs[i].fill.style.width = `${prog(t, c.start, c.end - c.start) * 100}%`;
    segs[i].s.classList.toggle('on', t >= c.start && t <= c.end);
  });
  tag.style.opacity = product;
  black.style.opacity = Math.max(1 - prog(t, 0, 1.2), prog(t, DURATION - 1.6, 1.4));
  await Promise.all(jobs);
};

// colours of every shot's edges, and the fonts, before the first frame
const allShots = new Set(['app-home-in', 'hr-attendance', 'client-posts']);
for (const sc of SB) for (const b of sc.beats ?? []) allShots.add(b.shot);
for (const id of allShots) await sample(id);
await Promise.all(['A-Reg', 'A-Semi', 'A-Bold', 'A-Wide', 'A-Narrow'].map((f) => document.fonts.load(`24px "${f}"`)));
await document.fonts.ready;
window.ready = true;
