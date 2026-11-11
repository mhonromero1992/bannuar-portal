import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createPushHandler, type PushAdmin } from './handler.ts';
import { resetTokenCache, type ServiceAccount } from '../_shared/fcm.ts';
import { GENERIC_BODY } from '../_shared/pushText.ts';

const SECRET = 'webhook-secret-1';

async function makeServiceAccount(): Promise<{ sa: ServiceAccount; publicKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  return {
    sa: { project_id: 'bannuar-test', client_email: 'push@bannuar-test.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` },
    publicKey: pair.publicKey,
  };
}

/** A stand-in for the service-role client with device tokens and an unread count. */
function fakeAdmin(tokens: Array<{ token: string; platform: string }>, unread = 3) {
  const deleted: string[][] = [];
  const reads: string[] = [];
  const admin = {
    from(table: string) {
      reads.push(table);
      if (table === 'device_tokens') {
        return {
          select: () => ({ eq: (_c: string, uid: string) => Promise.resolve({ data: uid === 'u1' ? tokens : [], error: null }) }),
          delete: () => ({ in: (_c: string, values: string[]) => { deleted.push(values); return Promise.resolve({ data: null, error: null }); } }),
        };
      }
      return { select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: null, error: null, count: unread }) }) }) };
    },
  } as unknown as PushAdmin;
  return { admin, deleted, reads };
}

type Sent = { url: string; body: string; headers: Headers };

function fakeFetch(answer: (token: string) => Response = () => new Response('{}', { status: 200 })) {
  const sent: Sent[] = [];
  const fetchFn = (url: string, init?: RequestInit) => {
    sent.push({ url, body: String(init?.body ?? ''), headers: new Headers(init?.headers) });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return Promise.resolve(new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 }));
    }
    const token = JSON.parse(String(init?.body)).message.token as string;
    return Promise.resolve(answer(token));
  };
  return { fetchFn, sent };
}

const row = {
  id: 'n1',
  user_id: 'u1',
  title: 'Your payslip is ready',
  body: 'Oct 16 to 31, 2026',
  kind: 'payslip',
  link: { screen: 'Payslip', id: 'ps1' },
};
const hook = (record: unknown, secret = SECRET, type = 'INSERT') =>
  new Request('http://localhost/send-push', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': secret },
    body: JSON.stringify({ type, table: 'notifications', schema: 'public', record, old_record: null }),
  });

Deno.test('without the webhook secret nothing is read or sent', async () => {
  const { admin, reads } = fakeAdmin([{ token: 't1', platform: 'android' }]);
  const { fetchFn, sent } = fakeFetch();
  const h = createPushHandler({ admin, webhookSecret: SECRET, serviceAccount: (await makeServiceAccount()).sa, fetch: fetchFn });
  assertEquals((await h(hook(row, 'wrong'))).status, 401);
  assertEquals((await h(new Request('http://x', { method: 'POST', body: '{}' }))).status, 401);
  const unset = createPushHandler({ admin, webhookSecret: undefined, serviceAccount: null, fetch: fetchFn });
  assertEquals((await unset(hook(row, ''))).status, 401);
  assertEquals(reads.length + sent.length, 0);
});

Deno.test('sends to every phone of the user with the link, the badge and the channel', async () => {
  resetTokenCache();
  const { sa, publicKey } = await makeServiceAccount();
  const { admin } = fakeAdmin([{ token: 't1', platform: 'android' }, { token: 't2', platform: 'ios' }], 4);
  const { fetchFn, sent } = fakeFetch();
  const res = await createPushHandler({ admin, webhookSecret: SECRET, serviceAccount: sa, fetch: fetchFn })(hook(row));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { sent: 2, failed: 0, removed: 0 });

  // Google sign-in: an RS256 JWT signed with the service account's key, for the FCM scope
  const auth = sent.find((s) => s.url.startsWith('https://oauth2.googleapis.com/token'))!;
  const assertion = new URLSearchParams(auth.body).get('assertion')!;
  const [h, c, sig] = assertion.split('.');
  const dec = (s: string) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
  assertEquals(dec(h), { alg: 'RS256', typ: 'JWT' });
  assertEquals(dec(c).scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assertEquals(dec(c).iss, sa.client_email);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
  assert(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sigBytes, new TextEncoder().encode(`${h}.${c}`)));

  const fcm = sent.filter((s) => s.url.includes('fcm.googleapis.com'));
  assertEquals(fcm.length, 2);
  assertEquals(fcm[0].url, 'https://fcm.googleapis.com/v1/projects/bannuar-test/messages:send');
  assertEquals(fcm[0].headers.get('authorization'), 'Bearer ya29.test');
  const msg = JSON.parse(fcm[0].body).message;
  assertEquals(msg.token, 't1');
  assertEquals(msg.notification, { title: 'Your payslip is ready', body: 'Oct 16 to 31, 2026' });
  assertEquals(msg.data, { notification_id: 'n1', kind: 'payslip', link: '{"screen":"Payslip","id":"ps1"}' });
  assertEquals(msg.android, { priority: 'HIGH', notification: { channel_id: 'bannuar-updates', notification_count: 4 } });
  assertEquals(msg.apns.payload.aps, { badge: 4, sound: 'default' });
  for (const v of Object.values(msg.data)) assertEquals(typeof v, 'string');
});

Deno.test('the access token is reused between pushes', async () => {
  resetTokenCache();
  const { sa } = await makeServiceAccount();
  const { admin } = fakeAdmin([{ token: 't1', platform: 'android' }]);
  const { fetchFn, sent } = fakeFetch();
  const h = createPushHandler({ admin, webhookSecret: SECRET, serviceAccount: sa, fetch: fetchFn });
  await h(hook(row));
  await h(hook({ ...row, id: 'n2' }));
  assertEquals(sent.filter((s) => s.url.startsWith('https://oauth2')).length, 1);
});

Deno.test('a payroll answer typed by staff never reaches the lock screen', async () => {
  resetTokenCache();
  const { admin } = fakeAdmin([{ token: 't1', platform: 'android' }]);
  const { fetchFn, sent } = fakeFetch();
  await createPushHandler({ admin, webhookSecret: SECRET, serviceAccount: (await makeServiceAccount()).sa, fetch: fetchFn })(
    hook({ ...row, kind: 'payroll_concern', title: 'Your payroll concern is resolved', body: 'Added ₱540.00, SSS 02-2345678-9' }),
  );
  const msg = JSON.parse(sent.find((s) => s.url.includes('fcm'))!.body).message;
  assertEquals(msg.notification.body, GENERIC_BODY);
  assert(!JSON.stringify(msg).includes('540') && !JSON.stringify(msg).includes('2345678'));
});

Deno.test('phones Google reports as gone are removed; other failures keep their token', async () => {
  resetTokenCache();
  const { admin, deleted } = fakeAdmin([
    { token: 'gone', platform: 'android' },
    { token: 'bad-message', platform: 'android' },
    { token: 'ok', platform: 'ios' },
  ]);
  const { fetchFn } = fakeFetch((token) => {
    if (token === 'gone') return new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
    if (token === 'bad-message') return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'Invalid value at message.data' } }), { status: 400 });
    return new Response('{}', { status: 200 });
  });
  const res = await createPushHandler({ admin, webhookSecret: SECRET, serviceAccount: (await makeServiceAccount()).sa, fetch: fetchFn })(hook(row));
  assertEquals(await res.json(), { sent: 1, failed: 2, removed: 1 });
  assertEquals(deleted, [['gone']]);
});

Deno.test('nothing to do: not an insert, no phones, or push not set up', async () => {
  const { sa } = await makeServiceAccount();
  const { fetchFn, sent } = fakeFetch();
  const none = fakeAdmin([]);
  let res = await createPushHandler({ admin: none.admin, webhookSecret: SECRET, serviceAccount: sa, fetch: fetchFn })(hook({ ...row, user_id: 'u2' }));
  assertEquals(await res.json(), { sent: 0 });
  res = await createPushHandler({ admin: none.admin, webhookSecret: SECRET, serviceAccount: sa, fetch: fetchFn })(hook(row, SECRET, 'UPDATE'));
  assertEquals((await res.json()).skipped, 'not a new notification');
  res = await createPushHandler({ admin: none.admin, webhookSecret: SECRET, serviceAccount: null, fetch: fetchFn })(hook(row));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).skipped, 'push is not configured (FCM_SERVICE_ACCOUNT)');
  assertEquals(sent.length, 0);
});
