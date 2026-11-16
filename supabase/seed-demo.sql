-- =====================================================================================
-- DEMO DATA: one client, three posts and a year of its guards' work, for showing the portal,
-- the client portal and the app before Bannuar's real records are loaded. Run after schema.sql.
--
-- Everything follows the system's own flow, as if the year had been worked:
--   * time in and out at each post, 26 duties a month, with the days off, the flagged logs and
--     the decisions payroll made on them;
--   * semi-monthly cutoffs worked out from those duties at each post's rate and the client's pay
--     rule (night differential, SSS, PhilHealth and Pag-IBIG lines), clients' confirmations, and
--     published, exactly as Payroll → Work out pay would; the latest ended cutoff is left as a
--     draft with one exception to decide and paid leave in it, to work out and publish live;
--   * the 13th month then follows from what was published.
-- The year runs up to today, so run it again (after remove-demo.sql) on the morning of a
-- presentation: the guards on shift will have timed in today.
--
-- Every record is marked: names start with "Demo", employee numbers with "DEMO-", cutoffs with
-- "Demo ·". It refuses to run once real employees or cutoffs exist. Remove it all with
-- remove-demo.sql before real records go in. Nothing here shows on the public website.
-- =====================================================================================
set client_min_messages = warning;

-- -------------------------------------------------------------------------------------
-- 1. The client, its posts, the people, and the requests waiting in the portal
-- -------------------------------------------------------------------------------------
do $$
declare
  v_area constant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_client constant uuid := 'd0000000-0000-4000-8000-000000000101';
  v_site1 constant uuid := 'd0000000-0000-4000-8000-000000000201';   -- Main Gate
  v_site2 constant uuid := 'd0000000-0000-4000-8000-000000000202';   -- Warehouse
  v_site3 constant uuid := 'd0000000-0000-4000-8000-000000000203';   -- Lobby
  v_rule constant uuid := 'd0000000-0000-4000-8000-000000000701';
  v_juan constant uuid := 'd0000000-0000-4000-8000-000000000301';
  v_maria constant uuid := 'd0000000-0000-4000-8000-000000000302';
  v_jose constant uuid := 'd0000000-0000-4000-8000-000000000303';
  v_ana constant uuid := 'd0000000-0000-4000-8000-000000000304';
  v_today constant date := public.manila_today();
  -- the demo year: this year, or last year in the first weeks of January
  y constant int := extract(year from public.manila_today() - 20)::int;
  v_ana_hired constant date := public.manila_today() - 100;
  v_juan_site uuid;
begin
  if exists (select 1 from public.employees where employee_no = 'DEMO-0001') then
    if not exists (select 1 from public.attendance_logs where employee_id = v_juan) then
      raise exception 'An older demo is loaded. Run remove-demo.sql first, then this file.';
    end if;
    raise notice 'Demo data is already loaded.';
    return;
  end if;
  if exists (select 1 from public.employees where employee_no not like 'DEMO-%')
     or exists (select 1 from public.payroll_periods) then
    raise exception 'This database already has records that are not demo data: %. Demo data is only for a new, empty project. If those were only tests, delete them, then run this file again.',
      concat_ws('; ',
        (select format('%s employee(s), such as %s', (select count(*) from public.employees where employee_no not like 'DEMO-%'),
                       string_agg(x.employee_no || ' ' || x.first_name || ' ' || x.last_name, ', ' order by x.employee_no))
         from (select * from public.employees where employee_no not like 'DEMO-%' order by employee_no limit 3) x
         having count(*) > 0),
        (select format('%s cutoff(s), such as %s', (select count(*) from public.payroll_periods),
                       string_agg(x.label || ' (' || x.status || ')', ', ' order by x.period_start))
         from (select * from public.payroll_periods order by period_start limit 3) x
         having count(*) > 0));
  end if;
  -- DEMO-0001's post today: the Main Gate until March, the Warehouse to October, then the Lobby
  v_juan_site := case when v_today < make_date(y, 4, 1) then v_site1 when v_today < make_date(y, 11, 1) then v_site2 else v_site3 end;

  insert into public.areas (id, name, region, office_address)
  values (v_area, 'Demo Area', 'Region I (Ilocos Region)', 'Demo office address');

  insert into public.clients (id, name, industry, contact_person, status, notes)
  values (v_client, 'Demo Client Corporation', 'Commercial', 'Demo Contact', 'active', 'Demo record');

  -- each post has its place on the map and its allowed distance, so time in and out is checked
  insert into public.sites (id, client_id, area_id, name, code, city, province, region, guards_required,
                            latitude, longitude, geofence_radius_m, duty_hours, first_shift_start) values
    (v_site1, v_client, v_area, 'Demo Post · Main Gate', 'DEMO-MG', 'San Fernando', 'La Union', 'Region I', 3, 16.616200, 120.317200, 150, 12, '06:00'),
    (v_site2, v_client, v_area, 'Demo Post · Warehouse', 'DEMO-WH', 'San Juan', 'La Union', 'Region I', 2, 16.667700, 120.336600, 150, 12, '06:00'),
    (v_site3, v_client, v_area, 'Demo Post · Lobby', 'DEMO-LB', 'San Juan', 'La Union', 'Region I', 2, 16.670200, 120.339800, 150, 12, '06:00');

  insert into public.employees (id, employee_no, first_name, middle_name, last_name, birthdate, sex, civil_status,
    mobile_no, position, employment_type, status, date_hired, area_id, site_id, present_address) values
    (v_juan, 'DEMO-0001', 'Demo Juan', 'Santos', 'Dela Cruz', '1985-04-12', 'male', 'married',
      '09170000001', 'Detachment Commander', 'regular', 'active', '2019-02-01', v_area, v_juan_site, 'San Fernando, La Union'),
    (v_maria, 'DEMO-0002', 'Demo Maria', 'Lopez', 'Santos', '1993-09-30', 'female', 'single',
      '09170000002', 'Lady Guard', 'regular', 'active', '2022-03-01', v_area, v_site1, 'Bauang, La Union'),
    (v_jose, 'DEMO-0003', 'Demo Jose', null, 'Ramos', '1990-01-15', 'male', 'married',
      '09170000003', 'Security Guard', 'regular', 'active', '2024-01-15', v_area, v_site1, 'San Juan, La Union'),
    (v_ana, 'DEMO-0004', 'Demo Ana', null, 'Reyes', '1998-06-21', 'female', 'single',
      '09170000004', 'Lady Guard', 'probationary', 'active', v_ana_hired, v_area, v_site2, 'Bacnotan, La Union'),
    ('d0000000-0000-4000-8000-000000000305', 'DEMO-0005', 'Demo Pedro', 'Cruz', 'Bautista', '1988-11-02', 'male', 'married',
      '09170000005', 'Security Guard', 'regular', 'floating', '2021-07-01', v_area, null, 'Agoo, La Union'),
    ('d0000000-0000-4000-8000-000000000306', 'DEMO-0006', 'Demo Liza', null, 'Garcia', '1995-02-14', 'female', 'single',
      '09170000006', 'HR Assistant', 'regular', 'active', '2023-05-02', v_area, null, 'San Fernando, La Union');

  update public.employees set floating_since = v_today - 160 where employee_no = 'DEMO-0005';
  update public.employees set is_field = false where employee_no = 'DEMO-0006';

  insert into public.site_supervisors (site_id, employee_id, role) values (v_site1, v_juan, 'detachment_commander');

  -- each guard's year, post by post: DEMO-0001 is Bannuar's example (₱100 an hour January to March,
  -- ₱90 April to October, ₱150 from November); DEMO-0002 and DEMO-0004 take the 6 PM shift, the last
  -- shift of the day, which earns night differential
  delete from public.employee_assignments where employee_id in (v_juan, v_maria, v_jose, v_ana);
  insert into public.employee_assignments (employee_id, site_id, start_date, end_date, duty_hours, shift_start, note) values
    (v_juan, v_site1, '2019-02-01', make_date(y, 3, 31), 12, '06:00', 'Demo record'),
    (v_juan, v_site2, make_date(y, 4, 1), make_date(y, 10, 31), 12, '06:00', 'Demo record'),
    (v_juan, v_site3, make_date(y, 11, 1), null, 12, '06:00', 'Demo record'),
    (v_maria, v_site1, '2022-03-01', null, 12, '18:00', 'Demo record'),
    (v_jose, v_site1, '2024-01-15', null, 12, '06:00', 'Demo record'),
    (v_ana, v_site2, v_ana_hired, null, 12, '18:00', 'Demo record');

  insert into public.employee_compensation (employee_id, pay_basis, daily_rate, effective_on) values
    (v_juan, 'daily', 1200, make_date(y, 1, 1)), (v_maria, 'daily', 800, make_date(y, 1, 1)),
    (v_jose, 'daily', 800, make_date(y, 1, 1)), (v_ana, 'daily', 720, make_date(y, 1, 1)),
    ('d0000000-0000-4000-8000-000000000305', 'daily', 800, make_date(y, 1, 1)),
    ('d0000000-0000-4000-8000-000000000306', 'monthly', null, make_date(y, 1, 1));
  update public.employee_compensation set monthly_rate = 18000 where employee_id = 'd0000000-0000-4000-8000-000000000306';

  -- the client's pay rule: Bannuar's standard lines, a meal allowance, and the employee's share of
  -- SSS (5% of the monthly salary credit), PhilHealth (2.5%) and Pag-IBIG (2%, up to ₱200 a month),
  -- half in each cutoff. Payroll can change any line in Settings → Pay rules and rates.
  insert into public.pay_rules (id, client_id, name, is_default, regular_hours, night_diff, night_diff_hours, days_per_month, formulas, notes)
  values (v_rule, v_client, 'Demo Client Corporation', true, 8, 'last_shift', 8, 26, '[
    {"code": "basic", "label": "Basic pay", "formula": "rate * regular_hours", "kind": "earning", "thirteenth": true},
    {"code": "overtime", "label": "Overtime pay", "formula": "rate * 125% * overtime_hours", "kind": "earning", "thirteenth": false},
    {"code": "night_diff", "label": "Night differential", "formula": "rate * 10% * night_hours", "kind": "earning", "thirteenth": false},
    {"code": "allowances", "label": "Meal allowance", "formula": "days * 25", "kind": "earning", "thirteenth": false},
    {"code": "sss", "label": "SSS", "formula": "min(max(round((basic + overtime + night_diff) * 2 / 500) * 500, 5000), 35000) * 5% / 2", "kind": "deduction", "thirteenth": false},
    {"code": "philhealth", "label": "PhilHealth", "formula": "min(max(basic * 2, 10000), 100000) * 2.5% / 2", "kind": "deduction", "thirteenth": false},
    {"code": "pagibig", "label": "Pag-IBIG", "formula": "min(basic * 2, 10000) * 2% / 2", "kind": "deduction", "thirteenth": false}
  ]'::jsonb, 'Demo record');

  insert into public.pay_rates (site_id, effective_from, hourly_rate, note) values
    (v_site1, make_date(y, 1, 1), 100, 'Demo rate'),
    (v_site2, make_date(y, 1, 1), 90, 'Demo rate'),
    (v_site3, make_date(y, 1, 1), 150, 'Demo rate');

  -- licenses: one expiring soon, one expired, one guard missing an NBI clearance
  insert into public.employee_documents (employee_id, document_type_id, document_no, issued_on, expires_on, status, notes)
  select e.id, dt.id, 'DEMO-' || e.employee_no || '-' || dt.code, v_today - 300,
         case when e.employee_no = 'DEMO-0002' and dt.code = 'SECURITY_LICENSE' then v_today + 20
              when e.employee_no = 'DEMO-0003' and dt.code = 'SECURITY_LICENSE' then v_today - 5
              else v_today + 400 end,
         'verified', 'Demo document'
  from public.employees e
  cross join public.document_types dt
  where e.employee_no in ('DEMO-0001', 'DEMO-0002', 'DEMO-0003', 'DEMO-0004', 'DEMO-0005')
    and dt.required_for_deployment
    and not (e.employee_no = 'DEMO-0004' and dt.code = 'NBI_CLEARANCE');

  insert into public.employee_government_ids (employee_id, sss_no, philhealth_no, pagibig_no, tin)
  select id, '00-0000000-0', '00-000000000-0', '0000-0000-0000', '000-000-000-000'
  from public.employees where employee_no like 'DEMO-%';

  -- waiting in the portal: leave for the commander to endorse, a certificate to issue, a change of
  -- address to apply, a proposal request and an application from the website
  insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, reason)
  select v_jose, id, v_today + 10, v_today + 11, 'Demo: family event'
  from public.leave_types where code = 'SIL';

  insert into public.coe_requests (employee_id, purpose, purpose_details, include_compensation)
  values (v_maria, 'bank_loan', 'Demo: housing loan', true);

  insert into public.profile_change_requests (employee_id, changes, reason)
  values (v_ana, '{"present_address": "Demo: Purok 3, Bacnotan, La Union", "mobile_no": "09170000044"}'::jsonb, 'Demo: moved house');

  -- a certificate already issued, so the website's check page has one to find: DEMO-7KQ3-XPD8
  insert into public.certificates (certificate_no, verification_code, employee_id, employee_name, position, date_hired,
    employment_status, purpose, include_compensation, signatory_name, signatory_title, issued_at)
  values ('COE-' || y || '-' || lpad(nextval('public.certificate_no_seq')::text, 6, '0'), 'DEMO-7KQ3-XPD8', v_jose,
    'Demo Jose Ramos', 'Security Guard', '2024-01-15', 'active', 'employment', false, 'Demo HR Manager', 'HR Manager', now() - interval '12 days');

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

  -- from the client portal: a report about the night guard, and a request for two more guards
  insert into public.incident_reports (report_no, site_id, client_id, guard_described, occurred_at, title, details, reporter_kind, reporter_name, status)
  values ('IR-' || y || '-' || lpad(nextval('public.incident_no_seq')::text, 6, '0'), v_site1, v_client, 'Demo: the night guard at the gate',
    (v_today - 1 + time '02:10') at time zone 'Asia/Manila', 'Demo: gate left open after 2 AM',
    'Demo report: the vehicle gate stayed open for about twenty minutes after 2 AM while the guard was at the far end of the lot.',
    'client', 'Demo Contact', 'received');

  insert into public.client_requests (request_no, client_id, site_id, kind, details, guards_needed, needed_from, status, requester_name)
  values ('CR-' || y || '-' || lpad(nextval('public.client_request_no_seq')::text, 6, '0'), v_client, v_site2, 'additional_guards',
    'Demo request: two more guards for the holiday sale at the Warehouse, 8 AM to 8 PM.', 2, v_today + 15, 'received', 'Demo Contact');
end $$;

-- -------------------------------------------------------------------------------------
-- 2. The year: time in and out, cutoffs worked out from it and published, payroll's decisions
-- -------------------------------------------------------------------------------------
do $$
declare
  v_client constant uuid := 'd0000000-0000-4000-8000-000000000101';
  v_site2 constant uuid := 'd0000000-0000-4000-8000-000000000202';
  v_juan constant uuid := 'd0000000-0000-4000-8000-000000000301';
  v_maria constant uuid := 'd0000000-0000-4000-8000-000000000302';
  v_jose constant uuid := 'd0000000-0000-4000-8000-000000000303';
  v_today constant date := public.manila_today();
  y constant int := extract(year from public.manila_today() - 20)::int;
  v_until constant date := least(make_date(y, 12, 31), public.manila_today());
  v_draft record;
  v_leave_day date;
  v_flag record;
  v_leave uuid;
  p record;
begin
  if not exists (select 1 from public.employees where id = v_juan) then
    raise notice 'No demo employees: the demo year was skipped.';
    return;
  end if;
  if exists (select 1 from public.payroll_periods where label like 'Demo · %')
     or exists (select 1 from public.attendance_logs where employee_id = v_juan) then
    raise notice 'The demo year is already loaded.';
    return;
  end if;

  -- 2a. duty days: each guard's post on each day, 26 duties a month with the days off spread out
  create temp table demo_duty on commit drop as
  select a.employee_id, e.employee_no, a.site_id, d::date as day, a.shift_start, a.duty_hours
  from public.employee_assignments a
  join public.employees e on e.id = a.employee_id
  join (values ('DEMO-0001', 0), ('DEMO-0002', 1), ('DEMO-0003', 2), ('DEMO-0004', 3)) as g (no, ord) on g.no = e.employee_no
  cross join lateral generate_series(greatest(a.start_date, make_date(y, 1, 1), e.date_hired), least(coalesce(a.end_date, v_until), v_until), interval '1 day') d
  where not exists (
    select 1
    from (select extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int as dim) m
    cross join generate_series(0, m.dim - 27) k
    where extract(day from d)::int = ((floor((k + 0.5) * m.dim / (m.dim - 26))::int + g.ord) % m.dim) + 1);

  -- days off sick, with no leave filed, so not paid: DEMO-0002 two days in June, DEMO-0003 one in March
  delete from demo_duty x
  using (select employee_no, day, row_number() over (partition by employee_no, date_trunc('month', day) order by day) as n from demo_duty) o
  where x.employee_no = o.employee_no and x.day = o.day
    and ((o.employee_no = 'DEMO-0002' and extract(month from o.day) = 6 and o.n in (7, 8))
      or (o.employee_no = 'DEMO-0003' and extract(month from o.day) = 3 and o.n = 12));

  -- 2b. the cutoffs: the 1st to the 15th and the 16th to the month's end, every one that has ended
  create temp table demo_period on commit drop as
  select gen_random_uuid() as id, h.p_start::date as p_start, h.p_end::date as p_end, false as draft
  from (select make_date(y, m, 1) as p_start, make_date(y, m, 15) as p_end from generate_series(1, 12) m
        union all
        select make_date(y, m, 16), (make_date(y, m, 1) + interval '1 month - 1 day')::date from generate_series(1, 12) m) h
  where h.p_end < v_today;
  -- the latest ended one stays a draft: an exception to decide, paid leave, and pay to work out live
  update demo_period set draft = true where p_end = (select max(p_end) from demo_period);
  select * into v_draft from demo_period where draft;

  -- DEMO-0002 took a day of approved paid leave in it (service incentive leave; DEMO-0004, hired
  -- 100 days ago, has no credits yet, as the leave rules say)
  if v_draft.id is not null then
    select day into v_leave_day from demo_duty
    where employee_no = 'DEMO-0002' and day between v_draft.p_start and v_draft.p_end order by day offset 3 limit 1;
    if v_leave_day is not null then
      delete from demo_duty where employee_no = 'DEMO-0002' and day = v_leave_day;
      insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, reason)
      select v_maria, id, v_leave_day, v_leave_day, 'Demo: medical check-up' from public.leave_types where code = 'SIL'
      returning id into v_leave;
      update public.leave_requests
      set status = 'approved', reliever_employee_id = v_jose,
          supervisor_decided_at = (v_leave_day - 3 + time '09:00') at time zone 'Asia/Manila', supervisor_note = 'Demo: reliever arranged',
          hr_decided_at = (v_leave_day - 2 + time '10:30') at time zone 'Asia/Manila', hr_note = 'Demo: approved',
          created_at = (v_leave_day - 4 + time '19:00') at time zone 'Asia/Manila'
      where id = v_leave;
    end if;
  end if;

  -- 2c. the logs: a time in 2 to 20 minutes before the shift and a time out just after it, each with
  -- its photo, the post's location check and the server's time. Nothing later than now.
  create temp table demo_log on commit drop as
  select x.employee_id, x.employee_no, x.site_id, x.day, k.kind,
         ((x.day + x.shift_start + case when k.kind = 'time_in' then -interval '20 minutes' + make_interval(mins => h.n % 18)
                                        else make_interval(hours => x.duty_hours, mins => 2 + h.n % 12) end)
           at time zone 'Asia/Manila') as logged_at,
         h.n
  from demo_duty x
  cross join (values ('time_in'), ('time_out')) as k (kind)
  cross join lateral (select ('x' || substr(md5(x.employee_no || x.day::text || k.kind), 1, 7))::bit(28)::int as n) h;
  delete from demo_log where logged_at > now();

  -- the flags payroll saw this year, and how it decided them
  --   DEMO-0003, 5th duty in September: logged 640 m from the post (GPS off inside the guardhouse) — counted
  --   DEMO-0002, 3rd duty in August: forgot to time out — the commander confirmed she stayed, counted
  --   DEMO-0003, 3rd duty in the draft cutoff: 380 m from the post, not decided yet
  create temp table demo_flag on commit drop as
  select o.employee_no, o.day, f.flag
  from (select employee_no, day, row_number() over (partition by employee_no, date_trunc('month', day) order by day) as n,
               row_number() over (partition by employee_no, (v_draft.id is not null and day between v_draft.p_start and v_draft.p_end) order by day) as m,
               (v_draft.id is not null and day between v_draft.p_start and v_draft.p_end) as in_draft
        from demo_duty) o
  cross join lateral (select case
      when o.employee_no = 'DEMO-0003' and extract(month from o.day) = 9 and o.n = 5 and not o.in_draft then 'away_counted'
      when o.employee_no = 'DEMO-0002' and extract(month from o.day) = 8 and o.n = 3 and not o.in_draft then 'no_time_out'
      when o.employee_no = 'DEMO-0003' and o.in_draft and o.m = 3 then 'away_open' end as flag) f
  where f.flag is not null;
  delete from demo_log l using demo_flag f
  where l.employee_no = f.employee_no and l.day = f.day and f.flag = 'no_time_out' and l.kind = 'time_out';

  insert into public.attendance_logs (employee_id, site_id, kind, logged_at, photo_path, latitude, longitude, accuracy_m,
                                      distance_m, radius_m, location_check, mock_location, source)
  select l.employee_id, l.site_id, l.kind, l.logged_at,
         'demo/' || l.employee_no || '/' || to_char(l.day, 'YYYY-MM-DD') || '-' || replace(l.kind, 'time_', '') || '.jpg',
         round(s.latitude + case when f.flag like 'away%' and l.kind = 'time_in' then 0.0052 else ((l.n % 41) - 20) * 0.000004 end, 6),
         round(s.longitude + case when f.flag like 'away%' and l.kind = 'time_in' then 0.0021 else ((l.n % 37) - 18) * 0.000004 end, 6),
         case when f.flag like 'away%' and l.kind = 'time_in' then 18 else 5 + l.n % 10 end,
         case when f.flag = 'away_counted' and l.kind = 'time_in' then 640 when f.flag = 'away_open' and l.kind = 'time_in' then 380 else 8 + l.n % 45 end,
         s.geofence_radius_m,
         case when f.flag like 'away%' and l.kind = 'time_in' then 'away' else 'at_post' end,
         false, 'self'
  from demo_log l
  join public.sites s on s.id = l.site_id
  left join demo_flag f on f.employee_no = l.employee_no and f.day = l.day;

  -- 2d. the cutoffs: published a few days after each ends, the draft still open
  insert into public.payroll_periods (id, label, period_start, period_end, pay_date, status, published_at, kind, notes)
  select id, 'Demo · ' || to_char(p_start, 'FMMon FMDD') || ' to ' || to_char(p_end, 'FMDD') || ', ' || y, p_start, p_end, p_end + 5,
         case when draft then 'draft' else 'published' end,
         case when draft then null else (p_end + 4 + time '16:00') at time zone 'Asia/Manila' end, 'regular', 'Demo record'
  from demo_period;

  -- payroll's decisions on the year's flagged duties (the first log of a duty names it)
  for v_flag in
    select f.*, a.id as log_id, dp.id as period_id
    from demo_flag f
    join public.attendance_logs a on a.employee_id = (select id from public.employees where employee_no = f.employee_no)
      and a.kind = 'time_in' and (a.logged_at at time zone 'Asia/Manila')::date = f.day
    join demo_period dp on f.day between dp.p_start and dp.p_end
    where f.flag in ('away_counted', 'no_time_out')
  loop
    insert into public.duty_decisions (period_id, log_id, employee_id, duty_date, decision, decision_note, decided_at)
    values (v_flag.period_id, v_flag.log_id, (select id from public.employees where employee_no = v_flag.employee_no), v_flag.day, 'count',
            case v_flag.flag when 'away_counted' then 'Demo: the commander saw him at the gate; GPS is off inside the guardhouse.'
                             else 'Demo: the commander confirmed she stayed until the 6 AM change.' end,
            (v_flag.day + 6 + time '10:00') at time zone 'Asia/Manila');
  end loop;

  -- the client confirmed every published cutoff; the draft waits for its answer
  insert into public.cutoff_client_reviews (period_id, client_id, opened_at, due_at, response, responder_name, responded_at)
  select id, v_client, (p_end + 1 + time '09:00') at time zone 'Asia/Manila', (p_end + 3 + time '09:00') at time zone 'Asia/Manila',
         'confirmed', 'Demo Contact', (p_end + 2 + time '11:20') at time zone 'Asia/Manila'
  from demo_period where not draft;
  insert into public.cutoff_client_reviews (period_id, client_id, opened_at, due_at)
  select id, v_client, now() - interval '2 hours', now() + interval '46 hours' from demo_period where draft;

  -- 2e. the payslips of the published cutoffs, worked out as Payroll → Work out pay does it: each
  -- guard's assignment in the cutoff, the duties that count there (clean ones and the exceptions
  -- payroll counted), at the post's hourly rate and the client's rule (8 regular hours of a 12-hour
  -- duty, the rest overtime at 125%, the 6 PM shift's 8 hours of night differential at 10%, the
  -- meal allowance, then SSS, PhilHealth and Pag-IBIG). supabase/tests/seed-check.mjs runs the
  -- portal's own pay engine on this year and checks every figure.
  for p in select * from demo_period where not draft order by p_start loop
    insert into public.payslips (payroll_period_id, employee_id, site_name, days_worked, hours_worked, overtime_hours,
      night_diff_hours, basic_pay, overtime_pay, night_diff_pay, holiday_pay, allowances, other_earnings, gross_pay,
      sss, philhealth, pagibig, withholding_tax, loans, other_deductions, total_deductions, net_pay,
      earnings_detail, deductions_detail, remarks, thirteenth_basic, posts_detail)
    select p.id, w.employee_id, w.post, w.days, w.days * 8, w.days * 4, w.days * w.night,
           w.basic, w.overtime, w.night_diff, 0, w.allowances, 0, w.gross, w.sss, w.philhealth, w.pagibig, 0, 0, 0,
           w.sss + w.philhealth + w.pagibig, w.gross - (w.sss + w.philhealth + w.pagibig), '[]'::jsonb, '[]'::jsonb,
           format('%s: %s %s of %s hours at ₱%s an hour', w.post, w.days, case when w.days = 1 then 'duty' else 'duties' end,
                  w.duty_hours, to_char(w.rate, 'FM9999990.00')),
           w.basic,
           jsonb_build_array(jsonb_build_object('site_id', w.site_id, 'post', w.post, 'from', w.p_from, 'to', w.p_to,
                                                'rate', w.rate, 'days', w.days, 'leave_days', 0, 'basic', w.basic))
    from (
      select v.*, round(least(greatest(round((v.basic + v.overtime + v.night_diff) * 2 / 500) * 500, 5000), 35000) * 0.05 / 2, 2) as sss,
             round(least(greatest(v.basic * 2, 10000), 100000) * 0.025 / 2, 2) as philhealth,
             round(least(v.basic * 2, 10000) * 0.02 / 2, 2) as pagibig,
             v.basic + v.overtime + v.night_diff + v.allowances as gross
      from (
        select c.*, round(c.rate * 8 * c.days, 2) as basic, round(c.rate * 1.25 * 4 * c.days, 2) as overtime,
               round(c.rate * 0.10 * c.night * c.days, 2) as night_diff, round(c.days * 25.0, 2) as allowances
        from (
          select a.employee_id, a.site_id, s.name as post, a.duty_hours,
                 greatest(a.start_date, p.p_start, e.date_hired) as p_from, least(coalesce(a.end_date, p.p_end), p.p_end) as p_to,
                 (select r.hourly_rate from public.pay_rates r where r.site_id = a.site_id and r.effective_from <= greatest(a.start_date, p.p_start)
                  order by r.effective_from desc limit 1) as rate,
                 case when a.shift_start = '18:00' then 8 else 0 end as night,
                 (select count(*) from public.period_duties(p.p_start, p.p_end) d
                  left join public.duty_decisions dd on dd.period_id = p.id and dd.log_id = d.log_id
                  where d.employee_id = a.employee_id and d.site_id = a.site_id
                    and d.duty_date between greatest(a.start_date, p.p_start, e.date_hired) and least(coalesce(a.end_date, p.p_end), p.p_end)
                    and ((d.clean and dd.decision is distinct from 'not_count') or dd.decision = 'count'))::int as days
          from public.employee_assignments a
          join public.employees e on e.id = a.employee_id
          join public.sites s on s.id = a.site_id
          where e.employee_no in ('DEMO-0001', 'DEMO-0002', 'DEMO-0003', 'DEMO-0004')
            and a.start_date <= p.p_end and coalesce(a.end_date, p.p_end) >= p.p_start
            and greatest(a.start_date, p.p_start, e.date_hired) <= least(coalesce(a.end_date, p.p_end), p.p_end)
        ) c
        where c.days > 0
      ) v
    ) w;
  end loop;

  -- a guard's question about a released payslip, waiting for payroll
  insert into public.payroll_concerns (employee_id, payslip_id, category, description)
  select v_maria, s.id, 'night_differential', 'Demo: my night differential looks short on this payslip. I was on the 6 PM shift every duty.'
  from public.payslips s join public.payroll_periods pp on pp.id = s.payroll_period_id
  where s.employee_id = v_maria and pp.status = 'published'
  order by pp.period_end desc limit 1;
end $$;
