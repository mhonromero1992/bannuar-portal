// The files function against a fake database and a fake S3 (no network).
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { createS3, S3Error, validBucketName, type S3 } from '../_shared/s3.ts';
import { sniffType } from '../_shared/sniff.ts';
import { createFilesHandler, type FilesDeps, LINK_SECONDS, type Rpc } from './handler.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF');
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);
const KEY = 'employees/G-002/lesp/2026-11-12_security-license_0a1b2c3d4e.jpg';
const FILE_ID = '11111111-2222-4333-8444-555555555555';
const LESP_TYPE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

type Call = { fn: string; args?: Record<string, unknown>; jwt?: string };

function fakeDb(answers: Record<string, { data?: unknown; error?: { message: string; code?: string } }>) {
  const calls: Call[] = [];
  const client = (jwt?: string): Rpc => ({
    rpc(fn, args) {
      calls.push({ fn, args, jwt });
      const a = answers[fn] ?? { data: null };
      return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
    },
  });
  return { calls, userClient: (jwt: string) => client(jwt), admin: client() };
}

function fakeS3(fail?: { on: 'put' | 'get' | 'remove'; error: Error }) {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  const s3: S3 = {
    put(key, body, type) {
      if (fail?.on === 'put') return Promise.reject(fail.error);
      objects.set(key, { body, type });
      return Promise.resolve();
    },
    get(key) {
      if (fail?.on === 'get') return Promise.reject(fail.error);
      return Promise.resolve(objects.get(key)?.body ?? new Uint8Array());
    },
    remove(key) {
      if (fail?.on === 'remove') return Promise.reject(fail.error);
      objects.delete(key);
      return Promise.resolve();
    },
    presignGet: (key, o) => Promise.resolve(`https://signed.example/${key}?exp=${o.expiresIn}&cd=${encodeURIComponent(o.disposition ?? '')}`),
    publicUrl: (key) => `https://bucket.example/${key}`,
  };
  return { s3, objects };
}

const signedIn = { data: { user_id: 'u-1', roles: [] as string[] } };

function handler(over: Partial<FilesDeps> & { answers?: Parameters<typeof fakeDb>[0] } = {}) {
  const db = fakeDb({ my_access: signedIn, ...over.answers });
  const store = fakeS3();
  const logs: string[] = [];
  const h = createFilesHandler({
    userClient: db.userClient,
    admin: db.admin,
    s3: 's3' in over ? over.s3! : store.s3,
    bucket: 'bannuar-hr-files',
    region: 'ap-southeast-1',
    fetch: over.fetch,
    now: () => new Date('2026-11-12T03:04:05.678Z'),
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
  });
  return { h, db, store, logs };
}

function uploadReq(file: Uint8Array | null, fields: Record<string, string>, token = 'user-jwt') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set('file', new Blob([file as BlobPart]), 'whatever.png');
  return new Request('https://x.supabase.co/functions/v1/files', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}
const jsonReq = (body: unknown, token = 'user-jwt') =>
  new Request('https://x.supabase.co/functions/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

Deno.test('a guard’s LESP renewal: sniffed, begun with her own token, stored in S3, then marked stored', async () => {
  const { h, db, store, logs } = handler({
    answers: { begin_file_upload: { data: { id: FILE_ID, key: KEY } }, finish_file_upload: { data: { key: KEY } } },
  });
  const res = await h(uploadReq(JPEG, { purpose: 'document', document_type_id: LESP_TYPE }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { id: FILE_ID, key: KEY, name: '2026-11-12_security-license_0a1b2c3d4e.jpg', content_type: 'image/jpeg', size_bytes: JPEG.length });
  const begin = db.calls.find((c) => c.fn === 'begin_file_upload')!;
  assertEquals(begin.jwt, 'user-jwt');
  assertEquals(begin.args, {
    p_purpose: 'document', p_content_type: 'image/jpeg', p_size_bytes: JPEG.length, p_employee_id: null,
    p_document_type_id: LESP_TYPE, p_kind: null, p_certificate_id: null,
  });
  assertEquals(store.objects.get(KEY)?.type, 'image/jpeg'); // the sniffed type, not the name's
  const finish = db.calls.find((c) => c.fn === 'finish_file_upload')!;
  assertEquals(finish.jwt, undefined); // the service role
  assertEquals(finish.args, { p_file_id: FILE_ID, p_size_bytes: JPEG.length });
  assert(logs.every((l) => !l.includes('employees/') && !l.includes('G-002')), 'no keys or employee numbers in the logs');
});

Deno.test('anything but a PDF or a photo is refused before the database or S3 hear of it', async () => {
  const { h, db, store } = handler();
  const res = await h(uploadReq(EXE, { purpose: 'document', document_type_id: LESP_TYPE }));
  assertEquals(res.status, 415);
  assertEquals((await res.json()).code, 'bad_type');
  assertEquals(db.calls.some((c) => c.fn === 'begin_file_upload'), false);
  assertEquals(store.objects.size, 0);
});

Deno.test('the database’s refusal is passed on in its own words; nothing reaches S3', async () => {
  const { h, store } = handler({
    answers: { begin_file_upload: { error: { message: 'You can only upload your own files', code: '42501' } } },
  });
  const res = await h(uploadReq(JPEG, { purpose: 'document', document_type_id: LESP_TYPE }));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { code: 'refused', message: 'You can only upload your own files' });
  assertEquals(store.objects.size, 0);
  const tooBig = handler({ answers: { begin_file_upload: { error: { message: 'The file is too large: up to 3 MB', code: '22023' } } } });
  assertEquals((await tooBig.h(uploadReq(JPEG, { purpose: 'attendance', kind: 'time_in' }))).status, 400);
});

Deno.test('when S3 fails the upload is not marked stored', async () => {
  const broken = fakeS3({ on: 'put', error: new S3Error(403, 'AccessDenied') });
  const { h, db, logs } = handler({ s3: broken.s3, answers: { begin_file_upload: { data: { id: FILE_ID, key: KEY } } } });
  const res = await h(uploadReq(PDF, { purpose: 'leave' }));
  assertEquals(res.status, 502);
  assertEquals(db.calls.some((c) => c.fn === 'finish_file_upload'), false);
  assertStringIncludes(logs.join(), 'AccessDenied');
});

Deno.test('signed out, a bad id, no file, or no AWS settings yet', async () => {
  const { h } = handler();
  assertEquals((await h(uploadReq(JPEG, { purpose: 'leave' }, ''))).status, 401);
  assertEquals((await h(uploadReq(JPEG, { purpose: 'document', document_type_id: 'not-a-uuid' }))).status, 400);
  assertEquals((await h(uploadReq(null, { purpose: 'leave' }))).status, 400);
  const expired = handler({ answers: { my_access: { error: { message: 'JWT expired', code: 'PGRST303' } } } });
  assertEquals((await expired.h(uploadReq(JPEG, { purpose: 'leave' }))).status, 401);
  const anonymous = handler({ answers: { my_access: { data: { user_id: null, roles: [] } } } });
  assertEquals((await anonymous.h(uploadReq(JPEG, { purpose: 'leave' }))).status, 401);
  const unset = handler({ s3: null });
  const res = await unset.h(uploadReq(JPEG, { purpose: 'leave' }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).code, 'not_configured');
  assertEquals((await h(new Request('https://x/files', { method: 'GET' }))).status, 405);
  assertEquals((await h(new Request('https://x/files', { method: 'OPTIONS' }))).status, 200);
});

Deno.test('a body over 10 MB is refused from its length, before it is read', async () => {
  const { h, db } = handler();
  const req = new Request('https://x/files', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(11 * 1024 * 1024) },
    body: 'x',
  });
  assertEquals((await h(req)).status, 413);
  assertEquals(db.calls.length, 0);
});

Deno.test('links: only for keys the database allows, five minutes, inline or as a download', async () => {
  const allowed = [{ object_key: KEY, file_name: '2026-11-12_security-license_0a1b2c3d4e.jpg', content_type: 'image/jpeg' }];
  const { h, db } = handler({ answers: { authorize_file_reads: { data: allowed } } });
  const res = await h(jsonReq({ action: 'sign', keys: [KEY, KEY, 'employees/G-003/lesp/x.jpg', '1234/uploads/old.jpg', 42] }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(Object.keys(body.urls), [KEY]);
  assertEquals(body.expires_in, LINK_SECONDS);
  assertStringIncludes(body.urls[KEY], `exp=${LINK_SECONDS}`);
  assertStringIncludes(decodeURIComponent(body.urls[KEY]), 'inline; filename="2026-11-12_security-license_0a1b2c3d4e.jpg"');
  const asked = db.calls.find((c) => c.fn === 'authorize_file_reads')!;
  assertEquals(asked.args, { p_keys: [KEY, 'employees/G-003/lesp/x.jpg'] }); // deduplicated; old Supabase paths are not S3's
  assertEquals(asked.jwt, 'user-jwt');
  const dl = await (await h(jsonReq({ action: 'sign', keys: [KEY], download: true }))).json();
  assertStringIncludes(decodeURIComponent(dl.urls[KEY]), 'attachment;');
  assertEquals((await h(jsonReq({ action: 'sign', keys: [] }))).status, 400);
  assertEquals((await h(jsonReq({ action: 'sign', keys: new Array(201).fill(KEY) }))).status, 400);
  assertEquals((await h(jsonReq({ action: 'nothing' }))).status, 400);
});

Deno.test('the storage check: super admins only; stores, reads back, proves the bucket private, deletes', async () => {
  const notAdmin = handler();
  assertEquals((await notAdmin.h(jsonReq({ action: 'check' }))).status, 403);

  const admin = { my_access: { data: { user_id: 'u-1', roles: ['super_admin'] } } };
  const privateBucket = handler({ answers: admin, fetch: () => Promise.resolve(new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })) });
  const ok = await (await privateBucket.h(jsonReq({ action: 'check' }))).json();
  assertEquals(ok, { ok: true, bucket: 'bannuar-hr-files', region: 'ap-southeast-1' });
  assertEquals(privateBucket.store.objects.size, 0); // the test file is deleted

  const publicBucket = handler({ answers: admin, fetch: () => Promise.resolve(new Response('Bannuar file storage check')) });
  const pub = await (await publicBucket.h(jsonReq({ action: 'check' }))).json();
  assertEquals([pub.ok, pub.step], [false, 'private']);
  assertStringIncludes(pub.message, 'Block Public Access');

  const denied = handler({ answers: admin, s3: fakeS3({ on: 'put', error: new S3Error(403, 'AccessDenied') }).s3 });
  const no = await (await denied.h(jsonReq({ action: 'check' }))).json();
  assertEquals([no.ok, no.step, no.aws_code], [false, 'put', 'AccessDenied']);
  assertStringIncludes(no.message, 'IAM policy');

  const unset = handler({ answers: admin, s3: null });
  const u = await (await unset.h(jsonReq({ action: 'check' }))).json();
  assertEquals([u.ok, u.step], [false, 'settings']);
});

Deno.test('the S3 client signs a PUT to <bucket>.s3.<region>.amazonaws.com, encrypted, and reads S3 error codes', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  let answer = new Response(null, { status: 200 });
  const s3 = createS3(
    { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', region: 'ap-southeast-1', bucket: 'bannuar-hr-files' },
    {
      fetch: (url, init) => {
        seen.push({ url: String(url), init: init ?? {} });
        return Promise.resolve(answer);
      },
      now: () => new Date('2026-11-12T00:00:00Z'),
    },
  );
  await s3.put(KEY, JPEG, 'image/jpeg');
  assertEquals(seen[0].url, `https://bannuar-hr-files.s3.ap-southeast-1.amazonaws.com/${KEY}`);
  const headers = seen[0].init.headers as Record<string, string>;
  assertEquals(headers['x-amz-server-side-encryption'], 'AES256');
  assertEquals(headers['content-type'], 'image/jpeg');
  assertStringIncludes(headers.authorization, 'Credential=AKIDEXAMPLE/20261112/ap-southeast-1/s3/aws4_request');
  assertStringIncludes(headers.authorization, 'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-server-side-encryption');
  const link = await s3.presignGet(KEY, { expiresIn: 300, disposition: 'inline; filename="a.jpg"' });
  assertStringIncludes(link, 'X-Amz-Expires=300');
  assertStringIncludes(link, 'response-content-disposition=inline%3B%20filename%3D%22a.jpg%22');
  answer = new Response('<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>x</Message></Error>', { status: 404 });
  const err = await s3.get(KEY).catch((e) => e);
  assert(err instanceof S3Error);
  assertEquals([err.status, err.awsCode], [404, 'NoSuchBucket']);
  assertEquals(validBucketName('bannuar-hr-files'), true);
  assertEquals(validBucketName('bannuar.hr.files'), false); // dots break the bucket's certificate
});

Deno.test('file types come from the first bytes', () => {
  assertEquals(sniffType(JPEG), 'image/jpeg');
  assertEquals(sniffType(PDF), 'application/pdf');
  assertEquals(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
  assertEquals(sniffType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assertEquals(sniffType(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0')), 'image/heic');
  assertEquals(sniffType(new TextEncoder().encode('\n\n%PDF-1.4')), 'application/pdf');
  assertEquals(sniffType(EXE), null);
  assertEquals(sniffType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});
