import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { post, signFiles } from '../lib/files';
import { errorText, fmtDate, fmtDateTime, fullName } from '../lib/format';
import { LOGBOOK_MATCH, LOGBOOK_STATUS } from '../lib/labels';
import { Badge, Dialog, Empty, ErrorState, Loading, SelectField, StatusBadge, TextArea, TextField, useToast } from '../ui/kit';

/**
 * The post logbook (schema.sql section 21, the logbook-ai function): a photo of a page of the written
 * logbook kept at a post goes to Claude, which copies each guard's line; the database matches the
 * names to the post's guards and compares the times with the app. HR adds what the app missed (marked
 * "logbook", for payroll to decide); operations corrects misread lines; a client sends pages of its own
 * posts and sees how they compare.
 */
export interface LogbookLine {
  id: string; line_no: number; written_name: string; written_no: string; date: string | null; time_in: string | null; time_out: string | null;
  remarks: string; unclear: boolean; employee_id: string | null; employee_no: string | null; name: string | null;
  matched_by: 'number' | 'name' | 'hr' | null; match: string; app_time_in: string | null; app_time_out: string | null;
}
export interface LogbookPage {
  id: string; site_id: string; post: string; client: string | null; file_key: string; status: string; page_date: string | null;
  legibility: string | null; concerns: string[]; from_client: boolean; uploader: string | null; created_at: string; read_at: string | null;
  checked_at: string | null; note: string | null; lines: LogbookLine[];
}
export interface LogbookRow {
  id: string; site_id: string; post: string; client: string | null; status: string; page_date: string | null; from_client: boolean;
  uploader: string | null; created_at: string; checked_at: string | null;
  lines: number; confirmed: number; differs: number; not_in_app: number; unmatched: number; added: number;
}
type Sent = { status: 'read'; page: LogbookPage } | { status: 'failed'; page_id: string; message: string };

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Sends a photo of a page; Claude reads it before this returns (up to a minute). */
export async function sendLogbookPage(siteId: string, file: Blob): Promise<Sent> {
  const form = new FormData();
  form.set('site_id', siteId);
  form.set('file', file, 'logbook-page');
  return (await (await post('logbook-ai', form)).json()) as Sent;
}
const readAgain = async (pageId: string): Promise<Sent> =>
  (await (await post('logbook-ai', JSON.stringify({ action: 'read', page_id: pageId }))).json()) as Sent;

const sentPageId = (r: Sent) => (r.status === 'read' ? r.page.id : r.page_id);
const hm = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const manila = (iso: string | null, day: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const t = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(d);
  const on = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(d);
  return on === day ? t : `${t}, ${fmtDate(on)}`;
};
const span = (a: string, b: string) => (a && b ? `${a} to ${b}` : a || b || '');
/** Demo pages (seed-demo.sql) have no photo: their lines are drawn as a handwritten page, marked as a drawing. */
const DEMO_PAGE = /^demo\//;

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const written = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};
const cut = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}.` : v);

/**
 * A demo page drawn as a guard would write it: the post, the date and one line per duty, in ballpoint on a
 * ruled record book. A line Claude marked unclear has its time in written over. Labelled as a drawing.
 */
export function DemoLogbookDrawing({ page }: { page: Pick<LogbookPage, 'post' | 'page_date' | 'lines'> }) {
  const short = page.post.split('·').pop()!.trim();
  const ink = ['#20398a', '#1c1c22', '#20398a', '#2b3a73', '#1c1c22'];
  const rule = (k: number) => 200 + 40 * k;
  return (
    <svg className="demo-hand" viewBox="0 0 600 800" role="img" aria-label={`Demo: a drawing of a logbook page of ${page.post}, not a photo`}>
      <defs>
        <linearGradient id="demo-desk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4d3f33" /><stop offset="1" stopColor="#2b231d" /></linearGradient>
        <linearGradient id="demo-fold" x1="0" x2="1"><stop offset="0" stopColor="#d6cbb0" /><stop offset="1" stopColor="#fbf7ec" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="600" height="800" fill="url(#demo-desk)" />
      <g transform="rotate(-1.1 300 400)">
        <rect x="44" y="34" width="520" height="736" rx="3" fill="#000" opacity="0.28" transform="translate(6 8)" />
        <rect x="44" y="34" width="520" height="736" rx="3" fill="#fbf7ec" />
        <rect x="44" y="34" width="34" height="736" fill="url(#demo-fold)" />
        {Array.from({ length: 15 }, (_, k) => <line key={k} x1="44" x2="564" y1={rule(k)} y2={rule(k)} stroke="#a9c6e3" strokeWidth="1" />)}
        <line x1="104" x2="104" y1="34" y2="770" stroke="#df8f8f" strokeWidth="1.3" />
        <g className="hand" fill={ink[0]}>
          <text x="118" y="92" fontSize="40">{cut(short, 22)} Logbook</text>
          <path d="M118 102 q 120 6 250 -2" stroke={ink[0]} strokeWidth="2" fill="none" strokeLinecap="round" />
          <text x="118" y="146" fontSize="28">{page.page_date ? `Date: ${fmtDate(page.page_date)}` : 'Date:'}</text>
          <text x="110" y={rule(0) - 8} fontSize="21" fill={ink[1]}>DATE</text>
          <text x="184" y={rule(0) - 8} fontSize="21" fill={ink[1]}>NAME</text>
          <text x="326" y={rule(0) - 8} fontSize="21" fill={ink[1]}>IN</text>
          <text x="402" y={rule(0) - 8} fontSize="21" fill={ink[1]}>OUT</text>
          <text x="484" y={rule(0) - 8} fontSize="19" fill={ink[1]}>REMARKS</text>
          {page.lines.slice(0, 13).map((l, i) => {
            const y = rule(i + 1) - 8;
            const tilt = (((l.line_no * 37) % 7) - 3) * 0.3;
            const dx = ((l.line_no * 13) % 7) - 3;
            const color = ink[l.line_no % ink.length];
            return (
              <g key={l.id} transform={`rotate(${tilt} 330 ${y}) translate(${dx} 0)`} fill={color}>
                <text x="110" y={y} fontSize="26">{md(l.date)}</text>
                <text x="184" y={y} fontSize="30">{cut(l.written_name || l.written_no, 12)}</text>
                <text x="326" y={y} fontSize="26">{written(l.time_in)}</text>
                {l.unclear && l.time_in && (
                  <>
                    <text x="328" y={y - 2} fontSize="26" opacity="0.75">{written(l.time_in)}</text>
                    <path d={`M326 ${y - 10} q 10 -8 20 0 t 20 0`} stroke={color} strokeWidth="2.4" fill="none" />
                  </>
                )}
                <text x="402" y={y} fontSize="26">{written(l.time_out)}</text>
                <text x="486" y={y} fontSize={l.remarks.length > 7 ? 18 : 23}>{cut(l.remarks, 12)}</text>
              </g>
            );
          })}
        </g>
        <text x="552" y="758" fontSize="12" textAnchor="end" fill="#8a8170" fontFamily="system-ui, sans-serif">DEMO · a drawing for the example, not a photo</text>
      </g>
    </svg>
  );
}

/** Choose the post, take or choose the photo, send. */
export function LogbookSend({ posts, onDone }: { posts: { id: string; name: string }[]; onDone: (r: Sent) => void }) {
  const [site, setSite] = useState(posts.length === 1 ? posts[0].id : '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!site) return setError('Choose the post.');
    if (!file) return setError('Take or choose a photo of the page.');
    if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return setError('Claude cannot read this photo format (HEIC). Take the photo again as JPEG (on an iPhone: Settings, Camera, Formats, Most Compatible).');
    if (file.size > 5 * 1024 * 1024) return setError('The photo is too large: up to 5 MB. Take it again at a lower resolution.');
    setBusy(true);
    try {
      onDone(await sendLogbookPage(site, file));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      {posts.length !== 1 && (
        <SelectField label="Post" value={site} onChange={(e) => setSite(e.target.value)} placeholder="Choose the post" options={posts.map((p) => ({ value: p.id, label: p.name }))} />
      )}
      <div className="field">
        <label htmlFor="logbook-photo">Photo of the logbook page</label>
        <input id="logbook-photo" className="input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="hint">One page at a time: flat, in good light, the whole page in the frame. JPEG, PNG or WebP, up to 5 MB.</p>
      </div>
      <p className="muted small">Claude copies each guard's line (name, date, time in and out). The names are matched to the post's guards here, not by Claude, and each line is compared with the time in and out in the app.</p>
      <div className="form-foot">
        {busy && <span className="muted small" role="status">Claude is reading the page. This takes up to a minute.</span>}
        <button className="btn" type="submit" aria-busy={busy} disabled={busy}>Send the page</button>
      </div>
    </form>
  );
}

/** One page: the photo, and each line Claude read beside the app's time. Staff correct and add; a client reads. */
export function LogbookPageView({ pageId, role }: { pageId: string; role: 'hr' | 'ops' | 'client' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const staff = role !== 'client';
  const q = useQuery({ queryKey: ['logbook-page', pageId], queryFn: () => rpc<LogbookPage>('logbook_page_detail', { p_page_id: pageId }) });
  const page = q.data;
  const demo = DEMO_PAGE.test(page?.file_key ?? '');
  const photo = useQuery({
    queryKey: ['logbook-photo', page?.file_key],
    enabled: Boolean(page?.file_key) && !demo,
    queryFn: async () => (await signFiles([page!.file_key]))[page!.file_key] ?? null,
    staleTime: 240_000,
  });
  const guards = useQuery({
    queryKey: ['logbook-guards', page?.site_id],
    enabled: staff && Boolean(page?.site_id),
    queryFn: async () => {
      const { data, error } = await supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix').eq('site_id', page!.site_id).order('last_name');
      if (error) throw error;
      return data;
    },
  });
  const [pick, setPick] = useState<string[]>([]);
  const [editing, setEditing] = useState<LogbookLine | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['logbook-page', pageId] });
    qc.invalidateQueries({ queryKey: ['logbook-pages'] });
  };
  if (q.isLoading) return <Loading what="Opening the page" />;
  if (q.error || !page) return <ErrorState error={errorText(q.error)} retry={() => q.refetch()} />;

  const addable = page.lines.filter((l) => l.match === 'not_in_app' && l.employee_id && l.date && l.time_in);
  const count = (m: string) => page.lines.filter((l) => l.match === m).length;
  const again = async () => {
    setBusy('Claude is reading the page again…');
    try {
      const r = await readAgain(page.id);
      if (r.status === 'failed') toast(r.message, 'error');
      refresh();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const add = async () => {
    const chosen = addable.filter((l) => pick.includes(l.id));
    if (!chosen.length || !confirm(`Add ${chosen.length} ${chosen.length === 1 ? 'duty' : 'duties'} from the logbook? Each is marked "From the logbook" for payroll to decide, and the guard is told.`)) return;
    setBusy('Adding…');
    const { data, error } = await supabase.rpc('add_logbook_logs', { p_page_id: page.id, p_line_ids: chosen.map((l) => l.id) });
    setBusy('');
    if (error) return toast(errorText(error), 'error');
    toast(`${data} ${data === 1 ? 'duty' : 'duties'} added from the logbook. Payroll decides them on the cutoff page.`);
    setPick([]);
    refresh();
    qc.invalidateQueries({ queryKey: ['attendance'] });
  };

  return (
    <div className="stack logbook-page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <b>{page.post}</b>{page.client && <span className="muted"> · {page.client}</span>}
          <span className="cell-sub">
            {page.page_date ? `Page of ${fmtDate(page.page_date)}` : 'No date on the page'} · sent {fmtDateTime(page.created_at)}
            {page.from_client ? ` by the client${page.uploader ? ` (${page.uploader})` : ''}` : page.uploader ? ` by ${page.uploader}` : ''}
          </span>
        </div>
        <StatusBadge map={LOGBOOK_STATUS} value={page.status} />
      </div>
      <div className="logbook-grid">
        <div className="logbook-photo">
          {demo ? <DemoLogbookDrawing page={page} />
            : photo.data ? <a href={photo.data} target="_blank" rel="noreferrer"><img src={photo.data} alt={`The logbook page of ${page.post}`} /></a>
            : <div className="logbook-photo-none muted small">{photo.isLoading ? 'Opening the photo…' : 'The photo is not available here.'}</div>}
        </div>
        <div className="stack" style={{ minWidth: 0 }}>
          {page.status === 'failed' || page.status === 'reading' ? (
            <div className="callout warn">This page has not been read yet. <button className="link-btn" type="button" onClick={again} disabled={Boolean(busy)}>Read it again</button></div>
          ) : (
            <p className="row small" role="status">
              <StatusBadge map={LOGBOOK_MATCH} value="confirmed" /> {count('confirmed')}
              <StatusBadge map={LOGBOOK_MATCH} value="differs" /> {count('differs')}
              <StatusBadge map={LOGBOOK_MATCH} value="not_in_app" /> {count('not_in_app')}
              {count('added') > 0 && <><StatusBadge map={LOGBOOK_MATCH} value="added" /> {count('added')}</>}
              {count('no_guard') + count('unclear') > 0 && <><StatusBadge map={LOGBOOK_MATCH} value="no_guard" /> {count('no_guard') + count('unclear')}</>}
            </p>
          )}
          {page.legibility === 'partly_readable' && <p className="callout small">Some of this page is hard to read. Check the lines marked "hard to read" against the photo.</p>}
          {page.concerns.length > 0 && (
            <div className="callout warn small"><b>Claude noticed:</b><ul>{page.concerns.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
          )}
          {page.note && <p className="callout small"><b>Bannuar's note:</b> {page.note}</p>}
        </div>
      </div>

      {page.lines.length === 0 ? <Empty title="No attendance lines on this page">Claude found no guard's time in or out on it.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{role === 'hr' && <th aria-label="Add" />}<th>Line</th><th>Written</th><th>Guard</th><th>Logbook</th><th>App</th><th>Result</th>{staff && <th />}</tr></thead>
            <tbody>{page.lines.map((l) => (
              <tr key={l.id}>
                {role === 'hr' && <td>{addable.includes(l) && <input type="checkbox" aria-label={`Add line ${l.line_no}`} checked={pick.includes(l.id)} onChange={(e) => setPick(e.target.checked ? [...pick, l.id] : pick.filter((x) => x !== l.id))} />}</td>}
                <td className="tabular">{l.line_no}</td>
                <td>{l.written_name || l.written_no || <span className="muted">No name</span>}{l.written_no && l.written_name ? <span className="cell-sub tabular">{l.written_no}</span> : null}
                  {l.remarks && <span className="cell-sub">“{l.remarks}”</span>}{l.unclear && <span className="cell-sub"><Badge tone="warn">Hard to read</Badge></span>}</td>
                <td>{l.name ? <>{l.name}<span className="cell-sub tabular">{l.employee_no}{l.matched_by === 'hr' ? ' · chosen by Bannuar' : ''}</span></> : <span className="muted">Not matched</span>}</td>
                <td className="tabular">{l.date ? fmtDate(l.date) : <span className="muted">No date</span>}<span className="cell-sub">{span(hm(l.time_in), hm(l.time_out)) || 'No times'}</span></td>
                <td className="tabular">{l.app_time_in || l.app_time_out ? span(manila(l.app_time_in, l.date), manila(l.app_time_out, l.date)) : <span className="muted">None</span>}</td>
                <td><StatusBadge map={LOGBOOK_MATCH} value={l.match} /></td>
                {staff && <td>{l.match !== 'added' && <button className="link-btn" type="button" onClick={() => setEditing(l)}>Correct</button>}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="form-foot">
        {busy && <span className="muted small" role="status">{busy}</span>}
        {role !== 'client' && page.status !== 'checked' && page.status !== 'failed' && page.status !== 'reading' && <button className="btn btn-line" type="button" onClick={() => setChecking(true)}>Mark as checked</button>}
        {role === 'hr' && addable.length > 0 && <button className="btn" type="button" disabled={!pick.length || Boolean(busy)} onClick={add}>Add {pick.length || ''} to attendance</button>}
      </div>
      {role === 'hr' && addable.length > 0 && <p className="muted small">Tick the lines not in the app to add them: a time in (and the time out, if written) at this post, marked "From the logbook". Payroll then counts them, or not, on the cutoff page.</p>}

      <Dialog open={Boolean(editing)} title={editing ? `Correct line ${editing.line_no}` : ''} onClose={() => setEditing(null)}>
        {editing && <LineEditor line={editing} guards={(guards.data ?? []).map((g) => ({ id: g.id, label: `${fullName(g)} · ${g.employee_no}` }))}
          onDone={() => { setEditing(null); refresh(); }} />}
      </Dialog>
      <Dialog open={checking} title="Mark the page as checked" onClose={() => setChecking(false)}>
        {checking && <CheckForm pageId={page.id} onDone={() => { setChecking(false); refresh(); }} />}
      </Dialog>
    </div>
  );
}

/** HR or operations fixes what Claude misread: the guard, the date, the times. */
function LineEditor({ line, guards, onDone }: { line: LogbookLine; guards: { id: string; label: string }[]; onDone: () => void }) {
  const toast = useToast();
  const list = line.employee_id && !guards.some((g) => g.id === line.employee_id) ? [{ id: line.employee_id, label: `${line.name} · ${line.employee_no}` }, ...guards] : guards;
  const [v, setV] = useState({ employee: line.employee_id ?? '', date: line.date ?? '', in: line.time_in ?? '', out: line.time_out ?? '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error: err } = await supabase.rpc('update_logbook_line', {
      p_line_id: line.id, p_employee_id: v.employee || null, p_date: v.date || null, p_time_in: v.in || null, p_time_out: v.out || null,
    });
    setBusy(false);
    if (err) return setError(errorText(err));
    toast('Line corrected and compared again.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted small">Written: “{line.written_name || line.written_no || 'no name'}”{line.remarks ? `, “${line.remarks}”` : ''}. Check it against the photo.</p>
      <SelectField label="Guard" value={v.employee} onChange={(e) => setV({ ...v, employee: e.target.value })} placeholder="Not one of the post's guards" options={list.map((g) => ({ value: g.id, label: g.label }))} />
      <div className="form-row">
        <TextField label="Date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
        <TextField label="Time in" type="time" value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} />
        <TextField label="Time out" type="time" value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} />
      </div>
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Save the line</button></div>
    </form>
  );
}

function CheckForm({ pageId, onDone }: { pageId: string; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.rpc('check_logbook_page', { p_page_id: pageId, p_note: note.trim() || null });
    if (err) return setError(errorText(err));
    toast('Page marked as checked.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <TextArea label="Note" optional hint="For example: line 4 is a reliever from another agency. The client sees this note." value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="form-foot"><button className="btn" type="submit">Mark as checked</button></div>
    </form>
  );
}

/** The pages sent, newest first. */
export function LogbookList({ rows, onOpen, showClient = true }: { rows: LogbookRow[]; onOpen: (id: string) => void; showClient?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Sent</th><th>Post</th><th>Page of</th><th>Lines</th><th>Compared with the app</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td className="tabular">{fmtDateTime(r.created_at)}<span className="cell-sub">{r.from_client ? 'From the client' : 'By Bannuar'}{r.uploader ? ` · ${r.uploader}` : ''}</span></td>
            <td>{r.post}{showClient && r.client && <span className="cell-sub">{r.client}</span>}</td>
            <td className="tabular">{r.page_date ? fmtDate(r.page_date) : '–'}</td>
            <td className="num">{r.lines}</td>
            <td className="small">
              {r.confirmed} match{r.differs ? ` · ${r.differs} different` : ''}{r.not_in_app ? ` · ${r.not_in_app} not in the app` : ''}{r.added ? ` · ${r.added} added` : ''}{r.unmatched ? ` · ${r.unmatched} not matched` : ''}
            </td>
            <td><StatusBadge map={LOGBOOK_STATUS} value={r.status} /></td>
            <td><button className="link-btn" type="button" onClick={() => onOpen(r.id)}>Open</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** Attendance → Post logbooks (HR portal), and the client portal's Logbook view. */
export function LogbooksPanel({ posts, role }: { posts: { id: string; name: string }[]; role: 'hr' | 'ops' | 'client' | 'view' }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ['logbook-pages'], queryFn: () => rpc<LogbookRow[]>('logbook_pages_list', { p_limit: 100 }) });
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const canSend = role !== 'view';
  const done = (r: Sent) => {
    setSending(false);
    qc.invalidateQueries({ queryKey: ['logbook-pages'] });
    if (r.status === 'failed') toast(r.message, 'error');
    setOpen(sentPageId(r));
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{role === 'client' ? 'Your posts\' logbooks' : 'Post logbooks'}</h2>
        {canSend && <button className="btn" type="button" onClick={() => setSending(true)} disabled={!posts.length}>Send a logbook page</button>}
      </div>
      <p className="muted small" style={{ margin: '0 18px 12px' }}>
        {role === 'client'
          ? 'Take a photo of a page of your post\'s logbook. Claude reads each guard\'s time in and out, and you see how it compares with the times the guards logged in Bannuar\'s app. Bannuar checks every page and adds what the app missed.'
          : 'A photo of a page of a post\'s written logbook, read by Claude and compared line by line with the time in and out in the app. Clients send pages from their portal too.'}
      </p>
      {list.isLoading ? <Loading what="Loading the pages" /> : list.error ? <ErrorState error={errorText(list.error)} retry={() => list.refetch()} /> : !list.data?.length ? (
        <Empty title="No logbook pages yet">{canSend ? 'Send a page to compare it with the app.' : 'Pages sent by HR, operations and clients appear here.'}</Empty>
      ) : <LogbookList rows={list.data} onOpen={setOpen} showClient={role !== 'client'} />}
      <Dialog open={sending} title="Send a logbook page" onClose={() => setSending(false)}>
        {sending && <LogbookSend posts={posts} onDone={done} />}
      </Dialog>
      <Dialog open={Boolean(open)} title="Logbook page" onClose={() => setOpen(null)} wide>
        {open && <LogbookPageView pageId={open} role={role === 'view' ? 'client' : role} />}
      </Dialog>
    </div>
  );
}
