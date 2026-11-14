// Writes each email as its own HTML file (to paste into Supabase by hand if you prefer) and a
// preview page with sample values.  Run: node supabase/email/build.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, fillSample } from './templates.mjs';

const dir = fileURLToPath(new URL('./html/', import.meta.url));
mkdirSync(dir, { recursive: true });
const cards = [];
for (const [key, t] of Object.entries(TEMPLATES)) {
  writeFileSync(`${dir}${key}.html`, t.html);
  cards.push(`<section><h2>${t.name} <small>Subject: ${t.subject}</small></h2><iframe title="${t.name}" srcdoc="${fillSample(t.html).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></section>`);
}
writeFileSync(`${dir}preview.html`, `<!doctype html><meta charset="utf-8"><title>Bannuar emails</title>
<style>body{margin:0;padding:24px;background:#ddd;font-family:Arial,sans-serif}section{margin:0 auto 32px;max-width:640px}h2{font-size:16px}small{display:block;font-weight:normal;color:#555;margin-top:4px}iframe{width:100%;height:760px;border:0;background:#fff;border-radius:8px}</style>
${cards.join('\n')}`);
console.log(`Wrote ${Object.keys(TEMPLATES).length} emails and preview.html to supabase/email/html/`);
