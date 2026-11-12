/**
 * The payslip as a one-page PDF (US Letter, Helvetica, the portal's colours). Made fresh on every
 * download and never stored: the payslip row is the record. Amounts read "PHP 1,234.56" because the
 * standard PDF fonts have no peso sign.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';

export interface PayslipRow {
  site_name: string | null;
  days_worked: number | string | null;
  hours_worked: number | string | null;
  overtime_hours: number | string | null;
  night_diff_hours: number | string | null;
  basic_pay: number | string | null;
  overtime_pay: number | string | null;
  night_diff_pay: number | string | null;
  holiday_pay: number | string | null;
  allowances: number | string | null;
  other_earnings: number | string | null;
  gross_pay: number | string | null;
  sss: number | string | null;
  philhealth: number | string | null;
  pagibig: number | string | null;
  withholding_tax: number | string | null;
  loans: number | string | null;
  other_deductions: number | string | null;
  total_deductions: number | string | null;
  net_pay: number | string | null;
  earnings_detail: { label: string; amount: number | string }[] | null;
  deductions_detail: { label: string; amount: number | string }[] | null;
  remarks: string | null;
  period: { label: string; period_start: string; period_end: string; pay_date: string; status: string } | null;
  employee: { employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; position: string | null } | null;
}

export interface PayLine {
  label: string;
  amount: number;
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const cents = (v: number) => Math.round(v * 100) / 100;

/**
 * The lines of a payslip, the same way the app shows them: the fixed columns, then the extra lines the
 * import wrote; "Other" keeps only what the extra lines do not explain. Zero lines are left out.
 */
export function payslipLines(p: PayslipRow): { earnings: PayLine[]; deductions: PayLine[] } {
  const extraE = (p.earnings_detail ?? []).map((l) => ({ label: l.label, amount: n(l.amount) }));
  const extraD = (p.deductions_detail ?? []).map((l) => ({ label: l.label, amount: n(l.amount) }));
  const earnings: PayLine[] = [
    { label: 'Basic pay', amount: n(p.basic_pay) },
    { label: 'Overtime', amount: n(p.overtime_pay) },
    { label: 'Night differential', amount: n(p.night_diff_pay) },
    { label: 'Holiday pay', amount: n(p.holiday_pay) },
    { label: 'Allowances', amount: n(p.allowances) },
    ...extraE,
    { label: 'Other earnings', amount: cents(n(p.other_earnings) - extraE.reduce((s, l) => s + l.amount, 0)) },
  ];
  const deductions: PayLine[] = [
    { label: 'SSS', amount: n(p.sss) },
    { label: 'PhilHealth', amount: n(p.philhealth) },
    { label: 'Pag-IBIG', amount: n(p.pagibig) },
    { label: 'Withholding tax', amount: n(p.withholding_tax) },
    { label: 'Loans', amount: n(p.loans) },
    ...extraD,
    { label: 'Other deductions', amount: cents(n(p.other_deductions) - extraD.reduce((s, l) => s + l.amount, 0)) },
  ];
  return { earnings: earnings.filter((l) => l.amount !== 0), deductions: deductions.filter((l) => l.amount !== 0) };
}

export function money(v: number): string {
  const [whole, dec] = Math.abs(v).toFixed(2).split('.');
  return `${v < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-31' -> '31 Oct 2026' */
export function day(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

export function fullName(e: PayslipRow['employee']): string {
  if (!e) return '';
  const middle = e.middle_name?.trim() ? `${e.middle_name.trim()[0]}.` : '';
  return [e.first_name, middle, e.last_name, e.suffix?.trim() || ''].filter(Boolean).join(' ').trim();
}

/** Standard PDF fonts cover Latin-1: keep ñ and accents, replace anything else so a name never breaks the file. */
const latin1 = (s: string) =>
  s.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || '?');

/** 'payslip-G-002-2026-10-16-to-2026-10-31.pdf' */
export function fileName(p: PayslipRow): string {
  const no = (p.employee?.employee_no ?? 'employee').replace(/[^A-Za-z0-9-]+/g, '-');
  return `payslip-${no}-${p.period?.period_start ?? ''}-to-${p.period?.period_end ?? ''}.pdf`;
}

const NIGHT = rgb(11 / 255, 22 / 255, 38 / 255);
const RED = rgb(196 / 255, 22 / 255, 28 / 255);
const MUTED = rgb(0.31, 0.36, 0.42);
const GOLD = rgb(242 / 255, 194 / 255, 48 / 255);
const LINE = rgb(0.87, 0.85, 0.8);
const WHITE = rgb(1, 1, 1);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function payslipPdf(p: PayslipRow, madeAt: Date): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin1(`Payslip ${p.period?.label ?? ''}`.trim()));
  pdf.setAuthor('Bannuar Security Agency, Inc.');
  pdf.setProducer('Bannuar HR');
  pdf.setCreationDate(madeAt);
  const page: PDFPage = pdf.addPage([612, 792]); // US Letter, as the certificates of employment
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const M = 56;
  const W = 612 - 2 * M;
  const draw = (s: string, x: number, y: number, size: number, font = regular, color = NIGHT) =>
    page.drawText(latin1(s), { x, y, size, font, color });
  const right = (s: string, xRight: number, y: number, size: number, font = regular, color = NIGHT) =>
    draw(s, xRight - font.widthOfTextAtSize(latin1(s), size), y, size, font, color);

  // heading
  let y = 736;
  draw('BANNUAR SECURITY AGENCY, INC.', M, y, 11, bold);
  right('PAYSLIP', M + W, y - 4, 22, bold, RED);
  draw(p.period?.label ?? '', M, y - 18, 10, regular, MUTED);
  y -= 34;
  page.drawRectangle({ x: M, y, width: W, height: 3, color: GOLD });
  if (p.period?.status !== 'published') {
    y -= 18;
    draw('DRAFT: this cutoff is not yet published to the employee.', M, y, 10, bold, RED);
  }

  // who and when
  y -= 30;
  const facts: [string, string][] = [
    ['Employee', fullName(p.employee)],
    ['Employee number', p.employee?.employee_no ?? ''],
    ['Position', p.employee?.position ?? ''],
    ['Post', p.site_name ?? ''],
  ];
  const period: [string, string][] = [
    ['Cutoff', `${day(p.period?.period_start)} to ${day(p.period?.period_end)}`],
    ['Pay date', day(p.period?.pay_date)],
    ['Days worked', String(n(p.days_worked))],
    ['Hours worked', `${n(p.hours_worked)} (overtime ${n(p.overtime_hours)}, night ${n(p.night_diff_hours)})`],
  ];
  facts.forEach(([k, v], i) => {
    draw(k, M, y - i * 30, 8, bold, MUTED);
    draw(v, M, y - i * 30 - 12, 11);
  });
  period.forEach(([k, v], i) => {
    draw(k, M + W / 2, y - i * 30, 8, bold, MUTED);
    draw(v, M + W / 2, y - i * 30 - 12, 11);
  });
  y -= 4 * 30 + 10;

  // earnings and deductions, side by side
  const { earnings, deductions } = payslipLines(p);
  const colW = (W - 24) / 2;
  const table = (title: string, rows: PayLine[], total: [string, number], x: number, top: number) => {
    let ty = top;
    draw(title.toUpperCase(), x, ty, 8, bold, MUTED);
    right('PHP', x + colW, ty, 8, bold, MUTED);
    ty -= 8;
    page.drawLine({ start: { x, y: ty }, end: { x: x + colW, y: ty }, thickness: 0.8, color: LINE });
    for (const r of rows) {
      ty -= 18;
      draw(r.label, x, ty, 10);
      right(money(r.amount), x + colW, ty, 10);
    }
    ty -= 10;
    page.drawLine({ start: { x, y: ty }, end: { x: x + colW, y: ty }, thickness: 0.8, color: LINE });
    ty -= 16;
    draw(total[0], x, ty, 10, bold);
    right(money(total[1]), x + colW, ty, 10, bold);
    return ty;
  };
  const endL = table('Earnings', earnings, ['Gross pay', n(p.gross_pay)], M, y);
  const endR = table('Deductions', deductions, ['Total deductions', n(p.total_deductions)], M + colW + 24, y);
  y = Math.min(endL, endR) - 58;

  // net pay
  page.drawRectangle({ x: M, y: y - 14, width: W, height: 44, color: NIGHT });
  draw('NET PAY', M + 16, y + 2, 10, bold, GOLD);
  right(`PHP ${money(n(p.net_pay))}`, M + W - 16, y, 18, bold, WHITE);
  y -= 50;

  if (p.remarks?.trim()) {
    draw('REMARKS', M, y, 8, bold, MUTED);
    for (const line of wrap(latin1(p.remarks.trim()), regular, 9, W).slice(0, 8)) {
      y -= 13;
      draw(line, M, y, 9);
    }
    y -= 16;
  }

  // footer
  const made = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(madeAt);
  draw(`Made ${made} (Manila time) from Bannuar's payroll records. This PDF is not stored; download it again any time.`, M, 72, 8, regular, MUTED);
  draw('Something wrong? Report a concern from this payslip in the Bannuar app.', M, 60, 8, regular, MUTED);
  return await pdf.save();
}
