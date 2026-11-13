import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { errorText, fmtDate, fmtDateTime } from '../lib/format';
import { openStoredFile, uploadFile } from '../lib/files';
import { CODE_STATUS, GRAVITY, JUST_CAUSE, OFFENSE_CATEGORY, PENALTY_ACTION, READ_STATUS, RULE_STATUS, options } from '../lib/labels';
import { CODE_COLUMNS, RULE_COLUMNS, checkCode, ordinal, penaltyText, readCode, type DisciplineCode, type OffenseRule, type Penalty } from '../lib/discipline';
import { Dialog, Empty, ErrorState, Loading, SelectField, StatusBadge, TextArea, TextField, useToast } from '../ui/kit';

/**
 * The Code of Discipline: HR uploads the PDF, Claude reads it into offense rules, HR approves or rejects
 * each, then puts the code in force. Only approved rules of the code in force are used in cases.
 */
export function CodeTab() {
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const codes = useQuery({
    queryKey: ['discipline-codes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('discipline_codes').select(CODE_COLUMNS).order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as DisciplineCode[];
    },
  });
  const [pick, setPick] = useState<string | null>(null);
  const list = codes.data ?? [];
  const shown = list.find((c) => c.id === pick) ?? list.find((c) => c.status === 'draft') ?? list.find((c) => c.status === 'active') ?? list[0];
  return (
    <div className="stack">
      <div className="panel">
        <div className="toolbar">
          <span className="muted small">
            The Code of Discipline is the basis of every case. Claude reads it and proposes the offense rules; HR approves each before it is used.
          </span>
          <button className="btn" type="button" onClick={() => setUploading(true)}>Upload the code (PDF)</button>
        </div>
        {codes.isLoading ? <Loading /> : codes.error ? <ErrorState error={errorText(codes.error)} retry={() => codes.refetch()} /> : !list.length ? (
          <Empty title="No Code of Discipline yet">Upload the company's Code of Discipline as a PDF. Claude reads it, and you review what it found.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Version</th><th>In force from</th><th>Status</th><th>Claude</th><th>Uploaded</th><th /></tr></thead>
              <tbody>{list.map((c) => (
                <tr key={c.id} aria-current={c.id === shown?.id ? 'true' : undefined}>
                  <td><button className="link-btn cell-main" type="button" onClick={() => setPick(c.id)}>{c.title}</button></td>
                  <td className="tabular">{fmtDate(c.effective_on) || '—'}</td>
                  <td><StatusBadge map={CODE_STATUS} value={c.status} /></td>
                  <td><StatusBadge map={READ_STATUS} value={c.read_status} /></td>
                  <td className="tabular">{fmtDate(c.created_at)}</td>
                  <td><button className="btn btn-line btn-sm" type="button" onClick={() => openStoredFile('', c.file_key)}>Open the PDF</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      {shown && <CodeView key={shown.id} code={shown} onChanged={() => qc.invalidateQueries({ queryKey: ['discipline-codes'] })} />}
      <Dialog open={uploading} title="Upload the Code of Discipline" onClose={() => setUploading(false)}>
        <UploadCode onDone={(id) => { setUploading(false); setPick(id); qc.invalidateQueries({ queryKey: ['discipline-codes'] }); }} />
      </Dialog>
    </div>
  );
}

function UploadCode({ onDone }: { onDone: (id: string) => void }) {
  const toast = useToast();
  const [v, setV] = useState({ title: '', effective: '' });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (v.title.trim().length < 3) return setError('Give this version a title, such as "Code of Discipline 2026".');
    if (!file) return setError('Choose the PDF.');
    if (file.type && file.type !== 'application/pdf') return setError('Upload a PDF.');
    setBusy(true);
    try {
      const stored = await uploadFile({ purpose: 'policy', file, fileName: file.name });
      const { data, error: err } = await supabase.rpc('create_discipline_code', { p_title: v.title.trim(), p_effective_on: v.effective || null, p_file_key: stored.key });
      if (err) throw err;
      try {
        await readCode(data as string);
        toast('Uploaded. Claude is reading it; this can take a few minutes.');
      } catch (re) {
        toast(`Uploaded. Claude could not start reading it: ${errorText(re)}`);
      }
      onDone(data as string);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <TextField label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="Code of Discipline 2026" />
      <TextField label="In force from" type="date" optional value={v.effective} onChange={(e) => setV({ ...v, effective: e.target.value })} />
      <label className="field">
        <span className="label">The PDF</span>
        <input className="input" type="file" accept="application/pdf" aria-label="The PDF" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span className="field-hint">Up to 10 MB. Stored in the company folder of the S3 bucket, not in anyone's 201 file.</span>
      </label>
      <p className="muted small">
        Claude (Anthropic's Claude Opus 5.5) reads the PDF and proposes each offense with its penalties. Nothing is used until you approve it.
        The PDF goes to Anthropic for the reading; it holds no employee's personal details.
      </p>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Upload and have Claude read it</button></div>
    </form>
  );
}

function CodeView({ code, onChanged }: { code: DisciplineCode; onChanged: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'proposed' | 'approved' | 'rejected'>('all');
  const [editing, setEditing] = useState<OffenseRule | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const rules = useQuery({
    queryKey: ['offense-rules', code.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('offense_rules').select(RULE_COLUMNS).eq('code_id', code.id).order('sort').order('ref');
      if (error) throw error;
      return data as unknown as OffenseRule[];
    },
  });
  // while Claude reads, ask every 20 seconds whether it has finished
  const reading = useQuery({
    queryKey: ['code-reading', code.id],
    enabled: code.read_status === 'reading',
    refetchInterval: 20_000,
    queryFn: () => checkCode(code.id),
  });
  useEffect(() => {
    if (reading.data && reading.data.status !== 'reading') {
      onChanged();
      qc.invalidateQueries({ queryKey: ['offense-rules', code.id] });
    }
  }, [reading.data, onChanged, qc, code.id]);

  const all = rules.data ?? [];
  const shown = filter === 'all' ? all : all.filter((r) => r.status === filter);
  const proposed = all.filter((r) => r.status === 'proposed');
  const approved = all.filter((r) => r.status === 'approved');
  const editable = code.status !== 'retired';

  const setStatus = async (ids: string[], status: 'approved' | 'rejected' | 'proposed') => {
    setBusy(status);
    const { error } = await supabase.from('offense_rules').update({ status }).in('id', ids);
    setBusy('');
    if (error) return toast(errorText(error));
    qc.invalidateQueries({ queryKey: ['offense-rules', code.id] });
  };
  const startReading = async () => {
    setBusy('read');
    try {
      await readCode(code.id);
      toast('Claude is reading the code. This can take a few minutes; you can leave this page.');
      onChanged();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const activate = async () => {
    if (!window.confirm(`Put "${code.title}" in force? New cases will use its approved rules, and the code in force now is retired.`)) return;
    setBusy('activate');
    const { error } = await supabase.rpc('activate_discipline_code', { p_code_id: code.id });
    setBusy('');
    if (error) return toast(errorText(error));
    toast('The code is in force.');
    onChanged();
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <b>{code.title}</b> <StatusBadge map={CODE_STATUS} value={code.status} />
          <div className="muted small">
            {code.read_status === 'read' && `Read by Claude ${fmtDateTime(code.read_at)}${code.read_model ? ` (${code.read_model})` : ''}. `}
            {approved.length} approved · {proposed.length} to review · {all.length - approved.length - proposed.length} rejected
          </div>
        </div>
        <div className="row">
          {code.status === 'draft' && (code.read_status === 'not_read' || code.read_status === 'failed' || (code.read_status === 'read' && !all.some((r) => r.status !== 'proposed'))) && (
            <button className="btn btn-line" type="button" onClick={startReading} aria-busy={busy === 'read'}>
              {code.read_status === 'not_read' ? 'Have Claude read it' : 'Have Claude read it again'}
            </button>
          )}
          {code.status === 'draft' && <button className="btn" type="button" onClick={activate} disabled={proposed.length > 0 || approved.length === 0} aria-busy={busy === 'activate'}>Put this code in force</button>}
        </div>
      </div>
      <div className="panel-pad stack">
        {code.read_status === 'reading' && (
          <p className="callout" role="status">
            Claude is reading the code (started {fmtDateTime(code.read_started_at)}). Most codes take a few minutes; long ones can take up to an hour.
            This page checks every 20 seconds. <button className="link-btn" type="button" onClick={() => reading.refetch()}>Check now</button>
          </p>
        )}
        {code.read_status === 'failed' && <p className="callout warn" role="alert">{code.read_error ?? 'The reading failed.'}</p>}
        {code.summary && <p>{code.summary}</p>}
        {code.compliance_notes.length > 0 && (
          <div className="callout warn">
            <b>For your lawyer to look at</b>
            <ul>{code.compliance_notes.map((n, i) => <li key={i}>{n.ref ? <b>{n.ref}: </b> : null}{n.note}</li>)}</ul>
            <span className="small">Claude's notes on clauses that may not sit well with the Labor Code or DOLE rules. They are not legal advice.</span>
          </div>
        )}
        {code.status === 'draft' && proposed.length > 0 && (
          <p className="muted small">Check each rule against the PDF: the number, the offense, and the penalty for each offense count. Approve the ones that are right, edit the rest, reject what is not an offense.</p>
        )}
        <div className="toolbar">
          <select className="select" style={{ width: 'auto' }} aria-label="Which rules" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">Every rule</option>
            <option value="proposed">To review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          {editable && <button className="btn btn-line btn-sm" type="button" onClick={() => setEditing('new')}>Add a rule by hand</button>}
          {editable && filter === 'proposed' && shown.length > 0 && (
            <button className="btn btn-sm" type="button" onClick={() => setStatus(shown.map((r) => r.id), 'approved')} aria-busy={busy === 'approved'}>Approve all {shown.length} shown</button>
          )}
        </div>
        {rules.isLoading ? <Loading /> : rules.error ? <ErrorState error={errorText(rules.error)} retry={() => rules.refetch()} /> : !shown.length ? (
          <Empty title={all.length ? 'No rules here' : 'No rules yet'}>{all.length ? 'Choose another filter.' : 'Claude lists the rules here once it has read the code. You can also add them by hand.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>No.</th><th>Offense</th><th>Class</th><th>Penalties</th><th>Status</th><th /></tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.id}>
                  <td className="tabular">{r.ref || '—'}</td>
                  <td>
                    <span className="cell-main">{r.title}</span>
                    <span className="cell-sub">{OFFENSE_CATEGORY[r.category] ?? r.category}{r.just_cause !== 'none' ? ` · Just cause: ${JUST_CAUSE[r.just_cause]}` : ''}</span>
                    {r.source_text && <span className="cell-sub">“{r.source_text}”{r.page ? ` (page ${r.page})` : ''}</span>}
                  </td>
                  <td><StatusBadge map={GRAVITY} value={r.gravity} /></td>
                  <td>{r.penalties.length ? r.penalties.map((p) => <span key={p.offense} className="cell-sub">{ordinal(p.offense)}: {penaltyText(p)}</span>) : <span className="muted">None given</span>}</td>
                  <td><StatusBadge map={RULE_STATUS} value={r.status} />{r.from_ai && <span className="cell-sub">Read by Claude</span>}</td>
                  <td>
                    {editable && (
                      <span className="row">
                        {r.status !== 'approved' && <button className="btn btn-sm btn-ok" type="button" onClick={() => setStatus([r.id], 'approved')}>Approve</button>}
                        {r.status !== 'rejected' && <button className="btn btn-sm btn-line" type="button" onClick={() => setStatus([r.id], 'rejected')}>Reject</button>}
                        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(r)}>Edit</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog open={editing !== null} wide title={editing === 'new' ? 'Add a rule' : editing ? `Edit ${editing.ref || 'the rule'}` : ''} onClose={() => setEditing(null)}>
        {editing && <RuleForm codeId={code.id} rule={editing === 'new' ? null : editing} nextSort={all.length + 1} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['offense-rules', code.id] }); }} />}
      </Dialog>
    </div>
  );
}

const ACTION_OPTIONS = options(PENALTY_ACTION);

function RuleForm({ codeId, rule, nextSort, onDone }: { codeId: string; rule: OffenseRule | null; nextSort: number; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({
    ref: rule?.ref ?? '', title: rule?.title ?? '', description: rule?.description ?? '', category: rule?.category ?? 'other',
    gravity: rule?.gravity ?? 'unclassified', just_cause: rule?.just_cause ?? 'none', source_text: rule?.source_text ?? '',
  });
  const [pens, setPens] = useState<Penalty[]>(rule?.penalties.length ? rule.penalties : [{ offense: 1, action: 'warning', days: 0, text: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setPen = (i: number, p: Partial<Penalty>) => setPens(pens.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (v.title.trim().length < 2) return setError('Name the offense.');
    const clean = pens.map((p, i) => ({ offense: i + 1, action: p.action, days: p.action === 'suspension' ? Number(p.days) || 0 : 0, text: (p.text ?? '').trim() }));
    if (clean.some((p) => p.action === 'suspension' && (p.days < 1 || p.days > 90))) return setError('A suspension is 1 to 90 days.');
    setBusy(true);
    const row = { ...v, ref: v.ref.trim(), title: v.title.trim(), description: v.description.trim(), source_text: v.source_text.trim(), penalties: clean };
    const { error: err } = rule
      ? await supabase.from('offense_rules').update(row).eq('id', rule.id)
      : await supabase.from('offense_rules').insert({ ...row, code_id: codeId, sort: nextSort, status: 'approved' });
    setBusy(false);
    if (err) return setError(errorText(err));
    toast(rule ? 'Rule saved.' : 'Rule added and approved.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row">
        <TextField label="Number in the code" optional value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder="A-1" />
        <TextField label="Offense" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </div>
      <TextArea label="What it covers" optional value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <div className="form-row">
        <SelectField label="Topic" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={options(OFFENSE_CATEGORY)} />
        <SelectField label="Class in the code" value={v.gravity} onChange={(e) => setV({ ...v, gravity: e.target.value })} options={options(GRAVITY)} />
        <SelectField label="Just cause (Art. 297), if dismissal is a penalty" value={v.just_cause} onChange={(e) => setV({ ...v, just_cause: e.target.value })} options={options(JUST_CAUSE)} />
      </div>
      <fieldset className="stack">
        <legend className="label">Penalty by offense count</legend>
        {pens.map((p, i) => (
          <div className="form-row" key={i}>
            <SelectField label={`${ordinal(i + 1)} offense`} value={p.action} onChange={(e) => setPen(i, { action: e.target.value })} options={ACTION_OPTIONS} />
            {p.action === 'suspension' && <TextField label="Days" type="number" min={1} max={90} value={String(p.days ?? '')} onChange={(e) => setPen(i, { days: Number(e.target.value) })} />}
            <TextField label="As the code words it" optional value={p.text ?? ''} onChange={(e) => setPen(i, { text: e.target.value })} />
          </div>
        ))}
        <span className="row">
          {pens.length < 10 && <button className="btn btn-line btn-sm" type="button" onClick={() => setPens([...pens, { offense: pens.length + 1, action: 'suspension', days: 3, text: '' }])}>Add the next offense</button>}
          {pens.length > 1 && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPens(pens.slice(0, -1))}>Remove the last</button>}
        </span>
      </fieldset>
      <TextArea label="The code's words" optional value={v.source_text} onChange={(e) => setV({ ...v, source_text: e.target.value })} />
      {rule?.from_ai && <p className="muted small">Proposed by Claude. Saving keeps your changes; the review status stays as it is.</p>}
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>{rule ? 'Save the rule' : 'Add the rule'}</button></div>
    </form>
  );
}

