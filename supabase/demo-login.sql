-- =====================================================================================
-- DEMO LOGIN for showing the portal: bannuar@ibits.digital / password, super admin.
-- Paste into the Supabase SQL Editor after schema.sql. Safe to run again: it resets the password.
--
-- Anyone who guesses this password can see everything in the portal. Use it only while the
-- database holds demo data. Before real employees or website applications go in, delete it:
--   delete from auth.users where email = 'bannuar@ibits.digital';
-- =====================================================================================
do $$
declare
  v_email constant text := 'bannuar@ibits.digital';
  v_password constant text := 'password';
  v_name constant text := 'Bannuar Demo';
  v_code constant text := public.random_code(4) || '-' || public.random_code(4);
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = v_email;

  if v_id is null then
    -- the sign-up trigger only accepts an invited email with its code
    insert into public.staff_invitations (email, full_name, roles, code, expires_at)
    values (v_email, v_name, array['super_admin']::public.app_role[], v_code, now() + interval '1 hour')
    on conflict (email) do update
      set full_name = excluded.full_name, roles = excluded.roles, code = excluded.code,
          expires_at = excluded.expires_at, accepted_at = null, accepted_user_id = null;

    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_password, extensions.gen_salt('bf', 10)), now(),
            '{"provider": "email", "providers": ["email"]}',
            jsonb_build_object('full_name', v_name, 'invite_code', v_code),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text, 'email',
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());
  else
    update auth.users
    set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
        email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
    where id = v_id;
    insert into public.profiles (id, full_name, email) values (v_id, v_name, v_email)
    on conflict (id) do nothing;
  end if;

  insert into public.user_roles (user_id, role) values (v_id, 'super_admin') on conflict do nothing;
  update public.profiles set must_change_password = false where id = v_id;
  raise notice 'Sign in to the portal as % with the password "%".', v_email, v_password;
end $$;
