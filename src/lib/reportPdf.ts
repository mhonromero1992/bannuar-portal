import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { fmtAmount } from './format';
import { latin1 } from './pdfText';

/**
 * A report as a PDF: landscape A4, the Bannuar badge and the report's name and filters at the top, the
 * table with its header repeated on every page, totals at the end, and "page n of N" with when it was
 * made and by whom at the foot. Standard fonts, so text goes through latin1 (the peso sign as "PHP").
 */
export interface ReportColumn {
  label: string;
  /** relative width; the columns share the page width */
  width?: number;
  align?: 'left' | 'right';
  /** pesos: shown as 1,675,250.00 (the Excel file keeps 1675250.00) */
  money?: boolean;
}
export interface ReportPdf {
  title: string;
  lines: string[];
  columns: ReportColumn[];
  rows: (string | number | null)[][];
  totals?: (string | number | null)[];
  madeBy: string;
}

const NIGHT = rgb(11 / 255, 22 / 255, 38 / 255);
const RED = rgb(196 / 255, 22 / 255, 28 / 255);
const MUTED = rgb(0.31, 0.36, 0.42);
const LINE = rgb(0.86, 0.86, 0.84);
const ZEBRA = rgb(0.975, 0.97, 0.955);
const W = 842;
const H = 595;
const M = 32;

/** Cut text to fit a width, with an ellipsis. */
function fit(text: string, font: PDFFont, size: number, width: number) {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
/**
 * Text in a cell. Amounts (right aligned) take smaller type, down to 5 points, so a total like 1,675,250.00
 * is never cut. Words take type a little smaller when that makes them fit whole; otherwise they keep their
 * size and end in an ellipsis.
 */
function sized(text: string, font: PDFFont, size: number, width: number, amount: boolean) {
  const w = font.widthOfTextAtSize(text, size);
  if (w <= width) return { text, size };
  const s = Math.floor(((size * width) / w) * 20) / 20;
  if (amount) return { text: fit(text, font, Math.max(s, Math.min(size, 5)), width), size: Math.max(s, Math.min(size, 5)) };
  return s >= size * 0.86 ? { text, size: s } : { text: fit(text, font, size, width), size };
}
/** A column label on one line, or two when it does not fit (split between words where both lines fit best). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (font.widthOfTextAtSize(text, size) <= width || words.length < 2) return [text];
  let best: string[] = [text];
  let widest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const two = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...two.map((l) => font.widthOfTextAtSize(l, size)));
    if (w < widest) {
      widest = w;
      best = two;
    }
  }
  return best;
}
const cell = (v: string | number | null, money?: boolean) => latin1(v === null || v === undefined ? '' : money ? fmtAmount(v) : String(v));

export async function reportPdf(r: ReportPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin1(r.title));
  pdf.setAuthor('Bannuar Security Agency, Inc.');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let badge: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  try {
    badge = await pdf.embedPng(await fetch('/badge-128.png').then((x) => x.arrayBuffer()));
  } catch {
    badge = null; // the report is complete without the badge
  }

  const size = r.columns.length > 10 ? 7 : r.columns.length > 7 ? 7.6 : 8.4;
  const rowH = size + 7.5;
  const total = r.columns.reduce((t, c) => t + (c.width ?? 1), 0);
  const widths = r.columns.map((c) => ((W - 2 * M) * (c.width ?? 1)) / total);
  const xs = widths.map((_, i) => M + widths.slice(0, i).reduce((t, w) => t + w, 0));
  const made = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short' }).format(new Date());

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const drawRow = (values: (string | number | null)[], font: PDFFont, shade: boolean, color = NIGHT) => {
    if (shade) page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: ZEBRA });
    values.forEach((v, i) => {
      const right = r.columns[i].align === 'right';
      const t = sized(cell(v, r.columns[i].money), font, size, widths[i] - 6, right);
      const tw = font.widthOfTextAtSize(t.text, t.size);
      const x = right ? xs[i] + widths[i] - 3 - tw : xs[i] + 3;
      page.drawText(t.text, { x, y: y - size + 1, size: t.size, font, color });
    });
    y -= rowH;
  };
  // Column labels wrap onto a second line rather than being cut ("Other deductions", "Night diff.").
  const labels = r.columns.map((c, i) => wrap(latin1(c.label), bold, size, widths[i] - 6));
  const labelLines = Math.max(1, ...labels.map((l) => l.length));
  const lead = size + 1.6;
  const headH = rowH + (labelLines - 1) * lead;
  const header = () => {
    page.drawRectangle({ x: M, y: y - headH + 3, width: W - 2 * M, height: headH, color: NIGHT });
    labels.forEach((lines, i) => {
      const right = r.columns[i].align === 'right';
      lines.forEach((line, k) => {
        // bottom-aligned, as in a ledger: a one-line label sits on the last line
        const row = labelLines - lines.length + k;
        const t = sized(line, bold, size, widths[i] - 6, right);
        const tw = bold.widthOfTextAtSize(t.text, t.size);
        const x = right ? xs[i] + widths[i] - 3 - tw : xs[i] + 3;
        page.drawText(t.text, { x, y: y - size + 1 - row * lead, size: t.size, font: bold, color: rgb(1, 1, 1) });
      });
    });
    y -= headH;
  };
  const newPage = (first: boolean) => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    if (first) {
      if (badge) page.drawImage(badge, { x: M, y: y - 34, width: 34, height: 34 });
      const left = badge ? M + 44 : M;
      page.drawText('BANNUAR SECURITY AGENCY, INC.', { x: left, y: y - 10, size: 8, font: bold, color: RED });
      page.drawText(fit(latin1(r.title), bold, 16, W - left - M), { x: left, y: y - 28, size: 16, font: bold, color: NIGHT });
      y -= 44;
      for (const line of r.lines) {
        page.drawText(fit(latin1(line), regular, 8.6, W - 2 * M), { x: M, y: y - 9, size: 8.6, font: regular, color: MUTED });
        y -= 12;
      }
      y -= 6;
    } else {
      page.drawText(fit(latin1(r.title), bold, 9, W - 2 * M), { x: M, y: y - 9, size: 9, font: bold, color: NIGHT });
      y -= 18;
    }
    header();
  };

  newPage(true);
  if (!r.rows.length) {
    page.drawText('Nothing to report for these filters.', { x: M + 3, y: y - 14, size: 10, font: regular, color: MUTED });
  }
  r.rows.forEach((row, i) => {
    if (y - rowH < M + 24) newPage(false);
    drawRow(row, regular, i % 2 === 1);
  });
  if (r.totals) {
    if (y - rowH < M + 24) newPage(false);
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 1, color: NIGHT });
    drawRow(r.totals, bold, false);
  }
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 2 }, end: { x: W - M, y: M - 2 }, thickness: 0.5, color: LINE });
    p.drawText(fit(latin1(`Made ${made} by ${r.madeBy} · Bannuar HR portal`), regular, 7.5, W - 2 * M - 80), { x: M, y: M - 13, size: 7.5, font: regular, color: MUTED });
    const n = `Page ${i + 1} of ${pages.length}`;
    p.drawText(n, { x: W - M - regular.widthOfTextAtSize(n, 7.5), y: M - 13, size: 7.5, font: regular, color: MUTED });
  });
  return pdf.save();
}
