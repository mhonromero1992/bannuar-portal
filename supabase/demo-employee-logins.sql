-- =====================================================================================
-- DEMO EMPLOYEE LOGINS for showing the employee app. Run after seed-demo.sql.
--   DEMO-0001  Demo Juan Dela Cruz, detachment commander: sees his post and endorses leave
--   DEMO-0002  Demo Maria Santos, security guard
-- Both sign in to the app with the employee number and the password "password".
--
-- The app turns the employee number into a login email:
-- <employee number in lower case>@employees.bannuar.invalid (docs/employee-app-prompt.md).
-- If the app ends up with another format, change v_domain and run this again.
-- Safe to run again: it resets the passwords. remove-demo.sql deletes these logins with the demo
-- data. Like every demo login, keep it away from a database with real records.
-- =====================================================================================
do $$
declare
  v_domain constant text := 'employees.bannuar.invalid';
  v_password constant text := 'password';
  v_no text;
  v_email text;
  v_id uuid;
  emp public.employees;
begin
  foreach v_no in array array['DEMO-0001', 'DEMO-0002'] loop
    select * into emp from public.employees where employee_no = v_no;
    if not found then
      raise exception 'There is no employee %. Run seed-demo.sql first.', v_no;
    end if;
    v_email := lower(v_no) || '@' || v_domain;
    v_id := coalesce(emp.user_id, (select id from auth.users where lower(email) = v_email));

    if v_id is null then
      -- the sign-up trigger checks these three facts against the 201 file, then links the login
      v_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                              raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                              confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
              extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(),
              '{"provider": "email", "providers": ["email"]}',
              jsonb_build_object('account_type', 'employee', 'employee_no', emp.employee_no,
                                 'birthdate', emp.birthdate, 'mobile_no', emp.mobile_no),
              now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), v_id, v_id::text, 'email',
              jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());
    else
      update auth.users
      set email = v_email, encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
          email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
      where id = v_id;
      update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email)
      where user_id = v_id and provider = 'email';
    end if;

    update public.profiles set must_change_password = false, email = v_email where id = v_id;
    raise notice '% signs in with the password "%" (login email %).', v_no, v_password, v_email;
  end loop;
end $$;
