import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDateTime } from '../lib/format';
import { Empty, ErrorState, Loading, PageHead, Pager } from '../ui/kit';

const PAGE = 50;
const TABLES = ['employees', 'employee_government_ids', 'employee_compensation', 'employee_documents', 'payroll_periods', 'payslips', 'leave_requests', 'coe_requests', 'certificates', 'profile_change_requests', 'announcements', 'user_roles', 'staff_invitations', 'sites', 'clients', 'job_openings', 'auth.users'];

export default function AuditLog() {
  const { can } = useAuth();
  const [table, setTable] = useState('');
  const [page, setPage] = useState(0);
  const q = useQuery({
    queryKey: ['audit', table, page],
    enabled: can.auditor,
    queryFn: async () => {
      let req = supabase.from('audit_log').select('*', { count: 'exact' }).order('occurred_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (table) req = req.eq('table_name', table);
      const { data, error, count } = await req;
      if (error) throw error;
      const actors = [...new Set(data.map((r) => r.actor_id).filter(Boolean))];
      const names = actors.length ? (await supabase.from('profiles').select('id,full_name,email').in('id', actors)).data ?? [] : [];
      return { rows: data, count: count ?? 0, names: Object.fromEntries(names.map((n) => [n.id, n.full_name || n.email])) };
    },
    placeholderData: (prev) => prev,
  });
  if (!can.auditor) return <Empty title="Only HR admins and super admins read the audit log" />;
  const summary = (r: Record<string, unknown>) => {
    if (r.note) return String(r.note);
    const data = (r.new_data ?? r.old_data) as Record<string, unknown> | null;
    if (!data) return '';
    const keys = Object.keys(data).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
    return r.action === 'UPDATE' ? `Changed ${keys.join(', ')}` : keys.slice(0, 6).join(', ');
  };
  return (
    <>
      <PageHead title="Audit log" intro="Who changed what, and every time someone opened an employee's government numbers." />
      <div className="panel">
        <div className="toolbar">
          <select className="select" style={{ width: 'auto' }} aria-label="Record kind" value={table} onChange={(e) => { setTable(e.target.value); setPage(0); }}>
            <option value="">Every kind of record</option>
            {TABLES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.rows.length ? <Empty title="Nothing recorded here yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>{q.data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="tabular">{fmtDateTime(r.occurred_at)}</td>
                  <td>{r.actor_id ? q.data.names[r.actor_id] ?? 'Unknown' : <span className="muted">SQL editor or system</span>}</td>
                  <td><b>{r.action}</b><span className="cell-sub">{String(r.table_name).replace(/_/g, ' ')}</span></td>
                  <td><span className="code">{String(r.record_id).slice(0, 8)}</span></td>
                  <td className="muted small" style={{ maxWidth: 420 }}>{summary(r)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE} total={q.data?.count ?? null} onPage={setPage} />
      </div>
    </>
  );
}
