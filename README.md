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
5. Optional, for a demo: see **Demo data** below.

### Demo data

`supabase/seed-demo.sql` fills an empty project with one consistent demo year, every record marked
"Demo": a client with three posts, six employees, a year of time in and out (with a few absences
and exceptions), every cutoff of the year published but the latest, and payslips worked out exactly
as **Work out pay** does from that time in and out (the database tests check every figure). The
latest cutoff is a draft: an approved day of leave to pay, a duty logged away from the post for
payroll to decide, and the client's confirmation still open. The 13th month then reads from the
published cutoffs, with DEMO-0001 as Bannuar's example: ₱100 an hour January to March, ₱90 April to
October and ₱150 from November make ₱21,320. The demo year follows the date it is loaded, so load
it on the morning of a presentation. Paste into the SQL Editor, in this order:

1. `supabase/remove-demo.sql`, when an older demo is loaded (the seed asks for this when it finds one).
2. `supabase/seed-demo.sql` (it refuses once real employees exist).
3. `supabase/demo-employee-logins.sql`: app logins, password `password`, for DEMO-0001 (a detachment
   commander) and DEMO-0002 (a guard).
4. `supabase/demo-login.sql`: `bannuar@ibits.digital` (super admin, the HR portal) and
   `client@ibits.digital` (Demo Client Corporation, the client portal), password `password`.

**Before launch**, take the demo out: invite your own super admin from **Users and roles** and sign
in as them, then run `supabase/remove-demo.sql`. It deletes every demo record (people, time in and
out, cutoffs and payslips, the 13th month payout if one was made during the demo, leave, requests,
certificates, the client, its posts and rates), what trying the portal made from them (the demo
applicant if they were hired, cutoffs created since the demo was loaded that have no payslips), the
demo app and client logins, notifications about demo records, and the demo super admin, which it
keeps only while it is the only super admin (it says so; run it again after signing in as your
own). Real records are not touched. `seed-demo.sql` refuses a database with real records and names
what is in its way. Files uploaded
to the bucket during a demo stay there; delete them from the bucket if any were.

**Checked against the live project on 8 November 2026** (read-only): the schema is installed (open
posts, the certificate and invitation checks answer; the employees table refuses public reads; all
four storage buckets exist); the portal build signs in against the project (a made-up account is
refused as "The email or password is wrong") and checks invitation codes before any account is
made. No account or record was created.

## What each screen does

| Screen | For | What it does |
|---|---|---|
| Dashboard | all staff | What waits for a decision first (leave, certificates, detail changes, payroll concerns, applications, proposal requests), then the roll, today's time in and out (and how many need a look), floating guards near the six-month limit, expired documents, each post's guards against the number needed, and the roll by status. Jump to (Ctrl K, in the top bar on every screen) finds an employee, a post or a page |
| Employees | all staff (HR edits) | Search 4,000 records by name or number, filter by status and post, add employees. The 201 file: profile, deployment, licenses and documents (upload to the employee's S3 folder, verify what employees send from the app, with what Claude read on a LESP beside it: number, expiry, whether the name matches), government numbers (each view logged), pay rate, payslips, leave balances and history, certificates, app account (temporary passwords), assignment history (post, duty and shift, from when to when) |
| Posts and clients | all staff (operations edits) | Posts with guards needed against assigned, commanders, the duty pattern (8, 12 or 24 hours), deploying guards on a shift and setting them to floating; the post's pay rule and hourly rates (payroll); client records |
| Licenses and documents | all staff | Expired and expiring documents; field employees missing a document required for deployment |
| Requests | HR, payroll, operations | Leave (commander endorses with a reliever, HR approves), certificates of employment (three-day due date, overdue flag, issue as PDF), contact detail changes (apply or decline), payroll concerns (answer) |
| Attendance | all staff (HR adds by hand) | Time in and out from the app with the photo, the location check against the post and the server's time; filter by day, post, those needing a look, and those logged by the commander or by hand. A commander can log for a guard with no phone (the guard's photo, the commander's location, marked "By the commander"); HR can add a log by hand from the post's logbook, with the reason (no photo, marked "By hand", recorded in the audit log). The employee is told either way |
| Discipline | HR (operations: incident reports) | Incident reports from clients, commanders and staff (status, and an update the client reads); discipline cases that follow due process: the charge on an approved rule, a notice to explain with at least five calendar days to answer, the employee's explanation from the app or on paper, a hearing when asked for and always before a dismissal, a written decision (a penalty other than the code's needs a reason), preventive suspension up to 30 days. The Code of Discipline: upload the PDF, Claude Opus 5.5 reads it into offense rules with penalties by offense count and notes for counsel, HR approves each rule and puts the code in force. Claude can suggest the rule and draft the notice for a case; HR edits and decides ([SETUP step 10](supabase/SETUP.md)) |
| Client portal | people at a client company (invited by operations) | Made for a tablet at the client's desk (Add to Home Screen opens it full screen). Their posts with the guards assigned and who is on duty now; time in and out by day (who, when, at the post or not; no photos or locations); incident reports about a guard or a post, with Bannuar's status and update (never the case behind it); each cutoff's duties at their posts to confirm or dispute within two days (no answer counts as confirmed); requests for more guards, a replacement or a schedule change, answered by operations. Clients see nothing else: other clients' posts, pay, addresses and government numbers are closed to them. Staff invite and turn off client logins under Posts and clients → Clients → Portal access, and answer requests under Requests → Client requests |
| Announcements | publishers | Write for everyone, chosen areas or chosen posts; ask for acknowledgment; see how many read and acknowledged |
| Payroll | payroll | Cutoffs; work out pay from the cutoff's time in and out (the duties that count, approved paid leave) at each post's rate and its client's pay rule, deductions the rule has included (an attendance sheet to download, edit and upload; the schedule only as a labelled fallback), or import the payroll file (CSV, common column names recognised, `earning:` and `deduction:` lines kept); check totals; publish to employees, who are notified without the amount; download any payslip as a PDF, made on request and never stored; the 13th month from the basic pay of the year's published cutoffs, post by post, with the days no published cutoff covers yet projected and marked so (a timeline of each employee's year, or the list), and its payout cutoff |
| Recruitment | HR | Applications from the website (open the attached resume, notes, status, hire into an employee record); the open posts listed on the website |
| Proposal requests | all staff | Companies asking for guards through the website: call, email, status, notes |
| Users and roles | super admin | Staff accounts and roles, invitations with codes, temporary passwords |
| Audit log | HR admin, super admin | Who changed what, and who viewed whose government numbers |
| Settings | HR, operations, payroll | Areas, document types (expiry, reminders, what employees may upload, which S3 folder: 201 file, work requirements or LESP), leave types and credits; pay rules (formulas, night differential, duty days) and client rates (payroll edits) |
| Guide and questions | everyone (clients: the Help tab) | How to use the whole system, written for the people who use it: the tour video (from YouTube, loaded only when played, with its chapters), the four parts and who can do what, then step-by-step guides for the HR portal, payroll, the client portal, the employee app and the website, each on a real screen with numbered markers that light up with their step, a "Watch it" link to that moment of the video, a search, and questions with short answers. The client portal has a Help tab with the client's part only |

Notifications (top right) update live: new leave, certificate and detail requests, applications,
proposal requests.

### The guide

The words are in `src/guide/content.ts`: plain language, no technical terms (the end-to-end test
checks), **bold** for what reads on screen, and a picture's `pins` put step numbers on the screen.
The pictures in `public/guide/` are the showcase captures (demo records) cropped to each topic by
`showcase/guide/images.py`, which also writes where each marked button sits
(`src/guide/shots.json`). When a screen changes, capture it again and rebuild the pictures:

```bash
node showcase/capture/portal.mjs && node showcase/capture/app.mjs && python3 showcase/guide/images.py
```

The tour video is `VIDEO_ID` in `content.ts` (YouTube); each topic's "Watch it" time and the
chapters point into it, so update them together if the video is cut again.

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
- **Time in and out** (each cutoff's page): a time in and the time out after it (within 18 hours)
  make a duty, dated by the time in. A clean duty (both from the guard's own phone, at the post, no
  mock location) counts on its own. Payroll decides the rest: away from the post, GPS too rough, no
  location, a missing time in or out, logged by the commander or by hand, and any duty a client
  disputed. Taking a day out needs a reason and the guard is told. Logs never pay by themselves.
- **Clients confirm coverage** (once the cutoff has ended: "Ask the clients to confirm"): each
  client sees its posts' duties in the client portal (who, which day, from when to when, at the post
  or not; never pay) and confirms, or disputes the duties it says were not served, within two days.
  No answer in time counts as confirmed. Disputes join payroll's list; pay is never held for a client
  (Labor Code Art. 103).
- **Work out pay** (a draft cutoff → Work out pay): opens on the cutoff's time in and out: each
  assignment's row gets the duties that count (clean ones, and the exceptions payroll counted; an
  undecided exception is left out) and the approved paid leave in the cutoff, paid at the post's
  rate for the rule's regular hours. A duty at a post the guard has no assignment for is pointed
  out, not paid. Download the sheet to change any day and upload it, check the result and save the
  payslips. Each payslip keeps the basic pay its rule marks for the 13th month and the posts it was
  earned at. *Use the schedule instead* pays each assignment its scheduled duty days, and says so,
  for a cutoff whose time in and out is not in the system. Deduction lines in the rule (the demo's
  SSS, PhilHealth and Pag-IBIG) fill those columns; for tax and loans, download the result as a
  payroll file, add them and import it.
- **13th month** (Payroll → 13th month): a twelfth of the basic pay earned in the year (PD 851).
  *Released* is the basic pay on the year's published cutoffs, at the post it was earned at (from a
  payroll file without posts, shared among the guard's assignments by their days; a cutoff across
  the new year gives each year its own days). *Projected* covers the days no published cutoff
  covers yet: the rule's 13th month lines for the scheduled duty days at the rate in force (hourly
  rate × 8 hours × 26 days a month). The timeline draws released pay solid and projected days
  outlined. A day a guard missed was not paid, so it lowers the 13th month. *Create the payout
  cutoff* makes a 13th month cutoff with a line for each employee, to check and publish; the
  projected days are included unless payroll unticks them. Bannuar's example, in the demo data:
  DEMO-0001 at ₱100 an hour January to March (₱5,200), ₱90 April to October (₱10,920), both
  released, and ₱150 from November (₱5,200, projected until those cutoffs are published) gets
  ₱21,320.

**Not covered yet:** holiday and rest-day premiums, which need a holiday calendar (put them in the
payroll file for now), and withholding tax and loans (from the payroll file).

**Updating a project that already runs the portal:** paste `supabase/schema.sql` into the SQL
Editor again. It only adds; existing records stay, and every employee already at a post gets an open
assignment from their hiring date. Then give each post (or client) an hourly rate. On a demo
project, load the demo again as **Demo data** above describes (remove, seed, logins).

## Security, in short

- The browser holds only the public key. What each person may see and do is decided inside the
  database by row level security and role checks, whatever screen or tool sends the request.
- Staff sign up by invitation code only; roles are set by a super admin and checked in the database.
- Government numbers are read through a function that writes each view to the audit log. Payslips
  stay hidden from employees until payroll publishes the cutoff.
- Employee files are kept in a private Amazon S3 bucket, one folder per employee number
  (`employees/<number>/201-file`, `work-requirements`, `lesp`, `attendance`, `leave`, `certificates`).
  Only the `files` Edge Function holds the AWS keys, and its key can store and read files but not
  delete them; the database decides who may store or open each file, and links last five minutes.
  Payslips are never stored: the `payslip-pdf` function makes the PDF when someone downloads it.
- Temporary passwords force a new password at the next sign-in.
- For production: custom SMTP for the password-reset and confirmation emails, "Confirm email" on,
  and a Data Privacy Act registration with the NPC (4,000 employees is above its threshold).

## Tests

**Database** (`supabase/tests/run-tests.sh`, against Postgres 16 with stand-ins for Supabase's
`auth` and `storage` schemas, connecting the way the Supabase API does): sign-up, row level
security for every role, payroll import and publishing, the leave and COE flows, certificate
verification, announcements, website forms, storage folders, admin tools, pay rules, rates and
assignment history, time in and out, discipline, the client portal, the cutoff review (duties from
time in and out, payroll's decisions, the client's confirmation), paid leave in a cutoff, the 13th
month from released payroll (published cutoffs only, posts from the payslips or the assignments, a
cutoff across the new year split, the payout itself not counted, who may read it), and running
`schema.sql` twice and over existing data. Then, on a second empty database, the demo: the seed,
the logins (each twice), the client login seeing its posts and its open cutoff but no payslips,
**every published demo payslip checked figure for figure against the portal's own pay engine**
(`supabase/tests/seed-check.mjs`: the duties that count, paid leave, the 13th month), and
`remove-demo.sql` leaving nothing behind (a hired demo applicant and empty test cutoffs included), and the seed naming what is in its way on a database with real records. **450 passed.** The live project's upgrade was rehearsed
too: the previous `schema.sql` and demo, then the new `schema.sql` (the new seed then asks for
`remove-demo.sql` first), `remove-demo.sql`, `seed-demo.sql` and the logins; `seed-check.mjs`
passes on the result.

**Pay engine** (`npm run test:pay`): the formula language (precedence, percentages, functions,
mistakes explained), the night differential for 8, 12 and 24-hour duties under both rules, rates
by post and client, rate changes and separations, the attendance sheet, a cutoff's pay with paid
leave and deduction lines, and the 13th month from released payroll with the rest projected
(Bannuar's example, ₱21,320). **17 passed.**

**Certificate PDF text** (`npm run test:pdf`): the peso sign is written as PHP (the standard PDF
fonts have no ₱), Latin-1 letters such as ñ stay, anything else is replaced. **2 passed.**

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
history, the 13th month (the timeline first: released and projected bars at their dates with
their shares, the total at the right, the tooltip, the legend, How and Hide; then the list:
₱21,320 for the example, its breakdown, the payout cutoff with and without the projected days) and
working out a cutoff's pay (from the time in and out without asking, paid leave, a duty at a post
with no assignment pointed out, the payslip saved with its 13th month basic and posts, the
schedule as the labelled fallback, an edited sheet uploaded, night differential for the last
shift). Then the overhaul's parts: the dashboard (today's time in and out counted by the database,
each post's guards against the number needed, the roll by status), Jump to (Ctrl K) finding an
employee by name, the skip link and focus rings by keyboard, the menu's lamp following the page,
eight screens at 1440, 1024, 768 and 390 wide with no sideways scroll (screenshots in
`tests/shots/<width>/`), the sign-in duty clock (the time and duty in Manila, the lean towards the
pointer) on a laptop and a phone, and reduced motion (figures at once, the dial flat). Every one
of the database requests the portal made is then checked
against the real schema exported from Postgres (`tests/schema-snapshot.json`): tables, views,
columns, embedded relations (each must resolve to exactly one link, as PostgREST requires), filters,
functions and arguments. The test build is pointed at the
mock and every real Supabase and Amazon S3 host is cut, so the tests never touch the live project or
the bucket. The files in S3 are checked too: a document's scan goes to the files function and into
its type's folder, the record keeps the S3 key, a walk-in certificate's PDF lands in the employee's
certificates folder, an S3 selfie gets a five-minute link while an older one still opens from
Supabase Storage, the folder of each document type is changed in Settings, the File storage tab
counts files by folder and runs the live check, and a payslip downloads as a PDF made on request.
**260 passed, 0 console errors, and every request matches the schema.**

The look and its reasons (the watch room, the duty clock, where glass and glow are allowed, motion
and charts) are in [DESIGN.md](DESIGN.md).

**Not tested here:** signed-in work against the live project and the real S3 bucket (uploads,
realtime, emails): after the AWS set-up (SETUP.md step 9), run Settings → File storage → Check S3 now;
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
