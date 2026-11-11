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
