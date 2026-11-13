-- =====================================================================================
-- BANNUAR SECURITY AGENCY, INC. · ONE DATABASE FOR THE WEBSITE, HR PORTAL AND APP
-- Supabase (Postgres 15+)
--
-- HOW TO RUN
--   1. Use a NEW Supabase project made for Bannuar (region: Southeast Asia, Singapore).
--      Do not run this in a project that already holds another app's tables.
--   2. Dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   3. Then follow supabase/SETUP.md (auth settings and the first admin).
--
-- The file is safe to run again after an update: every statement checks first.
--
-- WHO USES WHAT
--   anon (website visitors)  read open job openings, send applications and proposal
--                            requests, check a certificate code
--   authenticated            staff in the portal (by role) and employees in the app
--                            (their own records only); row level security on every table
--   service role             the Edge Functions in supabase/functions: employee activation
--                            (activate-employee) and push notifications (send-push)
-- =====================================================================================

set client_min_messages = warning;
create extension if not exists pgcrypto with schema extensions;

-- -------------------------------------------------------------------------------------
-- 0. Safety check: refuse to mix with another app's tables of the same name
-- -------------------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('employees', 'employee_no'), ('profiles', 'must_change_password'),
      ('notifications', 'link'), ('announcements', 'requires_ack'),
      ('sites', 'guards_required'), ('clients', 'contract_end'),
      ('payslips', 'payroll_period_id'), ('audit_log', 'record_id')
    ) as x(tbl, col)
  loop
    if to_regclass('public.' || t.tbl) is not null and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t.tbl and column_name = t.col
    ) then
      raise exception 'public.% already exists and belongs to another app. Run this script in a new Supabase project made for Bannuar.', t.tbl;
    end if;
  end loop;
end $$;

-- -------------------------------------------------------------------------------------
-- 1. Types and small helpers
-- -------------------------------------------------------------------------------------
do $$ begin
  create type public.app_role as enum (
    'super_admin',  -- everything, including users and roles
    'hr_admin',     -- HR head: all HR, payroll and approvals
    'hr_staff',     -- 201 files, documents, requests, recruitment, announcements
    'payroll',      -- payroll periods, payslips, payroll concerns
    'operations',   -- posts, clients, deployment, announcements
    'management',   -- read-only dashboards and lists
    'supervisor',   -- detachment commander or inspector (field, in the app)
    'employee'      -- every guard and staff member with an app login
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Last ten digits of a Philippine mobile number: 0917 123 4567, +63 917 123 4567 -> 9171234567
create or replace function public.normalize_ph_mobile(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null else right(regexp_replace(p, '\D', '', 'g'), 10) end
$$;

-- Random codes without look-alike characters (no 0/O, 1/I)
create or replace function public.random_code(p_length int) returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(p_length);
  result text := '';
  i int;
begin
  for i in 0 .. p_length - 1 loop
    result := result || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

-- -------------------------------------------------------------------------------------
-- 2. Tables
-- -------------------------------------------------------------------------------------

-- Areas: regional offices or groupings of posts
create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  region text,
  office_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Clients: the companies and offices Bannuar guards
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  contact_person text,
  contact_email text,
  contact_phone text,
  address text,
  contract_start date,
  contract_end date,
  status text not null default 'active' check (status in ('prospect', 'active', 'ended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pay rules: how a client's guards are paid. A post uses its own rule, else its client's default
-- rule, else the agency-wide default ("Standard"). Each formula line is an earning or deduction the
-- portal's pay engine (src/lib/pay.ts) works out from a guard's hours at the post:
--   {"code": "night_diff", "label": "Night differential", "formula": "rate * 10% * night_hours",
--    "kind": "earning", "thirteenth": false}
-- Lines marked "thirteenth" are basic pay and count toward the 13th month.
create table if not exists public.pay_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  is_default boolean not null default false,
  regular_hours numeric(4, 2) not null default 8 check (regular_hours > 0 and regular_hours <= 24),
  -- who earns night differential: the shift covering the night (last_shift: 24-hour duties, the
  -- 12-hour shift from 6pm, the 8-hour shift from 10pm, paid night_diff_hours a duty), every hour
  -- worked from 10pm to 6am (night_hours, as the Labor Code counts it), or nobody (none)
  night_diff text not null default 'last_shift' check (night_diff in ('last_shift', 'night_hours', 'none')),
  night_diff_hours numeric(4, 2) not null default 8 check (night_diff_hours >= 0 and night_diff_hours <= 8),
  -- paid duty days in a month: fills the attendance sheet and works out the 13th month
  days_per_month numeric(5, 2) not null default 26 check (days_per_month > 0 and days_per_month <= 31),
  formulas jsonb not null default '[]'::jsonb check (jsonb_typeof(formulas) = 'array' and jsonb_array_length(formulas) <= 20),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pay_rules_one_default
  on public.pay_rules (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)) where is_default;

-- Sites: posts / detachments at a client
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  area_id uuid references public.areas (id) on delete set null,
  name text not null,
  code text unique,
  address text,
  city text,
  province text,
  region text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  geofence_radius_m integer not null default 150 check (geofence_radius_m between 20 and 5000),
  guards_required integer not null default 0 check (guards_required >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A post's pay rule and duty pattern: 8, 12 or 24-hour duties, the first shift starting at
-- first_shift_start (06:00 gives 6am to 6pm and 6pm to 6am for 12-hour duties)
alter table public.sites
  add column if not exists pay_rule_id uuid references public.pay_rules (id) on delete set null,
  add column if not exists duty_hours integer not null default 12 check (duty_hours in (8, 12, 24)),
  add column if not exists first_shift_start time not null default '06:00';

-- A post's location for time in and out: both numbers or neither, and a real point on the map
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sites_location_check' and conrelid = 'public.sites'::regclass) then
    alter table public.sites add constraint sites_location_check check (
      (latitude is null) = (longitude is null)
      and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))) not valid;
  end if;
end $$;

-- Hourly rates: a post's own rate, or its client's rate for posts without one. Each rate applies from
-- its date until the next one, so a change mid-year keeps the old rate for the months before it.
create table if not exists public.pay_rates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  site_id uuid references public.sites (id) on delete cascade,
  effective_from date not null,
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0 and hourly_rate < 100000),
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(client_id, site_id) = 1)
);
create unique index if not exists pay_rates_site_from on public.pay_rates (site_id, effective_from) where site_id is not null;
create unique index if not exists pay_rates_client_from on public.pay_rates (client_id, effective_from) where client_id is not null;

-- Employees: the 201 file (guards and office staff)
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  employee_no text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  birthdate date,
  sex text check (sex in ('male', 'female')),
  civil_status text check (civil_status in ('single', 'married', 'widowed', 'separated', 'annulled')),
  mobile_no text,
  email text,
  present_address text,
  provincial_address text,
  position text not null default 'Security Guard',
  is_field boolean not null default true,  -- guards, commanders, inspectors; office staff are false
  employment_type text not null default 'probationary'
    check (employment_type in ('probationary', 'regular', 'contractual', 'project')),
  status text not null default 'active'
    check (status in ('active', 'floating', 'on_leave', 'suspended', 'awol', 'resigned', 'terminated', 'end_of_contract', 'retired')),
  date_hired date,
  date_regularized date,
  date_separated date,
  separation_reason text,
  area_id uuid references public.areas (id) on delete set null,
  site_id uuid references public.sites (id) on delete set null,
  floating_since date,
  photo_path text,
  emergency_contact_name text,
  emergency_contact_relation text,
  emergency_contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- columns added after the first release (kept so older databases catch up when this file is re-run)
alter table public.employees add column if not exists is_field boolean not null default true;
create index if not exists employees_site_idx on public.employees (site_id);
create index if not exists employees_area_idx on public.employees (area_id);
create index if not exists employees_status_idx on public.employees (status);
create index if not exists employees_last_name_idx on public.employees (lower(last_name));

-- Assignment history: which post a guard held, from when to when, and on which duty. Deployments
-- write it (trigger on employees); HR and operations can correct it. An open assignment has no
-- end date. Pay for a cutoff and the 13th month are worked out from it.
create table if not exists public.employee_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  site_id uuid not null references public.sites (id) on delete restrict,
  start_date date not null,
  end_date date,
  duty_hours integer not null default 12 check (duty_hours in (8, 12, 24)),
  shift_start time not null default '06:00',
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists employee_assignments_employee_idx on public.employee_assignments (employee_id, start_date);
create index if not exists employee_assignments_site_idx on public.employee_assignments (site_id);

-- Pay rates (payroll and HR only, plus the employee)
create table if not exists public.employee_compensation (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  pay_basis text not null default 'daily' check (pay_basis in ('daily', 'monthly')),
  daily_rate numeric(12, 2),
  monthly_rate numeric(12, 2),
  allowance_note text,
  effective_on date,
  updated_at timestamptz not null default now()
);

-- Government numbers: read by staff only through get_government_ids(), which logs each view
create table if not exists public.employee_government_ids (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  sss_no text,
  philhealth_no text,
  pagibig_no text,
  tin text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Every login has a profile
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  must_change_password boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
create index if not exists user_roles_role_idx on public.user_roles (role);

-- Staff sign up by invitation only: the admin gives the person a one-time code
create table if not exists public.staff_invitations (
  email text primary key check (email = lower(email)),
  full_name text not null,
  roles public.app_role[] not null default '{}',
  code text not null,
  employee_id uuid references public.employees (id) on delete set null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null
);

-- Client portal (section 17): people at a client company sign in with an invitation tied to the client,
-- and see their own posts, the guards on duty, attendance by day, and the reports and requests they file
alter table public.staff_invitations add column if not exists client_id uuid references public.clients (id) on delete cascade;
create table if not exists public.client_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  full_name text not null,
  email text not null,
  invited_by uuid references auth.users (id) on delete set null,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_users_client_idx on public.client_users (client_id);

create sequence if not exists public.client_request_no_seq;
create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique,
  client_id uuid not null references public.clients (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,
  kind text not null check (kind in ('additional_guards', 'replace_guard', 'schedule_change', 'other')),
  details text not null check (length(trim(details)) between 10 and 3000),
  guards_needed integer check (guards_needed between 1 and 50),
  needed_from date,
  status text not null default 'received' check (status in ('received', 'in_progress', 'done', 'declined')),
  reply text check (length(reply) <= 1000),
  requested_by uuid references auth.users (id) on delete set null,
  requester_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_requests_client_idx on public.client_requests (client_id, created_at desc);

-- Employee app activation. The activate-employee Edge Function checks the employee number,
-- birthdate and mobile number (begin_employee_activation), which writes a one-time ticket here;
-- handle_new_user accepts an employee login only with that ticket. Only the hash is stored.
-- Neither table has a policy: only the service role (Edge Functions) and the SQL editor reach them.
create table if not exists public.activation_tickets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  token_hash text not null unique,
  ip text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);
create index if not exists activation_tickets_employee_idx on public.activation_tickets (employee_id);

-- Every activation attempt, for the rate limits (per employee number and per IP). Kept 30 days.
create table if not exists public.activation_attempts (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  employee_no text not null,
  ip text,
  result text not null check (result in ('ok', 'no_match', 'already_active', 'rate_limited', 'activated'))
);
create index if not exists activation_attempts_no_idx on public.activation_attempts (employee_no, occurred_at desc);
create index if not exists activation_attempts_ip_idx on public.activation_attempts (ip, occurred_at desc) where ip is not null;

-- Detachment commanders and inspectors of each post
create table if not exists public.site_supervisors (
  site_id uuid not null references public.sites (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  role text not null default 'detachment_commander'
    check (role in ('detachment_commander', 'inspector', 'officer_in_charge')),
  created_at timestamptz not null default now(),
  primary key (site_id, employee_id)
);
create index if not exists site_supervisors_employee_idx on public.site_supervisors (employee_id);

-- Licenses, clearances, medical results, contracts, BIR 2316 and other files
create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category text not null default 'other'
    check (category in ('license', 'clearance', 'medical', 'training', 'contract', 'government', 'payroll', 'personal', 'other')),
  has_expiry boolean not null default false,
  required_for_deployment boolean not null default false,
  remind_days_before integer not null default 30 check (remind_days_before between 0 and 365),
  visible_to_employee boolean not null default true,
  employee_can_upload boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The S3 folder a document type's files go to: employees/<employee number>/<storage_folder>/...
--   201-file           personal records: birth certificate, IDs, diploma, contract, BIR 2316
--   work-requirements  clearances, drug test, neuro-psychiatric and medical results, training
--   lesp               the License to Exercise Security Profession
-- Types that existed before the column are sorted once, here; HR changes it in Settings afterwards.
alter table public.document_types add column if not exists storage_folder text;
update public.document_types set storage_folder = case
    when code = 'SECURITY_LICENSE' or name ilike '%lesp%' then 'lesp'
    when category in ('clearance', 'medical', 'training') then 'work-requirements'
    else '201-file' end
  where storage_folder is null;
alter table public.document_types alter column storage_folder set default '201-file';
alter table public.document_types alter column storage_folder set not null;
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'document_types_storage_folder_check' and conrelid = 'public.document_types'::regclass) then
    alter table public.document_types add constraint document_types_storage_folder_check
      check (storage_folder in ('201-file', 'work-requirements', 'lesp'));
  end if;
end $$;

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  document_type_id uuid not null references public.document_types (id),
  document_no text,
  issued_on date,
  expires_on date,
  file_path text,
  status text not null default 'verified' check (status in ('pending_review', 'verified', 'rejected')),
  uploaded_by uuid references auth.users (id) on delete set null,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  review_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employee_documents_employee_idx on public.employee_documents (employee_id, document_type_id);
create index if not exists employee_documents_expiry_idx on public.employee_documents (expires_on) where expires_on is not null;

-- Payroll cutoffs and payslips (imported from the payroll file each cutoff)
create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_start, period_end),
  check (period_end >= period_start)
);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  site_name text,
  days_worked numeric(6, 2) not null default 0,
  hours_worked numeric(7, 2) not null default 0,
  overtime_hours numeric(7, 2) not null default 0,
  night_diff_hours numeric(7, 2) not null default 0,
  basic_pay numeric(12, 2) not null default 0,
  overtime_pay numeric(12, 2) not null default 0,
  night_diff_pay numeric(12, 2) not null default 0,
  holiday_pay numeric(12, 2) not null default 0,
  allowances numeric(12, 2) not null default 0,
  other_earnings numeric(12, 2) not null default 0,
  gross_pay numeric(12, 2) not null default 0,
  sss numeric(12, 2) not null default 0,
  philhealth numeric(12, 2) not null default 0,
  pagibig numeric(12, 2) not null default 0,
  withholding_tax numeric(12, 2) not null default 0,
  loans numeric(12, 2) not null default 0,
  other_deductions numeric(12, 2) not null default 0,
  total_deductions numeric(12, 2) not null default 0,
  net_pay numeric(12, 2) not null default 0,
  earnings_detail jsonb not null default '[]'::jsonb,
  deductions_detail jsonb not null default '[]'::jsonb,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_period_id, employee_id)
);
create index if not exists payslips_employee_idx on public.payslips (employee_id);

-- Leave
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  days_per_year numeric(5, 1),
  max_days_per_request numeric(5, 1),
  is_paid boolean not null default true,
  requires_attachment boolean not null default false,
  applies_to_sex text check (applies_to_sex in ('male', 'female')),
  min_service_months integer not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 100
);

create table if not exists public.leave_credits (
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  credits numeric(5, 1) not null default 0 check (credits >= 0),
  primary key (employee_id, leave_type_id, year)
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id),
  start_date date not null,
  end_date date not null,
  days numeric(5, 1) not null,
  reason text,
  attachment_path text,
  status text not null default 'pending_supervisor'
    check (status in ('pending_supervisor', 'pending_hr', 'approved', 'rejected', 'cancelled')),
  site_id uuid references public.sites (id) on delete set null,
  reliever_employee_id uuid references public.employees (id) on delete set null,
  supervisor_id uuid references auth.users (id) on delete set null,
  supervisor_decided_at timestamptz,
  supervisor_note text,
  hr_id uuid references auth.users (id) on delete set null,
  hr_decided_at timestamptz,
  hr_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (days > 0)
);
create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id, start_date);
create index if not exists leave_requests_status_idx on public.leave_requests (status);

-- Certificates of employment
create sequence if not exists public.certificate_no_seq;

create table if not exists public.coe_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  purpose text not null check (purpose in ('employment', 'bank_loan', 'government', 'travel_visa', 'school', 'other')),
  purpose_details text,
  include_compensation boolean not null default false,
  addressee text,
  status text not null default 'pending' check (status in ('pending', 'issued', 'rejected', 'cancelled')),
  due_at timestamptz not null default (now() + interval '3 days'),
  certificate_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coe_requests_status_idx on public.coe_requests (status, due_at);

create table if not exists public.certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_no text not null unique,
  verification_code text not null unique,
  kind text not null default 'coe' check (kind in ('coe')),
  employee_id uuid not null references public.employees (id) on delete cascade,
  coe_request_id uuid unique references public.coe_requests (id) on delete set null,
  employee_name text not null,
  position text,
  date_hired date,
  date_separated date,
  employment_status text,
  purpose text,
  include_compensation boolean not null default false,
  compensation_text text,
  signatory_name text not null,
  signatory_title text not null,
  file_path text,
  issued_by uuid references auth.users (id) on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now()
);
create index if not exists certificates_employee_idx on public.certificates (employee_id);

do $$ begin
  alter table public.coe_requests
    add constraint coe_requests_certificate_fk foreign key (certificate_id) references public.certificates (id) on delete set null;
exception when duplicate_object then null;
end $$;

-- Employees ask HR to change contact details; HR approves
create table if not exists public.profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  changes jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Payroll concerns ("my overtime is missing")
create table if not exists public.payroll_concerns (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  payslip_id uuid references public.payslips (id) on delete set null,
  category text not null
    check (category in ('missing_pay', 'overtime', 'night_differential', 'holiday_pay', 'deduction', 'contribution', 'tax', 'other')),
  description text not null check (length(trim(description)) > 0),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  resolution text,
  handled_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Announcements and who read them
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null,
  category text not null default 'memo' check (category in ('memo', 'advisory', 'policy', 'payroll', 'event', 'emergency')),
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  audience text not null default 'all' check (audience in ('all', 'areas', 'sites')),
  area_ids uuid[] not null default '{}',
  site_ids uuid[] not null default '{}',
  requires_ack boolean not null default false,
  pinned boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_status_idx on public.announcements (status, published_at desc);

create table if not exists public.announcement_receipts (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  read_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  primary key (announcement_id, employee_id)
);

-- In-app notifications (the app's push sender reads these rows)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text,
  kind text not null default 'info',
  link jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.device_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Attendance: each time in and time out from the app, with a selfie taken then and the phone's
-- location. Only log_attendance writes here: the database sets the time and compares the location
-- with the guard's post. GPS can be off indoors and can be faked, so a log away from the post is kept
-- and marked for HR to look at, never refused.
create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  site_id uuid references public.sites (id) on delete set null,  -- the guard's post at the time
  kind text not null check (kind in ('time_in', 'time_out')),
  logged_at timestamptz not null default now(),                   -- the database's clock, not the phone's
  photo_path text not null unique,                                -- attendance-photos/{employee_id}/...
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  accuracy_m integer,                                             -- the phone's own error estimate
  distance_m integer,                                             -- from the post's location
  radius_m integer,                                               -- the post's allowed distance then
  location_check text not null
    check (location_check in ('at_post', 'unsure', 'away', 'no_location', 'post_not_set', 'no_post')),
  mock_location boolean                                           -- Android: a mock location app was on
);
create index if not exists attendance_logs_employee_idx on public.attendance_logs (employee_id, logged_at desc);
create index if not exists attendance_logs_site_idx on public.attendance_logs (site_id, logged_at desc);
create index if not exists attendance_logs_logged_idx on public.attendance_logs (logged_at desc);

-- When the guard has no phone: the post's commander logs for them (the guard's photo and the
-- commander's location; log_attendance_for), or HR enters the log by hand from the post's logbook,
-- with the reason (add_manual_attendance; no photo, no location, marked "manual").
alter table public.attendance_logs
  add column if not exists source text not null default 'self' check (source in ('self', 'commander', 'manual')),
  add column if not exists logged_by uuid references auth.users (id) on delete set null,
  add column if not exists logged_by_employee_id uuid references public.employees (id) on delete set null,
  add column if not exists manual_reason text;
alter table public.attendance_logs alter column photo_path drop not null;
alter table public.attendance_logs drop constraint if exists attendance_logs_location_check_check;
alter table public.attendance_logs add constraint attendance_logs_location_check_check
  check (location_check in ('at_post', 'unsure', 'away', 'no_location', 'post_not_set', 'no_post', 'manual'));

-- Files kept in Amazon S3. The files Edge Function puts them in a private bucket and records each one
-- here; the AWS keys live only in that function's secrets. Every employee has one folder, named after
-- the employee number when the file was stored:
--   employees/<employee number>/201-file/<date>_<document type>_<random>.<ext>
--   employees/<employee number>/work-requirements/<date>_<document type>_<random>.<ext>
--   employees/<employee number>/lesp/<date>_<document type>_<random>.<ext>
--   employees/<employee number>/attendance/<yyyy>/<mm>/<date>_<hhmm>_<time-in|time-out>_<random>.jpg
--   employees/<employee number>/leave/<date>_leave-attachment_<random>.<ext>
--   employees/<employee number>/certificates/<certificate number>.pdf
-- Payslips are not stored: their PDF is made each time someone downloads it.
create table if not exists public.stored_files (
  id uuid primary key default gen_random_uuid(),
  object_key text not null unique,
  employee_id uuid references public.employees (id) on delete set null,
  purpose text not null,
  folder text not null,
  document_type_id uuid references public.document_types (id) on delete set null,
  certificate_id uuid references public.certificates (id) on delete set null,
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  max_bytes integer not null check (max_bytes > 0),
  size_bytes integer check (size_bytes > 0 and size_bytes <= max_bytes),
  status text not null default 'pending' check (status in ('pending', 'stored')),  -- stored once S3 has it
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  stored_at timestamptz
);
-- employees/<number>/<folder>/... for employee files; company/code-of-discipline/... for the company's
-- Code of Discipline (HR uploads it; Claude reads it into offense rules, section 16)
alter table public.stored_files drop constraint if exists stored_files_object_key_check;
alter table public.stored_files add constraint stored_files_object_key_check check (
  (object_key ~ '^employees/[A-Za-z0-9][A-Za-z0-9._-]*/(201-file|work-requirements|lesp|attendance|leave|certificates)/[A-Za-z0-9][A-Za-z0-9/._-]*$'
   or object_key ~ '^company/code-of-discipline/[A-Za-z0-9][A-Za-z0-9._-]*$')
  and object_key !~ '/\.' and length(object_key) <= 300);
alter table public.stored_files drop constraint if exists stored_files_purpose_check;
alter table public.stored_files add constraint stored_files_purpose_check
  check (purpose in ('document', 'leave', 'attendance', 'certificate', 'policy'));
alter table public.stored_files drop constraint if exists stored_files_folder_check;
alter table public.stored_files add constraint stored_files_folder_check
  check (folder in ('201-file', 'work-requirements', 'lesp', 'attendance', 'leave', 'certificates', 'code-of-discipline'));
create index if not exists stored_files_employee_idx on public.stored_files (employee_id, folder, created_at desc);
create index if not exists stored_files_uploader_idx on public.stored_files (uploaded_by, created_at desc);

-- Discipline (functions, rules and access in section 16). The Code of Discipline is the basis: HR
-- uploads it, Claude reads it into offense rules, and HR approves each rule before it is used. Incident
-- reports (from clients, commanders or staff) can become cases, and a case follows due process under
-- the Labor Code (Art. 292(b), 297) and DOLE Department Order 147-15: a written notice to explain with
-- at least five calendar days to answer, a chance to be heard, and a written decision.
create sequence if not exists public.incident_no_seq;
create sequence if not exists public.case_no_seq;

create table if not exists public.discipline_codes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 3 and 200),
  effective_on date,
  file_key text not null unique,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  read_status text not null default 'not_read' check (read_status in ('not_read', 'reading', 'read', 'failed')),
  read_job text,                -- Claude's Message Batch while it reads the PDF
  read_model text,
  read_error text,
  read_started_at timestamptz,
  read_at timestamptz,
  summary text,                 -- Claude's few sentences on what the code covers
  compliance_notes jsonb not null default '[]'::jsonb check (jsonb_typeof(compliance_notes) = 'array'),
  uploaded_by uuid references auth.users (id) on delete set null,
  activated_by uuid references auth.users (id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists discipline_codes_one_active on public.discipline_codes ((true)) where status = 'active';

-- [{offense: 1, action: 'warning' | 'reprimand' | 'suspension' | 'dismissal' | 'other', days: 0, text: '...'}]
create or replace function public.valid_penalties(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= 10 and not exists (
    select 1 from jsonb_array_elements(p) x
    where jsonb_typeof(x) <> 'object'
       or jsonb_typeof(x -> 'offense') <> 'number' or (x ->> 'offense')::numeric not between 1 and 10
       or coalesce(x ->> 'action', '') not in ('warning', 'reprimand', 'suspension', 'dismissal', 'other')
       or (x ->> 'action' = 'suspension' and (jsonb_typeof(x -> 'days') <> 'number' or (x ->> 'days')::numeric not between 1 and 90))
       or length(coalesce(x ->> 'text', '')) > 500)
$$;

create table if not exists public.offense_rules (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.discipline_codes (id) on delete cascade,
  ref text not null default '' check (length(ref) <= 40),          -- the code's own numbering
  title text not null check (length(trim(title)) between 2 and 300),
  description text not null default '' check (length(description) <= 2000),
  category text not null default 'other' check (category in (
    'attendance', 'post_duty', 'conduct', 'uniform_equipment', 'dishonesty', 'safety_security', 'substance',
    'insubordination', 'other')),
  gravity text not null default 'unclassified' check (gravity in ('light', 'less_serious', 'serious', 'grave', 'unclassified')),
  penalties jsonb not null default '[]'::jsonb check (public.valid_penalties(penalties)),
  just_cause text not null default 'none' check (just_cause in (
    'none', 'serious_misconduct', 'willful_disobedience', 'gross_neglect', 'fraud_breach_of_trust',
    'crime_against_employer', 'analogous')),                     -- Labor Code Art. 297, when dismissal is a penalty
  source_text text not null default '' check (length(source_text) <= 2000),  -- the code's words
  page integer check (page is null or page between 1 and 2000),
  sort integer not null default 0,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  from_ai boolean not null default false,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offense_rules_code_idx on public.offense_rules (code_id, sort);

create table if not exists public.incident_reports (
  id uuid primary key default gen_random_uuid(),
  report_no text not null unique,
  site_id uuid references public.sites (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,   -- the guard, when known
  guard_described text check (length(guard_described) <= 200),          -- as the reporter put it
  occurred_at timestamptz not null,
  title text not null check (length(trim(title)) between 3 and 200),
  details text not null check (length(trim(details)) between 10 and 5000),
  reporter_kind text not null check (reporter_kind in ('client', 'commander', 'staff')),
  reported_by uuid references auth.users (id) on delete set null,
  reporter_name text,
  status text not null default 'received' check (status in ('received', 'investigating', 'action_taken', 'closed', 'not_pursued')),
  client_update text check (length(client_update) <= 1000),             -- what the client is told
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists incident_reports_status_idx on public.incident_reports (status, created_at desc);
create index if not exists incident_reports_site_idx on public.incident_reports (site_id, created_at desc);

create table if not exists public.disciplinary_cases (
  id uuid primary key default gen_random_uuid(),
  case_no text not null unique,
  employee_id uuid not null references public.employees (id) on delete cascade,
  incident_id uuid references public.incident_reports (id) on delete set null,
  rule_id uuid references public.offense_rules (id) on delete restrict,
  offense_no integer check (offense_no between 1 and 10),     -- first, second ... offense of this rule
  facts text not null check (length(trim(facts)) between 10 and 5000),
  status text not null default 'draft' check (status in ('draft', 'nte_issued', 'explained', 'hearing_set', 'decided', 'withdrawn')),
  -- 1. notice to explain
  nte_text text check (length(nte_text) <= 10000),
  nte_issued_at timestamptz,
  nte_issued_by uuid references auth.users (id) on delete set null,
  explain_by timestamptz,
  nte_received_at timestamptz,
  -- 2. the employee's side
  explanation text check (length(explanation) <= 10000),
  explanation_via text check (explanation_via in ('app', 'paper')),
  explained_at timestamptz,
  wants_hearing boolean not null default false,
  -- 3. hearing or conference
  hearing_at timestamptz,
  hearing_place text check (length(hearing_place) <= 200),
  hearing_notes text check (length(hearing_notes) <= 10000),
  hearing_held_at timestamptz,
  -- 4. decision
  decision text check (decision in ('no_violation', 'warning', 'reprimand', 'suspension', 'dismissal')),
  suspension_days integer check (suspension_days between 1 and 90),
  suspension_from date,
  decision_text text check (length(decision_text) <= 10000),
  departs_reason text check (length(departs_reason) <= 2000),   -- why the penalty is not the code's
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  decision_received_at timestamptz,
  -- preventive suspension during the investigation: at most 30 days (Omnibus Rules, Book V, Rule XIV)
  preventive_from date,
  preventive_to date,
  preventive_reason text check (length(preventive_reason) <= 2000),
  withdrawn_reason text check (length(withdrawn_reason) <= 2000),
  ai_suggestion jsonb,
  ai_suggested_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (preventive_to is null or (preventive_from is not null and preventive_to >= preventive_from and preventive_to - preventive_from < 30))
);
create index if not exists disciplinary_cases_employee_idx on public.disciplinary_cases (employee_id, created_at desc);
create index if not exists disciplinary_cases_status_idx on public.disciplinary_cases (status, created_at desc);

-- Recruitment (the website's careers page)
create table if not exists public.job_openings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  location text not null,
  area_id uuid references public.areas (id) on delete set null,
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'reliever', 'seasonal')),
  summary text,
  description text,
  qualifications text[] not null default '{}',
  requirements text[] not null default '{}',
  slots integer check (slots is null or slots > 0),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  posted_at timestamptz,
  closes_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_opening_id uuid references public.job_openings (id) on delete set null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  birthdate date,
  sex text check (sex in ('male', 'female')),
  mobile_no text not null,
  email text,
  city text not null,
  province text,
  education text check (education in ('high_school', 'senior_high', 'vocational', 'college_level', 'college_graduate')),
  has_license boolean not null default false,
  license_no text,
  license_expires_on date,
  years_experience numeric(4, 1) check (years_experience is null or years_experience between 0 and 60),
  previous_agency text,
  preferred_location text,
  message text,
  resume_path text,
  privacy_consent boolean not null check (privacy_consent),
  status text not null default 'new'
    check (status in ('new', 'screening', 'interview', 'requirements', 'hired', 'not_qualified', 'withdrawn')),
  staff_notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  employee_id uuid references public.employees (id) on delete set null,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists job_applications_status_idx on public.job_applications (status, created_at desc);

-- Proposal requests from companies (the website's contact page)
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  contact_name text not null,
  position text,
  email text,
  phone text not null,
  site_address text,
  site_type text check (site_type in ('office', 'commercial', 'industrial', 'residential', 'school', 'hospital', 'government', 'event', 'other')),
  guards_needed integer check (guards_needed is null or guards_needed between 1 and 5000),
  coverage text check (coverage in ('day', 'night', '24h', 'event')),
  start_on date,
  message text,
  privacy_consent boolean not null check (privacy_consent),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'site_visit', 'proposal_sent', 'won', 'lost', 'closed')),
  assigned_to uuid references auth.users (id) on delete set null,
  staff_notes text,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Who changed what
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  note text
);
create index if not exists audit_log_table_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_time_idx on public.audit_log (occurred_at desc);

-- -------------------------------------------------------------------------------------
-- 3. Who is asking: role helpers used by every policy
-- -------------------------------------------------------------------------------------

-- The SQL editor, a direct database connection, or a server using the service role key
create or replace function public.is_trusted() returns boolean
language sql stable set search_path = '' as $$
  select (auth.uid() is null and session_user not in ('authenticator', 'anon', 'authenticated', 'supabase_auth_admin', 'supabase_storage_admin'))
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

create or replace function public.has_any_role(p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = any (p_roles))
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin']::public.app_role[])
$$;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin', 'hr_admin', 'hr_staff']::public.app_role[])
$$;

create or replace function public.is_payroll() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin', 'hr_admin', 'payroll']::public.app_role[])
$$;

create or replace function public.is_ops() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin', 'hr_admin', 'operations']::public.app_role[])
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin', 'hr_admin', 'hr_staff', 'payroll', 'operations', 'management']::public.app_role[])
$$;

create or replace function public.can_publish() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_any_role(array['super_admin', 'hr_admin', 'hr_staff', 'operations']::public.app_role[])
$$;

-- The client company of a signed-in client user (null for staff and employees)
create or replace function public.my_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select cu.client_id from public.client_users cu where cu.user_id = auth.uid() and cu.disabled_at is null
$$;

-- Any client login, active or disabled: reference data stays closed to them either way
create or replace function public.is_client_login() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.client_users cu where cu.user_id = auth.uid())
$$;

create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.id from public.employees e where e.user_id = auth.uid()
$$;

-- Posts the signed-in detachment commander or inspector looks after
create or replace function public.my_supervised_site_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(ss.site_id), '{}')
  from public.site_supervisors ss
  join public.employees me on me.id = ss.employee_id
  where me.user_id = auth.uid()
$$;

create or replace function public.supervises(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employees e
    join public.site_supervisors ss on ss.site_id = e.site_id
    join public.employees me on me.id = ss.employee_id
    where e.id = p_employee_id and me.user_id = auth.uid() and e.id <> me.id
  )
$$;

-- "Juan P. Dela Cruz Jr." (also readable as employees.full_name through the API)
create or replace function public.full_name(e public.employees) returns text
language sql immutable set search_path = '' as $$
  select trim(concat_ws(' ',
    e.first_name,
    case when nullif(trim(e.middle_name), '') is not null then left(trim(e.middle_name), 1) || '.' end,
    e.last_name,
    nullif(trim(e.suffix), '')))
$$;

create or replace function public.date_range_label(p_start date, p_end date) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_start = p_end then to_char(p_start, 'FMMon FMDD, YYYY')
    when date_trunc('year', p_start) = date_trunc('year', p_end) then to_char(p_start, 'FMMon FMDD') || ' to ' || to_char(p_end, 'FMMon FMDD, YYYY')
    else to_char(p_start, 'FMMon FMDD, YYYY') || ' to ' || to_char(p_end, 'FMMon FMDD, YYYY')
  end
$$;

-- -------------------------------------------------------------------------------------
-- 4. Notifications (internal helpers; not callable from the API)
-- -------------------------------------------------------------------------------------
create or replace function public.notify_user(p_user_id uuid, p_title text, p_body text, p_kind text, p_link jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, kind, link)
  select p_user_id, p_title, p_body, p_kind, p_link
  where p_user_id is not null
$$;

create or replace function public.notify_employee(p_employee_id uuid, p_title text, p_body text, p_kind text, p_link jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, kind, link)
  select e.user_id, p_title, p_body, p_kind, p_link
  from public.employees e
  where e.id = p_employee_id and e.user_id is not null
$$;

create or replace function public.notify_roles(p_roles public.app_role[], p_title text, p_body text, p_kind text, p_link jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, kind, link)
  select distinct ur.user_id, p_title, p_body, p_kind, p_link
  from public.user_roles ur
  where ur.role = any (p_roles)
$$;

create or replace function public.notify_site_supervisors(p_site_id uuid, p_title text, p_body text, p_kind text, p_link jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, kind, link)
  select distinct e.user_id, p_title, p_body, p_kind, p_link
  from public.site_supervisors ss
  join public.employees e on e.id = ss.employee_id
  where ss.site_id = p_site_id and e.user_id is not null
$$;

-- -------------------------------------------------------------------------------------
-- 5. Audit trail
-- -------------------------------------------------------------------------------------
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_diff jsonb := '{}'::jsonb;
  v_new_diff jsonb := '{}'::jsonb;
  v_id text;
  k text;
  masked boolean := tg_table_name = 'employee_government_ids';
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'employee_id', v_old ->> 'employee_id', v_new ->> 'user_id', v_old ->> 'user_id', v_new ->> 'email', v_old ->> 'email');

  if masked then
    -- keep only the last three characters of government numbers in the trail
    select coalesce(jsonb_object_agg(key, case when key in ('sss_no', 'philhealth_no', 'pagibig_no', 'tin') and value <> 'null'::jsonb
      then to_jsonb('***' || right(value #>> '{}', 3)) else value end), '{}'::jsonb) into v_old from jsonb_each(coalesce(v_old, '{}'::jsonb));
    select coalesce(jsonb_object_agg(key, case when key in ('sss_no', 'philhealth_no', 'pagibig_no', 'tin') and value <> 'null'::jsonb
      then to_jsonb('***' || right(value #>> '{}', 3)) else value end), '{}'::jsonb) into v_new from jsonb_each(coalesce(v_new, '{}'::jsonb));
  end if;

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k <> 'updated_at' and (v_old -> k) is distinct from (v_new -> k) then
        v_old_diff := v_old_diff || jsonb_build_object(k, v_old -> k);
        v_new_diff := v_new_diff || jsonb_build_object(k, v_new -> k);
      end if;
    end loop;
    if v_new_diff = '{}'::jsonb then
      return new;
    end if;
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'UPDATE', tg_table_name, v_id, v_old_diff, v_new_diff);
    return new;
  elsif tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'INSERT', tg_table_name, v_id, v_new);
    return new;
  else
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'DELETE', tg_table_name, v_id, v_old);
    return old;
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 6. Business rules (triggers)
-- -------------------------------------------------------------------------------------

create or replace function public.employees_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.employee_no := upper(trim(new.employee_no));
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  if new.status = 'floating' then
    new.floating_since := coalesce(new.floating_since, current_date);
    new.site_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'floating' then
    new.floating_since := null;
  end if;
  if new.status in ('resigned', 'terminated', 'end_of_contract', 'retired') then
    new.date_separated := coalesce(new.date_separated, current_date);
  end if;
  return new;
end $$;

-- A record may point at an S3 file only when the file is stored, belongs to this employee and this
-- use (and document type), and, for anyone but HR, was uploaded by the person saving the record.
-- Paths from before S3 (Supabase Storage) do not start with employees/; their callers check them.
create or replace function public.stored_file_ok(p_key text, p_employee_id uuid, p_purpose text,
                                                 p_document_type_id uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.stored_files f
    where f.object_key = p_key and f.status = 'stored' and f.purpose = p_purpose
      and f.employee_id = p_employee_id
      and (p_document_type_id is null or f.document_type_id = p_document_type_id)
      and (public.is_hr() or public.is_trusted() or f.uploaded_by = auth.uid()))
$$;

create or replace function public.employee_documents_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  dt public.document_types;
begin
  select * into dt from public.document_types where id = new.document_type_id;
  if new.file_path is not null and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path) then
    if new.file_path like 'employees/%' then
      if not public.stored_file_ok(new.file_path, new.employee_id, 'document', new.document_type_id) then
        raise exception 'That file did not arrive. Upload it again.' using errcode = 'P0001';
      end if;
    elsif not (public.is_hr() or public.is_trusted())
          and new.file_path not like coalesce(public.current_employee_id()::text, '-') || '/uploads/%' then
      raise exception 'Upload the file again' using errcode = 'P0001';
    end if;
  end if;
  if public.is_hr() or public.is_trusted() then
    if tg_op = 'INSERT' then
      new.uploaded_by := coalesce(new.uploaded_by, auth.uid());
    end if;
    if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
      new.verified_by := coalesce(auth.uid(), new.verified_by);
      new.verified_at := now();
    end if;
    return new;
  end if;
  -- an employee uploading a renewal from the app
  if tg_op <> 'INSERT' then
    raise exception 'Only HR can change a document on file' using errcode = '42501';
  end if;
  if new.employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only upload your own documents' using errcode = '42501';
  end if;
  if not coalesce(dt.employee_can_upload, false) then
    raise exception 'Bring this document to the HR office' using errcode = 'P0001';
  end if;
  new.status := 'pending_review';
  new.uploaded_by := auth.uid();
  new.verified_by := null;
  new.verified_at := null;
  new.review_note := null;
  return new;
end $$;

-- Leave entitlement for a year: credits set by HR, else the leave type's yearly days once the
-- employee has served the minimum months (service incentive leave needs one year)
create or replace function public.leave_entitlement(p_employee_id uuid, p_leave_type_id uuid, p_year int) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select lc.credits from public.leave_credits lc
      where lc.employee_id = p_employee_id and lc.leave_type_id = p_leave_type_id and lc.year = p_year),
    (select case
        when lt.days_per_year is null then null
        when lt.min_service_months = 0 then lt.days_per_year
        when e.date_hired is not null and e.date_hired <= (current_date - make_interval(months => lt.min_service_months))::date then lt.days_per_year
        else 0
      end
      from public.leave_types lt, public.employees e
      where lt.id = p_leave_type_id and e.id = p_employee_id)
  )
$$;

create or replace function public.leave_days_taken(p_employee_id uuid, p_leave_type_id uuid, p_year int, p_statuses text[]) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(r.days), 0)
  from public.leave_requests r
  where r.employee_id = p_employee_id and r.leave_type_id = p_leave_type_id
    and extract(year from r.start_date)::int = p_year and r.status = any (p_statuses)
$$;

create or replace function public.leave_requests_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  lt public.leave_types;
  v_left numeric;
  v_has_supervisor boolean;
begin
  if not (public.is_hr() or public.is_trusted()) and new.employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only file your own leave' using errcode = '42501';
  end if;
  select * into e from public.employees where id = new.employee_id;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  select * into lt from public.leave_types where id = new.leave_type_id and is_active;
  if not found then
    raise exception 'Choose a leave type' using errcode = 'P0001';
  end if;
  if lt.applies_to_sex is not null and e.sex is distinct from lt.applies_to_sex then
    raise exception '% is not available for this employee', lt.name using errcode = 'P0001';
  end if;
  if new.attachment_path is not null then
    if new.attachment_path like 'employees/%' then
      if not public.stored_file_ok(new.attachment_path, new.employee_id, 'leave') then
        raise exception 'The attachment did not arrive. Attach it again.' using errcode = 'P0001';
      end if;
    elsif not (public.is_hr() or public.is_trusted())
          and new.attachment_path not like coalesce(public.current_employee_id()::text, '-') || '/uploads/%' then
      raise exception 'Attach the file again' using errcode = 'P0001';
    end if;
  end if;
  if new.end_date < new.start_date then
    raise exception 'The last day is before the first day' using errcode = '22023';
  end if;
  new.days := coalesce(new.days, (new.end_date - new.start_date + 1));
  if lt.max_days_per_request is not null and new.days > lt.max_days_per_request then
    raise exception '% allows up to % days per request', lt.name, lt.max_days_per_request using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id
      and r.status in ('pending_supervisor', 'pending_hr', 'approved')
      and daterange(r.start_date, r.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'There is already leave filed on some of these days' using errcode = 'P0001';
  end if;
  if lt.days_per_year is not null then
    v_left := public.leave_entitlement(new.employee_id, new.leave_type_id, extract(year from new.start_date)::int)
            - public.leave_days_taken(new.employee_id, new.leave_type_id, extract(year from new.start_date)::int,
                                      array['pending_supervisor', 'pending_hr', 'approved']);
    if new.days > v_left then
      raise exception 'Not enough % credits: % day(s) left this year', lt.name, greatest(v_left, 0) using errcode = 'P0001';
    end if;
  end if;

  new.site_id := e.site_id;
  v_has_supervisor := e.site_id is not null and exists (
    select 1 from public.site_supervisors ss where ss.site_id = e.site_id and ss.employee_id <> e.id);
  new.status := case when v_has_supervisor then 'pending_supervisor' else 'pending_hr' end;
  new.reliever_employee_id := null;
  new.supervisor_id := null;
  new.supervisor_decided_at := null;
  new.supervisor_note := null;
  new.hr_id := null;
  new.hr_decided_at := null;
  new.hr_note := null;
  return new;
end $$;

create or replace function public.leave_requests_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_type text;
  v_link jsonb := jsonb_build_object('screen', 'LeaveRequest', 'id', new.id);
begin
  select public.full_name(e) into v_name from public.employees e where e.id = new.employee_id;
  select name into v_type from public.leave_types where id = new.leave_type_id;
  if new.status = 'pending_supervisor' then
    perform public.notify_site_supervisors(new.site_id, 'Leave request to endorse',
      v_name || ' · ' || v_type || ' · ' || public.date_range_label(new.start_date, new.end_date), 'leave_request', v_link);
  else
    perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'Leave request for HR',
      v_name || ' · ' || v_type || ' · ' || public.date_range_label(new.start_date, new.end_date), 'leave_request', v_link);
  end if;
  return null;
end $$;

create or replace function public.coe_requests_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_hr() or public.is_trusted()) and new.employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only request your own certificate' using errcode = '42501';
  end if;
  if exists (select 1 from public.coe_requests r where r.employee_id = new.employee_id and r.status = 'pending' and r.purpose = new.purpose) then
    raise exception 'There is already a pending request for this purpose' using errcode = 'P0001';
  end if;
  new.status := 'pending';
  new.certificate_id := null;
  new.decided_by := null;
  new.decided_at := null;
  new.decision_note := null;
  new.due_at := now() + interval '3 days';  -- DOLE Labor Advisory 06-20: three days from the request
  return new;
end $$;

create or replace function public.coe_requests_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select public.full_name(e) into v_name from public.employees e where e.id = new.employee_id;
  perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'New COE request',
    v_name || ' · due ' || to_char(new.due_at at time zone 'Asia/Manila', 'FMMon FMDD'), 'coe_request',
    jsonb_build_object('screen', 'CoeRequest', 'id', new.id));
  return null;
end $$;

create or replace function public.profile_change_requests_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text;
  allowed constant text[] := array['mobile_no', 'email', 'present_address', 'provincial_address', 'civil_status',
                                   'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone'];
begin
  if not (public.is_hr() or public.is_trusted()) and new.employee_id is distinct from public.current_employee_id() then
    raise exception 'You can only change your own details' using errcode = '42501';
  end if;
  if jsonb_typeof(new.changes) <> 'object' or new.changes = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(new.changes) loop
    if not (k = any (allowed)) then
      raise exception 'Ask HR to change %', replace(k, '_', ' ') using errcode = 'P0001';
    end if;
  end loop;
  new.status := 'pending';
  new.decided_by := null;
  new.decided_at := null;
  new.decision_note := null;
  return new;
end $$;

create or replace function public.profile_change_requests_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  select public.full_name(e) into v_name from public.employees e where e.id = new.employee_id;
  perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'Details to update',
    v_name || ' asked to update their details', 'profile_change', jsonb_build_object('screen', 'ProfileChange', 'id', new.id));
  return null;
end $$;

create or replace function public.payroll_concerns_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not (public.is_payroll() or public.is_trusted()) and new.employee_id is distinct from public.current_employee_id() then
      raise exception 'You can only raise a concern about your own pay' using errcode = '42501';
    end if;
    if new.payslip_id is not null and not exists (
      select 1 from public.payslips p where p.id = new.payslip_id and p.employee_id = new.employee_id) then
      raise exception 'That payslip is not yours' using errcode = '42501';
    end if;
    new.status := 'open';
    new.resolution := null;
    new.handled_by := null;
    new.resolved_at := null;
    return new;
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
    new.handled_by := coalesce(auth.uid(), new.handled_by);
  end if;
  return new;
end $$;

create or replace function public.payroll_concerns_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_link jsonb := jsonb_build_object('screen', 'PayrollConcern', 'id', new.id);
begin
  if tg_op = 'INSERT' then
    select public.full_name(e) into v_name from public.employees e where e.id = new.employee_id;
    perform public.notify_roles(array['hr_admin', 'payroll']::public.app_role[], 'Payroll concern',
      v_name || ' · ' || replace(new.category, '_', ' '), 'payroll_concern', v_link);
  elsif new.status is distinct from old.status and new.status in ('in_review', 'resolved', 'closed') then
    perform public.notify_employee(new.employee_id,
      case new.status when 'in_review' then 'Payroll is checking your concern' else 'Your payroll concern is ' || new.status end,
      coalesce(new.resolution, ''), 'payroll_concern', v_link);
  end if;
  return null;
end $$;

create or replace function public.announcements_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.audience = 'all' then
    new.area_ids := '{}';
    new.site_ids := '{}';
  elsif new.audience = 'areas' and cardinality(new.area_ids) = 0 then
    raise exception 'Choose at least one area' using errcode = '22023';
  elsif new.audience = 'sites' and cardinality(new.site_ids) = 0 then
    raise exception 'Choose at least one post' using errcode = '22023';
  end if;
  return new;
end $$;

-- Publishing an announcement notifies everyone it is meant for
create or replace function public.announcements_after_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    insert into public.notifications (user_id, title, body, kind, link)
    select e.user_id,
           case new.priority when 'urgent' then 'Urgent: ' else '' end || new.title,
           left(new.body, 140),
           'announcement',
           jsonb_build_object('screen', 'Announcement', 'id', new.id)
    from public.employees e
    where e.user_id is not null
      and e.status in ('active', 'floating', 'on_leave', 'suspended')
      and (new.audience = 'all'
        or (new.audience = 'areas' and e.area_id = any (new.area_ids))
        or (new.audience = 'sites' and e.site_id = any (new.site_ids)));
  end if;
  return null;
end $$;

create or replace function public.job_applications_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.first_name := trim(new.first_name);
  new.last_name := trim(new.last_name);
  new.city := trim(new.city);
  if length(new.first_name) = 0 or length(new.last_name) = 0 then
    raise exception 'Please enter your first and last name' using errcode = '22023';
  end if;
  if coalesce(public.normalize_ph_mobile(new.mobile_no), '') !~ '^9[0-9]{9}$' then
    raise exception 'Please enter a mobile number like 0917 123 4567' using errcode = '22023';
  end if;
  if new.job_opening_id is not null and not exists (
    select 1 from public.job_openings j where j.id = new.job_opening_id and j.status = 'open') then
    new.job_opening_id := null;
  end if;
  if not (public.is_hr() or public.is_trusted()) then
    new.status := 'new';
    new.staff_notes := null;
    new.reviewed_by := null;
    new.employee_id := null;
    new.source := 'website';
    new.created_at := now();
    if (select count(*) from public.job_applications a
        where public.normalize_ph_mobile(a.mobile_no) = public.normalize_ph_mobile(new.mobile_no)
          and a.created_at > now() - interval '24 hours') >= 3 then
      raise exception 'We already have your application from today. HR will contact you.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.job_applications_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'New job application',
    new.first_name || ' ' || new.last_name || ' · ' || new.city, 'job_application',
    jsonb_build_object('screen', 'Application', 'id', new.id));
  return null;
end $$;

create or replace function public.inquiries_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company := trim(new.company);
  new.contact_name := trim(new.contact_name);
  if length(new.company) = 0 or length(new.contact_name) = 0 then
    raise exception 'Please enter the company and your name' using errcode = '22023';
  end if;
  if length(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g')) < 7 then
    raise exception 'Please enter a phone number we can call' using errcode = '22023';
  end if;
  if not (public.is_staff() or public.is_trusted()) then
    new.status := 'new';
    new.assigned_to := null;
    new.staff_notes := null;
    new.source := 'website';
    new.created_at := now();
    if (select count(*) from public.inquiries i
        where regexp_replace(i.phone, '\D', '', 'g') = regexp_replace(new.phone, '\D', '', 'g')
          and i.created_at > now() - interval '1 hour') >= 3 then
      raise exception 'We already have your request. The office will call you.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create or replace function public.inquiries_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_roles(array['super_admin', 'operations', 'management']::public.app_role[], 'New proposal request',
    new.company || ' · ' || coalesce(new.guards_needed::text || ' guard(s)', 'guards'), 'inquiry',
    jsonb_build_object('screen', 'Inquiry', 'id', new.id));
  return null;
end $$;

-- Today in the Philippines (the database clock runs on UTC)
create or replace function public.manila_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Manila')::date
$$;

-- Pay rules: check each formula line's shape (the portal checks the formula itself); one default
create or replace function public.pay_rules_before_write() returns trigger
language plpgsql set search_path = '' as $$
declare
  line jsonb;
  c text;
  codes text[] := '{}';
begin
  new.name := trim(new.name);
  for line in select value from jsonb_array_elements(new.formulas) loop
    c := line ->> 'code';
    if jsonb_typeof(line) <> 'object' or c is null or c !~ '^[a-z][a-z0-9_]{0,31}$' then
      raise exception 'Each formula line needs a code of small letters, digits and _ (for example night_diff)' using errcode = '22023';
    end if;
    if c = any (codes) then
      raise exception 'Two formula lines use the code %', c using errcode = '22023';
    end if;
    codes := codes || c;
    if length(trim(coalesce(line ->> 'label', ''))) not between 1 and 60 then
      raise exception 'Give the line % a name of 1 to 60 characters', c using errcode = '22023';
    end if;
    if length(trim(coalesce(line ->> 'formula', ''))) not between 1 and 300 then
      raise exception 'The formula of % must be 1 to 300 characters', c using errcode = '22023';
    end if;
    if coalesce(line ->> 'kind', 'earning') not in ('earning', 'deduction') then
      raise exception 'The line % must be an earning or a deduction', c using errcode = '22023';
    end if;
  end loop;
  if new.is_default then
    update public.pay_rules set is_default = false
    where id <> new.id and is_default and client_id is not distinct from new.client_id;
  end if;
  return new;
end $$;

-- Assignments of one employee never overlap
create or replace function public.employee_assignments_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.employee_assignments a
    where a.employee_id = new.employee_id and a.id <> new.id
      and daterange(a.start_date, a.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'These dates overlap another assignment of this employee. Change them so they do not overlap.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- A change of post closes the open assignment and opens one at the new post (from the hiring date
-- for a new employee, from today otherwise), on the post's duty pattern. Assignments planned from
-- that day on are replaced.
create or replace function public.employees_record_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_from date := public.manila_today();
begin
  if tg_op = 'UPDATE' and new.site_id is not distinct from old.site_id then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_from := coalesce(new.date_hired, v_from);
  end if;
  delete from public.employee_assignments where employee_id = new.id and start_date >= v_from;
  update public.employee_assignments set end_date = v_from - 1
  where employee_id = new.id and start_date < v_from and (end_date is null or end_date >= v_from);
  if new.site_id is not null then
    insert into public.employee_assignments (employee_id, site_id, start_date, duty_hours, shift_start)
    select new.id, s.id, v_from, s.duty_hours, s.first_shift_start from public.sites s where s.id = new.site_id;
  end if;
  return null;
end $$;

-- -------------------------------------------------------------------------------------
-- 7. Sign-up: staff by invitation code, employees by matching their 201 file
-- -------------------------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text := lower(coalesce(new.email, ''));
  inv public.staff_invitations;
  emp public.employees;
  v_ip text;
begin
  if meta ->> 'account_type' = 'employee' then
    select * into emp from public.employees
    where employee_no = upper(trim(coalesce(meta ->> 'employee_no', '')))
    for update;
    if not found
       or emp.user_id is not null
       or emp.birthdate is distinct from nullif(meta ->> 'birthdate', '')::date
       or public.normalize_ph_mobile(emp.mobile_no) is distinct from public.normalize_ph_mobile(meta ->> 'mobile_no') then
      raise exception 'BANNUAR_ACTIVATION_FAILED' using errcode = 'P0001';
    end if;
    -- only with the one-time ticket the activate-employee function got from begin_employee_activation:
    -- knowing the three facts is not enough to claim the record through auth.signUp
    update public.activation_tickets t set used_at = now(), used_by = new.id
    where t.employee_id = emp.id and t.used_at is null and t.expires_at > now()
      and t.token_hash = encode(extensions.digest(coalesce(meta ->> 'activation_ticket', ''), 'sha256'), 'hex')
    returning t.ip into v_ip;
    if not found then
      raise exception 'BANNUAR_ACTIVATION_FAILED' using errcode = 'P0001';
    end if;
    insert into public.profiles (id, full_name, email) values (new.id, public.full_name(emp), v_email)
    on conflict (id) do nothing;
    update public.employees set user_id = new.id where id = emp.id;
    insert into public.user_roles (user_id, role) values (new.id, 'employee') on conflict do nothing;
    insert into public.activation_attempts (employee_no, ip, result) values (emp.employee_no, v_ip, 'activated');
    -- the birthdate, mobile number and ticket were needed only for this check; user metadata is
    -- copied into every access token, so they do not stay there (strip_activation_metadata below
    -- also catches Auth writing its own copy back when it confirms the email)
    begin
      update auth.users set raw_user_meta_data = raw_user_meta_data - 'birthdate' - 'mobile_no' - 'activation_ticket'
      where id = new.id;
    exception when insufficient_privilege then
      null;
    end;
    return new;
  end if;

  select * into inv from public.staff_invitations
  where email = v_email and accepted_at is null and expires_at > now()
  for update;
  if not found or inv.code is distinct from upper(trim(coalesce(meta ->> 'invite_code', ''))) then
    raise exception 'BANNUAR_INVITE_REQUIRED' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(meta ->> 'full_name'), ''), inv.full_name), v_email)
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role, granted_by)
  select new.id, r, inv.invited_by from unnest(inv.roles) r
  on conflict do nothing;
  if inv.employee_id is not null then
    update public.employees set user_id = new.id where id = inv.employee_id and user_id is null;
    insert into public.user_roles (user_id, role) values (new.id, 'employee') on conflict do nothing;
  end if;
  -- someone at a client company: no staff role, only their company's view (section 17)
  if inv.client_id is not null then
    insert into public.client_users (user_id, client_id, full_name, email, invited_by)
    values (new.id, inv.client_id, coalesce(nullif(trim(meta ->> 'full_name'), ''), inv.full_name), v_email, inv.invited_by)
    on conflict (user_id) do nothing;
  end if;
  update public.staff_invitations set accepted_at = now(), accepted_user_id = new.id where email = inv.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Supabase Auth saves the user metadata again from its own copy right after creating a login (when it
-- confirms the email), which would put the birthdate, mobile number and activation ticket back.
-- This keeps them out of employee logins on every write.
create or replace function public.strip_activation_metadata() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.raw_user_meta_data := new.raw_user_meta_data - 'birthdate' - 'mobile_no' - 'activation_ticket';
  return new;
end $$;

drop trigger if exists strip_activation_metadata on auth.users;
create trigger strip_activation_metadata before update on auth.users
  for each row when (new.raw_user_meta_data ->> 'account_type' = 'employee'
                     and new.raw_user_meta_data ?| array['birthdate', 'mobile_no', 'activation_ticket'])
  execute function public.strip_activation_metadata();

-- -------------------------------------------------------------------------------------
-- 8. Attach triggers
-- -------------------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'areas', 'clients', 'sites', 'employees', 'employee_compensation', 'employee_government_ids', 'profiles',
    'employee_documents', 'payroll_periods', 'payslips', 'leave_requests', 'coe_requests', 'profile_change_requests',
    'payroll_concerns', 'announcements', 'job_openings', 'job_applications', 'inquiries', 'pay_rules',
    'employee_assignments'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array[
    'areas', 'clients', 'sites', 'employees', 'employee_compensation', 'employee_government_ids', 'user_roles',
    'staff_invitations', 'site_supervisors', 'document_types', 'employee_documents', 'payroll_periods',
    'leave_types', 'leave_credits', 'leave_requests', 'coe_requests', 'certificates', 'profile_change_requests',
    'announcements', 'job_openings', 'pay_rules', 'pay_rates', 'employee_assignments'
  ] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

drop trigger if exists pay_rules_before_write on public.pay_rules;
create trigger pay_rules_before_write before insert or update on public.pay_rules
  for each row execute function public.pay_rules_before_write();
drop trigger if exists employee_assignments_before_write on public.employee_assignments;
create trigger employee_assignments_before_write before insert or update on public.employee_assignments
  for each row execute function public.employee_assignments_before_write();
drop trigger if exists employees_record_assignment on public.employees;
create trigger employees_record_assignment after insert or update of site_id on public.employees
  for each row execute function public.employees_record_assignment();

-- Payslips are imported in thousands; only corrections and deletions go to the trail
drop trigger if exists audit on public.payslips;
create trigger audit after update or delete on public.payslips
  for each row execute function public.audit_row_change();

drop trigger if exists employees_before_write on public.employees;
create trigger employees_before_write before insert or update on public.employees
  for each row execute function public.employees_before_write();

drop trigger if exists employee_documents_before_write on public.employee_documents;
create trigger employee_documents_before_write before insert or update on public.employee_documents
  for each row execute function public.employee_documents_before_write();

drop trigger if exists leave_requests_before_insert on public.leave_requests;
create trigger leave_requests_before_insert before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();
drop trigger if exists leave_requests_after_insert on public.leave_requests;
create trigger leave_requests_after_insert after insert on public.leave_requests
  for each row execute function public.leave_requests_after_insert();

drop trigger if exists coe_requests_before_insert on public.coe_requests;
create trigger coe_requests_before_insert before insert on public.coe_requests
  for each row execute function public.coe_requests_before_insert();
drop trigger if exists coe_requests_after_insert on public.coe_requests;
create trigger coe_requests_after_insert after insert on public.coe_requests
  for each row execute function public.coe_requests_after_insert();

drop trigger if exists profile_change_requests_before_insert on public.profile_change_requests;
create trigger profile_change_requests_before_insert before insert on public.profile_change_requests
  for each row execute function public.profile_change_requests_before_insert();
drop trigger if exists profile_change_requests_after_insert on public.profile_change_requests;
create trigger profile_change_requests_after_insert after insert on public.profile_change_requests
  for each row execute function public.profile_change_requests_after_insert();

drop trigger if exists payroll_concerns_before_write on public.payroll_concerns;
create trigger payroll_concerns_before_write before insert or update on public.payroll_concerns
  for each row execute function public.payroll_concerns_before_write();
drop trigger if exists payroll_concerns_after_write on public.payroll_concerns;
create trigger payroll_concerns_after_write after insert or update on public.payroll_concerns
  for each row execute function public.payroll_concerns_after_write();

drop trigger if exists announcements_before_write on public.announcements;
create trigger announcements_before_write before insert or update on public.announcements
  for each row execute function public.announcements_before_write();
drop trigger if exists announcements_after_write on public.announcements;
create trigger announcements_after_write after insert or update on public.announcements
  for each row execute function public.announcements_after_write();

drop trigger if exists job_applications_before_insert on public.job_applications;
create trigger job_applications_before_insert before insert on public.job_applications
  for each row execute function public.job_applications_before_insert();
drop trigger if exists job_applications_after_insert on public.job_applications;
create trigger job_applications_after_insert after insert on public.job_applications
  for each row execute function public.job_applications_after_insert();

drop trigger if exists inquiries_before_insert on public.inquiries;
create trigger inquiries_before_insert before insert on public.inquiries
  for each row execute function public.inquiries_before_insert();
drop trigger if exists inquiries_after_insert on public.inquiries;
create trigger inquiries_after_insert after insert on public.inquiries
  for each row execute function public.inquiries_after_insert();

-- -------------------------------------------------------------------------------------
-- 9. Views (they run with the reader's own permissions)
-- -------------------------------------------------------------------------------------

-- Licenses and clearances that are expired or inside their reminder window
create or replace view public.document_alerts with (security_invoker = true) as
select d.id, d.employee_id, e.employee_no, e.first_name, e.last_name, e.site_id, s.name as site_name,
       dt.code as type_code, dt.name as type_name, d.document_no, d.expires_on,
       (d.expires_on - current_date) as days_left,
       case when d.expires_on < current_date then 'expired' else 'expiring' end as state
from public.employee_documents d
join public.document_types dt on dt.id = d.document_type_id
join public.employees e on e.id = d.employee_id
left join public.sites s on s.id = e.site_id
where d.expires_on is not null
  and d.status = 'verified'
  and e.status in ('active', 'floating', 'on_leave', 'suspended')
  and d.expires_on <= current_date + dt.remind_days_before
  and not exists (
    select 1 from public.employee_documents d2
    where d2.employee_id = d.employee_id and d2.document_type_id = d.document_type_id
      and d2.status = 'verified' and (d2.expires_on is null or d2.expires_on > d.expires_on));

-- Deployable employees missing a valid required document (license, clearance, drug test...)
create or replace view public.compliance_gaps with (security_invoker = true) as
select e.id as employee_id, e.employee_no, e.first_name, e.last_name, e.status, e.site_id, s.name as site_name,
       dt.id as document_type_id, dt.code as type_code, dt.name as type_name,
       (select max(d.expires_on) from public.employee_documents d
         where d.employee_id = e.id and d.document_type_id = dt.id and d.status = 'verified') as last_expiry
from public.employees e
cross join public.document_types dt
left join public.sites s on s.id = e.site_id
where dt.required_for_deployment and dt.is_active
  and e.is_field
  and e.status in ('active', 'floating', 'on_leave', 'suspended')
  and not exists (
    select 1 from public.employee_documents d
    where d.employee_id = e.id and d.document_type_id = dt.id and d.status = 'verified'
      and (d.expires_on is null or d.expires_on >= current_date));

create or replace view public.site_staffing with (security_invoker = true) as
select s.id, s.name, s.code, s.client_id, c.name as client_name, s.area_id, a.name as area_name,
       s.city, s.province, s.guards_required, s.is_active,
       (select count(*) from public.employees e
         where e.site_id = s.id and e.status in ('active', 'on_leave', 'suspended'))::int as guards_assigned,
       (select count(*) from public.site_supervisors ss where ss.site_id = s.id)::int as supervisors
from public.sites s
left join public.clients c on c.id = s.client_id
left join public.areas a on a.id = s.area_id;

create or replace view public.leave_balances with (security_invoker = true) as
select e.id as employee_id, lt.id as leave_type_id, lt.code, lt.name, y.year,
       public.leave_entitlement(e.id, lt.id, y.year) as credits,
       public.leave_days_taken(e.id, lt.id, y.year, array['approved']) as used,
       public.leave_days_taken(e.id, lt.id, y.year, array['pending_supervisor', 'pending_hr']) as pending
from public.employees e
cross join public.leave_types lt
cross join (select extract(year from current_date)::int as year) y
where lt.is_active and lt.days_per_year is not null;

-- -------------------------------------------------------------------------------------
-- 10. Functions the portal and app call (RPC)
-- -------------------------------------------------------------------------------------

-- Who am I: roles, profile and the linked employee record
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'roles', coalesce((select jsonb_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = auth.uid()), '[]'::jsonb),
    'full_name', (select p.full_name from public.profiles p where p.id = auth.uid()),
    'email', (select p.email from public.profiles p where p.id = auth.uid()),
    'must_change_password', coalesce((select p.must_change_password from public.profiles p where p.id = auth.uid()), false),
    'employee', (select jsonb_build_object('id', e.id, 'employee_no', e.employee_no, 'full_name', public.full_name(e),
                                           'position', e.position, 'status', e.status, 'site_id', e.site_id)
                 from public.employees e where e.user_id = auth.uid()),
    'client', (select jsonb_build_object('id', c.id, 'name', c.name)
               from public.client_users cu join public.clients c on c.id = cu.client_id
               where cu.user_id = auth.uid() and cu.disabled_at is null)
  )
$$;

create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set must_change_password = false, last_seen_at = now() where id = auth.uid()
$$;

-- Website and portal sign-up checks (friendly messages before calling auth)
create or replace function public.check_staff_invitation(p_email text, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_invitations i
    where i.email = lower(trim(p_email)) and i.code = upper(trim(p_code))
      and i.accepted_at is null and i.expires_at > now())
$$;

create or replace function public.check_employee_activation(p_employee_no text, p_birthdate date, p_mobile text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  emp public.employees;
begin
  select * into emp from public.employees where employee_no = upper(trim(coalesce(p_employee_no, '')));
  if not found or emp.birthdate is distinct from p_birthdate
     or public.normalize_ph_mobile(emp.mobile_no) is distinct from public.normalize_ph_mobile(p_mobile) then
    return 'no_match';
  end if;
  if emp.user_id is not null then
    return 'already_active';
  end if;
  return 'ok';
end $$;

-- Employee app activation, step 1 (called by the activate-employee Edge Function with the service
-- role; not callable from the app or the website). Limits wrong tries per employee number and per IP,
-- logs every attempt, and on a match returns a one-time ticket valid for ten minutes. Step 2 is the
-- function creating the login with auth.admin.createUser; handle_new_user then uses up the ticket.
create or replace function public.begin_employee_activation(p_employee_no text, p_birthdate date, p_mobile text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_no text := upper(trim(coalesce(p_employee_no, '')));
  v_ip text := nullif(left(trim(coalesce(p_ip, '')), 64), '');
  v_result text;
  v_ticket text;
begin
  if not public.is_trusted() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.activation_attempts where occurred_at < now() - interval '30 days';
  if (select count(*) from public.activation_attempts a
      where a.employee_no = v_no and a.result in ('no_match', 'rate_limited')
        and a.occurred_at > now() - interval '30 minutes') >= 5
     or (v_ip is not null and (select count(*) from public.activation_attempts a
      where a.ip = v_ip and a.result in ('no_match', 'rate_limited')
        and a.occurred_at > now() - interval '1 hour') >= 20) then
    insert into public.activation_attempts (employee_no, ip, result) values (v_no, v_ip, 'rate_limited');
    return jsonb_build_object('status', 'rate_limited');
  end if;
  v_result := public.check_employee_activation(v_no, p_birthdate, p_mobile);
  insert into public.activation_attempts (employee_no, ip, result) values (v_no, v_ip, v_result);
  if v_result <> 'ok' then
    return jsonb_build_object('status', v_result);
  end if;
  v_ticket := encode(extensions.gen_random_bytes(32), 'hex');
  delete from public.activation_tickets t
  where t.used_at is null and t.employee_id = (select e.id from public.employees e where e.employee_no = v_no);
  insert into public.activation_tickets (employee_id, token_hash, ip)
  select e.id, encode(extensions.digest(v_ticket, 'sha256'), 'hex'), v_ip
  from public.employees e where e.employee_no = v_no;
  return jsonb_build_object('status', 'ok', 'ticket', v_ticket);
end $$;

-- The app registers this phone for push. A phone that passes to another guard moves to them, so a
-- signed-out guard's notifications stop reaching it.
create or replace function public.register_device_token(p_token text, p_platform text, p_app_version text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(trim(p_token), '') = '' or length(p_token) > 4096 then
    raise exception 'No device token' using errcode = '22023';
  end if;
  insert into public.device_tokens (token, user_id, platform, app_version, last_seen_at)
  values (p_token, auth.uid(), p_platform, left(p_app_version, 40), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, app_version = excluded.app_version,
        last_seen_at = excluded.last_seen_at;
end $$;

-- Metres between two points on the earth (haversine; within a few metres at post distances)
create or replace function public.geo_distance_m(p_lat1 double precision, p_lon1 double precision,
                                                 p_lat2 double precision, p_lon2 double precision)
returns double precision language sql immutable set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lon2 - p_lon1) / 2), 2))))
$$;

-- Time in and time out from the app. The app first uploads the selfie to
-- attendance-photos/{the guard's employee id}/..., then calls this with its path and the location the
-- phone read. The time is the database's. The location is checked against the guard's post:
--   at_post       within the post's allowed distance, with GPS precise enough to tell
--   unsure        the GPS was too rough to tell (its error reaches across the edge of the area)
--   away          outside the allowed distance even after allowing for the GPS error
--   no_location   the phone gave no location (location off or not allowed)
--   post_not_set  the post has no location yet (portal: Posts, edit the post)
--   no_post       the guard has no post (floating)
-- A log is never refused for its location: HR sees each one with its check and photo. Sending the same
-- photo again returns the first log, so a retry after a lost answer does not log twice.
create or replace function public.log_attendance(
  p_kind text, p_photo_path text,
  p_latitude double precision default null, p_longitude double precision default null,
  p_accuracy_m double precision default null, p_mock_location boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.employees;
  s public.sites;
  v_log public.attendance_logs;
  v_has_location boolean := p_latitude is not null and p_longitude is not null;
  v_check text;
  v_distance integer;
  v_radius integer;
begin
  select * into me from public.employees where user_id = auth.uid();
  if not found then
    raise exception 'Only employees log attendance' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('time_in', 'time_out') then
    raise exception 'Choose time in or time out' using errcode = '22023';
  end if;

  select * into v_log from public.attendance_logs where photo_path = p_photo_path;
  if found then
    if v_log.employee_id <> me.id then
      raise exception 'That photo is not yours' using errcode = '42501';
    end if;
  else
    if me.status in ('resigned', 'terminated', 'end_of_contract', 'retired') then
      raise exception 'Your employment record is closed. Ask HR.' using errcode = 'P0001';
    end if;
    if coalesce(p_photo_path, '') = '' then
      raise exception 'Take your photo first' using errcode = '22023';
    end if;
    if p_photo_path like 'employees/%' then
      -- the selfie in S3: this guard's own upload for attendance, from the last 30 minutes
      if not exists (select 1 from public.stored_files f
                     where f.object_key = p_photo_path and f.purpose = 'attendance' and f.status = 'stored'
                       and f.employee_id = me.id and f.uploaded_by = auth.uid()
                       and f.created_at > now() - interval '30 minutes') then
        raise exception 'Your photo did not arrive. Take it again.' using errcode = 'P0001';
      end if;
    else
      -- app versions from before S3 put the selfie in Supabase Storage (attendance-photos/<employee id>/...)
      if (storage.foldername(p_photo_path))[1] is distinct from me.id::text then
        raise exception 'Take your photo first' using errcode = '22023';
      end if;
      if not exists (select 1 from storage.objects o
                     where o.bucket_id = 'attendance-photos' and o.name = p_photo_path
                       and o.created_at > now() - interval '30 minutes') then
        raise exception 'Your photo did not arrive. Take it again.' using errcode = 'P0001';
      end if;
    end if;
    if v_has_location and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180
                           or p_accuracy_m is null or p_accuracy_m not between 0 and 1000000) then
      raise exception 'That location is not valid' using errcode = '22023';
    end if;

    if not v_has_location then
      v_check := 'no_location';
    elsif me.site_id is null then
      v_check := 'no_post';
    else
      select * into s from public.sites where id = me.site_id;
      if s.latitude is null or s.longitude is null then
        v_check := 'post_not_set';
      else
        v_radius := s.geofence_radius_m;
        v_distance := round(public.geo_distance_m(p_latitude, p_longitude, s.latitude::float8, s.longitude::float8));
        v_check := case
          when v_distance <= v_radius and ceil(p_accuracy_m) <= v_radius then 'at_post'
          when v_distance - ceil(p_accuracy_m) > v_radius then 'away'
          else 'unsure'
        end;
      end if;
    end if;

    insert into public.attendance_logs (employee_id, site_id, kind, photo_path, latitude, longitude,
                                        accuracy_m, distance_m, radius_m, location_check, mock_location)
    values (me.id, me.site_id, p_kind, p_photo_path,
            case when v_has_location then round(p_latitude::numeric, 6) end,
            case when v_has_location then round(p_longitude::numeric, 6) end,
            case when v_has_location then ceil(p_accuracy_m)::integer end,
            v_distance, v_radius, v_check, p_mock_location)
    on conflict (photo_path) do nothing
    returning * into v_log;
    if not found then
      select * into v_log from public.attendance_logs where photo_path = p_photo_path;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_log.id, 'kind', v_log.kind, 'logged_at', v_log.logged_at, 'location_check', v_log.location_check,
    'distance_m', v_log.distance_m, 'accuracy_m', v_log.accuracy_m, 'radius_m', v_log.radius_m,
    'site_name', (select st.name from public.sites st where st.id = v_log.site_id));
end $$;

-- The location check of a time in or out at a post (the same rule log_attendance applies)
create or replace function public.attendance_location_check(
  p_site_id uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision)
returns table (location_check text, distance_m integer, radius_m integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sites;
  v_distance integer;
begin
  if p_latitude is null or p_longitude is null then
    return query select 'no_location'::text, null::integer, null::integer;
    return;
  end if;
  if p_site_id is null then
    return query select 'no_post'::text, null::integer, null::integer;
    return;
  end if;
  select * into s from public.sites where id = p_site_id;
  if s.latitude is null or s.longitude is null then
    return query select 'post_not_set'::text, null::integer, null::integer;
    return;
  end if;
  v_distance := round(public.geo_distance_m(p_latitude, p_longitude, s.latitude::float8, s.longitude::float8));
  return query select (case
      when v_distance <= s.geofence_radius_m and ceil(p_accuracy_m) <= s.geofence_radius_m then 'at_post'
      when v_distance - ceil(p_accuracy_m) > s.geofence_radius_m then 'away'
      else 'unsure' end)::text, v_distance, s.geofence_radius_m;
end $$;

-- A commander logs a time in or out for a guard of their post who has no phone with them: the
-- commander takes the guard's photo (uploaded to the guard's S3 folder by the commander) and their
-- own phone gives the location. The log says who logged it, and the guard is told.
create or replace function public.log_attendance_for(
  p_employee_id uuid, p_kind text, p_photo_path text,
  p_latitude double precision default null, p_longitude double precision default null,
  p_accuracy_m double precision default null, p_mock_location boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.employees;
  g public.employees;
  v_log public.attendance_logs;
  c record;
  v_has_location boolean := p_latitude is not null and p_longitude is not null;
begin
  select * into me from public.employees where user_id = auth.uid();
  if not found then
    raise exception 'Only commanders log for a guard' using errcode = '42501';
  end if;
  select * into g from public.employees where id = p_employee_id;
  if not found or g.id = me.id or not public.supervises(g.id) then
    raise exception 'You can log only for the guards at your post' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('time_in', 'time_out') then
    raise exception 'Choose time in or time out' using errcode = '22023';
  end if;

  select * into v_log from public.attendance_logs where photo_path = p_photo_path;
  if found then
    if v_log.employee_id <> g.id then
      raise exception 'That photo is of someone else' using errcode = '42501';
    end if;
  else
    if g.status in ('resigned', 'terminated', 'end_of_contract', 'retired') then
      raise exception 'This guard''s employment record is closed. Ask HR.' using errcode = 'P0001';
    end if;
    if coalesce(p_photo_path, '') = '' or not exists (
        select 1 from public.stored_files f
        where f.object_key = p_photo_path and f.purpose = 'attendance' and f.status = 'stored'
          and f.employee_id = g.id and f.uploaded_by = auth.uid()
          and f.created_at > now() - interval '30 minutes') then
      raise exception 'The guard''s photo did not arrive. Take it again.' using errcode = 'P0001';
    end if;
    if v_has_location and (p_latitude not between -90 and 90 or p_longitude not between -180 and 180
                           or p_accuracy_m is null or p_accuracy_m not between 0 and 1000000) then
      raise exception 'That location is not valid' using errcode = '22023';
    end if;
    select * into c from public.attendance_location_check(g.site_id, p_latitude, p_longitude, p_accuracy_m);
    insert into public.attendance_logs (employee_id, site_id, kind, photo_path, latitude, longitude, accuracy_m,
                                        distance_m, radius_m, location_check, mock_location,
                                        source, logged_by, logged_by_employee_id)
    values (g.id, g.site_id, p_kind, p_photo_path,
            case when v_has_location then round(p_latitude::numeric, 6) end,
            case when v_has_location then round(p_longitude::numeric, 6) end,
            case when v_has_location then ceil(p_accuracy_m)::integer end,
            c.distance_m, c.radius_m, c.location_check, p_mock_location, 'commander', auth.uid(), me.id)
    on conflict (photo_path) do nothing
    returning * into v_log;
    if not found then
      select * into v_log from public.attendance_logs where photo_path = p_photo_path;
    else
      perform public.notify_employee(g.id,
        case p_kind when 'time_in' then 'Your time in was logged by your commander' else 'Your time out was logged by your commander' end,
        public.full_name(me), 'attendance', jsonb_build_object('screen', 'Attendance'));
    end if;
  end if;

  return jsonb_build_object(
    'id', v_log.id, 'kind', v_log.kind, 'logged_at', v_log.logged_at, 'location_check', v_log.location_check,
    'distance_m', v_log.distance_m, 'accuracy_m', v_log.accuracy_m, 'radius_m', v_log.radius_m,
    'site_name', (select st.name from public.sites st where st.id = v_log.site_id),
    'employee_name', public.full_name(g));
end $$;

-- HR enters a time in or out by hand (a lost phone, no signal, the post's logbook). The time is the
-- one HR gives (not in the future, at most 62 days back); the reason is required; no photo and no
-- location, so the log is marked "manual". The audit log keeps who entered it, and the guard is told.
create or replace function public.add_manual_attendance(
  p_employee_id uuid, p_kind text, p_logged_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.employees;
  v_log public.attendance_logs;
begin
  if not public.is_hr() then
    raise exception 'Only HR enters attendance by hand' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee_id;
  if not found then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if p_kind is null or p_kind not in ('time_in', 'time_out') then
    raise exception 'Choose time in or time out' using errcode = '22023';
  end if;
  if p_logged_at is null or p_logged_at > now() + interval '5 minutes' or p_logged_at < now() - interval '62 days' then
    raise exception 'Enter a time from the last 62 days, not in the future' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why the log is entered by hand' using errcode = '22023';
  end if;
  insert into public.attendance_logs (employee_id, site_id, kind, logged_at, photo_path, location_check,
                                      source, logged_by, manual_reason)
  values (e.id, e.site_id, p_kind, p_logged_at, null, 'manual', 'manual', auth.uid(), left(trim(p_reason), 500))
  returning * into v_log;
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data, note)
  values (auth.uid(), 'INSERT', 'attendance_logs', v_log.id::text,
          jsonb_build_object('employee_id', e.id, 'kind', p_kind, 'logged_at', p_logged_at, 'source', 'manual'),
          left(trim(p_reason), 500));
  perform public.notify_employee(e.id,
    case p_kind when 'time_in' then 'HR entered a time in for you' else 'HR entered a time out for you' end,
    left(trim(p_reason), 120), 'attendance', jsonb_build_object('screen', 'Attendance'));
  return jsonb_build_object('id', v_log.id, 'kind', v_log.kind, 'logged_at', v_log.logged_at,
                            'location_check', v_log.location_check, 'source', v_log.source);
end $$;

-- Files in Amazon S3 ---------------------------------------------------------------------------------
-- The files Edge Function holds the AWS keys. For an upload it calls begin_file_upload with the
-- signed-in person's own token (the checks below), puts the file in S3 under the key it returns, then
-- calls finish_file_upload with the service role. To open files it asks authorize_file_reads which
-- keys the person may see and signs a five-minute link for each.

-- What each kind of upload may be: its file types and its largest size
create or replace function public.upload_rule(p_purpose text) returns jsonb
language sql immutable set search_path = '' as $$
  select (case p_purpose
    when 'document' then '{"max_bytes": 10485760, "types": ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]}'
    when 'leave' then '{"max_bytes": 10485760, "types": ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]}'
    when 'attendance' then '{"max_bytes": 3145728, "types": ["image/jpeg", "image/png", "image/webp", "image/heic"]}'
    when 'certificate' then '{"max_bytes": 5242880, "types": ["application/pdf"]}'
    when 'policy' then '{"max_bytes": 10485760, "types": ["application/pdf"]}'
  end)::jsonb
$$;

-- employees/<employee number>. Anything but letters, digits, '.', '_' and '-' becomes '-'; a number
-- that still cannot name a folder falls back to the record's id. The key keeps the number the employee
-- had when the file was stored, so renumbering someone leaves earlier files where they are (still
-- linked from their records).
create or replace function public.employee_storage_folder(p_employee_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select 'employees/' || case when x.n ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then x.n else e.id::text end
  from public.employees e,
       lateral (select trim(both '-' from regexp_replace(trim(e.employee_no), '[^A-Za-z0-9._-]+', '-', 'g')) as n) x
  where e.id = p_employee_id
$$;

-- 'NBI_CLEARANCE' -> 'nbi-clearance'
create or replace function public.storage_slug(p text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(both '-' from left(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), 48)), ''), 'file')
$$;

-- Step 1 of an upload: may this person store this file, and under which key? The file waits as
-- 'pending' until S3 has it. HR stores files for anyone; everyone else only for themselves, at most 60
-- an hour. Attendance selfies are only ever the guard's own; certificates only HR's.
create or replace function public.begin_file_upload(
  p_purpose text, p_content_type text, p_size_bytes bigint,
  p_employee_id uuid default null, p_document_type_id uuid default null,
  p_kind text default null, p_certificate_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rule jsonb := public.upload_rule(p_purpose);
  v_me uuid := public.current_employee_id();
  v_hr boolean := public.is_hr();
  e public.employees;
  dt public.document_types;
  c public.certificates;
  v_folder text;
  v_label text;
  v_ext text;
  v_now timestamp := now() at time zone 'Asia/Manila';
  v_rand text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_key text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_rule is null then
    raise exception 'Unknown kind of upload' using errcode = '22023';
  end if;
  if p_content_type is null or not ((v_rule -> 'types') ? p_content_type) then
    raise exception 'This kind of file cannot be uploaded here' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 then
    raise exception 'The file is empty' using errcode = '22023';
  end if;
  if p_size_bytes > (v_rule ->> 'max_bytes')::bigint then
    raise exception 'The file is too large: up to % MB', (v_rule ->> 'max_bytes')::bigint / 1048576 using errcode = '22023';
  end if;
  if not v_hr and (select count(*) from public.stored_files f
                   where f.uploaded_by = auth.uid() and f.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many uploads in an hour. Try again later.' using errcode = 'P0001';
  end if;

  -- the company's Code of Discipline: HR only, a PDF, not in anyone's folder
  if p_purpose = 'policy' then
    if not v_hr then
      raise exception 'Only HR uploads the Code of Discipline' using errcode = '42501';
    end if;
    v_key := 'company/code-of-discipline/' || to_char(v_now, 'YYYY-MM-DD') || '_code-of-discipline_' || v_rand || '.pdf';
    insert into public.stored_files (object_key, employee_id, purpose, folder, content_type, max_bytes, uploaded_by)
    values (v_key, null, 'policy', 'code-of-discipline', p_content_type, (v_rule ->> 'max_bytes')::integer, auth.uid())
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'key', v_key, 'content_type', p_content_type,
                              'max_bytes', (v_rule ->> 'max_bytes')::integer);
  end if;

  if p_purpose = 'document' then
    select * into dt from public.document_types where id = p_document_type_id and is_active;
    if not found then
      raise exception 'Choose the kind of document' using errcode = '22023';
    end if;
    if not v_hr and not dt.employee_can_upload then
      raise exception 'Bring this document to the HR office' using errcode = 'P0001';
    end if;
    v_folder := dt.storage_folder;
    v_label := public.storage_slug(dt.code);
  elsif p_purpose = 'leave' then
    v_folder := 'leave';
    v_label := 'leave-attachment';
  elsif p_purpose = 'attendance' then
    if p_kind is null or p_kind not in ('time_in', 'time_out') then
      raise exception 'Choose time in or time out' using errcode = '22023';
    end if;
    v_folder := 'attendance';
    v_label := replace(p_kind, '_', '-');
  else
    if not v_hr then
      raise exception 'Only HR stores certificates' using errcode = '42501';
    end if;
    select * into c from public.certificates where id = p_certificate_id;
    if not found then
      raise exception 'Certificate not found' using errcode = 'P0002';
    end if;
    v_folder := 'certificates';
  end if;

  if p_purpose = 'certificate' then
    select * into e from public.employees where id = c.employee_id;
  elsif v_hr and p_purpose <> 'attendance' and p_employee_id is not null then
    select * into e from public.employees where id = p_employee_id;
  elsif p_purpose = 'attendance' and p_employee_id is not null and p_employee_id is distinct from v_me
        and v_me is not null and public.supervises(p_employee_id) then
    -- a commander taking the photo of a guard at their post who has no phone (log_attendance_for)
    select * into e from public.employees where id = p_employee_id;
  else
    if p_employee_id is not null and p_employee_id is distinct from v_me then
      raise exception 'You can only upload your own files' using errcode = '42501';
    end if;
    select * into e from public.employees where id = v_me;
  end if;
  if e.id is null then
    raise exception 'There is no employee record for this file' using errcode = '42501';
  end if;
  if not v_hr and e.status in ('resigned', 'terminated', 'end_of_contract', 'retired') then
    raise exception 'Your employment record is closed. Ask HR.' using errcode = 'P0001';
  end if;

  v_ext := case p_content_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
                               when 'image/webp' then 'webp' else 'heic' end;
  v_key := public.employee_storage_folder(e.id) || '/' || v_folder || '/' || case p_purpose
    when 'attendance' then to_char(v_now, 'YYYY/MM/YYYY-MM-DD_HH24MI') || '_' || v_label || '_' || v_rand || '.' || v_ext
    when 'certificate' then coalesce(nullif(trim(both '-' from regexp_replace(c.certificate_no, '[^A-Za-z0-9-]+', '-', 'g')), ''),
                                     c.id::text) || '.pdf'
    else to_char(v_now, 'YYYY-MM-DD') || '_' || v_label || '_' || v_rand || '.' || v_ext
  end;

  -- a certificate keeps one key: making its PDF again replaces the file (S3 versioning keeps the old one)
  insert into public.stored_files as f (object_key, employee_id, purpose, folder, document_type_id, certificate_id,
                                        content_type, max_bytes, uploaded_by)
  values (v_key, e.id, p_purpose, v_folder, dt.id, c.id, p_content_type, (v_rule ->> 'max_bytes')::integer, auth.uid())
  on conflict (object_key) do update
    set status = 'pending', content_type = excluded.content_type, size_bytes = null, stored_at = null,
        uploaded_by = excluded.uploaded_by, created_at = now()
    where f.purpose = 'certificate'
  returning f.id into v_id;
  if v_id is null then
    raise exception 'Try the upload again' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', v_id, 'key', v_key, 'content_type', p_content_type,
                            'max_bytes', (v_rule ->> 'max_bytes')::integer);
end $$;

-- Step 2, the files Edge Function only (service role): S3 has the file, so it may be linked
create or replace function public.finish_file_upload(p_file_id uuid, p_size_bytes bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.stored_files;
begin
  if not public.is_trusted() then
    raise exception 'Only the files service records uploads' using errcode = '42501';
  end if;
  update public.stored_files set status = 'stored', size_bytes = p_size_bytes, stored_at = now()
  where id = p_file_id and status = 'pending' and p_size_bytes between 1 and max_bytes
  returning * into f;
  if not found then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', f.id, 'key', f.object_key, 'content_type', f.content_type, 'size_bytes', f.size_bytes);
end $$;

-- Which of these S3 keys the signed-in person may open. The same rules the storage buckets had: staff
-- open employees' files (certificates: HR only), employees their own (documents only of the types
-- shown to them), and commanders the selfies of time ins and outs at their posts.
create or replace function public.authorize_file_reads(p_keys text[])
returns table (object_key text, file_name text, content_type text)
language sql stable security definer set search_path = '' as $$
  select f.object_key, regexp_replace(f.object_key, '^.*/', ''), f.content_type
  from public.stored_files f
  where auth.uid() is not null and f.status = 'stored'
    and f.object_key = any (p_keys[1:200])
    and (
      (f.purpose = 'certificate' and public.is_hr())
      or (f.purpose <> 'certificate' and public.is_staff())
      or (f.employee_id = public.current_employee_id()
          and (f.purpose <> 'document'
               or exists (select 1 from public.document_types dt where dt.id = f.document_type_id and dt.visible_to_employee)))
      or (f.purpose = 'attendance' and exists (
            select 1 from public.attendance_logs a
            where a.photo_path = f.object_key and a.site_id = any (public.my_supervised_site_ids())))
      -- every employee may read the Code of Discipline in force
      or (f.purpose = 'policy' and public.current_employee_id() is not null and exists (
            select 1 from public.discipline_codes c where c.file_key = f.object_key and c.status = 'active'))
    )
$$;

-- First administrator. Run once in the SQL editor:
--   select public.bootstrap_super_admin('you@company.ph', 'Your Name');
create or replace function public.bootstrap_super_admin(p_email text, p_full_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_user uuid;
  v_code text;
begin
  if exists (select 1 from public.user_roles where role = 'super_admin') then
    raise exception 'A super admin already exists. Invite more people from the portal (Users).';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    insert into public.profiles (id, full_name, email) values (v_user, p_full_name, v_email)
    on conflict (id) do update set full_name = excluded.full_name;
    insert into public.user_roles (user_id, role) values (v_user, 'super_admin') on conflict do nothing;
    return 'Done. ' || v_email || ' is the super admin. Sign in to the portal with that account.';
  end if;
  v_code := public.random_code(4) || '-' || public.random_code(4);
  insert into public.staff_invitations (email, full_name, roles, code, expires_at)
  values (v_email, p_full_name, array['super_admin']::public.app_role[], v_code, now() + interval '7 days')
  on conflict (email) do update
    set full_name = excluded.full_name, roles = excluded.roles, code = excluded.code,
        expires_at = excluded.expires_at, accepted_at = null, accepted_user_id = null;
  return 'Invitation code ' || v_code || '. Open the portal, choose "Set up your account", enter ' || v_email || ' and this code.';
end $$;

create or replace function public.invite_staff(p_email text, p_full_name text, p_roles public.app_role[], p_employee_id uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_code text := public.random_code(4) || '-' || public.random_code(4);
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can invite people' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if cardinality(p_roles) = 0 then
    raise exception 'Choose at least one role' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'This email already has an account. Change its roles instead.' using errcode = 'P0001';
  end if;
  insert into public.staff_invitations (email, full_name, roles, code, employee_id, invited_by, expires_at)
  values (v_email, trim(p_full_name), p_roles, v_code, p_employee_id, auth.uid(), now() + interval '14 days')
  on conflict (email) do update
    set full_name = excluded.full_name, roles = excluded.roles, code = excluded.code, employee_id = excluded.employee_id,
        invited_by = excluded.invited_by, expires_at = excluded.expires_at, accepted_at = null, accepted_user_id = null;
  return v_code;
end $$;

create or replace function public.set_user_roles(p_user_id uuid, p_roles public.app_role[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only a super admin can change roles' using errcode = '42501';
  end if;
  if not ('super_admin' = any (p_roles))
     and exists (select 1 from public.user_roles where user_id = p_user_id and role = 'super_admin')
     and (select count(*) from public.user_roles where role = 'super_admin') = 1 then
    raise exception 'Keep at least one super admin' using errcode = 'P0001';
  end if;
  delete from public.user_roles
  where user_id = p_user_id and role <> all (p_roles)
    and not (role = 'employee' and exists (select 1 from public.employees e where e.user_id = p_user_id));
  insert into public.user_roles (user_id, role, granted_by)
  select p_user_id, r, auth.uid() from unnest(p_roles) r
  on conflict do nothing;
end $$;

-- Staff list for the Users screen
create or replace function public.list_users() returns table (
  user_id uuid, email text, full_name text, roles public.app_role[], employee_id uuid,
  last_sign_in_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text, p.full_name,
         coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = u.id), '{}'),
         (select e.id from public.employees e where e.user_id = u.id),
         u.last_sign_in_at, u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where public.is_admin()
    and exists (select 1 from public.user_roles ur where ur.user_id = u.id and ur.role <> 'employee')
  order by p.full_name nulls last
$$;

-- A temporary password, for staff who forgot theirs or employees without email.
-- The person is asked to choose a new one at the next sign-in.
create or replace function public.admin_reset_password(p_user_id uuid, p_temp_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_is_staff boolean := exists (select 1 from public.user_roles where user_id = p_user_id and role <> 'employee');
begin
  if not (public.is_admin() or (public.is_hr() and not v_is_staff)) then
    raise exception 'Only a super admin can reset a staff password' using errcode = '42501';
  end if;
  if length(coalesce(p_temp_password, '')) < 8 then
    raise exception 'Use at least 8 characters' using errcode = '22023';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  update public.profiles set must_change_password = true where id = p_user_id;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user_id;
  end if;
  insert into public.audit_log (actor_id, action, table_name, record_id, note)
  values (auth.uid(), 'RESET_PASSWORD', 'auth.users', p_user_id::text, 'Temporary password set');
end $$;

-- Government numbers: each staff view is written to the audit log
create or replace function public.get_government_ids(p_employee_id uuid)
returns table (sss_no text, philhealth_no text, pagibig_no text, tin text, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_hr() or public.is_payroll() or p_employee_id = public.current_employee_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_employee_id is distinct from public.current_employee_id() then
    insert into public.audit_log (actor_id, action, table_name, record_id, note)
    values (auth.uid(), 'VIEW', 'employee_government_ids', p_employee_id::text, 'Viewed government numbers');
  end if;
  return query
    select g.sss_no, g.philhealth_no, g.pagibig_no, g.tin, g.updated_at
    from public.employee_government_ids g where g.employee_id = p_employee_id;
end $$;

create or replace function public.save_government_ids(p_employee_id uuid, p_sss text, p_philhealth text, p_pagibig text, p_tin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_hr() or public.is_payroll()) then
    raise exception 'Only HR or payroll can change government numbers' using errcode = '42501';
  end if;
  insert into public.employee_government_ids (employee_id, sss_no, philhealth_no, pagibig_no, tin, updated_by)
  values (p_employee_id, nullif(trim(p_sss), ''), nullif(trim(p_philhealth), ''), nullif(trim(p_pagibig), ''), nullif(trim(p_tin), ''), auth.uid())
  on conflict (employee_id) do update
    set sss_no = excluded.sss_no, philhealth_no = excluded.philhealth_no, pagibig_no = excluded.pagibig_no,
        tin = excluded.tin, updated_by = excluded.updated_by;
end $$;

-- Deployment: move employees to a post, or to floating (reserve) status with p_site_id null
-- Deploy guards to a post (no post: floating). The employees trigger closes each guard's open
-- assignment and opens one at the post; p_duty_hours and p_shift_start set its duty (else the post's).
drop function if exists public.deploy_employees(uuid[], uuid);
create or replace function public.deploy_employees(p_employee_ids uuid[], p_site_id uuid,
  p_duty_hours integer default null, p_shift_start time default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  s public.sites;
begin
  if not (public.is_ops() or public.is_hr()) then
    raise exception 'Operations or HR only' using errcode = '42501';
  end if;
  if p_duty_hours is not null and p_duty_hours not in (8, 12, 24) then
    raise exception 'A duty is 8, 12 or 24 hours' using errcode = '22023';
  end if;
  if p_site_id is null then
    update public.employees set status = 'floating', site_id = null
    where id = any (p_employee_ids) and status in ('active', 'floating');
    get diagnostics n = row_count;
    return n;
  end if;
  select * into s from public.sites where id = p_site_id and is_active;
  if not found then
    raise exception 'Post not found or inactive' using errcode = 'P0002';
  end if;
  update public.employees
  set site_id = s.id, area_id = coalesce(s.area_id, area_id),
      status = case when status = 'floating' then 'active' else status end
  where id = any (p_employee_ids) and status in ('active', 'floating', 'on_leave', 'suspended');
  get diagnostics n = row_count;
  if p_duty_hours is not null or p_shift_start is not null then
    update public.employee_assignments a
    set duty_hours = coalesce(p_duty_hours, a.duty_hours), shift_start = coalesce(p_shift_start, a.shift_start)
    where a.employee_id = any (p_employee_ids) and a.site_id = s.id and a.end_date is null;
  end if;
  insert into public.notifications (user_id, title, body, kind, link)
  select e.user_id, 'New post assignment', s.name || coalesce(' · ' || s.city, ''), 'deployment', jsonb_build_object('screen', 'Profile')
  from public.employees e where e.id = any (p_employee_ids) and e.user_id is not null and e.site_id = s.id;
  return n;
end $$;

-- Payroll picks a post's pay rule (null: the client's default); operations keeps the rest of the post
create or replace function public.set_site_pay_rule(p_site_id uuid, p_pay_rule_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.sites;
  r public.pay_rules;
begin
  if not public.is_payroll() then
    raise exception 'Payroll only' using errcode = '42501';
  end if;
  select * into s from public.sites where id = p_site_id;
  if not found then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if p_pay_rule_id is not null then
    select * into r from public.pay_rules where id = p_pay_rule_id;
    if not found then
      raise exception 'Pay rule not found' using errcode = 'P0002';
    end if;
    if r.client_id is not null and r.client_id is distinct from s.client_id then
      raise exception 'That pay rule belongs to another client' using errcode = 'P0001';
    end if;
  end if;
  update public.sites set pay_rule_id = p_pay_rule_id where id = p_site_id;
end $$;

-- Payroll import: rows from the payroll file, matched by employee number.
-- Extra columns named "earning: Uniform allowance" or "deduction: Cash advance" become payslip lines.
create or replace function public.import_payslips(p_period_id uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  per public.payroll_periods;
  rec jsonb;
  idx integer := 0;
  v_emp uuid;
  v_no text;
  v_existing boolean;
  vals jsonb;
  f text;
  k text;
  v_amount numeric;
  e_detail jsonb;
  d_detail jsonb;
  e_extra numeric;
  d_extra numeric;
  g numeric;
  d numeric;
  n numeric;
  n_ins integer := 0;
  n_upd integer := 0;
  errors jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  num_fields constant text[] := array['days_worked', 'hours_worked', 'overtime_hours', 'night_diff_hours', 'basic_pay',
    'overtime_pay', 'night_diff_pay', 'holiday_pay', 'allowances', 'other_earnings', 'gross_pay', 'sss', 'philhealth',
    'pagibig', 'withholding_tax', 'loans', 'other_deductions', 'total_deductions', 'net_pay'];
begin
  if not public.is_payroll() then
    raise exception 'Only payroll can import payslips' using errcode = '42501';
  end if;
  select * into per from public.payroll_periods where id = p_period_id for update;
  if not found then
    raise exception 'Payroll period not found' using errcode = 'P0002';
  end if;
  if per.status <> 'draft' then
    raise exception 'This cutoff is published. Unpublish it before importing again.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a list' using errcode = '22023';
  end if;

  for rec in select value from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    v_no := upper(trim(coalesce(rec ->> 'employee_no', '')));
    if v_no = '' then
      errors := errors || jsonb_build_object('row', idx, 'message', 'Missing employee number');
      continue;
    end if;
    select id into v_emp from public.employees where employee_no = v_no;
    if v_emp is null then
      errors := errors || jsonb_build_object('row', idx, 'employee_no', v_no, 'message', 'No employee with this number');
      continue;
    end if;

    begin
      vals := '{}'::jsonb;
      foreach f in array num_fields loop
        if nullif(trim(coalesce(rec ->> f, '')), '') is not null then
          vals := vals || jsonb_build_object(f, round(replace(rec ->> f, ',', '')::numeric, 2));
        end if;
      end loop;
      e_detail := '[]'::jsonb;
      d_detail := '[]'::jsonb;
      e_extra := 0;
      d_extra := 0;
      for k in select jsonb_object_keys(rec) loop
        if k ~* '^(earning|deduction)\s*:' and nullif(trim(coalesce(rec ->> k, '')), '') is not null then
          v_amount := round(replace(rec ->> k, ',', '')::numeric, 2);
          if v_amount <> 0 then
            if k ~* '^earning' then
              e_detail := e_detail || jsonb_build_object('label', trim(regexp_replace(k, '^[^:]*:', '')), 'amount', v_amount);
              e_extra := e_extra + v_amount;
            else
              d_detail := d_detail || jsonb_build_object('label', trim(regexp_replace(k, '^[^:]*:', '')), 'amount', v_amount);
              d_extra := d_extra + v_amount;
            end if;
          end if;
        end if;
      end loop;
    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'employee_no', v_no, 'message', 'A pay or hours column is not a number');
      continue;
    end;

    if not (vals ? 'other_earnings') and e_extra <> 0 then vals := vals || jsonb_build_object('other_earnings', e_extra); end if;
    if not (vals ? 'other_deductions') and d_extra <> 0 then vals := vals || jsonb_build_object('other_deductions', d_extra); end if;

    g := coalesce((vals ->> 'gross_pay')::numeric,
      coalesce((vals ->> 'basic_pay')::numeric, 0) + coalesce((vals ->> 'overtime_pay')::numeric, 0)
      + coalesce((vals ->> 'night_diff_pay')::numeric, 0) + coalesce((vals ->> 'holiday_pay')::numeric, 0)
      + coalesce((vals ->> 'allowances')::numeric, 0) + coalesce((vals ->> 'other_earnings')::numeric, 0));
    d := coalesce((vals ->> 'total_deductions')::numeric,
      coalesce((vals ->> 'sss')::numeric, 0) + coalesce((vals ->> 'philhealth')::numeric, 0)
      + coalesce((vals ->> 'pagibig')::numeric, 0) + coalesce((vals ->> 'withholding_tax')::numeric, 0)
      + coalesce((vals ->> 'loans')::numeric, 0) + coalesce((vals ->> 'other_deductions')::numeric, 0));
    n := coalesce((vals ->> 'net_pay')::numeric, g - d);
    if abs((g - d) - n) > 0.05 then
      warnings := warnings || jsonb_build_object('row', idx, 'employee_no', v_no,
        'message', format('Net pay %s is not gross %s minus deductions %s', n, g, d));
    end if;
    if n < 0 then
      warnings := warnings || jsonb_build_object('row', idx, 'employee_no', v_no, 'message', 'Net pay is below zero');
    end if;

    v_existing := exists (select 1 from public.payslips where payroll_period_id = p_period_id and employee_id = v_emp);
    insert into public.payslips (payroll_period_id, employee_id, site_name, days_worked, hours_worked, overtime_hours,
      night_diff_hours, basic_pay, overtime_pay, night_diff_pay, holiday_pay, allowances, other_earnings, gross_pay,
      sss, philhealth, pagibig, withholding_tax, loans, other_deductions, total_deductions, net_pay,
      earnings_detail, deductions_detail, remarks)
    values (p_period_id, v_emp, nullif(trim(coalesce(rec ->> 'site_name', '')), ''),
      coalesce((vals ->> 'days_worked')::numeric, 0), coalesce((vals ->> 'hours_worked')::numeric, 0),
      coalesce((vals ->> 'overtime_hours')::numeric, 0), coalesce((vals ->> 'night_diff_hours')::numeric, 0),
      coalesce((vals ->> 'basic_pay')::numeric, 0), coalesce((vals ->> 'overtime_pay')::numeric, 0),
      coalesce((vals ->> 'night_diff_pay')::numeric, 0), coalesce((vals ->> 'holiday_pay')::numeric, 0),
      coalesce((vals ->> 'allowances')::numeric, 0), coalesce((vals ->> 'other_earnings')::numeric, 0), g,
      coalesce((vals ->> 'sss')::numeric, 0), coalesce((vals ->> 'philhealth')::numeric, 0),
      coalesce((vals ->> 'pagibig')::numeric, 0), coalesce((vals ->> 'withholding_tax')::numeric, 0),
      coalesce((vals ->> 'loans')::numeric, 0), coalesce((vals ->> 'other_deductions')::numeric, 0), d, n,
      e_detail, d_detail, nullif(trim(coalesce(rec ->> 'remarks', '')), ''))
    on conflict (payroll_period_id, employee_id) do update set
      site_name = excluded.site_name, days_worked = excluded.days_worked, hours_worked = excluded.hours_worked,
      overtime_hours = excluded.overtime_hours, night_diff_hours = excluded.night_diff_hours,
      basic_pay = excluded.basic_pay, overtime_pay = excluded.overtime_pay, night_diff_pay = excluded.night_diff_pay,
      holiday_pay = excluded.holiday_pay, allowances = excluded.allowances, other_earnings = excluded.other_earnings,
      gross_pay = excluded.gross_pay, sss = excluded.sss, philhealth = excluded.philhealth, pagibig = excluded.pagibig,
      withholding_tax = excluded.withholding_tax, loans = excluded.loans, other_deductions = excluded.other_deductions,
      total_deductions = excluded.total_deductions, net_pay = excluded.net_pay,
      earnings_detail = excluded.earnings_detail, deductions_detail = excluded.deductions_detail, remarks = excluded.remarks;
    if v_existing then n_upd := n_upd + 1; else n_ins := n_ins + 1; end if;
  end loop;

  insert into public.audit_log (actor_id, action, table_name, record_id, note)
  values (auth.uid(), 'IMPORT', 'payslips', p_period_id::text,
          format('%s new, %s updated, %s errors', n_ins, n_upd, jsonb_array_length(errors)));
  return jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'errors', errors, 'warnings', warnings);
end $$;

create or replace function public.publish_payroll_period(p_period_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  per public.payroll_periods;
  n integer;
begin
  if not public.is_payroll() then
    raise exception 'Only payroll can publish payslips' using errcode = '42501';
  end if;
  update public.payroll_periods
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = p_period_id and status = 'draft'
  returning * into per;
  if not found then
    raise exception 'Cutoff not found or already published' using errcode = 'P0001';
  end if;
  -- the amount stays off the notification: phones show it on the lock screen
  insert into public.notifications (user_id, title, body, kind, link)
  select e.user_id, 'Your payslip is ready', per.label, 'payslip', jsonb_build_object('screen', 'Payslip', 'id', p.id)
  from public.payslips p
  join public.employees e on e.id = p.employee_id
  where p.payroll_period_id = per.id and e.user_id is not null;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.unpublish_payroll_period(p_period_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_payroll() then
    raise exception 'Only payroll can unpublish payslips' using errcode = '42501';
  end if;
  update public.payroll_periods set status = 'draft', published_at = null, published_by = null
  where id = p_period_id and status = 'published';
  if not found then
    raise exception 'Cutoff not found or not published' using errcode = 'P0001';
  end if;
end $$;

-- Leave approvals: the detachment commander endorses (and names a reliever), HR approves
create or replace function public.decide_leave_request(p_request_id uuid, p_approve boolean, p_note text default null, p_reliever_id uuid default null)
returns public.leave_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  v_name text;
  v_type text;
  v_when text;
  v_link jsonb;
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  select public.full_name(e) into v_name from public.employees e where e.id = r.employee_id;
  select name into v_type from public.leave_types where id = r.leave_type_id;
  v_when := public.date_range_label(r.start_date, r.end_date);
  v_link := jsonb_build_object('screen', 'LeaveRequest', 'id', r.id);
  if p_reliever_id is not null and p_reliever_id = r.employee_id then
    raise exception 'The reliever must be another guard' using errcode = '22023';
  end if;

  if r.status = 'pending_supervisor' then
    if not (public.supervises(r.employee_id) or public.is_hr() or public.is_ops()) then
      raise exception 'You do not supervise this employee' using errcode = '42501';
    end if;
    if p_approve then
      update public.leave_requests
      set status = 'pending_hr', reliever_employee_id = p_reliever_id, supervisor_id = auth.uid(),
          supervisor_decided_at = now(), supervisor_note = p_note
      where id = r.id returning * into r;
      perform public.notify_employee(r.employee_id, 'Leave endorsed to HR', v_type || ' · ' || v_when, 'leave', v_link);
      perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'Leave for HR approval',
        v_name || ' · ' || v_type || ' · ' || v_when, 'leave_request', v_link);
    else
      update public.leave_requests
      set status = 'rejected', supervisor_id = auth.uid(), supervisor_decided_at = now(), supervisor_note = p_note
      where id = r.id returning * into r;
      perform public.notify_employee(r.employee_id, 'Leave not endorsed', coalesce(p_note, v_type || ' · ' || v_when), 'leave', v_link);
    end if;
  elsif r.status = 'pending_hr' then
    if not public.is_hr() then
      raise exception 'Only HR gives the final approval' using errcode = '42501';
    end if;
    if p_approve then
      update public.leave_requests
      set status = 'approved', hr_id = auth.uid(), hr_decided_at = now(), hr_note = p_note,
          reliever_employee_id = coalesce(p_reliever_id, reliever_employee_id)
      where id = r.id returning * into r;
      perform public.notify_employee(r.employee_id, 'Leave approved', v_type || ' · ' || v_when, 'leave', v_link);
      if r.reliever_employee_id is not null then
        perform public.notify_employee(r.reliever_employee_id, 'You are the reliever',
          'For ' || v_name || ' · ' || v_when, 'reliever', v_link);
      end if;
    else
      update public.leave_requests
      set status = 'rejected', hr_id = auth.uid(), hr_decided_at = now(), hr_note = p_note
      where id = r.id returning * into r;
      perform public.notify_employee(r.employee_id, 'Leave not approved', coalesce(p_note, v_type || ' · ' || v_when), 'leave', v_link);
    end if;
  else
    raise exception 'This request is already %', replace(r.status, '_', ' ') using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.cancel_leave_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request_id for update;
  if not found or r.employee_id is distinct from public.current_employee_id() then
    raise exception 'Leave request not found' using errcode = 'P0002';
  end if;
  if r.status in ('pending_supervisor', 'pending_hr') or (r.status = 'approved' and r.start_date > current_date) then
    update public.leave_requests set status = 'cancelled' where id = r.id;
    if r.status = 'approved' then
      perform public.notify_roles(array['hr_admin', 'hr_staff']::public.app_role[], 'Approved leave cancelled',
        (select public.full_name(e) from public.employees e where e.id = r.employee_id) || ' · ' || public.date_range_label(r.start_date, r.end_date),
        'leave_request', jsonb_build_object('screen', 'LeaveRequest', 'id', r.id));
    end if;
  else
    raise exception 'This leave can no longer be cancelled' using errcode = 'P0001';
  end if;
end $$;

-- Certificates of employment
create or replace function public.issue_certificate(p_request_id uuid, p_signatory_name text, p_signatory_title text, p_compensation_text text default null)
returns public.certificates language plpgsql security definer set search_path = '' as $$
declare
  r public.coe_requests;
  e public.employees;
  c public.certificates;
  v_code text;
  tries integer := 0;
begin
  if not public.is_hr() then
    raise exception 'Only HR can issue certificates' using errcode = '42501';
  end if;
  select * into r from public.coe_requests where id = p_request_id for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request is already %', r.status using errcode = 'P0001';
  end if;
  if coalesce(trim(p_signatory_name), '') = '' or coalesce(trim(p_signatory_title), '') = '' then
    raise exception 'Enter the name and title of the person who signs' using errcode = '22023';
  end if;
  if r.include_compensation and coalesce(trim(p_compensation_text), '') = '' then
    raise exception 'This request asks for compensation. Enter it before issuing.' using errcode = '22023';
  end if;
  select * into e from public.employees where id = r.employee_id;
  loop
    v_code := public.random_code(4) || '-' || public.random_code(4) || '-' || public.random_code(4);
    exit when not exists (select 1 from public.certificates where verification_code = v_code);
    tries := tries + 1;
    if tries > 5 then
      raise exception 'Could not make a unique code, try again';
    end if;
  end loop;
  insert into public.certificates (certificate_no, verification_code, employee_id, coe_request_id, employee_name, position,
    date_hired, date_separated, employment_status, purpose, include_compensation, compensation_text,
    signatory_name, signatory_title, issued_by)
  values ('COE-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.certificate_no_seq')::text, 6, '0'),
    v_code, e.id, r.id, public.full_name(e), e.position, e.date_hired, e.date_separated, e.status, r.purpose,
    r.include_compensation, case when r.include_compensation then trim(p_compensation_text) end,
    trim(p_signatory_name), trim(p_signatory_title), auth.uid())
  returning * into c;
  update public.coe_requests set status = 'issued', certificate_id = c.id, decided_by = auth.uid(), decided_at = now()
  where id = r.id;
  perform public.notify_employee(e.id, 'Your certificate of employment is ready', c.certificate_no, 'coe',
    jsonb_build_object('screen', 'Certificate', 'id', c.id));
  return c;
end $$;

-- A walk-in request: HR files it for the employee and issues it in one step
create or replace function public.issue_certificate_for(p_employee_id uuid, p_purpose text, p_include_compensation boolean,
  p_signatory_name text, p_signatory_title text, p_compensation_text text default null, p_purpose_details text default null)
returns public.certificates language plpgsql security definer set search_path = '' as $$
declare
  v_request uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can issue certificates' using errcode = '42501';
  end if;
  insert into public.coe_requests (employee_id, purpose, purpose_details, include_compensation)
  values (p_employee_id, p_purpose, p_purpose_details, coalesce(p_include_compensation, false))
  returning id into v_request;
  return public.issue_certificate(v_request, p_signatory_name, p_signatory_title, p_compensation_text);
end $$;

create or replace function public.attach_certificate_file(p_certificate_id uuid, p_path text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can attach certificate files' using errcode = '42501';
  end if;
  if p_path like 'employees/%' and not exists (
      select 1 from public.stored_files f
      where f.object_key = p_path and f.purpose = 'certificate' and f.status = 'stored' and f.certificate_id = p_certificate_id) then
    raise exception 'The certificate PDF did not arrive. Make it again.' using errcode = 'P0001';
  end if;
  update public.certificates set file_path = p_path where id = p_certificate_id;
  if not found then
    raise exception 'Certificate not found' using errcode = 'P0002';
  end if;
end $$;

create or replace function public.reject_coe_request(p_request_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.coe_requests;
begin
  if not public.is_hr() then
    raise exception 'Only HR can decline requests' using errcode = '42501';
  end if;
  update public.coe_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = p_request_id and status = 'pending' returning * into r;
  if not found then
    raise exception 'Request not found or already decided' using errcode = 'P0001';
  end if;
  perform public.notify_employee(r.employee_id, 'COE request declined', coalesce(p_note, ''), 'coe',
    jsonb_build_object('screen', 'CoeRequest', 'id', r.id));
end $$;

create or replace function public.cancel_coe_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.coe_requests set status = 'cancelled'
  where id = p_request_id and status = 'pending' and employee_id = public.current_employee_id();
  if not found then
    raise exception 'Request not found or already decided' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.revoke_certificate(p_certificate_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_hr() then
    raise exception 'Only HR can revoke certificates' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  update public.certificates set revoked_at = now(), revoked_reason = trim(p_reason)
  where id = p_certificate_id and revoked_at is null;
  if not found then
    raise exception 'Certificate not found or already revoked' using errcode = 'P0001';
  end if;
end $$;

-- The website's "Check a certificate" page. Shows only what the certificate itself says.
create or replace function public.verify_certificate(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.certificates;
begin
  if length(v) <> 12 then
    return jsonb_build_object('status', 'invalid_format');
  end if;
  v := substr(v, 1, 4) || '-' || substr(v, 5, 4) || '-' || substr(v, 9, 4);
  select * into c from public.certificates where verification_code = v;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  return jsonb_build_object(
    'status', case when c.revoked_at is not null then 'revoked' else 'valid' end,
    'certificate_no', c.certificate_no,
    'employee_name', c.employee_name,
    'position', c.position,
    'date_hired', c.date_hired,
    'date_separated', c.date_separated,
    'issued_at', c.issued_at,
    'revoked_at', c.revoked_at);
end $$;

create or replace function public.decide_profile_change(p_request_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.profile_change_requests;
  c jsonb;
begin
  if not public.is_hr() then
    raise exception 'Only HR can update employee details' using errcode = '42501';
  end if;
  select * into r from public.profile_change_requests where id = p_request_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'Request not found or already decided' using errcode = 'P0001';
  end if;
  c := r.changes;
  if p_approve then
    update public.employees set
      mobile_no = case when c ? 'mobile_no' then c ->> 'mobile_no' else mobile_no end,
      email = case when c ? 'email' then c ->> 'email' else email end,
      present_address = case when c ? 'present_address' then c ->> 'present_address' else present_address end,
      provincial_address = case when c ? 'provincial_address' then c ->> 'provincial_address' else provincial_address end,
      civil_status = case when c ? 'civil_status' then c ->> 'civil_status' else civil_status end,
      emergency_contact_name = case when c ? 'emergency_contact_name' then c ->> 'emergency_contact_name' else emergency_contact_name end,
      emergency_contact_relation = case when c ? 'emergency_contact_relation' then c ->> 'emergency_contact_relation' else emergency_contact_relation end,
      emergency_contact_phone = case when c ? 'emergency_contact_phone' then c ->> 'emergency_contact_phone' else emergency_contact_phone end
    where id = r.employee_id;
  end if;
  update public.profile_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note
  where id = r.id;
  perform public.notify_employee(r.employee_id,
    case when p_approve then 'Your details are updated' else 'Detail change not approved' end,
    coalesce(p_note, ''), 'profile_change', jsonb_build_object('screen', 'Profile'));
end $$;

-- Announcements
create or replace function public.can_see_announcement(p_status text, p_expires_at timestamptz, p_audience text, p_area_ids uuid[], p_site_ids uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select p_status = 'published'
    and (p_expires_at is null or p_expires_at > now())
    and exists (
      select 1 from public.employees e
      where e.user_id = auth.uid()
        and e.status in ('active', 'floating', 'on_leave', 'suspended')
        and (p_audience = 'all'
          or (p_audience = 'areas' and e.area_id = any (p_area_ids))
          or (p_audience = 'sites' and e.site_id = any (p_site_ids))))
$$;

create or replace function public.mark_announcement_read(p_announcement_id uuid, p_acknowledge boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_emp uuid := public.current_employee_id();
  a public.announcements;
begin
  select * into a from public.announcements where id = p_announcement_id;
  if v_emp is null or not found
     or not public.can_see_announcement(a.status, a.expires_at, a.audience, a.area_ids, a.site_ids) then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  insert into public.announcement_receipts (announcement_id, employee_id, read_at, acknowledged_at)
  values (a.id, v_emp, now(), case when p_acknowledge then now() end)
  on conflict (announcement_id, employee_id) do update
    set acknowledged_at = coalesce(public.announcement_receipts.acknowledged_at, excluded.acknowledged_at);
end $$;

create or replace function public.announcement_stats(p_announcement_id uuid)
returns table (audience_count integer, read_count integer, acknowledged_count integer)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*) from public.employees e
      where e.status in ('active', 'floating', 'on_leave', 'suspended')
        and (a.audience = 'all' or (a.audience = 'areas' and e.area_id = any (a.area_ids))
          or (a.audience = 'sites' and e.site_id = any (a.site_ids))))::integer,
    (select count(*) from public.announcement_receipts r where r.announcement_id = a.id)::integer,
    (select count(*) from public.announcement_receipts r where r.announcement_id = a.id and r.acknowledged_at is not null)::integer
  from public.announcements a
  where a.id = p_announcement_id and public.is_staff()
$$;

-- Recruitment: turn an application into an employee record
create or replace function public.hire_applicant(p_application_id uuid, p_employee_no text, p_date_hired date,
  p_position text default 'Security Guard', p_site_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.job_applications;
  v_emp uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR can hire' using errcode = '42501';
  end if;
  select * into a from public.job_applications where id = p_application_id for update;
  if not found then
    raise exception 'Application not found' using errcode = 'P0002';
  end if;
  if a.status = 'hired' then
    raise exception 'This applicant is already hired' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.employees where employee_no = upper(trim(p_employee_no))) then
    raise exception 'Employee number % is already used', upper(trim(p_employee_no)) using errcode = 'P0001';
  end if;
  insert into public.employees (employee_no, first_name, middle_name, last_name, birthdate, sex, mobile_no, email,
    present_address, position, employment_type, status, date_hired, site_id, area_id)
  values (p_employee_no, a.first_name, a.middle_name, a.last_name, a.birthdate, a.sex, a.mobile_no, a.email,
    concat_ws(', ', a.city, a.province), coalesce(nullif(trim(p_position), ''), 'Security Guard'), 'probationary',
    case when p_site_id is null then 'floating' else 'active' end, coalesce(p_date_hired, current_date), p_site_id,
    (select s.area_id from public.sites s where s.id = p_site_id))
  returning id into v_emp;
  if a.has_license and nullif(trim(a.license_no), '') is not null then
    insert into public.employee_documents (employee_id, document_type_id, document_no, expires_on, status, notes)
    select v_emp, dt.id, trim(a.license_no), a.license_expires_on, 'pending_review', 'From the online application. Check the original.'
    from public.document_types dt where dt.code = 'SECURITY_LICENSE';
  end if;
  update public.job_applications set status = 'hired', employee_id = v_emp, reviewed_by = auth.uid() where id = a.id;
  return v_emp;
end $$;

-- Reminders for documents about to expire. Schedule daily with pg_cron (see SETUP.md).
create or replace function public.send_document_expiry_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.notifications (user_id, title, body, kind, link)
  select e.user_id,
         case when da.days_left < 0 then da.type_name || ' has expired'
              when da.days_left = 0 then da.type_name || ' expires today'
              else da.type_name || ' expires in ' || da.days_left || ' days' end,
         'Renew it and send the new copy to HR.',
         'document_expiry',
         jsonb_build_object('screen', 'Documents', 'id', da.id)
  from public.document_alerts da
  join public.employees e on e.id = da.employee_id
  where e.user_id is not null and da.days_left in (60, 30, 14, 7, 1, 0, -1);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.portal_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Staff only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'employees_by_status', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) as n from public.employees group by status) s), '{}'::jsonb),
    'employees_current', (select count(*) from public.employees where status in ('active', 'floating', 'on_leave', 'suspended')),
    'sites_active', (select count(*) from public.sites where is_active),
    'guards_required', (select coalesce(sum(guards_required), 0) from public.sites where is_active),
    'guards_deployed', (select count(*) from public.employees e join public.sites s on s.id = e.site_id
                        where s.is_active and e.status in ('active', 'on_leave', 'suspended')),
    'sites_short', (select count(*) from public.site_staffing where is_active and guards_assigned < guards_required),
    'floating', (select count(*) from public.employees where status = 'floating'),
    'floating_over_150_days', (select count(*) from public.employees where status = 'floating' and floating_since <= current_date - 150),
    'leave_pending_supervisor', (select count(*) from public.leave_requests where status = 'pending_supervisor'),
    'leave_pending_hr', (select count(*) from public.leave_requests where status = 'pending_hr'),
    'on_leave_today', (select count(*) from public.leave_requests where status = 'approved' and current_date between start_date and end_date),
    'coe_pending', (select count(*) from public.coe_requests where status = 'pending'),
    'coe_overdue', (select count(*) from public.coe_requests where status = 'pending' and due_at < now()),
    'profile_changes_pending', (select count(*) from public.profile_change_requests where status = 'pending'),
    'payroll_concerns_open', (select count(*) from public.payroll_concerns where status in ('open', 'in_review')),
    'documents_expired', (select count(*) from public.document_alerts where state = 'expired'),
    'documents_expiring', (select count(*) from public.document_alerts where state = 'expiring'),
    'compliance_gaps', (select count(distinct employee_id) from public.compliance_gaps),
    'applications_new', (select count(*) from public.job_applications where status = 'new'),
    'inquiries_new', (select count(*) from public.inquiries where status = 'new'),
    'latest_period', (select to_jsonb(p) from (
        select id, label, status, pay_date,
               (select count(*) from public.payslips ps where ps.payroll_period_id = pp.id) as payslips
        from public.payroll_periods pp order by period_end desc limit 1) p)
  );
end $$;

-- -------------------------------------------------------------------------------------
-- 11. Row level security
-- -------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- drop this script's policies so a re-run always matches the file
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any (array[
      'areas', 'clients', 'sites', 'employees', 'employee_compensation', 'employee_government_ids', 'profiles',
      'user_roles', 'staff_invitations', 'site_supervisors', 'document_types', 'employee_documents', 'payroll_periods',
      'payslips', 'leave_types', 'leave_credits', 'leave_requests', 'coe_requests', 'certificates',
      'profile_change_requests', 'payroll_concerns', 'announcements', 'announcement_receipts', 'notifications',
      'device_tokens', 'job_openings', 'job_applications', 'inquiries', 'audit_log', 'pay_rules', 'pay_rates',
      'employee_assignments', 'activation_tickets', 'activation_attempts', 'attendance_logs', 'stored_files'])
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
  for r in select tablename from pg_tables where schemaname = 'public' and tablename = any (array[
      'areas', 'clients', 'sites', 'employees', 'employee_compensation', 'employee_government_ids', 'profiles',
      'user_roles', 'staff_invitations', 'site_supervisors', 'document_types', 'employee_documents', 'payroll_periods',
      'payslips', 'leave_types', 'leave_credits', 'leave_requests', 'coe_requests', 'certificates',
      'profile_change_requests', 'payroll_concerns', 'announcements', 'announcement_receipts', 'notifications',
      'device_tokens', 'job_openings', 'job_applications', 'inquiries', 'audit_log', 'pay_rules', 'pay_rates',
      'employee_assignments', 'activation_tickets', 'activation_attempts', 'attendance_logs', 'stored_files'])
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Reference data everyone signed in can read; HR or operations maintain it
create policy "read areas" on public.areas for select to authenticated using (not (select public.is_client_login()));
create policy "manage areas" on public.areas for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "staff read clients" on public.clients for select to authenticated using ((select public.is_staff()));
create policy "manage clients" on public.clients for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "read sites" on public.sites for select to authenticated
  using (not (select public.is_client_login()) or client_id = (select public.my_client_id()));
create policy "manage sites" on public.sites for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

-- Pay rules and rates: payroll keeps them, HR reads them
create policy "read pay rules" on public.pay_rules for select to authenticated
  using ((select public.is_payroll()) or (select public.is_hr()));
create policy "payroll manages pay rules" on public.pay_rules for all to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));
create policy "read pay rates" on public.pay_rates for select to authenticated
  using ((select public.is_payroll()) or (select public.is_hr()));
create policy "payroll manages pay rates" on public.pay_rates for all to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));

-- Assignment history: staff read it, the employee reads their own, commanders their posts';
-- HR and operations correct it
create policy "read assignments" on public.employee_assignments for select to authenticated
  using ((select public.is_staff()) or employee_id = (select public.current_employee_id())
         or site_id = any ((select public.my_supervised_site_ids())::uuid[]));
create policy "hr and operations manage assignments" on public.employee_assignments for all to authenticated
  using ((select public.is_hr()) or (select public.is_ops())) with check ((select public.is_hr()) or (select public.is_ops()));

create policy "read site supervisors" on public.site_supervisors for select to authenticated using (not (select public.is_client_login()));
create policy "manage site supervisors" on public.site_supervisors for all to authenticated
  using ((select public.is_ops())) with check ((select public.is_ops()));

create policy "read document types" on public.document_types for select to authenticated using (not (select public.is_client_login()));
create policy "manage document types" on public.document_types for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

create policy "read leave types" on public.leave_types for select to authenticated using (not (select public.is_client_login()));
create policy "manage leave types" on public.leave_types for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

-- Employees: staff see everyone, supervisors their posts, everyone else only themselves
create policy "read employees" on public.employees for select to authenticated
  using ((select public.is_staff()) or user_id = (select auth.uid())
         or site_id = any ((select public.my_supervised_site_ids())::uuid[]));
create policy "hr adds employees" on public.employees for insert to authenticated with check ((select public.is_hr()));
create policy "hr edits employees" on public.employees for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy "hr admin deletes employees" on public.employees for delete to authenticated
  using ((select public.has_any_role(array['super_admin', 'hr_admin']::public.app_role[])));

create policy "read compensation" on public.employee_compensation for select to authenticated
  using ((select public.is_payroll()) or employee_id = (select public.current_employee_id()));
create policy "payroll manages compensation" on public.employee_compensation for all to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));

-- Government numbers: the owner reads directly; staff go through get_government_ids()
create policy "owner reads government ids" on public.employee_government_ids for select to authenticated
  using (employee_id = (select public.current_employee_id()));

create policy "read profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "read roles" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_staff()));

create policy "admin manages invitations" on public.staff_invitations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Documents
create policy "read documents" on public.employee_documents for select to authenticated
  using ((select public.is_staff()) or public.supervises(employee_id)
         or (employee_id = (select public.current_employee_id())
             and exists (select 1 from public.document_types dt where dt.id = document_type_id and dt.visible_to_employee)));
create policy "add documents" on public.employee_documents for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy "hr edits documents" on public.employee_documents for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy "delete documents" on public.employee_documents for delete to authenticated
  using ((select public.is_hr())
         or (employee_id = (select public.current_employee_id()) and status = 'pending_review'));

-- Payroll: employees see their payslips once the cutoff is published
create policy "read payroll periods" on public.payroll_periods for select to authenticated
  using ((select public.is_payroll()) or status = 'published');
create policy "payroll manages periods" on public.payroll_periods for all to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));

create policy "read payslips" on public.payslips for select to authenticated
  using ((select public.is_payroll())
         or (employee_id = (select public.current_employee_id())
             and exists (select 1 from public.payroll_periods p where p.id = payroll_period_id and p.status = 'published')));
create policy "payroll manages payslips" on public.payslips for all to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));

-- Leave
create policy "read leave credits" on public.leave_credits for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()) or public.supervises(employee_id));
create policy "hr manages leave credits" on public.leave_credits for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

create policy "read leave requests" on public.leave_requests for select to authenticated
  using ((select public.is_hr()) or (select public.is_ops()) or (select public.has_any_role(array['management']::public.app_role[]))
         or employee_id = (select public.current_employee_id())
         or reliever_employee_id = (select public.current_employee_id())
         or site_id = any ((select public.my_supervised_site_ids())::uuid[]));
create policy "file leave" on public.leave_requests for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));

-- COE
create policy "read coe requests" on public.coe_requests for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy "request coe" on public.coe_requests for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));

create policy "read certificates" on public.certificates for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));

create policy "read profile changes" on public.profile_change_requests for select to authenticated
  using ((select public.is_hr()) or employee_id = (select public.current_employee_id()));
create policy "ask profile change" on public.profile_change_requests for insert to authenticated
  with check ((select public.is_hr()) or employee_id = (select public.current_employee_id()));

create policy "read payroll concerns" on public.payroll_concerns for select to authenticated
  using ((select public.is_payroll()) or employee_id = (select public.current_employee_id()));
create policy "raise payroll concern" on public.payroll_concerns for insert to authenticated
  with check ((select public.is_payroll()) or employee_id = (select public.current_employee_id()));
create policy "payroll handles concerns" on public.payroll_concerns for update to authenticated
  using ((select public.is_payroll())) with check ((select public.is_payroll()));

-- Announcements
create policy "read announcements" on public.announcements for select to authenticated
  using ((select public.is_staff())
         or public.can_see_announcement(status, expires_at, audience, area_ids, site_ids));
create policy "publishers manage announcements" on public.announcements for all to authenticated
  using ((select public.can_publish())) with check ((select public.can_publish()));

create policy "read receipts" on public.announcement_receipts for select to authenticated
  using ((select public.is_staff()) or employee_id = (select public.current_employee_id()));

-- Notifications and devices belong to their user
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notifications" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

create policy "own devices" on public.device_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Attendance: the guard's own logs, staff all, commanders the logs at their posts (written by
-- log_attendance only)
create policy "read attendance" on public.attendance_logs for select to authenticated
  using ((select public.is_staff()) or employee_id = (select public.current_employee_id())
         or site_id = any ((select public.my_supervised_site_ids())::uuid[]));

-- The S3 file list: staff can see it; only the files Edge Function writes it (through functions)
create policy "staff read stored files" on public.stored_files for select to authenticated
  using ((select public.is_staff()));

-- Website: open job openings are public; applications and proposal requests can be sent by anyone
create policy "public reads open jobs" on public.job_openings for select to anon, authenticated
  using (status = 'open' and (closes_on is null or closes_on >= current_date));
create policy "hr reads all jobs" on public.job_openings for select to authenticated using ((select public.is_hr()));
create policy "hr manages jobs" on public.job_openings for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

create policy "anyone applies" on public.job_applications for insert to anon, authenticated
  with check (privacy_consent and status = 'new' and staff_notes is null and reviewed_by is null and employee_id is null);
create policy "hr adds applications" on public.job_applications for insert to authenticated with check ((select public.is_hr()));
create policy "hr reads applications" on public.job_applications for select to authenticated using ((select public.is_hr()));
create policy "hr updates applications" on public.job_applications for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy "hr deletes applications" on public.job_applications for delete to authenticated
  using ((select public.has_any_role(array['super_admin', 'hr_admin']::public.app_role[])));

create policy "anyone asks for a proposal" on public.inquiries for insert to anon, authenticated
  with check (privacy_consent and status = 'new' and assigned_to is null and staff_notes is null);
create policy "staff read inquiries" on public.inquiries for select to authenticated using ((select public.is_staff()));
create policy "staff update inquiries" on public.inquiries for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "admins read audit log" on public.audit_log for select to authenticated
  using ((select public.has_any_role(array['super_admin', 'hr_admin']::public.app_role[])));

-- -------------------------------------------------------------------------------------
-- 12. Privileges (row level security does the filtering; these limit what each role may try)
-- -------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'areas', 'clients', 'sites', 'employees', 'employee_compensation', 'employee_government_ids', 'profiles',
    'user_roles', 'staff_invitations', 'site_supervisors', 'document_types', 'employee_documents', 'payroll_periods',
    'payslips', 'leave_types', 'leave_credits', 'leave_requests', 'coe_requests', 'certificates',
    'profile_change_requests', 'payroll_concerns', 'announcements', 'announcement_receipts', 'notifications',
    'device_tokens', 'job_openings', 'job_applications', 'inquiries', 'audit_log', 'pay_rules', 'pay_rates',
    'employee_assignments', 'attendance_logs', 'document_alerts', 'compliance_gaps', 'site_staffing', 'leave_balances'
  ] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- activation tickets and attempts: the service role only (no policies, no API access)
revoke all on public.activation_tickets, public.activation_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.activation_tickets, public.activation_attempts to service_role;

-- writes that must go through functions only
revoke insert, update, delete on public.employee_government_ids, public.user_roles, public.certificates,
  public.audit_log, public.announcement_receipts, public.attendance_logs from authenticated;
revoke insert, delete on public.notifications from authenticated;
revoke update, delete on public.coe_requests, public.leave_requests, public.profile_change_requests from authenticated;

grant select on public.job_openings to anon;
grant insert on public.job_applications, public.inquiries to anon;
grant usage, select on all sequences in schema public to authenticated;

-- functions: internal helpers are not callable from the API
revoke execute on function
  public.notify_user(uuid, text, text, text, jsonb),
  public.notify_employee(uuid, text, text, text, jsonb),
  public.notify_roles(public.app_role[], text, text, text, jsonb),
  public.notify_site_supervisors(uuid, text, text, text, jsonb),
  public.bootstrap_super_admin(text, text),
  public.send_document_expiry_reminders(),
  public.random_code(int)
from public, anon, authenticated;

revoke execute on function
  public.my_access(), public.mark_password_changed(), public.invite_staff(text, text, public.app_role[], uuid),
  public.set_user_roles(uuid, public.app_role[]), public.list_users(), public.admin_reset_password(uuid, text),
  public.get_government_ids(uuid), public.save_government_ids(uuid, text, text, text, text),
  public.deploy_employees(uuid[], uuid, integer, time), public.set_site_pay_rule(uuid, uuid),
  public.import_payslips(uuid, jsonb), public.publish_payroll_period(uuid),
  public.unpublish_payroll_period(uuid), public.decide_leave_request(uuid, boolean, text, uuid),
  public.cancel_leave_request(uuid), public.issue_certificate(uuid, text, text, text),
  public.issue_certificate_for(uuid, text, boolean, text, text, text, text), public.attach_certificate_file(uuid, text),
  public.reject_coe_request(uuid, text), public.cancel_coe_request(uuid), public.revoke_certificate(uuid, text),
  public.decide_profile_change(uuid, boolean, text), public.mark_announcement_read(uuid, boolean),
  public.announcement_stats(uuid), public.hire_applicant(uuid, text, date, text, uuid), public.portal_dashboard()
from public, anon;

grant execute on function
  public.my_access(), public.mark_password_changed(), public.invite_staff(text, text, public.app_role[], uuid),
  public.set_user_roles(uuid, public.app_role[]), public.list_users(), public.admin_reset_password(uuid, text),
  public.get_government_ids(uuid), public.save_government_ids(uuid, text, text, text, text),
  public.deploy_employees(uuid[], uuid, integer, time), public.set_site_pay_rule(uuid, uuid),
  public.import_payslips(uuid, jsonb), public.publish_payroll_period(uuid),
  public.unpublish_payroll_period(uuid), public.decide_leave_request(uuid, boolean, text, uuid),
  public.cancel_leave_request(uuid), public.issue_certificate(uuid, text, text, text),
  public.issue_certificate_for(uuid, text, boolean, text, text, text, text), public.attach_certificate_file(uuid, text),
  public.reject_coe_request(uuid, text), public.cancel_coe_request(uuid), public.revoke_certificate(uuid, text),
  public.decide_profile_change(uuid, boolean, text), public.mark_announcement_read(uuid, boolean),
  public.announcement_stats(uuid), public.hire_applicant(uuid, text, date, text, uuid), public.portal_dashboard()
to authenticated;

grant execute on function
  public.verify_certificate(text), public.check_staff_invitation(text, text)
to anon, authenticated;

-- Employee activation runs only in the activate-employee Edge Function (service role), which limits
-- and logs tries. check_employee_activation was open to anon before; without this, anyone could keep
-- guessing birthdates through it with no limit.
revoke execute on function
  public.check_employee_activation(text, date, text),
  public.begin_employee_activation(text, date, text, text)
from public, anon, authenticated;
grant execute on function
  public.check_employee_activation(text, date, text),
  public.begin_employee_activation(text, date, text, text)
to service_role;

-- the app registers its push token through this function (see its comment)
revoke execute on function public.register_device_token(text, text, text) from public, anon;
grant execute on function public.register_device_token(text, text, text) to authenticated;

-- time in and time out (log_attendance); the distance helper is internal
revoke execute on function public.geo_distance_m(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
revoke execute on function public.log_attendance(text, text, double precision, double precision, double precision, boolean)
  from public, anon;
grant execute on function public.log_attendance(text, text, double precision, double precision, double precision, boolean)
  to authenticated;

-- attendance without the guard's phone: commanders (checked inside) and HR (checked inside)
revoke execute on function public.attendance_location_check(uuid, double precision, double precision, double precision)
  from public, anon, authenticated;
revoke execute on function
  public.log_attendance_for(uuid, text, text, double precision, double precision, double precision, boolean),
  public.add_manual_attendance(uuid, text, timestamptz, text)
from public, anon;
grant execute on function
  public.log_attendance_for(uuid, text, text, double precision, double precision, double precision, boolean),
  public.add_manual_attendance(uuid, text, timestamptz, text)
to authenticated;

-- files in S3: the files Edge Function begins uploads and asks what may be opened with the person's own
-- token, and finishes uploads with the service role; the helpers are internal
revoke all on public.stored_files from public, anon, authenticated;
grant select on public.stored_files to authenticated;
grant select, insert, update on public.stored_files to service_role;
revoke execute on function
  public.upload_rule(text), public.employee_storage_folder(uuid), public.storage_slug(text),
  public.stored_file_ok(text, uuid, text, uuid), public.finish_file_upload(uuid, bigint)
from public, anon, authenticated;
grant execute on function public.finish_file_upload(uuid, bigint) to service_role;
revoke execute on function
  public.begin_file_upload(text, text, bigint, uuid, uuid, text, uuid), public.authorize_file_reads(text[])
from public, anon;
grant execute on function
  public.begin_file_upload(text, text, bigint, uuid, uuid, text, uuid), public.authorize_file_reads(text[])
to authenticated;

-- -------------------------------------------------------------------------------------
-- 13. File storage (all buckets private; files are read through short-lived signed links)
-- -------------------------------------------------------------------------------------
-- Employee files now go to Amazon S3 (stored_files, the files Edge Function). These buckets stay for
-- files stored before the switch, which still open, for the website's job applications, and for
-- announcement pictures.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('employee-files', 'employee-files', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('certificates', 'certificates', false, 5242880, array['application/pdf']),
  ('applications', 'applications', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png']),
  ('announcement-media', 'announcement-media', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('attendance-photos', 'attendance-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  r record;
begin
  for r in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'bannuar %' loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end $$;

-- employee-files/{employee_id}/... ; employees upload renewals to {their id}/uploads/...
create policy "bannuar read employee files" on storage.objects for select to authenticated
  using (bucket_id = 'employee-files' and ((select public.is_staff())
         or (storage.foldername(name))[1] = (select public.current_employee_id())::text));
create policy "bannuar add employee files" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-files' and ((select public.is_hr())
         or ((storage.foldername(name))[1] = (select public.current_employee_id())::text
             and (storage.foldername(name))[2] = 'uploads')));
create policy "bannuar change employee files" on storage.objects for update to authenticated
  using (bucket_id = 'employee-files' and (select public.is_hr()));
create policy "bannuar remove employee files" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-files' and (select public.is_hr()));

-- certificates/{employee_id}/{certificate_id}.pdf
create policy "bannuar read certificates" on storage.objects for select to authenticated
  using (bucket_id = 'certificates' and ((select public.is_hr())
         or (storage.foldername(name))[1] = (select public.current_employee_id())::text));
create policy "bannuar add certificates" on storage.objects for insert to authenticated
  with check (bucket_id = 'certificates' and (select public.is_hr()));
create policy "bannuar change certificates" on storage.objects for update to authenticated
  using (bucket_id = 'certificates' and (select public.is_hr()));

-- applications/incoming/... : the website uploads a resume; only HR can open it
create policy "bannuar upload applications" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'applications' and (storage.foldername(name))[1] = 'incoming');
create policy "bannuar read applications" on storage.objects for select to authenticated
  using (bucket_id = 'applications' and (select public.is_hr()));
create policy "bannuar remove applications" on storage.objects for delete to authenticated
  using (bucket_id = 'applications' and (select public.is_hr()));

create policy "bannuar read announcement media" on storage.objects for select to authenticated
  using (bucket_id = 'announcement-media');
create policy "bannuar add announcement media" on storage.objects for insert to authenticated
  with check (bucket_id = 'announcement-media' and (select public.can_publish()));
create policy "bannuar remove announcement media" on storage.objects for delete to authenticated
  using (bucket_id = 'announcement-media' and (select public.can_publish()));

-- attendance-photos/{employee_id}/{random}.jpg : the selfie of a time in or out. Guards add their
-- own and cannot change them; staff, and commanders for the logs at their posts, open them.
create policy "bannuar read attendance photos" on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and ((select public.is_staff())
         or (storage.foldername(name))[1] = (select public.current_employee_id())::text
         or exists (select 1 from public.attendance_logs a
                    where a.photo_path = name and a.site_id = any ((select public.my_supervised_site_ids())::uuid[]))));
create policy "bannuar add attendance photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-photos'
              and (storage.foldername(name))[1] = (select public.current_employee_id())::text);
create policy "bannuar remove attendance photos" on storage.objects for delete to authenticated
  using (bucket_id = 'attendance-photos' and (select public.has_any_role(array['super_admin', 'hr_admin']::public.app_role[])));

-- -------------------------------------------------------------------------------------
-- 14. Reference data (edit freely in the portal; re-running this file never overwrites it)
-- -------------------------------------------------------------------------------------
insert into public.leave_types (code, name, description, days_per_year, max_days_per_request, is_paid, requires_attachment, applies_to_sex, min_service_months, sort_order) values
  ('SIL', 'Service incentive leave', 'Five days with pay a year once you have served one year (Labor Code, Art. 95).', 5, null, true, false, null, 12, 10),
  ('MATERNITY', 'Maternity leave', '105 days with full pay, and 15 more days for solo mothers (RA 11210).', null, 120, true, true, 'female', 0, 20),
  ('PATERNITY', 'Paternity leave', 'Seven days with full pay for each of the first four deliveries of your legitimate spouse (RA 8187).', null, 7, true, true, 'male', 0, 30),
  ('SOLO_PARENT', 'Solo parent leave', 'Seven working days with pay a year after six months of service. Bring your solo parent ID (RA 8972, as amended by RA 11861).', 7, null, true, true, null, 6, 40),
  ('VAWC', 'VAWC leave', 'Up to ten days with pay for a woman employee who is a victim of violence, with a certification (RA 9262).', null, 10, true, true, 'female', 0, 50),
  ('SPECIAL_WOMEN', 'Special leave for women', 'Up to two months with full pay after surgery for a gynecological disorder, after six months of service (RA 9710).', null, 60, true, true, 'female', 6, 60),
  ('LWOP', 'Leave without pay', 'Unpaid leave, decided case by case.', null, null, false, false, null, 0, 90)
on conflict (code) do nothing;

insert into public.document_types (code, name, category, has_expiry, required_for_deployment, remind_days_before, visible_to_employee, employee_can_upload, sort_order, storage_folder) values
  ('SECURITY_LICENSE', 'Security guard license (LESP)', 'license', true, true, 60, true, true, 10, 'lesp'),
  ('NBI_CLEARANCE', 'NBI clearance', 'clearance', true, true, 30, true, true, 20, 'work-requirements'),
  ('POLICE_CLEARANCE', 'Police clearance', 'clearance', true, false, 30, true, true, 30, 'work-requirements'),
  ('BARANGAY_CLEARANCE', 'Barangay clearance', 'clearance', true, false, 30, true, true, 40, 'work-requirements'),
  ('DRUG_TEST', 'Drug test result', 'medical', true, true, 30, true, true, 50, 'work-requirements'),
  ('NEURO_PSYCH', 'Neuro-psychiatric examination', 'medical', true, true, 30, true, true, 60, 'work-requirements'),
  ('MEDICAL_CERT', 'Medical certificate', 'medical', true, false, 30, true, true, 70, 'work-requirements'),
  ('PRE_LICENSING_TRAINING', 'Pre-licensing training certificate', 'training', false, false, 30, true, true, 80, 'work-requirements'),
  ('REFRESHER_TRAINING', 'Refresher training certificate', 'training', true, false, 60, true, true, 90, 'work-requirements'),
  ('BIRTH_CERT', 'PSA birth certificate', 'personal', false, false, 30, true, true, 100, '201-file'),
  ('DIPLOMA', 'Diploma or transcript of records', 'personal', false, false, 30, true, true, 110, '201-file'),
  ('GOVERNMENT_ID', 'Government-issued ID', 'government', true, false, 30, true, true, 120, '201-file'),
  ('EMPLOYMENT_CONTRACT', 'Employment contract', 'contract', false, false, 30, true, false, 130, '201-file'),
  ('BIR_2316', 'BIR Form 2316', 'payroll', false, false, 30, true, false, 140, '201-file')
on conflict (code) do nothing;

-- The agency-wide pay rule: Labor Code overtime (125%) and night differential (10%)
insert into public.pay_rules (id, client_id, name, is_default, regular_hours, night_diff, night_diff_hours, days_per_month, formulas, notes)
values ('00000000-0000-4000-8000-0000000000a1', null, 'Standard', true, 8, 'last_shift', 8, 26, '[
  {"code": "basic", "label": "Basic pay", "formula": "rate * regular_hours", "kind": "earning", "thirteenth": true},
  {"code": "overtime", "label": "Overtime pay", "formula": "rate * 125% * overtime_hours", "kind": "earning", "thirteenth": false},
  {"code": "night_diff", "label": "Night differential", "formula": "rate * 10% * night_hours", "kind": "earning", "thirteenth": false}
]'::jsonb, 'Used by every post whose client has no rule of its own.')
on conflict (id) do nothing;

-- Employees already at a post before assignment history existed: one open assignment from hiring
insert into public.employee_assignments (employee_id, site_id, start_date, duty_hours, shift_start)
select e.id, s.id, coalesce(e.date_hired, public.manila_today()), s.duty_hours, s.first_shift_start
from public.employees e join public.sites s on s.id = e.site_id
where not exists (select 1 from public.employee_assignments a where a.employee_id = e.id);

-- -------------------------------------------------------------------------------------
-- 15. Live updates for the portal's bell and the app (Supabase Realtime)
-- -------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.notifications;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Done. Next: supabase/SETUP.md

-- -------------------------------------------------------------------------------------
-- 16. Discipline: the Code of Discipline, incident reports and cases with due process
-- -------------------------------------------------------------------------------------
-- Claude (the Anthropic API, called only from the discipline-ai Edge Function, which holds the key)
-- reads the uploaded code into offense rules and suggests matching rules and a draft notice for a case.
-- Everything it writes is a proposal: HR approves each rule, and HR decides every case. These functions
-- enforce the steps; they do not judge.

create or replace function public.hr_roles() returns public.app_role[]
language sql immutable set search_path = '' as $$
  select array['super_admin', 'hr_admin', 'hr_staff']::public.app_role[]
$$;

-- Step 1 (HR): a new code from a PDF the files function stored (purpose 'policy')
create or replace function public.create_discipline_code(p_title text, p_effective_on date, p_file_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR adds the Code of Discipline' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 3 then
    raise exception 'Give the code a title' using errcode = '22023';
  end if;
  if not exists (select 1 from public.stored_files f where f.object_key = p_file_key and f.purpose = 'policy'
                 and f.status = 'stored' and f.uploaded_by = auth.uid()) then
    raise exception 'The PDF did not arrive. Upload it again.' using errcode = 'P0001';
  end if;
  insert into public.discipline_codes (title, effective_on, file_key, uploaded_by)
  values (trim(p_title), p_effective_on, p_file_key, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Step 2 (HR, through discipline-ai): Claude starts reading. A code is read before any of its rules is
-- approved; after that, HR edits rules by hand. A read that has run over two hours may be started again.
create or replace function public.start_code_reading(p_code_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.discipline_codes;
begin
  if not public.is_hr() then
    raise exception 'Only HR can have the code read' using errcode = '42501';
  end if;
  select * into c from public.discipline_codes where id = p_code_id for update;
  if not found then
    raise exception 'Code not found' using errcode = 'P0002';
  end if;
  if c.status <> 'draft' then
    raise exception 'Only a draft code is read. This one is already in use or retired.' using errcode = 'P0001';
  end if;
  if c.read_status = 'reading' and c.read_started_at > now() - interval '2 hours' then
    raise exception 'Claude is already reading this code' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.offense_rules r where r.code_id = c.id and r.status <> 'proposed') then
    raise exception 'Rules of this code were already reviewed. Edit them by hand instead.' using errcode = 'P0001';
  end if;
  update public.discipline_codes
  set read_status = 'reading', read_started_at = now(), read_error = null, read_job = null
  where id = c.id;
  return jsonb_build_object('id', c.id, 'title', c.title, 'file_key', c.file_key);
end $$;

-- Where Claude's reading stands (HR, through discipline-ai, which then asks Anthropic about the batch)
create or replace function public.code_reading_status(p_code_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.discipline_codes;
begin
  if not public.is_hr() then
    raise exception 'Only HR follows the reading' using errcode = '42501';
  end if;
  select * into c from public.discipline_codes where id = p_code_id;
  if not found then
    raise exception 'Code not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('read_status', c.read_status, 'read_job', c.read_job, 'read_started_at', c.read_started_at,
                            'read_error', c.read_error);
end $$;

-- The discipline-ai function only (service role)
create or replace function public.set_code_reading_job(p_code_id uuid, p_job text, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trusted() then
    raise exception 'Only the discipline-ai service records this' using errcode = '42501';
  end if;
  update public.discipline_codes set read_job = p_job, read_model = p_model
  where id = p_code_id and read_status = 'reading';
end $$;

create or replace function public.fail_code_reading(p_code_id uuid, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trusted() then
    raise exception 'Only the discipline-ai service records this' using errcode = '42501';
  end if;
  update public.discipline_codes set read_status = 'failed', read_error = left(coalesce(p_error, 'Reading failed'), 500), read_job = null
  where id = p_code_id and read_status = 'reading';
end $$;

-- What Claude found: the proposed rules replace earlier proposals (nothing was reviewed yet)
create or replace function public.finish_code_reading(p_code_id uuid, p_rules jsonb, p_summary text, p_notes jsonb, p_model text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  n integer := 0;
begin
  if not public.is_trusted() then
    raise exception 'Only the discipline-ai service records this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.discipline_codes where id = p_code_id and read_status = 'reading') then
    raise exception 'This code is not being read' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rules) <> 'array' or jsonb_typeof(coalesce(p_notes, '[]'::jsonb)) <> 'array' then
    raise exception 'Rules must be a list' using errcode = '22023';
  end if;
  delete from public.offense_rules where code_id = p_code_id and status = 'proposed';
  for x in select value from jsonb_array_elements(p_rules) loop
    n := n + 1;
    insert into public.offense_rules (code_id, ref, title, description, category, gravity, penalties, just_cause,
                                      source_text, page, sort, from_ai)
    values (p_code_id, left(coalesce(x ->> 'ref', ''), 40), left(coalesce(nullif(trim(x ->> 'title'), ''), 'Untitled offense'), 300),
            left(coalesce(x ->> 'description', ''), 2000),
            case when x ->> 'category' in ('attendance', 'post_duty', 'conduct', 'uniform_equipment', 'dishonesty',
                                           'safety_security', 'substance', 'insubordination') then x ->> 'category' else 'other' end,
            case when x ->> 'gravity' in ('light', 'less_serious', 'serious', 'grave') then x ->> 'gravity' else 'unclassified' end,
            case when public.valid_penalties(coalesce(x -> 'penalties', '[]'::jsonb)) then x -> 'penalties' else '[]'::jsonb end,
            case when x ->> 'just_cause' in ('serious_misconduct', 'willful_disobedience', 'gross_neglect', 'fraud_breach_of_trust',
                                             'crime_against_employer', 'analogous') then x ->> 'just_cause' else 'none' end,
            left(coalesce(x ->> 'source_text', ''), 2000),
            case when jsonb_typeof(x -> 'page') = 'number' and (x ->> 'page')::numeric between 1 and 2000 then (x ->> 'page')::numeric::integer end,
            n, true);
  end loop;
  update public.discipline_codes
  set read_status = 'read', read_at = now(), read_job = null, read_error = null, read_model = p_model,
      summary = left(p_summary, 2000), compliance_notes = coalesce(p_notes, '[]'::jsonb)
  where id = p_code_id;
  perform public.notify_roles(public.hr_roles(), 'Claude finished reading the Code of Discipline',
    n || ' offense rules to review', 'discipline_code', jsonb_build_object('screen', 'Discipline', 'tab', 'code'));
  return n;
end $$;

-- Rules HR edits: validated, and every change of status is signed
create or replace function public.offense_rules_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select c.status from public.discipline_codes c where c.id = new.code_id) = 'retired' then
    raise exception 'This code is retired. Its rules can no longer change.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status <> 'proposed' then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  end if;
  if tg_op = 'UPDATE' and old.status = 'approved' and new.status = 'approved' and new.code_id = old.code_id
     and (select c.status from public.discipline_codes c where c.id = new.code_id) = 'active'
     and exists (select 1 from public.disciplinary_cases dc where dc.rule_id = new.id and dc.status <> 'draft')
     and (new.penalties is distinct from old.penalties or new.title is distinct from old.title) then
    raise exception 'Cases already rest on this rule. Upload a new version of the code to change it.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists offense_rules_before_write on public.offense_rules;
create trigger offense_rules_before_write before insert or update on public.offense_rules
  for each row execute function public.offense_rules_before_write();

create or replace function public.offense_rules_before_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.disciplinary_cases dc where dc.rule_id = old.id) then
    raise exception 'A case uses this rule. Reject it instead of deleting it.' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists offense_rules_before_delete on public.offense_rules;
create trigger offense_rules_before_delete before delete on public.offense_rules
  for each row execute function public.offense_rules_before_delete();

-- Step 3 (HR): this version becomes the basis of new cases; the one before is retired
create or replace function public.activate_discipline_code(p_code_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c public.discipline_codes;
begin
  if not public.is_hr() then
    raise exception 'Only HR puts a code in force' using errcode = '42501';
  end if;
  select * into c from public.discipline_codes where id = p_code_id for update;
  if not found or c.status <> 'draft' then
    raise exception 'Only a draft code can be put in force' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.offense_rules where code_id = c.id and status = 'proposed') then
    raise exception 'Approve or reject every rule first' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.offense_rules where code_id = c.id and status = 'approved') then
    raise exception 'Approve at least one rule first' using errcode = 'P0001';
  end if;
  update public.discipline_codes set status = 'retired' where status = 'active';
  update public.discipline_codes set status = 'active', activated_by = auth.uid(), activated_at = now() where id = c.id;
end $$;

-- Incident reports: from staff (HR or operations), a commander for their post, or a client (section 17)
create or replace function public.file_incident_report(
  p_site_id uuid, p_employee_id uuid, p_occurred_at timestamptz, p_title text, p_details text,
  p_guard_described text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_client uuid;
  v_name text;
  v_no text;
  v_id uuid;
  me public.employees;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if public.is_hr() or public.is_ops() then
    v_kind := 'staff';
    select coalesce(p.full_name, 'Bannuar staff') into v_name from public.profiles p where p.id = auth.uid();
  elsif public.my_client_id() is not null then
    -- someone at the client company, about one of its posts and a guard of that post
    if p_site_id is null or not exists (select 1 from public.sites s where s.id = p_site_id and s.client_id = public.my_client_id()) then
      raise exception 'Choose one of your posts' using errcode = '42501';
    end if;
    if p_employee_id is not null and not exists (select 1 from public.employees e where e.id = p_employee_id and e.site_id = p_site_id) then
      raise exception 'Choose a guard of that post' using errcode = '42501';
    end if;
    if (select count(*) from public.incident_reports r where r.reported_by = auth.uid() and r.created_at > now() - interval '1 day') >= 20 then
      raise exception 'Too many reports today. Call Bannuar instead.' using errcode = 'P0001';
    end if;
    v_kind := 'client';
    select cu.full_name || ' · ' || c.name into v_name
    from public.client_users cu join public.clients c on c.id = cu.client_id where cu.user_id = auth.uid();
  elsif p_site_id is not null and p_site_id = any (public.my_supervised_site_ids()) then
    v_kind := 'commander';
    select * into me from public.employees where user_id = auth.uid();
    v_name := public.full_name(me);
  else
    raise exception 'You cannot file a report for this post' using errcode = '42501';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'Post not found' using errcode = 'P0002';
  end if;
  if p_employee_id is not null and v_kind = 'commander' and not public.supervises(p_employee_id) then
    raise exception 'Choose a guard of your post' using errcode = '42501';
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' or p_occurred_at < now() - interval '1 year' then
    raise exception 'Give when it happened (not in the future, within a year)' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_title, ''))) < 3 then
    raise exception 'Give the report a short title' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_details, ''))) < 10 then
    raise exception 'Say what happened' using errcode = '22023';
  end if;
  select s.client_id into v_client from public.sites s where s.id = p_site_id;
  v_no := 'IR-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.incident_no_seq')::text, 6, '0');
  insert into public.incident_reports (report_no, site_id, client_id, employee_id, guard_described, occurred_at, title, details,
                                       reporter_kind, reported_by, reporter_name)
  values (v_no, p_site_id, v_client, p_employee_id, nullif(left(trim(coalesce(p_guard_described, '')), 200), ''), p_occurred_at,
          left(trim(p_title), 200), left(trim(p_details), 5000), v_kind, auth.uid(), v_name)
  returning id into v_id;
  perform public.notify_roles(case when v_kind = 'client' then public.hr_roles() || array['operations']::public.app_role[] else public.hr_roles() end,
    case when v_kind = 'client' then 'A client reported an incident' else 'New incident report' end, v_no || ' · ' || left(trim(p_title), 80),
    'incident_report', jsonb_build_object('screen', 'Discipline', 'tab', 'reports', 'id', v_id));
  return jsonb_build_object('id', v_id, 'report_no', v_no, 'status', 'received');
end $$;

create or replace function public.update_incident_report(p_id uuid, p_status text, p_client_update text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_hr() or public.is_ops()) then
    raise exception 'Only HR or operations update reports' using errcode = '42501';
  end if;
  if p_status not in ('received', 'investigating', 'action_taken', 'closed', 'not_pursued') then
    raise exception 'Choose a status' using errcode = '22023';
  end if;
  update public.incident_reports
  set status = p_status, client_update = nullif(left(trim(coalesce(p_client_update, '')), 1000), '')
  where id = p_id;
  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
end $$;

-- How many times before this employee was found to have broken this rule (or the same-numbered rule
-- of an earlier version of the code)
create or replace function public.prior_offense_count(p_employee_id uuid, p_rule_id uuid, p_except uuid default null)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
  from public.disciplinary_cases dc
  join public.offense_rules r on r.id = dc.rule_id
  join public.offense_rules this on this.id = p_rule_id
  where dc.employee_id = p_employee_id and dc.status = 'decided' and dc.decision <> 'no_violation'
    and dc.id is distinct from p_except
    and (r.id = this.id or (this.ref <> '' and r.ref = this.ref and lower(r.title) = lower(this.title)))
$$;

-- The rule must be an approved rule of the code in force
create or replace function public.check_case_rule(p_rule_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_rule_id is not null and not exists (
      select 1 from public.offense_rules r join public.discipline_codes c on c.id = r.code_id
      where r.id = p_rule_id and r.status = 'approved' and c.status = 'active') then
    raise exception 'Choose an approved rule of the Code of Discipline in force' using errcode = '22023';
  end if;
end $$;

-- A case (HR). It stays a draft, unseen by the employee, until the notice to explain is issued.
create or replace function public.open_disciplinary_case(p_employee_id uuid, p_incident_id uuid, p_rule_id uuid, p_facts text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_no text;
  v_id uuid;
begin
  if not public.is_hr() then
    raise exception 'Only HR opens discipline cases' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'Employee not found' using errcode = 'P0002';
  end if;
  if p_incident_id is not null and not exists (select 1 from public.incident_reports where id = p_incident_id) then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
  perform public.check_case_rule(p_rule_id);
  if length(trim(coalesce(p_facts, ''))) < 10 then
    raise exception 'Write down the facts: what, when and where' using errcode = '22023';
  end if;
  v_no := 'DC-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.case_no_seq')::text, 6, '0');
  insert into public.disciplinary_cases (case_no, employee_id, incident_id, rule_id, offense_no, facts, created_by)
  values (v_no, p_employee_id, p_incident_id, p_rule_id,
          case when p_rule_id is not null then least(public.prior_offense_count(p_employee_id, p_rule_id) + 1, 10) end,
          trim(p_facts), auth.uid())
  returning id into v_id;
  update public.incident_reports set status = 'investigating' where id = p_incident_id and status = 'received';
  return jsonb_build_object('id', v_id, 'case_no', v_no);
end $$;

create or replace function public.update_case_draft(p_case_id uuid, p_rule_id uuid, p_offense_no integer, p_facts text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR edits discipline cases' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status <> 'draft' then
    raise exception 'The notice was issued. The charge can no longer change; withdraw the case and open a new one.' using errcode = 'P0001';
  end if;
  perform public.check_case_rule(p_rule_id);
  if p_offense_no is not null and p_offense_no not between 1 and 10 then
    raise exception 'The offense count is from 1 to 10' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_facts, ''))) < 10 then
    raise exception 'Write down the facts: what, when and where' using errcode = '22023';
  end if;
  update public.disciplinary_cases
  set rule_id = p_rule_id,
      offense_no = case when p_rule_id is null then null
                        else coalesce(p_offense_no, least(public.prior_offense_count(dc.employee_id, p_rule_id, dc.id) + 1, 10)) end,
      facts = trim(p_facts)
  where id = dc.id;
end $$;

-- Notice to explain: the charge (an approved rule), the facts, and at least five calendar days to answer
create or replace function public.issue_nte(p_case_id uuid, p_nte_text text, p_explain_by timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR issues notices' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status <> 'draft' then
    raise exception 'The notice was already issued' using errcode = 'P0001';
  end if;
  if dc.rule_id is null then
    raise exception 'Choose the rule the employee may have broken first' using errcode = 'P0001';
  end if;
  perform public.check_case_rule(dc.rule_id);
  if length(trim(coalesce(p_nte_text, ''))) < 50 then
    raise exception 'Write the notice: the acts, when and where, and the rule' using errcode = '22023';
  end if;
  if p_nte_text ~ '\{\{|\[to fill in\]' then
    raise exception 'The notice still has blanks to fill in' using errcode = '22023';
  end if;
  if p_explain_by is null or p_explain_by < now() + interval '5 days' - interval '1 minute' then
    raise exception 'Give the employee at least five calendar days to answer (DOLE D.O. 147-15)' using errcode = '22023';
  end if;
  update public.disciplinary_cases
  set status = 'nte_issued', nte_text = trim(p_nte_text), nte_issued_at = now(), nte_issued_by = auth.uid(), explain_by = p_explain_by
  where id = dc.id;
  perform public.notify_employee(dc.employee_id, 'You have a notice from HR',
    'Open the app to read it. You can answer until ' || to_char(p_explain_by at time zone 'Asia/Manila', 'FMMon FMDD') || '.',
    'discipline', jsonb_build_object('screen', 'Notices'));
end $$;

-- The employee, in the app: "I received this" (the notice or the decision)
create or replace function public.acknowledge_case_notice(p_case_id uuid, p_which text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  select * into dc from public.disciplinary_cases where id = p_case_id and employee_id = public.current_employee_id();
  if not found or dc.status = 'draft' then
    raise exception 'Notice not found' using errcode = 'P0002';
  end if;
  if p_which = 'nte' then
    update public.disciplinary_cases set nte_received_at = coalesce(nte_received_at, now()) where id = dc.id;
  elsif p_which = 'decision' and dc.status = 'decided' then
    update public.disciplinary_cases set decision_received_at = coalesce(decision_received_at, now()) where id = dc.id;
  else
    raise exception 'Nothing to acknowledge' using errcode = '22023';
  end if;
end $$;

-- The employee's written explanation, from the app, until HR decides (a late answer is still heard)
create or replace function public.submit_case_explanation(p_case_id uuid, p_text text, p_wants_hearing boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  select * into dc from public.disciplinary_cases where id = p_case_id and employee_id = public.current_employee_id() for update;
  if not found or dc.status = 'draft' then
    raise exception 'Notice not found' using errcode = 'P0002';
  end if;
  if dc.status <> 'nte_issued' then
    raise exception 'Your explanation was already received' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_text, ''))) < 10 then
    raise exception 'Write your explanation' using errcode = '22023';
  end if;
  update public.disciplinary_cases
  set status = 'explained', explanation = left(trim(p_text), 10000), explanation_via = 'app', explained_at = now(),
      wants_hearing = coalesce(p_wants_hearing, false), nte_received_at = coalesce(nte_received_at, now())
  where id = dc.id;
  perform public.notify_roles(public.hr_roles(), 'Explanation received', dc.case_no, 'discipline',
    jsonb_build_object('screen', 'Discipline', 'tab', 'cases', 'id', dc.id));
end $$;

-- HR records a written explanation handed in on paper (the signed copy goes to the 201 file)
create or replace function public.record_case_explanation(p_case_id uuid, p_text text, p_wants_hearing boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR records explanations' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status <> 'nte_issued' then
    raise exception 'The explanation can be recorded only while the notice waits for one' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_text, ''))) < 10 then
    raise exception 'Copy the explanation as written' using errcode = '22023';
  end if;
  update public.disciplinary_cases
  set status = 'explained', explanation = left(trim(p_text), 10000), explanation_via = 'paper', explained_at = now(),
      wants_hearing = coalesce(p_wants_hearing, false), nte_received_at = coalesce(nte_received_at, now())
  where id = dc.id;
end $$;

-- A hearing or conference, where the employee may answer with a representative
create or replace function public.set_case_hearing(p_case_id uuid, p_at timestamptz, p_place text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR sets hearings' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status not in ('nte_issued', 'explained', 'hearing_set') then
    raise exception 'A hearing is set after the notice and before the decision' using errcode = 'P0001';
  end if;
  if p_at is null or p_at < now() + interval '1 day' - interval '1 minute' then
    raise exception 'Set it at least a day ahead, so the employee can come and bring a representative' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_place, ''))) < 3 then
    raise exception 'Say where it will be' using errcode = '22023';
  end if;
  update public.disciplinary_cases set status = 'hearing_set', hearing_at = p_at, hearing_place = trim(p_place), hearing_held_at = null
  where id = dc.id;
  perform public.notify_employee(dc.employee_id, 'HR set a meeting about your notice',
    to_char(p_at at time zone 'Asia/Manila', 'FMMon FMDD, FMHH12:MI AM') || ' · ' || left(trim(p_place), 80) ||
    '. You may bring a representative.', 'discipline', jsonb_build_object('screen', 'Notices'));
end $$;

create or replace function public.record_case_hearing(p_case_id uuid, p_notes text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR records hearings' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status <> 'hearing_set' or dc.hearing_at > now() + interval '1 hour' then
    raise exception 'Record the hearing once it has taken place' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_notes, ''))) < 20 then
    raise exception 'Write what was said, who attended, and what the employee answered' using errcode = '22023';
  end if;
  update public.disciplinary_cases set hearing_notes = trim(p_notes), hearing_held_at = now() where id = dc.id;
end $$;

-- The code's penalty for this offense count: the last one listed applies to later offenses
create or replace function public.code_penalty(p_rule_id uuid, p_offense_no integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select x
  from public.offense_rules r, jsonb_array_elements(r.penalties) x
  where r.id = p_rule_id and (x ->> 'offense')::integer <= greatest(coalesce(p_offense_no, 1), 1)
  order by (x ->> 'offense')::integer desc
  limit 1
$$;

-- The written decision. The employee must have been heard: an explanation (or the deadline passed with
-- none), a hearing when they asked for one, and always a hearing or conference before a dismissal. A
-- penalty other than the code's for this offense count needs a reason.
create or replace function public.decide_case(
  p_case_id uuid, p_decision text, p_suspension_days integer, p_suspension_from date, p_decision_text text,
  p_departs_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
  v_pen jsonb;
  v_departs boolean := false;
begin
  if not public.is_hr() then
    raise exception 'Only HR decides discipline cases' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status not in ('nte_issued', 'explained', 'hearing_set') then
    raise exception 'This case cannot be decided now' using errcode = 'P0001';
  end if;
  if dc.status = 'nte_issued' and now() < dc.explain_by then
    raise exception 'Wait for the explanation: the employee has until %', to_char(dc.explain_by at time zone 'Asia/Manila', 'FMMon FMDD, FMHH12:MI AM')
      using errcode = 'P0001';
  end if;
  if dc.status = 'hearing_set' and dc.hearing_held_at is null then
    raise exception 'Record the hearing first' using errcode = 'P0001';
  end if;
  if dc.wants_hearing and dc.hearing_held_at is null then
    raise exception 'The employee asked for a hearing. Hold it before deciding.' using errcode = 'P0001';
  end if;
  if p_decision not in ('no_violation', 'warning', 'reprimand', 'suspension', 'dismissal') then
    raise exception 'Choose the decision' using errcode = '22023';
  end if;
  if p_decision = 'dismissal' and dc.hearing_held_at is null then
    raise exception 'Hold a hearing or conference before a dismissal (DOLE D.O. 147-15)' using errcode = 'P0001';
  end if;
  if p_decision = 'suspension' and (p_suspension_days is null or p_suspension_days not between 1 and 90 or p_suspension_from is null
                                    or p_suspension_from < (now() at time zone 'Asia/Manila')::date) then
    raise exception 'Give the suspension''s days (1 to 90) and a start date from today' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_decision_text, ''))) < 30 then
    raise exception 'Write the decision: the facts found, the employee''s side, the rule, and the penalty' using errcode = '22023';
  end if;
  if p_decision <> 'no_violation' then
    v_pen := public.code_penalty(dc.rule_id, dc.offense_no);
    v_departs := v_pen is null or v_pen ->> 'action' <> p_decision
                 or (p_decision = 'suspension' and (v_pen ->> 'days')::integer is distinct from p_suspension_days);
    if v_departs and length(trim(coalesce(p_departs_reason, ''))) < 10 then
      raise exception 'This is not the code''s penalty for this offense. Say why.' using errcode = '22023';
    end if;
  end if;
  update public.disciplinary_cases
  set status = 'decided', decision = p_decision,
      suspension_days = case when p_decision = 'suspension' then p_suspension_days end,
      suspension_from = case when p_decision = 'suspension' then p_suspension_from end,
      decision_text = trim(p_decision_text),
      departs_reason = case when v_departs then nullif(trim(coalesce(p_departs_reason, '')), '') end,
      decided_at = now(), decided_by = auth.uid()
  where id = dc.id;
  update public.incident_reports set status = case when p_decision = 'no_violation' then 'closed' else 'action_taken' end
  where id = dc.incident_id and status in ('received', 'investigating');
  perform public.notify_employee(dc.employee_id, 'HR decided on your notice', 'Open the app to read the decision.',
    'discipline', jsonb_build_object('screen', 'Notices'));
  return jsonb_build_object('id', dc.id, 'decision', p_decision, 'departs', v_departs);
end $$;

create or replace function public.withdraw_case(p_case_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR withdraws cases' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status in ('decided', 'withdrawn') then
    raise exception 'This case is closed' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Say why it is withdrawn' using errcode = '22023';
  end if;
  update public.disciplinary_cases set status = 'withdrawn', withdrawn_reason = trim(p_reason) where id = dc.id;
  if dc.status <> 'draft' then
    perform public.notify_employee(dc.employee_id, 'A notice to you was withdrawn', 'Open the app for details.',
      'discipline', jsonb_build_object('screen', 'Notices'));
  end if;
end $$;

-- Preventive suspension: only while the case is open, only for a serious and imminent threat to life or
-- property, and at most 30 days (the employee is paid if it runs longer, Omnibus Rules Book V Rule XIV)
create or replace function public.set_preventive_suspension(p_case_id uuid, p_from date, p_to date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
begin
  if not public.is_hr() then
    raise exception 'Only HR sets a preventive suspension' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id for update;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if dc.status not in ('nte_issued', 'explained', 'hearing_set') then
    raise exception 'Issue the notice to explain first' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 30 then
    raise exception 'A preventive suspension lasts at most 30 days' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 20 then
    raise exception 'Say what serious and imminent threat to life or property the employee''s presence poses' using errcode = '22023';
  end if;
  update public.disciplinary_cases set preventive_from = p_from, preventive_to = p_to, preventive_reason = trim(p_reason)
  where id = dc.id;
  perform public.notify_employee(dc.employee_id, 'You are on preventive suspension',
    public.date_range_label(p_from, p_to) || '. Open the app for details.', 'discipline', jsonb_build_object('screen', 'Notices'));
end $$;

-- The employee's notices, in the app: what was issued to them, never HR's working notes
create or replace function public.my_disciplinary_cases() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', dc.id, 'case_no', dc.case_no, 'status', dc.status,
      'rule', case when r.id is not null then jsonb_build_object('ref', r.ref, 'title', r.title) end,
      'offense_no', dc.offense_no,
      'nte_text', dc.nte_text, 'nte_issued_at', dc.nte_issued_at, 'explain_by', dc.explain_by,
      'nte_received_at', dc.nte_received_at,
      'explanation', dc.explanation, 'explained_at', dc.explained_at, 'wants_hearing', dc.wants_hearing,
      'hearing_at', dc.hearing_at, 'hearing_place', dc.hearing_place, 'hearing_held_at', dc.hearing_held_at,
      'decision', dc.decision, 'suspension_days', dc.suspension_days, 'suspension_from', dc.suspension_from,
      'decision_text', dc.decision_text, 'decided_at', dc.decided_at, 'decision_received_at', dc.decision_received_at,
      'preventive_from', dc.preventive_from, 'preventive_to', dc.preventive_to, 'preventive_reason', dc.preventive_reason,
      'withdrawn_reason', case when dc.nte_issued_at is not null then dc.withdrawn_reason end)
    order by dc.nte_issued_at desc), '[]'::jsonb)
  from public.disciplinary_cases dc
  left join public.offense_rules r on r.id = dc.rule_id
  where dc.employee_id = public.current_employee_id() and dc.nte_issued_at is not null
$$;

-- The code in force, for every signed-in employee to read (the PDF opens through authorize_file_reads)
create or replace function public.active_discipline_code() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('title', c.title, 'effective_on', c.effective_on, 'file_key', c.file_key)
  from public.discipline_codes c
  where c.status = 'active' and auth.uid() is not null
$$;

-- What discipline-ai sends Claude for a suggestion (HR only): the facts and the approved rules, and the
-- employee's earlier findings by rule. No names, numbers or personal details.
create or replace function public.case_ai_context(p_case_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  dc public.disciplinary_cases;
  ir public.incident_reports;
begin
  if not public.is_hr() then
    raise exception 'Only HR asks for suggestions' using errcode = '42501';
  end if;
  select * into dc from public.disciplinary_cases where id = p_case_id;
  if not found then
    raise exception 'Case not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.discipline_codes where status = 'active') then
    raise exception 'Put a Code of Discipline in force first' using errcode = 'P0001';
  end if;
  select * into ir from public.incident_reports where id = dc.incident_id;
  return jsonb_build_object(
    'case_id', dc.id,
    'facts', dc.facts,
    'report', case when ir.id is not null then jsonb_build_object(
      'title', ir.title, 'details', ir.details, 'reported_by', ir.reporter_kind,
      'occurred_at', to_char(ir.occurred_at at time zone 'Asia/Manila', 'YYYY-MM-DD HH24:MI')) end,
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', r.id, 'ref', r.ref, 'title', r.title, 'description', r.description, 'gravity', r.gravity,
                'penalties', r.penalties, 'source_text', r.source_text) order by r.sort), '[]'::jsonb)
              from public.offense_rules r join public.discipline_codes c on c.id = r.code_id
              where c.status = 'active' and r.status = 'approved'),
    'earlier_findings', (select coalesce(jsonb_agg(jsonb_build_object(
                'rule', r.ref || ' ' || r.title, 'decision', p.decision,
                'decided', to_char(p.decided_at at time zone 'Asia/Manila', 'YYYY-MM-DD')) order by p.decided_at), '[]'::jsonb)
              from public.disciplinary_cases p join public.offense_rules r on r.id = p.rule_id
              where p.employee_id = dc.employee_id and p.status = 'decided' and p.decision <> 'no_violation' and p.id <> dc.id));
end $$;

create or replace function public.save_case_suggestion(p_case_id uuid, p_suggestion jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_trusted() then
    raise exception 'Only the discipline-ai service records this' using errcode = '42501';
  end if;
  if jsonb_typeof(p_suggestion) <> 'object' then
    raise exception 'A suggestion is an object' using errcode = '22023';
  end if;
  update public.disciplinary_cases set ai_suggestion = p_suggestion, ai_suggested_at = now() where id = p_case_id;
end $$;

-- updated_at and the audit trail
do $$
declare
  t text;
begin
  foreach t in array array['discipline_codes', 'offense_rules', 'incident_reports', 'disciplinary_cases'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- Row level security: HR keeps the code and the cases; staff see incident reports; employees read their
-- own notices only through my_disciplinary_cases()
do $$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('discipline_codes', 'offense_rules', 'incident_reports', 'disciplinary_cases') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
alter table public.discipline_codes enable row level security;
alter table public.offense_rules enable row level security;
alter table public.incident_reports enable row level security;
alter table public.disciplinary_cases enable row level security;

create policy "HR reads codes" on public.discipline_codes for select to authenticated using ((select public.is_hr()));
create policy "HR edits code titles" on public.discipline_codes for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy "HR reads rules" on public.offense_rules for select to authenticated using ((select public.is_hr()));
create policy "HR adds rules" on public.offense_rules for insert to authenticated with check ((select public.is_hr()));
create policy "HR edits rules" on public.offense_rules for update to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));
create policy "HR deletes draft rules" on public.offense_rules for delete to authenticated
  using ((select public.is_hr()) and exists (select 1 from public.discipline_codes c where c.id = code_id and c.status = 'draft'));
create policy "staff read incident reports" on public.incident_reports for select to authenticated
  using ((select public.is_staff()) or reported_by = (select auth.uid()));
create policy "HR reads cases" on public.disciplinary_cases for select to authenticated using ((select public.is_hr()));

revoke all on public.discipline_codes, public.offense_rules, public.incident_reports, public.disciplinary_cases
  from public, anon, authenticated;
grant select on public.discipline_codes, public.offense_rules, public.incident_reports, public.disciplinary_cases to authenticated;
grant update (title, effective_on) on public.discipline_codes to authenticated;
grant insert, update, delete on public.offense_rules to authenticated;
revoke update (code_id, from_ai, reviewed_by, reviewed_at, created_at) on public.offense_rules from authenticated;
grant select, insert, update, delete on public.discipline_codes, public.offense_rules, public.incident_reports,
  public.disciplinary_cases to service_role;

revoke execute on function
  public.hr_roles(), public.valid_penalties(jsonb), public.prior_offense_count(uuid, uuid, uuid),
  public.check_case_rule(uuid), public.code_penalty(uuid, integer),
  public.set_code_reading_job(uuid, text, text), public.fail_code_reading(uuid, text),
  public.finish_code_reading(uuid, jsonb, text, jsonb, text), public.save_case_suggestion(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.valid_penalties(jsonb) to authenticated;
grant execute on function
  public.set_code_reading_job(uuid, text, text), public.fail_code_reading(uuid, text),
  public.finish_code_reading(uuid, jsonb, text, jsonb, text), public.save_case_suggestion(uuid, jsonb)
to service_role;
revoke execute on function
  public.create_discipline_code(text, date, text), public.start_code_reading(uuid), public.code_reading_status(uuid),
  public.activate_discipline_code(uuid), public.file_incident_report(uuid, uuid, timestamptz, text, text, text), public.update_incident_report(uuid, text, text),
  public.open_disciplinary_case(uuid, uuid, uuid, text), public.update_case_draft(uuid, uuid, integer, text),
  public.issue_nte(uuid, text, timestamptz), public.acknowledge_case_notice(uuid, text),
  public.submit_case_explanation(uuid, text, boolean), public.record_case_explanation(uuid, text, boolean),
  public.set_case_hearing(uuid, timestamptz, text), public.record_case_hearing(uuid, text),
  public.decide_case(uuid, text, integer, date, text, text), public.withdraw_case(uuid, text),
  public.set_preventive_suspension(uuid, date, date, text), public.my_disciplinary_cases(), public.case_ai_context(uuid),
  public.active_discipline_code()
from public, anon;
grant execute on function
  public.create_discipline_code(text, date, text), public.start_code_reading(uuid), public.code_reading_status(uuid),
  public.activate_discipline_code(uuid), public.file_incident_report(uuid, uuid, timestamptz, text, text, text), public.update_incident_report(uuid, text, text),
  public.open_disciplinary_case(uuid, uuid, uuid, text), public.update_case_draft(uuid, uuid, integer, text),
  public.issue_nte(uuid, text, timestamptz), public.acknowledge_case_notice(uuid, text),
  public.submit_case_explanation(uuid, text, boolean), public.record_case_explanation(uuid, text, boolean),
  public.set_case_hearing(uuid, timestamptz, text), public.record_case_hearing(uuid, text),
  public.decide_case(uuid, text, integer, date, text, text), public.withdraw_case(uuid, text),
  public.set_preventive_suspension(uuid, date, date, text), public.my_disciplinary_cases(), public.case_ai_context(uuid),
  public.active_discipline_code()
to authenticated;

-- -------------------------------------------------------------------------------------
-- 17. Client portal: client companies see their posts, guards on duty and attendance, and file
-- incident reports and requests. Read through these functions only; no pay, addresses, government
-- numbers, photos, locations or discipline records ever reach a client.
-- -------------------------------------------------------------------------------------

-- Operations (or a super admin) invites someone at a client company. They sign up at /setup with the
-- code, like staff, and get no staff role.
create or replace function public.invite_client_user(p_client_id uuid, p_email text, p_full_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_code text := public.random_code(4) || '-' || public.random_code(4);
begin
  if not public.is_ops() then
    raise exception 'Only operations invites client users' using errcode = '42501';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and status <> 'ended') then
    raise exception 'Client not found, or the contract has ended' using errcode = 'P0002';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Enter the person''s name' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'This email already has an account' using errcode = 'P0001';
  end if;
  insert into public.staff_invitations (email, full_name, roles, code, client_id, invited_by, expires_at)
  values (v_email, trim(p_full_name), '{}', v_code, p_client_id, auth.uid(), now() + interval '14 days')
  on conflict (email) do update
    set full_name = excluded.full_name, roles = '{}', code = excluded.code, client_id = excluded.client_id, employee_id = null,
        invited_by = excluded.invited_by, expires_at = excluded.expires_at, accepted_at = null, accepted_user_id = null;
  return v_code;
end $$;

-- Who can sign in for a client: people with an account and open invitations (staff only)
create or replace function public.list_client_users(p_client_id uuid)
returns table (user_id uuid, full_name text, email text, state text, since timestamptz)
language sql stable security definer set search_path = '' as $$
  select cu.user_id, cu.full_name, cu.email, case when cu.disabled_at is null then 'active' else 'disabled' end, cu.created_at
  from public.client_users cu where cu.client_id = p_client_id and public.is_staff()
  union all
  select null, i.full_name, i.email, case when i.expires_at > now() then 'invited' else 'expired' end, i.created_at
  from public.staff_invitations i where i.client_id = p_client_id and i.accepted_at is null and public.is_staff()
  order by 5 desc
$$;

create or replace function public.set_client_user_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_ops() then
    raise exception 'Only operations changes client access' using errcode = '42501';
  end if;
  update public.client_users set disabled_at = case when p_active then null else now() end where user_id = p_user_id;
  if not found then
    raise exception 'Client user not found' using errcode = 'P0002';
  end if;
end $$;

-- A guard's name as the client sees it: first name and surname only
create or replace function public.client_guard_name(e public.employees) returns text
language sql immutable set search_path = '' as $$
  select trim(e.first_name || ' ' || e.last_name)
$$;

-- The client's posts, with the guards assigned and who is on duty now (a time in within 18 hours with no
-- time out after it)
create or replace function public.client_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.my_client_id();
begin
  if v_client is null then
    raise exception 'Only client users see this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'client', (select jsonb_build_object('id', c.id, 'name', c.name) from public.clients c where c.id = v_client),
    'posts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'city', s.city, 'guards_required', s.guards_required,
        'guards', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', e.id, 'name', public.client_guard_name(e), 'position', e.position,
              'on_duty_since', (select case when a.kind = 'time_in' then a.logged_at end from public.attendance_logs a
                                where a.employee_id = e.id and a.logged_at > now() - interval '18 hours'
                                order by a.logged_at desc limit 1))
              order by e.last_name), '[]'::jsonb)
            from public.employees e where e.site_id = s.id and e.status = 'active')
      ) order by s.name), '[]'::jsonb)
      from public.sites s where s.client_id = v_client and s.is_active));
end $$;

-- Time in and out at the client's posts on one day (Manila): who, when, and whether the phone was at the
-- post. No photos or locations.
create or replace function public.client_attendance(p_day date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.my_client_id();
begin
  if v_client is null then
    raise exception 'Only client users see this' using errcode = '42501';
  end if;
  if p_day is null or p_day > (now() at time zone 'Asia/Manila')::date or p_day < (now() at time zone 'Asia/Manila')::date - 92 then
    raise exception 'Choose a day in the last three months' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'post', s.name, 'guard', public.client_guard_name(e), 'kind', a.kind, 'logged_at', a.logged_at,
      'at_post', a.location_check = 'at_post', 'by', a.source) order by s.name, a.logged_at), '[]'::jsonb)
    from public.attendance_logs a
    join public.sites s on s.id = a.site_id and s.client_id = v_client
    join public.employees e on e.id = a.employee_id
    where (a.logged_at at time zone 'Asia/Manila')::date = p_day);
end $$;

-- The reports the client's people filed, with Bannuar's status and update (never the case behind it)
create or replace function public.client_reports() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.my_client_id();
begin
  if v_client is null then
    raise exception 'Only client users see this' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'report_no', r.report_no, 'post', s.name, 'occurred_at', r.occurred_at, 'title', r.title,
      'details', r.details, 'guard', coalesce(public.client_guard_name(e), r.guard_described), 'status', r.status,
      'update', r.client_update, 'filed_by', r.reporter_name, 'created_at', r.created_at, 'updated_at', r.updated_at)
      order by r.created_at desc), '[]'::jsonb)
    from public.incident_reports r
    left join public.sites s on s.id = r.site_id
    left join public.employees e on e.id = r.employee_id
    where r.client_id = v_client and r.reporter_kind = 'client');
end $$;

-- A request to operations: more guards, a replacement, a schedule change
create or replace function public.file_client_request(p_site_id uuid, p_kind text, p_details text, p_guards_needed integer,
                                                      p_needed_from date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_client uuid := public.my_client_id();
  v_no text;
  v_id uuid;
  v_name text;
begin
  if v_client is null then
    raise exception 'Only client users file requests' using errcode = '42501';
  end if;
  if p_site_id is not null and not exists (select 1 from public.sites where id = p_site_id and client_id = v_client) then
    raise exception 'Choose one of your posts' using errcode = '42501';
  end if;
  if p_kind not in ('additional_guards', 'replace_guard', 'schedule_change', 'other') then
    raise exception 'Choose what you need' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_details, ''))) < 10 then
    raise exception 'Describe what you need' using errcode = '22023';
  end if;
  if p_guards_needed is not null and p_guards_needed not between 1 and 50 then
    raise exception 'Give the number of guards (1 to 50)' using errcode = '22023';
  end if;
  if (select count(*) from public.client_requests r where r.requested_by = auth.uid() and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many requests today. Call Bannuar instead.' using errcode = 'P0001';
  end if;
  select cu.full_name into v_name from public.client_users cu where cu.user_id = auth.uid();
  v_no := 'CR-' || to_char(now() at time zone 'Asia/Manila', 'YYYY') || '-' || lpad(nextval('public.client_request_no_seq')::text, 6, '0');
  insert into public.client_requests (request_no, client_id, site_id, kind, details, guards_needed, needed_from, requested_by, requester_name)
  values (v_no, v_client, p_site_id, p_kind, left(trim(p_details), 3000),
          case when p_kind = 'additional_guards' then p_guards_needed end, p_needed_from, auth.uid(), v_name)
  returning id into v_id;
  perform public.notify_roles(array['super_admin', 'hr_admin', 'operations']::public.app_role[], 'A client asked for something',
    v_no || ' · ' || (select name from public.clients where id = v_client), 'client_request',
    jsonb_build_object('screen', 'Requests', 'tab', 'clients', 'id', v_id));
  return jsonb_build_object('id', v_id, 'request_no', v_no, 'status', 'received');
end $$;

create or replace function public.client_requests_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_client uuid := public.my_client_id();
begin
  if v_client is null then
    raise exception 'Only client users see this' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_no', r.request_no, 'post', s.name, 'kind', r.kind, 'details', r.details, 'guards_needed', r.guards_needed,
      'needed_from', r.needed_from, 'status', r.status, 'reply', r.reply, 'requested_by', r.requester_name, 'created_at', r.created_at)
      order by r.created_at desc), '[]'::jsonb)
    from public.client_requests r left join public.sites s on s.id = r.site_id
    where r.client_id = v_client);
end $$;

create or replace function public.update_client_request(p_id uuid, p_status text, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_ops() then
    raise exception 'Only operations answers client requests' using errcode = '42501';
  end if;
  if p_status not in ('received', 'in_progress', 'done', 'declined') then
    raise exception 'Choose a status' using errcode = '22023';
  end if;
  update public.client_requests set status = p_status, reply = nullif(left(trim(coalesce(p_reply, '')), 1000), '') where id = p_id;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['client_requests'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
  foreach t in array array['client_users', 'client_requests'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('client_users', 'client_requests') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
alter table public.client_users enable row level security;
alter table public.client_requests enable row level security;
create policy "staff read client users" on public.client_users for select to authenticated using ((select public.is_staff()));
create policy "staff read client requests" on public.client_requests for select to authenticated using ((select public.is_staff()));
revoke all on public.client_users, public.client_requests from public, anon, authenticated;
grant select on public.client_users, public.client_requests to authenticated;
grant select, insert, update, delete on public.client_users, public.client_requests to service_role;

revoke execute on function public.my_client_id(), public.is_client_login(), public.client_guard_name(public.employees) from public, anon;
grant execute on function public.my_client_id(), public.is_client_login() to authenticated;
revoke execute on function
  public.invite_client_user(uuid, text, text), public.list_client_users(uuid), public.set_client_user_active(uuid, boolean),
  public.client_overview(), public.client_attendance(date), public.client_reports(),
  public.file_client_request(uuid, text, text, integer, date), public.client_requests_list(), public.update_client_request(uuid, text, text)
from public, anon;
grant execute on function
  public.invite_client_user(uuid, text, text), public.list_client_users(uuid), public.set_client_user_active(uuid, boolean),
  public.client_overview(), public.client_attendance(date), public.client_reports(),
  public.file_client_request(uuid, text, text, integer, date), public.client_requests_list(), public.update_client_request(uuid, text, text)
to authenticated;
