import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtMoney, todayManila } from '../lib/format';
import { roundTo, thirteenthMonth, toCsv, type ThirteenthRow } from '../lib/pay';
import { downloadFile, loadPayInputs, savePayslips } from '../lib/payData';
import { Dialog, Empty, ErrorState, Loading, PageHead, Search, SelectField, TextField, useDebounced, useToast } from '../ui/kit';

const SHOW = 200;

/** 13th month pay for a year: pro-rated for each stretch at a post and rate, then added up. */
export default function ThirteenthMonth() {
  const thisYear = Number(todayManila().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [text, setText] = useState('');
  const s = useDebounced(text).trim().toLowerCase();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ['thirteenth', year],
    queryFn: async () => {
      const d = await loadPayInputs(`${year}-01-01`, `${year}-12-31`);
      return thirteenthMonth(year, d.people, d.assignments, d.posts, d.rules, d.rates).sort((a, b) => a.person.name.localeCompare(b.person.name));
    },
  });
  const rows = useMemo(() => (q.data ?? []).filter((r) => !s || r.person.name.toLowerCase().includes(s) || r.person.employee_no.toLowerCase().includes(s)), [q.data, s]);
  const ready = (q.data ?? []).filter((r) => !r.problems.length && r.amount > 0);
  const blocked = (q.data ?? []).filter((r) => r.problems.length);
  const total = ready.reduce((t, r) => t + r.amount, 0);
  const csv = () => toCsv((q.data ?? []).flatMap((r) => r.pieces.map((p) => ({
    employee_no: r.person.employee_no, name: r.person.name, post: p.post, from: p.from, to: p.to, hourly_rate: p.rate ?? '', months: roundTo(p.months, 4),
    duty_days: roundTo(p.days, 2), basic_pay: p.basic, thirteenth_month: p.share, employee_total: r.amount, problem: p.problem ?? '',
  }))));
  return (
    <>
      <Link className="back" to="/payroll">← Payroll</Link>
      <PageHead
        title="13th month pay"
        intro="A twelfth of the basic pay earned in the year (PD 851), worked out for each stretch a guard held a post, at that post's hourly rate and its client's rule, then added up. Due on or before 24 December."
        actions={<>
          <button className="btn btn-line" type="button" disabled={!q.data?.length} onClick={() => downloadFile(`13th month ${year}.csv`, csv())}>Download (CSV)</button>
          <button className="btn" type="button" disabled={!ready.length} onClick={() => setPaying(true)}>Create the payout cutoff</button>
        </>}
      />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="label">Employees</span><span className="big">{q.data?.length ?? 0}</span></div>
        <div className="tile night on-night"><span className="label">13th month, {year}</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(total)}</span></div>
        <div className="tile"><span className="label">To fix first</span><span className="big">{blocked.length}</span></div>
      </div>
      {blocked.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 16 }} role="alert"><b>{blocked.length} employees need a rate or rule first:</b>
          <ul>{blocked.slice(0, 8).map((r) => <li key={r.person.id}><Link to={`/employees/${r.person.id}`}>{r.person.name}</Link>: {r.problems[0]}</li>)}</ul>
        </div>
      )}
      <div className="panel">
        <div className="toolbar">
          <Search value={text} onChange={setText} label="Search by name or employee number" />
          <SelectField label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
        {q.isLoading ? <Loading what="Working out the 13th month" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !rows.length ? (
          <Empty title={s ? 'Nobody matches' : `No assignments in ${year}`}>{!s && 'The 13th month follows the assignment history on each employee\'s Deployment tab.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Employee</th><th>Posts in {year}</th><th className="num">Basic pay</th><th className="num">13th month</th><th /></tr></thead>
              <tbody>{rows.slice(0, SHOW).map((r) => (
                <Fragment key={r.person.id}>
                  <tr>
                    <td><Link className="cell-main" to={`/employees/${r.person.id}`}>{r.person.name}</Link><span className="cell-sub tabular">{r.person.employee_no}</span></td>
                    <td>{[...new Set(r.pieces.map((p) => p.post))].join(', ')}</td>
                    <td className="num">{fmtMoney(r.basic)}</td>
                    <td className="num"><b>{r.problems.length ? <span className="muted">Not yet</span> : fmtMoney(r.amount)}</b></td>
                    <td><button className="link-btn" type="button" aria-expanded={open === r.person.id} onClick={() => setOpen(open === r.person.id ? null : r.person.id)}>{open === r.person.id ? 'Hide' : 'How'}</button></td>
                  </tr>
                  {open === r.person.id && (
                    <tr><td colSpan={5}><Breakdown r={r} /></td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
        {rows.length > SHOW && <p className="pager">Showing {SHOW} of {rows.length}. Search to find one employee; the download has everyone.</p>}
      </div>
      <Dialog open={paying} title={`Create the 13th month payout · ${year}`} onClose={() => setPaying(false)}>
        {paying && <Payout year={year} rows={ready} skipped={blocked.length} onClose={() => setPaying(false)} />}
      </Dialog>
    </>
  );
}

function Breakdown({ r }: { r: ThirteenthRow }) {
  return (
    <div className="stack" style={{ padding: '4px 0 8px' }}>
      <table className="table">
        <thead><tr><th>Post</th><th>From</th><th>To</th><th className="num">Hourly rate</th><th className="num">Months</th><th className="num">Duty days</th><th className="num">Basic pay</th><th className="num">13th month</th></tr></thead>
        <tbody>
          {r.pieces.map((p, i) => (
            <tr key={i}>
              <td>{p.post}{p.problem && <span className="cell-sub" style={{ color: 'var(--red)' }}>{p.problem}</span>}</td>
              <td className="tabular">{fmtDate(p.from)}</td><td className="tabular">{fmtDate(p.to)}</td>
              <td className="num">{p.rate === null ? '' : fmtMoney(p.rate)}</td>
              <td className="num">{roundTo(p.months, 2)}</td><td className="num">{roundTo(p.days, 2)}</td>
              <td className="num">{fmtMoney(p.basic)}</td><td className="num">{fmtMoney(p.share)}</td>
            </tr>
          ))}
          <tr><td colSpan={6}><b>Total</b></td><td className="num"><b>{fmtMoney(r.basic)}</b></td><td className="num"><b>{fmtMoney(r.amount)}</b></td></tr>
        </tbody>
      </table>
      <p className="muted small">Basic pay at each post is its rule's basic pay lines for the duty days: hourly rate × regular hours × duty days a month × months. The 13th month is a twelfth of it, and the stretches are added up.</p>
    </div>
  );
}

function Payout({ year, rows, skipped, onClose }: { year: number; rows: ThirteenthRow[]; skipped: number; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [pay, setPay] = useState(`${year}-12-24`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const create = async () => {
    setError('');
    if (!pay) return setError('Choose the pay date.');
    setBusy('Creating the cutoff…');
    try {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const found = await supabase.from('payroll_periods').select('id,status').eq('period_start', from).eq('period_end', to).maybeSingle();
      if (found.error) throw found.error;
      if (found.data && found.data.status !== 'draft') throw new Error('The cutoff for the whole year is already published. Unpublish it on the Payroll page to replace its payslips.');
      let id = found.data?.id as string | undefined;
      if (!id) {
        const made = await supabase.from('payroll_periods').insert({ period_start: from, period_end: to, pay_date: pay, label: `13th month pay ${year}` }).select('id').single();
        if (made.error) throw made.error;
        id = made.data.id as string;
      }
      const lines = rows.map((r) => ({
        employee_no: r.person.employee_no,
        site_name: [...new Set(r.pieces.map((p) => p.post))].join(', '),
        'earning: 13th month pay': r.amount,
        remarks: r.pieces.map((p) => `${p.post}, ${fmtDate(p.from)} to ${fmtDate(p.to)}: ${fmtMoney(p.share)}`).join('; '),
      }));
      const result = await savePayslips(id, lines, setBusy);
      qc.invalidateQueries({ queryKey: ['periods'] });
      toast(`${result.inserted + result.updated} payslips are ready to check and publish.`);
      navigate(`/payroll/${id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="stack">
      <p>This makes a cutoff called <b>13th month pay {year}</b> with a payslip for each of the <b>{rows.length}</b> employees whose 13th month is worked out{skipped ? `, leaving out ${skipped} who still need a rate or rule` : ''}. Check it there, then publish it to the employees.</p>
      <TextField label="Pay date" type="date" value={pay} onChange={(e) => setPay(e.target.value)} hint="PD 851: on or before 24 December." />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-foot">
        {busy && <span className="muted small" role="status">{busy}</span>}
        <button className="btn btn-line" type="button" onClick={onClose}>Cancel</button>
        <button className="btn" type="button" aria-busy={Boolean(busy)} disabled={Boolean(busy)} onClick={create}>Create the payout</button>
      </div>
    </div>
  );
}
