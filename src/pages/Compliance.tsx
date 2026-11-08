import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate } from '../lib/format';
import { Badge, Empty, ErrorState, Loading, PageHead, Tabs } from '../ui/kit';

type Tab = 'alerts' | 'gaps';

export default function Compliance() {
  const [tab, setTab] = useState<Tab>('alerts');
  const alerts = useQuery({
    queryKey: ['document-alerts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('document_alerts').select('*').order('expires_on').limit(500);
      if (error) throw error;
      return data;
    },
  });
  const gaps = useQuery({
    queryKey: ['compliance-gaps'],
    enabled: tab === 'gaps',
    queryFn: async () => {
      const { data, error } = await supabase.from('compliance_gaps').select('*').order('last_name').limit(1000);
      if (error) throw error;
      return data;
    },
  });
  return (
    <>
      <PageHead title="Licenses and documents" intro="Security licenses, clearances and test results that have expired, expire soon, or are missing for field personnel." />
      <Tabs label="Compliance" tabs={[{ id: 'alerts', label: 'Expired and expiring' }, { id: 'gaps', label: 'Missing for deployment' }]} value={tab} onChange={setTab} />
      <div className="panel">
        {tab === 'alerts' ? (
          alerts.isLoading ? <Loading /> : alerts.error ? <ErrorState error={errorText(alerts.error)} retry={() => alerts.refetch()} /> : !alerts.data?.length ? <Empty title="Nothing expired or expiring">Every document on file is valid beyond its reminder window.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Employee</th><th>Document</th><th>Post</th><th>Expires</th><th /></tr></thead>
                <tbody>{alerts.data.map((d) => (
                  <tr key={d.id}>
                    <td><Link className="cell-main" to={`/employees/${d.employee_id}?tab=documents`}>{d.last_name}, {d.first_name}</Link><span className="cell-sub tabular">{d.employee_no}</span></td>
                    <td>{d.type_name}{d.document_no && <span className="cell-sub">{d.document_no}</span>}</td>
                    <td>{d.site_name ?? <span className="muted">None</span>}</td>
                    <td className="tabular">{fmtDate(d.expires_on)}</td>
                    <td>{d.state === 'expired' ? <Badge tone="bad">Expired {Math.abs(d.days_left)} days ago</Badge> : <Badge tone="warn">{d.days_left === 0 ? 'Expires today' : `In ${d.days_left} days`}</Badge>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )
        ) : gaps.isLoading ? <Loading /> : gaps.error ? <ErrorState error={errorText(gaps.error)} retry={() => gaps.refetch()} /> : !gaps.data?.length ? <Empty title="No gaps">Every field employee has each document required for deployment.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Employee</th><th>Missing or expired</th><th>Post</th><th>Last on file</th></tr></thead>
              <tbody>{gaps.data.map((g) => (
                <tr key={`${g.employee_id}-${g.document_type_id}`}>
                  <td><Link className="cell-main" to={`/employees/${g.employee_id}?tab=documents`}>{g.last_name}, {g.first_name}</Link><span className="cell-sub tabular">{g.employee_no}</span></td>
                  <td>{g.type_name}</td>
                  <td>{g.site_name ?? <span className="muted">None</span>}</td>
                  <td>{g.last_expiry ? <Badge tone="bad">Expired {fmtDate(g.last_expiry)}</Badge> : <span className="muted">Never filed</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
