import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtDateTime, fullName, todayManila } from '../lib/format';
import { CASE_DECISION, CASE_STATUS, GRAVITY, options } from '../lib/labels';
import {
  codePenalty, defaultExplainBy, fillDraft, manilaIso, ordinal, penaltyText, suggestForCase, RULE_COLUMNS, type OffenseRule, type Suggestion,
} from '../lib/discipline';
import { Badge, Dialog, ErrorState, Loading, SelectField, StatusBadge, TextArea, TextField, useToast } from '../ui/kit';

export interface CaseRow {
  id: string; case_no: string; status: string; employee_id: string; incident_id: string | null; rule_id: string | null; offense_no: number | null;
  facts: string; nte_text: string | null; nte_issued_at: string | null; explain_by: string | null; nte_received_at: string | null;
  explanation: string | null; explanation_via: string | null; explained_at: string | null; wants_hearing: boolean;
  hearing_at: string | null; hearing_place: string | null; hearing_notes: string | null; hearing_held_at: string | null;
  decision: string | null; suspension_days: number | null; suspension_from: string | null; decision_text: string | null; departs_reason: string | null;
  decided_at: string | null; decision_received_at: string | null; preventive_from: string | null; preventive_to: string | null; preventive_reason: string | null;
  withdrawn_reason: string | null; ai_suggestion: Suggestion | null; ai_suggested_at: string | null; created_at: string;
  employee: { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; site: { name: string } | null } | null;
  rule: Pick<OffenseRule, 'id' | 'ref' | 'title' | 'gravity' | 'penalties'> | null;
  incident: { report_no: string; title: string } | null;
}
export const CASE_SELECT =
  '*,employee:employees!disciplinary_cases_employee_id_fkey(id,employee_no,first_name,middle_name,last_name,suffix,site:sites!employees_site_id_fkey(name)),' +
  'rule:offense_rules(id,ref,title,gravity,penalties),incident:incident_reports(report_no,title)';

/** What the case waits for, in one line. */
export function nextStep(c: Pick<CaseRow, 'status' | 'explain_by' | 'wants_hearing' | 'hearing_at' | 'hearing_held_at' | 'decision'>, now = Date.now()): string {
  switch (c.status) {
    case 'draft': return 'Issue the notice to explain';
    case 'nte_issued': return c.explain_by && Date.parse(c.explain_by) > now ? `Explanation due ${fmtDateTime(c.explain_by)}` : 'No explanation came: hold a conference or decide';
    case 'explained': return c.wants_hearing ? 'Set the hearing the employee asked for' : 'Decide, or set a conference';
    case 'hearing_set': return c.hearing_held_at ? 'Decide' : `Hearing ${fmtDateTime(c.hearing_at)}`;
    case 'decided': return 'Closed';
    default: return 'Withdrawn';
  }
}

export function CaseView({ caseId, onClose }: { caseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['discipline-case', caseId],
    queryFn: async () => {
      const { data, error } = await supabase.from('disciplinary_cases').select(CASE_SELECT).eq('id', caseId).single();
      if (error) throw error;
      return data as unknown as CaseRow;
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['discipline-case', caseId] });
    qc.invalidateQueries({ queryKey: ['discipline-cases'] });
    qc.invalidateQueries({ queryKey: ['incident-reports'] });
  };
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;
  const c = q.data;
  const name = c.employee ? fullName(c.employee) : 'The employee';
  const pen = codePenalty(c.rule, c.offense_no);
  return (
    <div className="stack">
      <dl className="dl">
        <dt>Employee</dt><dd>{name} · <span className="tabular">{c.employee?.employee_no}</span>{c.employee?.site ? ` · ${c.employee.site.name}` : ''}</dd>
        <dt>Status</dt><dd><StatusBadge map={CASE_STATUS} value={c.status} /> <span className="muted small">{nextStep(c)}</span></dd>
        {c.incident && <><dt>From report</dt><dd>{c.incident.report_no}: {c.incident.title}</dd></>}
        <dt>Charge</dt>
        <dd>{c.rule ? <>{c.rule.ref} {c.rule.title} <StatusBadge map={GRAVITY} value={c.rule.gravity} /> · {ordinal(c.offense_no ?? 1)} offense · the code says: <b>{penaltyText(pen)}</b></> : <span className="muted">No rule chosen yet</span>}</dd>
      </dl>
      {c.status === 'draft' ? <DraftStep c={c} name={name} onSaved={refresh} /> : <Step n={1} title="Notice to explain" done>
        <p className="pre">{c.nte_text}</p>
        <p className="muted small">Issued {fmtDateTime(c.nte_issued_at)} · answer by {fmtDateTime(c.explain_by)} · {c.nte_received_at ? `received ${fmtDateTime(c.nte_received_at)}` : 'not yet opened in the app'}</p>
      </Step>}
      {c.status !== 'draft' && <ExplanationStep c={c} onSaved={refresh} />}
      {c.status !== 'draft' && <HearingStep c={c} onSaved={refresh} />}
      {c.status !== 'draft' && <DecisionStep c={c} onSaved={refresh} />}
      {['nte_issued', 'explained', 'hearing_set'].includes(c.status) && <PreventiveStep c={c} onSaved={refresh} />}
      {c.status === 'withdrawn' && <p className="callout">Withdrawn: {c.withdrawn_reason}</p>}
      {!['decided', 'withdrawn'].includes(c.status) && <Withdraw caseId={c.id} onDone={() => { refresh(); onClose(); }} />}
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="panel panel-pad stack" aria-label={title}>
      <h3 className="section-title">{n}. {title} {done && <Badge tone="ok">Done</Badge>}</h3>
      {children}
    </section>
  );
}

function useRules() {
  return useQuery({
    queryKey: ['active-rules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('offense_rules').select(`${RULE_COLUMNS},code:discipline_codes!inner(status)`)
        .eq('status', 'approved').eq('code.status', 'active').order('sort');
      if (error) throw error;
      return data as unknown as OffenseRule[];
    },
    staleTime: 60_000,
  });
}

/** The charge and the notice: the rule, the facts, Claude's suggestion if wanted, then the notice itself. */
function DraftStep({ c, name, onSaved }: { c: CaseRow; name: string; onSaved: () => void }) {
  const toast = useToast();
  const rules = useRules();
  const [v, setV] = useState({ rule: c.rule_id ?? '', offense: c.offense_no ? String(c.offense_no) : '', facts: c.facts });
  const [nte, setNte] = useState('');
  const [by, setBy] = useState(defaultExplainBy());
  const [suggestion, setSuggestion] = useState<Suggestion | null>(c.ai_suggestion);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const chosen = (rules.data ?? []).find((r) => r.id === v.rule) ?? null;
  const fill = (draft: string) => fillDraft(draft, {
    employee_name: name, case_no: c.case_no, post: c.employee?.site?.name ?? '',
    explain_by: by ? fmtDateTime(manilaIso(by)) : '', rule: chosen ? `${chosen.ref} ${chosen.title}`.trim() : '',
  });
  const save = async () => {
    setError('');
    setBusy('save');
    const { error: err } = await supabase.rpc('update_case_draft', { p_case_id: c.id, p_rule_id: v.rule || null, p_offense_no: v.offense ? Number(v.offense) : null, p_facts: v.facts });
    setBusy('');
    if (err) return setError(errorText(err));
    toast('Saved.');
    onSaved();
  };
  const ask = async () => {
    setError('');
    setBusy('ai');
    try {
      setSuggestion(await suggestForCase(c.id));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const issue = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!c.rule_id || c.rule_id !== v.rule || v.facts !== c.facts) return setError('Save the charge first.');
    if (!by) return setError('Give the deadline for the explanation.');
    if (!window.confirm(`Issue this notice to ${name}? They are told in the app, and the charge can no longer change.`)) return;
    setBusy('issue');
    const { error: err } = await supabase.rpc('issue_nte', { p_case_id: c.id, p_nte_text: nte, p_explain_by: manilaIso(by) });
    setBusy('');
    if (err) return setError(errorText(err));
    toast('Notice issued. The employee is told in the app.');
    onSaved();
  };
  return (
    <>
      <Step n={1} title="The charge">
        {error && <p className="form-error" role="alert">{error}</p>}
        <SelectField label="Rule of the Code of Discipline" value={v.rule} onChange={(e) => setV({ ...v, rule: e.target.value, offense: '' })}
          placeholder={rules.data?.length ? 'Choose the rule' : 'No code in force yet'}
          options={(rules.data ?? []).map((r) => ({ value: r.id, label: `${r.ref ? `${r.ref} · ` : ''}${r.title}` }))} />
        <div className="form-row">
          <TextField label="Offense count" optional hint="Left empty, the database counts the earlier findings" type="number" min={1} max={10} value={v.offense} onChange={(e) => setV({ ...v, offense: e.target.value })} />
          {chosen && <p className="muted small">The code says for this offense: <b>{penaltyText(codePenalty(chosen, v.offense ? Number(v.offense) : c.offense_no))}</b></p>}
        </div>
        <TextArea label="The facts: what happened, when and where" value={v.facts} onChange={(e) => setV({ ...v, facts: e.target.value })} />
        <div className="row">
          <button className="btn btn-line" type="button" onClick={save} aria-busy={busy === 'save'}>Save the charge</button>
          <button className="btn btn-ghost" type="button" onClick={ask} aria-busy={busy === 'ai'}>{suggestion ? 'Ask Claude again' : 'Ask Claude for a suggestion'}</button>
        </div>
        {suggestion && <SuggestionBox s={suggestion} rules={rules.data ?? []} onRule={(id) => setV({ ...v, rule: id, offense: '' })} onDraft={(d) => setNte(fill(d))} />}
      </Step>
      <Step n={2} title="Notice to explain">
        <form className="form" onSubmit={issue} noValidate>
          <TextArea label="The notice" rows={10} value={nte} onChange={(e) => setNte(e.target.value)}
            hint="State the acts with when and where, the rule they may violate, at least five calendar days to answer in writing, that the employee may ask for a hearing with a representative, and that this is not a finding." />
          <TextField label="Answer by (Manila)" type="datetime-local" value={by} min={defaultExplainBy().slice(0, 10) + 'T00:00'} onChange={(e) => setBy(e.target.value)}
            hint="At least five calendar days from today (DOLE D.O. 147-15)" />
          <div className="form-foot"><button className="btn" type="submit" aria-busy={busy === 'issue'}>Issue the notice</button></div>
        </form>
      </Step>
    </>
  );
}

function SuggestionBox({ s, rules, onRule, onDraft }: { s: Suggestion; rules: OffenseRule[]; onRule: (id: string) => void; onDraft: (d: string) => void }) {
  return (
    <div className="callout stack" aria-label="Claude's suggestion">
      <b>Claude's suggestion <span className="muted small">— check it against the facts; you decide</span></b>
      {s.matches.length ? s.matches.map((m) => {
        const r = rules.find((x) => x.id === m.rule_id);
        return r ? (
          <div key={m.rule_id}>
            <b>{r.ref} {r.title}</b> <Badge tone={m.confidence === 'high' ? 'ok' : m.confidence === 'medium' ? 'warn' : 'neutral'}>{m.confidence} match</Badge>
            <div className="small">{m.why}</div>
            <button className="link-btn small" type="button" onClick={() => onRule(r.id)}>Use this rule</button>
          </div>
        ) : null;
      }) : <p className="small">No approved rule clearly fits these facts.</p>}
      {s.missing_facts.length > 0 && <div><b className="small">Find out first</b><ul className="small">{s.missing_facts.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
      {s.cautions.length > 0 && <div><b className="small">Keep in mind</b><ul className="small">{s.cautions.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
      {s.nte_draft && <button className="btn btn-line btn-sm" type="button" onClick={() => onDraft(s.nte_draft)}>Put Claude's draft in the notice</button>}
    </div>
  );
}

function ExplanationStep({ c, onSaved }: { c: CaseRow; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ text: '', hearing: false });
  const [error, setError] = useState('');
  const record = async (e: FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.rpc('record_case_explanation', { p_case_id: c.id, p_text: v.text, p_wants_hearing: v.hearing });
    if (err) return setError(errorText(err));
    toast('Explanation recorded.');
    setOpen(false);
    onSaved();
  };
  return (
    <Step n={2} title="The employee's explanation" done={Boolean(c.explanation)}>
      {c.explanation ? (
        <>
          <p className="pre">{c.explanation}</p>
          <p className="muted small">{c.explanation_via === 'app' ? 'Sent from the app' : 'Handed in on paper, recorded by HR'} {fmtDateTime(c.explained_at)}{c.wants_hearing ? ' · asked for a hearing' : ''}</p>
        </>
      ) : (
        <>
          <p>{c.explain_by && Date.parse(c.explain_by) > Date.now() ? `Waiting until ${fmtDateTime(c.explain_by)}. The employee answers in the app, or on paper.` : 'The deadline passed without an explanation. A late one is still heard until you decide.'}</p>
          {c.status === 'nte_issued' && <button className="btn btn-line btn-sm" type="button" onClick={() => setOpen(true)}>Record a written explanation</button>}
        </>
      )}
      <Dialog open={open} title="Record the explanation" onClose={() => setOpen(false)}>
        <form className="form" onSubmit={record} noValidate>
          {error && <p className="form-error" role="alert">{error}</p>}
          <TextArea label="The explanation, as written" rows={8} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
          <label className="check"><input type="checkbox" checked={v.hearing} onChange={(e) => setV({ ...v, hearing: e.target.checked })} /> The employee asks for a hearing</label>
          <p className="muted small">Keep the signed copy in the employee's 201 file.</p>
          <div className="form-foot"><button className="btn" type="submit">Record it</button></div>
        </form>
      </Dialog>
    </Step>
  );
}

function HearingStep({ c, onSaved }: { c: CaseRow; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ at: '', place: 'HR office', notes: '' });
  const [error, setError] = useState('');
  const can = ['nte_issued', 'explained', 'hearing_set'].includes(c.status);
  const set = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!v.at) return setError('Give the date and time.');
    const { error: err } = await supabase.rpc('set_case_hearing', { p_case_id: c.id, p_at: manilaIso(v.at), p_place: v.place });
    if (err) return setError(errorText(err));
    toast('Hearing set. The employee is told.');
    onSaved();
  };
  const record = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const { error: err } = await supabase.rpc('record_case_hearing', { p_case_id: c.id, p_notes: v.notes });
    if (err) return setError(errorText(err));
    toast('Hearing recorded.');
    onSaved();
  };
  return (
    <Step n={3} title="Hearing or conference" done={Boolean(c.hearing_held_at)}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {c.hearing_held_at ? (
        <><p className="pre">{c.hearing_notes}</p><p className="muted small">Held {fmtDateTime(c.hearing_at)} at {c.hearing_place}</p></>
      ) : c.status === 'hearing_set' ? (
        <form className="form" onSubmit={record} noValidate>
          <p>Set for {fmtDateTime(c.hearing_at)} at {c.hearing_place}.</p>
          <TextArea label="What happened" rows={6} hint="Who attended, the employee's representative, what was asked and answered" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          <div className="form-foot"><button className="btn" type="submit">Record the hearing</button></div>
        </form>
      ) : can ? (
        <form className="form" onSubmit={set} noValidate>
          <p className="muted small">{c.wants_hearing ? 'The employee asked for a hearing: hold one before deciding.' : 'Needed before a dismissal; otherwise when facts are disputed.'}</p>
          <div className="form-row">
            <TextField label="When (Manila)" type="datetime-local" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} />
            <TextField label="Where" value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} />
          </div>
          <div className="form-foot"><button className="btn btn-line" type="submit">Set the hearing</button></div>
        </form>
      ) : <p className="muted">No hearing was held.</p>}
    </Step>
  );
}

function DecisionStep({ c, onSaved }: { c: CaseRow; onSaved: () => void }) {
  const toast = useToast();
  const pen = codePenalty(c.rule, c.offense_no);
  const [v, setV] = useState({
    decision: pen && pen.action !== 'other' ? pen.action : '', days: pen?.days ? String(pen.days) : '', from: todayManila(), text: '', departs: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (c.status === 'decided') {
    return (
      <Step n={4} title="Decision" done>
        <p><StatusBadge map={CASE_DECISION} value={c.decision} />{c.decision === 'suspension' ? ` · ${c.suspension_days} days from ${fmtDate(c.suspension_from)}` : ''}</p>
        <p className="pre">{c.decision_text}</p>
        {c.departs_reason && <p className="callout">Not the code's penalty ({penaltyText(pen)}), because: {c.departs_reason}</p>}
        <p className="muted small">Decided {fmtDateTime(c.decided_at)} · {c.decision_received_at ? `received ${fmtDateTime(c.decision_received_at)}` : 'not yet opened in the app'}</p>
        {c.decision === 'dismissal' && <p className="muted small">Update the employee's status on their 201 file when the dismissal takes effect.</p>}
      </Step>
    );
  }
  if (c.status === 'withdrawn') return null;
  const differs = v.decision && v.decision !== 'no_violation' && (!pen || pen.action !== v.decision || (v.decision === 'suspension' && Number(v.days) !== pen.days));
  const decide = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!v.decision) return setError('Choose the decision.');
    if (!window.confirm('Issue this decision? The employee is told in the app.')) return;
    setBusy(true);
    const { error: err } = await supabase.rpc('decide_case', {
      p_case_id: c.id, p_decision: v.decision, p_suspension_days: v.decision === 'suspension' ? Number(v.days) : null,
      p_suspension_from: v.decision === 'suspension' ? v.from : null, p_decision_text: v.text, p_departs_reason: differs ? v.departs : null,
    });
    setBusy(false);
    if (err) return setError(errorText(err));
    toast('Decision issued. The employee is told.');
    onSaved();
  };
  return (
    <Step n={4} title="Decision">
      <form className="form" onSubmit={decide} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-row">
          <SelectField label="Decision" value={v.decision} onChange={(e) => setV({ ...v, decision: e.target.value })} placeholder="Choose" options={options(CASE_DECISION)} />
          {v.decision === 'suspension' && <TextField label="Days" type="number" min={1} max={90} value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} />}
          {v.decision === 'suspension' && <TextField label="From" type="date" min={todayManila()} value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />}
        </div>
        <TextArea label="The written decision" rows={8} hint="The facts found, the employee's side and why it was or was not accepted, the rule, and the penalty" value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
        {differs && <TextArea label={`Why not the code's penalty (${penaltyText(pen)})`} value={v.departs} onChange={(e) => setV({ ...v, departs: e.target.value })} />}
        <p className="muted small">The database refuses a decision before the employee has been heard, and a dismissal without a hearing or conference.</p>
        <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Issue the decision</button></div>
      </form>
    </Step>
  );
}

function PreventiveStep({ c, onSaved }: { c: CaseRow; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ from: todayManila(), to: '', reason: '' });
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.rpc('set_preventive_suspension', { p_case_id: c.id, p_from: v.from, p_to: v.to, p_reason: v.reason });
    if (err) return setError(errorText(err));
    toast('Preventive suspension set. The employee is told.');
    setOpen(false);
    onSaved();
  };
  return (
    <div className="row">
      {c.preventive_from ? <p className="callout">Preventive suspension {fmtDate(c.preventive_from)} to {fmtDate(c.preventive_to)}: {c.preventive_reason}</p> : null}
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(true)}>{c.preventive_from ? 'Change the preventive suspension' : 'Preventive suspension'}</button>
      <Dialog open={open} title="Preventive suspension" onClose={() => setOpen(false)}>
        <form className="form" onSubmit={save} noValidate>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="muted small">Only when the employee's presence is a serious and imminent threat to life or property, and for at most 30 days.</p>
          <div className="form-row">
            <TextField label="From" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
            <TextField label="To" type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />
          </div>
          <TextArea label="The threat it prevents" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          <div className="form-foot"><button className="btn" type="submit">Set it</button></div>
        </form>
      </Dialog>
    </div>
  );
}

function Withdraw({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const toast = useToast();
  const go = async () => {
    const reason = window.prompt('Why is the case withdrawn?');
    if (!reason) return;
    const { error } = await supabase.rpc('withdraw_case', { p_case_id: caseId, p_reason: reason });
    if (error) return toast(errorText(error));
    toast('Case withdrawn.');
    onDone();
  };
  return <p><button className="link-btn small" type="button" onClick={go}>Withdraw this case</button></p>;
}
