import { Link } from 'react-router';
import { useAuth } from '../lib/auth';
import { fmtDate, fmtNum } from '../lib/format';
import { ErrorState, Loading, PageHead } from '../ui/kit';
import { useDashboard } from '../layout/Shell';
import { errorText } from '../lib/format';

function Tile({ to, label, value, note, alert, night }: { to?: string; label: string; value: number | string; note?: string; alert?: boolean; night?: boolean }) {
  const body = (
    <>
      <span className="label">{label}</span>
      <span className="big">{typeof value === 'number' ? fmtNum(value) : value}</span>
      {note && <span className="muted small">{note}</span>}
    </>
  );
  const cls = `tile${alert ? ' alert' : ''}${night ? ' night on-night' : ''}`;
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

export default function Dashboard() {
  const { access, can } = useAuth();
  const q = useDashboard();
  const d = q.data;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (q.isLoading) return <Loading what="Loading the dashboard" />;
  if (q.error || !d) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  const coverage = d.guards_required ? Math.min(100, Math.round((d.guards_deployed / d.guards_required) * 100)) : 0;
  return (
    <>
      <PageHead title={`${greeting}, ${access?.full_name?.split(' ')[0] ?? ''}`.trim()} intro="What needs attention today across employees, posts and requests." />
      <div className="stack">
        <div className="tiles">
          <Tile night to="/employees" label="Employees on the roll" value={d.employees_current} note={`${fmtNum(d.employees_by_status.active ?? 0)} active · ${fmtNum(d.floating)} floating`} />
          <div className="tile">
            <span className="label">Posts covered</span>
            <span className="big">{coverage}%</span>
            <div className="meter" aria-hidden="true"><span style={{ width: `${coverage}%` }} /></div>
            <span className="muted small">{fmtNum(d.guards_deployed)} of {fmtNum(d.guards_required)} guards at {fmtNum(d.sites_active)} posts{d.sites_short ? ` · ${d.sites_short} short` : ''}</span>
          </div>
          <Tile to="/employees?status=floating" label="Floating over 150 days" value={d.floating_over_150_days} note="Six months is the limit for reserve status" alert={d.floating_over_150_days > 0} />
          <Tile to="/compliance" label="Expired documents" value={d.documents_expired} note={`${fmtNum(d.documents_expiring)} expiring soon · ${fmtNum(d.compliance_gaps)} people missing one`} alert={d.documents_expired > 0} />
        </div>
        <h2 style={{ fontSize: 17, marginTop: 8 }}>Waiting for you</h2>
        <div className="tiles">
          {(can.hr || can.ops) && <Tile to="/requests?tab=leave" label="Leave for HR approval" value={d.leave_pending_hr} note={`${fmtNum(d.leave_pending_supervisor)} with commanders · ${fmtNum(d.on_leave_today)} on leave today`} />}
          {can.hr && <Tile to="/requests?tab=coe" label="Certificates to issue" value={d.coe_pending} note={d.coe_overdue ? `${d.coe_overdue} past the three-day limit` : 'Due within three days of the request'} alert={d.coe_overdue > 0} />}
          {can.hr && <Tile to="/requests?tab=changes" label="Contact detail changes" value={d.profile_changes_pending} />}
          {can.payroll && <Tile to="/requests?tab=concerns" label="Payroll concerns" value={d.payroll_concerns_open} />}
          {can.hr && <Tile to="/recruitment" label="New applications" value={d.applications_new} />}
          <Tile to="/inquiries" label="New proposal requests" value={d.inquiries_new} />
          {can.payroll && (
            <Tile
              to={d.latest_period ? `/payroll/${d.latest_period.id}` : '/payroll'}
              label="Latest payroll cutoff"
              value={d.latest_period ? (d.latest_period.status === 'published' ? 'Published' : 'Draft') : 'None yet'}
              note={d.latest_period ? `${d.latest_period.label} · ${fmtNum(d.latest_period.payslips)} payslips · pay ${fmtDate(d.latest_period.pay_date)}` : 'Create the first cutoff'}
            />
          )}
        </div>
      </div>
    </>
  );
}
