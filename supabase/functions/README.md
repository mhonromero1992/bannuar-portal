# Edge Functions for the employee app

Two Supabase Edge Functions (Deno) that hold what the app must never hold itself: the service role
key. Deploy and configure them with [`../SETUP.md`](../SETUP.md), step 8.

| Function | Called by | Does |
|---|---|---|
| [`activate-employee`](activate-employee/handler.ts) | the app, before sign-in (no JWT) | Checks employee number, birthdate and mobile number with `begin_employee_activation` (limits, log, one-time ticket), then `auth.admin.createUser` with the login email made from the employee number. Answers `{status: 'activated', login_email}` or `{code, message}`: `no_match` (400), `already_active` (409), `rate_limited` (429), `activation_failed` (400), `weak_password` (400), `invalid_input` (400), `server` (500) |
| [`send-push`](send-push/handler.ts) | the Database Webhook on inserts into `public.notifications` | Sends the notification to the user's phones (`device_tokens`) through FCM HTTP v1, with the screen to open in `data.link` and the unread count as the badge. The text never carries amounts or personal numbers ([`_shared/pushText.ts`](_shared/pushText.ts)); tokens Google reports as gone are deleted |

Each `index.ts` only wires the real Supabase client and `Deno.serve`; the logic is in `handler.ts`,
which takes its dependencies as arguments so the tests can pass fakes.

## Secrets

| Name | For | |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEYS`) | both | set by Supabase |
| `EMPLOYEE_LOGIN_DOMAIN` | activate-employee | optional, default `employees.bannuar.invalid`; the app must use the same |
| `PUSH_WEBHOOK_SECRET` | send-push | the webhook sends it as `x-webhook-secret` |
| `FCM_SERVICE_ACCOUNT` | send-push | the Firebase service account JSON key; without it push is "not configured" |

## Tests

```bash
cd supabase/functions
deno task test
deno task check
```

`deno task test` runs the handlers against a mocked admin client and a mocked Google API (no network);
`deno task check` type-checks the entry points and lints. Install Deno from deno.com, or
`npm install -g deno`.
