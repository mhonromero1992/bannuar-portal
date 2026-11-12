/**
 * AWS Signature Version 4 for Amazon S3, with nothing but Web Crypto (no AWS SDK). Used by the files
 * Edge Function to sign its S3 requests and the five-minute links it hands out. The tests check it
 * against the worked examples in AWS's S3 documentation ("Signature Calculations for the Authorization
 * Header" and "Authenticating Requests: Using Query Parameters").
 */

const enc = new TextEncoder();

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** AWS's URI encoding: every byte but A-Z a-z 0-9 - . _ ~ as %XX; '/' too unless it separates a path. */
export function uriEncode(s: string, encodeSlash = true): string {
  let out = '';
  for (const byte of enc.encode(s)) {
    const unreserved = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2d || byte === 0x2e || byte === 0x5f || byte === 0x7e;
    if (unreserved || (byte === 0x2f && !encodeSlash)) out += String.fromCharCode(byte);
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/** 2013-05-24T00:00:00Z -> { stamp: '20130524T000000Z', day: '20130524' } */
export function amzDate(now: Date): { stamp: string; day: string } {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return { stamp, day: stamp.slice(0, 8) };
}

function canonicalQuery(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

async function signatureFor(creds: Credentials, day: string, region: string, service: string, stringToSign: string) {
  let key = await hmac(enc.encode(`AWS4${creds.secretAccessKey}`), day);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  return toHex(await hmac(key, stringToSign));
}

export interface SignInput {
  method: string;
  host: string;
  /** The object's path as it is, '/' + key; it is encoded here. */
  path: string;
  query?: Record<string, string>;
  /** Headers to sign and send besides host, x-amz-date and x-amz-content-sha256 (added here). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED-PAYLOAD. */
  payloadHash: string;
  creds: Credentials;
  region: string;
  service?: string;
  now: Date;
}

/**
 * Signs a request in the Authorization header. Returns the headers to send: the ones given, x-amz-date,
 * x-amz-content-sha256, x-amz-security-token when there is one, and authorization. Host is signed but
 * not returned, because fetch sets it from the URL.
 */
export async function signHeaders(input: SignInput): Promise<Record<string, string>> {
  const service = input.service ?? 's3';
  const { stamp, day } = amzDate(input.now);
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const send: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) send[k.toLowerCase()] = v;
  send['x-amz-date'] = stamp;
  send['x-amz-content-sha256'] = input.payloadHash;
  if (input.creds.sessionToken) send['x-amz-security-token'] = input.creds.sessionToken;

  const signed: Record<string, string> = { ...send, host: input.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signed[n].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    input.method.toUpperCase(),
    uriEncode(input.path, false),
    canonicalQuery(input.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = await signatureFor(input.creds, day, input.region, service, stringToSign);
  send['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${input.creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return send;
}

export interface PresignInput {
  method?: string;
  host: string;
  path: string;
  /** Extra query parameters to sign, such as response-content-disposition. */
  query?: Record<string, string>;
  expiresIn: number;
  creds: Credentials;
  region: string;
  service?: string;
  now: Date;
}

/** A link anyone holding it can use until it expires (at most seven days; Bannuar uses five minutes). */
export async function presignUrl(input: PresignInput): Promise<string> {
  const service = input.service ?? 's3';
  const method = (input.method ?? 'GET').toUpperCase();
  const { stamp, day } = amzDate(input.now);
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const query: Record<string, string> = {
    ...(input.query ?? {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.creds.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(1, Math.min(604800, Math.floor(input.expiresIn)))),
    'X-Amz-SignedHeaders': 'host',
  };
  if (input.creds.sessionToken) query['X-Amz-Security-Token'] = input.creds.sessionToken;
  const cq = canonicalQuery(query);
  const canonicalRequest = [method, uriEncode(input.path, false), cq, `host:${input.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = await signatureFor(input.creds, day, input.region, service, stringToSign);
  return `https://${input.host}${uriEncode(input.path, false)}?${cq}&X-Amz-Signature=${signature}`;
}
