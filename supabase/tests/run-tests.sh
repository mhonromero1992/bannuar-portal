#!/usr/bin/env bash
# Tests schema.sql the way Supabase's API uses it: as anon, or as a signed-in user with a JWT.
#
# Needs a throwaway Postgres 15+ database where you can connect as a superuser (postgres) and as
# the role "authenticator" (created by supabase-stubs.sql). Then:
#   createdb bannuar_test
#   psql -d bannuar_test -f supabase/tests/supabase-stubs.sql
#   psql -d bannuar_test -f supabase/schema.sql
#   PGDATABASE=bannuar_test supabase/tests/run-tests.sh
# Never point it at a real project: it creates users and records.
set -u
H="-h ${PGHOST:-localhost} -p ${PGPORT:-5432} -d ${PGDATABASE:-bannuar_test}"
PASS=0; FAIL=0

pg() { psql $H -U postgres -tA -v ON_ERROR_STOP=1 -q -c "$1" 2>&1; }
as_user() { # uid sql
  psql $H -U authenticator -tA -v ON_ERROR_STOP=1 -q \
    -c "set role authenticated" -c "do \$\$ begin perform set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false); end \$\$" \
    -c "$2" 2>&1 | sed '/^$/d'
}
as_anon() {
  psql $H -U authenticator -tA -v ON_ERROR_STOP=1 -q -c "set role anon" -c "$1" 2>&1 | sed '/^$/d'
}
as_service() { # what an Edge Function does with the service role key
  psql $H -U authenticator -tA -v ON_ERROR_STOP=1 -q \
    -c "set role service_role" -c "do \$\$ begin perform set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); end \$\$" \
    -c "$1" 2>&1 | sed '/^$/d'
}
jget() { python3 -c "import json,sys
try: print(json.load(sys.stdin).get('$1', ''))
except Exception: print('not json')"; }
check() { # name actual expected
  if [[ "$2" == "$3" ]]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       expected: $3"; echo "       got:      $2"; fi
}
check_has() { # name actual substring
  if [[ "$2" == *"$3"* ]]; then PASS=$((PASS+1)); echo "  ok   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       expected to contain: $3"; echo "       got: $2"; fi
}
signup() { # email meta-json -> prints id or error
  pg "insert into auth.users (email, raw_user_meta_data) values ('$1', '$2'::jsonb) returning id"
}

echo "== Sign-up rules"
r=$(signup 'stranger@example.com' '{}'); check_has "sign-up without an invitation is refused" "$r" "BANNUAR_INVITE_REQUIRED"
msg=$(pg "select public.bootstrap_super_admin('admin@bannuar.test', 'Ana Admin')")
CODE=$(echo "$msg" | sed -E 's/^Invitation code ([A-Z0-9-]+)\..*/\1/')
check_has "bootstrap returns an invitation code" "$msg" "Invitation code"
r=$(signup 'admin@bannuar.test' '{"invite_code":"WRONG-CODE"}'); check_has "a wrong invitation code is refused" "$r" "BANNUAR_INVITE_REQUIRED"
ADMIN=$(signup 'admin@bannuar.test' "{\"invite_code\":\"$CODE\",\"full_name\":\"Ana Admin\"}")
check "the invited admin gets super_admin" "$(pg "select string_agg(role::text, ',') from public.user_roles where user_id = '$ADMIN'")" "super_admin"
r=$(pg "select public.bootstrap_super_admin('second@bannuar.test', 'X')"); check_has "bootstrap refuses a second time" "$r" "already exists"

HRCODE=$(as_user "$ADMIN" "select public.invite_staff('hr@bannuar.test', 'Hector HR', '{hr_admin}')")
HR=$(signup 'hr@bannuar.test' "{\"invite_code\":\"$HRCODE\"}")
check "HR invitation gives hr_admin" "$(pg "select string_agg(role::text, ',') from public.user_roles where user_id = '$HR'")" "hr_admin"
OPSCODE=$(as_user "$ADMIN" "select public.invite_staff('ops@bannuar.test', 'Olga Ops', '{operations}')")
OPS=$(signup 'ops@bannuar.test' "{\"invite_code\":\"$OPSCODE\"}")
MGCODE=$(as_user "$ADMIN" "select public.invite_staff('mgmt@bannuar.test', 'Mario Mgmt', '{management}')")
MGMT=$(signup 'mgmt@bannuar.test' "{\"invite_code\":\"$MGCODE\"}")
r=$(as_user "$HR" "select public.invite_staff('x@bannuar.test', 'X', '{hr_staff}')"); check_has "HR cannot invite (admin only)" "$r" "Only a super admin"
check "invitation code check (anon)" "$(as_anon "select public.check_staff_invitation('hr@bannuar.test', '$HRCODE')")" "f"

echo "== Org set-up by operations and HR"
AREA=$(as_user "$OPS" "insert into public.areas (name) values ('La Union') returning id")
SITE1=$(as_user "$OPS" "insert into public.sites (name, area_id, guards_required) values ('Post A', '$AREA', 3) returning id")
SITE2=$(as_user "$OPS" "insert into public.sites (name, area_id, guards_required) values ('Post B', '$AREA', 2) returning id")
check "operations created two posts" "$(pg "select count(*) from public.sites")" "2"
r=$(as_user "$OPS" "insert into public.employees (employee_no, first_name, last_name) values ('X1', 'A', 'B')"); check_has "operations cannot add employees" "$r" "row-level security"
as_user "$HR" "insert into public.employees (employee_no, first_name, last_name, birthdate, sex, mobile_no, position, status, date_hired, site_id, area_id) values
 ('g-001', 'Dante', 'Cruz', '1985-01-01', 'male', '0917 111 0001', 'Detachment Commander', 'active', '2018-01-01', '$SITE1', '$AREA'),
 ('G-002', 'Bea', 'Lim', '1992-02-02', 'female', '+63 917 111 0002', 'Lady Guard', 'active', '2023-01-10', '$SITE1', '$AREA'),
 ('G-003', 'Carlo', 'Diaz', '1990-03-03', 'male', '09171110003', 'Security Guard', 'active', current_date - 90, '$SITE1', '$AREA'),
 ('G-004', 'Edu', 'Tan', '1991-04-04', 'male', '09171110004', 'Security Guard', 'active', '2022-06-01', '$SITE2', '$AREA')" >/dev/null
check "employee numbers are stored in capitals" "$(pg "select employee_no from public.employees where first_name = 'Dante'")" "G-001"
DC_EMP=$(pg "select id from public.employees where employee_no = 'G-001'")
as_user "$OPS" "insert into public.site_supervisors (site_id, employee_id) values ('$SITE1', '$DC_EMP')" >/dev/null

echo "== Employee activation"
# The activate-employee Edge Function: begin_employee_activation as the service role (limits, log,
# one-time ticket), then auth.admin.createUser with the ticket in the user metadata.
begin_act() { as_service "select public.begin_employee_activation('$1', '$2', '$3', '${4:-203.0.113.9}')"; }
activate() { # employee_no birthdate mobile email [ip] -> new user id, or the error
  local t; t=$(begin_act "$1" "$2" "$3" "${5:-203.0.113.9}" | jget ticket)
  signup "$4" "{\"account_type\":\"employee\",\"employee_no\":\"$1\",\"birthdate\":\"$2\",\"mobile_no\":\"$3\",\"activation_ticket\":\"$t\"}"
}
r=$(as_anon "select public.check_employee_activation('G-002', '1992-02-02', '09171110002')"); check_has "the activation check is closed to the website and app (no unlimited guessing)" "$r" "permission denied"
r=$(as_user "$HR" "select public.begin_employee_activation('G-002', '1992-02-02', '09171110002', null)"); check_has "signed-in users cannot start an activation" "$r" "permission denied"
check "activation check: wrong birthdate" "$(begin_act 'G-002' '1999-01-01' '09171110002' | jget status)" "no_match"
check "activation check: unknown number gives the same answer" "$(begin_act 'NOPE-9' '1992-02-02' '09171110002' | jget status)" "no_match"
T1=$(begin_act 'g-002' '1992-02-02' '0917-111-0002')
check "activation check: match, typed loosely" "$(echo "$T1" | jget status)" "ok"
T1=$(echo "$T1" | jget ticket)
check "the ticket is 64 random hex characters" "$(echo "$T1" | grep -cE '^[0-9a-f]{64}$')" "1"
check "only the ticket's hash is stored" "$(pg "select count(*) filter (where token_hash = '$T1') || '/' || count(*) filter (where token_hash = encode(extensions.digest('$T1', 'sha256'), 'hex')) from public.activation_tickets")" "0/1"
r=$(signup 'g002@emp.bannuar.test' '{"account_type":"employee","employee_no":"G-002","birthdate":"1992-02-02","mobile_no":"09171110002"}')
check_has "the three facts alone no longer make a login (auth.signUp without a ticket)" "$r" "BANNUAR_ACTIVATION_FAILED"
r=$(signup 'g002@emp.bannuar.test' '{"account_type":"employee","employee_no":"G-002","birthdate":"1992-02-02","mobile_no":"09171110002","activation_ticket":"made-up"}')
check_has "a made-up ticket is refused" "$r" "BANNUAR_ACTIVATION_FAILED"
r=$(signup 'g002@emp.bannuar.test' "{\"account_type\":\"employee\",\"employee_no\":\"G-002\",\"birthdate\":\"1999-01-01\",\"mobile_no\":\"09171110002\",\"activation_ticket\":\"$T1\"}")
check_has "activation with the wrong birthdate is refused, even with a ticket" "$r" "BANNUAR_ACTIVATION_FAILED"
r=$(signup 'g001@emp.bannuar.test' "{\"account_type\":\"employee\",\"employee_no\":\"G-001\",\"birthdate\":\"1985-01-01\",\"mobile_no\":\"09171110001\",\"activation_ticket\":\"$T1\"}")
check_has "one employee's ticket does not open another's record" "$r" "BANNUAR_ACTIVATION_FAILED"
BEA=$(signup 'g002@emp.bannuar.test' "{\"account_type\":\"employee\",\"employee_no\":\"G-002\",\"birthdate\":\"1992-02-02\",\"mobile_no\":\"09171110002\",\"activation_ticket\":\"$T1\"}")
check "activated employee is linked" "$(pg "select employee_no from public.employees where user_id = '$BEA'")" "G-002"
check "the ticket is used up" "$(pg "select (used_at is not null) || ':' || (used_by = '$BEA') from public.activation_tickets where token_hash = encode(extensions.digest('$T1', 'sha256'), 'hex')")" "true:true"
check "birthdate, mobile and ticket leave the login's metadata (they would ride in every token)" "$(pg "select (raw_user_meta_data ? 'birthdate') || '/' || (raw_user_meta_data ? 'mobile_no') || '/' || (raw_user_meta_data ? 'activation_ticket') || '/' || (raw_user_meta_data ->> 'employee_no') from auth.users where id = '$BEA'")" "false/false/false/G-002"
# Supabase Auth confirms the email in the same transaction and saves its own copy of the metadata
pg "update auth.users set email_confirmed_at = now(), raw_user_meta_data = raw_user_meta_data || '{\"birthdate\":\"1992-02-02\",\"mobile_no\":\"09171110002\",\"activation_ticket\":\"x\",\"email_verified\":true}' where id = '$BEA'" >/dev/null
check "and stay out when Auth writes its own copy back" "$(pg "select (raw_user_meta_data ?| array['birthdate', 'mobile_no', 'activation_ticket']) || '/' || (raw_user_meta_data ->> 'email_verified') from auth.users where id = '$BEA'")" "false/true"
check "staff metadata is left alone" "$(pg "update auth.users set raw_user_meta_data = raw_user_meta_data || '{\"mobile_no\":\"x\"}' where id = '$HR' returning raw_user_meta_data ->> 'mobile_no'")" "x"
check "the activation is logged" "$(pg "select count(*) from public.activation_attempts where employee_no = 'G-002' and result = 'activated' and ip = '203.0.113.9'")" "1"
check "already active is reported" "$(begin_act 'G-002' '1992-02-02' '09171110002' | jget status)" "already_active"
pg "insert into public.activation_tickets (employee_id, token_hash) select id, encode(extensions.digest('kept-ticket', 'sha256'), 'hex') from public.employees where employee_no = 'G-002'" >/dev/null
r=$(signup 'g002b@emp.bannuar.test' '{"account_type":"employee","employee_no":"G-002","birthdate":"1992-02-02","mobile_no":"09171110002","activation_ticket":"kept-ticket"}')
check_has "a second account for the same employee is refused" "$r" "BANNUAR_ACTIVATION_FAILED"
T2=$(begin_act 'G-001' '1985-01-01' '09171110001' | jget ticket)
pg "update public.activation_tickets set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest('$T2', 'sha256'), 'hex')" >/dev/null
r=$(signup 'g001@emp.bannuar.test' "{\"account_type\":\"employee\",\"employee_no\":\"G-001\",\"birthdate\":\"1985-01-01\",\"mobile_no\":\"09171110001\",\"activation_ticket\":\"$T2\"}")
check_has "an expired ticket is refused (tickets last ten minutes)" "$r" "BANNUAR_ACTIVATION_FAILED"
DC=$(activate 'G-001' '1985-01-01' '09171110001' 'g001@emp.bannuar.test')
CARLO=$(activate 'G-003' '1990-03-03' '09171110003' 'g003@emp.bannuar.test')
for i in 1 2 3 4 5; do begin_act 'G-004' '2000-01-0'$i '09171110004' "198.51.100.$i" >/dev/null; done
check "five wrong tries lock the employee number, from any IP" "$(begin_act 'G-004' '1991-04-04' '09171110004' '192.0.2.50' | jget status)" "rate_limited"
pg "update public.activation_attempts set occurred_at = occurred_at - interval '31 minutes' where employee_no = 'G-004'" >/dev/null
EDU=$(activate 'G-004' '1991-04-04' '09171110004' 'g004@emp.bannuar.test' '192.0.2.50')
check "the lock lifts after 30 minutes" "$(pg "select employee_no from public.employees where user_id = '$EDU'")" "G-004"
for i in $(seq 1 20); do begin_act "GUESS-$i" '1990-01-01' '09170000000' '198.51.100.99' >/dev/null; done
check "twenty wrong tries lock the IP for an hour" "$(begin_act 'G-002' '1992-02-02' '09171110002' '198.51.100.99' | jget status)" "rate_limited"
check "other IPs are not affected" "$(begin_act 'G-002' '1992-02-02' '09171110002' '198.51.100.100' | jget status)" "already_active"
check "every try is logged with its IP and result" "$(pg "select count(*) || ':' || count(*) filter (where result = 'rate_limited') from public.activation_attempts where ip = '198.51.100.99'")" "21:1"
r=$(as_user "$BEA" "select count(*) from public.activation_attempts"); check_has "the attempt log is closed to the API" "$r" "permission denied"
r=$(as_anon "select count(*) from public.activation_tickets"); check_has "tickets are closed to the API" "$r" "permission denied"
check "the service role reads tickets" "$(as_service "select count(*) > 0 from public.activation_tickets")" "t"

echo "== Who sees which employees"
check "a guard sees only herself" "$(as_user "$BEA" "select string_agg(employee_no, ',' order by employee_no) from public.employees")" "G-002"
check "the detachment commander sees his post" "$(as_user "$DC" "select string_agg(employee_no, ',' order by employee_no) from public.employees")" "G-001,G-002,G-003"
check "management sees everyone" "$(as_user "$MGMT" "select count(*) from public.employees")" "4"
r=$(as_anon "select count(*) from public.employees"); check_has "anon cannot read employees" "$r" "permission denied"
r=$(as_user "$BEA" "update public.employees set position = 'Boss' where employee_no = 'G-002' returning id"); check "a guard cannot edit her 201 file" "$r" ""
check "full_name works through the API" "$(as_user "$BEA" "select public.full_name(e) from public.employees e")" "Bea Lim"

echo "== Government numbers"
as_user "$HR" "select public.save_government_ids('$DC_EMP', '01-2345678-9', '12-345678901-2', '1234-5678-9012', '123-456-789-000')" >/dev/null
BEA_EMP=$(pg "select id from public.employees where employee_no = 'G-002'")
as_user "$HR" "select public.save_government_ids('$BEA_EMP', '02-2345678-9', null, null, null)" >/dev/null
check "a guard reads her own numbers" "$(as_user "$BEA" "select sss_no from public.employee_government_ids")" "02-2345678-9"
check "the commander cannot read his guard's numbers" "$(as_user "$DC" "select count(*) from public.employee_government_ids")" "1"
r=$(as_user "$DC" "select * from public.get_government_ids('$BEA_EMP')"); check_has "get_government_ids refuses a non-HR" "$r" "Not allowed"
as_user "$HR" "select sss_no from public.get_government_ids('$BEA_EMP')" >/dev/null
check "an HR view is logged" "$(pg "select count(*) from public.audit_log where action = 'VIEW' and record_id = '$BEA_EMP'")" "1"
check "the audit trail masks numbers" "$(pg "select new_data->>'sss_no' from public.audit_log where table_name = 'employee_government_ids' and record_id = '$BEA_EMP' and action = 'INSERT'")" "***8-9"

echo "== Payroll"
P1=$(as_user "$HR" "insert into public.payroll_periods (label, period_start, period_end, pay_date) values ('Oct 16 to 31', '2026-10-16', '2026-10-31', '2026-11-05') returning id")
res=$(as_user "$HR" "select public.import_payslips('$P1', '[
  {\"employee_no\":\"g-002\",\"basic_pay\":\"7,020.00\",\"overtime_pay\":\"3510\",\"sss\":\"450\",\"philhealth\":\"250\",\"pagibig\":\"100\",\"deduction: Uniform\":\"200\"},
  {\"employee_no\":\"G-003\",\"basic_pay\":\"6000\",\"gross_pay\":\"6000\",\"total_deductions\":\"500\",\"net_pay\":\"5600\"},
  {\"employee_no\":\"NOPE\",\"basic_pay\":\"1\"},
  {\"employee_no\":\"G-004\",\"basic_pay\":\"abc\"}]'::jsonb)")
check "import: two rows in" "$(echo "$res" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["inserted"], len(d["errors"]), len(d["warnings"]))')" "2 2 1"
check "import: totals computed and extra lines kept" "$(pg "select gross_pay || '/' || total_deductions || '/' || net_pay || '/' || (deductions_detail->0->>'label') from public.payslips p join public.employees e on e.id = p.employee_id where e.employee_no = 'G-002'")" "10530.00/1000.00/9530.00/Uniform"
check "draft payslips are hidden from the guard" "$(as_user "$BEA" "select count(*) from public.payslips")" "0"
r=$(as_user "$OPS" "select public.import_payslips('$P1', '[]'::jsonb)"); check_has "operations cannot import payslips" "$r" "Only payroll"
check "publishing notifies two employees" "$(as_user "$HR" "select public.publish_payroll_period('$P1')")" "2"
check "after publishing the guard sees her own payslip only" "$(as_user "$BEA" "select count(*) || ':' || max(net_pay) from public.payslips")" "1:9530.00"
check "the notification leaves the amount out" "$(pg "select body from public.notifications where user_id = '$BEA' and kind = 'payslip'")" "Oct 16 to 31"
check "management cannot read payslips" "$(as_user "$MGMT" "select count(*) from public.payslips")" "0"
r=$(as_user "$HR" "select public.import_payslips('$P1', '[]'::jsonb)"); check_has "a published cutoff cannot be re-imported" "$r" "published"

echo "== Leave"
SIL=$(pg "select id from public.leave_types where code = 'SIL'")
MAT=$(pg "select id from public.leave_types where code = 'MATERNITY'")
CARLO_EMP=$(pg "select id from public.employees where employee_no = 'G-003'")
r=$(as_user "$CARLO" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date) values ('$CARLO_EMP', '$SIL', current_date + 5, current_date + 6) returning id")
check_has "SIL before one year of service is refused" "$r" "Not enough Service incentive leave credits"
r=$(as_user "$CARLO" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date) values ('$CARLO_EMP', '$MAT', current_date + 5, current_date + 6) returning id")
check_has "maternity leave is not offered to a male guard" "$r" "not available"
LR=$(as_user "$BEA" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, reason, status) values ('$BEA_EMP', '$SIL', current_date + 5, current_date + 7, 'Family', 'approved') returning id")
check "a guard's leave starts with her commander" "$(pg "select status || ':' || days from public.leave_requests where id = '$LR'")" "pending_supervisor:3.0"
check "the commander is notified" "$(pg "select count(*) from public.notifications where user_id = '$DC' and kind = 'leave_request'")" "1"
r=$(as_user "$BEA" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date) values ('$BEA_EMP', '$SIL', current_date + 6, current_date + 6) returning id")
check_has "overlapping leave is refused" "$r" "already leave filed"
r=$(as_user "$BEA" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date) values ('$BEA_EMP', '$SIL', current_date + 20, current_date + 22) returning id")
check_has "credits count pending leave (5 days a year)" "$r" "2.0 day(s) left"
r=$(as_user "$EDU" "select status from public.decide_leave_request('$LR', true)"); check_has "another post's guard cannot decide" "$r" "do not supervise"
r=$(as_user "$HR" "select status from public.decide_leave_request('$LR', true)")
check "HR may endorse in the commander's place, then it is with HR" "$r" "pending_hr"
pg "update public.leave_requests set status = 'pending_supervisor' where id = '$LR'" >/dev/null
CARLO_EMP_ID=$CARLO_EMP
check "the commander endorses with a reliever" "$(as_user "$DC" "select status from public.decide_leave_request('$LR', true, 'Covered', '$CARLO_EMP_ID')")" "pending_hr"
r=$(as_user "$DC" "select status from public.decide_leave_request('$LR', true)"); check_has "the commander cannot give final approval" "$r" "Only HR"
check "HR approves" "$(as_user "$HR" "select status from public.decide_leave_request('$LR', true, 'OK')")" "approved"
check "the reliever is told" "$(pg "select count(*) from public.notifications where user_id = '$CARLO' and kind = 'reliever'")" "1"
check "the reliever can see the request" "$(as_user "$CARLO" "select count(*) from public.leave_requests")" "1"
check "balances: 5 credits, 3 used" "$(as_user "$BEA" "select credits || '/' || used || '/' || pending from public.leave_balances where code = 'SIL'")" "5.0/3.0/0"
r=$(as_user "$BEA" "update public.leave_requests set status = 'approved' where id = '$LR' returning id"); check_has "a guard cannot edit a leave request directly" "$r" "permission denied"

echo "== Certificates of employment"
COE=$(as_user "$BEA" "insert into public.coe_requests (employee_id, purpose, include_compensation) values ('$BEA_EMP', 'bank_loan', true) returning id")
check "COE due in three days" "$(pg "select (due_at - created_at) = interval '3 days' from public.coe_requests where id = '$COE'")" "t"
r=$(as_user "$BEA" "insert into public.coe_requests (employee_id, purpose) values ('$BEA_EMP', 'bank_loan')"); check_has "one pending request per purpose" "$r" "already a pending request"
r=$(as_user "$HR" "select certificate_no from public.issue_certificate('$COE', 'Hector HR', 'HR Manager')"); check_has "compensation must be filled in when asked" "$r" "asks for compensation"
CERT=$(as_user "$HR" "select verification_code from public.issue_certificate('$COE', 'Hector HR', 'HR Manager', 'PHP 540.00 a day')")
check "certificate code has the 4-4-4 shape" "$(echo "$CERT" | grep -cE '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$')" "1"
check "anyone can verify a code, typed loosely" "$(as_anon "select public.verify_certificate(lower(replace('$CERT', '-', ' '))) ->> 'status'")" "valid"
check "verification shows the name" "$(as_anon "select public.verify_certificate('$CERT') ->> 'employee_name'")" "Bea Lim"
check "an unknown code" "$(as_anon "select public.verify_certificate('AAAA-BBBB-CCCC') ->> 'status'")" "not_found"
check "a malformed code" "$(as_anon "select public.verify_certificate('123') ->> 'status'")" "invalid_format"
r=$(as_anon "select count(*) from public.certificates"); check_has "anon cannot list certificates" "$r" "permission denied"
CERT_ID=$(pg "select id from public.certificates where verification_code = '$CERT'")
as_user "$HR" "select public.revoke_certificate('$CERT_ID', 'Issued with a typo')" >/dev/null
check "a revoked certificate says so" "$(as_anon "select public.verify_certificate('$CERT') ->> 'status'")" "revoked"
check "walk-in COE in one step" "$(as_user "$HR" "select employee_name from public.issue_certificate_for('$CARLO_EMP', 'employment', false, 'Hector HR', 'HR Manager')")" "Carlo Diaz"

echo "== Announcements"
A1=$(as_user "$HR" "insert into public.announcements (title, body, audience, site_ids, requires_ack, status) values ('Post A drill', 'Fire drill Friday', 'sites', '{$SITE1}', true, 'published') returning id")
check "post A guards notified, not post B" "$(pg "select count(*) filter (where user_id in ('$BEA', '$DC', '$CARLO')) || '/' || count(*) filter (where user_id = '$EDU') from public.notifications where kind = 'announcement'")" "3/0"
check "post B guard cannot see it" "$(as_user "$EDU" "select count(*) from public.announcements")" "0"
as_user "$BEA" "select public.mark_announcement_read('$A1', true)" >/dev/null
check "stats: audience, read, acknowledged" "$(as_user "$HR" "select audience_count || '/' || read_count || '/' || acknowledged_count from public.announcement_stats('$A1')")" "3/1/1"
r=$(as_user "$EDU" "select public.mark_announcement_read('$A1', true)"); check_has "outsiders cannot acknowledge" "$r" "not found"
r=$(as_user "$BEA" "insert into public.announcements (title, body) values ('x', 'y')"); check_has "guards cannot post announcements" "$r" "row-level security"

echo "== Website: applications and proposal requests"
check "anon applies" "$(as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent, status, staff_notes) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', true, 'new', null)" && echo done)" "done"
as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent, status, source) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', true, 'hired', 'x')" >/dev/null
check "a status sent by the website is reset to new" "$(pg "select string_agg(distinct status || '/' || source, ',') from public.job_applications")" "new/website"
r=$(as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent) values ('Rico', 'Abad', '12345', 'Agoo', true)"); check_has "a bad mobile number is refused" "$r" "mobile number"
r=$(as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', false)"); check_has "consent is required" "$r" "row-level security"
as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', true)" >/dev/null
as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', true)" >/dev/null
r=$(as_anon "insert into public.job_applications (first_name, last_name, mobile_no, city, privacy_consent) values ('Rico', 'Abad', '0918 222 3333', 'Agoo', true)"); check_has "a fourth application in a day is refused" "$r" "already have your application"
r=$(as_anon "select count(*) from public.job_applications"); check_has "anon cannot read applications" "$r" "permission denied"
check "HR sees them" "$(as_user "$HR" "select count(*) from public.job_applications")" "3"
check "HR was notified" "$(pg "select count(*) from public.notifications where user_id = '$HR' and kind = 'job_application'")" "3"
APP=$(pg "select id from public.job_applications order by created_at limit 1")
NEW_EMP=$(as_user "$HR" "select public.hire_applicant('$APP', 'G-010', current_date)")
check "hiring creates a floating employee" "$(pg "select employee_no || ':' || status || ':' || (floating_since = current_date) from public.employees where id = '$NEW_EMP'")" "G-010:floating:true"
as_user "$HR" "insert into public.job_openings (title, slug, location, status) values ('Security Guard', 'security-guard-la-union', 'La Union', 'open'), ('Draft role', 'draft-role', 'La Union', 'draft')" >/dev/null
check "anon sees only open jobs" "$(as_anon "select string_agg(slug, ',') from public.job_openings")" "security-guard-la-union"
check "anon asks for a proposal" "$(as_anon "insert into public.inquiries (company, contact_name, phone, guards_needed, coverage, privacy_consent) values ('Acme Mart', 'Lorna', '(072) 555 0101', 4, '24h', true)" && echo done)" "done"
check "operations notified of the proposal request" "$(pg "select count(*) from public.notifications where user_id = '$OPS' and kind = 'inquiry'")" "1"

echo "== Deployment and floating status"
as_user "$OPS" "select public.deploy_employees(array['$NEW_EMP']::uuid[], '$SITE2')" >/dev/null
check "deploying clears floating" "$(pg "select status || ':' || coalesce(floating_since::text, 'none') from public.employees where id = '$NEW_EMP'")" "active:none"
as_user "$OPS" "select public.deploy_employees(array['$NEW_EMP']::uuid[], null)" >/dev/null
check "back to floating starts the clock" "$(pg "select status || ':' || (floating_since = current_date) from public.employees where id = '$NEW_EMP'")" "floating:true"
r=$(as_user "$BEA" "select public.deploy_employees(array['$BEA_EMP']::uuid[], '$SITE2')"); check_has "a guard cannot deploy" "$r" "Operations or HR only"

echo "== Pay rules, rates and assignment history"
PAYCODE=$(as_user "$ADMIN" "select public.invite_staff('pay@bannuar.test', 'Paz Payroll', '{payroll}')")
PAY=$(signup 'pay@bannuar.test' "{\"invite_code\":\"$PAYCODE\"}")
check "the Standard rule is the agency default" "$(as_user "$PAY" "select name || ':' || is_default from public.pay_rules where client_id is null")" "Standard:true"
CLIENT=$(as_user "$OPS" "insert into public.clients (name) values ('Acme Corp') returning id")
as_user "$PAY" "insert into public.pay_rules (client_id, name, is_default, formulas) values ('$CLIENT', 'Acme', true, '[{\"code\":\"basic\",\"label\":\"Basic pay\",\"formula\":\"rate * regular_hours\",\"thirteenth\":true}]')" >/dev/null
check "payroll adds a client rule" "$(pg "select count(*) from public.pay_rules where client_id = '$CLIENT' and is_default")" "1"
r=$(as_user "$PAY" "insert into public.pay_rules (client_id, name, formulas) values ('$CLIENT', 'Bad', '[{\"code\":\"Bad Code\",\"label\":\"x\",\"formula\":\"1\"}]')"); check_has "a formula line needs a proper code" "$r" "small letters"
r=$(as_user "$PAY" "insert into public.pay_rules (client_id, name, formulas) values ('$CLIENT', 'Twice', '[{\"code\":\"a\",\"label\":\"A\",\"formula\":\"1\"},{\"code\":\"a\",\"label\":\"B\",\"formula\":\"2\"}]')"); check_has "codes are unique within a rule" "$r" "Two formula lines"
as_user "$PAY" "insert into public.pay_rules (client_id, name, is_default) values ('$CLIENT', 'Acme night posts', true)" >/dev/null
check "a new default rule replaces the old one" "$(pg "select string_agg(name, ',') from public.pay_rules where client_id = '$CLIENT' and is_default")" "Acme night posts"
r=$(as_user "$OPS" "insert into public.pay_rules (name) values ('Ops rule')"); check_has "operations cannot add pay rules" "$r" "row-level security"
as_user "$OPS" "update public.sites set client_id = '$CLIENT', duty_hours = 12, first_shift_start = '06:00' where id = '$SITE2'" >/dev/null
as_user "$PAY" "insert into public.pay_rates (site_id, effective_from, hourly_rate) values ('$SITE2', '2026-01-01', 90), ('$SITE2', '2026-07-01', 95)" >/dev/null
as_user "$PAY" "insert into public.pay_rates (client_id, effective_from, hourly_rate) values ('$CLIENT', '2026-01-01', 80)" >/dev/null
check "payroll sets post and client rates" "$(pg "select count(*) from public.pay_rates")" "3"
r=$(as_user "$PAY" "insert into public.pay_rates (site_id, client_id, effective_from, hourly_rate) values ('$SITE2', '$CLIENT', '2026-02-01', 1)"); check_has "a rate belongs to a post or a client, not both" "$r" "check constraint"
r=$(as_user "$PAY" "insert into public.pay_rates (site_id, effective_from, hourly_rate) values ('$SITE2', '2026-01-01', 70)"); check_has "one rate per post per date" "$r" "duplicate key"
NIGHT=$(pg "select id from public.pay_rules where name = 'Acme night posts'")
as_user "$PAY" "select public.set_site_pay_rule('$SITE2', '$NIGHT')" >/dev/null
check "payroll picks a post's pay rule" "$(pg "select (pay_rule_id = '$NIGHT')::text from public.sites where id = '$SITE2'")" "true"
r=$(as_user "$PAY" "select public.set_site_pay_rule('$SITE1', '$NIGHT')"); check_has "a rule of another client is refused" "$r" "another client"
r=$(as_user "$OPS" "select public.set_site_pay_rule('$SITE2', null)"); check_has "only payroll picks pay rules" "$r" "Payroll only"
check "HR reads rates, operations does not" "$(as_user "$HR" "select count(*) from public.pay_rates"):$(as_user "$OPS" "select count(*) from public.pay_rates")" "3:0"
check "guards read no rates or rules" "$(as_user "$EDU" "select count(*) from public.pay_rates"):$(as_user "$EDU" "select count(*) from public.pay_rules")" "0:0"
check "every employee at a post has an assignment from hiring" "$(pg "select string_agg(e.employee_no || '@' || a.start_date, ',' order by e.employee_no) from public.employee_assignments a join public.employees e on e.id = a.employee_id where e.employee_no in ('G-001', 'G-002', 'G-004')")" "G-001@2018-01-01,G-002@2023-01-10,G-004@2022-06-01"
EDU_EMP=$(pg "select id from public.employees where employee_no = 'G-004'")
r=$(as_user "$OPS" "select public.deploy_employees(array['$EDU_EMP']::uuid[], '$SITE1', 10)"); check_has "a duty is 8, 12 or 24 hours" "$r" "8, 12 or 24"
as_user "$OPS" "select public.deploy_employees(array['$EDU_EMP']::uuid[], '$SITE1', 8, '22:00')" >/dev/null
check "deploying opens an assignment on the chosen shift" "$(pg "select s.name || ' ' || a.duty_hours || 'h ' || to_char(a.shift_start, 'HH24:MI') from public.employee_assignments a join public.sites s on s.id = a.site_id where a.employee_id = '$EDU_EMP' and a.end_date is null")" "Post A 8h 22:00"
check "and ends the previous one yesterday" "$(pg "select (end_date = public.manila_today() - 1)::text from public.employee_assignments where employee_id = '$EDU_EMP' and start_date = '2022-06-01'")" "true"
as_user "$OPS" "select public.deploy_employees(array['$EDU_EMP']::uuid[], '$SITE2')" >/dev/null
check "a second move the same day replaces today's assignment" "$(pg "select count(*) || ' ' || string_agg(s.name || ' ' || a.duty_hours || 'h', ',' order by a.start_date) from public.employee_assignments a join public.sites s on s.id = a.site_id where a.employee_id = '$EDU_EMP'")" "2 Post B 12h,Post B 12h"
r=$(as_user "$HR" "insert into public.employee_assignments (employee_id, site_id, start_date, end_date) values ('$EDU_EMP', '$SITE1', '2023-01-01', '2023-02-01')"); check_has "assignments of one employee cannot overlap" "$r" "overlap"
as_user "$OPS" "update public.employee_assignments set end_date = '2022-12-31' where employee_id = '$EDU_EMP' and start_date = '2022-06-01'" >/dev/null
r=$(as_user "$OPS" "insert into public.employee_assignments (employee_id, site_id, start_date, end_date, duty_hours, shift_start) values ('$EDU_EMP', '$SITE1', '2023-01-01', public.manila_today() - 1, 12, '18:00') returning duty_hours")
check "operations corrects the history" "$r" "12"
r=$(as_user "$PAY" "insert into public.employee_assignments (employee_id, site_id, start_date, end_date) values ('$EDU_EMP', '$SITE1', '2020-01-01', '2020-12-31')"); check_has "payroll reads but does not change assignments" "$r" "row-level security"
check "a guard sees only their own assignments" "$(as_user "$EDU" "select count(*) from public.employee_assignments"):$(as_user "$BEA" "select count(*) from public.employee_assignments")" "3:1"
check "a commander sees his post's assignments" "$(as_user "$DC" "select count(*) from public.employee_assignments")" "$(pg "select count(*) from public.employee_assignments where site_id = '$SITE1' or employee_id = '$DC_EMP'")"

echo "== Profile changes, payroll concerns, documents"
PC=$(as_user "$BEA" "insert into public.profile_change_requests (employee_id, changes) values ('$BEA_EMP', '{\"mobile_no\":\"09179998888\"}') returning id")
r=$(as_user "$BEA" "insert into public.profile_change_requests (employee_id, changes) values ('$BEA_EMP', '{\"position\":\"Boss\"}')"); check_has "only contact details can be requested" "$r" "Ask HR to change position"
as_user "$HR" "select public.decide_profile_change('$PC', true, 'Updated')" >/dev/null
check "approved change is applied" "$(pg "select mobile_no from public.employees where id = '$BEA_EMP'")" "09179998888"
PS=$(pg "select p.id from public.payslips p where p.employee_id = '$BEA_EMP'")
CN=$(as_user "$BEA" "insert into public.payroll_concerns (employee_id, payslip_id, category, description, status) values ('$BEA_EMP', '$PS', 'overtime', 'Missing 4 hours OT', 'resolved') returning id")
check "a new concern is open" "$(pg "select status from public.payroll_concerns where id = '$CN'")" "open"
as_user "$HR" "update public.payroll_concerns set status = 'resolved', resolution = 'Added to next cutoff' where id = '$CN'" >/dev/null
check "the guard hears back" "$(pg "select title from public.notifications where user_id = '$BEA' and kind = 'payroll_concern'")" "Your payroll concern is resolved"
LIC=$(pg "select id from public.document_types where code = 'SECURITY_LICENSE'")
D1=$(as_user "$BEA" "insert into public.employee_documents (employee_id, document_type_id, document_no, expires_on, status) values ('$BEA_EMP', '$LIC', 'LIC-1', current_date + 700, 'verified') returning status")
check "an upload from the app waits for HR review" "$D1" "pending_review"
r=$(as_user "$BEA" "insert into public.employee_documents (employee_id, document_type_id) select '$BEA_EMP', id from public.document_types where code = 'BIR_2316'"); check_has "guards cannot upload HR-only documents" "$r" "Bring this document"
as_user "$HR" "insert into public.employee_documents (employee_id, document_type_id, document_no, expires_on) values ('$CARLO_EMP', '$LIC', 'LIC-2', current_date + 10)" >/dev/null
check "expiring license shows on the alerts" "$(as_user "$HR" "select type_code || ':' || state || ':' || days_left from public.document_alerts where employee_id = '$CARLO_EMP'")" "SECURITY_LICENSE:expiring:10"
check "the commander sees his guard's documents" "$(as_user "$DC" "select count(*) from public.employee_documents where employee_id = '$CARLO_EMP'")" "1"
check "reminders go out on the 10th day? no, only on 60/30/14/7/1/0/-1" "$(pg "select public.send_document_expiry_reminders()")" "0"
check "compliance gaps list missing NBI etc." "$(as_user "$HR" "select count(*) > 0 from public.compliance_gaps where type_code = 'NBI_CLEARANCE'")" "t"

echo "== Storage"
check "a guard uploads to her own folder" "$(as_user "$BEA" "insert into storage.objects (bucket_id, name) values ('employee-files', '$BEA_EMP/uploads/license.jpg')" && echo done)" "done"
r=$(as_user "$BEA" "insert into storage.objects (bucket_id, name) values ('employee-files', '$CARLO_EMP/uploads/x.jpg')"); check_has "not into someone else's folder" "$r" "row-level security"
r=$(as_user "$BEA" "insert into storage.objects (bucket_id, name) values ('employee-files', '$BEA_EMP/contracts/x.pdf')"); check_has "not outside uploads/" "$r" "row-level security"
check "the website uploads a resume" "$(as_anon "insert into storage.objects (bucket_id, name) values ('applications', 'incoming/abc-resume.pdf')" && echo done)" "done"
check "anon cannot list resumes" "$(as_anon "select count(*) from storage.objects")" "0"
check "HR can read the resume" "$(as_user "$HR" "select count(*) from storage.objects where bucket_id = 'applications'")" "1"

echo "== Admin tools"
r=$(as_user "$ADMIN" "select public.set_user_roles('$ADMIN', '{hr_admin}')"); check_has "the last super admin stays" "$r" "Keep at least one super admin"
as_user "$ADMIN" "select public.set_user_roles('$OPS', '{operations,management}')" >/dev/null
check "roles replaced" "$(pg "select string_agg(role::text, ',' order by role) from public.user_roles where user_id = '$OPS'")" "operations,management"
as_user "$ADMIN" "select public.set_user_roles('$DC', '{supervisor}')" >/dev/null
check "an employee keeps the employee role" "$(pg "select string_agg(role::text, ',' order by role) from public.user_roles where user_id = '$DC'")" "supervisor,employee"
as_user "$HR" "select public.admin_reset_password('$BEA', 'Temp-Pass-2026')" >/dev/null
check "HR resets a guard's password" "$(pg "select (encrypted_password = extensions.crypt('Temp-Pass-2026', encrypted_password)) || ':' || p.must_change_password from auth.users u join public.profiles p on p.id = u.id where u.id = '$BEA'")" "true:true"
r=$(as_user "$HR" "select public.admin_reset_password('$OPS', 'Temp-Pass-2026')"); check_has "HR cannot reset a staff password" "$r" "Only a super admin"
check "list_users shows staff only" "$(as_user "$ADMIN" "select count(*) from public.list_users()")" "6"
check "list_users is empty for non-admins" "$(as_user "$HR" "select count(*) from public.list_users()")" "0"
check "dashboard for staff" "$(as_user "$MGMT" "select (public.portal_dashboard() ->> 'sites_active')")" "2"
r=$(as_user "$BEA" "select public.portal_dashboard()"); check_has "no dashboard for guards" "$r" "Staff only"
check "my_access for a guard" "$(as_user "$BEA" "select public.my_access() -> 'employee' ->> 'employee_no'")" "G-002"
r=$(as_anon "select public.bootstrap_super_admin('evil@x.com', 'Evil')"); check_has "anon cannot bootstrap" "$r" "permission denied"
r=$(as_user "$BEA" "select public.notify_user('$BEA', 'x', 'y', 'z', null)"); check_has "notify helpers are internal" "$r" "permission denied"
check "audit trail records leave decisions" "$(pg "select count(*) > 0 from public.audit_log where table_name = 'leave_requests' and action = 'UPDATE'")" "t"

echo "== Devices for push"
as_user "$BEA" "select public.register_device_token('fcm-token-1', 'android', '1.0.0 (1)')" >/dev/null
check "a guard registers her phone" "$(pg "select (user_id = '$BEA') || ':' || platform || ':' || app_version from public.device_tokens where token = 'fcm-token-1'")" "true:android:1.0.0 (1)"
check "a guard sees only her own phones" "$(as_user "$CARLO" "select count(*) from public.device_tokens")" "0"
as_user "$CARLO" "select public.register_device_token('fcm-token-1', 'android', '1.0.0 (1)')" >/dev/null
check "a phone passed to another guard moves to them" "$(pg "select user_id = '$CARLO' from public.device_tokens where token = 'fcm-token-1'")" "t"
r=$(as_anon "select public.register_device_token('x', 'android', null)"); check_has "anon cannot register a phone" "$r" "permission denied"
r=$(as_user "$BEA" "select public.register_device_token('fcm-token-2', 'symbian', null)"); check_has "an unknown platform is refused" "$r" "device_tokens_platform_check"
check "sign-out removes the phone" "$(as_user "$CARLO" "delete from public.device_tokens where token = 'fcm-token-1' returning token")" "fcm-token-1"

echo "== Attendance: time in and out with a selfie and the post's location"
# Post A gets a location (a point in Makati) and the default allowed distance; Post B has none yet
as_user "$OPS" "update public.sites set latitude = 14.554700, longitude = 121.024400 where id = '$SITE1'" >/dev/null
check "a post's allowed distance starts at 150 m" "$(pg "select geofence_radius_m from public.sites where id = '$SITE1'")" "150"
r=$(as_user "$OPS" "update public.sites set latitude = 14.5 where id = '$SITE2'"); check_has "a post's location needs both numbers" "$r" "sites_location_check"
r=$(as_user "$OPS" "update public.sites set latitude = 121.0244, longitude = 214.5547 where id = '$SITE2'"); check_has "and a point on the map" "$r" "sites_location_check"
r=$(as_user "$OPS" "update public.sites set geofence_radius_m = 5 where id = '$SITE2'"); check_has "the allowed distance is at least 20 m" "$r" "geofence_radius_m"
selfie() { # uid employee_id name -> the uploaded photo's path
  as_user "$1" "insert into storage.objects (bucket_id, name) values ('attendance-photos', '$2/$3.jpg')" >/dev/null; echo "$2/$3.jpg"; }
logat() { as_user "$1" "select public.log_attendance('$2', '$3', $4, $5, $6, ${7:-null})"; } # uid kind path lat lon accuracy [mock]
P1=$(selfie "$BEA" "$BEA_EMP" in-1)
check "a guard uploads her selfie to her own folder" "$(pg "select count(*) from storage.objects where bucket_id = 'attendance-photos' and name = '$P1'")" "1"
r=$(as_user "$BEA" "insert into storage.objects (bucket_id, name) values ('attendance-photos', '$CARLO_EMP/x.jpg')"); check_has "not into another guard's folder" "$r" "row-level security"
R1=$(logat "$BEA" time_in "$P1" 14.5552 121.0244 12)
check "56 m from the post with good GPS: at the post" "$(echo "$R1" | jget location_check):$(echo "$R1" | jget distance_m)" "at_post:56"
check "the time is the database's own" "$(pg "select abs(extract(epoch from now() - logged_at)) < 60 from public.attendance_logs where photo_path = '$P1'")" "t"
check "the post, its allowed distance and the GPS error are kept with the log" "$(pg "select (site_id = '$SITE1') || ':' || radius_m || ':' || accuracy_m || ':' || latitude from public.attendance_logs where photo_path = '$P1'")" "true:150:12:14.555200"
check "the answer names the post" "$(echo "$R1" | jget site_name)" "Post A"
R=$(logat "$BEA" time_in "$P1" 1 1 5)
check "sending the same photo again returns the first log" "$(echo "$R" | jget id)" "$(echo "$R1" | jget id)"
check "and logs once" "$(pg "select count(*) || ':' || max(location_check) from public.attendance_logs where photo_path = '$P1'")" "1:at_post"
R=$(logat "$BEA" time_out "$(selfie "$BEA" "$BEA_EMP" out-1)" 14.5647 121.0244 20)
check "a kilometre away: away from the post, and still logged" "$(echo "$R" | jget location_check):$(echo "$R" | jget distance_m)" "away:1112"
R=$(logat "$BEA" time_in "$(selfie "$BEA" "$BEA_EMP" in-2)" 14.5552 121.0244 300)
check "near the post with rough GPS (300 m): cannot tell" "$(echo "$R" | jget location_check)" "unsure"
R=$(logat "$BEA" time_in "$(selfie "$BEA" "$BEA_EMP" in-3)" 14.5565 121.0244 80)
check "200 m away with an 80 m error: cannot tell" "$(echo "$R" | jget location_check):$(echo "$R" | jget distance_m)" "unsure:200"
R=$(logat "$BEA" time_out "$(selfie "$BEA" "$BEA_EMP" out-2)" null null null)
check "no location from the phone: logged as such" "$(echo "$R" | jget location_check)" "no_location"
logat "$BEA" time_in "$(selfie "$BEA" "$BEA_EMP" in-4)" 14.5547 121.0244 5 true >/dev/null
check "a mock location app is noted" "$(pg "select mock_location from public.attendance_logs where photo_path = '$BEA_EMP/in-4.jpg'")" "t"
R=$(logat "$EDU" time_in "$(selfie "$EDU" "$(pg "select id from public.employees where user_id = '$EDU'")" in-1)" 14.5547 121.0244 5)
check "a post without a location yet: noted for HR" "$(echo "$R" | jget location_check)" "post_not_set"
pg "update public.employees set site_id = null where id = '$CARLO_EMP'" >/dev/null
R=$(logat "$CARLO" time_in "$(selfie "$CARLO" "$CARLO_EMP" in-1)" 14.5547 121.0244 5)
check "a guard with no post: noted for HR" "$(echo "$R" | jget location_check)" "no_post"
pg "update public.employees set site_id = '$SITE1' where id = '$CARLO_EMP'" >/dev/null
R=$(logat "$CARLO" time_in "$(selfie "$CARLO" "$CARLO_EMP" in-2)" 14.5547 121.0244 5)
check "back at a post: at the post" "$(echo "$R" | jget location_check)" "at_post"
r=$(logat "$BEA" lunch "$(selfie "$BEA" "$BEA_EMP" in-5)" 14.5547 121.0244 5); check_has "only time in or time out" "$r" "Choose time in or time out"
r=$(logat "$BEA" time_in "$CARLO_EMP/in-2.jpg" 14.5547 121.0244 5); check_has "another guard's logged photo is refused" "$r" "not yours"
selfie "$CARLO" "$CARLO_EMP" spare >/dev/null
r=$(logat "$BEA" time_in "$CARLO_EMP/spare.jpg" 14.5547 121.0244 5); check_has "and so is one of their uploads" "$r" "Take your photo first"
r=$(logat "$BEA" time_in "$BEA_EMP/never-uploaded.jpg" 14.5547 121.0244 5); check_has "a photo that never arrived is refused" "$r" "did not arrive"
P6=$(selfie "$BEA" "$BEA_EMP" in-6)
pg "update storage.objects set created_at = now() - interval '2 hours' where name = '$P6'" >/dev/null
r=$(logat "$BEA" time_in "$P6" 14.5547 121.0244 5); check_has "an old upload is refused (the photo is taken at the log)" "$r" "did not arrive"
r=$(logat "$BEA" time_in "$(selfie "$BEA" "$BEA_EMP" in-7)" 95 121.0244 5); check_has "a latitude off the map is refused" "$r" "not valid"
r=$(logat "$BEA" time_in "$(selfie "$BEA" "$BEA_EMP" in-8)" 14.5547 121.0244 null); check_has "a location without its GPS error is refused" "$r" "not valid"
r=$(logat "$HR" time_in "$BEA_EMP/in-5.jpg" 14.5547 121.0244 5); check_has "staff without a 201 file do not log" "$r" "Only employees"
r=$(as_anon "select public.log_attendance('time_in', 'x/y.jpg', null, null, null, null)"); check_has "anon cannot log" "$r" "permission denied"
pg "update public.employees set status = 'resigned' where user_id = '$EDU'" >/dev/null
r=$(logat "$EDU" time_in "$(selfie "$EDU" "$(pg "select id from public.employees where user_id = '$EDU'")" in-2)" 14.5547 121.0244 5); check_has "a separated employee cannot log" "$r" "record is closed"
pg "update public.employees set status = 'active' where user_id = '$EDU'" >/dev/null
r=$(as_user "$BEA" "insert into public.attendance_logs (employee_id, kind, photo_path, location_check) values ('$BEA_EMP', 'time_in', '$BEA_EMP/in-5.jpg', 'at_post')"); check_has "a guard cannot write a log directly" "$r" "permission denied"
r=$(as_user "$BEA" "update public.attendance_logs set location_check = 'at_post'"); check_has "or change one" "$r" "permission denied"
r=$(as_user "$BEA" "delete from public.attendance_logs"); check_has "or delete one" "$r" "permission denied"
r=$(as_user "$BEA" "update storage.objects set name = '$BEA_EMP/swapped.jpg' where name = '$P1' returning name"); check "or swap her photo" "$r" ""
r=$(as_user "$BEA" "select public.geo_distance_m(0, 0, 1, 1)"); check_has "the distance helper is internal" "$r" "permission denied"
check "a guard sees only her own logs" "$(as_user "$BEA" "select count(*) || ':' || count(*) filter (where employee_id <> '$BEA_EMP') from public.attendance_logs")" "6:0"
check "the commander sees the logs at his post, not other posts" "$(as_user "$DC" "select count(*) || ':' || count(*) filter (where site_id <> '$SITE1' or site_id is null) from public.attendance_logs")" "7:0"
check "HR sees every log" "$(as_user "$HR" "select count(*) from public.attendance_logs")" "9"
check "management sees every log" "$(as_user "$MGMT" "select count(*) from public.attendance_logs")" "9"
check "the commander opens selfies from his post" "$(as_user "$DC" "select count(*) from storage.objects where name = '$P1'")" "1"
check "a guard at another post does not" "$(as_user "$EDU" "select count(*) from storage.objects where name = '$P1'")" "0"
check "HR opens them" "$(as_user "$HR" "select count(*) from storage.objects where name = '$P1'")" "1"
check "the guard opens her own" "$(as_user "$BEA" "select count(*) from storage.objects where name = '$P1'")" "1"

echo "== schema.sql runs again over existing data"
before=$(pg "select (select count(*) from public.employees) || '/' || (select count(*) from public.notifications) || '/' || (select count(*) from public.activation_attempts) || '/' || (select count(*) from public.leave_types)")
r=$(psql $H -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../schema.sql" 2>&1 | grep -iv '^NOTICE' || true)
check "re-running schema.sql succeeds" "$r" ""
check "and keeps every record" "$(pg "select (select count(*) from public.employees) || '/' || (select count(*) from public.notifications) || '/' || (select count(*) from public.activation_attempts) || '/' || (select count(*) from public.leave_types)")" "$before"
check "attendance logs are kept, and still closed to direct writes" "$(pg "select count(*) from public.attendance_logs"):$(as_user "$BEA" "delete from public.attendance_logs" | grep -c 'permission denied')" "9:1"
check "activation stays closed to anon after a re-run" "$(as_anon "select public.check_employee_activation('G-002', '1992-02-02', '09171110002')" | grep -c 'permission denied')" "1"

echo "== Files in Amazon S3 (the database's half: who may store or open what, and under which key)"
TODAY=$(TZ=Asia/Manila date +%Y-%m-%d); MONTH=$(TZ=Asia/Manila date +%Y/%m)
begin() { as_user "$1" "select public.begin_file_upload($2)"; }   # uid "args"
stored() { as_service "select public.finish_file_upload('$1', $2)" >/dev/null; }   # id size: what the Edge Function does once S3 has it
nread() { as_user "$1" "select count(*) from public.authorize_file_reads(array[$2]::text[])"; }   # uid "'key', ..."
check "document types are sorted into the three folders" "$(pg "select string_agg(code || '=' || storage_folder, ',' order by code) from public.document_types where code in ('SECURITY_LICENSE', 'NBI_CLEARANCE', 'DRUG_TEST', 'BIRTH_CERT', 'EMPLOYMENT_CONTRACT')")" "BIRTH_CERT=201-file,DRUG_TEST=work-requirements,EMPLOYMENT_CONTRACT=201-file,NBI_CLEARANCE=work-requirements,SECURITY_LICENSE=lesp"
r=$(as_user "$HR" "update public.document_types set storage_folder = 'payslips' where code = 'BIR_2316'"); check_has "and only those three" "$r" "storage_folder_check"
LESP_T=$(pg "select id from public.document_types where code = 'SECURITY_LICENSE'")
NBI_T=$(pg "select id from public.document_types where code = 'NBI_CLEARANCE'")
CONTRACT_T=$(pg "select id from public.document_types where code = 'EMPLOYMENT_CONTRACT'")
B1=$(begin "$BEA" "'document', 'image/jpeg', 200000, null, '$LESP_T'"); K1=$(echo "$B1" | jget key)
check "a guard's LESP renewal goes to her own LESP folder" "$(echo "$K1" | grep -cE "^employees/G-002/lesp/${TODAY}_security-license_[0-9a-f]{10}\.jpg$")" "1"
B2=$(begin "$BEA" "'document', 'application/pdf', 300000, null, '$NBI_T'"); K2=$(echo "$B2" | jget key)
check "her NBI clearance goes to work-requirements" "$(echo "$K2" | grep -cE "^employees/G-002/work-requirements/${TODAY}_nbi-clearance_[0-9a-f]{10}\.pdf$")" "1"
r=$(begin "$BEA" "'document', 'application/pdf', 300000, null, '$CONTRACT_T'"); check_has "a document HR keeps (the contract) is refused" "$r" "Bring this document"
r=$(begin "$BEA" "'document', 'image/jpeg', 200000, '$CARLO_EMP', '$LESP_T'"); check_has "never into another guard's folder" "$r" "only upload your own"
r=$(begin "$BEA" "'document', 'application/zip', 200000, null, '$LESP_T'"); check_has "only PDFs and photos" "$r" "cannot be uploaded"
r=$(begin "$BEA" "'document', 'image/jpeg', 20000000, null, '$LESP_T'"); check_has "of up to 10 MB" "$r" "too large"
r=$(begin "$BEA" "'payslip', 'application/pdf', 2000"); check_has "payslips are never stored (their PDF is made on download)" "$r" "Unknown kind of upload"
r=$(as_anon "select public.begin_file_upload('document', 'image/jpeg', 2000)"); check_has "anon cannot upload" "$r" "permission denied"
B3=$(begin "$HR" "'document', 'application/pdf', 400000, '$CARLO_EMP', '$CONTRACT_T'"); K3=$(echo "$B3" | jget key)
check "HR files a contract in Carlo's 201-file folder" "$(echo "$K3" | grep -cE "^employees/G-003/201-file/${TODAY}_employment-contract_[0-9a-f]{10}\.pdf$")" "1"
r=$(as_user "$BEA" "select public.finish_file_upload('$(echo "$B1" | jget id)', 200000)"); check_has "only the files service marks a file stored" "$r" "permission denied"
r=$(as_user "$HR" "insert into public.stored_files (object_key, purpose, folder, content_type, max_bytes) values ('employees/G-002/lesp/x.jpg', 'document', 'lesp', 'image/jpeg', 10)"); check_has "nobody writes the file list directly" "$r" "permission denied"
r=$(as_user "$BEA" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$BEA_EMP', '$LESP_T', '$K1')"); check_has "a file S3 does not have yet cannot be attached" "$r" "did not arrive"
r=$(as_service "select public.finish_file_upload('$(echo "$B1" | jget id)', 999999999)"); check_has "a size over the limit is not marked stored" "$r" "Upload not found"
stored "$(echo "$B1" | jget id)" 200000; stored "$(echo "$B2" | jget id)" 300000; stored "$(echo "$B3" | jget id)" 400000
check "once stored, the renewal is attached and waits for HR" "$(as_user "$BEA" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$BEA_EMP', '$LESP_T', '$K1') returning status")" "pending_review"
r=$(as_user "$BEA" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$BEA_EMP', '$LESP_T', '$K2')"); check_has "a file must match its document type" "$r" "did not arrive"
r=$(as_user "$HR" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$BEA_EMP', '$CONTRACT_T', '$K3')"); check_has "HR cannot attach Carlo's file to Bea" "$r" "did not arrive"
check "HR attaches it to Carlo" "$(as_user "$HR" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$CARLO_EMP', '$CONTRACT_T', '$K3') returning status")" "verified"
r=$(as_user "$CARLO" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$CARLO_EMP', '$NBI_T', '$BEA_EMP/uploads/x.pdf')"); check_has "an old Supabase path outside one's own folder is refused" "$r" "Upload the file again"
check "one in one's own folder (older app versions) still works" "$(as_user "$CARLO" "insert into public.employee_documents (employee_id, document_type_id, file_path) values ('$CARLO_EMP', '$NBI_T', '$CARLO_EMP/uploads/x.pdf') returning status")" "pending_review"
ALL="'$K1', '$K2', '$K3'"
check "Bea opens her two files, not Carlo's contract" "$(nread "$BEA" "$ALL")" "2"
check "Carlo opens his contract only" "$(nread "$CARLO" "$ALL")" "1"
check "HR opens all three" "$(nread "$HR" "$ALL")" "3"
check "management (read-only staff) too" "$(nread "$MGMT" "$ALL")" "3"
check "the commander does not open his guards' documents" "$(nread "$DC" "$ALL")" "0"
pg "update public.document_types set visible_to_employee = false where code = 'EMPLOYMENT_CONTRACT'" >/dev/null
check "a document type hidden from employees stays hidden in S3" "$(nread "$CARLO" "$ALL")" "0"
pg "update public.document_types set visible_to_employee = true where code = 'EMPLOYMENT_CONTRACT'" >/dev/null
check "a pending upload opens for nobody" "$(nread "$HR" "'$(begin "$BEA" "'leave', 'image/png', 5000" | jget key)'")" "0"
r=$(as_anon "select count(*) from public.authorize_file_reads(array['$K1'])"); check_has "anon opens nothing" "$r" "permission denied"
check "the file list is for staff" "$(as_user "$BEA" "select count(*) from public.stored_files"):$(as_user "$HR" "select count(*) > 0 from public.stored_files")" "0:t"
r=$(as_user "$BEA" "select public.employee_storage_folder('$BEA_EMP')"); check_has "the key helpers are internal" "$r" "permission denied"
A1=$(begin "$BEA" "'attendance', 'image/jpeg', 150000, null, null, 'time_in'"); AK1=$(echo "$A1" | jget key)
check "a selfie goes to attendance/<year>/<month>, named with the time and the kind" "$(echo "$AK1" | grep -cE "^employees/G-002/attendance/${MONTH}/${TODAY}_[0-9]{4}_time-in_[0-9a-f]{10}\.jpg$")" "1"
r=$(logat "$BEA" time_in "$AK1" 14.5552 121.0244 12); check_has "logging before S3 has the selfie is refused" "$r" "did not arrive"
stored "$(echo "$A1" | jget id)" 150000
check "then the time in logs, at the post" "$(logat "$BEA" time_in "$AK1" 14.5552 121.0244 12 | jget location_check)" "at_post"
r=$(logat "$CARLO" time_in "$AK1" 14.5552 121.0244 12); check_has "another guard cannot log with it" "$r" "not yours"
A2=$(begin "$CARLO" "'attendance', 'image/jpeg', 150000, null, null, 'time_out'"); AK2=$(echo "$A2" | jget key); stored "$(echo "$A2" | jget id)" 150000
r=$(logat "$BEA" time_in "$AK2" 14.5552 121.0244 12); check_has "nor use another guard's upload" "$r" "did not arrive"
pg "update public.stored_files set created_at = now() - interval '2 hours' where object_key = '$AK2'" >/dev/null
r=$(logat "$CARLO" time_out "$AK2" 14.5552 121.0244 12); check_has "a selfie older than 30 minutes is refused" "$r" "did not arrive"
r=$(begin "$HR" "'attendance', 'image/jpeg', 150000, '$BEA_EMP', null, 'time_in'"); check_has "nobody uploads a selfie for someone else, HR included" "$r" "only upload your own"
r=$(begin "$BEA" "'attendance', 'application/pdf', 150000, null, null, 'time_in'"); check_has "a selfie is a photo" "$r" "cannot be uploaded"
r=$(begin "$BEA" "'attendance', 'image/jpeg', 4000000, null, null, 'time_in'"); check_has "of up to 3 MB" "$r" "too large"
check "the commander opens selfies from his post" "$(nread "$DC" "'$AK1'")" "1"
check "a guard at another post does not" "$(nread "$EDU" "'$AK1'")" "0"
LWOP=$(pg "select id from public.leave_types where code = 'LWOP'")
L1=$(begin "$BEA" "'leave', 'application/pdf', 50000"); LK1=$(echo "$L1" | jget key); stored "$(echo "$L1" | jget id)" 50000
check "a leave attachment goes to the leave folder" "$(echo "$LK1" | grep -cE "^employees/G-002/leave/${TODAY}_leave-attachment_[0-9a-f]{10}\.pdf$")" "1"
r=$(as_user "$CARLO" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, attachment_path) values ('$CARLO_EMP', '$LWOP', '2027-03-01', '2027-03-01', '$LK1')"); check_has "another guard's attachment is refused" "$r" "did not arrive"
check "her own is attached" "$(as_user "$BEA" "insert into public.leave_requests (employee_id, leave_type_id, start_date, end_date, attachment_path) values ('$BEA_EMP', '$LWOP', '2027-03-01', '2027-03-01', '$LK1') returning attachment_path = '$LK1'")" "t"
C1=$(begin "$HR" "'certificate', 'application/pdf', 80000, null, null, null, '$CERT_ID'"); CK1=$(echo "$C1" | jget key)
check "a certificate is filed under its number" "$CK1" "employees/G-002/certificates/$(pg "select certificate_no from public.certificates where id = '$CERT_ID'").pdf"
r=$(begin "$BEA" "'certificate', 'application/pdf', 80000, null, null, null, '$CERT_ID'"); check_has "only HR stores certificates" "$r" "Only HR"
r=$(as_user "$HR" "select public.attach_certificate_file('$CERT_ID', '$CK1')"); check_has "a PDF S3 does not have yet is not attached" "$r" "did not arrive"
stored "$(echo "$C1" | jget id)" 80000; as_user "$HR" "select public.attach_certificate_file('$CERT_ID', '$CK1')" >/dev/null
check "once stored it is attached" "$(pg "select file_path from public.certificates where id = '$CERT_ID'")" "$CK1"
check "the employee opens her certificate; payroll does not" "$(nread "$BEA" "'$CK1'"):$(nread "$PAY" "'$CK1'")" "1:0"
C2=$(begin "$HR" "'certificate', 'application/pdf', 90000, null, null, null, '$CERT_ID'")
check "making the PDF again keeps its key" "$(echo "$C2" | jget key)" "$CK1"
EDU_EMP=$(pg "select id from public.employees where user_id = '$EDU'")
pg "insert into public.stored_files (object_key, employee_id, purpose, folder, content_type, max_bytes, uploaded_by) select 'employees/G-004/leave/flood-' || g || '.jpg', '$EDU_EMP', 'leave', 'leave', 'image/jpeg', 10, '$EDU' from generate_series(1, 60) g" >/dev/null
r=$(begin "$EDU" "'leave', 'image/jpeg', 5000"); check_has "at most 60 uploads an hour for employees" "$r" "Too many uploads"
pg "update public.employees set status = 'resigned' where id = '$CARLO_EMP'" >/dev/null
r=$(begin "$CARLO" "'leave', 'image/jpeg', 5000"); check_has "a separated employee cannot upload" "$r" "record is closed"
pg "update public.employees set status = 'active', employee_no = 'G 003/B' where id = '$CARLO_EMP'" >/dev/null
check "an employee number with spaces or slashes still makes one folder" "$(begin "$CARLO" "'leave', 'image/jpeg', 5000" | jget key | cut -d/ -f1-3)" "employees/G-003-B/leave"
pg "update public.employees set employee_no = 'G-003' where id = '$CARLO_EMP'" >/dev/null
as_user "$HR" "update public.document_types set storage_folder = '201-file' where code = 'MEDICAL_CERT'" >/dev/null
psql $H -U postgres -v ON_ERROR_STOP=1 -q -f "$(dirname "$0")/../schema.sql" >/dev/null 2>&1
check "re-running schema.sql keeps HR's folder choice and the file list" "$(pg "select storage_folder from public.document_types where code = 'MEDICAL_CERT'"):$(pg "select count(*) > 60 from public.stored_files")" "201-file:t"

echo "== Attendance without the guard's phone: the commander logs for a guard, or HR by hand"
CP=$(begin "$DC" "'attendance', 'image/jpeg', 150000, '$BEA_EMP', null, 'time_in'"); CPK=$(echo "$CP" | jget key)
check "the commander's photo of Bea goes to Bea's attendance folder" "$(echo "$CPK" | grep -c '^employees/G-002/attendance/')" "1"
r=$(begin "$DC" "'attendance', 'image/jpeg', 150000, '$EDU_EMP', null, 'time_in'"); check_has "not for a guard at another post" "$r" "only upload your own"
r=$(as_user "$DC" "select public.log_attendance_for('$BEA_EMP', 'time_in', '$CPK', 14.5552, 121.0244, 12)"); check_has "not before S3 has the photo" "$r" "did not arrive"
stored "$(echo "$CP" | jget id)" 150000
NB=$(pg "select count(*) from public.notifications where user_id = '$BEA'")
R=$(as_user "$DC" "select public.log_attendance_for('$BEA_EMP', 'time_in', '$CPK', 14.5552, 121.0244, 12)")
check "then it logs for Bea, checked against her post with the commander's location" "$(echo "$R" | jget location_check):$(echo "$R" | jget employee_name)" "at_post:Bea Lim"
check "the log says the commander logged it" "$(pg "select source || ':' || (logged_by = '$DC') || ':' || (logged_by_employee_id = '$DC_EMP') || ':' || (employee_id = '$BEA_EMP') from public.attendance_logs where photo_path = '$CPK'")" "commander:true:true:true"
check "and Bea is told" "$(pg "select count(*) - $NB from public.notifications where user_id = '$BEA'")" "1"
check "sending it again returns the same log" "$(as_user "$DC" "select public.log_attendance_for('$BEA_EMP', 'time_in', '$CPK', 1, 1, 5)" | jget id)" "$(echo "$R" | jget id)"
r=$(as_user "$CARLO" "select public.log_attendance_for('$BEA_EMP', 'time_in', '$CPK', 14.5552, 121.0244, 12)"); check_has "a guard cannot log for another guard" "$r" "only for the guards at your post"
r=$(as_user "$DC" "select public.log_attendance_for('$DC_EMP', 'time_in', '$CPK', 14.5552, 121.0244, 12)"); check_has "the commander logs his own with log_attendance" "$r" "only for the guards at your post"
CO=$(begin "$CARLO" "'attendance', 'image/jpeg', 150000, null, null, 'time_in'"); stored "$(echo "$CO" | jget id)" 150000
r=$(as_user "$DC" "select public.log_attendance_for('$CARLO_EMP', 'time_in', '$(echo "$CO" | jget key)', 14.5552, 121.0244, 12)"); check_has "only with a photo he took himself" "$r" "did not arrive"
r=$(as_user "$HR" "select public.log_attendance_for('$BEA_EMP', 'time_in', '$CPK', 1, 1, 1)"); check_has "office staff without a post do not log for guards" "$r" "Only commanders"
M=$(as_user "$HR" "select public.add_manual_attendance('$CARLO_EMP', 'time_out', now() - interval '3 hours', 'Phone lost; from the post logbook')")
check "HR enters a log by hand: no photo, no location, marked manual" "$(pg "select source || ':' || location_check || ':' || (photo_path is null) || ':' || manual_reason from public.attendance_logs where id = '$(echo "$M" | jget id)'")" "manual:manual:true:Phone lost; from the post logbook"
check "the audit log keeps who entered it and why" "$(pg "select actor_id = '$HR' and note like 'Phone lost%' from public.audit_log where record_id = '$(echo "$M" | jget id)'")" "t"
r=$(as_user "$DC" "select public.add_manual_attendance('$BEA_EMP', 'time_in', now(), 'Phone lost today')"); check_has "only HR enters by hand" "$r" "Only HR"
r=$(as_user "$HR" "select public.add_manual_attendance('$BEA_EMP', 'time_in', now() - interval '1 hour', 'x')"); check_has "a reason is needed" "$r" "Say why"
r=$(as_user "$HR" "select public.add_manual_attendance('$BEA_EMP', 'time_in', now() + interval '1 day', 'Phone lost today')"); check_has "not in the future" "$r" "last 62 days"
r=$(as_user "$HR" "select public.add_manual_attendance('$BEA_EMP', 'time_in', now() - interval '90 days', 'Phone lost today')"); check_has "nor long ago" "$r" "last 62 days"
r=$(as_user "$BEA" "insert into public.attendance_logs (employee_id, kind, location_check, source) values ('$BEA_EMP', 'time_in', 'manual', 'manual')"); check_has "nobody writes a manual log directly" "$r" "permission denied"
check "the commander opens the photo he took" "$(nread "$DC" "'$CPK'")" "1"

echo "== Discipline: the Code of Discipline, incident reports and cases with due process"
P=$(begin "$HR" "'policy', 'application/pdf', 500000"); PK=$(echo "$P" | jget key)
check "the Code of Discipline goes to company/code-of-discipline/" "$(echo "$PK" | grep -cE "^company/code-of-discipline/${TODAY}_code-of-discipline_[0-9a-f]{10}\.pdf$")" "1"
r=$(begin "$BEA" "'policy', 'application/pdf', 500000"); check_has "only HR uploads it" "$r" "Only HR uploads"
r=$(begin "$HR" "'policy', 'image/jpeg', 500000"); check_has "and only as a PDF" "$r" "cannot be uploaded"
r=$(as_user "$HR" "select public.create_discipline_code('Code of Discipline 2026', '2026-01-01', '$PK')"); check_has "not before S3 has the PDF" "$r" "did not arrive"
stored "$(echo "$P" | jget id)" 500000
CODE1=$(as_user "$HR" "select public.create_discipline_code('Code of Discipline 2026', '2026-01-01', '$PK')")
check "HR adds it as a draft, not read yet" "$(pg "select status || ':' || read_status from public.discipline_codes where id = '$CODE1'")" "draft:not_read"
r=$(as_user "$OPS" "select public.start_code_reading('$CODE1')"); check_has "only HR has Claude read it" "$r" "Only HR"
S=$(as_user "$HR" "select public.start_code_reading('$CODE1')"); check "reading starts, and the function gets the PDF's key" "$(echo "$S" | jget file_key)" "$PK"
r=$(as_user "$HR" "select public.start_code_reading('$CODE1')"); check_has "not twice at once" "$r" "already reading"
check "HR follows the reading" "$(as_user "$HR" "select public.code_reading_status('$CODE1') ->> 'read_status'")" "reading"
r=$(as_user "$BEA" "select public.code_reading_status('$CODE1')"); check_has "nobody else does" "$r" "Only HR"
r=$(as_user "$HR" "select public.finish_code_reading('$CODE1', '[]', 'x', '[]', 'x')"); check_has "only the discipline-ai service records what Claude found" "$r" "permission denied"
as_service "select public.set_code_reading_job('$CODE1', 'msgbatch_test1', 'claude-opus-5-5')" >/dev/null
check "the batch is noted while Claude reads" "$(pg "select read_job || ':' || read_model from public.discipline_codes where id = '$CODE1'")" "msgbatch_test1:claude-opus-5-5"
NH=$(pg "select count(*) from public.notifications where user_id = '$HR'")
RULES='[{"ref":"A-1","title":"Sleeping on post","description":"Sleeping while on duty","category":"post_duty","gravity":"grave","penalties":[{"offense":1,"action":"suspension","days":7,"text":"7 days suspension"},{"offense":2,"action":"dismissal","days":0,"text":"Dismissal"}],"just_cause":"gross_neglect","source_text":"Sleeping on post... first offense 7 days suspension; second offense dismissal","page":3},
 {"ref":"B-2","title":"Tardiness","description":"","category":"attendance","gravity":"light","penalties":[{"offense":1,"action":"warning","days":0,"text":"Written warning"},{"offense":2,"action":"reprimand","days":0,"text":"Reprimand"},{"offense":3,"action":"suspension","days":3,"text":"3 days"}],"just_cause":"none","source_text":"Tardiness","page":0},
 {"ref":"C-3","title":"Unlisted penalty","category":"made_up","gravity":"terrible","penalties":[{"offense":1,"action":"fine","days":0,"text":"P500 fine"}],"just_cause":"whatever","page":-4}]'
N=$(as_service "select public.finish_code_reading('$CODE1', '$RULES', 'Covers duty, attendance and conduct; penalties rise with each offense.', '[{\"ref\":\"D-1\",\"note\":\"Fines taken from wages need the employee''s written consent (Labor Code Art. 113).\"}]', 'claude-opus-5-5')")
check "Claude's three rules are proposed for review" "$N:$(pg "select count(*) || ':' || bool_and(from_ai) || ':' || bool_and(status = 'proposed') from public.offense_rules where code_id = '$CODE1'")" "3:3:true:true"
check "values outside the lists are not trusted" "$(pg "select category || ':' || gravity || ':' || penalties::text || ':' || just_cause || ':' || coalesce(page::text, 'none') from public.offense_rules where ref = 'C-3'")" "other:unclassified:[]:none:none"
check "the code is read, with Claude's summary and notes for counsel" "$(pg "select read_status || ':' || jsonb_array_length(compliance_notes) || ':' || (summary like 'Covers%') from public.discipline_codes where id = '$CODE1'")" "read:1:true"
check "HR is told the rules are ready" "$(pg "select count(*) from public.notifications where user_id = '$HR' and kind = 'discipline_code'")" "1"
check "employees do not read the rules" "$(as_user "$BEA" "select count(*) from public.offense_rules")" "0"
r=$(as_user "$HR" "select public.activate_discipline_code('$CODE1')"); check_has "not in force before every rule is reviewed" "$r" "Approve or reject every rule"
as_user "$HR" "update public.offense_rules set status = 'approved' where code_id = '$CODE1' and ref in ('A-1', 'B-2')" >/dev/null
as_user "$HR" "update public.offense_rules set status = 'rejected' where code_id = '$CODE1' and ref = 'C-3'" >/dev/null
check "each review is signed by who made it" "$(pg "select count(*) from public.offense_rules where code_id = '$CODE1' and reviewed_by = '$HR' and reviewed_at is not null")" "3"
r=$(as_user "$HR" "update public.offense_rules set penalties = '[{\"offense\":1,\"action\":\"fine\"}]' where ref = 'B-2'"); check_has "a penalty is a warning, reprimand, suspension, dismissal or other" "$r" "penalties_check"
r=$(as_user "$HR" "update public.offense_rules set penalties = '[{\"offense\":1,\"action\":\"suspension\",\"days\":120}]' where ref = 'B-2'"); check_has "a suspension is 1 to 90 days" "$r" "penalties_check"
r=$(as_user "$HR" "update public.discipline_codes set status = 'active' where id = '$CODE1'"); check_has "a code is put in force only through activate_discipline_code" "$r" "permission denied"
as_user "$HR" "select public.activate_discipline_code('$CODE1')" >/dev/null
check "then it is in force" "$(pg "select status || ':' || (activated_by = '$HR') from public.discipline_codes where id = '$CODE1'")" "active:true"
r=$(as_user "$HR" "select public.start_code_reading('$CODE1')"); check_has "a code in force is not read again" "$r" "Only a draft code"
check "every employee can open the code in force" "$(nread "$BEA" "'$PK'")" "1"
check "and finds it" "$(as_user "$BEA" "select public.active_discipline_code() ->> 'file_key'")" "$PK"
check "anon does not" "$(as_anon "select public.active_discipline_code()" | grep -c 'permission denied')" "1"
RULE_A=$(pg "select id from public.offense_rules where code_id = '$CODE1' and ref = 'A-1'")
RULE_B=$(pg "select id from public.offense_rules where code_id = '$CODE1' and ref = 'B-2'")
RULE_C=$(pg "select id from public.offense_rules where code_id = '$CODE1' and ref = 'C-3'")

NH=$(pg "select count(*) from public.notifications where user_id = '$HR'")
IR=$(as_user "$DC" "select public.file_incident_report('$SITE1', '$CARLO_EMP', now() - interval '2 hours', 'Asleep on post', 'Found asleep at the main gate at 2 AM during the inspection round.')"); IRID=$(echo "$IR" | jget id)
check "the commander files a report about a guard of his post" "$(echo "$IR" | jget report_no | grep -cE '^IR-[0-9]{4}-[0-9]{6}$'):$(pg "select reporter_kind || ':' || status || ':' || reporter_name from public.incident_reports where id = '$IRID'")" "1:commander:received:Dante Cruz"
check "HR is told" "$(pg "select count(*) from public.notifications where user_id = '$HR' and kind = 'incident_report'")" "1"
r=$(as_user "$DC" "select public.file_incident_report('$SITE2', null, now(), 'Gate open', 'The gate was left open overnight.')"); check_has "not for another post" "$r" "cannot file a report"
r=$(as_user "$BEA" "select public.file_incident_report('$SITE1', null, now(), 'Gate open', 'The gate was left open overnight.')"); check_has "a guard without a post to command cannot file one" "$r" "cannot file a report"
r=$(as_user "$OPS" "select public.file_incident_report('$SITE2', null, now() + interval '1 day', 'Gate open', 'The gate was left open overnight.')"); check_has "not in the future" "$r" "not in the future"
check "staff see reports; guards do not" "$(as_user "$OPS" "select count(*) from public.incident_reports"):$(as_user "$BEA" "select count(*) from public.incident_reports")" "1:0"

r=$(as_user "$OPS" "select public.open_disciplinary_case('$CARLO_EMP', '$IRID', '$RULE_A', 'Found asleep at the main gate at 2 AM.')"); check_has "only HR opens a case" "$r" "Only HR"
r=$(as_user "$HR" "select public.open_disciplinary_case('$CARLO_EMP', '$IRID', '$RULE_C', 'Found asleep at the main gate at 2 AM.')"); check_has "only on an approved rule of the code in force" "$r" "approved rule"
C1=$(as_user "$HR" "select public.open_disciplinary_case('$CARLO_EMP', '$IRID', '$RULE_A', 'Found asleep at the main gate at 2 AM on inspection.')"); C1ID=$(echo "$C1" | jget id)
check "a case is opened as a draft, a first offense" "$(echo "$C1" | jget case_no | grep -cE '^DC-[0-9]{4}-[0-9]{6}$'):$(pg "select status || ':' || offense_no from public.disciplinary_cases where id = '$C1ID'")" "1:draft:1"
check "the report moves to investigating" "$(pg "select status from public.incident_reports where id = '$IRID'")" "investigating"
check "the employee does not see a draft" "$(as_user "$CARLO" "select public.my_disciplinary_cases()")" "[]"
NTE='This notice is about the events of 2 AM at the main gate of Post A, where you were found asleep while on duty. This may violate rule A-1, Sleeping on post, of the Code of Discipline. Explain in writing why no action should be taken.'
r=$(as_user "$HR" "select public.issue_nte('$C1ID', '$NTE', now() + interval '3 days')"); check_has "the notice gives at least five calendar days to answer" "$r" "at least five calendar days"
r=$(as_user "$HR" "select public.issue_nte('$C1ID', 'Dear {{employee_name}}, you were found asleep at your post at the main gate. Explain within five days.', now() + interval '6 days')"); check_has "a draft with blanks left is refused" "$r" "blanks to fill in"
r=$(as_user "$HR" "select public.issue_nte('$C1ID', 'Explain.', now() + interval '6 days')"); check_has "and so is a notice without the facts" "$r" "Write the notice"
NC=$(pg "select count(*) from public.notifications where user_id = '$CARLO'")
as_user "$HR" "select public.issue_nte('$C1ID', '$NTE', now() + interval '5 days')" >/dev/null
check "the notice is issued" "$(pg "select status || ':' || (nte_issued_by = '$HR') from public.disciplinary_cases where id = '$C1ID'")" "nte_issued:true"
check "Carlo is told to open the app, without the details in the notification" "$(pg "select count(*) from public.notifications where user_id = '$CARLO' and title = 'You have a notice from HR' and body not ilike '%asleep%'")" "1"
MY=$(as_user "$CARLO" "select public.my_disciplinary_cases()")
check "he reads the notice and the rule in the app, not HR's working notes" "$(echo "$MY" | python3 -c "import json,sys; c=json.load(sys.stdin)[0]; print(c['status'], c['rule']['ref'], 'facts' in c, 'ai_suggestion' in c, 'hearing_notes' in c, c['nte_text'][:11])")" "nte_issued A-1 False False False This notice"
check "nobody else sees it" "$(as_user "$BEA" "select public.my_disciplinary_cases()"):$(as_user "$BEA" "select count(*) from public.disciplinary_cases")" "[]:0"
r=$(as_user "$HR" "select public.update_case_draft('$C1ID', '$RULE_B', null, 'Late by an hour.')"); check_has "once issued, the charge cannot change" "$r" "can no longer change"
r=$(as_user "$HR" "select public.decide_case('$C1ID', 'suspension', 7, current_date, 'Found asleep; his explanation does not hold; 7 days per A-1.')"); check_has "no decision before the employee has had his five days" "$r" "Wait for the explanation"
as_user "$CARLO" "select public.acknowledge_case_notice('$C1ID', 'nte')" >/dev/null
check "he says he received it" "$(pg "select nte_received_at is not null from public.disciplinary_cases where id = '$C1ID'")" "t"
NH=$(pg "select count(*) from public.notifications where user_id = '$HR'")
as_user "$CARLO" "select public.submit_case_explanation('$C1ID', 'I was on my break and resting my eyes; I was not asleep.', true)" >/dev/null
check "his explanation arrives from the app, with his request for a hearing" "$(pg "select status || ':' || explanation_via || ':' || wants_hearing from public.disciplinary_cases where id = '$C1ID'")" "explained:app:true"
check "and HR is told" "$(pg "select count(*) from public.notifications where user_id = '$HR' and title = 'Explanation received'")" "1"
r=$(as_user "$CARLO" "select public.submit_case_explanation('$C1ID', 'Another try at the explanation.', false)"); check_has "only once" "$r" "already received"
r=$(as_user "$HR" "select public.decide_case('$C1ID', 'suspension', 7, current_date, 'Found asleep; his explanation does not hold; 7 days per A-1.')"); check_has "he asked for a hearing, so there is one before a decision" "$r" "asked for a hearing"
r=$(as_user "$HR" "select public.set_case_hearing('$C1ID', now() + interval '2 hours', 'HR office')"); check_has "a hearing is set at least a day ahead" "$r" "at least a day ahead"
as_user "$HR" "select public.set_case_hearing('$C1ID', now() + interval '2 days', 'HR office, Makati')" >/dev/null
r=$(as_user "$HR" "select public.record_case_hearing('$C1ID', 'Carlo attended with a co-guard as his representative.')"); check_has "it is recorded once it has taken place" "$r" "once it has taken place"
pg "update public.disciplinary_cases set hearing_at = now() - interval '1 hour' where id = '$C1ID'" >/dev/null
as_user "$HR" "select public.record_case_hearing('$C1ID', 'Carlo attended with a co-guard as his representative. The inspector confirmed he was asleep.')" >/dev/null
r=$(as_user "$HR" "select public.decide_case('$C1ID', 'suspension', 3, current_date, 'Found asleep after hearing both sides; three days suspension.')"); check_has "a penalty other than the code's needs a reason" "$r" "Say why"
NC=$(pg "select count(*) from public.notifications where user_id = '$CARLO'")
D1=$(as_user "$HR" "select public.decide_case('$C1ID', 'suspension', 7, current_date, 'Found asleep after hearing both sides; seven days suspension under A-1, first offense.')")
check "the code's penalty is decided" "$(echo "$D1" | jget departs):$(pg "select status || ':' || decision || ':' || suspension_days from public.disciplinary_cases where id = '$C1ID'")" "False:decided:suspension:7"
check "the report shows action taken, and Carlo is told" "$(pg "select status from public.incident_reports where id = '$IRID'"):$(pg "select count(*) - $NC from public.notifications where user_id = '$CARLO'")" "action_taken:1"
as_user "$CARLO" "select public.acknowledge_case_notice('$C1ID', 'decision')" >/dev/null
check "he acknowledges the decision" "$(pg "select decision_received_at is not null from public.disciplinary_cases where id = '$C1ID'")" "t"
r=$(as_user "$HR" "select public.withdraw_case('$C1ID', 'Changed our mind')"); check_has "a decided case is closed" "$r" "closed"

C2ID=$(as_user "$HR" "select public.open_disciplinary_case('$CARLO_EMP', null, '$RULE_A', 'Found asleep again at the main gate at 3 AM.')" | jget id)
check "the next case of the same rule is his second offense, and the code says dismissal" "$(pg "select offense_no || ':' || (public.code_penalty(rule_id, offense_no) ->> 'action') from public.disciplinary_cases where id = '$C2ID'")" "2:dismissal"
as_user "$HR" "select public.issue_nte('$C2ID', '$NTE', now() + interval '5 days')" >/dev/null
pg "update public.disciplinary_cases set explain_by = now() - interval '1 minute' where id = '$C2ID'" >/dev/null
r=$(as_user "$HR" "select public.decide_case('$C2ID', 'dismissal', null, null, 'No explanation came within the period; dismissal under A-1, second offense.')"); check_has "never a dismissal without a hearing or conference" "$r" "before a dismissal"
r=$(as_user "$HR" "select public.decide_case('$C2ID', 'suspension', 7, current_date, 'No explanation came; a lighter penalty given his record of service.')"); check_has "a lighter penalty than the code's also needs a reason" "$r" "Say why"
D2=$(as_user "$HR" "select public.decide_case('$C2ID', 'suspension', 7, current_date, 'No explanation came; a lighter penalty given his record of service.', 'Eight years of service with one earlier offense')")
check "with the reason, it is decided and marked as departing from the code" "$(echo "$D2" | jget departs):$(pg "select departs_reason like 'Eight years%' from public.disciplinary_cases where id = '$C2ID'")" "True:t"

C3ID=$(as_user "$HR" "select public.open_disciplinary_case('$EDU_EMP', null, '$RULE_B', 'Arrived an hour late for the 6 AM shift.')" | jget id)
r=$(as_user "$HR" "select public.set_preventive_suspension('$C3ID', current_date, current_date + 10, 'Serious threat to the property of the client.')"); check_has "no preventive suspension before the notice" "$r" "Issue the notice"
as_user "$HR" "select public.issue_nte('$C3ID', 'On the morning of the 10th you arrived at Post B at 7:05 AM for the 6 AM shift. This may violate rule B-2, Tardiness. Please explain.', now() + interval '6 days')" >/dev/null
r=$(as_user "$HR" "select public.set_preventive_suspension('$C3ID', current_date, current_date + 30, 'Serious threat to the property of the client.')"); check_has "a preventive suspension lasts at most 30 days" "$r" "at most 30 days"
r=$(as_user "$HR" "select public.set_preventive_suspension('$C3ID', current_date, current_date + 29, 'Late')"); check_has "and needs the threat it prevents" "$r" "serious and imminent threat"
as_user "$HR" "select public.set_preventive_suspension('$C3ID', current_date, current_date + 29, 'He was seen taking the client''s fuel; his presence risks the client''s property.')" >/dev/null
check "30 days, set" "$(pg "select preventive_to - preventive_from from public.disciplinary_cases where id = '$C3ID'")" "29"

CTX=$(as_user "$HR" "select public.case_ai_context('$C3ID')")
check "Claude gets the facts and the approved rules only, with no names" "$(echo "$CTX" | python3 -c "import json,sys; c=json.load(sys.stdin); t=json.dumps(c); print(len(c['rules']), sorted(r['ref'] for r in c['rules']), 'Edu' in t or 'Tan' in t or 'G-004' in t)")" "2 ['A-1', 'B-2'] False"
check "and his earlier findings by rule" "$(as_user "$HR" "select jsonb_array_length(public.case_ai_context('$C2ID') -> 'earlier_findings')")" "1"
r=$(as_user "$CARLO" "select public.case_ai_context('$C1ID')"); check_has "only HR asks Claude" "$r" "Only HR"
r=$(as_user "$HR" "select public.save_case_suggestion('$C3ID', '{\"matches\":[]}')"); check_has "only discipline-ai saves Claude's suggestion" "$r" "permission denied"
as_service "select public.save_case_suggestion('$C3ID', '{\"matches\":[{\"rule_id\":\"$RULE_B\",\"confidence\":\"high\"}]}')" >/dev/null
check "the suggestion is kept on the case for HR" "$(pg "select (ai_suggestion -> 'matches' -> 0 ->> 'confidence') || ':' || (ai_suggested_at is not null) from public.disciplinary_cases where id = '$C3ID'")" "high:true"

r=$(as_user "$HR" "update public.offense_rules set penalties = '[{\"offense\":1,\"action\":\"warning\",\"days\":0}]' where id = '$RULE_A'"); check_has "a rule cases rest on cannot be changed in force" "$r" "Cases already rest on this rule"
as_user "$HR" "delete from public.offense_rules where id = '$RULE_B'" >/dev/null
check "nor deleted" "$(pg "select count(*) from public.offense_rules where id = '$RULE_B'")" "1"
r=$(as_user "$HR" "update public.disciplinary_cases set decision = 'warning' where id = '$C1ID'"); check_has "cases change only through the due-process functions" "$r" "permission denied"
check "every step is in the audit log" "$(pg "select count(*) > 5 from public.audit_log where table_name = 'disciplinary_cases' and record_id = '$C1ID'")" "t"

echo "== Client portal: a client's people see only their own posts, and file reports and requests"
CLIENT=$(as_user "$OPS" "insert into public.clients (name, status) values ('Acme Mart', 'active') returning id")
OTHER=$(as_user "$OPS" "insert into public.clients (name, status) values ('Other Corp', 'active') returning id")
pg "update public.sites set client_id = '$CLIENT' where id = '$SITE1'; update public.sites set client_id = '$OTHER' where id = '$SITE2'" >/dev/null
r=$(as_user "$BEA" "select public.invite_client_user('$CLIENT', 'store@acme.test', 'Mia Manager')"); check_has "only operations invites client users" "$r" "Only operations"
CCODE=$(as_user "$OPS" "select public.invite_client_user('$CLIENT', 'store@acme.test', 'Mia Manager')")
check "their code works on the setup page like a staff invitation" "$(as_anon "select public.check_staff_invitation('store@acme.test', '$CCODE')")" "t"
check "staff see the open invitation" "$(as_user "$OPS" "select state from public.list_client_users('$CLIENT')")" "invited"
CU=$(signup 'store@acme.test' "{\"invite_code\":\"$CCODE\",\"full_name\":\"Mia Manager\"}")
check "a client login gets no staff role" "$(pg "select count(*) from public.user_roles where user_id = '$CU'")" "0"
check "and is tied to the client" "$(as_user "$CU" "select public.my_access() -> 'client' ->> 'name'")" "Acme Mart"
check "it sees only its own posts" "$(as_user "$CU" "select string_agg(name, ',') from public.sites")" "Post A"
check "and none of: employees, areas, document types, commanders, reports, cases, codes, other clients" "$(as_user "$CU" "select (select count(*) from public.employees) + (select count(*) from public.areas) + (select count(*) from public.document_types) + (select count(*) from public.site_supervisors) + (select count(*) from public.incident_reports) + (select count(*) from public.disciplinary_cases) + (select count(*) from public.offense_rules) + (select count(*) from public.clients) + (select count(*) from public.attendance_logs) + (select count(*) from public.stored_files)")" "0"
OV=$(as_user "$CU" "select public.client_overview()")
check "overview: its post, guards by first name and surname, and who is on duty, nothing personal" "$(echo "$OV" | python3 -c "import json,sys; o=json.load(sys.stdin); p=o['posts']; t=json.dumps(o); print(o['client']['name'], len(p), p[0]['name'], 'Bea Lim' in [g['name'] for g in p[0]['guards']], any(g['on_duty_since'] for g in p[0]['guards']), any(k in t for k in ('employee_no','mobile','birthdate','address','G-00','09171')))")" "Acme Mart 1 Post A True True False"
AT=$(as_user "$CU" "select public.client_attendance((now() at time zone 'Asia/Manila')::date)")
check "attendance of a day at its posts only, without photos or locations" "$(echo "$AT" | python3 -c "import json,sys; a=json.load(sys.stdin); t=json.dumps(a); print(len(a) > 0, {x['post'] for x in a} == {'Post A'}, any(k in t for k in ('photo','latitude','employees/')))")" "True True False"
r=$(as_user "$CU" "select public.client_attendance(current_date - 200)"); check_has "within the last three months" "$r" "last three months"
CR=$(as_user "$CU" "select public.file_incident_report('$SITE1', '$BEA_EMP', now() - interval '1 hour', 'Guard on her phone', 'The guard at the gate was on her phone for an hour.')"); CRID=$(echo "$CR" | jget id)
check "the client files a report about a guard of its post" "$(pg "select reporter_kind || ':' || reporter_name || ':' || (client_id = '$CLIENT') from public.incident_reports where id = '$CRID'")" "client:Mia Manager · Acme Mart:true"
check "operations and HR are told" "$(pg "select count(*) from public.notifications where user_id = '$OPS' and title = 'A client reported an incident'")" "1"
r=$(as_user "$CU" "select public.file_incident_report('$SITE2', null, now(), 'Gate open', 'The gate was left open overnight.')"); check_has "never about another client's post" "$r" "Choose one of your posts"
r=$(as_user "$CU" "select public.file_incident_report('$SITE1', '$EDU_EMP', now(), 'Gate open', 'The gate was left open overnight.')"); check_has "nor a guard of another post" "$r" "Choose a guard of that post"
as_user "$DC" "select public.file_incident_report('$SITE1', '$CARLO_EMP', now(), 'Late relief', 'Relief came an hour late; internal matter.')" >/dev/null
as_user "$HR" "select public.update_incident_report('$CRID', 'action_taken', 'We spoke with the guard and her commander.')" >/dev/null
REPS=$(as_user "$CU" "select public.client_reports()")
check "it follows only its own reports, with Bannuar's update, not the commander's internal ones" "$(echo "$REPS" | python3 -c "import json,sys; r=json.load(sys.stdin); print(len(r), r[0]['status'], r[0]['update'][:10], r[0]['guard'])")" "1 action_taken We spoke w Bea Lim"
RQ=$(as_user "$CU" "select public.file_client_request('$SITE1', 'additional_guards', 'Two more guards for the holiday rush, 6 AM to 6 PM.', 2, current_date + 10)"); RQID=$(echo "$RQ" | jget id)
check "the client asks for more guards" "$(echo "$RQ" | jget request_no | grep -cE '^CR-[0-9]{4}-[0-9]{6}$'):$(pg "select guards_needed || ':' || status from public.client_requests where id = '$RQID'")" "1:2:received"
r=$(as_user "$CU" "select public.file_client_request('$SITE2', 'other', 'Please check the gate at the warehouse.', null, null)"); check_has "only for its own posts" "$r" "Choose one of your posts"
r=$(as_user "$CU" "select public.update_client_request('$RQID', 'done', 'x')"); check_has "only operations answers" "$r" "Only operations"
as_user "$OPS" "select public.update_client_request('$RQID', 'in_progress', 'Two guards from December 1.')" >/dev/null
check "the client reads the answer" "$(as_user "$CU" "select public.client_requests_list() -> 0 ->> 'reply'")" "Two guards from December 1."
r=$(as_user "$BEA" "select public.client_overview()"); check_has "guards and staff do not get a client's view" "$r" "Only client users"
as_user "$OPS" "select public.set_client_user_active('$CU', false)" >/dev/null
r=$(as_user "$CU" "select public.client_overview()"); check_has "a disabled client login sees nothing" "$r" "Only client users"
check "not even the posts" "$(as_user "$CU" "select count(*) from public.sites")" "0"
check "guards still see posts" "$(as_user "$BEA" "select count(*) > 0 from public.sites")" "t"

echo "== Claude reads documents at upload (document-ai)"
check "Claude reads the LESP to start with, and nothing else" "$(pg "select string_agg(code, ',') from public.document_types where ai_check")" "SECURITY_LICENSE"
DL=$(begin "$BEA" "'document', 'image/jpeg', 200000, null, '$LESP_T'"); DLK=$(echo "$DL" | jget key)
r=$(as_user "$BEA" "select public.document_ai_context('$DLK')"); check_has "not before S3 has the photo" "$r" "File not found"
stored "$(echo "$DL" | jget id)" 200000
CTX=$(as_user "$BEA" "select public.document_ai_context('$DLK')")
check "the function gets what it needs for her own LESP" "$(echo "$CTX" | python3 -c "import json,sys; c=json.load(sys.stdin); print(c['type_code'], c['content_type'], c['first_name'], c['last_name'], c['has_expiry'])")" "SECURITY_LICENSE image/jpeg Bea Lim True"
r=$(as_user "$CARLO" "select public.document_ai_context('$DLK')"); check_has "never another guard's" "$r" "File not found"
check "HR may have any LESP read" "$(as_user "$HR" "select public.document_ai_context('$DLK') ->> 'type_code'")" "SECURITY_LICENSE"
DN=$(begin "$BEA" "'document', 'application/pdf', 300000, null, '$NBI_T'"); stored "$(echo "$DN" | jget id)" 300000
r=$(as_user "$BEA" "select public.document_ai_context('$(echo "$DN" | jget key)')"); check_has "only types HR turned on" "$r" "does not read this kind"
r=$(as_user "$BEA" "select public.save_document_check('$DLK', '{\"expiry\":\"valid\"}')"); check_has "only the function saves Claude's check" "$r" "permission denied"
as_service "select public.save_document_check('$DLK', '{\"expiry\":\"valid\",\"document_no\":\"R01-123\"}')" >/dev/null
check "HR reads the check with the file" "$(as_user "$HR" "select ai_check ->> 'document_no' from public.stored_files where object_key = '$DLK'")" "R01-123"
r=$(as_user "$HR" "update public.document_types set ai_check = true where code = 'NBI_CLEARANCE' returning code"); check_has "HR turns it on for another type" "$r" "NBI_CLEARANCE"

echo "== Demo scripts still match the schema (on a second, empty database)"
D="$(dirname "$0")/.."
DEMO_DB="${PGDATABASE:-bannuar_test}_demo"
DH="-h ${PGHOST:-localhost} -p ${PGPORT:-5432} -d $DEMO_DB"
psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U postgres -d postgres -q -c "drop database if exists $DEMO_DB" -c "create database $DEMO_DB" 2>&1 | grep -v NOTICE
pgd() { psql $DH -U postgres -tA -v ON_ERROR_STOP=1 -q -c "$1" 2>&1; }
r=$(for f in tests/supabase-stubs.sql schema.sql seed-demo.sql demo-employee-logins.sql demo-employee-logins.sql; do psql $DH -U postgres -v ON_ERROR_STOP=1 -q -f "$D/$f" 2>&1 | grep -v 'NOTICE' || true; done)
check "seed-demo.sql, then the demo employee logins twice" "$r" ""
check "both demo logins link through the sign-up trigger, metadata scrubbed" "$(pgd "select string_agg(e.employee_no || '=' || (u.raw_user_meta_data ?| array['birthdate', 'mobile_no', 'activation_ticket'])::text, ',' order by e.employee_no) from public.employees e join auth.users u on u.id = e.user_id where e.employee_no like 'DEMO-%'")" "DEMO-0001=false,DEMO-0002=false"
r=$(psql $DH -U postgres -v ON_ERROR_STOP=1 -q -f "$D/remove-demo.sql" 2>&1 | grep -v 'NOTICE' || true)
check "remove-demo.sql clears them" "$r:$(pgd "select count(*) from public.employees where employee_no like 'DEMO-%'")" ":0"
psql -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" -U postgres -d postgres -q -c "drop database if exists $DEMO_DB" 2>&1 | grep -v NOTICE

echo
echo "PASSED $PASS · FAILED $FAIL"
[[ $FAIL -eq 0 ]]
