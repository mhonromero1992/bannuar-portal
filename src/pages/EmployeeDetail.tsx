import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, openFile } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { daysBetween, errorText, fmtDate, fmtDateTime, fmtMoney, fullName, todayManila, dateRange } from '../lib/format';
import { COE_PURPOSE, DOC_STATUS, EMPLOYEE_STATUS, EMPLOYMENT_TYPE, LEAVE_STATUS, label } from '../lib/labels';
import { useDocTypes, useSites } from '../lib/refs';
import type { Certificate } from '../lib/coe';
import { Badge, Dialog, Empty, ErrorState, Loading, SelectField, StatusBadge, Tabs, TextField, useToast } from '../ui/kit';
import { AssignmentHistory, ShiftPicker, defaultShift } from './Pay';
import { EmployeeForm, type EmployeeRow } from './EmployeeForm';
import { IssueCoeForm, downloadCertificate } from './coeShared';
import { AttendanceTable, selfieLinks } from './attendanceShared';
import { ATTENDANCE_SELECT, type AttendanceLog } from '../lib/attendance';

type Tab = 'profile' | 'deployment' | 'attendance' | 'ids' | 'pay' | 'documents' | 'leave' | 'payslips' | 'certificates' | 'account';

export default function EmployeeDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'profile';
  const q = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('*, site:sites!employees_site_id_fkey(id,name,city), area:areas(id,name)').eq('id', id).single();
      if (error) throw error;
      return data as EmployeeRow & { site: { id: string; name: string; city: string | null } | null; area: { id: string; name: string } | null };
    },
  });
  if (q.isLoading) return <Loading what="Loading the 201 file" />;
  if (q.error || !q.data) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  const e = q.data;
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'profile', label: 'Profile', show: true },
    { id: 'deployment', label: 'Deployment', show: true },
    { id: 'attendance', label: 'Attendance', show: true },
    { id: 'documents', label: 'Licenses and documents', show: true },
    { id: 'ids', label: 'Government numbers', show: can.hr || can.payroll },
    { id: 'pay', label: 'Pay rate', show: can.payroll },
    { id: 'payslips', label: 'Payslips', show: can.payroll },
    { id: 'leave', label: 'Leave', show: true },
    { id: 'certificates', label: 'Certificates', show: can.hr },
    { id: 'account', label: 'App account', show: can.hr },
  ];
  return (
    <>
      <Link className="back" to="/employees">← Employees</Link>
      <div className="page-head">
        <div>
          <h1>{fullName(e)}</h1>
          <p className="row" style={{ marginTop: 8 }}>
            <span className="tabular">{e.employee_no}</span> · <span>{e.position}</span> · <StatusBadge map={EMPLOYEE_STATUS} value={e.status} />
            {e.site && <span>· {e.site.name}</span>}
          </p>
        </div>
      </div>
      <Tabs label="201 file" tabs={tabs.filter((t) => t.show)} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'profile' && <Profile e={e} />}
      {tab === 'deployment' && <Deployment e={e} />}
      {tab === 'attendance' && <EmployeeAttendance employeeId={e.id} />}
      {tab === 'documents' && <Documents employeeId={e.id} />}
      {tab === 'ids' && <GovIds employeeId={e.id} />}
      {tab === 'pay' && <PayRate employeeId={e.id} />}
      {tab === 'payslips' && <Payslips employeeId={e.id} />}
      {tab === 'leave' && <Leave employeeId={e.id} />}
      {tab === 'certificates' && <Certificates employeeId={e.id} />}
      {tab === 'account' && <Account e={e} />}
    </>
  );
}

function Profile({ e }: { e: EmployeeRow }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const rows: [string, string | null | undefined][] = [
    ['Employee number', e.employee_no], ['Position', e.position], ['Employment', EMPLOYMENT_TYPE[e.employment_type]],
    ['Field personnel', e.is_field ? 'Yes' : 'No (office)'], ['Birthday', fmtDate(e.birthdate)], ['Sex', e.sex], ['Civil status', e.civil_status],
    ['Mobile', e.mobile_no], ['Email', e.email], ['Present address', e.present_address], ['Provincial address', e.provincial_address],
    ['Hired', fmtDate(e.date_hired)], ['Regularized', fmtDate(e.date_regularized)], ['Separated', fmtDate(e.date_separated)],
    ['Separation reason', e.separation_reason], ['Emergency contact', [e.emergency_contact_name, e.emergency_contact_relation, e.emergency_contact_phone].filter(Boolean).join(' · ')], ['Notes', e.notes],
  ];
  return (
    <div className="panel">
      <div className="panel-head"><h2>Profile</h2>{can.hr && <button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(true)}>Edit the profile</button>}</div>
      <div className="panel-pad">
        <dl className="dl">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
      <Dialog open={editing} title="Edit the profile" onClose={() => setEditing(false)} wide>
        <EmployeeForm employee={e} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </Dialog>
    </div>
  );
}

function Deployment({ e }: { e: EmployeeRow & { site: { id: string; name: string; city: string | null } | null; area: { name: string } | null } }) {
  const { can } = useAuth();
  const sites = useSites();
  const qc = useQueryClient();
  const toast = useToast();
  const [site, setSite] = useState('');
  const [shift, setShift] = useState({ duty: 12, start: '06:00' });
  const [busy, setBusy] = useState(false);
  const chosenPost = (sites.data ?? []).find((x) => x.id === site);
  const floatingDays = e.status === 'floating' && e.floating_since ? daysBetween(e.floating_since, todayManila()) : null;
  const deploy = async (target: string | null) => {
    setBusy(true);
    const { error } = await supabase.rpc('deploy_employees', target ? { p_employee_ids: [e.id], p_site_id: target, p_duty_hours: shift.duty, p_shift_start: shift.start } : { p_employee_ids: [e.id], p_site_id: null });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['employee', e.id] });
    qc.invalidateQueries({ queryKey: ['assignments', e.id] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(target ? 'Deployed to the post.' : 'Set to floating.');
    setSite('');
  };
  return (
    <>
    <div className="grid grid-2">
      <div className="panel panel-pad stack">
        <h2>Where this employee is</h2>
        <dl className="dl">
          <dt>Status</dt><dd><StatusBadge map={EMPLOYEE_STATUS} value={e.status} /></dd>
          <dt>Post</dt><dd>{e.site ? <Link to={`/posts/${e.site.id}`}>{e.site.name}</Link> : 'None'}</dd>
          <dt>Area</dt><dd>{e.area?.name ?? 'None'}</dd>
          {floatingDays !== null && (<><dt>Floating for</dt><dd>{floatingDays} days {floatingDays >= 150 && <Badge tone="bad">Near the six-month limit</Badge>}</dd></>)}
        </dl>
      </div>
      {(can.ops || can.hr) && ['active', 'floating', 'on_leave', 'suspended'].includes(e.status) && (
        <div className="panel panel-pad stack">
          <h2>Move</h2>
          <SelectField label="Deploy to a post" value={site} onChange={(ev) => { setSite(ev.target.value); setShift(defaultShift((sites.data ?? []).find((x) => x.id === ev.target.value))); }} placeholder="Choose a post" options={(sites.data ?? []).filter((s) => s.is_active && s.id !== e.site_id).map((s) => ({ value: s.id, label: s.name }))} />
          {chosenPost && <ShiftPicker firstStart={chosenPost.first_shift_start} value={shift} onChange={setShift} />}
          <div className="row">
            <button className="btn" type="button" disabled={!site} aria-busy={busy} onClick={() => deploy(site)}>Deploy</button>
            {e.status !== 'floating' && <button className="btn btn-line" type="button" aria-busy={busy} onClick={() => deploy(null)}>Set to floating</button>}
          </div>
          <p className="muted small">The employee is told in the app. Floating (reserve) status starts the six-month count.</p>
        </div>
      )}
    </div>
    <AssignmentHistory employeeId={e.id} />
    </>
  );
}

function Documents({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const types = useDocTypes();
  const qc = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['documents', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_documents').select('*, type:document_types(name,has_expiry)').eq('employee_id', employeeId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const review = async (id: string, status: 'verified' | 'rejected') => {
    const note = status === 'rejected' ? prompt('Why is it rejected? The employee sees this.') : null;
    if (status === 'rejected' && note === null) return;
    const { error } = await supabase.from('employee_documents').update({ status, review_note: note }).eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['documents', employeeId] });
    toast(status === 'verified' ? 'Verified.' : 'Rejected.');
  };
  const today = todayManila();
  return (
    <div className="panel">
      <div className="panel-head"><h2>Licenses and documents</h2>{can.hr && <button className="btn btn-sm" type="button" onClick={() => setAdding(true)}>Add a document</button>}</div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? (
        <Empty title="No documents on file">Add the security license, clearances and test results so expiry reminders can start.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Document</th><th>Number</th><th>Issued</th><th>Expires</th><th>Status</th><th>File</th>{can.hr && <th />}</tr></thead>
            <tbody>
              {q.data.map((d) => {
                const expired = d.expires_on && d.expires_on < today;
                return (
                  <tr key={d.id}>
                    <td><b>{(d.type as { name: string }).name}</b>{d.review_note && <span className="cell-sub">{d.review_note}</span>}</td>
                    <td className="tabular">{d.document_no}</td>
                    <td className="tabular">{fmtDate(d.issued_on)}</td>
                    <td className="tabular">{fmtDate(d.expires_on)} {expired && <Badge tone="bad">Expired</Badge>}</td>
                    <td><StatusBadge map={DOC_STATUS} value={d.status} /></td>
                    <td>{d.file_path ? <button className="link-btn" type="button" onClick={() => openFile('employee-files', d.file_path).catch((err) => toast(errorText(err), 'error'))}>Open</button> : <span className="muted">None</span>}</td>
                    {can.hr && (
                      <td>{d.status === 'pending_review' && <span className="row"><button className="btn btn-ok btn-sm" type="button" onClick={() => review(d.id, 'verified')}>Verify</button><button className="btn btn-line btn-sm" type="button" onClick={() => review(d.id, 'rejected')}>Reject</button></span>}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={adding} title="Add a document" onClose={() => setAdding(false)}>
        <AddDocument employeeId={employeeId} types={(types.data ?? []).filter((t) => t.is_active)} onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['documents', employeeId] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); }} />
      </Dialog>
    </div>
  );
}

function AddDocument({ employeeId, types, onDone }: { employeeId: string; types: { id: string; name: string; code: string; has_expiry: boolean }[]; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ type: '', no: '', issued: '', expires: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const type = types.find((t) => t.id === v.type);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    if (!type) return setError('Choose the kind of document.');
    if (type.has_expiry && !v.expires) return setError('This kind of document expires: enter its expiry date.');
    if (file && file.size > 10 * 1024 * 1024) return setError('Attach a file under 10 MB.');
    setBusy(true);
    try {
      let path: string | null = null;
      if (file) {
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '');
        path = `${employeeId}/${type.code.toLowerCase()}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from('employee-files').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
      }
      const { error: err } = await supabase.from('employee_documents').insert({
        employee_id: employeeId, document_type_id: type.id, document_no: v.no.trim() || null, issued_on: v.issued || null, expires_on: v.expires || null, file_path: path, status: 'verified',
      });
      if (err) throw err;
      toast('Document added.');
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SelectField label="Kind of document" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} placeholder="Choose one" options={types.map((t) => ({ value: t.id, label: t.name }))} />
      <TextField label="Number" optional value={v.no} onChange={(e) => setV({ ...v, no: e.target.value })} />
      <div className="form-row">
        <TextField label="Issued" optional type="date" value={v.issued} onChange={(e) => setV({ ...v, issued: e.target.value })} />
        <TextField label="Expires" optional={!type?.has_expiry} type="date" value={v.expires} onChange={(e) => setV({ ...v, expires: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="doc-file">Scan or photo <span className="muted" style={{ fontWeight: 450 }}>(optional · PDF or image, up to 10 MB)</span></label>
        <input id="doc-file" className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Add the document</button></div>
    </form>
  );
}

function GovIds({ employeeId }: { employeeId: string }) {
  const toast = useToast();
  const [shown, setShown] = useState<null | { sss_no: string | null; philhealth_no: string | null; pagibig_no: string | null; tin: string | null }>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const reveal = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('get_government_ids', { p_employee_id: employeeId });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setShown((data as NonNullable<typeof shown>[])[0] ?? { sss_no: null, philhealth_no: null, pagibig_no: null, tin: null });
  };
  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const { error } = await supabase.rpc('save_government_ids', { p_employee_id: employeeId, p_sss: f.get('sss'), p_philhealth: f.get('philhealth'), p_pagibig: f.get('pagibig'), p_tin: f.get('tin') });
    if (error) return toast(errorText(error), 'error');
    toast('Government numbers saved.');
    setEditing(false);
    reveal();
  };
  return (
    <div className="panel panel-pad stack" style={{ maxWidth: 640 }}>
      <h2>Government numbers</h2>
      <p className="muted">SSS, PhilHealth, Pag-IBIG and TIN are sensitive personal information. Each time someone shows them here, the audit log records who and when.</p>
      {!shown ? (
        <div><button className="btn btn-line" type="button" aria-busy={busy} onClick={reveal}>Show the numbers</button></div>
      ) : editing ? (
        <form className="form" onSubmit={save}>
          <div className="form-row">
            <TextField label="SSS" name="sss" optional defaultValue={shown.sss_no ?? ''} />
            <TextField label="PhilHealth" name="philhealth" optional defaultValue={shown.philhealth_no ?? ''} />
          </div>
          <div className="form-row">
            <TextField label="Pag-IBIG" name="pagibig" optional defaultValue={shown.pagibig_no ?? ''} />
            <TextField label="TIN" name="tin" optional defaultValue={shown.tin ?? ''} />
          </div>
          <div className="form-foot"><button className="btn btn-line" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="btn" type="submit">Save</button></div>
        </form>
      ) : (
        <>
          <dl className="dl tabular">
            <dt>SSS</dt><dd>{shown.sss_no || 'Not on file'}</dd>
            <dt>PhilHealth</dt><dd>{shown.philhealth_no || 'Not on file'}</dd>
            <dt>Pag-IBIG</dt><dd>{shown.pagibig_no || 'Not on file'}</dd>
            <dt>TIN</dt><dd>{shown.tin || 'Not on file'}</dd>
          </dl>
          <div className="row"><button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(true)}>Edit the numbers</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => setShown(null)}>Hide</button></div>
        </>
      )}
    </div>
  );
}

function PayRate({ employeeId }: { employeeId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['compensation', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_compensation').select('*').eq('employee_id', employeeId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
    const { error } = await supabase.from('employee_compensation').upsert({
      employee_id: employeeId, pay_basis: f.get('basis'), daily_rate: num('daily'), monthly_rate: num('monthly'), allowance_note: f.get('allowance') || null, effective_on: f.get('effective') || null,
    });
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['compensation', employeeId] });
    toast('Pay rate saved.');
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={errorText(q.error)} />;
  const c = q.data;
  return (
    <form className="panel panel-pad form" style={{ maxWidth: 640 }} onSubmit={save} key={c?.updated_at ?? 'new'}>
      <h2>Pay rate</h2>
      <p className="muted small">Used on certificates of employment that print the compensation. Payslips come from the payroll file.</p>
      <div className="form-row">
        <SelectField label="Basis" name="basis" defaultValue={c?.pay_basis ?? 'daily'} options={[{ value: 'daily', label: 'Daily rate' }, { value: 'monthly', label: 'Monthly rate' }]} />
        <TextField label="Daily rate (₱)" name="daily" optional type="number" step="0.01" min="0" defaultValue={c?.daily_rate ?? ''} />
        <TextField label="Monthly rate (₱)" name="monthly" optional type="number" step="0.01" min="0" defaultValue={c?.monthly_rate ?? ''} />
      </div>
      <div className="form-row">
        <TextField label="Allowances" name="allowance" optional defaultValue={c?.allowance_note ?? ''} />
        <TextField label="Effective" name="effective" optional type="date" defaultValue={c?.effective_on ?? ''} />
      </div>
      <div className="form-foot"><button className="btn" type="submit">Save the pay rate</button></div>
    </form>
  );
}

export function PayslipView({ p }: { p: Record<string, unknown> & { period?: { label: string } } }) {
  const n = (k: string) => Number(p[k] ?? 0);
  const earn: [string, number][] = [['Basic pay', n('basic_pay')], ['Overtime', n('overtime_pay')], ['Night differential', n('night_diff_pay')], ['Holiday pay', n('holiday_pay')], ['Allowances', n('allowances')], ['Other earnings', n('other_earnings')]];
  const ded: [string, number][] = [['SSS', n('sss')], ['PhilHealth', n('philhealth')], ['Pag-IBIG', n('pagibig')], ['Withholding tax', n('withholding_tax')], ['Loans', n('loans')], ['Other deductions', n('other_deductions')]];
  const lines = (arr: [string, number][]) => arr.filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd className="tabular">{fmtMoney(v)}</dd></div>);
  return (
    <div className="stack">
      <p className="muted">{p.site_name as string} · {n('days_worked')} days · {n('hours_worked')} hours · OT {n('overtime_hours')} h · night {n('night_diff_hours')} h</p>
      <div className="grid grid-2">
        <div><h3 className="label">Earnings</h3><dl className="dl">{lines(earn)}<dt><b>Gross</b></dt><dd className="tabular"><b>{fmtMoney(n('gross_pay'))}</b></dd></dl></div>
        <div><h3 className="label">Deductions</h3><dl className="dl">{lines(ded)}<dt><b>Total</b></dt><dd className="tabular"><b>{fmtMoney(n('total_deductions'))}</b></dd></dl></div>
      </div>
      {Array.isArray(p.deductions_detail) && (p.deductions_detail as { label: string; amount: number }[]).length > 0 && (
        <p className="muted small">Other deduction lines: {(p.deductions_detail as { label: string; amount: number }[]).map((d) => `${d.label} ${fmtMoney(d.amount)}`).join(' · ')}</p>
      )}
      <p style={{ fontSize: 20 }}>Net pay <b className="tabular">{fmtMoney(n('net_pay'))}</b></p>
    </div>
  );
}

function Payslips({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const q = useQuery({
    queryKey: ['payslips-of', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('payslips').select('*, period:payroll_periods(label,status,pay_date,period_end)').eq('employee_id', employeeId);
      if (error) throw error;
      return data.sort((a, b) => String((b.period as { period_end: string }).period_end).localeCompare(String((a.period as { period_end: string }).period_end)));
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={errorText(q.error)} />;
  return (
    <div className="panel">
      {!q.data?.length ? <Empty title="No payslips yet">Payslips appear after payroll imports a cutoff.</Empty> : (
        <table className="table">
          <thead><tr><th>Cutoff</th><th>Pay date</th><th>Status</th><th className="num">Gross</th><th className="num">Net</th><th /></tr></thead>
          <tbody>
            {q.data.map((p) => {
              const per = p.period as { label: string; status: string; pay_date: string };
              return (
                <tr key={p.id}>
                  <td>{per.label}</td><td className="tabular">{fmtDate(per.pay_date)}</td>
                  <td><Badge tone={per.status === 'published' ? 'ok' : 'warn'}>{per.status === 'published' ? 'Seen by the employee' : 'Draft'}</Badge></td>
                  <td className="num">{fmtMoney(p.gross_pay)}</td><td className="num"><b>{fmtMoney(p.net_pay)}</b></td>
                  <td><button className="link-btn" type="button" onClick={() => setOpen(p)}>View</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Dialog open={Boolean(open)} title={`Payslip · ${(open?.period as { label: string } | undefined)?.label ?? ''}`} onClose={() => setOpen(null)}>
        {open && <PayslipView p={open} />}
      </Dialog>
    </div>
  );
}

function Leave({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['leave-of', employeeId],
    queryFn: async () => {
      const [bal, req] = await Promise.all([
        supabase.from('leave_balances').select('*').eq('employee_id', employeeId),
        supabase.from('leave_requests').select('*, type:leave_types(name)').eq('employee_id', employeeId).order('start_date', { ascending: false }).limit(50),
      ]);
      if (bal.error) throw bal.error;
      if (req.error) throw req.error;
      return { bal: bal.data, req: req.data };
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={errorText(q.error)} />;
  return (
    <div className="stack">
      <div className="tiles">
        {q.data.bal.map((b) => (
          <div className="tile" key={b.leave_type_id}>
            <span className="label">{b.name} · {b.year}</span>
            <span className="big">{Math.max(0, Number(b.credits ?? 0) - Number(b.used) - Number(b.pending))}</span>
            <span className="muted small">days left of {Number(b.credits ?? 0)} · {Number(b.used)} used · {Number(b.pending)} pending</span>
          </div>
        ))}
      </div>
      <div className="panel">
        {!q.data.req.length ? <Empty title="No leave filed" /> : (
          <table className="table">
            <thead><tr><th>Leave</th><th>Dates</th><th className="num">Days</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>{q.data.req.map((r) => (
              <tr key={r.id}><td>{(r.type as { name: string }).name}</td><td>{dateRange(r.start_date, r.end_date)}</td><td className="num">{Number(r.days)}</td><td><StatusBadge map={LEAVE_STATUS} value={r.status} /></td><td className="muted">{r.reason}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Certificates({ employeeId }: { employeeId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [issuing, setIssuing] = useState(false);
  const q = useQuery({
    queryKey: ['certificates-of', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('certificates').select('*').eq('employee_id', employeeId).order('issued_at', { ascending: false });
      if (error) throw error;
      return data as Certificate[];
    },
  });
  const revoke = async (c: Certificate) => {
    const reason = prompt(`Why withdraw ${c.certificate_no}? Anyone checking the code will see it was withdrawn.`);
    if (!reason) return;
    const { error } = await supabase.rpc('revoke_certificate', { p_certificate_id: c.id, p_reason: reason });
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['certificates-of', employeeId] });
    toast('Certificate withdrawn.');
  };
  return (
    <div className="panel">
      <div className="panel-head"><h2>Certificates of employment</h2><button className="btn btn-sm" type="button" onClick={() => setIssuing(true)}>Issue a certificate</button></div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} /> : !q.data?.length ? <Empty title="No certificates issued" /> : (
        <table className="table">
          <thead><tr><th>Number</th><th>Code</th><th>Purpose</th><th>Issued</th><th>Status</th><th /></tr></thead>
          <tbody>{q.data.map((c) => (
            <tr key={c.id}>
              <td className="tabular">{c.certificate_no}</td><td><span className="code">{c.verification_code}</span></td><td>{c.purpose ? COE_PURPOSE[c.purpose] ?? c.purpose : ''}</td>
              <td className="tabular">{fmtDateTime(c.issued_at)}</td>
              <td>{c.revoked_at ? <Badge tone="bad">Withdrawn</Badge> : <Badge tone="ok">Valid</Badge>}</td>
              <td><span className="row"><button className="link-btn" type="button" onClick={() => downloadCertificate(c).catch((e) => toast(errorText(e), 'error'))}>PDF</button>{!c.revoked_at && <button className="link-btn" type="button" onClick={() => revoke(c)}>Withdraw</button>}</span></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Dialog open={issuing} title="Issue a certificate of employment" onClose={() => setIssuing(false)}>
        <IssueCoeForm employeeId={employeeId} onCancel={() => setIssuing(false)} onDone={() => { setIssuing(false); qc.invalidateQueries({ queryKey: ['certificates-of', employeeId] }); toast('Certificate issued and saved.'); }} />
      </Dialog>
    </div>
  );
}

function Account({ e }: { e: EmployeeRow }) {
  const toast = useToast();
  const [temp, setTemp] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (!e.user_id) return;
    if (!confirm(`Give ${fullName(e)} a temporary password? Their current one stops working.`)) return;
    const pwd = `Bannuar-${Array.from(crypto.getRandomValues(new Uint32Array(2))).map((n) => n.toString(36)).join('').slice(0, 8)}`;
    setBusy(true);
    const { error } = await supabase.rpc('admin_reset_password', { p_user_id: e.user_id, p_temp_password: pwd });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setTemp(pwd);
  };
  return (
    <div className="panel panel-pad stack" style={{ maxWidth: 640 }}>
      <h2>App account</h2>
      {e.user_id ? (
        <>
          <p><Badge tone="ok">Activated</Badge> This employee signs in to the Bannuar app with their employee number.</p>
          {temp ? (
            <p className="callout">Temporary password: <b className="code">{temp}</b>. Give it to the employee in person; the app asks them to choose their own at the next sign-in. It is not shown again.</p>
          ) : (
            <div><button className="btn btn-line" type="button" aria-busy={busy} onClick={reset}>Give a temporary password</button></div>
          )}
        </>
      ) : (
        <>
          <p><Badge>Not activated</Badge> The employee activates the app with their employee number, birthday and the mobile number on file.</p>
          <dl className="dl">
            <dt>Employee number</dt><dd className="tabular">{e.employee_no}</dd>
            <dt>Birthday on file</dt><dd>{fmtDate(e.birthdate) || <Badge tone="warn">Missing: add it to the profile</Badge>}</dd>
            <dt>Mobile on file</dt><dd>{e.mobile_no || <Badge tone="warn">Missing: add it to the profile</Badge>}</dd>
          </dl>
        </>
      )}
      <p className="muted small">Status: {label(EMPLOYEE_STATUS, e.status)}</p>
    </div>
  );
}

/** The last 60 time in and out logs, newest first. */
function EmployeeAttendance({ employeeId }: { employeeId: string }) {
  const q = useQuery({
    queryKey: ['employee-attendance', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_logs').select(ATTENDANCE_SELECT).eq('employee_id', employeeId).order('logged_at', { ascending: false }).limit(60);
      if (error) throw error;
      const rows = data as unknown as AttendanceLog[];
      return { rows, photos: await selfieLinks(rows) };
    },
  });
  return (
    <div className="panel">
      <div className="panel-head"><h2>Time in and out from the app</h2><span className="muted small">The last 60</span></div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.rows.length ? (
        <Empty title="No time in or out yet">They appear here once this employee uses the app at the post.</Empty>
      ) : <AttendanceTable rows={q.data.rows} photos={q.data.photos} showEmployee={false} />}
    </div>
  );
}
