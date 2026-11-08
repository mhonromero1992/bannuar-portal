# Prompt: the Bannuar employee app

## How to use this prompt

1. On GitHub, create an empty repository **`mhonromero1992/bannuar-app`**.
2. In the other account, start a Claude Code session with **`bannuar-app`** and
   **`bannuar-portal`** attached (and `bannuar-website` and `IBITS-DIGITAL/atlas` if that account
   can see them). If it should build the Android app and run read-only checks against the live
   database, its environment must allow `bcynizcgdgqznlxuzwjx.supabase.co` and Google's Android
   hosts (`dl.google.com`, `maven.google.com`).
3. Paste everything below the line.

---

You are building the **employee mobile app** for Bannuar Security Agency, Inc. (San Juan, La Union,
Philippines; about 4,000 security guards, a figure from the client brief). House of Gaia builds it.
Two parts already exist and work. Do not rebuild them:

- **Website** (`mhonromero1992/bannuar-website`, Astro): job applications, proposal requests, the
  certificate check at `/verify`.
- **HR portal** (`mhonromero1992/bannuar-portal`, React + Vite): HR, payroll and operations manage
  201 files, posts, licenses, payslips, leave, certificates of employment (COE), announcements.

All three use **one Supabase project**. The app is for employees on their phones, and it reads and
writes the same database through the same row level security. Build it in `bannuar-app`, commit
and push to the branch your session gives you, and open no pull request unless asked.

## Read these first

In `bannuar-portal`:
- `supabase/schema.sql`: the whole database, and the contract. Before you write any query, read the
  table, its policies and its triggers. Start with `handle_new_user`, `check_employee_activation`,
  `my_access`, `mark_password_changed`, `admin_reset_password`, `current_employee_id`, and the
  `*_before_insert` triggers.
- `tests/schema-snapshot.json`: the real schema exported from Postgres. Check every request the app
  makes against it.
- `supabase/tests/run-tests.sh` (112 database checks, all passing), `supabase/seed-demo.sql`.
- `src/lib/labels.ts` and `src/lib/format.ts`: reuse the portal's status wording and its peso and
  date formats, so HR and employees see the same words.
- `DESIGN.md`, `public/badge.png`, `src/styles.css` (colour tokens). Also read
  `bannuar-website/DESIGN.md` if it is attached.
- If `IBITS-DIGITAL/atlas` is attached, it is the reference app: copy its structure, its config
  (`babel.config.js`, `metro.config.js`, jest setup, `__mocks__/env.js`), `src/config/supabase.ts` and
  `src/services/authStorage.ts`.

## Stack: React Native CLI, the same as atlas, no Expo

- React Native **0.78.3** bare project (`@react-native-community/cli` 15.0.1), React 19.0.0,
  TypeScript. **No Expo and no expo-* modules.**
- `@react-navigation/native` ^7 and `@react-navigation/stack` ^7, `react-native-screens` 4.16.0,
  `react-native-safe-area-context` 5.3.0, `react-native-gesture-handler` 2.24.0. A bottom bar can
  be custom, or `@react-navigation/bottom-tabs` ^7 (same family); note which you chose.
- `@supabase/supabase-js` ^2.115 with `react-native-url-polyfill` ^4.
- `styled-components` ^6, `zustand` ^5, `react-native-dotenv` ^4 (`moduleName: '@env'`, mocked in
  jest via `__mocks__/env.js`).
- `react-native-bootsplash` ~6.3 (splash made from the Bannuar badge), `@notifee/react-native` ^9
  (channels and local display), `react-native-svg` 15.11.2.
- `@react-native-documents/picker` ^10 and `react-native-image-picker` ^8 for document uploads.
- Push: atlas has no remote push. Add `@react-native-firebase/app` + `messaging` (FCM). The build
  must still work without `google-services.json` / `GoogleService-Info.plist`: keep push behind a
  flag until the user supplies them.
- Keep the session in **encrypted storage** (follow atlas's `authStorage`, or use
  `react-native-keychain`), because a session opens payslips. Pause token refresh in the
  background, as in atlas.
- Use as few native modules as possible. To open a COE PDF, download it from a signed URL and hand
  it to the system viewer or share sheet. Pick the smallest option and say why.
- Layout as in atlas: `App.tsx`, `src/app/<area>/` screens, `src/navigations/`,
  `src/components/ui/`, `src/config/` (`supabase.ts`, `theme.ts`), `src/services/` (one file per
  domain), `src/store/`, `__tests__/`.
- Android first, since most guards use Android phones; iOS must build too. Default app id
  `ph.bannuar.employee` and name "Bannuar" (to be confirmed).

## Connection

- URL `https://bcynizcgdgqznlxuzwjx.supabase.co`, publishable key
  `sb_publishable_rwAYUkMVmJxXiT9SnrqlxA_VsMFHK25`. Both are public by design; build them in as
  defaults in `src/config/supabase.ts`, overridable from `.env`.
- The **service role key never goes in the app**. It lives only in Edge Function secrets.
- Tests must never write to the live project. Mock the API, and make every test fail if a request
  reaches a real `*.supabase.co` host (the portal's `tests/e2e.mjs` does this). Read-only checks
  against the live project are fine, for example `check_employee_activation` with a made-up number
  answers `no_match`.

## Sign-in and activation

The database already supports this. Facts about the live project: "Confirm email" is on, phone
sign-in is off, and guards have no company email.

- **Activation** (first time): the guard enters employee number, birthdate and mobile number (`09…`
  or `+639…`; the database normalises it with `normalize_ph_mobile`) and chooses a password.
  - The app calls a new Edge Function **`activate-employee`**. Put it in
    `bannuar-portal/supabase/functions/`, so the database and its functions stay in one place.
  - The function checks with `check_employee_activation`. It answers `ok`, `no_match` or
    `already_active`; show a plain message for each. Use the same message for any mismatch.
  - The function then creates the login with the service role:
    `auth.admin.createUser({ email: <login email>, password, email_confirm: true, user_metadata: { account_type: 'employee', employee_no, birthdate: 'YYYY-MM-DD', mobile_no } })`.
  - The `on_auth_user_created` trigger (`handle_new_user`) checks the three facts again, links
    `employees.user_id`, and adds the profile and the `employee` role. If the facts don't match, it
    raises `BANNUAR_ACTIVATION_FAILED`; return that as a clear 400.
- **Login email:** a synthetic address made from the employee number, e.g.
  `<employee_no lowercased>@employees.bannuar.invalid` (the `.invalid` domain can never receive
  mail). Confirm Supabase Auth accepts it through `admin.createUser`; if it doesn't, ask for a
  domain Bannuar controls. Nothing is ever emailed to it.
- **Harden activation.** Today anyone who knows the three facts could call `auth.signUp` with that
  metadata directly and claim the record. Make `handle_new_user` accept an employee activation
  only with a one-time ticket that the Edge Function writes to a service-role-only table. Also
  rate-limit and log attempts per employee number and per IP.
- **Demo logins already exist:** `supabase/demo-employee-logins.sql` makes app logins for DEMO-0001
  (detachment commander) and DEMO-0002 (guard), password `password`, with login emails in the
  format above. Keep the app's format and that script's `v_domain` the same. If you add the
  activation ticket, make that script write one too, so the demo keeps working.
- **Sign-in:** the guard enters employee number and password. The app turns the number into the
  login email and calls `signInWithPassword`, then `rpc('my_access')`. That returns `roles`,
  `must_change_password` and `employee {id, employee_no, full_name, position, status, site_id}`. If
  there is no employee, sign out and say "Staff accounts use the HR portal."
- **`must_change_password`:** force a "Set a new password" screen, then `auth.updateUser({ password })`
  and `rpc('mark_password_changed')`.
- **Forgot password:** there is no email reset. The screen tells the guard to ask HR for a temporary
  password. HR sets it in the portal (employee page → App account → `admin_reset_password`), which
  signs out every session and forces a new password. SMS sign-in can come later, but it needs an
  SMS provider and budget approval, so ask before building it.
- **Sign-out:** end the session, delete this phone's `device_tokens` row, and wipe cached data.

## What the app does

Every list and detail screen comes from the schema. RLS already limits an employee to their own rows
(`current_employee_id()`), so read it rather than re-filtering on trust.

1. **Home:** name and employee number; current post (`sites` via `employees.site_id`), or "Floating
   since …" when `status = 'floating'`; announcements still waiting for an acknowledgment; the
   latest published payslip, with its amount hidden until tapped; open requests; documents expiring
   soon.
2. **Announcements:** the `read announcements` policy already shows only published, unexpired items
   addressed to everyone, the guard's area or post. Pinned first, then priority. Images come from the
   `announcement-media` bucket through signed URLs. Opening one calls
   `rpc('mark_announcement_read', { p_announcement_id })`; "I acknowledge" (when `requires_ack`)
   passes `p_acknowledge: true`. Read state comes from the guard's own `announcement_receipts`.
3. **Payslips:** the guard's own `payslips` with `payroll_periods`. Employees only see a payslip once
   payroll publishes its cutoff.
   - Show earnings (`basic_pay`, `overtime_pay`, `night_diff_pay`, `holiday_pay`, `allowances`,
     `other_earnings`, plus the lines in `earnings_detail`) and deductions (`sss`, `philhealth`,
     `pagibig`, `withholding_tax`, `loans`, `other_deductions`, `deductions_detail`).
   - Also `gross_pay`, `total_deductions`, `net_pay`, days and hours, `site_name` and `pay_date`.
   - "Report a concern" inserts into `payroll_concerns` (`payslip_id`, `category`, `description`;
     take the allowed categories from the schema). Concerns are listed with status and resolution.
4. **Leave:**
   - Balances come from the view `leave_balances` (`credits`, `used`, `pending`, `year`). Rules come
     from `leave_types` (`max_days_per_request`, `requires_attachment`, `applies_to_sex`,
     `min_service_months`).
   - Filing inserts into `leave_requests`. Read `leave_requests_before_insert` for the fields the
     trigger fills in itself. An attachment goes to `employee-files/<employee_id>/uploads/…`.
   - Statuses run `pending_supervisor` → `pending_hr` → `approved` / `rejected`. A request can be
     cancelled with `rpc('cancel_leave_request')`.
5. **Certificate of employment:**
   - A request inserts into `coe_requests` (`purpose`, `purpose_details`, `include_compensation`,
     `addressee`). The trigger sets `due_at`, three days, per DOLE Labor Advisory 06-20.
   - A request can be cancelled with `rpc('cancel_coe_request')`.
   - Once issued, the `certificates` row has `certificate_no`, `verification_code` and `file_path`;
     the PDF is at `certificates/<employee_id>/<certificate_id>.pdf`. Open or share it, and explain
     that anyone can check the code on the website's `/verify` page.
6. **My records** (the guard's 201 file, read-only):
   - Profile, employment and post details.
   - Government numbers through `rpc('get_government_ids', { p_employee_id })`, masked until
     tapped.
   - Documents: `employee_documents` with `document_types` where `visible_to_employee`, showing
     status (`pending_review`, `verified`, `rejected`) and expiry.
   - "Upload a renewal" for types with `employee_can_upload`: upload the file to
     `employee-files/<employee_id>/uploads/<uuid>.<ext>`, then insert the row. Read
     `employee_documents_before_write` for what it forces; HR verifies in the portal.
7. **Change my details:** insert into `profile_change_requests` (`changes` jsonb, `reason`). Take the
   allowed keys from its trigger. HR applies or declines.
8. **Notifications:**
   - List the guard's own `notifications` (`title`, `body`, `kind`, `link`, `read_at`) and mark them
     read. Subscribe through Realtime on `user_id`. `link` deep-links to the right screen; the app
     icon shows a badge count.
   - Push: upsert the FCM token into `device_tokens` (`token`, `user_id`, `platform`,
     `app_version`) and refresh `last_seen_at`.
   - Add a second Edge Function, **`send-push`**. A Database Webhook on inserts into
     `public.notifications` calls it, and it sends to that user's tokens through FCM HTTP v1. Push
     text never contains amounts or personal numbers.
9. **Commanders:** if `roles` includes `supervisor`, add "My post".
   - It shows the guards at the posts in `my_supervised_site_ids()` and leave waiting for
     endorsement (`pending_supervisor`).
   - Endorse or decline with a reliever via `rpc('decide_leave_request', { p_request_id, p_approve, p_note, p_reliever_id })`.
     Read `decide_leave_request` and `supervises()` first.
10. **Account:** change password, the privacy notice (website `/privacy`), app version, sign out.

PostgREST refuses an embed when two tables are linked more than one way, so name the foreign key:
`sites!employees_site_id_fkey(...)` from `employees` (`site_supervisors` links them too),
`employees!leave_requests_employee_id_fkey`, `certificates!coe_requests_certificate_fk`. The
portal's `tests/e2e.mjs` counts the links the way PostgREST does; run the same check on the app's
requests.

## Database changes

Do not change anything the portal relies on. If the app needs more (the activation ticket and
rate-limit tables, a function):
- Add it to `bannuar-portal/supabase/schema.sql` as idempotent, re-runnable SQL in the right
  section.
- Add checks to `supabase/tests/run-tests.sh` and keep every check passing.
- Regenerate `tests/schema-snapshot.json`, and keep the portal's `npm run test:e2e` passing.
- Give the user the exact steps: re-run `schema.sql` in the SQL Editor, set the Edge Function
  secrets, deploy the functions, add the webhook.

## Design

- **Brand:**
  - Bannuar's badge (`bannuar-portal/public/badge.png`). Ask for the vector original for the app
    icon; never redraw the logo.
  - Colour tokens from the portal: night `#0b1626` / `#13253d` / `#1b3150`, ground `#f6f3ec`, panel
    `#ffffff` / `#f1ede3`, ink `#0d1a2b`, muted `#4f5b6b`, faint `#6b7686`, gold beacon `#f2c230`
    (ink on gold `#7a5900`), red `#c4161c` (hover `#d9262c`, press `#a51117`), pale `#aebccf`,
    on-night `#eef2f7`.
  - One accent, Bannuar red. Never put red text on night.
  - Archivo, the font the website uses, bundled in the weights you need.
- **The people:** guards on low-end Android phones with prepaid data, working night shifts and
  standing in sunlight. So:
  - 16sp base text that follows the system font size.
  - 48dp touch targets.
  - Contrast computed to WCAG AA in light and dark.
  - Fast cold start and a small APK.
  - Plain English with short words. Ask whether Filipino is wanted.
- **States:** every screen has loading, empty, error and offline states. Offline, show the last
  loaded data with "Offline · updated <time>". Keep anything personal only in encrypted storage,
  and wipe it at sign-out.
- **Copy:** no em dashes in UI text. No invented data, numbers or testimonials; demo data only
  through `seed-demo.sql`, which marks itself as demo. Buttons name the action ("File leave",
  "Request a certificate"). Use ₱1,234.56, "8 Nov 2026" and "0917 123 4567".
- Write `DESIGN.md` with the reason for each decision, and use the same language as the portal and
  the website.

## Security and privacy (Data Privacy Act, RA 10173)

- Payslips, government numbers, birthdates and addresses never reach logs, analytics, crash reports
  or push text. Add no third-party SDK without asking.
- Block screenshots (`FLAG_SECURE`) on the payslip and government number screens.
- Offer an app lock (device biometrics or PIN), off by default (to confirm).

## Proof before you say it is done

- `npx tsc --noEmit`, `npm run lint` and `npm test` (jest) all pass. Write unit tests for every
  service (request shape), activation and its messages, the must-change-password route, peso and
  date formatting, leave days, notification deep links and the commander flow.
- Write a contract test: run the services against a mocked fetch, record every REST, RPC and storage
  request, and check each against `schema-snapshot.json` (tables, columns, relations, filters,
  function names and arguments).
- Edge Functions have Deno tests with a mocked admin client.
- Try `cd android && ./gradlew assembleDebug`. If the container can't (no SDK or no network), say
  so plainly and give the exact commands to build and install on a phone. Never claim a build or a
  device run you didn't do.
- In `README.md`, cover: run, debug and release builds (APK and AAB, signing), `.env`, Firebase
  files, Play Console internal testing, and a "To confirm with Bannuar" list. In the final message,
  give what passed, what you couldn't run and why, and the user's next steps.

## Don't stop to ask

Use these defaults, list them under "To confirm with Bannuar" in the README, and keep building:
- app id and name
- the login email domain
- the Firebase files (push stays off until they arrive)
- the HR contact line (no phone or email has been verified yet, so publish none)
- app lock
- Filipino text
- SMS sign-in
