// The worked examples from AWS's Amazon S3 documentation (same example keys, bucket and date).
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { EMPTY_SHA256, presignUrl, sha256Hex, signHeaders, uriEncode } from './sigv4.ts';

const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const now = new Date('2013-05-24T00:00:00Z');
const host = 'examplebucket.s3.amazonaws.com';

Deno.test('AWS example: GET Object with a Range header', async () => {
  const h = await signHeaders({
    method: 'GET', host, path: '/test.txt', headers: { range: 'bytes=0-9' }, payloadHash: EMPTY_SHA256, creds,
    region: 'us-east-1', now,
  });
  assertEquals(
    h.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
  );
  assertEquals(h['x-amz-date'], '20130524T000000Z');
  assertEquals('host' in h, false); // fetch sets it from the URL
});

Deno.test('AWS example: PUT Object (a key with $ in it, a Date header, a storage class)', async () => {
  const body = 'Welcome to Amazon S3.';
  const payloadHash = await sha256Hex(body);
  assertEquals(payloadHash, '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
  const h = await signHeaders({
    method: 'PUT', host, path: '/test$file.text', payloadHash, creds, region: 'us-east-1', now,
    headers: { date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
  });
  assertStringIncludes(h.authorization, 'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class');
  assertStringIncludes(h.authorization, 'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

Deno.test('AWS example: a presigned link (query string authentication)', async () => {
  const url = await presignUrl({ host, path: '/test.txt', expiresIn: 86400, creds, region: 'us-east-1', now });
  assertEquals(
    url,
    'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256' +
      '&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z' +
      '&X-Amz-Expires=86400&X-Amz-SignedHeaders=host' +
      '&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
  );
});

Deno.test('URI encoding follows AWS: unreserved kept, the rest as uppercase %XX', () => {
  assertEquals(uriEncode('a b/c~d_e.f-g'), 'a%20b%2Fc~d_e.f-g');
  assertEquals(uriEncode('/employees/G-002/lesp/x.jpg', false), '/employees/G-002/lesp/x.jpg');
  assertEquals(uriEncode('attachment; filename="ñ.pdf"'), 'attachment%3B%20filename%3D%22%C3%B1.pdf%22');
});

Deno.test('a session token is signed and sent', async () => {
  const h = await signHeaders({
    method: 'GET', host, path: '/x', payloadHash: EMPTY_SHA256, creds: { ...creds, sessionToken: 'TOKEN' },
    region: 'ap-southeast-1', now,
  });
  assertEquals(h['x-amz-security-token'], 'TOKEN');
  assertStringIncludes(h.authorization, 'x-amz-security-token');
  const url = await presignUrl({ host, path: '/x', expiresIn: 300, creds: { ...creds, sessionToken: 'TOKEN' }, region: 'ap-southeast-1', now });
  assertStringIncludes(url, 'X-Amz-Security-Token=TOKEN');
});
