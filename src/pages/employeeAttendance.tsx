import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, todayManila } from '../lib/format';
import { DUTY_FLAG } from '../lib/labels';
import { ATTENDANCE_SELECT, manilaDay, NEEDS_A_LOOK, type AttendanceLog } from '../lib/attendance';
import { Badge, Empty, ErrorState, Loading, Pager, SelectField, StatusBadge, TextField } from '../ui/kit';
import { AttendanceTable, selfieLinks } from './attendanceShared';

/** A duty from employee_duties(): a time in and the time out after it, or a log missing its pair. */
interface Duty {
  log_id: string; duty_date: string; site_id: string | null; site_name: string | null;
  time_in: string | null; time_out: string | null; hours: number | string | null; flags: string[]; clean: boolean;
}

type Show = 'duties' | 'all' | 'look' | 'other';
const SHOW: { value: Show; label: string }[] = [
  { value: 'duties', label: 'Duties' },
  { value: 'all', label: 'Every log, with photos' },
  { value: 'look', label: 'Logs that need a look' },
  { value: 'other', label: 'Logs by the commander or by hand' },
];
const PAGE = 50;
const isDay = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
/** The last day of a month, "2026-02" → "2026-02-28". */
const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthName = (m: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const dayFmt = new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const manilaDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));
/** A time of the duty, with its date when it falls on another day (a night shift's time out). */
const at = (iso: string | null, day: string) => {
  if (!iso) return null;
  const d = manilaDate(iso);
  return d === day ? timeFmt.format(new Date(iso)) : `${timeFmt.format(new Date(iso))}, ${dayFmt.format(new Date(`${d}T00:00:00Z`))}`;
};
const hoursText = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(2));

/**
 * An employee's time in and out for a month, or any dates up to a year: the duties they make (what
 * pay counts: a time in and the time out after it, and what needs payroll's look), or every log with
 * its photo. The month and dates stay in the address, so a link opens the same view.
 */
export function EmployeeAttendance({ employeeId }: { employeeId: string }) {
  const [params, setParams] = useSearchParams();
  const thisMonth = todayManila().slice(0, 7);
  const from = isDay(params.get('from')) ? params.get('from')! : `${thisMonth}-01`;
  const asked = isDay(params.get('to')) ? params.get('to')! : monthEnd(from.slice(0, 7));
  const to = asked < from ? from : asked;
  const show: Show = SHOW.some((o) => o.value === params.get('show')) ? (params.get('show') as Show) : 'duties';
  const [page, setPage] = useState(0);
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
    setPage(0);
  };
  // a whole month, or the dates chosen
  const month = from.endsWith('-01') && to === monthEnd(from.slice(0, 7)) ? from.slice(0, 7) : null;
  const setMonth = (m: string) => { if (/^\d{4}-\d{2}$/.test(m)) update({ from: `${m}-01`, to: monthEnd(m) }); };
  const tooLong = (Date.parse(to) - Date.parse(from)) / 86400000 > 366;
  const when = month ? monthName(month) : `${fmtDate(from)} to ${fmtDate(to)}`;

  const duties = useQuery({
    queryKey: ['employee-duties', employeeId, from, to],
    enabled: !tooLong,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('employee_duties', { p_employee_id: employeeId, p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as Duty[];
    },
    placeholderData: (prev) => prev,
  });
  const logs = useQuery({
    queryKey: ['employee-attendance', employeeId, from, to, show, page],
    enabled: show !== 'duties' && !tooLong,
    queryFn: async () => {
      let req = supabase.from('attendance_logs').select(ATTENDANCE_SELECT, { count: 'exact' }).eq('employee_id', employeeId)
        .gte('logged_at', manilaDay(from).from).lt('logged_at', manilaDay(to).to)
        .order('logged_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (show === 'look') req = req.or(NEEDS_A_LOOK);
      if (show === 'other') req = req.neq('source', 'self');
      const { data, error, count } = await req;
      if (error) throw error;
      const rows = data as unknown as AttendanceLog[];
      return { rows, count: count ?? 0, photos: await selfieLinks(rows) };
    },
    placeholderData: (prev) => prev,
  });

  const list = duties.data ?? [];
  const hours = list.reduce((t, d) => t + (d.time_in && d.time_out ? Number(d.hours ?? 0) : 0), 0);
  const clean = list.filter((d) => d.clean).length;
  const look = list.length - clean;
  const posts = [...new Set(list.map((d) => d.site_name).filter(Boolean))];

  return (
    <div className="panel">
      <div className="panel-head"><h2>Time in and out</h2><span className="muted small">{when}</span></div>
      <div className="toolbar">
        <button className="btn btn-line month-step" type="button" aria-label="Previous month" title="Previous month" onClick={() => setMonth(shiftMonth(month ?? from.slice(0, 7), -1))}>‹</button>
        <TextField label="Month" type="month" value={month ?? ''} max={thisMonth} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} />
        <button className="btn btn-line month-step" type="button" aria-label="Next month" title="Next month" disabled={(month ?? to.slice(0, 7)) >= thisMonth} onClick={() => setMonth(shiftMonth(month ?? from.slice(0, 7), 1))}>›</button>
        <TextField label="From" type="date" value={from} onChange={(e) => { if (isDay(e.target.value)) update({ from: e.target.value, to: e.target.value > to ? e.target.value : to }); }} style={{ width: 'auto' }} />
        <TextField label="To" type="date" value={to} min={from} onChange={(e) => { if (isDay(e.target.value)) update({ to: e.target.value }); }} style={{ width: 'auto' }} />
        <SelectField label="Show" value={show} onChange={(e) => update({ show: e.target.value === 'duties' ? null : e.target.value })} options={SHOW} style={{ width: 'auto' }} />
      </div>

      {tooLong ? (
        <p className="callout warn" role="alert" style={{ margin: 18 }}>Choose a year or less: from {fmtDate(from)} to {fmtDate(to)} is longer.</p>
      ) : duties.isLoading ? <Loading what="Reading the time in and out" /> : duties.error ? <ErrorState error={errorText(duties.error)} retry={() => duties.refetch()} /> : (
        <>
          <p className="att-sum" role="status">
            {list.length ? (
              <>
                <b>{clean}</b> {clean === 1 ? 'duty counts' : 'duties count'} on {clean === 1 ? 'its' : 'their'} own
                {look > 0 && <>, <b>{look}</b> {look === 1 ? 'needs' : 'need'} payroll's look</>}
                {' '}· <b>{hoursText(hours)}</b> hours{posts.length ? ` · ${posts.join(', ')}` : ''}
              </>
            ) : `No duty in ${when}.`}
          </p>
          {show === 'duties' ? (
            !list.length ? (
              <Empty title="No time in or out in these dates">Choose another month, or other dates. A duty is a time in and the time out after it, from the app or the post's commander.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Day</th><th>Post</th><th>Time in</th><th>Time out</th><th className="num">Hours</th><th>For pay</th></tr></thead>
                  <tbody>{list.map((d) => (
                    <tr key={d.log_id}>
                      <td className="tabular">{dayFmt.format(new Date(`${d.duty_date}T00:00:00Z`))}</td>
                      <td>{d.site_name ?? <span className="muted">No post</span>}</td>
                      <td className="tabular">{at(d.time_in, d.duty_date) ?? <span className="muted">None</span>}</td>
                      <td className="tabular">{at(d.time_out, d.duty_date) ?? <span className="muted">None</span>}</td>
                      <td className="num">{d.time_in && d.time_out ? hoursText(Number(d.hours ?? 0)) : ''}</td>
                      <td>{d.clean ? <Badge tone="ok">Counts</Badge> : (
                        <span className="row">{d.flags.map((f) => (DUTY_FLAG[f] ? <StatusBadge key={f} map={DUTY_FLAG} value={f} /> : <Badge key={f}>{f}</Badge>))}</span>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )
          ) : logs.isLoading ? <Loading what="Loading the logs" /> : logs.error ? <ErrorState error={errorText(logs.error)} retry={() => logs.refetch()} /> : !logs.data?.rows.length ? (
            <Empty title={show === 'look' ? 'Nothing to look at in these dates' : 'No time in or out in these dates'}>{when}</Empty>
          ) : (
            <>
              <AttendanceTable rows={logs.data.rows} photos={logs.data.photos} showEmployee={false} />
              <Pager page={page} pageSize={PAGE} total={logs.data.count} onPage={setPage} />
            </>
          )}
          {show === 'duties' && list.some((d) => !d.clean) && (
            <p className="muted small" style={{ margin: '0 18px 16px' }}>A duty that needs a look is decided on its cutoff's page in Payroll: counted if it was served, or not counted with a reason. Until then it is not paid.</p>
          )}
        </>
      )}
    </div>
  );
}
