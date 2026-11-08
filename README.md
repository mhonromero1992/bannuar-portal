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
cp .env.example .env      # fill in the Supabase URL and anon key
npm run dev               # http://localhost:5173
npm run build             # static files in dist/
```

Deploy `dist/` to Vercel or Netlify. `vercel.json` and `public/_redirects` send every path to
`index.html` so links like `/employees/…` open directly; `vercel.json` also adds security headers.
Add the portal's address to Supabase → Authentication → URL Configuration (Site URL and
`/reset-password` redirect) as SETUP.md says.

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | the `anon` public key (or the publishable key); never the service role key |
| `VITE_WEBSITE_URL` | the public website, printed on certificates as the place to check them |

Without the first two the portal opens on a page with these steps instead of a broken sign-in.

## First sign-in

1. Run `schema.sql`, then in the SQL Editor:
   `select public.bootstrap_super_admin('you@company.ph', 'Your Name');` It answers with a code.
2. Open the portal → **Set up your account** → your email, the code, a password.
3. Invite everyone else from **Users and roles**. Each invitation shows a code to pass on in person;
   nobody can sign up without one.
4. Optional: `supabase/seed-demo.sql` fills a new project with clearly marked demo records to try
   every screen; `supabase/remove-demo.sql` takes them out.

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
columns, embedded relations, filters, functions and arguments. **71 passed, 0 console errors.**

**Not tested here:** a live Supabase project (sign-in emails, storage, realtime): connect one and
click through once before rollout. Running PostgREST locally for a fully live test was not possible
on the build machine.

## Next phase: the employee app

The database already holds what the React Native app needs: employee activation by employee
number, birthday and mobile (`check_employee_activation`; an Edge Function will create the login),
payslips, leave filing and balances, COE requests and downloads, announcements with
acknowledgment, contact detail changes, payroll concerns, document renewals from the phone,
notifications and device tokens for push.
