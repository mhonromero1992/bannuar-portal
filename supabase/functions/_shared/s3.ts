/**
 * The four S3 calls the files Edge Function needs (put, get, delete, and a presigned link), signed with
 * sigv4.ts. Bucket names must not contain dots: the bucket is addressed as
 * <bucket>.s3.<region>.amazonaws.com, and a dotted name breaks that certificate.
 */
import { type Credentials, EMPTY_SHA256, presignUrl, sha256Hex, signHeaders, uriEncode } from './sigv4.ts';

export interface S3Config extends Credentials {
  region: string;
  bucket: string;
}

export interface S3 {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  /** A GET link that works without credentials until it expires. */
  presignGet(key: string, opts: { expiresIn: number; disposition?: string }): Promise<string>;
  /** The object's plain URL, unsigned: the storage check uses it to prove the bucket is private. */
  publicUrl(key: string): string;
}

/** S3 refused: its HTTP status and its error code (AccessDenied, NoSuchBucket, SignatureDoesNotMatch, ...). */
export class S3Error extends Error {
  constructor(readonly status: number, readonly awsCode: string) {
    super(`S3 answered ${status} ${awsCode}`);
  }
}

export function validBucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name);
}

export function createS3(cfg: S3Config, deps: { fetch?: typeof fetch; now?: () => Date } = {}): S3 {
  const host = `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const creds: Credentials = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, sessionToken: cfg.sessionToken };
  const urlFor = (key: string) => `https://${host}${uriEncode('/' + key, false)}`;

  async function send(method: string, key: string, body?: Uint8Array, headers: Record<string, string> = {}) {
    const payloadHash = body ? await sha256Hex(body) : EMPTY_SHA256;
    const signed = await signHeaders({ method, host, path: '/' + key, headers, payloadHash, creds, region: cfg.region, now: now() });
    const res = await doFetch(urlFor(key), { method, headers: signed, body: body as BodyInit | undefined });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new S3Error(res.status, /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? `HTTP${res.status}`);
    }
    return res;
  }

  return {
    async put(key, body, contentType) {
      const res = await send('PUT', key, body, { 'content-type': contentType, 'x-amz-server-side-encryption': 'AES256' });
      await res.body?.cancel();
    },
    async get(key) {
      const res = await send('GET', key);
      return new Uint8Array(await res.arrayBuffer());
    },
    async remove(key) {
      const res = await send('DELETE', key);
      await res.body?.cancel();
    },
    presignGet(key, opts) {
      const query: Record<string, string> = {};
      if (opts.disposition) query['response-content-disposition'] = opts.disposition;
      return presignUrl({ host, path: '/' + key, query, expiresIn: opts.expiresIn, creds, region: cfg.region, now: now() });
    },
    publicUrl: urlFor,
  };
}
