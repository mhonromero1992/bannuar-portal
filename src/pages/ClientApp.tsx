import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate, fmtDateTime, todayManila } from '../lib/format';
import { CLIENT_REPORT_STATUS, CLIENT_REQUEST_KIND, CLIENT_REQUEST_STATUS, CUTOFF_CLIENT_STATUS, options } from '../lib/labels';
import { manilaIso } from '../lib/discipline';
import { Badge, Dialog, Empty, ErrorState, Loading, SelectField, StatusBadge, TextArea, TextField, useToast } from '../ui/kit';

/**
 * The client portal: people at a client company see their posts and the guards on duty, attendance by
 * day, and the incident reports and requests they file. Made for a tablet at the client's desk
 * (Add to Home Screen opens it full screen). Everything comes from the client_* functions
 * (schema.sql section 17); no pay, addresses, government numbers, photos, locations or discipline
 * records reach a client.
 */
type View = 'posts' | 'attendance' | 'cutoffs' | 'reports' | 'requests';
type Guard = { id: string; name: string; position: string; on_duty_since: string | null };
type Post = { id: string; name: string; city: string | null; guards_required: number; guards: Guard[] };
type Overview = { client: { id: string; name: string }; posts: Post[] };

const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

function useOverview() {
  return useQuery({ queryKey: ['client-overview'], queryFn: () => rpc<Overview>('client_overview'), refetchInterval: 120_000 });
}

export default function ClientApp() {
  const { access, signOut } = useAuth();
  const [params, setParams] = useSearchParams();
  const cutoffs = useQuery({ queryKey: ['client-cutoffs'], queryFn: () => rpc<Cutoff[]>('client_cutoffs') });
  const waiting = (cutoffs.data ?? []).filter((c) => c.status === 'waiting').length;
  const views: { id: View; label: string }[] = [
    { id: 'posts', label: 'Posts and guards' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'cutoffs', label: waiting ? `Cutoffs to confirm (${waiting})` : 'Cutoffs' },
    { id: 'reports', label: 'Incident reports' },
    { id: 'requests', label: 'Requests' },
  ];
  const view = (views.find((v) => v.id === params.get('view'))?.id ?? 'posts') as View;
  return (
    <div className="client">
      <header className="client-top">
        <img src="/badge-128.png" alt="" width={44} height={44} />
        <div className="client-who">
          <b>{access?.client?.name ?? 'Client'}</b>
          <span className="muted small">Bannuar Security · {access?.full_name ?? access?.email}</span>
        </div>
        <button className="btn btn-line" type="button" onClick={signOut}>Sign out</button>
      </header>
      <nav className="client-tabs" aria-label="Client portal">
        {views.map((v) => (
          <button key={v.id} type="button" className={`client-tab${v.id === view ? ' on' : ''}`} aria-current={v.id === view ? 'page' : undefined}
            onClick={() => setParams({ view: v.id }, { replace: true })}>
            {v.label}
          </button>
        ))}
      </nav>
      <main className="client-main" id="content">
        {view === 'posts' && <PostsView />}
        {view === 'attendance' && <AttendanceView />}
        {view === 'cutoffs' && <CutoffsView />}
        {view === 'reports' && <ReportsView />}
        {view === 'requests' && <RequestsView />}
      </main>
      <footer className="client-foot muted small">
        In an emergency at a post, call the detachment commander there. Reports and requests here go to Bannuar's office.
      </footer>
    </div>
  );
}

function PostsView() {
  const q = useOverview();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  if (!q.data.posts.length) return <Empty title="No posts yet">Your posts show here once Bannuar's operations team links them to your account.</Empty>;
  return (
    <div className="client-grid">
      {q.data.posts.map((p) => {
        const onDuty = p.guards.filter((g) => g.on_duty_since).length;
        return (
          <section key={p.id} className="panel panel-pad stack" aria-label={p.name}>
            <div className="row between">
              <div><h2 className="section-title">{p.name}</h2>{p.city && <span className="muted small">{p.city}</span>}</div>
              <Badge tone={onDuty > 0 ? 'ok' : 'warn'}>{onDuty} on duty</Badge>
            </div>
            <p className="muted small">{p.guards.length} of {p.guards_required} guards assigned</p>
            <ul className="client-list">
              {p.guards.map((g) => (
                <li key={g.id}>
                  <span><b>{g.name}</b><span className="muted small"> · {g.position}</span></span>
                  {g.on_duty_since ? <Badge tone="ok">On duty since {time(g.on_duty_since)}</Badge> : <Badge>Off duty</Badge>}
                </li>
              ))}
              {!p.guards.length && <li className="muted">No guards assigned yet.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

type Log = { post: string; guard: string; kind: 'time_in' | 'time_out'; logged_at: string; at_post: boolean; by: string };

function AttendanceView() {
  const [day, setDay] = useState(todayManila());
  const q = useQuery({ queryKey: ['client-attendance', day], queryFn: () => rpc<Log[]>('client_attendance', { p_day: day }) });
  const posts = [...new Set((q.data ?? []).map((l) => l.post))];
  return (
    <div className="stack">
      <div className="toolbar">
        <TextField label="Day" type="date" value={day} max={todayManila()} onChange={(e) => setDay(e.target.value || todayManila())} />
        <span className="muted small">Time in and out as the guards logged them in the Bannuar app, by the server's clock.</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !posts.length ? (
        <Empty title="No time in or out that day" />
      ) : posts.map((post) => (
        <section key={post} className="panel" aria-label={post}>
          <div className="panel-head"><b>{post}</b></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Guard</th><th>Log</th><th>Time</th><th>Where</th></tr></thead>
              <tbody>{q.data!.filter((l) => l.post === post).map((l, i) => (
                <tr key={i}>
                  <td><b>{l.guard}</b></td>
                  <td>{l.kind === 'time_in' ? 'Time in' : 'Time out'}{l.by !== 'self' && <span className="cell-sub">{l.by === 'commander' ? 'Logged by the commander' : 'Entered by Bannuar'}</span>}</td>
                  <td className="tabular">{time(l.logged_at)}</td>
                  <td>{l.at_post ? <Badge tone="ok">At the post</Badge> : <Badge tone="warn">Not confirmed</Badge>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

type Report = { id: string; report_no: string; post: string | null; occurred_at: string; title: string; details: string; guard: string | null; status: string; update: string | null; filed_by: string | null; created_at: string; updated_at: string };

function ReportsView() {
  const [filing, setFiling] = useState(false);
  const q = useQuery({ queryKey: ['client-reports'], queryFn: () => rpc<Report[]>('client_reports') });
  return (
    <div className="stack">
      <div className="toolbar">
        <span className="muted small">Report a guard's conduct or anything at your post. Bannuar's HR looks into it under its Code of Discipline and tells you what was done.</span>
        <button className="btn btn-lg" type="button" onClick={() => setFiling(true)}>Report an incident</button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No reports yet" /> : (
        <div className="client-grid">
          {q.data.map((r) => (
            <article key={r.id} className="panel panel-pad stack" aria-label={r.title}>
              <div className="row between"><b>{r.title}</b><StatusBadge map={CLIENT_REPORT_STATUS} value={r.status} /></div>
              <span className="muted small tabular">{r.report_no} · {r.post ?? ''} · {fmtDateTime(r.occurred_at)}</span>
              {r.guard && <span className="small">Guard: {r.guard}</span>}
              <p className="pre small">{r.details}</p>
              {r.update ? <p className="callout small"><b>Bannuar: </b>{r.update}</p> : <p className="muted small">Bannuar has received it.</p>}
            </article>
          ))}
        </div>
      )}
      <Dialog open={filing} title="Report an incident" onClose={() => setFiling(false)}>
        {filing && <ReportForm onDone={() => setFiling(false)} />}
      </Dialog>
    </div>
  );
}

function ReportForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const ov = useOverview();
  const posts = ov.data?.posts ?? [];
  const [v, setV] = useState({ post: '', guard: '', described: '', when: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16), title: '', details: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const post = v.post || (posts.length === 1 ? posts[0].id : '');
  const guards = posts.find((p) => p.id === post)?.guards ?? [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!post) return setError('Choose the post.');
    if (!v.when) return setError('Give when it happened.');
    setBusy(true);
    try {
      const r = await rpc<{ report_no: string }>('file_incident_report', {
        p_site_id: post, p_employee_id: v.guard || null, p_occurred_at: manilaIso(v.when), p_title: v.title, p_details: v.details,
        p_guard_described: v.guard ? null : v.described || null,
      });
      qc.invalidateQueries({ queryKey: ['client-reports'] });
      toast(`Report ${r.report_no} sent to Bannuar.`);
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
      {posts.length > 1 && <SelectField label="Post" value={v.post} onChange={(e) => setV({ ...v, post: e.target.value, guard: '' })} placeholder="Choose the post" options={posts.map((p) => ({ value: p.id, label: p.name }))} />}
      <SelectField label="Guard" optional value={v.guard} onChange={(e) => setV({ ...v, guard: e.target.value })} placeholder="I don't know the name" options={guards.map((g) => ({ value: g.id, label: g.name }))} />
      {!v.guard && <TextField label="Describe the guard" optional hint="Shift, position or how they look" value={v.described} onChange={(e) => setV({ ...v, described: e.target.value })} />}
      <TextField label="When it happened" type="datetime-local" value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })} />
      <TextField label="What it is about" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Guard asleep at the gate" />
      <TextArea label="What happened" rows={6} hint="What you saw, when and where, and who else saw it" value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
      <p className="muted small">The guard is heard before anything is decided. You will see Bannuar's update here.</p>
      <div className="form-foot"><button className="btn btn-lg" type="submit" aria-busy={busy}>Send the report</button></div>
    </form>
  );
}

type Request = { id: string; request_no: string; post: string | null; kind: string; details: string; guards_needed: number | null; needed_from: string | null; status: string; reply: string | null; requested_by: string | null; created_at: string };

function RequestsView() {
  const [asking, setAsking] = useState(false);
  const q = useQuery({ queryKey: ['client-requests'], queryFn: () => rpc<Request[]>('client_requests_list') });
  return (
    <div className="stack">
      <div className="toolbar">
        <span className="muted small">More guards, a replacement, or a change of schedule: Bannuar's operations team answers here.</span>
        <button className="btn btn-lg" type="button" onClick={() => setAsking(true)}>Ask for something</button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No requests yet" /> : (
        <div className="client-grid">
          {q.data.map((r) => (
            <article key={r.id} className="panel panel-pad stack" aria-label={r.request_no}>
              <div className="row between"><b>{CLIENT_REQUEST_KIND[r.kind]}{r.guards_needed ? `: ${r.guards_needed}` : ''}</b><StatusBadge map={CLIENT_REQUEST_STATUS} value={r.status} /></div>
              <span className="muted small tabular">{r.request_no}{r.post ? ` · ${r.post}` : ''}{r.needed_from ? ` · from ${fmtDate(r.needed_from)}` : ''}</span>
              <p className="pre small">{r.details}</p>
              {r.reply && <p className="callout small"><b>Bannuar: </b>{r.reply}</p>}
            </article>
          ))}
        </div>
      )}
      <Dialog open={asking} title="Ask Bannuar" onClose={() => setAsking(false)}>
        {asking && <RequestForm onDone={() => setAsking(false)} />}
      </Dialog>
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const ov = useOverview();
  const posts = ov.data?.posts ?? [];
  const [v, setV] = useState({ post: '', kind: 'additional_guards', guards: '1', from: '', details: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await rpc<{ request_no: string }>('file_client_request', {
        p_site_id: v.post || (posts.length === 1 ? posts[0].id : null), p_kind: v.kind, p_details: v.details,
        p_guards_needed: v.kind === 'additional_guards' ? Number(v.guards) || null : null, p_needed_from: v.from || null,
      });
      qc.invalidateQueries({ queryKey: ['client-requests'] });
      toast(`Request ${r.request_no} sent to Bannuar.`);
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
      <SelectField label="What you need" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} options={options(CLIENT_REQUEST_KIND)} />
      {posts.length > 1 && <SelectField label="Post" optional value={v.post} onChange={(e) => setV({ ...v, post: e.target.value })} placeholder="All posts" options={posts.map((p) => ({ value: p.id, label: p.name }))} />}
      <div className="form-row">
        {v.kind === 'additional_guards' && <TextField label="How many guards" type="number" min={1} max={50} value={v.guards} onChange={(e) => setV({ ...v, guards: e.target.value })} />}
        <TextField label="From" optional type="date" min={todayManila()} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
      </div>
      <TextArea label="Details" rows={5} hint="Hours, days, and anything the guards should know" value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
      <div className="form-foot"><button className="btn btn-lg" type="submit" aria-busy={busy}>Send the request</button></div>
    </form>
  );
}

type Cutoff = { period_id: string; label: string; start: string; end: string; due_at: string; responded_at: string | null; responder: string | null; note: string | null; disputed: number; status: string };
type Duty = { log_id: string; post: string; guard: string; date: string; time_in: string | null; time_out: string | null; hours: number | null; at_post: boolean; complete: boolean; disputed: string | null };

/**
 * Each cutoff, the client confirms the guards' coverage at its posts, or disputes duties it says were
 * not served. Bannuar's payroll decides each dispute after hearing the guard; pay is never held up,
 * and a cutoff not answered in time counts as confirmed.
 */
function CutoffsView() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['client-cutoffs'], queryFn: () => rpc<Cutoff[]>('client_cutoffs') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  const list = q.data ?? [];
  const shown = list.find((c) => c.period_id === open) ?? list.find((c) => c.status === 'waiting') ?? null;
  return (
    <div className="stack">
      <p className="muted small">After each cutoff, check that the guards served the duties shown. Dispute any duty that was not served; confirm the rest. If you do not answer by the time shown, the cutoff counts as confirmed.</p>
      {!list.length ? <Empty title="Nothing to confirm yet">Bannuar asks you here after each cutoff.</Empty> : (
        <div className="row">
          {list.map((c) => (
            <button key={c.period_id} type="button" className={`client-tab${shown?.period_id === c.period_id ? ' on' : ''}`} onClick={() => setOpen(c.period_id)}>
              {c.label} · {CUTOFF_CLIENT_STATUS[c.status]?.[0] ?? c.status}
            </button>
          ))}
        </div>
      )}
      {shown && <CutoffDetail key={shown.period_id} c={shown} />}
    </div>
  );
}

function CutoffDetail({ c }: { c: Cutoff }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['client-coverage', c.period_id], queryFn: () => rpc<Duty[]>('client_cutoff_coverage', { p_period_id: c.period_id }) });
  const open = c.status === 'waiting';
  const duties = q.data ?? [];
  const disputed = duties.filter((d) => d.disputed).length;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['client-coverage', c.period_id] });
    qc.invalidateQueries({ queryKey: ['client-cutoffs'] });
  };
  const dispute = async (d: Duty, take: boolean) => {
    const reason = take ? '' : prompt(`What was wrong with ${d.guard}'s duty on ${fmtDate(d.date)}?`);
    if (reason === null) return;
    try {
      await rpc('client_dispute_duty', { p_period_id: c.period_id, p_log_id: d.log_id, p_reason: reason });
      refresh();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const respond = async () => {
    if (!confirm(disputed ? `Send ${c.label} back with ${disputed} disputed ${disputed === 1 ? 'duty' : 'duties'}?` : `Confirm the guards' duties in ${c.label}?`)) return;
    setBusy(true);
    try {
      const r = await rpc<string>('client_respond_cutoff', { p_period_id: c.period_id, p_note: null });
      toast(r === 'disputed' ? 'Sent. Bannuar looks into each disputed duty.' : 'Confirmed. Thank you.');
      refresh();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const posts = [...new Set(duties.map((d) => d.post))];
  return (
    <section className="panel" aria-label={c.label}>
      <div className="panel-head">
        <div><b>{c.label}</b> <StatusBadge map={CUTOFF_CLIENT_STATUS} value={c.status} />
          <div className="muted small">{open ? `Confirm or dispute by ${fmtDateTime(c.due_at)}.` : c.responded_at ? `Answered by ${c.responder ?? 'your team'} ${fmtDateTime(c.responded_at)}.` : `Not answered by ${fmtDateTime(c.due_at)}, so it counts as confirmed.`}</div>
        </div>
        {open && <button className="btn btn-lg" type="button" aria-busy={busy} disabled={q.isLoading} onClick={respond}>{disputed ? `Send with ${disputed} disputed` : 'Confirm the cutoff'}</button>}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !duties.length ? <Empty title="No duties logged at your posts" /> : posts.map((post) => (
        <div key={post} className="table-wrap">
          <table className="table">
            <caption className="section-title" style={{ textAlign: 'left', padding: '12px 16px' }}>{post}</caption>
            <thead><tr><th>Day</th><th>Guard</th><th>Time</th><th>Check</th><th /></tr></thead>
            <tbody>{duties.filter((d) => d.post === post).map((d) => (
              <tr key={d.log_id}>
                <td className="tabular">{fmtDate(d.date)}</td>
                <td><b>{d.guard}</b></td>
                <td className="tabular">{d.time_in ? time(d.time_in) : '—'} to {d.time_out ? time(d.time_out) : '—'}{d.hours ? <span className="cell-sub">{d.hours} hours</span> : null}</td>
                <td><span className="row">{d.at_post ? <Badge tone="ok">At the post</Badge> : <Badge tone="warn">Not confirmed at the post</Badge>}{!d.complete && <Badge tone="warn">Incomplete</Badge>}</span>
                  {d.disputed && <span className="cell-sub">You disputed: “{d.disputed}”</span>}</td>
                <td>{open && (d.disputed
                  ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => dispute(d, true)}>Take back</button>
                  : <button className="btn btn-line btn-sm" type="button" aria-label={`Dispute ${d.guard} on ${fmtDate(d.date)}`} onClick={() => dispute(d, false)}>Dispute</button>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
