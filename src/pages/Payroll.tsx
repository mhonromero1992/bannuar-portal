import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate } from '../lib/format';
import { PERIOD_STATUS } from '../lib/labels';
import { Dialog, Empty, ErrorState, Loading, PageHead, StatusBadge, TextField, useToast } from '../ui/kit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function cutoffLabel(a: string, b: string) {
  if (!a || !b) return '';
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  if (ya === yb && ma === mb) return `${MONTHS[ma - 1]} ${da} to ${db}, ${ya}`;
  if (ya === yb) return `${MONTHS[ma - 1]} ${da} to ${MONTHS[mb - 1]} ${db}, ${ya}`;
  return `${MONTHS[ma - 1]} ${da}, ${ya} to ${MONTHS[mb - 1]} ${db}, ${yb}`;
}

export default function Payroll() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['periods'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('*, payslips(count)').order('period_end', { ascending: false }).limit(60);
      if (error) throw error;
      return data;
    },
  });
  return (
    <>
      <PageHead title="Payroll" intro="Each cutoff's payslips are worked out from the assignments, rates and pay rules, or imported from the payroll file. Employees see theirs in the app once the cutoff is published." actions={<><Link className="btn btn-line" to="/payroll/13th-month">13th month</Link><button className="btn" type="button" onClick={() => setCreating(true)}>New cutoff</button></>} />
      <div className="panel">
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty title="No cutoffs yet">Create the first cutoff, then import its payroll file.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Cutoff</th><th>Pay date</th><th className="num">Payslips</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((p) => (
              <tr key={p.id}>
                <td><Link className="cell-main" to={`/payroll/${p.id}`}>{p.label}</Link></td>
                <td className="tabular">{fmtDate(p.pay_date)}</td>
                <td className="num">{(p.payslips as { count: number }[])[0]?.count ?? 0}</td>
                <td><StatusBadge map={PERIOD_STATUS} value={p.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <Dialog open={creating} title="New cutoff" onClose={() => setCreating(false)}>
        <NewPeriod onCancel={() => setCreating(false)} />
      </Dialog>
    </>
  );
}

function NewPeriod({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [v, setV] = useState({ start: '', end: '', pay: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.start || !v.end || !v.pay) return setError('Enter the first and last day of the cutoff and the pay date.');
    if (v.end < v.start) return setError('The last day is before the first day.');
    setBusy(true);
    const { data, error: err } = await supabase.from('payroll_periods').insert({ period_start: v.start, period_end: v.end, pay_date: v.pay, label: cutoffLabel(v.start, v.end) }).select('id').single();
    setBusy(false);
    if (err) return setError(err.code === '23505' ? 'A cutoff with these dates already exists.' : errorText(err));
    toast('Cutoff created. Work out its pay or import its payroll file next.');
    navigate(`/payroll/${data.id}`);
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row">
        <TextField label="First day" type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} />
        <TextField label="Last day" type="date" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} />
        <TextField label="Pay date" type="date" value={v.pay} onChange={(e) => setV({ ...v, pay: e.target.value })} />
      </div>
      {v.start && v.end && v.end >= v.start && <p className="muted">Shown to employees as <b>{cutoffLabel(v.start, v.end)}</b>.</p>}
      <div className="form-foot"><button className="btn btn-line" type="button" onClick={onCancel}>Cancel</button><button className="btn" type="submit" aria-busy={busy}>Create the cutoff</button></div>
    </form>
  );
}
