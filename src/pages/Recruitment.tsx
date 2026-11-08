import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, openFile } from '../lib/supabase';
import { errorText, fmtDate, fmtDateTime, slugify, todayManila } from '../lib/format';
import { APP_STATUS, EDUCATION, JOB_STATUS, options } from '../lib/labels';
import { useAreas, useSites } from '../lib/refs';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, SelectField, StatusBadge, Tabs, TextArea, TextField, useToast } from '../ui/kit';

type Tab = 'applications' | 'openings';

export default function Recruitment() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'applications';
  return (
    <>
      <PageHead title="Recruitment" intro="Applications sent from the website, and the open posts it lists." />
      <Tabs label="Recruitment" tabs={[{ id: 'applications', label: 'Applications' }, { id: 'openings', label: 'Open posts on the website' }]} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'applications' ? <Applications /> : <Openings />}
    </>
  );
}

function Applications() {
  const [filter, setFilter] = useState('active');
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const q = useQuery({
    queryKey: ['applications', filter],
    queryFn: async () => {
      let req = supabase.from('job_applications').select('*, opening:job_openings(title,location)').order('created_at', { ascending: false }).limit(300);
      if (filter === 'active') req = req.in('status', ['new', 'screening', 'interview', 'requirements']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">In progress</option>
          {options(APP_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every application</option>
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No applications here">Applications sent from the website's careers page appear here.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Applicant</th><th>For</th><th>From</th><th>License</th><th>Sent</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setOpen(a)}>
                <td><button className="link-btn cell-main" type="button" onClick={() => setOpen(a)}>{a.last_name}, {a.first_name}</button><span className="cell-sub tabular">{a.mobile_no}</span></td>
                <td>{(a.opening as { title: string } | null)?.title ?? <span className="muted">Any post</span>}</td>
                <td>{[a.city, a.province].filter(Boolean).join(', ')}</td>
                <td>{a.has_license ? <Badge tone="ok">Licensed</Badge> : <span className="muted">Not yet</span>}</td>
                <td className="tabular">{fmtDateTime(a.created_at)}</td>
                <td><StatusBadge map={APP_STATUS} value={a.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(open)} title="Application" onClose={() => setOpen(null)} wide>
        {open && <ApplicationDetail a={open} onClose={() => setOpen(null)} />}
      </Dialog>
    </div>
  );
}

function ApplicationDetail({ a, onClose }: { a: Record<string, unknown>; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const sites = useSites();
  const [status, setStatus] = useState(a.status as string);
  const [notes, setNotes] = useState((a.staff_notes as string) ?? '');
  const [hiring, setHiring] = useState(false);
  const [hire, setHire] = useState({ no: '', date: todayManila(), position: 'Security Guard', site: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('job_applications').update({ status, staff_notes: notes.trim() || null }).eq('id', a.id as string);
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['applications'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('Saved.');
    onClose();
  };
  const doHire = async (e: FormEvent) => {
    e.preventDefault();
    if (!hire.no.trim()) return toast('Enter the new employee number.', 'error');
    setBusy(true);
    const { data, error } = await supabase.rpc('hire_applicant', { p_application_id: a.id, p_employee_no: hire.no.trim(), p_date_hired: hire.date, p_position: hire.position, p_site_id: hire.site || null });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['applications'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    toast('Hired. Complete the 201 file next.');
    navigate(`/employees/${data}`);
  };
  const rows: [string, unknown][] = [
    ['Name', [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(' ')], ['Birthday', fmtDate(a.birthdate as string)], ['Sex', a.sex],
    ['Mobile', a.mobile_no], ['Email', a.email], ['From', [a.city, a.province].filter(Boolean).join(', ')], ['Schooling', EDUCATION[a.education as string]],
    ['License', a.has_license ? [a.license_no, a.license_expires_on && `valid until ${fmtDate(a.license_expires_on as string)}`].filter(Boolean).join(' · ') || 'Yes' : 'Not yet'],
    ['Experience', a.years_experience !== null && a.years_experience !== undefined ? `${a.years_experience} years` : null], ['Last agency', a.previous_agency],
    ['Preferred post', a.preferred_location], ['Message', a.message], ['Sent', fmtDateTime(a.created_at as string)],
  ];
  return (
    <div className="stack">
      <dl className="dl">{rows.filter(([, v]) => v).map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl>
      {Boolean(a.resume_path) && <div><button className="btn btn-line btn-sm" type="button" onClick={() => openFile('applications', a.resume_path as string).catch((e) => toast(errorText(e), 'error'))}>Open the attached file</button></div>}
      {a.status === 'hired' ? <p className="callout">Hired. <button className="link-btn" type="button" onClick={() => navigate(`/employees/${a.employee_id}`)}>Open the 201 file</button></p> : hiring ? (
        <form className="form panel-pad" style={{ background: 'var(--panel-2)', borderRadius: 10 }} onSubmit={doHire}>
          <h3>Hire {a.first_name as string}</h3>
          <div className="form-row">
            <TextField label="New employee number" value={hire.no} onChange={(e) => setHire({ ...hire, no: e.target.value })} />
            <TextField label="Date hired" type="date" value={hire.date} onChange={(e) => setHire({ ...hire, date: e.target.value })} />
          </div>
          <div className="form-row">
            <TextField label="Position" value={hire.position} onChange={(e) => setHire({ ...hire, position: e.target.value })} />
            <SelectField label="Post" optional value={hire.site} onChange={(e) => setHire({ ...hire, site: e.target.value })} placeholder="None yet (floating)" options={(sites.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: s.name }))} />
          </div>
          <div className="form-foot"><button className="btn btn-line" type="button" onClick={() => setHiring(false)}>Cancel</button><button className="btn" type="submit" aria-busy={busy}>Create the employee record</button></div>
        </form>
      ) : (
        <>
          <div className="form-row">
            <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={options(APP_STATUS).filter((o) => o.value !== 'hired')} />
          </div>
          <TextArea label="HR notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} hint="Only staff see these." />
          <div className="form-foot">
            <button className="btn btn-ok" type="button" onClick={() => setHiring(true)}>Hire</button>
            <button className="btn" type="button" aria-busy={busy} onClick={save}>Save</button>
          </div>
        </>
      )}
    </div>
  );
}

interface Opening { id: string; title: string; slug: string; location: string; area_id: string | null; employment_type: string; summary: string | null; description: string | null; qualifications: string[]; requirements: string[]; slots: number | null; status: string; closes_on: string | null }

function Openings() {
  const [editing, setEditing] = useState<Opening | 'new' | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['openings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('job_openings').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data as Opening[];
    },
  });
  return (
    <div className="panel">
      <div className="panel-head"><span className="muted small">Open posts appear on the website's careers page at once; drafts and closed posts do not.</span><button className="btn btn-sm" type="button" onClick={() => setEditing('new')}>Add an open post</button></div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No open posts yet" /> : (
        <table className="table">
          <thead><tr><th>Post</th><th>Where</th><th className="num">Slots</th><th>Until</th><th>Status</th><th /></tr></thead>
          <tbody>{q.data.map((o) => (
            <tr key={o.id}>
              <td><b>{o.title}</b>{o.summary && <span className="cell-sub">{o.summary}</span>}</td><td>{o.location}</td><td className="num">{o.slots ?? ''}</td>
              <td className="tabular">{fmtDate(o.closes_on)}</td><td><StatusBadge map={JOB_STATUS} value={o.status} /></td>
              <td><button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(o)}>Edit</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Dialog open={Boolean(editing)} title={editing === 'new' ? 'Add an open post' : 'Edit the open post'} onClose={() => setEditing(null)} wide>
        {editing && <OpeningForm o={editing === 'new' ? null : editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['openings'] }); }} />}
      </Dialog>
    </div>
  );
}

function OpeningForm({ o, onDone }: { o: Opening | null; onDone: () => void }) {
  const toast = useToast();
  const areas = useAreas();
  const [v, setV] = useState({
    title: o?.title ?? 'Security Guard', location: o?.location ?? '', area_id: o?.area_id ?? '', employment_type: o?.employment_type ?? 'full_time',
    summary: o?.summary ?? '', description: o?.description ?? '', qualifications: (o?.qualifications ?? []).join('\n'), requirements: (o?.requirements ?? []).join('\n'),
    slots: o?.slots?.toString() ?? '', status: o?.status ?? 'draft', closes_on: o?.closes_on ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.title.trim() || !v.location.trim()) return setError('Enter the title and where the post is.');
    const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
    const row = {
      title: v.title.trim(), location: v.location.trim(), area_id: v.area_id || null, employment_type: v.employment_type, summary: v.summary.trim() || null,
      description: v.description.trim() || null, qualifications: lines(v.qualifications), requirements: lines(v.requirements),
      slots: v.slots ? Number(v.slots) : null, status: v.status, closes_on: v.closes_on || null,
      ...(v.status === 'open' && o?.status !== 'open' ? { posted_at: new Date().toISOString() } : {}),
    };
    setBusy(true);
    const res = o ? await supabase.from('job_openings').update(row).eq('id', o.id) : await supabase.from('job_openings').insert({ ...row, slug: `${slugify(`${v.title} ${v.location}`)}-${Date.now().toString(36).slice(-4)}` });
    setBusy(false);
    if (res.error) return setError(errorText(res.error));
    toast(v.status === 'open' ? 'Saved. It is on the website now.' : 'Saved.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row">
        <TextField label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        <TextField label="Where" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} placeholder="San Fernando, La Union" />
        <SelectField label="Area" optional value={v.area_id} onChange={(e) => setV({ ...v, area_id: e.target.value })} placeholder="None" options={(areas.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      <div className="form-row">
        <SelectField label="Kind" value={v.employment_type} onChange={(e) => setV({ ...v, employment_type: e.target.value })} options={[{ value: 'full_time', label: 'Full time' }, { value: 'reliever', label: 'Reliever' }, { value: 'seasonal', label: 'Seasonal' }]} />
        <TextField label="Slots" optional type="number" min="1" value={v.slots} onChange={(e) => setV({ ...v, slots: e.target.value })} />
        <TextField label="Open until" optional type="date" value={v.closes_on} onChange={(e) => setV({ ...v, closes_on: e.target.value })} />
        <SelectField label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={options(JOB_STATUS)} />
      </div>
      <TextField label="One-line summary" optional value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} />
      <TextArea label="Qualifications" optional value={v.qualifications} onChange={(e) => setV({ ...v, qualifications: e.target.value })} rows={4} hint="One per line." />
      <TextArea label="Documents to bring" optional value={v.requirements} onChange={(e) => setV({ ...v, requirements: e.target.value })} rows={4} hint="One per line." />
      <TextArea label="Description" optional value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={4} />
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Save</button></div>
    </form>
  );
}
