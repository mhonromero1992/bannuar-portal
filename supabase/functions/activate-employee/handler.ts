/**
 * activate-employee: a guard's first sign-in to the Bannuar app.
 *
 * POST { employee_no, birthdate: 'YYYY-MM-DD', mobile_no, password }
 *   1. begin_employee_activation (database): limits wrong tries per employee number and per IP, logs
 *      the try, checks the three facts against the 201 file (check_employee_activation) and, when they
 *      match, returns a one-time ticket.
 *   2. auth.admin.createUser with a login email made from the employee number. The on_auth_user_created
 *      trigger (handle_new_user) checks the facts again, uses up the ticket and links the login to the
 *      employee record; it raises BANNUAR_ACTIVATION_FAILED otherwise.
 *
 * Answers { status: 'activated', login_email } or { code, message } with 400, 405, 409, 429 or 500.
 * Nothing personal is logged: no employee number, birthdate, mobile number or password.
 */
import { clientIp, json } from '../_shared/http.ts';
import { loginEmail, loginEmailFits } from '../_shared/loginEmail.ts';

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type AuthError = { message: string; code?: string; status?: number } | null;

/** The part of the Supabase admin client this function uses (structural, so tests can pass a fake). */
export interface ActivateAdmin {
  rpc(fn: 'begin_employee_activation', args: Record<string, unknown>): PromiseLike<RpcResult>;
  auth: {
    admin: {
      createUser(attrs: {
        email: string;
        password: string;
        email_confirm: boolean;
        user_metadata: Record<string, string>;
      }): Promise<{ data: { user: { id: string } | null }; error: AuthError }>;
    };
  };
}

export interface ActivateDeps {
  admin: ActivateAdmin;
  loginDomain: string;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

export const MESSAGES = {
  invalid_input: 'Check the form: every field is needed.',
  no_match:
    'These details do not match our records. Check your employee number, birthdate and mobile number. If they are right, ask HR to check your 201 file.',
  already_active:
    'This employee number already has an account. Sign in with your password. If you forgot it, ask HR for a temporary password.',
  rate_limited: 'Too many tries. Wait 30 minutes, then try again.',
  activation_failed: 'We could not activate your account. Ask HR to check your details.',
  weak_password: 'Choose a stronger password: at least 8 characters, mixing letters and numbers.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;

export type ActivateCode = keyof typeof MESSAGES;

const fail = (status: number, code: ActivateCode) => json(status, { code, message: MESSAGES[code] });

/** "0917 123 4567", "+63 917 123 4567", "9171234567" -> "09171234567"; null when it is not a PH mobile. */
export function normalizeMobile(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('63') ? digits.slice(2)
    : digits.length === 11 && digits.startsWith('0') ? digits.slice(1)
    : digits.length === 10 ? digits : '';
  return /^9\d{9}$/.test(ten) ? `0${ten}` : null;
}

export function validBirthdate(v: unknown, today = new Date()): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return false;
  const year = Number(v.slice(0, 4));
  return year >= 1930 && d.getTime() < today.getTime();
}

interface Input {
  employee_no: string;
  birthdate: string;
  mobile_no: string;
  password: string;
}

export function parseInput(body: unknown): Input | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const employeeNo = typeof b.employee_no === 'string' ? b.employee_no.trim().toUpperCase() : '';
  const mobile = normalizeMobile(b.mobile_no);
  const password = typeof b.password === 'string' ? b.password : '';
  if (!employeeNo || employeeNo.length > 40 || !loginEmailFits(employeeNo)) return null;
  if (!validBirthdate(b.birthdate) || !mobile) return null;
  if (password.length < 8 || new TextEncoder().encode(password).length > 72) return null;
  return { employee_no: employeeNo, birthdate: b.birthdate, mobile_no: mobile, password };
}

export function createActivateHandler(deps: ActivateDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? (() => {});
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (req.method !== 'POST') return fail(405, 'method');

    let body: unknown;
    try {
      const text = await req.text();
      if (text.length > 4096) return fail(400, 'invalid_input');
      body = JSON.parse(text);
    } catch {
      return fail(400, 'invalid_input');
    }
    const raw = body as Record<string, unknown> | null;
    const input = parseInput(body);
    if (!input) {
      // a password that is only too short gets its own message
      if (raw && typeof raw.password === 'string' && raw.password.length > 0 && raw.password.length < 8 &&
          parseInput({ ...raw, password: 'long-enough-1' })) {
        return fail(400, 'weak_password');
      }
      return fail(400, 'invalid_input');
    }

    const check = await deps.admin.rpc('begin_employee_activation', {
      p_employee_no: input.employee_no,
      p_birthdate: input.birthdate,
      p_mobile: input.mobile_no,
      p_ip: clientIp(req),
    });
    if (check.error) {
      log('activation_check_failed', { code: check.error.code ?? '' });
      return fail(500, 'server');
    }
    const result = check.data as { status?: string; ticket?: string } | null;
    const status = result?.status;
    log('activation_check', { result: status ?? 'unknown' });
    if (status === 'no_match') return fail(400, 'no_match');
    if (status === 'already_active') return fail(409, 'already_active');
    if (status === 'rate_limited') return fail(429, 'rate_limited');
    if (status !== 'ok' || !result?.ticket) return fail(500, 'server');

    const email = loginEmail(input.employee_no, deps.loginDomain);
    const created = await deps.admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        account_type: 'employee',
        employee_no: input.employee_no,
        birthdate: input.birthdate,
        mobile_no: input.mobile_no,
        activation_ticket: result.ticket,
      },
    });
    if (created.error) {
      const e = created.error;
      const msg = e.message ?? '';
      log('activation_create_failed', { code: e.code ?? '', status: e.status ?? 0 });
      if (e.code === 'email_exists' || e.code === 'user_already_exists' || /already (been )?registered/i.test(msg)) {
        return fail(409, 'already_active');
      }
      if (e.code === 'weak_password' || (/password/i.test(msg) && e.status === 422)) return fail(400, 'weak_password');
      // Auth hides the trigger's own message behind "Database error creating new user"
      if (/BANNUAR_ACTIVATION_FAILED/.test(msg) || /database error/i.test(msg)) return fail(400, 'activation_failed');
      return fail(500, 'server');
    }
    log('activation_done', { ok: true });
    return json(200, { status: 'activated', login_email: email });
  };
}
