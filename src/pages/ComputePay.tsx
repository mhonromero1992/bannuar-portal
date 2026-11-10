import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorText, fmtMoney } from '../lib/format';
import { computePay, readSheet, roundTo, scheduleSheet, SHEET_COLUMNS, toCsv, toPayrollRow, type AttendanceRow, type Person } from '../lib/pay';
import { downloadFile, loadPayInputs, loadPeople, readCsv, savePayslips } from '../lib/payData';
import { ErrorState, Loading } from '../ui/kit';

interface Sheet { rows: AttendanceRow[]; errors: { row: number; message: string }[]; extra: Person[]; name: string }
const SHOW = 150;

/** Work out a cutoff's pay from the assignments (or an edited attendance sheet), then save it as payslips. */
export default function ComputePay({ period, onSaved, onClose }: { period: { id: string; label: string; period_start: string; period_end: string }; onSaved: () => void; onClose: () => void }) {
  const range = { start: period.period_start, end: period.period_end };
  const inputs = useQuery({ queryKey: ['pay-inputs', range.start, range.end], queryFn: () => loadPayInputs(range.start, range.end), gcTime: 0 });
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ inserted: number; updated: number; errors: { row: number; employee_no?: string; message: string }[] } | null>(null);
  const data = inputs.data;
  const schedule = useMemo(() => (data ? scheduleSheet(range, data.people, data.assignments, data.posts, data.rules) : []), [data, range.start, range.end]);
  const rows = sheet?.rows ?? schedule;
  const results = useMemo(() => (data ? computePay(rows, [...data.people, ...(sheet?.extra ?? [])], data.posts, data.rules, data.rates) : []), [data, rows, sheet]);
  const ready = results.filter((r) => !r.problems.length && r.lines.length);
  const blocked = results.filter((r) => r.problems.length);
  const sum = (kind: 'earning' | 'deduction', r: (typeof results)[number]) => r.lines.filter((l) => l.kind === kind).reduce((t, l) => t + l.amount, 0);
  const totals = ready.reduce((t, r) => ({ earn: t.earn + sum('earning', r), ded: t.ded + sum('deduction', r) }), { earn: 0, ded: 0 });

  const upload = async (file?: File) => {
    setError('');
    setSaved(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return setError('Save the sheet as CSV (File → Save as → CSV) and choose that file.');
    setBusy('Reading the sheet…');
    try {
      const csv = await readCsv(file);
      if (csv.error) throw new Error(csv.error);
      const read = readSheet(csv.rows, range);
      const known = new Set(data?.people.map((p) => p.employee_no.toUpperCase()));
      const missing = [...new Set(read.rows.map((r) => r.employee_no).filter((n) => !known.has(n)))];
      const extra = missing.length ? await loadPeople('employee_no', missing) : [];
      setSheet({ ...read, extra, name: file.name });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const save = async () => {
    if (!confirm(`Save ${ready.length} payslips into ${period.label}? A payslip already in this cutoff for the same employee is replaced.`)) return;
    setError('');
    try {
      const result = await savePayslips(period.id, ready.map(toPayrollRow), setBusy);
      setSaved(result);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  if (inputs.isLoading) return <Loading what="Reading assignments, rules and rates" />;
  if (inputs.error || !data) return <ErrorState error={errorText(inputs.error)} retry={() => inputs.refetch()} />;
  const postCount = new Set(schedule.map((r) => r.post)).size;
  return (
    <div className="stack">
      <p className="muted">Pay is worked out from each guard's duty in this cutoff, at the post's hourly rate and its client's pay rule (formulas and night differential). Deductions such as SSS, PhilHealth, Pag-IBIG, tax and loans still come from the payroll file: download the result as a payroll file to add them.</p>

      <h3 style={{ margin: 0 }}>1. Attendance</h3>
      {sheet ? (
        <p><b>{sheet.rows.length}</b> {sheet.rows.length === 1 ? 'row' : 'rows'} read from <span className="code">{sheet.name}</span>. <button className="link-btn" type="button" onClick={() => setSheet(null)}>Use the schedule instead</button></p>
      ) : (
        <p><b>{schedule.length}</b> assignments at <b>{postCount}</b> posts in this cutoff, each with its rule's duty days. Change the days to the days actually worked: download the sheet, edit it, and upload it here.</p>
      )}
      <div className="row">
        <button className="btn btn-line btn-sm" type="button" disabled={!schedule.length} onClick={() => downloadFile(`attendance ${range.start} to ${range.end}.csv`, toCsv(schedule.map((r) => ({ ...r })), SHEET_COLUMNS))}>Download the attendance sheet</button>
      </div>
      <div className="field" style={{ maxWidth: 440 }}>
        <label htmlFor="attendance-file">Upload the filled sheet (CSV)</label>
        <input id="attendance-file" className="input" type="file" accept=".csv,text/csv" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {sheet && sheet.errors.length > 0 && (
        <div className="callout warn" role="alert"><b>{sheet.errors.length} rows were skipped:</b><ul>{sheet.errors.slice(0, 10).map((x) => <li key={x.row}>Line {x.row}: {x.message}</li>)}</ul></div>
      )}

      <h3 style={{ margin: 0 }}>2. Pay</h3>
      {!results.length ? <p className="callout">No guard was on duty in this cutoff according to the assignment history.</p> : (
        <>
          <div className="tiles">
            <div className="tile"><span className="label">Payslips ready</span><span className="big">{ready.length}</span></div>
            <div className="tile"><span className="label">Earnings</span><span className="big" style={{ fontSize: 24 }}>{fmtMoney(totals.earn)}</span></div>
            <div className="tile"><span className="label">Rule deductions</span><span className="big" style={{ fontSize: 24 }}>{fmtMoney(totals.ded)}</span></div>
          </div>
          {blocked.length > 0 && (
            <div className="callout warn" role="alert"><b>{blocked.length} employees cannot be paid yet:</b>
              <ul>{blocked.slice(0, 10).map((r) => <li key={r.employee_no}>{r.name || r.employee_no}: {r.problems[0]}</li>)}</ul>
              {blocked.length > 10 && <p className="small">and {blocked.length - 10} more.</p>}
            </div>
          )}
          <div className="preview-table" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead><tr><th style={{ minWidth: 150 }}>Employee</th><th style={{ minWidth: 180 }}>Post</th><th className="num">Duties</th><th className="num">Regular hours</th><th className="num">Overtime hours</th><th className="num">Night hours</th>
                {(ready[0]?.lines ?? []).map((l) => <th key={l.code} className="num">{l.label}</th>)}<th className="num">Earnings</th></tr></thead>
              <tbody>{ready.slice(0, SHOW).map((r) => (
                <tr key={r.employee_no}>
                  <td><b>{r.name}</b><span className="cell-sub tabular">{r.employee_no}</span></td>
                  <td>{r.posts.join(', ')}</td>
                  <td className="num">{roundTo(r.days, 2)}</td>
                  <td className="num">{roundTo(r.regular_hours, 2)}</td>
                  <td className="num">{roundTo(r.overtime_hours, 2)}</td>
                  <td className="num">{roundTo(r.night_hours, 2)}</td>
                  {(ready[0]?.lines ?? []).map((h) => <td key={h.code} className="num">{fmtMoney(r.lines.find((l) => l.code === h.code)?.amount ?? 0)}</td>)}
                  <td className="num"><b>{fmtMoney(sum('earning', r))}</b></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {ready.length > SHOW && <p className="muted small">Showing {SHOW} of {ready.length}. The download and the save include everyone.</p>}
        </>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {saved ? (
        <div className="stack" role="status">
          <p className="callout"><b>{saved.inserted}</b> payslips added and <b>{saved.updated}</b> replaced.{saved.errors.length ? ` ${saved.errors.length} were not saved.` : ''}</p>
          {saved.errors.length > 0 && <ul>{saved.errors.slice(0, 10).map((x, i) => <li key={i}>{x.employee_no}: {x.message}</li>)}</ul>}
          <div className="form-foot"><button className="btn" type="button" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <div className="form-foot">
          {busy && <span className="muted small" role="status">{busy}</span>}
          <button className="btn btn-line" type="button" disabled={!ready.length} onClick={() => downloadFile(`payroll ${range.start} to ${range.end}.csv`, toCsv(ready.map(toPayrollRow)))}>Download as payroll file</button>
          <button className="btn" type="button" disabled={!ready.length || Boolean(busy)} aria-busy={Boolean(busy)} onClick={save}>Save {ready.length} {ready.length === 1 ? 'payslip' : 'payslips'}</button>
        </div>
      )}
    </div>
  );
}
