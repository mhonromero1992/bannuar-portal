import type { PostgrestError } from '@supabase/supabase-js';

const TZ = 'Asia/Manila';
const dateFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric', timeZone: TZ });
const longDateFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-PH');

/** Dates stored as YYYY-MM-DD are calendar days: read them at noon in Manila so no time zone shifts them. */
const asDate = (v: string) => new Date(v.length === 10 ? `${v}T12:00:00+08:00` : v);

export const fmtDate = (v?: string | null) => (v ? dateFmt.format(asDate(v)) : '');
export const fmtLongDate = (v?: string | null) => (v ? longDateFmt.format(asDate(v)) : '');
export const fmtDateTime = (v?: string | null) => (v ? dateTimeFmt.format(new Date(v)) : '');
export const fmtMoney = (v?: number | string | null) => (v === null || v === undefined || v === '' ? '' : peso.format(Number(v)));
export const fmtNum = (v?: number | null) => (v === null || v === undefined ? '' : num.format(v));

export function todayManila(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function daysBetween(a: string, b: string) {
  return Math.round((asDate(b).getTime() - asDate(a).getTime()) / 86400000);
}

export function fullName(e?: { first_name?: string | null; middle_name?: string | null; last_name?: string | null; suffix?: string | null } | null) {
  if (!e) return '';
  const mi = e.middle_name?.trim() ? `${e.middle_name.trim()[0]}.` : '';
  return [e.first_name, mi, e.last_name, e.suffix].filter(Boolean).join(' ');
}

export function dateRange(a?: string | null, b?: string | null) {
  if (!a) return '';
  if (!b || a === b) return fmtDate(a);
  return `${fmtDate(a)} to ${fmtDate(b)}`;
}

/** Database messages raised on purpose are written for people; anything else gets a plain line. */
export function errorText(e: unknown): string {
  if (!e) return '';
  const err = e as Partial<PostgrestError> & { message?: string; status?: number };
  const code = err.code ?? '';
  if (['P0001', '22023', '42501', 'P0002'].includes(code) && err.message) return err.message;
  if (code === '23505') return 'That already exists: another record uses the same value.';
  if (code === '23503') return 'This record is still used elsewhere, so it cannot be changed this way.';
  if (code === '23514') return 'One of the values is not allowed. Check the form.';
  if (code === 'PGRST301' || err.status === 401) return 'Your session ended. Sign in again.';
  if (err.message && /fetch|network/i.test(err.message)) return 'No connection to the database. Check your internet and try again.';
  if (err.message && err.message.length < 160) return err.message;
  return 'Something went wrong. Try again in a moment.';
}

export function slugify(v: string) {
  return v.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
