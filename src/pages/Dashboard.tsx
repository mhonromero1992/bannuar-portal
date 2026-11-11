import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtLongDate, fmtNum, todayManila } from '../lib/format';
import { manilaDay, NEEDS_A_LOOK } from '../lib/attendance';
import { ErrorState, Loading, PageHead } from '../ui/kit';
import { useCountUp } from '../ui/motion';
import { useDashboard, type DashboardData } from '../layout/Shell';

/**
 * The dashboard is arranged around what waits for someone's decision (left), then the state of
 * the posts and the roll (right and below). Every figure comes from the database; the charts follow
 * DESIGN.md: a meter list for the posts, one segmented bar for the roll, each with its table one
 * click away (Posts, Employees).
 */
function Count({ value }: { value: number }) {
  const shown = useCountUp(value);
  return <>{fmtNum(Math.round(shown))}</>;
}

function Tile({ to, label, value, note, alert, night, children }: { to?: string; label: string; value: number | string; note?: string; alert?: boolean; night?: boolean; children?: ReactNode }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className="big">{typeof value === 'number' ? <Count value={value} /> : value}</span>
      {children}
      {note && <span className="muted small">{note}</span>}
    </>
  );
  const cls = `tile${alert ? ' alert' : ''}${night ? ' night on-night' : ''}`;
  return to ? <Link className={cls} to={to} viewTransition>{body}</Link> : <div className={cls}>{body}</div>;
}

type QueueItem = { to: string; n: number; title: string; note?: string; urgent?: boolean; show: boolean };

function Waiting({ d }: { d: DashboardData }) {
  const { can } = useAuth();
  const items: QueueItem[] = [
    { to: '/requests?tab=leave', n: d.leave_pending_hr, title: 'Leave for HR approval', note: `${fmtNum(d.leave_pending_supervisor)} still with commanders · ${fmtNum(d.on_leave_today)} on leave today`, show: can.hr || can.ops },
    { to: '/requests?tab=coe', n: d.coe_pending, title: 'Certificates of employment to issue', note: d.coe_overdue ? `${d.coe_overdue} past the three-day limit` : 'Due within three days of each request', urgent: d.coe_overdue > 0, show: can.hr },
    { to: '/requests?tab=changes', n: d.profile_changes_pending, title: 'Contact detail changes to apply', note: 'Asked for in the app', show: can.hr },
    { to: '/requests?tab=concerns', n: d.payroll_concerns_open, title: 'Payroll concerns to answer', note: 'Raised by employees on a payslip', show: can.payroll },
    { to: '/recruitment', n: d.applications_new, title: 'New job applications', note: 'From the careers page', show: can.hr },
    { to: '/inquiries', n: d.inquiries_new, title: 'New proposal requests', note: 'From companies asking for guards', show: true },
  ];
  const shown = items.filter((i) => i.show);
  const total = shown.reduce((t, i) => t + i.n, 0);
  return (
    <section className="panel" aria-labelledby="dash-waiting">
      <div className="panel-head">
        <h2 id="dash-waiting">Waiting for you</h2>
        <span className="muted small">{total ? `${fmtNum(total)} in all` : 'Nothing waits'}</span>
      </div>
      <ul className="queue">
        {shown.map((i) => (
          <li key={i.to}>
            <Link to={i.to} viewTransition className={`${i.n === 0 ? 'is-zero' : ''}${i.urgent ? ' is-urgent' : ''}`}>
              <span className="n"><Count value={i.n} /></span>
              <span className="t"><b>{i.title}</b>{i.note && <span>{i.note}</span>}</span>
              <span className="go" aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Staffing = { id: string; name: string; guards_required: number; guards_assigned: number };

/** One row per active post: assigned against required, the shortest posts first. */
function Posts({ d }: { d: DashboardData }) {
  const q = useQuery({
    queryKey: ['dash-staffing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_staffing').select('id,name,guards_required,guards_assigned').eq('is_active', true).order('name').limit(500);
      if (error) throw error;
      return data as Staffing[];
    },
  });
  const rows = useMemo(() => (q.data ?? [])
    .filter((s) => s.guards_required > 0)
    .sort((a, b) => (b.guards_required - b.guards_assigned) - (a.guards_required - a.guards_assigned) || a.name.localeCompare(b.name))
    .slice(0, 6), [q.data]);
  const coverage = d.guards_required ? Math.min(100, Math.round((d.guards_deployed / d.guards_required) * 100)) : 0;
  return (
    <section className="panel" aria-labelledby="dash-posts">
      <div className="panel-head">
        <div>
          <h2 id="dash-posts">Guards at each post</h2>
          <p className="muted small" style={{ marginTop: 2 }}>{fmtNum(d.guards_deployed)} of {fmtNum(d.guards_required)} guards needed, {coverage}% · short posts first</p>
        </div>
        <Link className="btn btn-line btn-sm" to="/posts" viewTransition>All posts</Link>
      </div>
      {q.isLoading ? <Loading what="Loading the posts" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !rows.length ? (
        <p className="state">No active post needs guards yet. Set how many each post needs on its page.</p>
      ) : (
        <ul className="meters">
          {rows.map((s) => {
            const short = Math.max(s.guards_required - s.guards_assigned, 0);
            const pct = Math.min(100, (s.guards_assigned / s.guards_required) * 100);
            return (
              <li key={s.id}>
                <Link to={`/posts/${s.id}`} viewTransition aria-label={`${s.name}: ${s.guards_assigned} of ${s.guards_required} guards${short ? `, ${short} short` : ', fully staffed'}`}>
                  <span className="who"><b>{s.name}</b></span>
                  <span className={`bar${short ? ' is-short' : ''}`} aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                  <span className="fig">{s.guards_assigned} of {s.guards_required}<small className={short ? '' : 'ok'}>{short ? `${short} short` : 'Staffed'}</small></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The roll by status in one tall segmented bar; colours validated as a set (DESIGN.md). */
const ROLL = [
  { key: 'active', label: 'Active', fill: '#2f7d3f', ink: '#ffffff' },
  { key: 'floating', label: 'Floating', fill: '#eda100', ink: '#0b0b0b' },
  { key: 'on_leave', label: 'On leave', fill: '#256abf', ink: '#ffffff' },
  { key: 'suspended', label: 'Suspended', fill: '#d03b3b', ink: '#ffffff' },
];

function Roll({ d }: { d: DashboardData }) {
  const parts = ROLL.map((p) => ({ ...p, n: d.employees_by_status[p.key] ?? 0 }));
  const total = parts.reduce((t, p) => t + p.n, 0);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <section className="panel panel-pad" aria-labelledby="dash-roll">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h2 id="dash-roll">The roll by status</h2>
        <Link className="small muted" to="/employees" viewTransition>Employees</Link>
      </div>
      {total ? (
        <>
          <div className="seg" role="img" aria-label={parts.filter((p) => p.n).map((p) => `${p.label} ${p.n}`).join(', ')}>
            {parts.filter((p) => p.n).map((p) => {
              const share = Math.round((p.n / total) * 100);
              return (
                <span
                  key={p.key}
                  title={`${p.label}: ${fmtNum(p.n)} (${share}%)`}
                  style={{ flexGrow: p.n, background: p.fill, color: p.ink, opacity: hover && hover !== p.key ? 0.35 : 1 }}
                  onPointerEnter={() => setHover(p.key)}
                  onPointerLeave={() => setHover(null)}
                >
                  {share >= 12 ? `${share}%` : ''}
                </span>
              );
            })}
          </div>
          <ul className="legend">
            {parts.map((p) => (
              <li key={p.key} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)}>
                <i style={{ background: p.fill }} aria-hidden="true" />{p.label}<b>{fmtNum(p.n)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="state">No one is on the roll yet. Add employees on the Employees page.</p>}
    </section>
  );
}

/** Today's time in and out from the app, and how many need a look. */
function Today() {
  const day = todayManila();
  const q = useQuery({
    queryKey: ['dash-attendance', day],
    queryFn: async () => {
      const { from, to } = manilaDay(day);
      const all = supabase.from('attendance_logs').select('id', { count: 'exact', head: true }).gte('logged_at', from).lt('logged_at', to);
      const look = supabase.from('attendance_logs').select('id', { count: 'exact', head: true }).gte('logged_at', from).lt('logged_at', to).or(NEEDS_A_LOOK);
      const [a, b] = await Promise.all([all, look]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      return { all: a.count ?? 0, look: b.count ?? 0 };
    },
    refetchInterval: 120_000,
  });
  const look = q.data?.look ?? 0;
  return (
    <Tile
      to={look ? '/attendance?show=look' : '/attendance'}
      label="Time in and out today"
      value={q.data?.all ?? 0}
      alert={look > 0}
      note={q.isLoading ? 'Loading…' : q.error ? 'Could not load today\'s logs' : look ? `${fmtNum(look)} need a look: away from the post, no location or a mock location app` : 'None marked for a look'}
    />
  );
}

export default function Dashboard() {
  const { access, can } = useAuth();
  const q = useDashboard();
  const d = q.data;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (q.isLoading) return <Loading what="Loading the dashboard" />;
  if (q.error || !d) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  const onRoll = d.employees_current;
  return (
    <>
      <PageHead
        title={`${greeting}, ${access?.full_name?.split(' ')[0] ?? ''}`.trim()}
        intro={<span className="dash-date"><span className="beacon" aria-hidden="true" />{fmtLongDate(todayManila())}, Manila. What waits for a decision comes first.</span>}
        actions={<>
          {can.hr && <Link className="btn btn-line" to="/employees" viewTransition>Employees</Link>}
          {can.payroll && <Link className="btn" to={d.latest_period ? `/payroll/${d.latest_period.id}` : '/payroll'} viewTransition>{d.latest_period?.status === 'draft' ? 'Open the draft cutoff' : 'Payroll'}</Link>}
        </>}
      />
      <div className="dash">
        <div className="span-7"><Waiting d={d} /></div>
        <div className="span-5 stack">
          <div className="tiles">
            <Tile night to="/employees" label="On the roll" value={onRoll} note={`${fmtNum(d.employees_by_status.active ?? 0)} active · ${fmtNum(d.floating)} floating`} />
            <Today />
            <Tile to="/employees?status=floating" label="Floating over 150 days" value={d.floating_over_150_days} note="Six months is the limit for reserve status" alert={d.floating_over_150_days > 0} />
            <Tile to="/compliance" label="Expired documents" value={d.documents_expired} note={`${fmtNum(d.documents_expiring)} expiring soon · ${fmtNum(d.compliance_gaps)} people missing one`} alert={d.documents_expired > 0} />
          </div>
          {can.payroll && (
            <Tile
              to={d.latest_period ? `/payroll/${d.latest_period.id}` : '/payroll'}
              label="Latest payroll cutoff"
              value={d.latest_period ? (d.latest_period.status === 'published' ? 'Published' : 'Draft') : 'None yet'}
              note={d.latest_period ? `${d.latest_period.label} · ${fmtNum(d.latest_period.payslips)} payslips · pay ${fmtDate(d.latest_period.pay_date)}` : 'Create the first cutoff'}
            />
          )}
        </div>
        <div className="span-7"><Posts d={d} /></div>
        <div className="span-5"><Roll d={d} /></div>
      </div>
    </>
  );
}
