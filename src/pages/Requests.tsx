import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { dateRange, errorText, fmtDate, fmtDateTime, fullName } from '../lib/format';
import { COE_PURPOSE, COE_STATUS, CONCERN_CATEGORY, CONCERN_STATUS, LEAVE_STATUS, REQUEST_STATUS, options } from '../lib/labels';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, SelectField, StatusBadge, Tabs, TextArea, useToast } from '../ui/kit';
import { IssueCoeForm } from './coeShared';

type Tab = 'leave' | 'coe' | 'changes' | 'concerns';
const EMP = 'employee:employees!inner(id,employee_no,first_name,middle_name,last_name,suffix,site_id)';
// leave_requests points at employees twice (the employee and the reliever): name the foreign key
const LEAVE_EMP = 'employee:employees!leave_requests_employee_id_fkey(id,employee_no,first_name,middle_name,last_name,suffix,site_id)';
type Emp = { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; site_id: string | null };

function Who({ e }: { e: Emp }) {
  return <><Link className="cell-main" to={`/employees/${e.id}`}>{fullName(e)}</Link><span className="cell-sub tabular">{e.employee_no}</span></>;
}

export default function Requests() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const all: { id: Tab; label: string; show: boolean }[] = [
    { id: 'leave', label: 'Leave', show: can.hr || can.ops || can.staff },
    { id: 'coe', label: 'Certificates of employment', show: can.hr },
    { id: 'changes', label: 'Contact detail changes', show: can.hr },
    { id: 'concerns', label: 'Payroll concerns', show: can.payroll },
  ];
  const tabs = all.filter((t) => t.show);
  const tab = (tabs.find((t) => t.id === params.get('tab'))?.id ?? tabs[0]?.id ?? 'leave') as Tab;
  return (
    <>
      <PageHead title="Requests" intro="What employees asked for in the app, and what waits for a decision." />
      <Tabs label="Kinds of request" tabs={tabs} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      {tab === 'leave' && <LeaveTab />}
      {tab === 'coe' && <CoeTab />}
      {tab === 'changes' && <ChangesTab />}
      {tab === 'concerns' && <ConcernsTab />}
    </>
  );
}

function LeaveTab() {
  const { can } = useAuth();
  const [filter, setFilter] = useState('waiting');
  const [deciding, setDeciding] = useState<null | { row: Record<string, unknown>; approve: boolean }>(null);
  const q = useQuery({
    queryKey: ['leave-requests', filter],
    queryFn: async () => {
      let req = supabase.from('leave_requests').select(`*, ${LEAVE_EMP}, type:leave_types(name), reliever:employees!leave_requests_reliever_employee_id_fkey(first_name,last_name), site:sites(name)`).order('start_date').limit(200);
      if (filter === 'waiting') req = req.in('status', ['pending_supervisor', 'pending_hr']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="waiting">Waiting for a decision</option>
          {options(LEAVE_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every request</option>
        </select>
        <span className="muted small">Leave goes to the post's detachment commander first, then to HR for the final approval.</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No leave requests here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Employee</th><th>Leave</th><th>Dates</th><th className="num">Days</th><th>Post</th><th>Status</th><th>Reliever</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => {
                const stage = r.status as string;
                const mayDecide = (stage === 'pending_hr' && can.hr) || (stage === 'pending_supervisor' && (can.hr || can.ops));
                const rel = r.reliever as { first_name: string; last_name: string } | null;
                return (
                  <tr key={r.id}>
                    <td><Who e={r.employee as Emp} /></td>
                    <td>{(r.type as { name: string }).name}{r.reason && <span className="cell-sub">{r.reason}</span>}</td>
                    <td>{dateRange(r.start_date, r.end_date)}</td>
                    <td className="num">{Number(r.days)}</td>
                    <td>{(r.site as { name: string } | null)?.name ?? <span className="muted">None</span>}</td>
                    <td><StatusBadge map={LEAVE_STATUS} value={stage} /></td>
                    <td>{rel ? `${rel.first_name} ${rel.last_name}` : <span className="muted">None</span>}</td>
                    <td>{mayDecide && <span className="row"><button className="btn btn-ok btn-sm" type="button" onClick={() => setDeciding({ row: r, approve: true })}>{stage === 'pending_hr' ? 'Approve' : 'Endorse'}</button><button className="btn btn-line btn-sm" type="button" onClick={() => setDeciding({ row: r, approve: false })}>Decline</button></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(deciding)} title={deciding?.approve ? (deciding.row.status === 'pending_hr' ? 'Approve the leave' : 'Endorse the leave to HR') : 'Decline the leave'} onClose={() => setDeciding(null)}>
        {deciding && <LeaveDecision row={deciding.row} approve={deciding.approve} onDone={() => setDeciding(null)} />}
      </Dialog>
    </div>
  );
}

function LeaveDecision({ row, approve, onDone }: { row: Record<string, unknown>; approve: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const emp = row.employee as Emp;
  const [note, setNote] = useState('');
  const [reliever, setReliever] = useState('');
  const [busy, setBusy] = useState(false);
  const mates = useQuery({
    queryKey: ['relievers', emp.site_id],
    enabled: approve,
    queryFn: async () => {
      let req = supabase.from('employees').select('id,first_name,last_name,status,site:sites!employees_site_id_fkey(name)').in('status', ['active', 'floating']).eq('is_field', true).neq('id', emp.id).order('last_name').limit(300);
      if (emp.site_id) req = req.or(`site_id.eq.${emp.site_id},status.eq.floating`);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('decide_leave_request', { p_request_id: row.id, p_approve: approve, p_note: note.trim() || null, p_reliever_id: reliever || null });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['leave-requests'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(approve ? 'Decision saved. The employee is told in the app.' : 'Declined. The employee is told in the app.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit}>
      <p><b>{fullName(emp)}</b> · {(row.type as { name: string }).name} · {dateRange(row.start_date as string, row.end_date as string)} ({Number(row.days)} days)</p>
      {approve && (
        <SelectField label="Reliever" optional value={reliever} onChange={(e) => setReliever(e.target.value)} placeholder="No reliever named" hint="Guards of the same post and floating guards."
          options={(mates.data ?? []).map((m) => ({ value: m.id, label: `${m.last_name}, ${m.first_name}${m.status === 'floating' ? ' (floating)' : ''}` }))} />
      )}
      <TextArea label={approve ? 'Note to the employee' : 'Reason, for the employee'} optional={approve} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy} disabled={!approve && !note.trim()}>{approve ? 'Save the decision' : 'Decline'}</button></div>
    </form>
  );
}

function CoeTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const [issuing, setIssuing] = useState<Record<string, unknown> | null>(null);
  const q = useQuery({
    queryKey: ['coe-requests', filter],
    queryFn: async () => {
      let req = supabase.from('coe_requests').select(`*, ${EMP}, certificate:certificates!coe_requests_certificate_fk(certificate_no,verification_code)`).order('due_at').limit(200);
      if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  const decline = async (r: Record<string, unknown>) => {
    const note = prompt('Why is the request declined? The employee sees this.');
    if (!note) return;
    const { error } = await supabase.rpc('reject_coe_request', { p_request_id: r.id, p_note: note });
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['coe-requests'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('Declined.');
  };
  const now = Date.now();
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {options(COE_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every request</option>
        </select>
        <span className="muted small">DOLE gives three days from the request to issue a certificate of employment.</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No certificate requests here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Employee</th><th>Purpose</th><th>Compensation</th><th>Asked</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => {
                const overdue = r.status === 'pending' && new Date(r.due_at).getTime() < now;
                const cert = r.certificate as { certificate_no: string; verification_code: string } | null;
                return (
                  <tr key={r.id}>
                    <td><Who e={r.employee as Emp} /></td>
                    <td>{COE_PURPOSE[r.purpose]}{r.purpose_details && <span className="cell-sub">{r.purpose_details}</span>}</td>
                    <td>{r.include_compensation ? 'Printed' : 'No'}</td>
                    <td className="tabular">{fmtDateTime(r.created_at)}</td>
                    <td className="tabular">{fmtDate(r.due_at)} {overdue && <Badge tone="bad">Overdue</Badge>}</td>
                    <td><StatusBadge map={COE_STATUS} value={r.status} />{cert && <span className="cell-sub tabular">{cert.certificate_no}</span>}</td>
                    <td>{r.status === 'pending' && <span className="row"><button className="btn btn-sm" type="button" onClick={() => setIssuing(r)}>Issue</button><button className="btn btn-line btn-sm" type="button" onClick={() => decline(r)}>Decline</button></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(issuing)} title="Issue the certificate" onClose={() => setIssuing(null)}>
        {issuing && (
          <IssueCoeForm requestId={issuing.id as string} employeeId={(issuing.employee as Emp).id} includeCompensation={issuing.include_compensation as boolean}
            onCancel={() => setIssuing(null)}
            onDone={(c) => { setIssuing(null); qc.invalidateQueries({ queryKey: ['coe-requests'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); toast(`${c.certificate_no} issued. The employee can download it in the app.`); }} />
        )}
      </Dialog>
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = {
  mobile_no: 'Mobile', email: 'Email', present_address: 'Present address', provincial_address: 'Provincial address', civil_status: 'Civil status',
  emergency_contact_name: 'Emergency contact', emergency_contact_relation: 'Relation', emergency_contact_phone: 'Emergency number',
};

function ChangesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('pending');
  const q = useQuery({
    queryKey: ['profile-changes', filter],
    queryFn: async () => {
      let req = supabase.from('profile_change_requests').select('*, employee:employees!inner(id,employee_no,first_name,middle_name,last_name,suffix,site_id,mobile_no,email,present_address,provincial_address,civil_status,emergency_contact_name,emergency_contact_relation,emergency_contact_phone)').order('created_at').limit(200);
      if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  const decide = async (id: string, approve: boolean) => {
    const note = approve ? null : prompt('Why not? The employee sees this.');
    if (!approve && !note) return;
    const { error } = await supabase.rpc('decide_profile_change', { p_request_id: id, p_approve: approve, p_note: note });
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['profile-changes'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast(approve ? 'The 201 file is updated.' : 'Declined.');
  };
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {options(REQUEST_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every request</option>
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No detail changes here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Employee</th><th>Change</th><th>Asked</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => {
                const emp = r.employee as Emp & Record<string, string | null>;
                return (
                  <tr key={r.id}>
                    <td><Who e={emp} /></td>
                    <td>{Object.entries(r.changes as Record<string, string>).map(([k, v]) => (
                      <div key={k}><b>{CHANGE_LABEL[k] ?? k}:</b> <span className="muted">{emp[k] || 'empty'}</span> → {v}</div>
                    ))}{r.reason && <span className="cell-sub">{r.reason}</span>}</td>
                    <td className="tabular">{fmtDateTime(r.created_at)}</td>
                    <td><StatusBadge map={REQUEST_STATUS} value={r.status} /></td>
                    <td>{r.status === 'pending' && <span className="row"><button className="btn btn-ok btn-sm" type="button" onClick={() => decide(r.id, true)}>Apply</button><button className="btn btn-line btn-sm" type="button" onClick={() => decide(r.id, false)}>Decline</button></span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConcernsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('active');
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const q = useQuery({
    queryKey: ['concerns', filter],
    queryFn: async () => {
      let req = supabase.from('payroll_concerns').select(`*, ${EMP}, payslip:payslips(net_pay, period:payroll_periods(label))`).order('created_at').limit(200);
      if (filter === 'active') req = req.in('status', ['open', 'in_review']);
      else if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data;
    },
  });
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from('payroll_concerns').update({ status: f.get('status'), resolution: (f.get('resolution') as string).trim() || null }).eq('id', open!.id as string);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['concerns'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    toast('Saved. The employee is told in the app.');
    setOpen(null);
  };
  return (
    <div className="panel">
      <div className="toolbar">
        <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="active">Open and in review</option>
          {options(CONCERN_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          <option value="">Every concern</option>
        </select>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No payroll concerns here" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Employee</th><th>Concern</th><th>Cutoff</th><th>Raised</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td><Who e={r.employee as Emp} /></td>
                  <td><b>{CONCERN_CATEGORY[r.category]}</b><span className="cell-sub">{r.description}</span></td>
                  <td>{(r.payslip as { period: { label: string } } | null)?.period.label ?? <span className="muted">Not linked</span>}</td>
                  <td className="tabular">{fmtDateTime(r.created_at)}</td>
                  <td><StatusBadge map={CONCERN_STATUS} value={r.status} /></td>
                  <td><button className="btn btn-line btn-sm" type="button" onClick={() => setOpen(r)}>Answer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(open)} title="Answer the payroll concern" onClose={() => setOpen(null)}>
        {open && (
          <form className="form" onSubmit={save}>
            <p><b>{fullName(open.employee as Emp)}</b>: {open.description as string}</p>
            <SelectField label="Status" name="status" defaultValue={open.status as string} options={options(CONCERN_STATUS)} />
            <TextArea label="Answer to the employee" name="resolution" optional defaultValue={(open.resolution as string) ?? ''} rows={4} />
            <div className="form-foot"><button className="btn" type="submit">Save</button></div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
