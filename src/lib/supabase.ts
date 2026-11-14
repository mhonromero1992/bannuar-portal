import { createClient } from '@supabase/supabase-js';

/**
 * Bannuar's Supabase project, the same one the website uses. Both values are public by design: the
 * browser holds them, and row level security in the database decides what each signed-in person may
 * see and do. Environment variables override them for another project: VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY, or the NEXT_PUBLIC_ names. Never put the secret key in this app.
 */
const DEFAULT_URL = 'https://bcynizcgdgqznlxuzwjx.supabase.co';
const DEFAULT_KEY = 'sb_publishable_rwAYUkMVmJxXiT9SnrqlxA_VsMFHK25';
const env = import.meta.env;

const url = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL).replace(/\/$/, '');
const key =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  DEFAULT_KEY;

/** True with the built-in project; false only if a build is given empty values on purpose. */
export const configured = Boolean(url && key);

/** Where the project's Edge Functions answer (files, payslip-pdf), and the public key they need. */
export const FUNCTIONS_URL = `${url}/functions/v1`;
export const PUBLIC_KEY = key;

export const supabase = createClient(configured ? url : 'https://not-configured.invalid', configured ? key : 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** The public website: certificates print a link to its verification page. */
/**
 * The portal's public address. Links in emails (account confirmation, password reset) and the
 * address staff are told to open always use it, even when the portal runs on localhost.
 */
export const PORTAL_URL = (import.meta.env.VITE_PORTAL_URL || 'https://bannuar-portal.vercel.app').replace(/\/$/, '');

export const WEBSITE_URL = (import.meta.env.VITE_WEBSITE_URL ?? 'https://bannuar-website.vercel.app').replace(/\/$/, '');

/** A short-lived link to a private file. */
export async function signedUrl(bucket: string, path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data) throw error ?? new Error('No link');
  return data.signedUrl;
}

export async function openFile(bucket: string, path: string) {
  const win = window.open('about:blank', '_blank');
  try {
    const link = await signedUrl(bucket, path);
    if (win) win.location.href = link;
    else window.location.href = link;
  } catch (e) {
    win?.close();
    throw e;
  }
}
