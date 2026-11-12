import { FUNCTIONS_URL, PUBLIC_KEY, openFile, supabase } from './supabase';

/**
 * Employee files live in Amazon S3, put there by the files Edge Function, which holds the AWS keys and
 * asks the database who may store or open what. Each employee has one folder:
 *   employees/<employee number>/201-file | work-requirements | lesp | attendance | leave | certificates
 * Files stored before the switch stay in Supabase Storage and still open (their paths do not start with
 * employees/). Payslips are never stored: their PDF is made on download by the payslip-pdf function.
 */
export const isS3Key = (path: string | null | undefined): path is string => Boolean(path && path.startsWith('employees/'));

export type UploadPurpose = 'document' | 'leave' | 'attendance' | 'certificate';
export interface StoredFile {
  id: string;
  key: string;
  name: string;
  content_type: string;
  size_bytes: number;
}

/** The S3 folders a document type can file into (document_types.storage_folder). */
export const STORAGE_FOLDER: Record<string, string> = {
  '201-file': '201 file',
  'work-requirements': 'Work requirements',
  lesp: 'LESP',
};

async function post(fn: 'files' | 'payslip-pdf', body: FormData | string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your sign-in has expired. Sign in again.');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY };
  if (typeof body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch(`${FUNCTIONS_URL}/${fn}`, { method: 'POST', headers, body });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message || `The request failed (${res.status}). Try again.`);
  }
  return res;
}

/** Puts a file in the employee's S3 folder; the database picks the folder and the name. */
export async function uploadFile(opts: {
  purpose: UploadPurpose;
  file: Blob;
  fileName?: string;
  employeeId?: string;
  documentTypeId?: string;
  certificateId?: string;
}): Promise<StoredFile> {
  const form = new FormData();
  form.set('purpose', opts.purpose);
  if (opts.employeeId) form.set('employee_id', opts.employeeId);
  if (opts.documentTypeId) form.set('document_type_id', opts.documentTypeId);
  if (opts.certificateId) form.set('certificate_id', opts.certificateId);
  form.set('file', opts.file, opts.fileName ?? 'file');
  return (await (await post('files', form)).json()) as StoredFile;
}

/** Five-minute links to S3 files, up to 200 a request; keys this person may not open are left out. */
export async function signFiles(keys: string[], download = false): Promise<Record<string, string>> {
  const s3 = [...new Set(keys.filter(isS3Key))];
  const urls: Record<string, string> = {};
  for (let i = 0; i < s3.length; i += 200) {
    const res = await post('files', JSON.stringify({ action: 'sign', keys: s3.slice(i, i + 200), download }));
    Object.assign(urls, ((await res.json()) as { urls: Record<string, string> }).urls);
  }
  return urls;
}

/** Opens a stored file in a new tab: S3 through a five-minute link, older files from Supabase Storage. */
export async function openStoredFile(bucket: string, path: string, download = false) {
  if (!isS3Key(path)) return openFile(bucket, path);
  const win = window.open('about:blank', '_blank');
  try {
    const link = (await signFiles([path], download))[path];
    if (!link) throw new Error('This file is not available to you.');
    if (win) win.location.href = link;
    else window.location.href = link;
  } catch (e) {
    win?.close();
    throw e;
  }
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** The payslip as a PDF, made now by the payslip-pdf function and saved by the browser; never stored. */
export async function downloadPayslipPdf(payslipId: string) {
  const res = await post('payslip-pdf', JSON.stringify({ payslip_id: payslipId }));
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'payslip.pdf';
  saveBlob(await res.blob(), name);
}

export interface StorageCheck {
  ok: boolean;
  bucket: string | null;
  region: string | null;
  step?: string;
  aws_code?: string;
  message?: string;
}

/** Super admins: store, read back and delete a test file, and make sure the bucket is private. */
export async function checkFileStorage(): Promise<StorageCheck> {
  return (await (await post('files', JSON.stringify({ action: 'check' }))).json()) as StorageCheck;
}
