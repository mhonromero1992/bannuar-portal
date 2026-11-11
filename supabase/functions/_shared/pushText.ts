/**
 * What a push notification may say. Phones show it on the lock screen, where anyone nearby can read it,
 * so it never carries an amount or a personal number (Data Privacy Act, RA 10173). Titles are fixed
 * phrases written by the database functions (or an announcement's title); bodies that staff type
 * freely (a payroll answer, a reason for declining) are replaced by a plain pointer to the app.
 */

export interface NotificationRow {
  id: string;
  user_id: string;
  title: string;
  body?: string | null;
  kind?: string | null;
  link?: unknown;
}

export const GENERIC_BODY = 'Open the Bannuar app to see it.';

/** Kinds whose body the database writes from fixed parts (a cutoff label, a post, a leave type, dates). */
const SAFE_BODY_KINDS = new Set(['payslip', 'announcement', 'document_expiry', 'deployment', 'leave_request', 'reliever']);

const MONEY = [
  /(₱|\bphp)\s?-?\d[\d,]*(\.\d+)?/gi, // ₱540, PHP 1,000.00
  /\bP\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, // P 1,234.56
  /\bP\s?\d+\.\d{2}\b/g, // P540.00
  /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g, // 9,530.00 or 1,500
  /\b\d{3,}\.\d{2}\b/g, // 540.00 (but not a time like 8.30)
];
// seven or more digits, allowing spaces, dots or dashes between them: mobile, SSS, PhilHealth, Pag-IBIG, TIN
const LONG_NUMBER = /\+?\d(?:[\s.-]?\d){6,}/g;

export function redact(text: string): string {
  let out = text;
  for (const re of MONEY) out = out.replace(re, '…');
  return out.replace(LONG_NUMBER, '…').replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function pushText(row: NotificationRow): { title: string; body: string } {
  const kind = row.kind ?? '';
  const title = clip(redact(row.title || 'Bannuar'), 65) || 'Bannuar';
  let body = GENERIC_BODY;
  if (SAFE_BODY_KINDS.has(kind) && row.body) {
    body = redact(row.body);
  } else if (kind === 'leave' && row.body && / · /.test(row.body) && !/[.!?]$/.test(row.body.trim())) {
    // "Service incentive leave · Nov 20 to 21, 2026"; a decline note in its place gets the generic line
    body = redact(row.body);
  }
  return { title, body: clip(body || GENERIC_BODY, 160) };
}

/** Urgent announcements use their own Android channel, so a guard can let only those make a sound. */
export function channelFor(row: NotificationRow): string {
  return row.kind === 'announcement' && /^urgent:/i.test(row.title) ? 'bannuar-urgent' : 'bannuar-updates';
}
