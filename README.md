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
| Employees | all staff (HR edits) | Search 4,000 records by name or number, filter by status and post, add employees. The 201 file: profile, deployment, licenses and documents (upload, verify what employees send from the app), government numbers (each view logged), pay rate, payslips, leave balances and history, certificates, app account (temporary passwords), assignment history (post, duty and shift, from when to when) |
| Posts and clients | all staff (operations edits) | Posts with guards needed against assigned, commanders, the duty pattern (8, 12 or 24 hours), deploying guards on a shift and setting them to floating; the post's pay rule and hourly rates (payroll); client records |
| Licenses and documents | all staff | Expired and expiring documents; field employees missing a document required for deployment |
| Requests | HR, payroll, operations | Leave (commander endorses with a reliever, HR approves), certificates of employment (three-day due date, overdue flag, issue as PDF), contact detail changes (apply or decline), payroll concerns (answer) |
| Announcements | publishers | Write for everyone, chosen areas or chosen posts; ask for acknowledgment; see how many read and acknowledged |
| Payroll | payroll | Cutoffs; work out pay from the assignments, rates and client pay rules (attendance sheet to download, edit and upload) or import the payroll file (CSV, common column names recognised, `earning:` and `deduction:` lines kept); check totals; publish to employees, who are notified without the amount; the 13th month, pro-rated by post and rate, and its payout cutoff |
| Recruitment | HR | Applications from the website (open the attached resume, notes, status, hire into an employee record); the open posts listed on the website |
| Proposal requests | all staff | Companies asking for guards through the website: call, email, status, notes |
| Users and roles | super admin | Staff accounts and roles, invitations with codes, temporary passwords |
| Audit log | HR admin, super admin | Who changed what, and who viewed whose government numbers |
| Settings | HR, operations, payroll | Areas, document types (expiry, reminders, what employees may upload), leave types and credits; pay rules (formulas, night differential, duty days) and client rates (payroll edits) |

Notifications (top right) update live: new leave, certificate and detail requests, applications,
proposal requests.

### Certificates of employment

Issuing a certificate (from a request, or for a walk-in on the employee's page) records it in the
database with a certificate number and a 12-character verification code, makes a PDF with Bannuar's
badge, the signatory, the code and a QR code to the website's check page, stores the PDF for the
employee's app, and downloads a copy. Anyone holding the paper can check the code on the website,
which shows whether it is genuine or withdrawn. A withdrawn certificate says so there at once.

### Pay rules, rates and the 13th month

Each client pays its guards its own way, and each post has its own rate.

- **Pay rules** (Settings → Pay rules and rates; payroll edits, HR reads). A client's default rule
  covers all its posts; a post can pick another rule of its client; posts of clients without a rule
  use the agency's **Standard** rule (overtime at 125%, night differential at 10%). A rule has the
  regular hours a duty (8), the duty days a month (26), who earns night differential, and formula
  lines.
- **Formula lines** are worked out for a guard's duty at one post, top to bottom, to the centavo:
  `rate * regular_hours`, `rate * 125% * overtime_hours`, `rate * 10% * night_hours`,
  `days * 25`. Names: `rate`, `daily_rate`, `days`, `duty_length`, `duty_hours`, `regular_hours`,
  `overtime_hours`, `night_hours`, and the codes of the lines above. Functions: `min`, `max`,
  `round(x, 2)`, `floor`, `ceil`, `abs`, `if(condition, then, else)`. A typo is caught while
  typing, and the editor shows an example (₱100 an hour, 13 duties of 12 hours from 6 PM). Lines
  coded `basic`, `overtime`, `night_diff`, `holiday` and `allowances` fill those payslip columns;
  others appear under their own name. Lines marked "13th month" are the basic pay it counts.
- **Night differential.** *Last shift of the day* (the default, as Bannuar described it): every
  24-hour duty, the 12-hour shift from 6 PM and the 8-hour shift from 10 PM (the shift that covers
  most of 10 PM to 6 AM) earn the rule's hours, 8, a duty; day shifts earn none. *Every hour from
  10 PM to 6 AM* counts the hours actually worked then, as the Labor Code (Art. 86) does. Use it
  where shifts do not line up with 10 PM to 6 AM: a 3 PM to 11 PM guard is owed 1 hour by law.
- **Rates** (the post's page; payroll edits): hourly rates from a date, so a new rate keeps the old
  one for the months before it. A post without its own rate uses its client's rate (Settings).
- **Assignment history** (the employee's Deployment tab): every deployment records the post, the
  duty (8, 12 or 24 hours) and the shift. HR and operations can add or correct past stretches.
- **Work out pay** (a draft cutoff → Work out pay): the attendance sheet is filled from the
  assignments with each rule's duty days. Download it, change the days to the days worked, upload
  it, check the result and save the payslips, or download them as a payroll file to add SSS,
  PhilHealth, Pag-IBIG, tax and loans and import it.
- **13th month** (Payroll → 13th month): for each stretch of the year a guard held a post at one
  rate, basic pay is the rule's 13th month lines for the duty days (hourly rate × 8 hours × 26 days ×
  months), and the 13th month is a twelfth of it; the stretches are added up. Bannuar's example,
  in the demo data: DEMO-0001 at ₱100 an hour January to March (₱5,200), ₱90 April to October
  (₱10,920) and ₱150 November to December (₱5,200) gets ₱21,320. *Create the payout cutoff*
  makes a cutoff with a 13th month line for each employee, to check and publish.

**Not covered yet:** holiday and rest-day premiums, which need a holiday calendar and day-by-day
attendance (put them in the payroll file for now), and statutory deductions (from the payroll file).

**Updating a project that already runs the portal:** paste `supabase/schema.sql` into the SQL
Editor again. It only adds; existing records stay, and every employee already at a post gets an open
assignment from their hiring date. Then give each post (or client) an hourly rate. On a demo
project, run `supabase/seed-demo.sql` again to add the demo rule, rates and DEMO-0001's year.

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
`auth` and `storage` schemas, connecting the way the Supabase API does): 136 checks of sign-up,
row level security for every role, payroll import and publishing, the leave and COE flows,
certificate verification, announcements, website forms, storage folders, admin tools, pay rules
(formula line checks, one default a client, who may read and set rules and rates), assignment
history (written by deployments, no overlaps, who sees whose) and running `schema.sql` twice and
over existing data. **136 passed.** The upgrade was also rehearsed: the previous schema and demo
data first, then the new `schema.sql` and `seed-demo.sql` on top, and `remove-demo.sql` after.

**Pay engine** (`npm run test:pay`): the formula language (precedence, percentages, functions,
mistakes explained), the night differential for 8, 12 and 24-hour duties under both rules, rates
by post and client, rate changes and separations, Bannuar's 13th month example (₱21,320), the
attendance sheet and a cutoff's pay. **13 passed.**

**Portal** (`npm run test:e2e`): builds the portal, serves it, and drives it in Chromium against a
mocked Supabase API: sign-in (wrong and right password, return to the page asked for), all 18
screens with no sideways scroll, adding an employee (validation, the row sent), government numbers
through the logged function, verifying a document, issuing a walk-in COE (a real PDF is made,
stored and its path recorded) and a requested COE with compensation, approving leave, applying a
detail change, answering a payroll concern, importing a payroll CSV with differently named columns
and a bad row, publishing a cutoff, publishing an announcement to a post, hiring an applicant,
inviting staff, deploying a floating guard, setting up an account with an invitation code, the
phone menu and sign-out; and the pay features: editing a client's pay rule (the example's night
differential, a typo caught and refused, a line added), a post's rate and rule, the assignment
history, the 13th month (₱21,320 for the example, its breakdown, the payout cutoff) and working out
a cutoff's pay (the attendance sheet from the assignments, an edited sheet uploaded, night
differential for the last shift). Every one of the database requests the portal made is then checked
against the real schema exported from Postgres (`tests/schema-snapshot.json`): tables, views,
columns, embedded relations (each must resolve to exactly one link, as PostgREST requires), filters,
functions and arguments. The test build is pointed at the
mock and every real Supabase host is cut, so the tests never touch the live project. **90 passed,
0 console errors, and every request matches the schema.**

**Not tested here:** signed-in work against the live project (storage uploads, realtime, emails):
after the first admin signs in, click through each screen once before rollout. Running PostgREST
locally for a fully live test was not possible on the build machine.

## The employee app

[bannuar-app](https://github.com/mhonromero1992/bannuar-app) (React Native) reads and writes this
database for the guards: activation and sign-in with the employee number, payslips, leave,
certificates of employment, announcements with acknowledgment, the 201 file and document renewals,
detail changes, payroll concerns, notifications and push, the commander's leave endorsements, and
time in and out with a photo and a location check against the post (reviewed here under
Attendance).
Its two Edge Functions live here in [`supabase/functions`](supabase/functions/README.md); set-up
steps in [`supabase/SETUP.md`](supabase/SETUP.md), step 8.

Employee activation: the `activate-employee` function checks the employee number, birthdate and
mobile number with limits per employee number and per IP, then creates the login; the database
accepts it only with the one-time ticket the check issued, so knowing the three facts is not enough
to claim a record through the public sign-up.
