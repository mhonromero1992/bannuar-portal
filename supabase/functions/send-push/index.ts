// Deploy: supabase functions deploy send-push --no-verify-jwt   (supabase/SETUP.md, step 8)
// Called by the Database Webhook on inserts into public.notifications, which sends x-webhook-secret.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { serviceKey } from '../_shared/http.ts';
import { parseServiceAccount } from '../_shared/fcm.ts';
import { type PushAdmin, createPushHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = serviceKey((n) => Deno.env.get(n));
if (!url || !key) throw new Error('SUPABASE_URL and the service role key must be set');

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(
  createPushHandler({
    admin: admin as unknown as PushAdmin,
    webhookSecret: Deno.env.get('PUSH_WEBHOOK_SECRET'),
    serviceAccount: parseServiceAccount(Deno.env.get('FCM_SERVICE_ACCOUNT')),
    fetch: (input, init) => fetch(input, init),
    log: (event, fields) => console.log(JSON.stringify({ fn: 'send-push', event, ...fields })),
  }),
);
