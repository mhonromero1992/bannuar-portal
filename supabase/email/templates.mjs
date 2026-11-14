/**
 * Bannuar's account emails, sent by Supabase Auth through Resend.
 *
 * One layout, one entry per Supabase email. Supabase fills the {{ .Name }} parts when it sends:
 *   {{ .ConfirmationURL }}  the link to open      {{ .Token }}     the 6-digit code
 *   {{ .SiteURL }}          the portal's address  {{ .Email }}     the account's email
 *   {{ .NewEmail }}         the new address on an email change
 *   {{ .Data.full_name }}   the name given at sign-up, when there is one
 *
 * Written for every mail client: tables, inline styles, a PNG badge, no web fonts or scripts.
 * `node supabase/email/build.mjs` writes the HTML files; `node supabase/email/push.mjs` applies them.
 */

const C = { night: '#0b1626', ground: '#f6f3ec', panel: '#ffffff', ink: '#0d1a2b', muted: '#4f5b6b', line: '#e4ded1', red: '#c4161c', sun: '#f2c230' };
const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

/** The greeting uses the person's name when sign-up gave one. */
const HELLO = '{{ if .Data.full_name }}Hello {{ .Data.full_name }},{{ else }}Hello,{{ end }}';

function button(label, href = '{{ .ConfirmationURL }}') {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
  <tr><td bgcolor="${C.red}" style="border-radius:10px">
    <a href="${href}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px">${label}</a>
  </td></tr>
</table>`;
}

function fallbackLink(href = '{{ .ConfirmationURL }}') {
  return `<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">If the button does not open, copy this link into your browser:<br>
<a href="${href}" style="color:${C.ink};word-break:break-all">${href}</a></p>`;
}

const p = (text) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:16px;line-height:24px;color:${C.ink}">${text}</p>`;
const note = (text) => `<p style="margin:24px 0 0;padding-top:18px;border-top:1px solid ${C.line};font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${text}</p>`;

function layout({ preheader, title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${C.ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.ground}">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.ground}">
<tr><td align="center" style="padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
    <tr><td bgcolor="${C.night}" style="padding:22px 28px;border-radius:14px 14px 0 0;border-bottom:3px solid ${C.sun}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:14px"><img src="{{ .SiteURL }}/badge-128.png" width="44" height="44" alt="Bannuar badge" style="display:block;border:0"></td>
        <td style="font-family:${FONT};color:#eef2f7">
          <div style="font-size:18px;font-weight:bold;letter-spacing:2px">BANNUAR</div>
          <div style="font-size:11px;letter-spacing:1.5px;color:#aebccf">SECURITY AGENCY, INC.</div>
        </td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.panel}" style="padding:32px 28px 28px;border-radius:0 0 14px 14px">
      <h1 style="margin:0 0 18px;font-family:${FONT};font-size:24px;line-height:30px;color:${C.ink}">${title}</h1>
      ${body}
    </td></tr>
    <tr><td style="padding:20px 28px;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}" align="center">
      Bannuar Security Agency, Inc. · 2nd floor, Prime Place Estate, Diversion Road, Panicsican, San Juan, La Union<br>
      This message was sent to {{ .Email }} by the Bannuar HR portal. Please do not reply to it.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Keys match Supabase's names (mailer_subjects_<key>, mailer_templates_<key>_content). */
export const TEMPLATES = {
  confirmation: {
    name: 'Confirm sign up',
    subject: 'Confirm your Bannuar portal account',
    html: layout({
      preheader: 'One step left: confirm your email to finish setting up your account.',
      title: 'Confirm your email',
      body: `${p(HELLO)}
${p('Your account on the Bannuar HR portal is almost ready. Confirm that this email is yours, then sign in with the password you chose.')}
${button('Confirm my email')}
${fallbackLink()}
${note('The link works once and for a limited time. If you did not set up an account, you can ignore this email: the account cannot be used until it is confirmed.')}`,
    }),
  },
  recovery: {
    name: 'Reset password',
    subject: 'Reset your Bannuar portal password',
    html: layout({
      preheader: 'Choose a new password for the Bannuar HR portal.',
      title: 'Reset your password',
      body: `${p(HELLO)}
${p('Someone asked to reset the password of the Bannuar HR portal account for {{ .Email }}. Open the link to choose a new one.')}
${button('Choose a new password')}
${fallbackLink()}
${note('The link works once and for a limited time. If you did not ask for this, ignore this email: your password stays the same. If it keeps happening, tell your system administrator.')}`,
    }),
  },
  invite: {
    name: 'Invite user',
    subject: 'You are invited to the Bannuar HR portal',
    html: layout({
      preheader: 'Accept the invitation to set up your Bannuar portal account.',
      title: 'You are invited',
      body: `${p(HELLO)}
${p('You have been invited to the Bannuar HR portal. Accept the invitation to set your password and open the portal.')}
${button('Accept the invitation')}
${fallbackLink()}
${note('If you were not expecting this invitation, you can ignore this email.')}`,
    }),
  },
  magic_link: {
    name: 'Magic link',
    subject: 'Your Bannuar portal sign-in link',
    html: layout({
      preheader: 'Your one-time link to sign in to the Bannuar HR portal.',
      title: 'Sign in to the portal',
      body: `${p(HELLO)}
${p('Open this link to sign in to the Bannuar HR portal. It works once.')}
${button('Sign in')}
${fallbackLink()}
${note('If you did not ask to sign in, ignore this email. Nobody can use the link without access to your inbox.')}`,
    }),
  },
  email_change: {
    name: 'Change email address',
    subject: 'Confirm your new email for the Bannuar portal',
    html: layout({
      preheader: 'Confirm the change of your Bannuar portal email.',
      title: 'Confirm your new email',
      body: `${p(HELLO)}
${p('The email of your Bannuar HR portal account is changing from {{ .Email }} to <b>{{ .NewEmail }}</b>. Confirm the change to finish it.')}
${button('Confirm the change')}
${fallbackLink()}
${note('If you did not ask for this change, do not open the link, and tell your system administrator.')}`,
    }),
  },
  reauthentication: {
    name: 'Reauthentication',
    subject: 'Your Bannuar portal confirmation code',
    html: layout({
      preheader: 'Your code to confirm it is you.',
      title: 'Confirm it is you',
      body: `${p(HELLO)}
${p('Enter this code in the portal to continue:')}
<p style="margin:20px 0;font-family:${FONT};font-size:32px;font-weight:bold;letter-spacing:8px;color:${C.ink}">{{ .Token }}</p>
${note('The code works once and for a limited time. If you did not ask for it, ignore this email and tell your system administrator.')}`,
    }),
  },
};

/** Sample values for the preview, the way Supabase fills them. */
export function fillSample(html, site = 'https://bannuar-portal.vercel.app') {
  return html
    .replaceAll('{{ if .Data.full_name }}Hello {{ .Data.full_name }},{{ else }}Hello,{{ end }}', 'Hello Hector Ramos,')
    .replaceAll('{{ .ConfirmationURL }}', 'https://bcynizcgdgqznlxuzwjx.supabase.co/auth/v1/verify?token=sample&type=signup&redirect_to=https://bannuar-portal.vercel.app/sign-in')
    .replaceAll('{{ .SiteURL }}', site)
    .replaceAll('{{ .Email }}', 'hector@bannuar.example')
    .replaceAll('{{ .NewEmail }}', 'hector.ramos@bannuar.example')
    .replaceAll('{{ .Token }}', '482915');
}
