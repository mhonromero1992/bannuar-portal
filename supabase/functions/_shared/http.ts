/** Small helpers shared by Bannuar's Edge Functions. */

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...headers },
  });
}

/**
 * The caller's IP for the rate limits. Supabase sits behind Cloudflare, which sets cf-connecting-ip
 * itself (a client cannot forge it); x-forwarded-for is only a fallback, because its first entry is
 * whatever the client sent.
 */
export function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf.slice(0, 64);
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd ? fwd.slice(0, 64) : null;
}

/** Compares secrets in constant time, so the answer's timing does not leak how much matched. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The public key a function uses to call the API as the signed-in person (with their own token):
 * SUPABASE_ANON_KEY, or the first key in SUPABASE_PUBLISHABLE_KEYS (the newer sb_publishable_ keys).
 */
export function publicKey(env: (name: string) => string | undefined): string | undefined {
  const legacy = env('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const raw = env('SUPABASE_PUBLISHABLE_KEYS');
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return raw.startsWith('sb_publishable_') ? raw : undefined;
  }
}

/** The token after "Bearer " in the Authorization header, or null. */
export function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

/**
 * The service role key: SUPABASE_SERVICE_ROLE_KEY (the legacy JWT key, set in every project that still
 * has it), or the first key in SUPABASE_SECRET_KEYS (the newer sb_secret_ keys).
 */
export function serviceKey(env: (name: string) => string | undefined): string | undefined {
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const raw = env('SUPABASE_SECRET_KEYS');
  if (!raw) return undefined;
  try {
    const keys = JSON.parse(raw) as Record<string, string>;
    return keys.default ?? Object.values(keys)[0];
  } catch {
    return raw.startsWith('sb_secret_') ? raw : undefined;
  }
}
