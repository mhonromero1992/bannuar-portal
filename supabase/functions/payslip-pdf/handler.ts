/**
 * payslip-pdf: one payslip as a PDF, made on request and never stored (not in S3, not anywhere).
 *
 * POST { payslip_id } with the person's own token. The payslip is read with that token, so the
 * database's rules decide: an employee gets only their own, once payroll has published the cutoff;
 * payroll staff get any (a draft cutoff's PDF says DRAFT). Answers application/pdf as a download, or
 * { code, message } with 400, 401, 404, 405 or 500. Nothing personal is logged.
 */
import { bearer, CORS_HEADERS, json } from '../_shared/http.ts';
import { fileName, payslipPdf, type PayslipRow } from './pdf.ts';

/** The columns the PDF shows, read with the person's own token (schema-checked in the tests). */
export const PAYSLIP_SELECT =
  'site_name,days_worked,hours_worked,overtime_hours,night_diff_hours,basic_pay,overtime_pay,night_diff_pay,holiday_pay,' +
  'allowances,other_earnings,gross_pay,sss,philhealth,pagibig,withholding_tax,loans,other_deductions,total_deductions,' +
  'net_pay,earnings_detail,deductions_detail,remarks,' +
  'period:payroll_periods(label,period_start,period_end,pay_date,status),' +
  'employee:employees(employee_no,first_name,middle_name,last_name,suffix,position)';

export type LoadPayslip = (
  jwt: string,
  id: string,
) => Promise<{ data: PayslipRow | null; error: { message: string; code?: string } | null }>;

export interface PayslipPdfDeps {
  load: LoadPayslip;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, string | number | boolean>) => void;
}

export const MESSAGES = {
  signed_out: 'Your sign-in has expired. Sign in again.',
  not_found: 'There is no payslip here for you.',
  invalid_input: 'Say which payslip.',
  server: 'Something went wrong on our side. Try again in a few minutes.',
  method: 'Use POST.',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, code: keyof typeof MESSAGES) => json(status, { code, message: MESSAGES[code] });

export function createPayslipPdfHandler(deps: PayslipPdfDeps) {
  const now = deps.now ?? (() => new Date());
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (req.method !== 'POST') return fail(405, 'method');
    const jwt = bearer(req);
    if (!jwt) return fail(401, 'signed_out');
    const body = (await req.json().catch(() => null)) as { payslip_id?: unknown } | null;
    const id = typeof body?.payslip_id === 'string' ? body.payslip_id : '';
    if (!UUID.test(id)) return fail(400, 'invalid_input');
    try {
      const r = await deps.load(jwt, id);
      if (r.error) {
        if ((r.error.code ?? '').startsWith('PGRST30') || /\bjwt\b/i.test(r.error.message)) return fail(401, 'signed_out');
        deps.log?.('db_error', { sqlstate: (r.error.code ?? '').slice(0, 12) });
        return fail(500, 'server');
      }
      if (!r.data) return fail(404, 'not_found');
      const bytes = await payslipPdf(r.data, now());
      deps.log?.('made', { bytes: bytes.length });
      return new Response(bytes as BodyInit, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'access-control-expose-headers': 'content-disposition',
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${fileName(r.data)}"`,
          'cache-control': 'no-store',
        },
      });
    } catch (e) {
      deps.log?.('error', { name: e instanceof Error ? e.name : 'unknown' });
      return fail(500, 'server');
    }
  };
}
