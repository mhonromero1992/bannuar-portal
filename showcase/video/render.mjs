/**
 * Renders the showcase video: steps video/stage.html through every frame in Chromium, encodes the frames
 * with ffmpeg, then adds the soundtrack that music.py writes from the same timeline.
 *
 *   node showcase/video/render.mjs                 → showcase/bannuar-showcase.mp4
 *   node showcase/video/render.mjs --stills        → a still of every beat in showcase/.out/stills
 *   node showcase/video/render.mjs --at 12.5,40    → stills at those seconds
 *   node showcase/video/render.mjs --from 60 --to 75   → that part only, no music (.out/video.mp4)
 * Options: --workers 3 (browsers rendering side by side), --fps 30.
 * Needs the captures in showcase/.out (capture/*.mjs) and ffmpeg and python3 with numpy.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { OUT, SHOWCASE, chromium } from '../capture/kit.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const FPS = Number(arg('fps', 30));
const WORKERS = Number(arg('workers', 3));
const FINAL = join(SHOWCASE, 'bannuar-showcase.mp4');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
function serveShowcase() {
  return new Promise((done) => {
    const srv = createServer((req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
      const file = join(SHOWCASE, path);
      if (!file.startsWith(SHOWCASE) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(readFileSync(file));
    }).listen(0, '127.0.0.1', () => done({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }));
  });
}

async function openStage(url) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`stage error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.error(`stage: ${m.text()}`);
  });
  await page.goto(`${url}/video/stage.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 180_000, polling: 250 });
  const cdp = await page.context().newCDPSession(page);
  const shot = async (format = 'jpeg') => {
    const { data } = await cdp.send('Page.captureScreenshot', format === 'jpeg' ? { format, quality: 95, optimizeForSpeed: true } : { format, optimizeForSpeed: true });
    return Buffer.from(data, 'base64');
  };
  return { browser, page, shot, draw: (t) => page.evaluate((x) => window.renderAt(x), t) };
}

function run(cmd, args) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? ok() : no(new Error(`${cmd} exited with ${code}`))));
  });
}

function encoder(file) {
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((ok, no) => ff.on('close', (code) => (code === 0 ? ok() : no(new Error(`ffmpeg exited with ${code}`)))));
  return {
    write: (buf) => new Promise((ok) => (ff.stdin.write(buf) ? ok() : ff.stdin.once('drain', ok))),
    end: async () => {
      ff.stdin.end();
      await closed;
    },
  };
}

async function renderPart(url, from, to, file, label) {
  const st = await openStage(url);
  const enc = encoder(file);
  const started = Date.now();
  let pending = Promise.resolve();
  for (let i = from; i < to; i++) {
    await st.draw(i / FPS);
    const frame = await st.shot();
    await pending;
    pending = enc.write(frame);
    const n = i - from + 1;
    if (n % 450 === 0 || i === to - 1) {
      const s = (Date.now() - started) / 1000;
      console.log(`${label}: ${n}/${to - from} frames, ${(n / s).toFixed(1)} fps`);
    }
  }
  await pending;
  await enc.end();
  await st.browser.close();
}

const server = await serveShowcase();
mkdirSync(OUT, { recursive: true });
const probe = await openStage(server.url);
const timeline = await probe.page.evaluate(() => window.timeline);
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
console.log(`Timeline: ${mmss(timeline.duration)} (${timeline.duration.toFixed(1)} s), ${timeline.beats.length} beats, ${timeline.taps.length} taps`);
for (const c of timeline.chapters) console.log(`  ${c.id.padEnd(8)} ${mmss(c.start)} – ${mmss(c.end)}`);

if (arg('stills') || arg('at')) {
  const dir = join(OUT, 'stills');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let times;
  if (arg('at')) times = String(arg('at')).split(',').map(Number);
  else {
    // a card halfway through; each beat once it has zoomed, and again at its tap
    const cards = timeline.scenes.filter((s) => s.type !== 'screens').map((s) => s.start + (s.end - s.start) * 0.55);
    const beats = timeline.beats.flatMap((b) => (b.tClick ? [b.tClick + 0.12] : [b.end - 1.0]));
    times = [...cards, ...beats].sort((a, b) => a - b);
  }
  for (const [n, t] of times.entries()) {
    await probe.draw(t);
    writeFileSync(join(dir, `${String(n).padStart(3, '0')}-${t.toFixed(2)}.png`), await probe.shot('png'));
  }
  console.log(`${times.length} stills in ${dir}`);
  await probe.browser.close();
  server.close();
} else {
  await probe.browser.close();
  const whole = arg('from') === undefined && arg('to') === undefined;
  const from = Math.round(Number(arg('from', 0)) * FPS);
  const to = Math.min(Math.ceil(timeline.duration * FPS), Math.round(Number(arg('to', timeline.duration)) * FPS));
  const n = to - from;
  const parts = Array.from({ length: WORKERS }, (_, w) => ({
    a: from + Math.floor((n * w) / WORKERS),
    b: from + Math.floor((n * (w + 1)) / WORKERS),
    file: join(OUT, `part-${w}.mp4`),
  })).filter((p) => p.b > p.a);
  const started = Date.now();
  await Promise.all(parts.map((p, w) => renderPart(server.url, p.a, p.b, p.file, `worker ${w + 1}`)));
  server.close();
  const list = join(OUT, 'parts.txt');
  writeFileSync(list, parts.map((p) => `file '${p.file}'`).join('\n'));
  const silent = join(OUT, 'video.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
  for (const p of parts) rmSync(p.file, { force: true });
  console.log(`Rendered ${n} frames in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  if (whole) {
    const wav = join(OUT, 'music.wav');
    await run('python3', [join(SHOWCASE, 'video/music.py'), join(OUT, 'timeline.json'), wav]);
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', FINAL]);
    console.log(`Video: ${FINAL}`);
  } else console.log(`Part: ${silent}`);
}
