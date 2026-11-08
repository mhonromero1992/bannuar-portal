import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate, fullName } from '../lib/format';
import { EMPLOYEE_STATUS, options } from '../lib/labels';
import { safeSearch, useSites } from '../lib/refs';
import { Dialog, Empty, ErrorState, Loading, PageHead, Pager, Search, StatusBadge, useDebounced } from '../ui/kit';
import { EmployeeForm } from './EmployeeForm';

const PAGE = 25;

export default function Employees() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebounced(text);
  const status = params.get('status') ?? '';
  const site = params.get('site') ?? '';
  const page = Number(params.get('page') ?? 0);
  const [adding, setAdding] = useState(false);
  const sites = useSites();
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const list = useQuery({
    queryKey: ['employees', q, status, site, page],
    queryFn: async () => {
      let req = supabase
        .from('employees')
        .select('id,employee_no,first_name,middle_name,last_name,suffix,position,status,date_hired,floating_since,user_id,site:sites!employees_site_id_fkey(name)', { count: 'exact' })
        .order('last_name')
        .order('first_name')
        .range(page * PAGE, page * PAGE + PAGE - 1);
      const s = safeSearch(q);
      if (s) req = req.or(`employee_no.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`);
      if (status) req = req.eq('status', status);
      if (site === 'none') req = req.is('site_id', null);
      else if (site) req = req.eq('site_id', site);
      const { data, error, count } = await req;
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
    placeholderData: (prev) => prev,
  });

  return (
    <>
      <PageHead
        title="Employees"
        intro="The 201 file of every guard and office employee."
        actions={can.hr && <button className="btn" type="button" onClick={() => setAdding(true)}>Add an employee</button>}
      />
      <div className="panel">
        <div className="toolbar">
          <Search value={text} onChange={(v) => { setText(v); setParam('q', v); }} label="Search by name or employee number" />
          <select className="select" style={{ width: 'auto' }} aria-label="Status" value={status} onChange={(e) => setParam('status', e.target.value)}>
            <option value="">Every status</option>
            {options(EMPLOYEE_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="select" style={{ width: 'auto', maxWidth: 260 }} aria-label="Post" value={site} onChange={(e) => setParam('site', e.target.value)}>
            <option value="">Every post</option>
            <option value="none">No post</option>
            {(sites.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {list.isLoading ? (
          <Loading what="Loading employees" />
        ) : list.error ? (
          <ErrorState error={errorText(list.error)} retry={() => list.refetch()} />
        ) : !list.data?.rows.length ? (
          <Empty title={q || status || site ? 'No employee matches' : 'No employees yet'}>
            {q || status || site ? 'Clear the search or filters.' : can.hr ? 'Add the first employee, or load the demo data (supabase/seed-demo.sql).' : null}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Employee</th><th>Position</th><th>Post</th><th>Status</th><th>Hired</th><th>App</th></tr>
              </thead>
              <tbody>
                {list.data.rows.map((e) => (
                  <tr key={e.id} className="clickable" onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a')) navigate(`/employees/${e.id}`); }}>
                    <td>
                      <Link className="cell-main" to={`/employees/${e.id}`}>{e.last_name}, {fullName({ ...e, last_name: '' }).trim()}</Link>
                      <span className="cell-sub tabular">{e.employee_no}</span>
                    </td>
                    <td>{e.position}</td>
                    <td>{(e.site as unknown as { name: string } | null)?.name ?? <span className="muted">None</span>}</td>
                    <td>
                      <StatusBadge map={EMPLOYEE_STATUS} value={e.status} />
                      {e.status === 'floating' && e.floating_since && <span className="cell-sub">since {fmtDate(e.floating_since)}</span>}
                    </td>
                    <td className="tabular">{fmtDate(e.date_hired)}</td>
                    <td>{e.user_id ? <span className="badge ok">Active</span> : <span className="muted small">Not yet</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE} total={list.data?.count ?? null} onPage={(p) => setParam('page', String(p))} />
      </div>
      <Dialog open={adding} title="Add an employee" onClose={() => setAdding(false)} wide>
        <EmployeeForm onSaved={(id) => { setAdding(false); navigate(`/employees/${id}`); }} onCancel={() => setAdding(false)} />
      </Dialog>
    </>
  );
}
