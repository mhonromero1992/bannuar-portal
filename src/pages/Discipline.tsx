import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useSites } from '../lib/refs';
import { errorText, fmtDateTime, fullName } from '../lib/format';
import { CASE_DECISION, CASE_STATUS, INCIDENT_STATUS, REPORTER_KIND, options } from '../lib/labels';
import { manilaIso, ordinal } from '../lib/discipline';
import { Dialog, Empty, ErrorState, Loading, PageHead, SelectField, StatusBadge, Tabs, TextArea, TextField, useToast } from '../ui/kit';
import { CodeTab } from './disciplineCode';
import { CASE_SELECT, CaseView, nextStep, type CaseRow } from './disciplineCase';

type Tab = 'cases' | 'reports' | 'code';
type Emp = { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null };

/**
 * Discipline: incident reports (from clients, commanders and staff), cases that follow due process, and
 * the Code of Discipline they rest on. HR runs cases; operations files and follows reports.
 */
export default function Discipline() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = ([
    { id: 'cases', label: 'Cases', show: can.hr },
    { id: 'reports', label: 'Incident reports', show: can.hr || can.ops },
    { id: 'code', label: 'Code of Discipline', show: can.hr },
  ] as { id: Tab; label: string; show: boolean }[]).filter((t) => t.show);
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id ?? 'reports') as Tab;
  if (!tabs.length) return <PageHead title="Discipline" intro="HR and operations only." />;
  return (
    <>
      <PageHead title="Discipline" intro="Violations reported by clients, commanders and staff; cases with notice, explanation, hearing and decision; and the Code of Discipline they follow." />
      <Tabs label="Discipline" tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'cases' && <CasesTab />}
      {tab === 'reports' && <ReportsTab onOpenCase={(id) => setParams({ tab: 'cases', case: id }, { replace: true })} />}
      {tab === 'code' && <CodeTab />}
    </>
  );
}

function EmployeePicker({ value, onChange, label = 'Employee' }: { value: string; onChange: (id: string, e?: Emp) => void; label?: string }) {
  const [term, setTerm] = useState('');
  const found = useQuery({
    queryKey: ['discipline-emp-search', term],
    enabled: term.trim().length >= 2,
    queryFn: async () => {
      const s = term.trim().replace(/[%,()]/g, '');
      const { data, error } = await supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix')
        .or(`employee_no.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`).order('last_name').limit(20);
      if (error) throw error;
      return data as Emp[];
    },
  });
  return (
    <>
      <TextField label={`Find the ${label.toLowerCase()}`} hint="Name or employee number" value={term} onChange={(e) => { setTerm(e.target.value); onChange(''); }} />
      {term.trim().length >= 2 && (
        <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value, found.data?.find((x) => x.id === e.target.value))}
          placeholder={found.data?.length ? 'Choose one' : 'No match yet'}
          options={(found.data ?? []).map((e) => ({ value: e.id, label: `${fullName(e)} · ${e.employee_no}` }))} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------- cases

function CasesTab() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('open');
  const [opening, setOpening] = useState(false);
  const caseId = params.get('case');
  const q = useQuery({
    queryKey: ['discipline-cases', filter],
    queryFn: async () => {
      let req = supabase.from('disciplinary_cases').select(CASE_SELECT).order('created_at', { ascending: false }).limit(200);
      if (filter === 'open') req = req.in('status', ['draft', 'nte_issued', 'explained', 'hearing_set']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data as unknown as CaseRow[];
    },
  });
  const show = (id: string | null) => setParams(id ? { tab: 'cases', case: id } : { tab: 'cases' }, { replace: true });
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Which cases" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open cases</option>
          {options(CASE_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every case</option>
        </select>
        <span className="muted small">Each case: a notice to explain with at least five days to answer, the employee's side, a hearing when asked for or before a dismissal, then a written decision.</span>
        <button className="btn" type="button" onClick={() => setOpening(true)}>Open a case</button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No cases here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Case</th><th>Employee</th><th>Rule</th><th>Status</th><th>Next</th></tr></thead>
            <tbody>{q.data.map((c) => (
              <tr key={c.id}>
                <td><button className="link-btn cell-main tabular" type="button" onClick={() => show(c.id)}>{c.case_no}</button><span className="cell-sub">{fmtDateTime(c.created_at)}</span></td>
                <td>{c.employee ? <><span className="cell-main">{fullName(c.employee)}</span><span className="cell-sub tabular">{c.employee.employee_no}</span></> : '—'}</td>
                <td>{c.rule ? <><span className="cell-main">{c.rule.ref} {c.rule.title}</span><span className="cell-sub">{ordinal(c.offense_no ?? 1)} offense</span></> : <span className="muted">Not chosen</span>}</td>
                <td><StatusBadge map={CASE_STATUS} value={c.status} />{c.decision && <span className="cell-sub"><StatusBadge map={CASE_DECISION} value={c.decision} /></span>}</td>
                <td className="small">{nextStep(c)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(caseId)} wide title="Discipline case" onClose={() => show(null)}>
        {caseId && <CaseView caseId={caseId} onClose={() => show(null)} />}
      </Dialog>
      <Dialog open={opening} title="Open a case" onClose={() => setOpening(false)}>
        {opening && <OpenCase onDone={(id) => { setOpening(false); show(id); }} />}
      </Dialog>
    </div>
  );
}

export function OpenCase({ report, onDone }: { report?: { id: string; employee: Emp | null; details: string; occurred_at: string }; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [who, setWho] = useState(report?.employee?.id ?? '');
  const [facts, setFacts] = useState(report ? `${fmtDateTime(report.occurred_at)}: ${report.details}` : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!who) return setError('Choose the employee.');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('open_disciplinary_case', { p_employee_id: who, p_incident_id: report?.id ?? null, p_rule_id: null, p_facts: facts });
    setBusy(false);
    if (err) return setError(errorText(err));
    qc.invalidateQueries({ queryKey: ['discipline-cases'] });
    qc.invalidateQueries({ queryKey: ['incident-reports'] });
    toast(`Case ${(data as { case_no: string }).case_no} opened as a draft. The employee sees nothing until you issue the notice.`);
    onDone((data as { id: string }).id);
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      {report?.employee ? <p>Employee: <b>{fullName(report.employee)}</b> · {report.employee.employee_no}</p> : <EmployeePicker value={who} onChange={(id) => setWho(id)} />}
      <TextArea label="The facts: what happened, when and where" rows={6} value={facts} onChange={(e) => setFacts(e.target.value)} />
      <p className="muted small">Next you choose the rule (Claude can suggest one) and write the notice to explain.</p>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Open the case</button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------- reports

type Report = {
  id: string; report_no: string; occurred_at: string; title: string; details: string; reporter_kind: string; reporter_name: string | null;
  status: string; client_update: string | null; guard_described: string | null; created_at: string;
  site: { id: string; name: string } | null; client: { name: string } | null; employee: Emp | null;
};
const REPORT_SELECT = 'id,report_no,occurred_at,title,details,reporter_kind,reporter_name,status,client_update,guard_described,created_at,' +
  'site:sites(id,name),client:clients(name),employee:employees(id,employee_no,first_name,middle_name,last_name,suffix)';

function ReportsTab({ onOpenCase }: { onOpenCase: (caseId: string) => void }) {
  const { can } = useAuth();
  const [filter, setFilter] = useState('open');
  const [filing, setFiling] = useState(false);
  const [open, setOpen] = useState<Report | null>(null);
  const q = useQuery({
    queryKey: ['incident-reports', filter],
    queryFn: async () => {
      let req = supabase.from('incident_reports').select(REPORT_SELECT).order('created_at', { ascending: false }).limit(200);
      if (filter === 'open') req = req.in('status', ['received', 'investigating']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data as unknown as Report[];
    },
  });
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Which reports" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open reports</option>
          {options(INCIDENT_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every report</option>
        </select>
        <span className="muted small">Clients file from their portal and commanders from the app. A client sees the status and your update, never the case.</span>
        <button className="btn" type="button" onClick={() => setFiling(true)}>File a report</button>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No reports here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Report</th><th>Post</th><th>Guard</th><th>From</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((r) => (
              <tr key={r.id}>
                <td><button className="link-btn cell-main" type="button" onClick={() => setOpen(r)}>{r.title}</button><span className="cell-sub tabular">{r.report_no} · {fmtDateTime(r.occurred_at)}</span></td>
                <td>{r.site?.name ?? '—'}{r.client && <span className="cell-sub">{r.client.name}</span>}</td>
                <td>{r.employee ? <><span className="cell-main">{fullName(r.employee)}</span><span className="cell-sub tabular">{r.employee.employee_no}</span></> : <span className="muted">{r.guard_described ?? 'Not named'}</span>}</td>
                <td>{REPORTER_KIND[r.reporter_kind]}<span className="cell-sub">{r.reporter_name}</span></td>
                <td><StatusBadge map={INCIDENT_STATUS} value={r.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={filing} title="File an incident report" onClose={() => setFiling(false)}>
        {filing && <FileReport onDone={() => setFiling(false)} />}
      </Dialog>
      <Dialog open={open !== null} wide title={open ? `${open.report_no}: ${open.title}` : ''} onClose={() => setOpen(null)}>
        {open && <ReportView r={open} canCase={can.hr} onCase={(id) => { setOpen(null); onOpenCase(id); }} onSaved={() => setOpen(null)} />}
      </Dialog>
    </div>
  );
}

function FileReport({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sites = useSites();
  const [v, setV] = useState({ site: '', when: '', title: '', details: '', described: '' });
  const [who, setWho] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!v.when) return setError('Give when it happened.');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('file_incident_report', {
      p_site_id: v.site || null, p_employee_id: who || null, p_occurred_at: manilaIso(v.when), p_title: v.title, p_details: v.details,
      p_guard_described: who ? null : v.described || null,
    });
    setBusy(false);
    if (err) return setError(errorText(err));
    qc.invalidateQueries({ queryKey: ['incident-reports'] });
    toast(`Report ${(data as { report_no: string }).report_no} filed.`);
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SelectField label="Post" optional value={v.site} onChange={(e) => setV({ ...v, site: e.target.value })} placeholder="Choose the post"
        options={(sites.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
      <TextField label="When it happened (Manila)" type="datetime-local" value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })} />
      <EmployeePicker label="Guard" value={who} onChange={(id) => setWho(id)} />
      {!who && <TextField label="Or describe the guard" optional hint="If you do not know the name: shift, position, how they look" value={v.described} onChange={(e) => setV({ ...v, described: e.target.value })} />}
      <TextField label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Asleep on post" />
      <TextArea label="What happened" rows={6} value={v.details} onChange={(e) => setV({ ...v, details: e.target.value })} />
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>File the report</button></div>
    </form>
  );
}

function ReportView({ r, canCase, onCase, onSaved }: { r: Report; canCase: boolean; onCase: (id: string) => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ status: r.status, update: r.client_update ?? '' });
  const [casing, setCasing] = useState(false);
  const [error, setError] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.rpc('update_incident_report', { p_id: r.id, p_status: v.status, p_client_update: v.update });
    if (err) return setError(errorText(err));
    qc.invalidateQueries({ queryKey: ['incident-reports'] });
    toast('Report updated.');
    onSaved();
  };
  return (
    <div className="stack">
      <dl className="dl">
        <dt>When</dt><dd>{fmtDateTime(r.occurred_at)}</dd>
        <dt>Post</dt><dd>{r.site?.name ?? '—'}{r.client ? ` · ${r.client.name}` : ''}</dd>
        <dt>Guard</dt><dd>{r.employee ? `${fullName(r.employee)} · ${r.employee.employee_no}` : r.guard_described ?? 'Not named'}</dd>
        <dt>Filed by</dt><dd>{REPORTER_KIND[r.reporter_kind]}{r.reporter_name ? `: ${r.reporter_name}` : ''} · {fmtDateTime(r.created_at)}</dd>
      </dl>
      <p className="pre">{r.details}</p>
      <form className="form" onSubmit={save} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <SelectField label="Status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} options={options(INCIDENT_STATUS)} />
        <TextArea label="Update for the client" optional hint="What the client reads in their portal. Say what was done, not the employee's case or penalty." value={v.update} onChange={(e) => setV({ ...v, update: e.target.value })} />
        <div className="form-foot">
          {canCase && <button className="btn btn-line" type="button" onClick={() => setCasing(true)}>Open a case from this report</button>}
          <button className="btn" type="submit">Save</button>
        </div>
      </form>
      <Dialog open={casing} title="Open a case" onClose={() => setCasing(false)}>
        {casing && <OpenCase report={r} onDone={(id) => { setCasing(false); onCase(id); }} />}
      </Dialog>
    </div>
  );
}
