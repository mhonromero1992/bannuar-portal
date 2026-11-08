import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtDateTime, fmtMoney, fullName } from '../lib/format';
import { PERIOD_STATUS } from '../lib/labels';
import { COLUMNS, parsePayrollFile, templateCsv, type Parsed } from '../lib/payrollCsv';
import { safeSearch } from '../lib/refs';
import { Dialog, Empty, ErrorState, Loading, Search, StatusBadge, useDebounced, useToast } from '../ui/kit';
import { PayslipView } from './EmployeeDetail';

interface ImportResult { inserted: number; updated: number; errors: { row: number; employee_no?: string; message: string }[]; warnings: { row: number; employee_no?: string; message: string }[] }
const CHUNK = 500;

export default function PayrollPeriod() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const s = useDebounced(text);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const period = useQuery({
    queryKey: ['period', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });
  const slips = useQuery({
    queryKey: ['period-slips', id, s],
    queryFn: async () => {
      let req = supabase.from('payslips').select('*, employee:employees!inner(id,employee_no,first_name,middle_name,last_name,suffix)', { count: 'exact' }).eq('payroll_period_id', id).order('created_at').limit(200);
      const term = safeSearch(s);
      if (term) req = req.or(`employee_no.ilike.%${term}%,last_name.ilike.%${term}%,first_name.ilike.%${term}%`, { referencedTable: 'employee' });
      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });
  const totals = useQuery({
    queryKey: ['period-totals', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('payslips').select('gross_pay,net_pay').eq('payroll_period_id', id);
      if (error) throw error;
      return data.reduce((t, r) => ({ n: t.n + 1, gross: t.gross + Number(r.gross_pay), net: t.net + Number(r.net_pay) }), { n: 0, gross: 0, net: 0 });
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['period', id] });
    qc.invalidateQueries({ queryKey: ['period-slips', id] });
    qc.invalidateQueries({ queryKey: ['period-totals', id] });
    qc.invalidateQueries({ queryKey: ['periods'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const publish = async (on: boolean) => {
    const p = period.data!;
    if (on && !confirm(`Publish ${p.label}? ${totals.data?.n ?? 0} employees see their payslip in the app and get a notification.`)) return;
    if (!on && !confirm(`Unpublish ${p.label}? Employees stop seeing these payslips until you publish again.`)) return;
    const { data, error } = on ? await supabase.rpc('publish_payroll_period', { p_period_id: id }) : await supabase.rpc('unpublish_payroll_period', { p_period_id: id });
    if (error) return toast(errorText(error), 'error');
    refresh();
    toast(on ? `Published. ${data ?? 0} employees with the app were notified.` : 'Unpublished.');
  };
  if (period.isLoading) return <Loading />;
  if (period.error || !period.data) return <ErrorState error={errorText(period.error)} />;
  const p = period.data;
  const draft = p.status === 'draft';
  return (
    <>
      <Link className="back" to="/payroll">← Payroll</Link>
      <div className="page-head">
        <div>
          <h1>{p.label}</h1>
          <p className="row" style={{ marginTop: 8 }}><StatusBadge map={PERIOD_STATUS} value={p.status} /> · Pay date {fmtDate(p.pay_date)}{p.published_at && ` · published ${fmtDateTime(p.published_at)}`}</p>
        </div>
        <div className="page-actions">
          {draft && <button className="btn btn-line" type="button" onClick={() => setImporting(true)}>Import the payroll file</button>}
          {draft ? <button className="btn" type="button" disabled={!totals.data?.n} onClick={() => publish(true)}>Publish to employees</button> : <button className="btn btn-line" type="button" onClick={() => publish(false)}>Unpublish</button>}
        </div>
      </div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="label">Payslips</span><span className="big">{totals.data?.n ?? 0}</span></div>
        <div className="tile"><span className="label">Gross pay</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(totals.data?.gross ?? 0)}</span></div>
        <div className="tile night on-night"><span className="label">Net pay</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(totals.data?.net ?? 0)}</span></div>
      </div>
      <div className="panel">
        <div className="toolbar"><Search value={text} onChange={setText} label="Search by name or employee number" /></div>
        {slips.isLoading ? <Loading /> : slips.error ? <ErrorState error={errorText(slips.error)} retry={() => slips.refetch()} /> : !slips.data?.rows.length ? (
          <Empty title={s ? 'No payslip matches' : 'No payslips in this cutoff yet'}>{!s && draft ? 'Import the payroll file to add them.' : null}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Employee</th><th>Post</th><th className="num">Days</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net</th><th /></tr></thead>
              <tbody>{slips.data.rows.map((r) => {
                const e = r.employee as { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null };
                return (
                  <tr key={r.id}>
                    <td><Link className="cell-main" to={`/employees/${e.id}`}>{fullName(e)}</Link><span className="cell-sub tabular">{e.employee_no}</span></td>
                    <td>{r.site_name}</td><td className="num">{Number(r.days_worked)}</td><td className="num">{fmtMoney(r.gross_pay)}</td><td className="num">{fmtMoney(r.total_deductions)}</td><td className="num"><b>{fmtMoney(r.net_pay)}</b></td>
                    <td><button className="link-btn" type="button" onClick={() => setOpen({ ...r, period: { label: p.label } })}>View</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        {slips.data && slips.data.count > slips.data.rows.length && <p className="pager">Showing {slips.data.rows.length} of {slips.data.count}. Search to find one employee.</p>}
      </div>
      <Dialog open={importing} title={`Import the payroll file · ${p.label}`} onClose={() => setImporting(false)} wide>
        {importing && <Importer periodId={id} onDone={() => { refresh(); }} onClose={() => setImporting(false)} />}
      </Dialog>
      <Dialog open={Boolean(open)} title={`Payslip · ${p.label}`} onClose={() => setOpen(null)}>
        {open && <PayslipView p={open} />}
      </Dialog>
    </>
  );
}

function Importer({ periodId, onDone, onClose }: { periodId: string; onDone: () => void; onClose: () => void }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File) => {
    setResult(null);
    setError('');
    if (!file) return setParsed(null);
    if (!/\.csv$/i.test(file.name)) return setError('Save the payroll sheet as CSV (File → Save as → CSV) and choose that file.');
    setParsed(await parsePayrollFile(file));
  };
  const run = async () => {
    if (!parsed) return;
    setBusy(true);
    setError('');
    const total: ImportResult = { inserted: 0, updated: 0, errors: [], warnings: [] };
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setProgress(`Importing rows ${i + 1} to ${Math.min(parsed.rows.length, i + CHUNK)} of ${parsed.rows.length}…`);
        const { data, error: err } = await supabase.rpc('import_payslips', { p_period_id: periodId, p_rows: parsed.rows.slice(i, i + CHUNK) });
        if (err) throw err;
        const r = data as ImportResult;
        total.inserted += r.inserted;
        total.updated += r.updated;
        total.errors.push(...r.errors.map((x) => ({ ...x, row: x.row + i })));
        total.warnings.push(...r.warnings.map((x) => ({ ...x, row: x.row + i })));
      }
      setResult(total);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([templateCsv()], { type: 'text/csv' }));
    a.download = 'bannuar-payroll-template.csv';
    a.click();
  };
  const mapped = parsed ? Object.entries(parsed.mapping).filter(([, k]) => k) : [];
  return (
    <div className="stack">
      <p className="muted">One row per employee, matched by employee number. Importing again replaces this cutoff's payslips for the same employees. Columns named <span className="code">earning: …</span> or <span className="code">deduction: …</span> become their own payslip lines. <button className="link-btn" type="button" onClick={download}>Download the template</button></p>
      <div className="field">
        <label htmlFor="payroll-file">Payroll file (CSV)</label>
        <input id="payroll-file" className="input" type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {parsed?.error && <p className="form-error" role="alert">{parsed.error}</p>}
      {parsed && !parsed.error && !result && (
        <>
          <p><b>{parsed.rows.length}</b> rows found. Columns read: {mapped.map(([h, k]) => <span key={h} className="code" style={{ marginRight: 4 }}>{COLUMNS.find((c) => c.key === k)?.label ?? h}</span>)}</p>
          {parsed.unknown.length > 0 && <p className="callout warn">Skipped columns (not recognised): {parsed.unknown.join(', ')}. Rename them to a template column, or to <b>earning: name</b> / <b>deduction: name</b>.</p>}
          <div className="preview-table">
            <table className="table">
              <thead><tr>{mapped.slice(0, 8).map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{parsed.rows.slice(0, 5).map((r, i) => <tr key={i}>{mapped.slice(0, 8).map(([h, k]) => <td key={h}>{r[k!] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <div className="form-foot">
            {progress && <span className="muted small" role="status">{progress}</span>}
            <button className="btn" type="button" aria-busy={busy} disabled={!parsed.rows.length} onClick={run}>Import {parsed.rows.length} payslips</button>
          </div>
        </>
      )}
      {result && (
        <div className="stack" role="status">
          <p className="callout"><b>{result.inserted}</b> payslips added and <b>{result.updated}</b> replaced. {result.errors.length ? `${result.errors.length} rows were not imported.` : 'Every row was imported.'}</p>
          {result.errors.length > 0 && (
            <div className="preview-table"><table className="table"><thead><tr><th>Row</th><th>Employee number</th><th>Problem</th></tr></thead>
              <tbody>{result.errors.map((x, i) => <tr key={i}><td className="tabular">{x.row + 1}</td><td>{x.employee_no}</td><td>{x.message}</td></tr>)}</tbody></table></div>
          )}
          {result.warnings.length > 0 && (
            <details><summary>{result.warnings.length} warnings to check</summary>
              <ul>{result.warnings.map((x, i) => <li key={i}>Row {x.row + 1} ({x.employee_no}): {x.message}</li>)}</ul>
            </details>
          )}
          <div className="form-foot"><button className="btn" type="button" onClick={onClose}>Done</button></div>
        </div>
      )}
    </div>
  );
}
