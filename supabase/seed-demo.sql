-- =====================================================================================
-- DEMO DATA, for trying the portal before Bannuar's real records are loaded.
-- Every record is marked: names start with "Demo", employee numbers with "DEMO-".
-- Only for a new, empty project: it refuses to run once real employees exist. Run after schema.sql. Remove it all with remove-demo.sql. Safe to run twice.
--
-- Nothing here appears on the public website: the demo job opening is a draft.
-- =====================================================================================
set client_min_messages = warning;

do $$
declare
  v_area constant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_client constant uuid := 'd0000000-0000-4000-8000-000000000101';
  v_site1 constant uuid := 'd0000000-0000-4000-8000-000000000201';
  v_site2 constant uuid := 'd0000000-0000-4000-8000-000000000202';
  v_p1 constant uuid := 'd0000000-0000-4000-8000-000000000401';
  v_p2 constant uuid := 'd0000000-0000-4000-8000-000000000402';
  v_rows jsonb;
begin
  if exists (select 1 from public.employees where employee_no = 'DEMO-0001') then
    raise notice 'Demo data is already loaded.';
    return;
  end if;
  if exists (select 1 from public.employees where employee_no not like 'DEMO-%')
     or exists (select 1 from public.payroll_periods) then
    raise exception 'This database already has real records. Demo data is only for a new, empty project.';
  end if;

  insert into public.areas (id, name, region, office_address)
  values (v_area, 'Demo Area', 'Region I (Ilocos Region)', 'Demo office address');

  insert into public.clients (id, name, industry, contact_person, status, notes)
  values (v_client, 'Demo Client Corporation', 'Commercial', 'Demo Contact', 'active', 'Demo record');

  insert into public.sites (id, client_id, area_id, name, code, city, province, region, guards_required) values
    (v_site1, v_client, v_area, 'Demo Post · Main Gate', 'DEMO-MG', 'San Fernando', 'La Union', 'Region I', 3),
    (v_site2, v_client, v_area, 'Demo Post · Warehouse', 'DEMO-WH', 'San Juan', 'La Union', 'Region I', 2);

  insert into public.employees (id, employee_no, first_name, middle_name, last_name, birthdate, sex, civil_status,
    mobile_no, position, employment_type, status, date_hired, area_id, site_id, present_address) values
    ('d0000000-0000-4000-8000-000000000301', 'DEMO-0001', 'Demo Juan', 'Santos', 'Dela Cruz', '1985-04-12', 'male', 'married',
      '09170000001', 'Detachment Commander', 'regular', 'active', '2019-02-01', v_area, v_site1, 'San Fernando, La Union'),
    ('d0000000-0000-4000-8000-000000000302', 'DEMO-0002', 'Demo Maria', 'Lopez', 'Santos', '1993-09-30', 'female', 'single',
      '09170000002', 'Lady Guard', 'regular', 'active', '2022-03-01', v_area, v_site1, 'Bauang, La Union'),
    ('d0000000-0000-4000-8000-000000000303', 'DEMO-0003', 'Demo Jose', null, 'Ramos', '1990-01-15', 'male', 'married',
      '09170000003', 'Security Guard', 'regular', 'active', '2024-01-15', v_area, v_site1, 'San Juan, La Union'),
    ('d0000000-0000-4000-8000-000000000304', 'DEMO-0004', 'Demo Ana', null, 'Reyes', '1998-06-21', 'female', 'single',
      '09170000004', 'Lady Guard', 'probationary', 'active', current_date - 100, v_area, v_site2, 'Bacnotan, La Union'),
    ('d0000000-0000-4000-8000-000000000305', 'DEMO-0005', 'Demo Pedro', 'Cruz', 'Bautista', '1988-11-02', 'male', 'married',
      '09170000005', 'Security Guard', 'regular', 'floating', '2021-07-01', v_area, null, 'Agoo, La Union'),
    ('d0000000-0000-4000-8000-000000000306', 'DEMO-0006', 'Demo Liza', null, 'Garcia', '1995-02-14', 'female', 'single',
      '09170000006', 'HR Assistant', 'regular', 'active', '2023-05-02', v_area, null, 'San Fernando, La Union');

  update public.employees set floating_since = current_date - 160 where employee_no = 'DEMO-0005';
  update public.employees set is_field = false where employee_no = 'DEMO-0006';

  insert into public.site_supervisors (site_id, employee_id, role)
  values (v_site1, 'd0000000-0000-4000-8000-000000000301', 'detachment_commander');

  insert into public.employee_compensation (employee_id, pay_basis, daily_rate, effective_on)
  select id, 'daily', 540, '2026-01-01' from public.employees where employee_no like 'DEMO-%';

  -- licenses: one expiring soon, one expired, one guard missing an NBI clearance
  insert into public.employee_documents (employee_id, document_type_id, document_no, issued_on, expires_on, status, notes)
  select e.id, dt.id, 'DEMO-' || e.employee_no || '-' || dt.code, current_date - 300,
         case when e.employee_no = 'DEMO-0002' and dt.code = 'SECURITY_LICENSE' then current_date + 20
              when e.employee_no = 'DEMO-0003' and dt.code = 'SECURITY_LICENSE' then current_date - 5
              else current_date + 400 end,
         'verified', 'Demo document'
  from public.employees e
  cross join public.document_types dt
  where e.employee_no in ('DEMO-0001', 'DEMO-0002', 'DEMO-0003', 'DEMO-0004', 'DEMO-0005')
    and dt.required_for_deployment
    and not (e.employee_no = 'DEMO-0004' and dt.code = 'NBI_CLEARANCE');

  insert into public.employee_government_ids (employee_id, sss_no, philhealth_no, pagibig_no, tin)
  select id, '00-0000000-0', '00-000000000-0', '0000-0000-0000', '000-000-000-000'
  from public.employees where employee_no like 'DEMO-%';

  -- two cutoffs: October 16 to 31 published, November 1 to 15 still a draft
  insert into public.payroll_periods (id, label, period_start, period_end, pay_date, status, published_at) values
    (v_p1, 'Demo · Oct 16 to 31, 2026', '2026-10-16', '2026-10-31', '2026-11-05', 'published', now()),
    (v_p2, 'Demo · Nov 1 to 15, 2026', '2026-11-01', '2026-11-15', '2026-11-20', 'draft', null);

  insert into public.payslips (payroll_period_id, employee_id, site_name, days_worked, hours_worked, overtime_hours,
    night_diff_hours, basic_pay, overtime_pay, night_diff_pay, holiday_pay, allowances, gross_pay, sss, philhealth,
    pagibig, withholding_tax, loans, other_deductions, total_deductions, net_pay, deductions_detail)
  select p.id, e.id, s.name, 13, 104, 52, 56, 7020, 3510, 378, 540, 0,
         11448, 450, 250, 100, 0, 0, 200, 1000, 10448,
         '[{"label": "Uniform (demo)", "amount": 200}]'::jsonb
  from public.employees e
  cross join (values (v_p1), (v_p2)) as p (id)
  left join public.sites s on s.id = e.site_id
  where e.employee_no in ('DEMO-0001', 'DEMO-0002', 'DEMO-0003', 'DEMO-0004');

  insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, reason)
  select 'd0000000-0000-4000-8000-000000000303', id, current_date + 10, current_date + 11, 'Demo: family event'
  from public.leave_types where code = 'SIL';

  insert into public.coe_requests (employee_id, purpose, purpose_details, include_compensation)
  values ('d0000000-0000-4000-8000-000000000302', 'bank_loan', 'Demo: housing loan', true);

  insert into public.announcements (id, title, body, category, priority, audience, requires_ack, status)
  values ('d0000000-0000-4000-8000-000000000501', 'Demo: welcome to the Bannuar portal',
    'This is a demo announcement. Published announcements reach every employee the audience covers.',
    'memo', 'normal', 'all', true, 'published');

  insert into public.job_openings (id, title, slug, location, area_id, summary, qualifications, requirements, status)
  values ('d0000000-0000-4000-8000-000000000601', 'Demo: Security Guard', 'demo-security-guard', 'La Union', v_area,
    'Demo opening. Set it to open to see it on the website.',
    array['Demo qualification'], array['Demo requirement'], 'draft');

  insert into public.job_applications (job_opening_id, first_name, last_name, mobile_no, city, province, education,
    has_license, years_experience, privacy_consent, source)
  values (null, 'Demo Applicant', 'Villanueva', '09170000099', 'San Fernando', 'La Union', 'senior_high', true, 2, true, 'demo');

  insert into public.inquiries (company, contact_name, position, email, phone, site_type, guards_needed, coverage, message, privacy_consent, source)
  values ('Demo Company Inc.', 'Demo Requester', 'Admin Officer', 'demo@example.com', '09170000098', 'commercial', 4, '24h',
    'Demo request for a proposal.', true, 'demo');
end $$;
