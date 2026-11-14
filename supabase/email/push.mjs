// Applies the email set-up to the Supabase project in one go: Resend as the mail server, the portal's
// address for links (never localhost), and every template with its subject.
//
//   SUPABASE_ACCESS_TOKEN=sbp_...   a personal token: supabase.com → Account → Access Tokens
//   RESEND_API_KEY=re_...           Resend → API Keys (sending access)
//   EMAIL_FROM=no-reply@your-domain.ph   an address on a domain verified in Resend
//   node supabase/email/push.mjs            (add --dry-run to print the settings without sending them)
//
// Optional: SUPABASE_PROJECT_REF (default Bannuar's), PORTAL_URL (default https://bannuar-portal.vercel.app),
// EMAIL_SENDER_NAME (default "Bannuar HR Portal"). Both keys stay on your computer: run this locally,
// never commit them, never put them in the portal.
import { TEMPLATES } from './templates.mjs';

const env = process.env;
const dry = process.argv.includes('--dry-run');
const ref = env.SUPABASE_PROJECT_REF || 'bcynizcgdgqznlxuzwjx';
const portal = (env.PORTAL_URL || 'https://bannuar-portal.vercel.app').replace(/\/$/, '');
const missing = ['SUPABASE_ACCESS_TOKEN', 'RESEND_API_KEY', 'EMAIL_FROM'].filter((k) => !env[k] && !dry);
if (missing.length) {
  console.error(`Set ${missing.join(', ')} first (see the top of this file).`);
  process.exit(1);
}
if (env.EMAIL_FROM && /@[^@]*(vercel\.app|gmail\.com|yahoo\.com)$/i.test(env.EMAIL_FROM)) {
  console.error('EMAIL_FROM must be on a domain you verified in Resend (its DNS records are yours to set). vercel.app or a webmail address cannot be verified.');
  process.exit(1);
}

const body = {
  site_url: portal,
  // where confirmation and reset links may send people back to
  uri_allow_list: [`${portal}/**`, 'http://localhost:5173/**'].join(','),
  smtp_host: 'smtp.resend.com',
  smtp_port: '465',
  smtp_user: 'resend',
  smtp_pass: env.RESEND_API_KEY || 're_dry_run',
  smtp_admin_email: env.EMAIL_FROM || 'no-reply@example.com',
  smtp_sender_name: env.EMAIL_SENDER_NAME || 'Bannuar HR Portal',
  // with its own mail server Supabase allows more than the built-in 2 an hour
  rate_limit_email_sent: 60,
};
for (const [key, t] of Object.entries(TEMPLATES)) {
  body[`mailer_subjects_${key}`] = t.subject;
  body[`mailer_templates_${key}_content`] = t.html;
}

if (dry) {
  const shown = { ...body, smtp_pass: '(hidden)' };
  for (const k of Object.keys(shown)) if (k.endsWith('_content')) shown[k] = `(${shown[k].length} characters of HTML)`;
  console.log(JSON.stringify(shown, null, 2));
  process.exit(0);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exit(1);
}
console.log(`Done. Project ${ref} now sends through Resend as ${body.smtp_sender_name} <${body.smtp_admin_email}>,`);
console.log(`links go to ${portal}, and ${Object.keys(TEMPLATES).length} templates are set.`);
console.log('Test it: portal → Forgot your password? → your own email.');
