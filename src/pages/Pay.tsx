import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate, fmtMoney } from '../lib/format';
import { useSites } from '../lib/refs';
import { compileLines, ruleFor, sampleRun, shiftSlots, timeLabel, VARIABLES, type FormulaLine, type NightRule, type PayRule } from '../lib/pay';
import { Badge, Dialog, Empty, ErrorState, Loading, SelectField, TextArea, TextField, useToast } from '../ui/kit';
import { useClients } from './Posts';

/* ---------------------------------------------------------------- shared */
export const NIGHT_RULES: { value: NightRule; label: string }[] = [
  { value: 'last_shift', label: 'Last shift of the day: 24-hour duties, and the shift from 6pm (12 hours) or 10pm (8 hours)' },
  { value: 'night_hours', label: 'Every hour worked from 10pm to 6am (Labor Code)' },
  { value: 'none', label: 'No night differential' },
];
export const nightShort = (r: Pick<PayRule, 'night_diff' | 'night_diff_hours'>) =>
  r.night_diff === 'last_shift' ? `Last shift, ${Number(r.night_diff_hours)} hours a duty` : r.night_diff === 'night_hours' ? '10pm to 6am, by the hour' : 'None';

const STANDARD_LINES: FormulaLine[] = [
  { code: 'basic', label: 'Basic pay', formula: 'rate * regular_hours', kind: 'earning', thirteenth: true },
  { code: 'overtime', label: 'Overtime pay', formula: 'rate * 125% * overtime_hours', kind: 'earning', thirteenth: false },
  { code: 'night_diff', label: 'Night differential', formula: 'rate * 10% * night_hours', kind: 'earning', thirteenth: false },
];
const DUTIES = [{ value: '8', label: '8 hours' }, { value: '12', label: '12 hours' }, { value: '24', label: '24 hours' }];
const hours = (n: number) => Number(n.toFixed(2)).toString();

export function usePayRules() {
  return useQuery({
    queryKey: ['pay-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pay_rules').select('*').order('name');
      if (error) throw error;
      return data as (PayRule & { notes: string | null })[];
    },
    staleTime: 30_000,
  });
}

interface RateRow { id: string; site_id: string | null; client_id: string | null; effective_from: string; hourly_rate: number; note: string | null }

/** The duty and shift a guard is deployed on, from the post's pattern. */
export function ShiftPicker({ firstStart, value, onChange }: { firstStart?: string | null; value: { duty: number; start: string }; onChange: (v: { duty: number; start: string }) => void }) {
  const first = firstStart ?? '06:00';
  const slots = shiftSlots(value.duty, first);
  const options = slots.map((s) => ({ value: s.start, label: `${s.label}${s.night ? ' · last shift' : ''}` }));
  if (!options.some((o) => o.value === value.start)) options.push({ value: value.start, label: `From ${timeLabel(value.start)}` });
  return (
    <div className="form-row">
      <SelectField label="Duty" value={String(value.duty)} options={DUTIES} onChange={(e) => { const duty = Number(e.target.value); onChange({ duty, start: shiftSlots(duty, first)[0].start }); }} />
      <SelectField label="Shift" value={value.start} options={options} onChange={(e) => onChange({ ...value, start: e.target.value })} />
    </div>
  );
}
export const defaultShift = (post?: { duty_hours?: number | null; first_shift_start?: string | null }) => ({ duty: post?.duty_hours ?? 12, start: (post?.first_shift_start ?? '06:00').slice(0, 5) });

/* ---------------------------------------------------------------- settings: pay rules and client rates */
export function PaySettings() {
  const { can } = useAuth();
  const rules = usePayRules();
  const clients = useClients();
  const [editing, setEditing] = useState<PayRule | 'new' | null>(null);
  const clientName = (id: string | null) => (id ? clients.data?.find((c) => c.id === id)?.name ?? 'Client' : 'All clients');
  const sorted = [...(rules.data ?? [])].sort((a, b) => (a.client_id ? 1 : 0) - (b.client_id ? 1 : 0) || clientName(a.client_id).localeCompare(clientName(b.client_id)) || a.name.localeCompare(b.name));
  return (
    <div className="stack">
      <div className="panel">
        <div className="panel-head">
          <h2>Pay rules</h2>
          {can.payroll && <button className="btn btn-sm" type="button" onClick={() => setEditing('new')}>Add a rule</button>}
        </div>
        <p className="muted small" style={{ padding: '0 16px 12px' }}>
          How a client's guards are paid: the formulas, who earns night differential, and the duty days in a month. A client's default rule covers all its posts unless a post picks another; posts of clients without a rule use the agency default. Each post keeps its own hourly rate.
        </p>
        {rules.isLoading ? <Loading /> : rules.error ? <ErrorState error={errorText(rules.error)} retry={() => rules.refetch()} /> : !sorted.length ? <Empty title="No pay rules yet" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Rule</th><th>Client</th><th>Night differential</th><th className="num">Regular hours</th><th className="num">Days a month</th><th className="num">Lines</th><th /></tr></thead>
              <tbody>{sorted.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b> {r.is_default && <Badge tone="info">{r.client_id ? 'Client default' : 'Agency default'}</Badge>}</td>
                  <td>{clientName(r.client_id)}</td>
                  <td>{nightShort(r)}</td>
                  <td className="num">{hours(Number(r.regular_hours))}</td>
                  <td className="num">{hours(Number(r.days_per_month))}</td>
                  <td className="num">{Array.isArray(r.formulas) ? r.formulas.length : 0}</td>
                  <td><button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(r)}>{can.payroll ? 'Edit' : 'View'}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <ClientRates />
      <Dialog open={Boolean(editing)} title={editing === 'new' ? 'Add a pay rule' : `Pay rule · ${(editing as PayRule | null)?.name ?? ''}`} onClose={() => setEditing(null)} wide>
        {editing && <RuleForm rule={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}

function RuleForm({ rule, onDone }: { rule?: PayRule; onDone: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const clients = useClients();
  const agency = Boolean(rule && rule.client_id === null && rule.is_default);
  const [v, setV] = useState({
    name: rule?.name ?? '', client_id: rule?.client_id ?? '', is_default: rule?.is_default ?? true, regular_hours: String(rule?.regular_hours ?? 8),
    night_diff: (rule?.night_diff ?? 'last_shift') as NightRule, night_diff_hours: String(rule?.night_diff_hours ?? 8), days_per_month: String(rule?.days_per_month ?? 26), notes: rule?.notes ?? '',
  });
  const [lines, setLines] = useState<FormulaLine[]>(rule && Array.isArray(rule.formulas) && rule.formulas.length ? rule.formulas : STANDARD_LINES);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const readOnly = !can.payroll;
  const compiled = useMemo(() => compileLines(lines), [lines]);
  const draft: PayRule = {
    id: rule?.id ?? 'draft', client_id: v.client_id || null, name: v.name, is_default: v.is_default, regular_hours: Number(v.regular_hours) || 8,
    night_diff: v.night_diff, night_diff_hours: Number(v.night_diff_hours) || 0, days_per_month: Number(v.days_per_month) || 26, formulas: lines,
  };
  const sample = sampleRun(draft);
  const setLine = (i: number, patch: Partial<FormulaLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, by: number) => {
    const next = [...lines];
    const [l] = next.splice(i, 1);
    next.splice(i + by, 0, l);
    setLines(next);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const reg = Number(v.regular_hours);
    const nd = Number(v.night_diff_hours);
    const dpm = Number(v.days_per_month);
    if (!v.name.trim()) return setError('Give the rule a name, for example the client\'s name.');
    if (!(reg > 0 && reg <= 24)) return setError('Regular hours a duty must be more than 0 and at most 24.');
    if (!(nd >= 0 && nd <= 8)) return setError('Night differential hours must be 0 to 8.');
    if (!(dpm > 0 && dpm <= 31)) return setError('Duty days a month must be more than 0 and at most 31.');
    if (!lines.length) return setError('Add at least one line, such as basic pay.');
    if (Object.keys(compiled.errors).length) return setError('Fix the lines marked below first.');
    const row = {
      name: v.name.trim(), client_id: agency ? null : v.client_id || null, is_default: agency ? true : v.is_default, regular_hours: reg, night_diff: v.night_diff,
      night_diff_hours: nd, days_per_month: dpm, notes: v.notes.trim() || null,
      formulas: lines.map((l) => ({ code: l.code.trim(), label: l.label.trim(), formula: l.formula.trim(), kind: l.kind ?? 'earning', thirteenth: Boolean(l.thirteenth) })),
    };
    setBusy(true);
    const res = rule ? await supabase.from('pay_rules').update(row).eq('id', rule.id) : await supabase.from('pay_rules').insert(row);
    setBusy(false);
    if (res.error) return setError(errorText(res.error));
    qc.invalidateQueries({ queryKey: ['pay-rules'] });
    toast('Pay rule saved.');
    onDone();
  };
  const remove = async () => {
    if (!rule || !confirm(`Delete the rule ${rule.name}? Posts that used it go back to their client's default rule.`)) return;
    const { error: err } = await supabase.from('pay_rules').delete().eq('id', rule.id);
    if (err) return setError(errorText(err));
    qc.invalidateQueries({ queryKey: ['pay-rules'] });
    toast('Pay rule deleted.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        <div className="form-row">
          <TextField label="Rule name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Acme Corp" />
          {agency ? <TextField label="Client" value="All clients without a rule" disabled readOnly /> : (
            <SelectField label="Client" value={v.client_id} onChange={(e) => setV({ ...v, client_id: e.target.value })} placeholder="Any client (agency rule)" options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          )}
        </div>
        {!agency && v.client_id && (
          <label className="row small"><input type="checkbox" checked={v.is_default} onChange={(e) => setV({ ...v, is_default: e.target.checked })} /> Default rule for this client's posts</label>
        )}
        <div className="form-row">
          <TextField label="Regular hours a duty" type="number" min="1" max="24" step="0.5" value={v.regular_hours} onChange={(e) => setV({ ...v, regular_hours: e.target.value })} hint="Hours past this count as overtime_hours." />
          <TextField label="Duty days a month" type="number" min="1" max="31" step="0.5" value={v.days_per_month} onChange={(e) => setV({ ...v, days_per_month: e.target.value })} hint="Fills the attendance sheet and works out the 13th month." />
        </div>
        <div className="form-row">
          <SelectField label="Night differential goes to" value={v.night_diff} onChange={(e) => setV({ ...v, night_diff: e.target.value as NightRule })} options={NIGHT_RULES} />
          {v.night_diff === 'last_shift' && <TextField label="Night hours a duty" type="number" min="0" max="8" step="0.5" value={v.night_diff_hours} onChange={(e) => setV({ ...v, night_diff_hours: e.target.value })} hint="The last guard of the day earns night_hours for this many hours." />}
        </div>

        <h3 style={{ margin: '8px 0 0' }}>Formula lines</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Each line is worked out for a guard's duty at one post, top to bottom, to the centavo. A line can use the codes of the lines above it. Write percentages as 10% or 0.10, and 1000 without a comma. Functions: min, max, round(x, 2), floor, ceil, abs, if(condition, then, else). Lines coded basic, overtime, night_diff, holiday or allowances fill those payslip columns; other lines show under their own name.
        </p>
        <div className="table-wrap">
          <table className="table formula-table">
            <thead><tr><th>Code</th><th>Name on the payslip</th><th>Formula</th><th>Type</th><th>13th month</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}>
                <td style={{ minWidth: 110 }}><input className="input" aria-label={`Line ${i + 1} code`} value={l.code} onChange={(e) => setLine(i, { code: e.target.value.toLowerCase() })} /></td>
                <td style={{ minWidth: 150 }}><input className="input" aria-label={`Line ${i + 1} name`} value={l.label} onChange={(e) => setLine(i, { label: e.target.value })} /></td>
                <td style={{ minWidth: 220, width: '40%' }}>
                  <input className="input code-input" aria-label={`Line ${i + 1} formula`} aria-invalid={compiled.errors[i] ? true : undefined} value={l.formula} onChange={(e) => setLine(i, { formula: e.target.value })} spellCheck={false} />
                  {compiled.errors[i] && <p className="field-error" role="alert">{compiled.errors[i]}</p>}
                </td>
                <td><select className="select" style={{ minWidth: 130 }} aria-label={`Line ${i + 1} type`} value={l.kind ?? 'earning'} onChange={(e) => setLine(i, { kind: e.target.value as 'earning' | 'deduction' })}><option value="earning">Earning</option><option value="deduction">Deduction</option></select></td>
                <td><input type="checkbox" aria-label={`Line ${i + 1} is basic pay for the 13th month`} checked={Boolean(l.thirteenth)} onChange={(e) => setLine(i, { thirteenth: e.target.checked })} /></td>
                <td>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <button className="link-btn" type="button" aria-label={`Move line ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>Up</button>
                    <button className="link-btn" type="button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
                  </span>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!readOnly && <div><button className="btn btn-line btn-sm" type="button" onClick={() => setLines([...lines, { code: '', label: '', formula: '', kind: 'earning', thirteenth: false }])}>Add a line</button></div>}
        <details>
          <summary>Names a formula can use</summary>
          <dl className="dl">{VARIABLES.map((x) => <Fragment key={x.name}><dt className="code">{x.name}</dt><dd>{x.meaning}</dd></Fragment>)}</dl>
        </details>
        <div className="callout">
          <b>Example: ₱100.00 an hour, 13 duties of 12 hours from 6:00 PM</b>
          <p className="small muted" style={{ margin: '4px 0 8px' }}>
            regular_hours {hours(sample.vars.regular_hours)} · overtime_hours {hours(sample.vars.overtime_hours)} · night_hours {hours(sample.vars.night_hours)}
          </p>
          {sample.lines.length ? (
            <table className="table">
              <tbody>{sample.lines.map((l) => <tr key={l.code}><td>{l.label}{l.thirteenth && <span className="muted small"> · 13th month</span>}</td><td className="num tabular">{l.kind === 'deduction' ? `less ${fmtMoney(l.amount)}` : fmtMoney(l.amount)}</td></tr>)}</tbody>
            </table>
          ) : <p className="small" style={{ margin: 0 }}>{Object.values(sample.errors)[0] ?? 'Add a line to see the example.'}</p>}
        </div>
        <TextArea label="Notes" optional rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </fieldset>
      {!readOnly && (
        <div className="form-foot">
          {rule && !agency && <button className="btn btn-ghost" type="button" onClick={remove}>Delete the rule</button>}
          <button className="btn" type="submit" aria-busy={busy}>Save the rule</button>
        </div>
      )}
    </form>
  );
}

function ClientRates() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const clients = useClients();
  const q = useQuery({
    queryKey: ['client-rates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('pay_rates').select('*').not('client_id', 'is', null).order('effective_from', { ascending: false });
      if (error) throw error;
      return data as RateRow[];
    },
  });
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!f.client_id || !f.effective_from || !(Number(f.hourly_rate) > 0)) return toast('Choose the client, the first day and an hourly rate above 0.', 'error');
    const { error } = await supabase.from('pay_rates').insert({ client_id: f.client_id, effective_from: f.effective_from, hourly_rate: Number(f.hourly_rate), note: f.note.trim() || null });
    if (error) return toast(error.code === '23505' ? 'This client already has a rate from that day.' : errorText(error), 'error');
    form.reset();
    qc.invalidateQueries({ queryKey: ['client-rates'] });
    toast('Client rate added.');
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this rate?')) return;
    const { error } = await supabase.from('pay_rates').delete().eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['client-rates'] });
  };
  const name = (id: string | null) => clients.data?.find((c) => c.id === id)?.name ?? '';
  return (
    <div className="grid grid-2">
      <div className="panel">
        <div className="panel-head"><h2>Client rates</h2></div>
        <p className="muted small" style={{ padding: '0 16px 12px' }}>For posts without a rate of their own. A post's own rate always comes first; set those on the post's page.</p>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} /> : !q.data?.length ? <Empty title="No client rates" /> : (
          <table className="table">
            <thead><tr><th>Client</th><th>From</th><th className="num">Hourly rate</th>{can.payroll && <th />}</tr></thead>
            <tbody>{[...q.data].sort((a, b) => name(a.client_id).localeCompare(name(b.client_id)) || b.effective_from.localeCompare(a.effective_from)).map((r) => (
              <tr key={r.id}>
                <td><b>{name(r.client_id)}</b>{r.note && <span className="cell-sub">{r.note}</span>}</td>
                <td className="tabular">{fmtDate(r.effective_from)}</td>
                <td className="num">{fmtMoney(r.hourly_rate)}</td>
                {can.payroll && <td><button className="link-btn" type="button" onClick={() => remove(r.id)}>Remove</button></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {can.payroll && (
        <form className="panel panel-pad form" onSubmit={add}>
          <h2>Add a client rate</h2>
          <SelectField label="Client" name="client_id" placeholder="Choose a client" options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
          <div className="form-row">
            <TextField label="From" name="effective_from" type="date" />
            <TextField label="Hourly rate (₱)" name="hourly_rate" type="number" min="0.01" step="0.01" />
          </div>
          <TextField label="Note" name="note" optional placeholder="2026 contract" />
          <div className="form-foot"><button className="btn" type="submit">Add the rate</button></div>
        </form>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the post's pay: rule, duty pattern, rates */
export function PostPay({ site }: { site: { id: string; name: string; client_id: string | null; pay_rule_id: string | null; duty_hours: number; first_shift_start: string } }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const rules = usePayRules();
  const rates = useQuery({
    queryKey: ['post-rates', site.id, site.client_id],
    queryFn: async () => {
      const own = await supabase.from('pay_rates').select('*').eq('site_id', site.id).order('effective_from', { ascending: false });
      if (own.error) throw own.error;
      let client: RateRow[] = [];
      if (site.client_id) {
        const c = await supabase.from('pay_rates').select('*').eq('client_id', site.client_id).order('effective_from', { ascending: false });
        if (c.error) throw c.error;
        client = c.data as RateRow[];
      }
      return { own: own.data as RateRow[], client };
    },
  });
  const rule = ruleFor(site, rules.data ?? []);
  const choices = (rules.data ?? []).filter((r) => r.client_id === null || r.client_id === site.client_id);
  const clientDefault = ruleFor({ ...site, pay_rule_id: null }, rules.data ?? []);
  const pickRule = async (id: string) => {
    const { error } = await supabase.rpc('set_site_pay_rule', { p_site_id: site.id, p_pay_rule_id: id || null });
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['site', site.id] });
    toast('Pay rule set for this post.');
  };
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!f.effective_from || !(Number(f.hourly_rate) > 0)) return toast('Enter the first day and an hourly rate above 0.', 'error');
    const { error } = await supabase.from('pay_rates').insert({ site_id: site.id, effective_from: f.effective_from, hourly_rate: Number(f.hourly_rate), note: f.note.trim() || null });
    if (error) return toast(error.code === '23505' ? 'This post already has a rate from that day.' : errorText(error), 'error');
    form.reset();
    qc.invalidateQueries({ queryKey: ['post-rates', site.id] });
    toast('Rate added.');
  };
  const remove = async (id: string) => {
    if (!confirm('Remove this rate?')) return;
    const { error } = await supabase.from('pay_rates').delete().eq('id', id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['post-rates', site.id] });
  };
  const own = rates.data?.own ?? [];
  const client = rates.data?.client ?? [];
  const reg = Number(rule?.regular_hours ?? 8);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Pay at this post</h2></div>
      <div className="grid grid-2" style={{ padding: '0 16px 16px' }}>
        <div className="stack">
          {can.payroll ? (
            <SelectField label="Pay rule" value={site.pay_rule_id ?? ''} onChange={(e) => pickRule(e.target.value)} placeholder={clientDefault ? `The client's default: ${clientDefault.name}` : 'The client\'s default'} options={choices.map((r) => ({ value: r.id, label: r.name }))} />
          ) : <p><b>Pay rule:</b> {rule?.name ?? 'None'}</p>}
          {rule ? (
            <dl className="dl">
              <dt>Night differential</dt><dd>{nightShort(rule)}</dd>
              <dt>Regular hours</dt><dd>{hours(reg)} a duty</dd>
              <dt>Duty days</dt><dd>{hours(Number(rule.days_per_month))} a month</dd>
              <dt>Shifts</dt><dd>{shiftSlots(site.duty_hours, site.first_shift_start).map((s) => `${s.label}${s.night && rule.night_diff === 'last_shift' ? ' (night differential)' : ''}`).join(' · ')}</dd>
            </dl>
          ) : <p className="callout warn">No pay rule applies. Add an agency default rule in Settings.</p>}
          <p className="muted small">Operations sets the duty pattern when editing the post. <Link to="/settings">Pay rules are in Settings.</Link></p>
        </div>
        <div className="stack">
          {rates.isLoading ? <Loading /> : rates.error ? <ErrorState error={errorText(rates.error)} /> : (
            <>
              {own.length ? (
                <table className="table">
                  <thead><tr><th>From</th><th className="num">Hourly rate</th><th className="num">A regular duty</th>{can.payroll && <th />}</tr></thead>
                  <tbody>{own.map((r) => (
                    <tr key={r.id}>
                      <td className="tabular">{fmtDate(r.effective_from)}{r.note && <span className="cell-sub">{r.note}</span>}</td>
                      <td className="num">{fmtMoney(r.hourly_rate)}</td>
                      <td className="num">{fmtMoney(Number(r.hourly_rate) * reg)}</td>
                      {can.payroll && <td><button className="link-btn" type="button" onClick={() => remove(r.id)}>Remove</button></td>}
                    </tr>
                  ))}</tbody>
                </table>
              ) : client.length ? (
                <p className="callout">This post uses its client's rate: <b>{fmtMoney(client[0].hourly_rate)}</b> an hour from {fmtDate(client[0].effective_from)}.</p>
              ) : <p className="callout warn">No hourly rate yet, so pay and the 13th month cannot be worked out for this post.</p>}
              {can.payroll && (
                <form className="form" onSubmit={add}>
                  <div className="form-row">
                    <TextField label="New rate from" name="effective_from" type="date" />
                    <TextField label="Hourly rate (₱)" name="hourly_rate" type="number" min="0.01" step="0.01" />
                  </div>
                  <TextField label="Note" name="note" optional placeholder="Wage order, contract renewal" />
                  <div className="form-foot"><button className="btn btn-sm" type="submit">Add the rate</button></div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- an employee's assignment history */
interface AssignmentRow { id: string; site_id: string; start_date: string; end_date: string | null; duty_hours: number; shift_start: string; note: string | null; site: { name: string } | null }

export function AssignmentHistory({ employeeId }: { employeeId: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AssignmentRow | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['assignments', employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from('employee_assignments').select('id,site_id,start_date,end_date,duty_hours,shift_start,note,site:sites(name)').eq('employee_id', employeeId).order('start_date', { ascending: false });
      if (error) throw error;
      return data as unknown as AssignmentRow[];
    },
  });
  const edit = can.hr || can.ops;
  const remove = async (a: AssignmentRow) => {
    if (!confirm(`Remove ${a.site?.name ?? 'this assignment'} from ${fmtDate(a.start_date)} from the history?`)) return;
    const { error } = await supabase.from('employee_assignments').delete().eq('id', a.id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['assignments', employeeId] });
  };
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head"><h2>Assignment history</h2>{edit && <button className="btn btn-line btn-sm" type="button" onClick={() => setEditing('new')}>Add an assignment</button>}</div>
      <p className="muted small" style={{ padding: '0 16px 12px' }}>Pay for a cutoff and the 13th month follow these dates and each post's rate. Deploying adds a line here; correct past ones when needed.</p>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} /> : !q.data?.length ? <Empty title="No assignments yet">Deploy the employee to a post to start the history.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Post</th><th>From</th><th>To</th><th>Duty</th><th>Shift</th>{edit && <th />}</tr></thead>
            <tbody>{q.data.map((a) => (
              <tr key={a.id}>
                <td><Link className="cell-main" to={`/posts/${a.site_id}`}>{a.site?.name ?? 'Post'}</Link>{a.note && <span className="cell-sub">{a.note}</span>}</td>
                <td className="tabular">{fmtDate(a.start_date)}</td>
                <td className="tabular">{a.end_date ? fmtDate(a.end_date) : <Badge tone="ok">Now</Badge>}</td>
                <td>{a.duty_hours} hours</td>
                <td>{shiftSlots(a.duty_hours, a.shift_start).find((s) => s.start === a.shift_start.slice(0, 5))?.label ?? `From ${timeLabel(a.shift_start)}`}</td>
                {edit && <td><span className="row"><button className="link-btn" type="button" onClick={() => setEditing(a)}>Edit</button><button className="link-btn" type="button" onClick={() => remove(a)}>Remove</button></span></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(editing)} title={editing === 'new' ? 'Add an assignment' : 'Edit the assignment'} onClose={() => setEditing(null)}>
        {editing && <AssignmentForm employeeId={employeeId} a={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['assignments', employeeId] }); }} />}
      </Dialog>
    </div>
  );
}

function AssignmentForm({ employeeId, a, onDone }: { employeeId: string; a?: AssignmentRow; onDone: () => void }) {
  const toast = useToast();
  const sites = useSites();
  const [v, setV] = useState({ site_id: a?.site_id ?? '', start_date: a?.start_date ?? '', end_date: a?.end_date ?? '', note: a?.note ?? '' });
  const [shift, setShift] = useState({ duty: a?.duty_hours ?? 12, start: (a?.shift_start ?? '06:00').slice(0, 5) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const post = sites.data?.find((s) => s.id === v.site_id);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.site_id || !v.start_date) return setError('Choose the post and the first day.');
    if (v.end_date && v.end_date < v.start_date) return setError('The last day is before the first day.');
    const row = { employee_id: employeeId, site_id: v.site_id, start_date: v.start_date, end_date: v.end_date || null, duty_hours: shift.duty, shift_start: shift.start, note: v.note.trim() || null };
    setBusy(true);
    const res = a ? await supabase.from('employee_assignments').update(row).eq('id', a.id) : await supabase.from('employee_assignments').insert(row);
    setBusy(false);
    if (res.error) return setError(errorText(res.error));
    toast('Assignment saved.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SelectField label="Post" value={v.site_id} placeholder="Choose a post" options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        onChange={(e) => { const p = sites.data?.find((s) => s.id === e.target.value); setV({ ...v, site_id: e.target.value }); if (p && !a) setShift(defaultShift(p)); }} />
      <div className="form-row">
        <TextField label="From" type="date" value={v.start_date} onChange={(e) => setV({ ...v, start_date: e.target.value })} />
        <TextField label="To" type="date" optional value={v.end_date} onChange={(e) => setV({ ...v, end_date: e.target.value })} hint="Leave empty while the employee is still there." />
      </div>
      <ShiftPicker firstStart={post?.first_shift_start} value={shift} onChange={setShift} />
      <TextField label="Note" optional value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
      <p className="muted small">This corrects the history only. To move the employee now, use Deploy.</p>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Save</button></div>
    </form>
  );
}
