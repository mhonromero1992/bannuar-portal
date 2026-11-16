import { Fragment, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtMoney, todayManila } from '../lib/format';
import { roundTo, thirteenthFromPayroll, toCsv, uncovered, type ThirteenthRow } from '../lib/pay';
import { downloadFile, loadPayInputs, loadPeople, loadReleased, savePayslips } from '../lib/payData';
import { Dialog, Empty, ErrorState, Loading, PageHead, Search, SelectField, Tabs, TextField, useDebounced, useToast } from '../ui/kit';
import { ThirteenthTimeline } from './thirteenthTimeline';

const SHOW = 200;
type View = 'timeline' | 'list';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 1": the page already names the year. */
const dayMonth = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const span = (g: { from: string; to: string }) => (g.from === g.to ? dayMonth(g.from) : `${dayMonth(g.from)} to ${dayMonth(g.to)}`);

/**
 * 13th month pay for a year (PD 851): a twelfth of the basic pay earned. What published cutoffs
 * released counts first, post by post; the days no published cutoff covers yet are projected from the
 * assignments, marked as projected, so the payout on 24 December can be complete.
 */
export default function ThirteenthMonth() {
  const thisYear = Number(todayManila().slice(0, 4));
  const [params, setParams] = useSearchParams();
  // the timeline first; the list is its table twin (?view=list keeps it on reload and in a shared link)
  const view: View = params.get('view') === 'list' ? 'list' : 'timeline';
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'list') next.set('view', 'list');
    else next.delete('view');
    setParams(next, { replace: true });
  };
  const [year, setYear] = useState(thisYear);
  const [text, setText] = useState('');
  const s = useDebounced(text).trim().toLowerCase();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ['thirteenth', year],
    queryFn: async () => {
      const [d, released] = await Promise.all([loadPayInputs(`${year}-01-01`, `${year}-12-31`), loadReleased(year)]);
      // a guard paid this year but with no assignment in it any more still counts
      const known = new Set(d.people.map((p) => p.id));
      const missing = [...new Set(released.rows.map((r) => r.employee_id))].filter((id) => !known.has(id));
      const people = missing.length ? [...d.people, ...(await loadPeople('id', missing))] : d.people;
      const list = thirteenthFromPayroll(year, released, people, d.assignments, d.posts, d.rules, d.rates).sort((a, b) => a.person.name.localeCompare(b.person.name));
      return { list, cutoffs: released.cutoffs, gaps: uncovered(year, released.cutoffs) };
    },
    // another year keeps the last one on screen, dimmed, until it arrives
    placeholderData: (prev) => prev,
  });
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const all = q.data?.list ?? [];
  const rows = useMemo(() => all.filter((r) => !s || r.person.name.toLowerCase().includes(s) || r.person.employee_no.toLowerCase().includes(s)), [all, s]);
  const ready = all.filter((r) => !r.problems.length && r.amount > 0);
  const blocked = all.filter((r) => r.problems.length);
  const add = (key: 'amount' | 'released' | 'projected') => all.filter((r) => !r.problems.length).reduce((t, r) => t + r[key], 0);
  const cutoffs = q.data?.cutoffs ?? [];
  const gaps = q.data?.gaps ?? [];
  const csv = () => toCsv(all.flatMap((r) => r.pieces.map((p) => ({
    employee_no: r.person.employee_no, name: r.person.name, source: p.kind, post: p.post, from: p.from, to: p.to,
    published_cutoffs: p.kind === 'released' ? p.cutoffs : '', hourly_rate: p.rate ?? '', scheduled_duty_days: p.kind === 'projected' ? roundTo(p.days, 2) : '',
    basic_pay: p.basic, thirteenth_month: p.share, employee_total: r.amount, problem: p.problem ?? '',
  }))));
  return (
    <>
      <Link className="back" to="/payroll">← Payroll</Link>
      <PageHead
        title="13th month pay"
        intro="A twelfth of the basic pay earned in the year (PD 851): what published cutoffs paid, post by post, plus the days no published cutoff covers yet, projected from each guard's assignment. Due on or before 24 December."
        actions={<>
          <button className="btn btn-line" type="button" disabled={!all.length} onClick={() => downloadFile(`13th month ${year}.csv`, csv())}>Download (CSV)</button>
          <button className="btn" type="button" disabled={!ready.length} onClick={() => setPaying(true)}>Create the payout cutoff</button>
        </>}
      />
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="label">From released payroll</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(add('released'))}</span>
          <span className="muted small">{cutoffs.length ? `${cutoffs.length} published ${cutoffs.length === 1 ? 'cutoff' : 'cutoffs'}, ${dayMonth(cutoffs[0].from)} to ${dayMonth(cutoffs[cutoffs.length - 1].to)}` : `No published cutoff in ${year} yet`}</span></div>
        <div className="tile"><span className="label">Projected</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(add('projected'))}</span>
          <span className="muted small">{gaps.length ? `${gaps.map(span).join(', ')}, not paid yet` : 'Nothing left to project'}</span></div>
        <div className="tile night on-night"><span className="label">13th month, {year}</span><span className="big" style={{ fontSize: 26 }}>{fmtMoney(add('amount'))}</span><span className="muted small">{all.length} employees</span></div>
        <div className="tile"><span className="label">To fix first</span><span className="big">{blocked.length}</span></div>
      </div>
      {blocked.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 16 }} role="alert"><b>{blocked.length} employees need a rate or rule first:</b>
          <ul>{blocked.slice(0, 8).map((r) => <li key={r.person.id}><Link to={`/employees/${r.person.id}`}>{r.person.name}</Link>: {r.problems[0]}</li>)}</ul>
        </div>
      )}
      <Tabs label="View" tabs={[{ id: 'timeline', label: 'Timeline' }, { id: 'list', label: 'List' }]} value={view} onChange={setView} />
      <div className="panel">
        <div className="toolbar">
          <Search value={text} onChange={setText} label="Search by name or employee number" />
          <SelectField label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
        {q.isLoading ? <Loading what="Working out the 13th month" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !rows.length ? (
          <Empty title={s ? 'Nobody matches' : `No released payroll or assignments in ${year}`}>{s ? 'Check the spelling, or search by employee number.' : 'The 13th month counts the basic pay on published cutoffs, and projects the rest of the year from the assignments on each employee\'s Deployment tab.'}</Empty>
        ) : view === 'timeline' ? (
          <ThirteenthTimeline
            year={year}
            rows={rows.slice(0, SHOW)}
            allRows={all}
            open={open}
            onToggle={toggle}
            renderBreakdown={(r) => <Breakdown r={r} />}
            stale={q.isPlaceholderData}
          />
        ) : (
          <div className={`table-wrap${q.isPlaceholderData ? ' is-stale' : ''}`}>
            <table className="table">
              <thead><tr><th>Employee</th><th>Posts in {year}</th><th className="num">Released</th><th className="num">Projected</th><th className="num">13th month</th><th /></tr></thead>
              <tbody>{rows.slice(0, SHOW).map((r) => (
                <Fragment key={r.person.id}>
                  <tr>
                    <td><Link className="cell-main" to={`/employees/${r.person.id}`}>{r.person.name}</Link><span className="cell-sub tabular">{r.person.employee_no}</span></td>
                    <td>{[...new Set(r.pieces.map((p) => p.post))].join(', ')}</td>
                    <td className="num">{fmtMoney(r.released)}</td>
                    <td className="num">{fmtMoney(r.projected)}</td>
                    <td className="num"><b>{r.problems.length ? <span className="muted">Not yet</span> : fmtMoney(r.amount)}</b></td>
                    <td><button className="link-btn" type="button" aria-expanded={open === r.person.id} onClick={() => toggle(r.person.id)}>{open === r.person.id ? 'Hide' : 'How'}</button></td>
                  </tr>
                  {open === r.person.id && (
                    <tr><td colSpan={6}><Breakdown r={r} /></td></tr>
                  )}
                </Fragment>
              ))}</tbody>
            </table>
          </div>
        )}
        {rows.length > SHOW && <p className="pager">Showing {SHOW} of {rows.length}. Search to find one employee; the download has everyone.</p>}
      </div>
      <Dialog open={paying} title={`Create the 13th month payout · ${year}`} onClose={() => setPaying(false)}>
        {paying && <Payout year={year} rows={ready} gaps={gaps} skipped={blocked.length} onClose={() => setPaying(false)} />}
      </Dialog>
    </>
  );
}

function Breakdown({ r }: { r: ThirteenthRow }) {
  return (
    <div className="stack" style={{ padding: '4px 0 8px' }}>
      <table className="table">
        <thead><tr><th>Post</th><th>From</th><th>To</th><th>Counted from</th><th className="num">Basic pay</th><th className="num">13th month</th></tr></thead>
        <tbody>
          {r.pieces.map((p, i) => (
            <tr key={i}>
              <td>{p.post}{p.problem && <span className="cell-sub" style={{ color: 'var(--red)' }}>{p.problem}</span>}</td>
              <td className="tabular">{fmtDate(p.from)}</td><td className="tabular">{fmtDate(p.to)}</td>
              <td>{p.kind === 'released'
                ? <><span className="badge ok">Released</span> <span className="small">{p.cutoffs} published {p.cutoffs === 1 ? 'cutoff' : 'cutoffs'}</span></>
                : <><span className="badge info">Projected</span> <span className="small">{roundTo(p.days, 2)} duty days{p.rate === null ? '' : ` at ${fmtMoney(p.rate)} an hour`}</span></>}</td>
              <td className="num">{fmtMoney(p.basic)}</td><td className="num">{fmtMoney(p.share)}</td>
            </tr>
          ))}
          <tr><td colSpan={4}><b>Total</b>{r.projected > 0 && <span className="muted small"> · released {fmtMoney(r.released)}, projected {fmtMoney(r.projected)}</span>}</td><td className="num"><b>{fmtMoney(r.basic)}</b></td><td className="num"><b>{fmtMoney(r.amount)}</b></td></tr>
        </tbody>
      </table>
      <p className="muted small">Released basic pay is what published cutoffs paid at each post: the lines its pay rule marks "13th month", and paid leave. Projected basic pay is the rule's basic pay lines for its duty days a month (hourly rate × regular hours × duty days), for the days no published cutoff covers yet. The 13th month is a twelfth of each, added up.</p>
    </div>
  );
}

function Payout({ year, rows, gaps, skipped, onClose }: { year: number; rows: ThirteenthRow[]; gaps: { from: string; to: string }[]; skipped: number; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [pay, setPay] = useState(`${year}-12-24`);
  const [projected, setProjected] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const amountOf = (r: ThirteenthRow) => (projected ? r.amount : r.released);
  const paid = rows.filter((r) => amountOf(r) > 0);
  const total = paid.reduce((t, r) => t + amountOf(r), 0);
  const create = async () => {
    setError('');
    if (!pay) return setError('Choose the pay date.');
    setBusy('Creating the cutoff…');
    try {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const found = await supabase.from('payroll_periods').select('id,status').eq('kind', 'thirteenth_month').eq('period_start', from).eq('period_end', to).maybeSingle();
      if (found.error) throw found.error;
      if (found.data && found.data.status !== 'draft') throw new Error('The 13th month cutoff for this year is already published. Unpublish it on the Payroll page to replace its payslips.');
      let id = found.data?.id as string | undefined;
      if (!id) {
        const made = await supabase.from('payroll_periods').insert({ period_start: from, period_end: to, pay_date: pay, label: `13th month pay ${year}`, kind: 'thirteenth_month' }).select('id').single();
        if (made.error) throw made.error;
        id = made.data.id as string;
      }
      const lines = paid.map((r) => {
        const pieces = r.pieces.filter((p) => projected || p.kind === 'released');
        return {
          employee_no: r.person.employee_no,
          site_name: [...new Set(pieces.map((p) => p.post))].join(', '),
          'earning: 13th month pay': amountOf(r),
          remarks: pieces.map((p) => `${p.post}, ${fmtDate(p.from)} to ${fmtDate(p.to)} (${p.kind}): ${fmtMoney(p.share)}`).join('; '),
        };
      });
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
  const days = (g: { from: string; to: string }) => (g.from === g.to ? fmtDate(g.from) : `${fmtDate(g.from)} to ${fmtDate(g.to)}`);
  return (
    <div className="stack">
      <p>This makes a cutoff called <b>13th month pay {year}</b> with a payslip for each of the <b>{paid.length}</b> employees, {fmtMoney(total)} in all{skipped ? `, leaving out ${skipped} who still need a rate or rule` : ''}. Check it there, then publish it to the employees.</p>
      {gaps.length > 0 && (
        <label className="check" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={projected} onChange={(e) => setProjected(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Include the projected days ({gaps.map(days).join(', ')}), so the payout is complete on the pay date. Leave it off to pay only what published cutoffs released, and settle the rest after the year's last cutoff.</span>
        </label>
      )}
      <TextField label="Pay date" type="date" value={pay} onChange={(e) => setPay(e.target.value)} hint="PD 851: on or before 24 December." />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-foot">
        {busy && <span className="muted small" role="status">{busy}</span>}
        <button className="btn btn-line" type="button" onClick={onClose}>Cancel</button>
        <button className="btn" type="button" aria-busy={Boolean(busy)} disabled={Boolean(busy) || !paid.length} onClick={create}>Create the payout</button>
      </div>
    </div>
  );
}
