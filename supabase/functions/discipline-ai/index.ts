// Deploy: supabase functions deploy discipline-ai --no-verify-jwt   (supabase/SETUP.md, step 10)
// The Anthropic API key (ANTHROPIC_API_KEY) and the AWS keys are this function's secrets only. Every
// request carries the person's own token; the database decides whether they may ask (HR only).
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { publicKey, serviceKey } from '../_shared/http.ts';
import { createS3, validBucketName } from '../_shared/s3.ts';
import { type ClaudeApi, createDisciplineAiHandler, type Rpc } from './handler.ts';

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
const accessKeyId = env('AWS_ACCESS_KEY_ID') ?? '';
const secretAccessKey = env('AWS_SECRET_ACCESS_KEY') ?? '';
const s3 = accessKeyId && secretAccessKey && validBucketName(bucket)
  ? createS3({ accessKeyId, secretAccessKey, region: env('AWS_REGION') || 'ap-southeast-1', bucket })
  : null;

const apiKey = env('ANTHROPIC_API_KEY') ?? '';
const client = apiKey ? new Anthropic({ apiKey }) : null;
const claude: ClaudeApi | null = client && {
  createBatch: (params, customId) => client.messages.batches.create({ requests: [{ custom_id: customId, params }] }),
  batchStatus: async (id) => (await client.messages.batches.retrieve(id)).processing_status,
  batchResult: async (id) => {
    for await (const r of await client.messages.batches.results(id)) return r.result;
    return null;
  },
  message: (params) => client.beta.messages.create(params),
};

Deno.serve(
  createDisciplineAiHandler({
    userClient,
    admin: admin as unknown as Rpc,
    s3,
    claude,
    log: (event, fields) => console.log(JSON.stringify({ fn: 'discipline-ai', event, ...fields })),
  }),
);
