-- Removes everything seed-demo.sql added. Real records are not touched.
set client_min_messages = warning;

delete from public.announcements where id = 'd0000000-0000-4000-8000-000000000501';
delete from public.job_openings where id = 'd0000000-0000-4000-8000-000000000601';
delete from public.job_applications where source = 'demo';
delete from public.inquiries where source = 'demo';
delete from public.payroll_periods where id in ('d0000000-0000-4000-8000-000000000401', 'd0000000-0000-4000-8000-000000000402');
-- app logins of demo employees (demo-employee-logins.sql); a login that also holds a staff role is kept
delete from auth.users u
using public.employees e
where e.user_id = u.id and e.employee_no like 'DEMO-%'
  and not exists (select 1 from public.user_roles r where r.user_id = u.id and r.role <> 'employee');
delete from public.employees where employee_no like 'DEMO-%';
delete from public.employee_assignments where site_id in ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203');
delete from public.sites where id in ('d0000000-0000-4000-8000-000000000201', 'd0000000-0000-4000-8000-000000000202', 'd0000000-0000-4000-8000-000000000203');
delete from public.clients where id = 'd0000000-0000-4000-8000-000000000101';
delete from public.areas where id = 'd0000000-0000-4000-8000-000000000001';
