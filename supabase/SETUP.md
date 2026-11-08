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

## What is in the database

| Area | Tables |
|---|---|
| Organisation | `areas`, `clients`, `sites` (posts), `site_supervisors` (detachment commanders, inspectors) |
| 201 file | `employees`, `employee_compensation`, `employee_government_ids`, `employee_documents`, `document_types` |
| Payroll | `payroll_periods` (cutoffs), `payslips`, `payroll_concerns` |
| Requests | `leave_types`, `leave_credits`, `leave_requests`, `coe_requests`, `certificates`, `profile_change_requests` |
| Communication | `announcements`, `announcement_receipts`, `notifications`, `device_tokens` |
| Website | `job_openings`, `job_applications`, `inquiries` |
| Access | `profiles`, `user_roles`, `staff_invitations`, `audit_log` |

Storage buckets, all private: `employee-files`, `certificates`, `applications`, `announcement-media`.

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

## Tested

`schema.sql` was run against Postgres 16 with stand-ins for Supabase's `auth` and `storage`
schemas and its `anon` / `authenticated` / `authenticator` roles, connecting the way the Supabase
API does. 112 checks passed: sign-up rules, who sees which rows for every role, payroll import and
publishing, the leave and COE flows, certificate verification, announcements, website forms,
storage folders, admin tools, and running the file twice and over existing data. It has not yet
been run inside a real Supabase project.
