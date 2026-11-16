# Edge Functions

Supabase Edge Functions (Deno) that hold what the portal and the app must never hold themselves: the
service role key, the AWS keys and the Anthropic API key. Deploy and configure them with
[`../SETUP.md`](../SETUP.md), steps 8, 9, 10 and 12.

| Function | Called by | Does |
|---|---|---|
| [`activate-employee`](activate-employee/handler.ts) | the app, before sign-in (no JWT) | Checks employee number, birthdate and mobile number with `begin_employee_activation` (limits, log, one-time ticket), then `auth.admin.createUser` with the login email made from the employee number. Answers `{status: 'activated', login_email}` or `{code, message}`: `no_match` (400), `already_active` (409), `rate_limited` (429), `activation_failed` (400), `weak_password` (400), `invalid_input` (400), `server` (500) |
| [`files`](files/handler.ts) | the portal and the app, with the person's own token | Keeps employee files in Amazon S3. An upload (multipart: `purpose`, `file`, and `employee_id`, `document_type_id`, `kind` or `certificate_id` as needed) is read from its first bytes (PDF, JPEG, PNG, WebP or HEIC only, up to 10 MB), checked by `begin_file_upload` with the person's token (who may store what, and the key: `employees/<employee number>/<201-file, work-requirements, lesp, attendance, leave or certificates>/...`), put in S3 encrypted, then marked stored by `finish_file_upload`. `{action: 'sign', keys}` answers five-minute links for the keys `authorize_file_reads` allows. `{action: 'check'}` (super admins) stores, reads back and deletes a test file and makes sure the bucket refuses a public read. AWS requests are signed by [`_shared/sigv4.ts`](_shared/sigv4.ts) (no AWS SDK) |
| [`payslip-pdf`](payslip-pdf/handler.ts) | the portal and the app, with the person's own token | `{payslip_id}` → the payslip as a one-page PDF, made on the spot and never stored. The payslip is read with the person's token, so an employee gets only their own published payslip; payroll gets any (a draft says DRAFT) |
| [`document-ai`](document-ai/handler.ts) | the portal and the app, with the person's own token | `{action: 'check', key}`: Claude reads a stored document (a LESP by default; other types where Settings → Document types turns it on): the holder's name, the number, the dates and how legible it is. The function compares the name with the 201 file and the expiry with today itself (the 201 name is not sent) and keeps the reading in `stored_files.ai_check` |
| [`discipline-ai`](discipline-ai/handler.ts) | the portal (HR), with the person's own token | `{action: 'read_code', code_id}` sends the Code of Discipline's PDF to Claude through the Message Batches API; `{action: 'check_code', code_id}` collects the result as offense rules for HR to approve; `{action: 'suggest', case_id}` proposes the matching rule and a draft notice to explain from the facts written on the case (names stay placeholders) |
| [`logbook-ai`](logbook-ai/handler.ts) | the portal (HR, operations) and the client portal, with the person's own token | A photo of a page of a post's written logbook (multipart: `site_id`, `file`; JPEG, PNG or WebP up to 5 MB, HEIC explained): `begin_logbook_page` checks who may send for the post (a client only for its own posts, 30 pages an hour) and gives the key `company/logbooks/<post>/<year>/<month>/...`; the photo goes to S3, then Claude copies each line (name, number, date, time in and out, remarks, what is hard to read) and `save_logbook_reading` matches the names to the post's guards and compares each line with the app in the database. `{action: 'read', page_id}` reads a stored page again. If Claude cannot read it, the photo is kept and the page marked failed (`{status: 'failed', code, message}`). Claude gets the photo, the post's name and the date, never the guards' records |
| [`send-push`](send-push/handler.ts) | the Database Webhook on inserts into `public.notifications` | Sends the notification to the user's phones (`device_tokens`) through FCM HTTP v1, with the screen to open in `data.link` and the unread count as the badge. The text never carries amounts or personal numbers ([`_shared/pushText.ts`](_shared/pushText.ts)); tokens Google reports as gone are deleted |

Each `index.ts` only wires the real Supabase client and `Deno.serve`; the logic is in `handler.ts`,
which takes its dependencies as arguments so the tests can pass fakes.

## Secrets

| Name | For | |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEYS`) | all | set by Supabase |
| `EMPLOYEE_LOGIN_DOMAIN` | activate-employee | optional, default `employees.bannuar.invalid`; the app must use the same |
| `PUSH_WEBHOOK_SECRET` | send-push | the webhook sends it as `x-webhook-secret` |
| `FCM_SERVICE_ACCOUNT` | send-push | the Firebase service account JSON key; without it push is "not configured" |
| `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEYS`) | files, payslip-pdf, document-ai, discipline-ai, logbook-ai | set by Supabase; used with the person's own token |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | files, document-ai, discipline-ai, logbook-ai | the IAM user's key (SETUP.md step 9b); it can store and read files, not delete them |
| `AWS_REGION` | the same | the bucket's region; default `ap-southeast-1` (Singapore) |
| `S3_BUCKET` | the same | the bucket's name (no dots); until these four are set, uploads answer "not configured" |
| `ANTHROPIC_API_KEY` | document-ai, discipline-ai, logbook-ai | SETUP.md step 10b; without it, readings answer "not configured" and nothing else stops |

## Tests

```bash
cd supabase/functions
deno task test
deno task check
```

`deno task test` runs the handlers against a mocked admin client, a mocked Google API, a fake S3 and
a fake Claude (no network): 74 tests, checks the AWS signing against the worked examples in Amazon's S3 documentation, and
the payslip PDF's columns against `../../tests/schema-snapshot.json`;
`deno task check` type-checks the entry points and lints. Install Deno from deno.com, or
`npm install -g deno`.
