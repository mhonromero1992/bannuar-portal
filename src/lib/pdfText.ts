/**
 * Text for PDFs drawn with the standard fonts (Helvetica), which cover Latin-1 only: keep ñ and accents,
 * write the peso sign as "PHP " (the fonts have no ₱), and replace anything else so a name never breaks
 * the file. supabase/functions/payslip-pdf/pdf.ts keeps the same rule for payslips.
 */
export const latin1 = (s: string) =>
  s.normalize('NFC').replace(/₱\s*/g, 'PHP ').replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || '?');
