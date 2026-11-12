// Deploy: supabase functions deploy files --no-verify-jwt   (supabase/SETUP.md, step 9)
// Every request carries the person's own token; this function passes it to the database, which checks
// it and decides what they may store or open. The AWS keys never leave this function.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { publicKey, serviceKey } from '../_shared/http.ts';
import { createS3, validBucketName } from '../_shared/s3.ts';
import { createFilesHandler, type Rpc } from './handler.ts';

const env = (n: string) => Deno.env.get(n);
const url = env('SUPABASE_URL');
const secret = serviceKey(env);
const anon = publicKey(env);
if (!url || !secret || !anon) throw new Error('SUPABASE_URL, the anon (publishable) key and the service role key must be set');

const noSession = { persistSession: false, autoRefreshToken: false };
const admin = createClient(url, secret, { auth: noSession });
const userClient = (jwt: string) =>
  createClient(url, anon, { auth: noSession, global: { headers: { Authorization: `Bearer ${jwt}` } } }) as unknown as Rpc;

const bucket = env('S3_BUCKET') ?? '';
const region = env('AWS_REGION') || 'ap-southeast-1';
const accessKeyId = env('AWS_ACCESS_KEY_ID') ?? '';
const secretAccessKey = env('AWS_SECRET_ACCESS_KEY') ?? '';
const s3 = accessKeyId && secretAccessKey && validBucketName(bucket)
  ? createS3({ accessKeyId, secretAccessKey, region, bucket })
  : null;

Deno.serve(
  createFilesHandler({
    userClient,
    admin: admin as unknown as Rpc,
    s3,
    bucket: bucket || undefined,
    region,
    log: (event, fields) => console.log(JSON.stringify({ fn: 'files', event, ...fields })),
  }),
);
