/**
 * Firebase Cloud Messaging, HTTP v1 API. The function signs in as the Firebase project's service
 * account (secret FCM_SERVICE_ACCOUNT: the JSON key file from Firebase console > Project settings >
 * Service accounts), trades that for a one-hour access token, and sends one message per device token.
 */

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FcmMessage {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  android: { priority: 'HIGH' | 'NORMAL'; notification: { channel_id: string; notification_count?: number; tag?: string } };
  apns: { payload: { aps: { badge?: number; sound?: string } } };
}

export type SendResult = { ok: true } | { ok: false; status: number; error: string; dropToken: boolean };

export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    if (sa.project_id && sa.client_email && sa.private_key) {
      return { project_id: sa.project_id, client_email: sa.client_email, private_key: sa.private_key };
    }
  } catch {
    // fall through
  }
  return null;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = (s: string) => b64url(new TextEncoder().encode(s));

/** The key's bytes, as an ArrayBuffer (what crypto.subtle takes on every Deno version). */
function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function signedJwt(sa: ServiceAccount, nowSeconds: number): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
  const unsigned = `${textB64url(JSON.stringify(header))}.${textB64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${b64url(sig)}`;
}

let cached: { email: string; token: string; expires: number } | null = null;

/** Forgets the cached access token (tests). */
export function resetTokenCache() {
  cached = null;
}

export async function accessToken(sa: ServiceAccount, fetchFn: FetchLike, now: () => number = Date.now): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.expires > now() + 60_000) return cached.token;
  const assertion = await signedJwt(sa, Math.floor(now() / 1000));
  const res = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  if (!res.ok) throw new Error(`Google sign-in for FCM failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { email: sa.client_email, token: data.access_token, expires: now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

export async function sendFcm(sa: ServiceAccount, token: string, message: FcmMessage, fetchFn: FetchLike): Promise<SendResult> {
  const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (res.ok) {
    await res.body?.cancel();
    return { ok: true };
  }
  let error = '';
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } };
    error = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? '';
    detail = body.error?.message ?? '';
  } catch {
    // not JSON
  }
  // The app was removed or the token rotated: this phone will never receive it again. A 400 is about
  // the token only when Google says so; otherwise the message itself was wrong and the token stays.
  const dropToken =
    res.status === 404 || error === 'UNREGISTERED' || (res.status === 400 && /registration token/i.test(detail));
  return { ok: false, status: res.status, error, dropToken };
}
