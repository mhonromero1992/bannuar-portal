# Bannuar HR portal

The office side of Bannuar Security Agency, Inc.'s system: HR, payroll and operations staff manage
the 201 files of about 4,000 guards, their posts, licenses, payslips, leave, certificates of
employment, announcements, recruitment and proposal requests. React + Vite + TypeScript on one
Supabase project, the same database the public website
([bannuar-website](https://github.com/mhonromero1992/bannuar-website)) writes to and the employee app
(next phase) will read.

- **The database:** [`supabase/schema.sql`](supabase/schema.sql), one file to paste into the
  Supabase SQL Editor. Set-up steps: [`supabase/SETUP.md`](supabase/SETUP.md).
- **Design:** [DESIGN.md](DESIGN.md).

## Run it

```bash
npm install
npm run dev               # http://localhost:5173
npm run build             # static files in dist/
```

The portal is connected to Bannuar's Supabase project, the same one the website uses:
`https://bcynizcgdgqznlxuzwjx.supabase.co` with its publishable key, both set in
`src/lib/supabase.ts`. They are public by design: the browser holds them, and row level security in
the database decides what each signed-in person may see and do. Never put the secret (service role)
key anywhere in this project.

To point a build at another project (a staging copy, for example), set these in `.env` or in the
host's environment variables and rebuild:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) | Project Settings → API → Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | the publishable key (a legacy `anon` key works too) |
| `VITE_WEBSITE_URL` | the public website, printed on certificates as the place to check them (default `https://bannuar-website.vercel.app`) |

Deploy `dist/` to Vercel or Netlify. `vercel.json` and `public/_redirects` send every path to
`index.html` so links like `/employees/…` open directly; `vercel.json` also adds security headers.

## First sign-in

The project's sign-in settings, as read on 8 November 2026: email sign-in on, sign-ups allowed
(the database itself refuses anyone without an invitation code), **"Confirm email" on**.

1. In Supabase → Authentication → URL Configuration, set **Site URL** to the portal's address and
   add `<portal address>/sign-in` and `<portal address>/reset-password` to **Redirect URLs** (and
   the `http://localhost:5173/...` versions for local work). Confirmation and password-reset links
   open those pages.
2. In the SQL Editor: `select public.bootstrap_super_admin('you@company.ph', 'Your Name');` It
   answers with a code.
3. Open the portal → **Set up your account** → that email, the code, a password. Because "Confirm
   email" is on, Supabase then emails a confirmation link; open it, then sign in.
   Supabase's built-in mailer only reaches the project's own team members and a few messages an
   hour. Until Bannuar's SMTP is set (Authentication → Emails → SMTP Settings), either use an email
   that is a member of the Supabase project, or confirm the account in the SQL Editor:
   `update auth.users set email_confirmed_at = now() where email = 'you@company.ph';`
4. Invite everyone else from **Users and roles**. Each invitation shows a code to pass on in person;
   nobody can sign up without one. The same confirmation step applies to them.
5. Optional: `supabase/seed-demo.sql` fills an empty project with clearly marked demo records to
   try every screen; `supabase/remove-demo.sql` takes them out.
   For showing the portal, `supabase/demo-login.sql` makes a demo super admin
   (`bannuar@ibits.digital`, password `password`, already confirmed). Delete it before real records
   go in: `delete from auth.users where email = 'bannuar@ibits.digital';`
   For the employee app, `supabase/demo-employee-logins.sql` (after the demo data) gives two demo
   employees an app login, password `password`: DEMO-0001, a detachment commander, and DEMO-0002, a
   guard. `remove-demo.sql` deletes them with the demo data.

**Checked against the live project on 8 November 2026** (read-only): the schema is installed (open
posts, the certificate and invitation checks answer; the employees table refuses public reads; all
four storage buckets exist); the portal build signs in against the project (a made-up account is
refused as "The email or password is wrong") and checks invitation codes before any account is
made. No account or record was created.

## What each screen does

| Screen | For | What it does |
|---|---|---|
| Dashboard | all staff | Headcount, post coverage, floating guards near the six-month limit, expired documents, everything waiting for a decision |
| Employees | all staff (HR edits) | Search 4,000 records by name or number, filter by status and post, add employees. The 201 file: profile, deployment, licenses and documents (upload, verify what employees send from the app), government numbers (each view logged), pay rate, payslips, leave balances and history, certificates, app account (temporary passwords) |
| Posts and clients | all staff (operations edits) | Posts with guards needed against assigned, commanders, deploying guards and setting them to floating; client records |
| Licenses and documents | all staff | Expired and expiring documents; field employees missing a document required for deployment |
| Requests | HR, payroll, operations | Leave (commander endorses with a reliever, HR approves), certificates of employment (three-day due date, overdue flag, issue as PDF), contact detail changes (apply or decline), payroll concerns (answer) |
| Announcements | publishers | Write for everyone, chosen areas or chosen posts; ask for acknowledgment; see how many read and acknowledged |
| Payroll | payroll | Cutoffs; import the payroll file (CSV, common column names recognised, `earning:` and `deduction:` lines kept); check totals; publish to employees, who are notified without the amount |
| Recruitment | HR | Applications from the website (open the attached resume, notes, status, hire into an employee record); the open posts listed on the website |
| Proposal requests | all staff | Companies asking for guards through the website: call, email, status, notes |
| Users and roles | super admin | Staff accounts and roles, invitations with codes, temporary passwords |
| Audit log | HR admin, super admin | Who changed what, and who viewed whose government numbers |
| Settings | HR, operations | Areas, document types (expiry, reminders, what employees may upload), leave types and credits |

Notifications (top right) update live: new leave, certificate and detail requests, applications,
proposal requests.

### Certificates of employment

Issuing a certificate (from a request, or for a walk-in on the employee's page) records it in the
database with a certificate number and a 12-character verification code, makes a PDF with Bannuar's
badge, the signatory, the code and a QR code to the website's check page, stores the PDF for the
employee's app, and downloads a copy. Anyone holding the paper can check the code on the website,
which shows whether it is genuine or withdrawn. A withdrawn certificate says so there at once.

## Security, in short

- The browser holds only the public key. What each person may see and do is decided inside the
  database by row level security and role checks, whatever screen or tool sends the request.
- Staff sign up by invitation code only; roles are set by a super admin and checked in the database.
- Government numbers are read through a function that writes each view to the audit log. Payslips
  stay hidden from employees until payroll publishes the cutoff.
- Temporary passwords force a new password at the next sign-in.
- For production: custom SMTP for the password-reset and confirmation emails, "Confirm email" on,
  and a Data Privacy Act registration with the NPC (4,000 employees is above its threshold).

## Tests

**Database** (`supabase/tests/run-tests.sh`, against Postgres 16 with stand-ins for Supabase's
`auth` and `storage` schemas, connecting the way the Supabase API does): 112 checks of sign-up,
row level security for every role, payroll import and publishing, the leave and COE flows,
certificate verification, announcements, website forms, storage folders and admin tools, plus
running `schema.sql` twice and over existing data. **112 passed.**

**Portal** (`npm run test:e2e`): builds the portal, serves it, and drives it in Chromium against a
mocked Supabase API: sign-in (wrong and right password, return to the page asked for), all 17
screens with no sideways scroll, adding an employee (validation, the row sent), government numbers
through the logged function, verifying a document, issuing a walk-in COE (a real PDF is made,
stored and its path recorded) and a requested COE with compensation, approving leave, applying a
detail change, answering a payroll concern, importing a payroll CSV with differently named columns
and a bad row, publishing a cutoff, publishing an announcement to a post, hiring an applicant,
inviting staff, deploying a floating guard, setting up an account with an invitation code, the
phone menu and sign-out. Every one of the database requests the portal made is then checked
against the real schema exported from Postgres (`tests/schema-snapshot.json`): tables, views,
columns, embedded relations (each must resolve to exactly one link, as PostgREST requires), filters,
functions and arguments. The test build is pointed at the
mock and every real Supabase host is cut, so the tests never touch the live project. **72 passed,
0 console errors.**

**Not tested here:** signed-in work against the live project (storage uploads, realtime, emails):
after the first admin signs in, click through each screen once before rollout. Running PostgREST
locally for a fully live test was not possible on the build machine.

## Next phase: the employee app

The database already holds what the React Native app needs: employee activation by employee
number, birthday and mobile (`check_employee_activation`; an Edge Function will create the login),
payslips, leave filing and balances, COE requests and downloads, announcements with
acknowledgment, contact detail changes, payroll concerns, document renewals from the phone,
notifications and device tokens for push.
