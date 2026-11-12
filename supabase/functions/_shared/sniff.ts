/**
 * What a file really is, from its first bytes. The files Edge Function trusts this, not the name or the
 * type the phone or browser reports, so only PDFs and photos reach S3.
 */
export type StoredType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniffType(b: Uint8Array): StoredType | null {
  const at = (i: number, sig: number[]) => b.length >= i + sig.length && sig.every((x, j) => b[i + j] === x);
  if (at(0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  if (at(4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
  }
  // the PDF header may sit anywhere in the first 1024 bytes
  const head = b.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return 'application/pdf';
    }
  }
  return null;
}
