/**
 * send-push: a Database Webhook calls this on every insert into public.notifications, and it sends the
 * notification to that user's phones (public.device_tokens) through FCM HTTP v1.
 *
 * - The webhook sends the shared secret in the x-webhook-secret header (secret PUSH_WEBHOOK_SECRET).
 * - Push text never carries amounts or personal numbers (../_shared/pushText.ts).
 * - The app opens the screen in `link`; the badge shows the user's unread count.
 * - Tokens Google reports as gone are deleted.
 * - Until FCM_SERVICE_ACCOUNT is set, it answers 200 "not configured" so the webhook does not retry.
 */
import { sameSecret, json } from '../_shared/http.ts';
import { type FcmMessage, type FetchLike, type ServiceAccount, accessToken, sendFcm } from '../_shared/fcm.ts';
import { type NotificationRow, channelFor, pushText } from '../_shared/pushText.ts';

type QueryResult<T> = { data: T | null; error: { message: string } | null; count?: number | null };

/** The part of the Supabase admin client this function uses (structural, so tests can pass a fake). */
export interface PushAdmin {
  from(table: 'device_tokens'): {
    select(columns: 'token,platform'): { eq(column: 'user_id', value: string): PromiseLike<QueryResult<Array<{ token: string; platform: string }>>> };
    delete(): { in(column: 'token', values: string[]): PromiseLike<QueryResult<null>> };
  };
  from(table: 'notifications'): {
    select(columns: 'id', options: { count: 'exact'; head: true }): {
      eq(column: 'user_id', value: string): { is(column: 'read_at', value: null): PromiseLike<QueryResult<null>> };
    };
  };
}

export interface PushDeps {
  admin: PushAdmin;
  webhookSecret: string | undefined;
  serviceAccount: ServiceAccount | null;
  fetch: FetchLike;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

interface WebhookPayload {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRow | null;
}

export function buildMessage(row: NotificationRow, token: string, unread: number): FcmMessage {
  const { title, body } = pushText(row);
  const badge = Math.max(0, Math.min(unread, 999));
  return {
    token,
    notification: { title, body },
    data: {
      notification_id: String(row.id),
      kind: String(row.kind ?? ''),
      link: row.link == null ? '' : JSON.stringify(row.link),
    },
    android: { priority: 'HIGH', notification: { channel_id: channelFor(row), notification_count: badge } },
    apns: { payload: { aps: { badge, sound: 'default' } } },
  };
}

export function createPushHandler(deps: PushDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? (() => {});
  return async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'Use POST' });
    if (!deps.webhookSecret || !sameSecret(req.headers.get('x-webhook-secret') ?? '', deps.webhookSecret)) {
      return json(401, { error: 'Unauthorized' });
    }
    let payload: WebhookPayload;
    try {
      payload = (await req.json()) as WebhookPayload;
    } catch {
      return json(400, { error: 'Expected the webhook JSON' });
    }
    const row = payload.record;
    if (payload.type !== 'INSERT' || payload.table !== 'notifications' || !row?.user_id || !row.id) {
      return json(200, { skipped: 'not a new notification' });
    }
    if (!deps.serviceAccount) {
      log('push_not_configured');
      return json(200, { skipped: 'push is not configured (FCM_SERVICE_ACCOUNT)' });
    }

    const tokens = await deps.admin.from('device_tokens').select('token,platform').eq('user_id', row.user_id);
    if (tokens.error) {
      log('push_tokens_failed');
      return json(500, { error: 'Could not read device tokens' });
    }
    const list = tokens.data ?? [];
    if (list.length === 0) return json(200, { sent: 0 });

    const unreadQ = await deps.admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id)
      .is('read_at', null);
    const unread = unreadQ.count ?? 1;

    let bearer: string;
    try {
      bearer = await accessToken(deps.serviceAccount, deps.fetch);
    } catch (e) {
      log('push_auth_failed', { message: e instanceof Error ? e.message : 'error' });
      return json(502, { error: 'FCM sign-in failed' });
    }

    let sent = 0;
    const gone: string[] = [];
    const results = await Promise.all(
      list.map((t) => sendFcm(deps.serviceAccount!, bearer, buildMessage(row, t.token, unread), deps.fetch).catch(
        () => ({ ok: false as const, status: 0, error: 'network', dropToken: false }),
      )),
    );
    results.forEach((r, i) => {
      if (r.ok) sent++;
      else if (r.dropToken) gone.push(list[i].token);
    });
    if (gone.length) await deps.admin.from('device_tokens').delete().in('token', gone);
    log('push_sent', { sent, failed: list.length - sent, removed: gone.length, kind: String(row.kind ?? '') });
    return json(200, { sent, failed: list.length - sent, removed: gone.length });
  };
}
