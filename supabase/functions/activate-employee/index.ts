// Deploy: supabase functions deploy activate-employee --no-verify-jwt   (supabase/SETUP.md, step 8)
// The app calls it before anyone is signed in, with the publishable key, so there is no user JWT to
// check; the database limits and logs every try instead.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { serviceKey } from '../_shared/http.ts';
import { DEFAULT_LOGIN_DOMAIN } from '../_shared/loginEmail.ts';
import { type ActivateAdmin, createActivateHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = serviceKey((n) => Deno.env.get(n));
if (!url || !key) throw new Error('SUPABASE_URL and the service role key must be set');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createActivateHandler({
    admin: admin as unknown as ActivateAdmin,
    loginDomain: Deno.env.get('EMPLOYEE_LOGIN_DOMAIN') || DEFAULT_LOGIN_DOMAIN,
    log: (event, fields) => console.log(JSON.stringify({ fn: 'activate-employee', event, ...fields })),
  }),
);
