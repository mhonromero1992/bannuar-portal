import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtLongDate, todayManila } from '../lib/format';
import { ATTENDANCE_SELECT, manilaDay, NEEDS_A_LOOK, type AttendanceLog } from '../lib/attendance';
import { useSites } from '../lib/refs';
import { Empty, ErrorState, Loading, PageHead, Pager } from '../ui/kit';
import { AttendanceTable, selfieLinks } from './attendanceShared';

const PAGE = 50;

export default function Attendance() {
  const [params, setParams] = useSearchParams();
  const day = params.get('day') || todayManila();
  const site = params.get('site') ?? '';
  const show = params.get('show') === 'look' ? 'look' : 'all';
  const [page, setPage] = useState(0);
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
        intro="Time in and time out from the app. Each log has a photo taken then, the database's time, and the phone's location checked against the guard's post. GPS can be off indoors and can be faked, so look at the photo when a log is marked."
      />
      <div className="panel">
        <div className="toolbar">
          <label className="visually-hidden" htmlFor="att-day">Day</label>
          <input id="att-day" className="input" style={{ width: 'auto' }} type="date" value={day} max={todayManila()} onChange={(e) => set('day', e.target.value)} />
          <select className="select" style={{ width: 'auto' }} aria-label="Post" value={site} onChange={(e) => set('site', e.target.value)}>
            <option value="">Every post</option>
            {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} aria-label="Which logs" value={show} onChange={(e) => set('show', e.target.value === 'look' ? 'look' : '')}>
            <option value="all">Every log</option>
            <option value="look">Needs a look</option>
          </select>
        </div>
        {q.isLoading ? <Loading what="Loading the logs" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.rows.length ? (
          <Empty title={show === 'look' ? 'Nothing to look at for this day' : 'No time in or out on this day'}>{fmtLongDate(day)}</Empty>
        ) : (
          <AttendanceTable rows={q.data.rows} photos={q.data.photos} />
        )}
        <Pager page={page} pageSize={PAGE} total={q.data?.count ?? null} onPage={setPage} />
      </div>
    </>
  );
}
