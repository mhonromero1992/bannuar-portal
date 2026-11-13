# Supabase set-up for Bannuar

One Supabase project serves the public website, this HR portal and, later, the employee app.
`schema.sql` creates everything; this page is the order to do it in.

## 1. Create the project

supabase.com → **New project**. Name it `bannuar`, pick the region **Southeast Asia (Singapore)**,
and save the database password somewhere safe. Use a new project: the script refuses to run where
another app already has tables with the same names (`employees`, `profiles`, `notifications`…).

## 2. Run the schema

**SQL Editor → New query**, paste the whole of [`schema.sql`](schema.sql), **Run**. It finishes with
"Success. No rows returned".

The file is safe to run again. When this repository updates it, paste and run the new version: it
adds what is missing and never deletes records.

## 3. Sign-in settings

**Authentication → Sign In / Providers → Email**

- Keep **Email** enabled.
- **Confirm email**: on for production, together with step 4. For a first trial you can switch it
  off; sign-up stays invitation-only either way (the database refuses anyone without a valid
  invitation code).

**Authentication → URL Configuration**

- **Site URL**: the portal's address, for example `https://portal.bannuar.example`.
- **Redirect URLs**: add `https://<portal address>/reset-password` and
  `http://localhost:5173/reset-password`.

## 4. Email (needed for password-reset and confirmation emails)

**Authentication → Emails → SMTP Settings**: enter Bannuar's mail provider (Google Workspace,
Microsoft 365, Amazon SES, Resend…). Supabase's built-in sender only reaches the project's own team
members and a few messages an hour, so staff outside the team would never get their emails.

## 5. The first administrator

In the SQL Editor:

```sql
select public.bootstrap_super_admin('your.name@company.ph', 'Your Name');
```

It answers with an invitation code such as `K7QM-3XPD`. Open the portal, choose
**Set up your account**, and enter the same email, the code and a password. That account is the
super admin; everyone else is invited from the portal's **Users** screen, which shows each new
person's code to pass on to them.

(If that email already has an account in Authentication → Users, the function makes it the super
admin straight away.)

## 6. Keys for the website and the portal

**Project Settings → API** (or **API Keys**):

| Value | Goes into |
|---|---|
| Project URL | portal `.env` → `VITE_SUPABASE_URL`; website `.env` → `PUBLIC_SUPABASE_URL` |
| `anon` public key (or the publishable key) | portal `.env` → `VITE_SUPABASE_ANON_KEY`; website `.env` → `PUBLIC_SUPABASE_ANON_KEY` |

Never put the `service_role` / secret key in either: both are delivered to browsers.

## 7. Optional

**Demo records** for trying the portal: run [`seed-demo.sql`](seed-demo.sql) in a new project
(it refuses once real employees exist), and [`remove-demo.sql`](remove-demo.sql) to take them out.
The demo creates six employees, two posts, two payroll cutoffs, a leave request, a COE request,
an announcement, an application and a proposal request.

**Daily reminders for expiring licenses and clearances**: Database → Extensions → enable
`pg_cron`, then run:

```sql
select cron.schedule(
  'bannuar-document-reminders',
  '0 23 * * *',                      -- 23:00 UTC is 7:00 AM in Manila
  $$select public.send_document_expiry_reminders()$$
);
```

Each employee with a login is reminded 60, 30, 14, 7 and 1 days before, on the day, and the day
after a document expires.

## 8. The employee app

The app ([bannuar-app](https://github.com/mhonromero1992/bannuar-app)) needs the latest `schema.sql`
and two Edge Functions from [`functions/`](functions/README.md).

**a. Run the schema again.** SQL Editor → paste the whole new [`schema.sql`](schema.sql) → Run. It
adds the activation tickets and attempt log, `begin_employee_activation`, `register_device_token`
and the rule that an employee login needs a one-time ticket; it closes `check_employee_activation`
to the public API (only the Edge Function may call it, with limits). It also adds attendance:
`attendance_logs`, `log_attendance` and the private `attendance-photos` bucket. Nothing is deleted. Check, in
the SQL Editor:

```sql
select public.begin_employee_activation('NO-SUCH-NUMBER', '1990-01-01', '09170000000', null);
-- {"status": "no_match"}
```

**b. Deploy the two functions** with the [Supabase CLI](https://supabase.com/docs/guides/cli), from
this repository's folder:

```bash
supabase login
supabase functions deploy activate-employee --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
supabase functions deploy send-push --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
```

Log the CLI in with the Supabase account that owns the project (`supabase projects list` must show
`bcynizcgdgqznlxuzwjx`; a 403 means another account). `--use-api` uploads without Docker.
`--no-verify-jwt`: the app calls `activate-employee` before anyone is signed in (the database limits
and logs every try instead), and `send-push` checks its own secret header.

**c. Set the secrets** (Edge Functions → Secrets, or the CLI). `SUPABASE_URL` and the service role
key are already there.

| Secret | Value |
|---|---|
| `PUSH_WEBHOOK_SECRET` | a long random value, for example from `openssl rand -hex 32`; the webhook sends it |
| `FCM_SERVICE_ACCOUNT` | the whole JSON key from Firebase console → Project settings → Service accounts → Generate new private key. Until it is set, `send-push` answers "not configured" and the app still shows notifications live while it is open |
| `EMPLOYEE_LOGIN_DOMAIN` | optional; default `employees.bannuar.invalid`. Change it only together with the app's `.env`, before the first guard activates |

**d. Add the webhook** that sends each new notification to the phones: Database → Webhooks → Create
a new hook. Name `send-push`; table `public.notifications`; events: Insert; type: Supabase Edge
Functions (or HTTP Request) → `send-push` (`https://bcynizcgdgqznlxuzwjx.supabase.co/functions/v1/send-push`),
method POST, timeout 5000 ms; HTTP header `x-webhook-secret` with the `PUSH_WEBHOOK_SECRET` value.

**e. Commanders.** The app shows "My post" to everyone operations names on a post (Posts and clients
→ a post → commanders); the database lets them see that post's guards and endorse their leave.

**f. Attendance: each post's location.** Guards time in and out in the app with a photo of
themselves; the database stamps its own time and compares the phone's location with the post.
Operations sets each post's point once: Posts and clients → the post → Edit the post → "Location for
time in and out" (in Google Maps, right-click the post's entrance and click the two numbers at the
top to copy them) and the allowed distance (150 m by default; more for a big compound). Until a
post has one, its logs are marked "Post location not set". HR reviews the logs and photos under
Attendance ("Needs a look" lists logs away from the post, with GPS too rough to tell, with no
location, or from a phone with a mock location app on). A log is never refused for its location.

To try it with the demo logins, set the demo post's location to where you are, then time in from
the app as DEMO-0002.

Activation attempts (employee number, IP, result) are kept 30 days for the limits: 5 wrong tries per
employee number in 30 minutes, 20 per IP in an hour. They and the tickets are readable only with the
service role or in the SQL Editor:

```sql
select occurred_at, employee_no, ip, result from public.activation_attempts order by occurred_at desc limit 50;
```

## 9. Files in Amazon S3

Employee files (the 201 file, work requirements, the LESP, time in and out selfies, leave
attachments, certificates of employment) are kept in a private Amazon S3 bucket, one folder per
employee, named after the employee number:

```
employees/<employee number>/
  201-file/            birth certificate, IDs, diploma, contract, BIR 2316
  work-requirements/   clearances, drug test, neuro-psychiatric and medical results, training
  lesp/                the License to Exercise Security Profession
  attendance/<year>/<month>/   time in and time out selfies
  leave/               supporting documents attached to leave
  certificates/        certificates of employment as issued (PDF)
```

Each document type files into one of the first three folders; HR changes it in the portal (Settings
→ Document types → Folder in S3). File names carry the date, the document type and a random part,
for example `employees/G-002/lesp/2026-11-12_security-license_3f9a1c2b7d.jpg`. **Payslips are not
stored**: their PDF is made each time someone downloads it (the `payslip-pdf` function).

The AWS keys live only in the `files` Edge Function's secrets, never in the portal or the app. The
function asks the database (with the signed-in person's own token) whether they may store or open a
file, puts uploads in S3 encrypted, and hands out links that work for five minutes. Files stored
before this step stay in Supabase Storage and still open; the website's job applications and
announcement pictures stay there too.

**a. Create the bucket.** AWS console → S3 → Create bucket:

| Setting | Value |
|---|---|
| Region | Asia Pacific (Singapore) `ap-southeast-1`, the closest to the Philippines |
| Bucket name | lowercase letters, digits and dashes, **no dots**, for example `bannuar-hr-files` (add a suffix if it is taken) |
| Object Ownership | ACLs disabled (bucket owner enforced) |
| Block all public access | **On** (all four boxes) |
| Bucket Versioning | Enable: an older copy is kept when a certificate's PDF is made again |
| Default encryption | SSE-S3 (Amazon S3 managed keys) |

No CORS rule is needed: browsers and phones only open the five-minute links. Optionally add a
lifecycle rule that expires objects under `healthcheck/` after 1 day (the storage check deletes its
test file, so there should be none).

**b. Create the key the function uses.** AWS console → IAM → Users → Create user, for example
`bannuar-files-function`, without console access. Add this inline policy (replace `BUCKET`). It can
store and read employee files but **cannot delete them**; only the storage check's own test files
can be deleted:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EmployeeFiles",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::BUCKET/employees/*"
    },
    {
      "Sid": "CompanyFiles",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::BUCKET/company/*"
    },
    {
      "Sid": "StorageCheck",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::BUCKET/healthcheck/*"
    }
  ]
}
```

Then the user → Security credentials → Create access key → "Application running outside AWS". Copy
the access key ID and the secret access key (the secret is shown once). Keep them out of chat,
email and the repository.

**c. Give them to the function** (Edge Functions → Secrets, or the CLI):

```bash
supabase secrets set --project-ref bcynizcgdgqznlxuzwjx AWS_ACCESS_KEY_ID=<access key id> AWS_SECRET_ACCESS_KEY=<secret access key> AWS_REGION=ap-southeast-1 S3_BUCKET=bannuar-hr-files
```

**d. Run the schema again** (step 2): it adds `stored_files` (one row per file in S3),
`document_types.storage_folder` (existing types are sorted once: the LESP to `lesp`, clearances,
medical results and training to `work-requirements`, the rest to `201-file`), the upload and read
checks, and points time in and out, renewals, leave attachments and certificates at S3 keys. Older
app versions keep working until they update.

**e. Deploy the two functions:**

```bash
supabase functions deploy files --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
supabase functions deploy payslip-pdf --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
```

`--no-verify-jwt` because both pass the person's own token to the database, which checks it and
refuses anything they may not do.

**f. Check it.** Sign in to the portal as the super admin → Settings → File storage → Check S3 now.
It stores a small test file, reads it back, makes sure the bucket refuses a public read, and deletes
it. "Connected" means uploads will work; otherwise it says which step failed and what AWS answered
(a wrong key, region or bucket name, or a missing permission).

To change the key later, create a second access key, set it with step c, then deactivate and delete
the old one in IAM. If your privacy notice lists where employee data is kept, add Amazon Web
Services (Singapore) to it.

## What is in the database

| Area | Tables |
|---|---|
| Organisation | `areas`, `clients`, `sites` (posts), `site_supervisors` (detachment commanders, inspectors) |
| 201 file | `employees`, `employee_compensation`, `employee_government_ids`, `employee_documents`, `document_types` |
| Payroll | `payroll_periods` (cutoffs), `payslips`, `payroll_concerns` |
| Requests | `leave_types`, `leave_credits`, `leave_requests`, `coe_requests`, `certificates`, `profile_change_requests` |
| Communication | `announcements`, `announcement_receipts`, `notifications`, `device_tokens` |
| App activation | `activation_tickets`, `activation_attempts` (service role only) |
| Attendance | `attendance_logs` (written only by `log_attendance`), the post's point and allowed distance on `sites` |
| Files in S3 | `stored_files` (one row per file the `files` function put in S3: whose folder, what for, its key), `document_types.storage_folder` |
| Website | `job_openings`, `job_applications`, `inquiries` |
| Access | `profiles`, `user_roles`, `staff_invitations`, `audit_log` |

Employee files go to Amazon S3 (step 9). The Supabase Storage buckets, all private, keep what was
stored before the switch (`employee-files`, `certificates`, `attendance-photos`), the website's job
applications (`applications`) and announcement pictures (`announcement-media`).

## Roles

| Role | Can |
|---|---|
| `super_admin` | Everything, including users, roles and staff password resets |
| `hr_admin` | All HR and payroll work, final leave approval, COE, deployment, audit log |
| `hr_staff` | 201 files, documents, leave and COE, recruitment, announcements |
| `payroll` | Cutoffs, payslip import and publishing, payroll concerns, pay rates |
| `operations` | Areas, clients, posts, commanders, deployment, announcements, proposal requests |
| `management` | Read-only: dashboard, employees, posts, announcements, requests (not payslips or government numbers) |
| `supervisor` | Detachment commanders and inspectors in the app: their posts' guards, leave endorsements |
| `employee` | Their own records in the app |

Rules the database enforces on its own, whatever screen is used:

- A guard sees only their own record; a detachment commander sees the guards of their posts.
- Payslips stay hidden until payroll publishes the cutoff; payslip notifications never show amounts.
- Government numbers are read through `get_government_ids()`, which writes every staff view to the
  audit log; the audit log keeps only their last three characters.
- Leave goes commander → HR; credits, overlaps and who may take which leave are checked on filing.
- A COE request is due three days after it is made (DOLE Labor Advisory 06-20).
- Website forms can only add records, never read them, and repeat submissions are limited.

## Payroll import file

One row per employee per cutoff. Column names (in any order; the portal maps common variants):

`employee_no` (required), `site_name`, `days_worked`, `hours_worked`, `overtime_hours`,
`night_diff_hours`, `basic_pay`, `overtime_pay`, `night_diff_pay`, `holiday_pay`, `allowances`,
`other_earnings`, `gross_pay`, `sss`, `philhealth`, `pagibig`, `withholding_tax`, `loans`,
`other_deductions`, `total_deductions`, `net_pay`, `remarks`.

Any extra column named `earning: <label>` or `deduction: <label>` (for example
`deduction: Cash advance`) becomes its own line on the payslip. Missing totals are computed; a net
pay that does not equal gross minus deductions is reported as a warning, not changed.

## 10. Discipline, document checks and Claude

The Discipline page keeps the company's Code of Discipline, incident reports and discipline cases.
Claude (Anthropic's Claude Opus 5.5) reads the uploaded code into offense rules for HR to approve,
and suggests the matching rule and a draft notice to explain for a case. It only proposes: HR
approves each rule, edits every notice and makes every decision, and the database enforces the
steps of due process (DOLE Department Order 147-15).

**a. Let the files function store the code.** The code's PDF goes to `company/code-of-discipline/`
in the bucket, not to an employee's folder. If your IAM policy was made before this step, add the
`CompanyFiles` statement shown in step 9b (`arn:aws:s3:::BUCKET/company/*`, put and get only).

**b. Give the function the Anthropic API key.** Use the organization's existing Claude API key, or
create one at console.anthropic.com → API keys. It goes only into the Edge Function secrets, never
into the portal, the app or the repository:

```bash
supabase secrets set --project-ref bcynizcgdgqznlxuzwjx ANTHROPIC_API_KEY=<the key>
```

**c. Run the schema again** (step 2): it adds `discipline_codes`, `offense_rules`,
`incident_reports` and `disciplinary_cases`, with the functions that run each step.

**d. Deploy the function:**

```bash
supabase functions deploy discipline-ai --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
supabase functions deploy document-ai --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
supabase functions deploy files --no-verify-jwt --use-api --project-ref bcynizcgdgqznlxuzwjx
```

(`files` again, so it can also open the code's PDF.)

**Document checks (`document-ai`).** When a guard chooses a photo of their LESP in the app, it is
sent at once and Claude reads it: the holder's name, the license number, the dates and how legible it
is. The function then compares the name with the 201 file and the expiry with today itself (the 201
name is not sent to Anthropic). The app fills in the number and dates, and says so when the license
has expired, expires within 60 days, or carries another name; HR sees the same reading beside the
document on the employee's page, and can have Claude read older uploads. Settings → Document types →
"Claude reads it" turns it on for other types (NBI clearance, drug test and so on). Claude cannot tell
whether a license is genuine: HR still verifies it, with the PNP SOSIA when in doubt. Each reading
costs roughly $0.01 to $0.03; a guard can have at most 10 read a day.

**e. Upload the code.** Discipline → Code of Discipline → Upload the code (PDF). Claude reads it
through Anthropic's Message Batches API, which has no time limit and costs half: most codes take a few
minutes. Check each rule against the PDF, approve or edit it, then "Put this code in force". Claude
also lists clauses your lawyer may want to look at against the Labor Code and DOLE rules.

What reaches Anthropic: the code's PDF; for a suggestion, the facts written on the case, the
incident report, the approved rules and the employee's earlier findings by rule; and for a document
check, the photo or PDF of the document itself (which shows the holder's name and number). Apart from what is printed on a document being checked, no names, employee
numbers, government numbers, pay or addresses are sent; the draft notice uses placeholders the portal
fills in. Anthropic does not train on API data by default. Mention Anthropic as a processor in the
privacy notice, and have the agency's lawyer review the code and the notice template once.

Cost, at Claude Opus 5.5's prices ($4 and $20 per million input and output tokens, half for the
reading batch): a 30-page code is roughly $0.10 to $0.40 to read; a case suggestion is roughly $0.05 to $0.15.
Requests that Claude Opus 5.5 declines are retried on Anthropic's recommended fallback model
(server-side fallbacks, a beta feature).

## 11. The client portal

Nothing to set up beyond running the schema again (step 2), which adds `client_users` and
`client_requests` and the functions clients use. Then:

1. Posts and clients → Clients → **Portal access** on the client: enter the person's name and email.
   The portal shows a code.
2. Give them the code and the portal's address. They open `/setup`, enter their email, the code and a
   password, the same way staff do.
3. On a tablet: open the portal in Safari or Chrome → Share (or the menu) → **Add to Home Screen**. It
   opens full screen like an app.

They see only their own posts, guards' names and positions, time in and out by day, and the reports
and requests their company filed. After each cutoff, payroll or operations presses "Ask the clients to
confirm" on the cutoff's page; each client then has two days to confirm its posts' duties or dispute
some, and a cutoff not answered in time counts as confirmed. Turn a login off from the same Portal access list.

## Tested

`schema.sql` was run against Postgres 16 with stand-ins for Supabase's `auth` and `storage`
schemas and its `anon` / `authenticated` / `authenticator` roles, connecting the way the Supabase
API does. 424 checks passed: sign-up rules, employee activation through one-time tickets (rate
limits per employee number and per IP, the facts removed from the login's metadata), who sees which
rows for every role, payroll import and publishing, the leave and COE flows, certificate
verification, announcements, website forms, storage folders, admin tools, push devices, attendance
(the location check for each case, the database's time, photos only from the guard's own fresh
upload, no direct writes, who sees which logs and photos), running the file again over existing
data, files in S3 (the folder and name each upload gets from the employee number and document type,
who may store or open which file, attaching only files that arrived, the 60-an-hour limit, payslips
never stored), attendance logged by a commander or entered by HR, the discipline steps (the code read
and approved before use, the five-day notice, the hearing before a dismissal, a reason for a penalty
other than the code's, preventive suspension of at most 30 days, what employees and Claude may see), the client portal
(client logins see only their own posts and what their company filed, and nothing once turned off),
the document checks (whose files Claude may read, which types), the cutoff review (how a time in and out
become a duty, what counts, payroll's decisions, the client's confirmation and its deadline),
and the demo scripts on an empty database. Upgrading a database built with the previous `schema.sql` was
tested too. It has not yet been run inside a real Supabase project.

The Edge Functions have their own tests (Deno, with a mocked admin client, a fake S3 and no
network): `deno task test` in `supabase/functions` (64 passed, including discipline-ai and document-ai against a fake Claude). The AWS request signing reproduces
the worked examples in Amazon's S3 documentation exactly.
