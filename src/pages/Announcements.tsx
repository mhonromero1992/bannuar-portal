import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDateTime } from '../lib/format';
import { ANN_CATEGORY, ANN_PRIORITY, ANN_STATUS, options } from '../lib/labels';
import { useAreas, useSites } from '../lib/refs';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, SelectField, StatusBadge, TextArea, TextField, useToast } from '../ui/kit';

interface Ann {
  id: string; title: string; body: string; category: string; priority: string; audience: string; area_ids: string[]; site_ids: string[];
  requires_ack: boolean; pinned: boolean; status: string; published_at: string | null; expires_at: string | null; created_at: string;
}

function Stats({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['ann-stats', id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('announcement_stats', { p_announcement_id: id });
      if (error) throw error;
      return (data as { audience_count: number; read_count: number; acknowledged_count: number }[])[0];
    },
  });
  if (!q.data) return <span className="muted small">…</span>;
  return <span className="tabular small">{q.data.read_count} of {q.data.audience_count} read · {q.data.acknowledged_count} acknowledged</span>;
}

export default function Announcements() {
  const { can } = useAuth();
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Ann | 'new' | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['announcements', filter],
    queryFn: async () => {
      let req = supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100);
      if (filter) req = req.eq('status', filter);
      const { data, error } = await req;
      if (error) throw error;
      return data as Ann[];
    },
  });
  const setStatus = async (a: Ann, status: string) => {
    if (status === 'published' && !confirm(`Publish "${a.title}"? Everyone it is meant for gets a notification now.`)) return;
    const { error } = await supabase.from('announcements').update({ status }).eq('id', a.id);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['announcements'] });
    toast(status === 'published' ? 'Published.' : 'Archived.');
  };
  return (
    <>
      <PageHead title="Announcements" intro="Memos and advisories for every guard, an area, or chosen posts. They reach the Bannuar app with a notification."
        actions={can.publish && <button className="btn" type="button" onClick={() => setEditing('new')}>Write an announcement</button>} />
      <div className="panel">
        <div className="toolbar">
          <select className="select" style={{ width: 'auto' }} aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Every announcement</option>
            {options(ANN_STATUS).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? (
          <Empty title="No announcements yet">{can.publish ? 'Write the first one.' : null}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Announcement</th><th>For</th><th>Status</th><th>Reach</th><th /></tr></thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.title}</b> {a.pinned && <Badge tone="info">Pinned</Badge>}
                      <span className="cell-sub">{ANN_CATEGORY[a.category]} · {a.priority !== 'normal' && <StatusBadge map={ANN_PRIORITY} value={a.priority} />} {a.requires_ack && <Badge tone="info">Acknowledgment</Badge>}</span>
                    </td>
                    <td>{a.audience === 'all' ? 'Everyone' : a.audience === 'areas' ? `${a.area_ids.length} area(s)` : `${a.site_ids.length} post(s)`}</td>
                    <td><StatusBadge map={ANN_STATUS} value={a.status} />{a.published_at && <span className="cell-sub">{fmtDateTime(a.published_at)}</span>}</td>
                    <td>{a.status === 'published' ? <Stats id={a.id} /> : <span className="muted small">Not sent</span>}</td>
                    <td>{can.publish && (
                      <span className="row">
                        {a.status === 'draft' && <button className="btn btn-sm" type="button" onClick={() => setStatus(a, 'published')}>Publish</button>}
                        {a.status !== 'archived' && <button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(a)}>Edit</button>}
                        {a.status === 'published' && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setStatus(a, 'archived')}>Archive</button>}
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog open={Boolean(editing)} title={editing === 'new' ? 'Write an announcement' : 'Edit the announcement'} onClose={() => setEditing(null)} wide>
        {editing && <Composer ann={editing === 'new' ? null : editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['announcements'] }); }} />}
      </Dialog>
    </>
  );
}

function Composer({ ann, onDone }: { ann: Ann | null; onDone: () => void }) {
  const toast = useToast();
  const areas = useAreas();
  const sites = useSites();
  const [v, setV] = useState({
    title: ann?.title ?? '', body: ann?.body ?? '', category: ann?.category ?? 'memo', priority: ann?.priority ?? 'normal',
    audience: ann?.audience ?? 'all', area_ids: ann?.area_ids ?? [], site_ids: ann?.site_ids ?? [], requires_ack: ann?.requires_ack ?? false,
    pinned: ann?.pinned ?? false, expires_at: ann?.expires_at?.slice(0, 10) ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (k: 'area_ids' | 'site_ids', id: string) => setV({ ...v, [k]: v[k].includes(id) ? v[k].filter((x) => x !== id) : [...v[k], id] });
  const save = async (publish: boolean) => {
    setError('');
    if (!v.title.trim() || !v.body.trim()) return setError('Write a title and the message.');
    if (v.audience === 'areas' && !v.area_ids.length) return setError('Choose at least one area.');
    if (v.audience === 'sites' && !v.site_ids.length) return setError('Choose at least one post.');
    if (publish && !confirm('Publish now? Everyone it is meant for gets a notification.')) return;
    const row = { ...v, title: v.title.trim(), body: v.body.trim(), expires_at: v.expires_at ? `${v.expires_at}T23:59:59+08:00` : null, ...(publish ? { status: 'published' } : {}) };
    setBusy(true);
    const res = ann ? await supabase.from('announcements').update(row).eq('id', ann.id) : await supabase.from('announcements').insert({ ...row, status: publish ? 'published' : 'draft' });
    setBusy(false);
    if (res.error) return setError(errorText(res.error));
    toast(publish ? 'Published. Notifications are on their way.' : 'Saved as a draft.');
    onDone();
  };
  const submit = (e: FormEvent) => { e.preventDefault(); save(false); };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <TextField label="Title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={140} />
      <TextArea label="Message" value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} rows={7} hint="The first 140 characters show in the phone notification." />
      <div className="form-row">
        <SelectField label="Kind" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} options={options(ANN_CATEGORY)} />
        <SelectField label="Priority" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} options={options(ANN_PRIORITY)} />
        <TextField label="Hide after" optional type="date" value={v.expires_at} onChange={(e) => setV({ ...v, expires_at: e.target.value })} />
      </div>
      <SelectField label="Who it is for" value={v.audience} onChange={(e) => setV({ ...v, audience: e.target.value })} options={[{ value: 'all', label: 'Every employee' }, { value: 'areas', label: 'Chosen areas' }, { value: 'sites', label: 'Chosen posts' }]} />
      {v.audience === 'areas' && <fieldset className="field"><legend className="field-label">Areas</legend><div className="checks">{(areas.data ?? []).map((a) => <label key={a.id} className="check"><input type="checkbox" checked={v.area_ids.includes(a.id)} onChange={() => toggle('area_ids', a.id)} /> {a.name}</label>)}</div></fieldset>}
      {v.audience === 'sites' && <fieldset className="field"><legend className="field-label">Posts</legend><div className="checks">{(sites.data ?? []).filter((s) => s.is_active).map((s) => <label key={s.id} className="check"><input type="checkbox" checked={v.site_ids.includes(s.id)} onChange={() => toggle('site_ids', s.id)} /> {s.name}</label>)}</div></fieldset>}
      <div className="checks">
        <label className="check"><input type="checkbox" checked={v.requires_ack} onChange={(e) => setV({ ...v, requires_ack: e.target.checked })} /> Ask each employee to acknowledge it</label>
        <label className="check"><input type="checkbox" checked={v.pinned} onChange={(e) => setV({ ...v, pinned: e.target.checked })} /> Pin to the top</label>
      </div>
      <div className="form-foot">
        {(!ann || ann.status === 'draft') && <button className="btn btn-line" type="submit" aria-busy={busy}>Save as a draft</button>}
        {ann?.status === 'published' ? <button className="btn" type="button" aria-busy={busy} onClick={() => save(false)}>Save changes</button> : <button className="btn" type="button" aria-busy={busy} onClick={() => save(true)}>Publish now</button>}
      </div>
    </form>
  );
}
