import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { isS3Key, openStoredFile, uploadFile } from '../lib/files';
import type { Certificate } from '../lib/coe';

// pdf-lib and the QR encoder load only when a certificate is made
const coe = () => import('../lib/coe');
import { errorText, fmtMoney } from '../lib/format';
import { COE_PURPOSE, options } from '../lib/labels';
import { SelectField, TextField } from '../ui/kit';

const SIGNATORY_KEY = 'bannuar-coe-signatory';

/**
 * Make the PDF, keep it in the employee's S3 folder (employees/<employee number>/certificates/<number>.pdf)
 * for their app, and record its key. Returns the PDF bytes.
 */
export async function storeCertificatePdf(c: Certificate) {
  const { certificatePdf } = await coe();
  const bytes = await certificatePdf(c);
  const stored = await uploadFile({
    purpose: 'certificate', certificateId: c.id, fileName: `${c.certificate_no}.pdf`,
    file: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
  });
  const { error } = await supabase.rpc('attach_certificate_file', { p_certificate_id: c.id, p_path: stored.key });
  if (error) throw error;
  return bytes;
}

export async function downloadCertificate(c: Certificate) {
  const { downloadBytes } = await coe();
  if (isS3Key(c.file_path)) {
    await openStoredFile('certificates', c.file_path, true);
    return;
  }
  if (c.file_path) {
    // certificates issued before the switch to S3
    const { data, error } = await supabase.storage.from('certificates').download(c.file_path);
    if (!error && data) {
      downloadBytes(new Uint8Array(await data.arrayBuffer()), `${c.certificate_no}.pdf`);
      return;
    }
  }
  downloadBytes(await storeCertificatePdf(c), `${c.certificate_no}.pdf`);
}

/**
 * Issue a certificate: for a pending request (requestId) or a walk-in (employeeId + purpose).
 * The signatory is remembered on this computer for the next certificate.
 */
export function IssueCoeForm({ requestId, employeeId, includeCompensation, onDone, onCancel }: {
  requestId?: string; employeeId: string; includeCompensation?: boolean; onDone: (c: Certificate) => void; onCancel: () => void;
}) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SIGNATORY_KEY) || '{}'); } catch { return {}; } })();
  const [name, setName] = useState<string>(saved.name ?? '');
  const [title, setTitle] = useState<string>(saved.title ?? 'HR Manager');
  const [purpose, setPurpose] = useState('employment');
  const [withPay, setWithPay] = useState(Boolean(includeCompensation));
  const [pay, setPay] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // offer the pay rate on file as the compensation line
    supabase.from('employee_compensation').select('pay_basis,daily_rate,monthly_rate').eq('employee_id', employeeId).maybeSingle().then(({ data }) => {
      if (!data) return;
      if (data.pay_basis === 'monthly' && data.monthly_rate) setPay(`${fmtMoney(data.monthly_rate)} a month`);
      else if (data.daily_rate) setPay(`${fmtMoney(data.daily_rate)} a day`);
    });
  }, [employeeId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !title.trim()) return setError('Enter the name and title of the person who signs.');
    if (withPay && !pay.trim()) return setError('Enter the compensation to print.');
    setBusy(true);
    try {
      const res = requestId
        ? await supabase.rpc('issue_certificate', { p_request_id: requestId, p_signatory_name: name.trim(), p_signatory_title: title.trim(), p_compensation_text: withPay ? pay.trim() : null })
        : await supabase.rpc('issue_certificate_for', { p_employee_id: employeeId, p_purpose: purpose, p_include_compensation: withPay, p_signatory_name: name.trim(), p_signatory_title: title.trim(), p_compensation_text: withPay ? pay.trim() : null });
      if (res.error) throw res.error;
      const cert = res.data as Certificate;
      localStorage.setItem(SIGNATORY_KEY, JSON.stringify({ name: name.trim(), title: title.trim() }));
      const bytes = await storeCertificatePdf(cert);
      (await coe()).downloadBytes(bytes, `${cert.certificate_no}.pdf`);
      onDone({ ...cert, file_path: `${cert.employee_id}/${cert.id}.pdf` });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!requestId && <SelectField label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} options={options(COE_PURPOSE)} />}
      <div className="form-row">
        <TextField label="Signed by" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      {requestId ? (
        includeCompensation && <p className="callout warn">The employee asked for the compensation to be printed.</p>
      ) : (
        <label className="check"><input type="checkbox" checked={withPay} onChange={(e) => setWithPay(e.target.checked)} /> Print the compensation</label>
      )}
      {withPay && <TextField label="Compensation as printed" value={pay} onChange={(e) => setPay(e.target.value)} hint="For example: ₱540.00 a day" />}
      <p className="muted small">Issuing makes the certificate number and its verification code, saves the PDF for the employee's app, and downloads a copy here.</p>
      <div className="form-foot">
        <button className="btn btn-line" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn" type="submit" aria-busy={busy}>Issue the certificate</button>
      </div>
    </form>
  );
}
