import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** False until .env names the Supabase project; the portal then shows the set-up steps. */
export const configured = Boolean(url && key);

export const supabase = createClient(configured ? url : 'https://not-configured.invalid', configured ? key : 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** The public website: certificates print a link to its verification page. */
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
