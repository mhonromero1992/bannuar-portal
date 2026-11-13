import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtNum } from '../lib/format';
import { checkFileStorage, STORAGE_FOLDER, type StorageCheck } from '../lib/files';
import { useAreas, useDocTypes, useLeaveTypes } from '../lib/refs';
import { Badge, Empty, ErrorState, Loading, PageHead, Tabs, TextField, useToast } from '../ui/kit';
import { PaySettings } from './Pay';

type Tab = 'areas' | 'documents' | 'leave' | 'pay' | 'storage';

export default function Settings() {
  const { can } = useAuth();
  const tabs = [
    { id: 'areas' as Tab, label: 'Areas', show: can.ops },
    { id: 'documents' as Tab, label: 'Document types', show: can.hr },
    { id: 'leave' as Tab, label: 'Leave types', show: can.hr },
    { id: 'pay' as Tab, label: 'Pay rules and rates', show: can.payroll || can.hr },
    { id: 'storage' as Tab, label: 'File storage', show: can.admin },
  ].filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? 'areas');
  return (
    <>
      <PageHead title="Settings" intro="The lists the rest of the portal and the app use." />
      <Tabs label="Settings" tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'areas' && <Areas />}
      {tab === 'documents' && <DocTypes />}
      {tab === 'leave' && <LeaveTypes />}
      {tab === 'pay' && <PaySettings />}
      {tab === 'storage' && <FileStorage />}
    </>
  );
}

const S3_FOLDERS: [string, string, string][] = [
  ['201-file', '201 file', 'Personal records: birth certificate, IDs, diploma, contract, BIR 2316'],
  ['work-requirements', 'Work requirements', 'Clearances, drug test, neuro-psychiatric and medical results, training'],
  ['lesp', 'LESP', 'The License to Exercise Security Profession'],
  ['attendance', 'Attendance', 'Time in and time out selfies, by year and month'],
  ['leave', 'Leave', 'Supporting documents attached to leave requests'],
  ['certificates', 'Certificates', 'Certificates of employment as issued (PDF)'],
];

/** Super admins: where files go in Amazon S3, how many are there, and a live check of the set-up. */
function FileStorage() {
  const toast = useToast();
  const [result, setResult] = useState<StorageCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const counts = useQuery({
    queryKey: ['stored-file-counts'],
    queryFn: async () => {
      const out: Record<string, number> = {};
      for (const [folder] of S3_FOLDERS) {
        const { count, error } = await supabase.from('stored_files').select('id', { count: 'exact', head: true }).eq('folder', folder).eq('status', 'stored');
        if (error) throw error;
        out[folder] = count ?? 0;
      }
      return out;
    },
  });
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkFileStorage());
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head"><h2>Where files go</h2></div>
        <div className="panel-pad stack">
          <p className="muted">Employee files are kept in a private Amazon S3 bucket, one folder per employee, named after the employee number: <span className="code">employees/&lt;employee number&gt;/</span>. Each document type files into one of the first three folders (Document types tab). Payslips are not stored: their PDF is made each time someone downloads it.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Folder</th><th>What goes in it</th><th className="num">Files</th></tr></thead>
              <tbody>{S3_FOLDERS.map(([folder, name, what]) => (
                <tr key={folder}>
                  <td><b>{name}</b><span className="cell-sub"><span className="code">{folder}/</span></span></td>
                  <td>{what}</td>
                  <td className="num">{counts.data ? fmtNum(counts.data[folder]) : '·'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="muted small">Files stored before the switch to S3 stay in Supabase Storage and still open. The website’s job applications and announcement pictures stay there too.</p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Check the connection</h2><button className="btn btn-sm" type="button" aria-busy={busy} disabled={busy} onClick={run}>Check S3 now</button></div>
        <div className="panel-pad">
          {!result ? (
            <p className="muted">Stores a small test file, reads it back, makes sure the bucket refuses a public read, then deletes it.</p>
          ) : result.ok ? (
            <p className="callout" role="status"><Badge tone="ok">Connected</Badge> Bucket <b className="code">{result.bucket}</b> in <b className="code">{result.region}</b>: the test file was stored, read back and deleted, and the bucket refused a public read.</p>
          ) : (
            <div className="callout warn" role="alert"><b>Not working yet{result.step ? ` (step: ${result.step})` : ''}.</b> {result.message}{result.aws_code ? <> AWS said <span className="code">{result.aws_code}</span>.</> : null}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Areas() {
  const q = useAreas();
  const qc = useQueryClient();
  const toast = useToast();
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!f.name.trim()) return toast('Enter the area name.', 'error');
    const { error } = await supabase.from('areas').insert({ name: f.name.trim(), region: f.region.trim() || null, office_address: f.office_address.trim() || null });
    if (error) return toast(error.code === '23505' ? 'An area with this name exists.' : errorText(error), 'error');
    form.reset();
    qc.invalidateQueries({ queryKey: ['areas'] });
    toast('Area added.');
  };
  const toggle = async (id: string, active: boolean) => {
    const { error } = await supabase.from('areas').update({ is_active: !active }).eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['areas'] });
  };
  return (
    <div className="grid grid-2">
      <div className="panel">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} /> : !q.data?.length ? <Empty title="No areas yet" /> : (
          <table className="table">
            <thead><tr><th>Area</th><th>Region</th><th>Status</th><th /></tr></thead>
            <tbody>{q.data.map((a) => (
              <tr key={a.id}><td><b>{a.name}</b><span className="cell-sub">{a.office_address}</span></td><td>{a.region}</td><td>{a.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td><td><button className="link-btn" type="button" onClick={() => toggle(a.id, a.is_active)}>{a.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <form className="panel panel-pad form" onSubmit={add}>
        <h2>Add an area</h2>
        <TextField label="Name" name="name" placeholder="La Union" />
        <TextField label="Region" name="region" optional placeholder="Region I (Ilocos Region)" />
        <TextField label="Office address" name="office_address" optional />
        <div className="form-foot"><button className="btn" type="submit">Add the area</button></div>
      </form>
    </div>
  );
}

function DocTypes() {
  const q = useDocTypes();
  const qc = useQueryClient();
  const toast = useToast();
  const update = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('document_types').update(patch).eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['document-types'] });
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={errorText(q.error)} />;
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Document</th><th>Folder in S3</th><th>Expires</th><th>Needed for deployment</th><th>Remind days before</th><th>Employee may upload</th><th>Shown to employee</th><th>Claude reads it</th><th>In use</th></tr></thead>
          <tbody>{(q.data ?? []).map((d) => (
            <tr key={d.id}>
              <td><b>{d.name}</b><span className="cell-sub">{d.category}</span></td>
              <td>
                <select className="select" style={{ minWidth: 170 }} aria-label={`${d.name} folder in S3`} value={d.storage_folder} onChange={(e) => update(d.id, { storage_folder: e.target.value })}>
                  {Object.entries(STORAGE_FOLDER).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
                </select>
              </td>
              <td><input type="checkbox" aria-label={`${d.name} expires`} checked={d.has_expiry} onChange={(e) => update(d.id, { has_expiry: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`${d.name} needed for deployment`} checked={d.required_for_deployment} onChange={(e) => update(d.id, { required_for_deployment: e.target.checked })} /></td>
              <td><input className="input" style={{ width: 90 }} type="number" min="0" max="365" aria-label={`${d.name} reminder days`} defaultValue={d.remind_days_before} onBlur={(e) => Number(e.target.value) !== d.remind_days_before && update(d.id, { remind_days_before: Number(e.target.value) })} /></td>
              <td><input type="checkbox" aria-label={`${d.name} employee may upload`} checked={d.employee_can_upload} onChange={(e) => update(d.id, { employee_can_upload: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`${d.name} shown to employee`} checked={d.visible_to_employee} onChange={(e) => update(d.id, { visible_to_employee: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`${d.name} read by Claude at upload`} checked={d.ai_check} onChange={(e) => update(d.id, { ai_check: e.target.checked })} /></td>
              <td><input type="checkbox" aria-label={`${d.name} in use`} checked={d.is_active} onChange={(e) => update(d.id, { is_active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveTypes() {
  const q = useLeaveTypes();
  const qc = useQueryClient();
  const toast = useToast();
  const update = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from('leave_types').update(patch).eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['leave-types'] });
    toast('Saved.');
  };
  const num = (v: string) => (v === '' ? null : Number(v));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={errorText(q.error)} />;
  return (
    <div className="panel">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Leave</th><th>Days a year</th><th>Most days a request</th><th>Months of service</th><th>Paid</th><th>In use</th></tr></thead>
          <tbody>{(q.data ?? []).map((l) => (
            <tr key={l.id}>
              <td><b>{l.name}</b><span className="cell-sub" style={{ maxWidth: 420 }}>{l.description}</span></td>
              <td><input className="input" style={{ width: 90 }} type="number" min="0" step="0.5" aria-label={`${l.name} days a year`} defaultValue={l.days_per_year ?? ''} onBlur={(e) => num(e.target.value) !== l.days_per_year && update(l.id, { days_per_year: num(e.target.value) })} /></td>
              <td><input className="input" style={{ width: 90 }} type="number" min="0" step="0.5" aria-label={`${l.name} most days a request`} defaultValue={l.max_days_per_request ?? ''} onBlur={(e) => num(e.target.value) !== l.max_days_per_request && update(l.id, { max_days_per_request: num(e.target.value) })} /></td>
              <td><input className="input" style={{ width: 90 }} type="number" min="0" aria-label={`${l.name} months of service`} defaultValue={l.min_service_months} onBlur={(e) => Number(e.target.value) !== l.min_service_months && update(l.id, { min_service_months: Number(e.target.value) })} /></td>
              <td>{l.is_paid ? 'Yes' : 'No'}</td>
              <td><input type="checkbox" aria-label={`${l.name} in use`} checked={l.is_active} onChange={(e) => update(l.id, { is_active: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="muted small" style={{ padding: '12px 16px' }}>Days a year counts against each employee's credits (service incentive leave: 5 after 12 months). Leave without a yearly count, such as maternity leave, is limited per request.</p>
    </div>
  );
}
