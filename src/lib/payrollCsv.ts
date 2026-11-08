
/** The columns import_payslips() understands, and the header spellings payroll files commonly use. */
export const COLUMNS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'employee_no', label: 'Employee number', aliases: ['employee no', 'emp no', 'employee number', 'id no', 'employee id', 'emp id'] },
  { key: 'site_name', label: 'Post', aliases: ['post', 'site', 'assignment', 'detachment', 'client'] },
  { key: 'days_worked', label: 'Days worked', aliases: ['days', 'no of days', 'days worked'] },
  { key: 'hours_worked', label: 'Hours worked', aliases: ['hours', 'total hours', 'regular hours'] },
  { key: 'overtime_hours', label: 'Overtime hours', aliases: ['ot hours', 'ot hrs', 'overtime hrs'] },
  { key: 'night_diff_hours', label: 'Night differential hours', aliases: ['nd hours', 'nd hrs', 'night diff hours'] },
  { key: 'basic_pay', label: 'Basic pay', aliases: ['basic', 'basic salary', 'regular pay'] },
  { key: 'overtime_pay', label: 'Overtime pay', aliases: ['ot pay', 'overtime', 'ot'] },
  { key: 'night_diff_pay', label: 'Night differential pay', aliases: ['nd pay', 'night diff', 'night differential', 'nd'] },
  { key: 'holiday_pay', label: 'Holiday pay', aliases: ['holiday', 'legal holiday', 'special holiday'] },
  { key: 'allowances', label: 'Allowances', aliases: ['allowance', 'cola', 'ecola'] },
  { key: 'other_earnings', label: 'Other earnings', aliases: ['other income', 'adjustments'] },
  { key: 'gross_pay', label: 'Gross pay', aliases: ['gross', 'gross income', 'total earnings'] },
  { key: 'sss', label: 'SSS', aliases: ['sss contribution', 'sss premium', 'sss ee'] },
  { key: 'philhealth', label: 'PhilHealth', aliases: ['phic', 'philhealth contribution', 'phic ee'] },
  { key: 'pagibig', label: 'Pag-IBIG', aliases: ['hdmf', 'pag ibig', 'pagibig contribution', 'hdmf ee'] },
  { key: 'withholding_tax', label: 'Withholding tax', aliases: ['tax', 'wtax', 'w/tax', 'withholding'] },
  { key: 'loans', label: 'Loans', aliases: ['loan', 'sss loan', 'pagibig loan', 'loan deductions'] },
  { key: 'other_deductions', label: 'Other deductions', aliases: ['deductions', 'other deduction'] },
  { key: 'total_deductions', label: 'Total deductions', aliases: ['total deduction', 'deductions total'] },
  { key: 'net_pay', label: 'Net pay', aliases: ['net', 'net income', 'take home', 'take home pay'] },
  { key: 'remarks', label: 'Remarks', aliases: ['remark', 'notes'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/[^a-z0-9/ :]/g, '').replace(/\s+/g, ' ').trim();

/** Header in the file -> database key, or an "earning: X" / "deduction: X" line, or null to skip. */
export function mapHeader(h: string): string | null {
  const n = norm(h);
  if (/^(earning|deduction)\s*:/.test(n)) return h.trim();
  for (const c of COLUMNS) if (n === norm(c.key) || n === norm(c.label) || c.aliases.includes(n)) return c.key;
  return null;
}

export interface Parsed { rows: Record<string, string>[]; mapping: Record<string, string | null>; unknown: string[]; error?: string }

export async function parsePayrollFile(file: File): Promise<Parsed> {
  // the CSV parser loads only when a payroll file is opened
  const Papa = (await import('papaparse')).default;
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        const mapping = Object.fromEntries(headers.map((h) => [h, mapHeader(h)]));
        if (!Object.values(mapping).includes('employee_no')) {
          resolve({ rows: [], mapping, unknown: headers, error: 'The file needs an "employee_no" (or "Employee number") column.' });
          return;
        }
        const rows = res.data.map((r) => {
          const out: Record<string, string> = {};
          for (const [h, key] of Object.entries(mapping)) if (key && r[h] !== undefined && String(r[h]).trim() !== '') out[key] = String(r[h]).trim();
          return out;
        }).filter((r) => r.employee_no);
        resolve({ rows, mapping, unknown: headers.filter((h) => !mapping[h]) });
      },
      error: (err) => resolve({ rows: [], mapping: {}, unknown: [], error: err.message }),
    });
  });
}

export function templateCsv() {
  const head = ['employee_no', 'site_name', 'days_worked', 'hours_worked', 'overtime_hours', 'night_diff_hours', 'basic_pay', 'overtime_pay', 'night_diff_pay', 'holiday_pay', 'allowances', 'sss', 'philhealth', 'pagibig', 'withholding_tax', 'loans', 'deduction: Cash advance', 'net_pay', 'remarks'];
  const example = ['G-0001', 'Main Gate', '13', '104', '52', '56', '7020', '3510', '378', '540', '0', '450', '250', '100', '0', '0', '200', '', ''];
  return `${head.join(',')}\n${example.join(',')}\n`;
}
