import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';
import { WEBSITE_URL } from './supabase';
import { fmtLongDate } from './format';
import { COE_PURPOSE } from './labels';

export interface Certificate {
  id: string; certificate_no: string; verification_code: string; employee_id: string; employee_name: string; position: string | null;
  date_hired: string | null; date_separated: string | null; purpose: string | null; include_compensation: boolean;
  compensation_text: string | null; signatory_name: string; signatory_title: string; issued_at: string; file_path: string | null; revoked_at?: string | null;
}

const NIGHT = rgb(11 / 255, 22 / 255, 38 / 255);
const RED = rgb(196 / 255, 22 / 255, 28 / 255);
const MUTED = rgb(0.31, 0.36, 0.42);
const GOLD = rgb(242 / 255, 194 / 255, 48 / 255);

/** Standard PDF fonts cover Latin-1: keep ñ and accents, replace anything else so a name never breaks the file. */
const latin1 = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || '?');

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** The certificate of employment as a PDF, with its verification code and a QR code to the website's check page. */
export async function certificatePdf(c: Certificate): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Certificate of employment ${c.certificate_no}`);
  pdf.setAuthor('Bannuar Security Agency, Inc.');
  const page = pdf.addPage([612, 792]); // US Letter, the common size in the Philippines
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const margin = 64;

  try {
    const badge = await fetch('/badge-128.png').then((r) => r.arrayBuffer());
    const img = await pdf.embedPng(badge);
    page.drawImage(img, { x: margin, y: 672, width: 64, height: 64 });
  } catch {
    // the certificate is complete without the badge
  }
  page.drawText('BANNUAR SECURITY AGENCY, INC.', { x: margin + 78, y: 712, size: 15, font: bold, color: NIGHT });
  page.drawText('2nd floor, Prime Place Estate, Diversion Road, Panicsican, San Juan, La Union', { x: margin + 78, y: 694, size: 8.5, font: regular, color: MUTED });
  page.drawText(latin1(`No. ${c.certificate_no}`), { x: width - margin - bold.widthOfTextAtSize(`No. ${c.certificate_no}`, 9), y: 744, size: 9, font: bold, color: MUTED });
  page.drawLine({ start: { x: margin, y: 660 }, end: { x: width - margin, y: 660 }, thickness: 1.2, color: GOLD });

  const title = 'CERTIFICATE OF EMPLOYMENT';
  page.drawText(title, { x: (width - bold.widthOfTextAtSize(title, 18)) / 2, y: 610, size: 18, font: bold, color: NIGHT });

  const until = c.date_separated ? `until ${fmtLongDate(c.date_separated)}` : 'up to the present';
  const paragraphs = [
    'TO WHOM IT MAY CONCERN:',
    `This is to certify that ${c.employee_name.toUpperCase()} has been employed by Bannuar Security Agency, Inc. as ${c.position ?? 'an employee'} from ${fmtLongDate(c.date_hired) || 'the date of hiring on file'} ${until}.`,
    ...(c.include_compensation && c.compensation_text ? [`The employee's compensation is ${c.compensation_text}.`] : []),
    `This certification is issued upon the request of the employee${c.purpose ? ` for ${(COE_PURPOSE[c.purpose] ?? c.purpose).toLowerCase()} purposes` : ''}.`,
    `Issued on ${fmtLongDate(c.issued_at)} at San Juan, La Union.`,
  ];
  let y = 560;
  for (const p of paragraphs) {
    for (const line of wrap(latin1(p), regular, 11.5, width - margin * 2)) {
      page.drawText(line, { x: margin, y, size: 11.5, font: regular, color: NIGHT });
      y -= 17;
    }
    y -= 12;
  }

  const signY = Math.min(y - 40, 300);
  page.drawLine({ start: { x: margin, y: signY }, end: { x: margin + 220, y: signY }, thickness: 0.8, color: NIGHT });
  page.drawText(latin1(c.signatory_name.toUpperCase()), { x: margin, y: signY - 16, size: 11, font: bold, color: NIGHT });
  page.drawText(latin1(c.signatory_title), { x: margin, y: signY - 30, size: 10, font: regular, color: MUTED });

  // verification block
  const url = `${WEBSITE_URL}/verify/?code=${encodeURIComponent(c.verification_code)}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: '#0b1626', light: '#ffffff' } });
  const qrImg = await pdf.embedPng(qr);
  const boxX = width - margin - 236;
  page.drawRectangle({ x: boxX, y: 70, width: 236, height: 104, color: NIGHT });
  page.drawImage(qrImg, { x: boxX + 10, y: 80, width: 84, height: 84 });
  page.drawText('VERIFICATION CODE', { x: boxX + 104, y: 146, size: 7.5, font: bold, color: rgb(0.68, 0.74, 0.81) });
  page.drawText(c.verification_code, { x: boxX + 104, y: 126, size: 14, font: bold, color: GOLD });
  page.drawText('Check this certificate at', { x: boxX + 104, y: 104, size: 7.5, font: regular, color: rgb(0.93, 0.95, 0.97) });
  const host = WEBSITE_URL.replace(/^https?:\/\//, '');
  page.drawText(latin1(`${host}/verify`), { x: boxX + 104, y: 92, size: 7.5, font: bold, color: rgb(0.93, 0.95, 0.97) });
  page.drawText('Not valid without a matching online check.', { x: margin, y: 80, size: 8, font: regular, color: MUTED });
  page.drawLine({ start: { x: margin, y: 60 }, end: { x: width - margin, y: 60 }, thickness: 1.2, color: RED });
  return pdf.save();
}

export function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
