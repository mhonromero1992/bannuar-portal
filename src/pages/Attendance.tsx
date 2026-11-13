import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtLongDate, fullName, todayManila } from '../lib/format';
import { ATTENDANCE_SELECT, manilaDay, NEEDS_A_LOOK, type AttendanceLog } from '../lib/attendance';
import { useSites } from '../lib/refs';
import { Dialog, Empty, ErrorState, Loading, PageHead, Pager, SelectField, TextArea, TextField, useToast } from '../ui/kit';
import { AttendanceTable, selfieLinks } from './attendanceShared';

const PAGE = 50;

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || todayManila();
  const site = params.get('site') ?? '';
  const show = params.get('show') === 'look' ? 'look' : params.get('show') === 'other' ? 'other' : 'all';
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const { can } = useAuth();
  const sites = useSites();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setPage(0);
  };
  const q = useQuery({
    queryKey: ['attendance', day, site, show, page],
    queryFn: async () => {
      const { from, to } = manilaDay(day);
      let req = supabase.from('attendance_logs').select(ATTENDANCE_SELECT, { count: 'exact' })
        .gte('logged_at', from).lt('logged_at', to)
        .order('logged_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (site) req = req.eq('site_id', site);
      if (show === 'look') req = req.or(NEEDS_A_LOOK);
      if (show === 'other') req = req.neq('source', 'self');
      const { data, error, count } = await req;
      if (error) throw error;
      const rows = data as unknown as AttendanceLog[];
      return { rows, count: count ?? 0, photos: await selfieLinks(rows) };
    },
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHead
        title="Attendance"
        intro="Time in and time out from the app. Each log has a photo taken then, the database's time, and the phone's location checked against the guard's post. GPS can be off indoors and can be faked, so look at the photo when a log is marked. A guard without a phone is logged by the post's commander, or by HR here."
        actions={can.hr ? <button className="btn" type="button" onClick={() => setAdding(true)}>Add a manual log</button> : undefined}
      />
      <div className="panel">
        <div className="toolbar">
          <label className="visually-hidden" htmlFor="att-day">Day</label>
          <input id="att-day" className="input" style={{ width: 'auto' }} type="date" value={day} max={todayManila()} onChange={(e) => set('day', e.target.value)} />
          <select className="select" style={{ width: 'auto' }} aria-label="Post" value={site} onChange={(e) => set('site', e.target.value)}>
            <option value="">Every post</option>
            {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} aria-label="Which logs" value={show} onChange={(e) => set('show', e.target.value === 'all' ? '' : e.target.value)}>
            <option value="all">Every log</option>
            <option value="look">Needs a look</option>
            <option value="other">By the commander or by hand</option>
          </select>
        </div>
        {q.isLoading ? <Loading what="Loading the logs" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.rows.length ? (
          <Empty title={show === 'look' ? 'Nothing to look at for this day' : 'No time in or out on this day'}>{fmtLongDate(day)}</Empty>
        ) : (
          <AttendanceTable rows={q.data.rows} photos={q.data.photos} />
        )}
        <Pager page={page} pageSize={PAGE} total={q.data?.count ?? null} onPage={setPage} />
      </div>
      <Dialog open={adding} title="Add a manual log" onClose={() => setAdding(false)}>
        {adding && <ManualLog onDone={() => setAdding(false)} />}
      </Dialog>
    </>
  );
}

type Found = { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null };

/**
 * HR enters a time in or out for a guard who had no phone (from the post's logbook). No photo and no
 * location; the reason is kept with the log and in the audit log, and the guard is told.
 */
function ManualLog({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [term, setTerm] = useState('');
  const [who, setWho] = useState('');
  const [v, setV] = useState({ kind: 'time_in', day: todayManila(), time: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const found = useQuery({
    queryKey: ['manual-log-search', term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const s = term.trim().replace(/[%,()]/g, '');
      const { data, error } = await supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix')
        .or(`employee_no.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`).order('last_name').limit(20);
      if (error) throw error;
      return data as Found[];
    },
  });
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError('');
    if (!who) return setError('Choose the employee.');
    if (!v.time) return setError('Enter the time from the logbook.');
    if (v.reason.trim().length < 5) return setError('Say why the log is entered by hand.');
    setBusy(true);
    const at = new Date(`${v.day}T${v.time}:00+08:00`).toISOString();
    const { error: err } = await supabase.rpc('add_manual_attendance', { p_employee_id: who, p_kind: v.kind, p_logged_at: at, p_reason: v.reason.trim() });
    setBusy(false);
    if (err) return setError(errorText(err));
    qc.invalidateQueries({ queryKey: ['attendance'] });
    toast('Manual log added. The employee is told.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <TextField label="Find the employee" hint="Name or employee number" value={term} onChange={(e) => { setTerm(e.target.value); setWho(''); }} />
      {term.trim().length >= 2 && (
        <SelectField label="Employee" value={who} onChange={(e) => setWho(e.target.value)} placeholder={found.data?.length ? 'Choose one' : 'No match yet'}
          options={(found.data ?? []).map((e) => ({ value: e.id, label: `${fullName(e)} · ${e.employee_no}` }))} />
      )}
      <SelectField label="Log" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={[{ value: 'time_in', label: 'Time in' }, { value: 'time_out', label: 'Time out' }]} />
      <div className="form-row">
        <TextField label="Date" type="date" value={v.day} max={todayManila()} onChange={(e) => setV({ ...v, day: e.target.value })} />
        <TextField label="Time (Manila)" type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} />
      </div>
      <TextArea label="Reason" hint="For example: phone lost, time from the post logbook signed by the commander" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      <p className="muted small">The log has no photo and no location and is marked "Entered by hand". The audit log keeps who added it and why.</p>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Add the log</button></div>
    </form>
  );
}
