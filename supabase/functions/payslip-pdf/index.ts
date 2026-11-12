// Deploy: supabase functions deploy payslip-pdf --no-verify-jwt   (supabase/SETUP.md, step 9)
// The payslip is read with the caller's own token, so the database's rules decide whose payslip it is.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { publicKey } from '../_shared/http.ts';
import { createPayslipPdfHandler, type LoadPayslip, PAYSLIP_SELECT } from './handler.ts';
import type { PayslipRow } from './pdf.ts';

const env = (n: string) => Deno.env.get(n);
const url = env('SUPABASE_URL');
const anon = publicKey(env);
if (!url || !anon) throw new Error('SUPABASE_URL and the anon (publishable) key must be set');

const load: LoadPayslip = async (jwt, id) => {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data, error } = await client.from('payslips').select(PAYSLIP_SELECT).eq('id', id).maybeSingle();
  return { data: data as unknown as PayslipRow | null, error };
};

Deno.serve(
  createPayslipPdfHandler({
    load,
    log: (event, fields) => console.log(JSON.stringify({ fn: 'payslip-pdf', event, ...fields })),
  }),
);
