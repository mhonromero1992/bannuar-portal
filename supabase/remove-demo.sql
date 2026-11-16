-- Removes everything seed-demo.sql and the demo logins added. Real records are not touched.
-- The demo super admin (bannuar@ibits.digital) goes too once someone else is super admin, so invite
-- your own super admin first (Users and roles) and sign in as them; otherwise it stays, with a warning.
set client_min_messages = warning;

-- notifications staff got about demo records (the demo people's own go with their logins)
delete from public.notifications n
where n.link ->> 'id' in (
  select x.id::text from public.employees e
  cross join lateral (
    select id from public.leave_requests where employee_id = e.id
    union all select id from public.payroll_concerns where employee_id = e.id
    union all select id from public.coe_requests where employee_id = e.id
    union all select id from public.certificates where employee_id = e.id
    union all select id from public.employee_documents where employee_id = e.id
    union all select id from public.profile_change_requests where employee_id = e.id
    union all select id from public.payslips where employee_id = e.id) x
  where e.employee_no like 'DEMO-%'
  union all select id::text from public.payroll_periods where label like 'Demo · %'
  union all select id::text from public.job_applications where source = 'demo'
  union all select id::text from public.inquiries where source = 'demo'
  union all select 'd0000000-0000-4000-8000-000000000501');

-- cutoffs holding only demo payslips: the demo year's, and any 13th month payout made during a demo
delete from public.payroll_periods p
where p.label like 'Demo · %'
   or p.id in ('d0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000402')
   or (exists (select 1 from public.payslips s join public.employees e on e.id = s.employee_id
               where s.payroll_period_id = p.id and e.employee_no like 'DEMO-%')
       and not exists (select 1 from public.payslips s join public.employees e on e.id = s.employee_id
                       where s.payroll_period_id = p.id and e.employee_no not like 'DEMO-%'));
delete from public.announcements where id = 'd0000000-0000-4000-8000-000000000501';
delete from public.job_openings where id = 'd0000000-0000-4000-8000-000000000601';
delete from public.job_applications where source = 'demo';
delete from public.inquiries where source = 'demo';
-- app logins of demo employees (demo-employee-logins.sql); a login that also holds a staff role is kept
delete from auth.users u
using public.employees e
where e.user_id = u.id and e.employee_no like 'DEMO-%'
  and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role <> 'employee');
-- the demo client's portal logins (demo-login.sql), and its invitations
delete from auth.users u
using public.client_users cu
where cu.user_id = u.id and cu.client_id = 'd0000000-0000-4000-8000-000000000101'
  and not exists (select 1 from public.user_roles r where r.user_id = u.id);
delete from public.staff_invitations where client_id = 'd0000000-0000-4000-8000-000000000101';
-- the people, with their time in and out, payslips, leave, certificates, documents and requests
delete from public.employees where employee_no like 'DEMO-%';
delete from public.incident_reports where client_id = 'd0000000-0000-4000-8000-000000000101';
delete from public.client_requests where client_id = 'd0000000-0000-4000-8000-000000000101';
delete from public.employee_assignments where site_id in ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203');
delete from public.pay_rates where site_id in ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203');
delete from public.sites where id in ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203');
delete from public.pay_rules where client_id = 'd0000000-0000-4000-8000-000000000101';
delete from public.clients where id = 'd0000000-0000-4000-8000-000000000101';
delete from public.areas where id = 'd0000000-0000-4000-8000-000000000001';

-- the demo super admin, once someone else can sign in as super admin
do $$
declare
  v_demo uuid := (select id from auth.users where lower(email) = 'bannuar@ibits.digital');
begin
  if v_demo is null then
    return;
  elsif exists (select 1 from public.user_roles where role = 'super_admin' and user_id <> v_demo) then
    delete from auth.users where id = v_demo;
  else
    raise warning 'The demo login bannuar@ibits.digital (password "password") is still your only super admin. Invite your own super admin (Users and roles), sign in as them, then run remove-demo.sql again to remove it.';
  end if;
end $$;

