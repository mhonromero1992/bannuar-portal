import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate } from '../lib/format';
import { useAreas } from '../lib/refs';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, SelectField, Tabs, TextArea, TextField, useToast } from '../ui/kit';

export interface Site { id: string; name: string; code: string | null; client_id: string | null; area_id: string | null; address: string | null; city: string | null; province: string | null; region: string | null; guards_required: number; is_active: boolean; notes: string | null; latitude: number | null; longitude: number | null; geofence_radius_m: number }

export function useClients() {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });
}

export default function Posts() {
  const [tab, setTab] = useState<'posts' | 'clients'>('posts');
  return (
    <>
      <PageHead title="Posts and clients" intro="Where Bannuar's guards are deployed, how many each post needs, and who commands it." />
      <Tabs label="Posts and clients" tabs={[{ id: 'posts', label: 'Posts' }, { id: 'clients', label: 'Clients' }]} value={tab} onChange={setTab} />
      {tab === 'posts' ? <PostList /> : <ClientList />}
    </>
  );
}

function PostList() {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['site-staffing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_staffing').select('*').order('name');
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="panel">
      {can.ops && <div className="panel-head"><span className="muted small">A post is short when fewer guards are assigned than it needs.</span><button className="btn btn-sm" type="button" onClick={() => setAdding(true)}>Add a post</button></div>}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No posts yet">{can.ops ? 'Add the client sites where guards are deployed.' : null}</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Post</th><th>Client</th><th>Area</th><th className="num">Guards</th><th>Commander</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((s) => {
              const short = s.is_active && s.guards_assigned < s.guards_required;
              return (
                <tr key={s.id}>
                  <td><Link className="cell-main" to={`/posts/${s.id}`}>{s.name}</Link><span className="cell-sub">{[s.code, s.city, s.province].filter(Boolean).join(' · ')}</span></td>
                  <td>{s.client_name ?? <span className="muted">None</span>}</td>
                  <td>{s.area_name ?? <span className="muted">None</span>}</td>
                  <td className="num">{s.guards_assigned} of {s.guards_required} {short && <Badge tone="warn">Short</Badge>}</td>
                  <td>{s.supervisors ? `${s.supervisors} named` : <span className="muted">None</span>}</td>
                  <td>{s.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <Dialog open={adding} title="Add a post" onClose={() => setAdding(false)} wide>
        <SiteForm onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ['site-staffing'] }); qc.invalidateQueries({ queryKey: ['sites-list'] }); }} />
      </Dialog>
    </div>
  );
}

export function SiteForm({ site, onDone }: { site?: Site; onDone: () => void }) {
  const toast = useToast();
  const areas = useAreas();
  const clients = useClients();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!f.name.trim()) return setError('Enter the post name.');
    const row = {
      name: f.name.trim(), code: f.code.trim() || null, client_id: f.client_id || null, area_id: f.area_id || null, address: f.address.trim() || null,
      city: f.city.trim() || null, province: f.province.trim() || null, region: f.region.trim() || null, guards_required: Number(f.guards_required || 0),
      latitude: f.latitude ? Number(f.latitude) : null, longitude: f.longitude ? Number(f.longitude) : null, is_active: f.is_active === 'yes', notes: f.notes.trim() || null,
    };
    setBusy(true);
    const res = site ? await supabase.from('sites').update(row).eq('id', site.id) : await supabase.from('sites').insert(row);
    setBusy(false);
    if (res.error) return setError(res.error.code === '23505' ? 'Another post already uses this code.' : errorText(res.error));
    toast('Post saved.');
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row">
        <TextField label="Post name" name="name" defaultValue={site?.name} placeholder="Client name · Main gate" />
        <TextField label="Code" name="code" optional defaultValue={site?.code ?? ''} />
        <TextField label="Guards needed" name="guards_required" type="number" min="0" defaultValue={site?.guards_required ?? 1} />
      </div>
      <div className="form-row">
        <SelectField label="Client" name="client_id" optional defaultValue={site?.client_id ?? ''} placeholder="None" options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField label="Area" name="area_id" optional defaultValue={site?.area_id ?? ''} placeholder="None" options={(areas.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        <SelectField label="Status" name="is_active" defaultValue={site?.is_active === false ? 'no' : 'yes'} options={[{ value: 'yes', label: 'Active' }, { value: 'no', label: 'Inactive' }]} />
      </div>
      <TextField label="Address" name="address" optional defaultValue={site?.address ?? ''} />
      <div className="form-row">
        <TextField label="City or town" name="city" optional defaultValue={site?.city ?? ''} />
        <TextField label="Province" name="province" optional defaultValue={site?.province ?? ''} />
        <TextField label="Region (for the wage order)" name="region" optional defaultValue={site?.region ?? ''} />
      </div>
      <div className="form-row">
        <TextField label="Latitude" name="latitude" optional type="number" step="0.000001" defaultValue={site?.latitude ?? ''} hint="For clock-in at the post, later in the app." />
        <TextField label="Longitude" name="longitude" optional type="number" step="0.000001" defaultValue={site?.longitude ?? ''} />
      </div>
      <TextArea label="Notes" name="notes" optional defaultValue={site?.notes ?? ''} rows={2} />
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Save the post</button></div>
    </form>
  );
}

function ClientList() {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useClients();
  const [editing, setEditing] = useState<Record<string, unknown> | 'new' | null>(null);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!f.name.trim()) return toast('Enter the client name.', 'error');
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()]));
    const res = editing === 'new' ? await supabase.from('clients').insert(row) : await supabase.from('clients').update(row).eq('id', (editing as { id: string }).id);
    if (res.error) return toast(errorText(res.error), 'error');
    qc.invalidateQueries({ queryKey: ['clients'] });
    toast('Client saved.');
    setEditing(null);
  };
  const c = editing && editing !== 'new' ? (editing as Record<string, string>) : ({} as Record<string, string>);
  return (
    <div className="panel">
      {can.ops && <div className="panel-head"><span className="muted small">Client contacts are seen by office staff only.</span><button className="btn btn-sm" type="button" onClick={() => setEditing('new')}>Add a client</button></div>}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : !q.data?.length ? <Empty title="No clients yet" /> : (
        <table className="table">
          <thead><tr><th>Client</th><th>Contact</th><th>Contract</th><th>Status</th><th /></tr></thead>
          <tbody>{q.data.map((x) => (
            <tr key={x.id}>
              <td><b>{x.name}</b>{x.industry && <span className="cell-sub">{x.industry}</span>}</td>
              <td>{x.contact_person}<span className="cell-sub">{[x.contact_phone, x.contact_email].filter(Boolean).join(' · ')}</span></td>
              <td className="tabular">{x.contract_start ? `${fmtDate(x.contract_start)} to ${fmtDate(x.contract_end) || 'open'}` : ''}</td>
              <td><Badge tone={x.status === 'active' ? 'ok' : x.status === 'prospect' ? 'info' : 'neutral'}>{x.status[0].toUpperCase() + x.status.slice(1)}</Badge></td>
              <td>{can.ops && <button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(x)}>Edit</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Dialog open={Boolean(editing)} title={editing === 'new' ? 'Add a client' : 'Edit the client'} onClose={() => setEditing(null)}>
        {editing && (
          <form className="form" onSubmit={save} key={c.id ?? 'new'}>
            <div className="form-row"><TextField label="Name" name="name" defaultValue={c.name} /><TextField label="Industry" name="industry" optional defaultValue={c.industry ?? ''} /></div>
            <div className="form-row"><TextField label="Contact person" name="contact_person" optional defaultValue={c.contact_person ?? ''} /><TextField label="Phone" name="contact_phone" optional defaultValue={c.contact_phone ?? ''} /><TextField label="Email" name="contact_email" optional defaultValue={c.contact_email ?? ''} /></div>
            <TextField label="Address" name="address" optional defaultValue={c.address ?? ''} />
            <div className="form-row">
              <TextField label="Contract from" name="contract_start" optional type="date" defaultValue={c.contract_start ?? ''} />
              <TextField label="Contract until" name="contract_end" optional type="date" defaultValue={c.contract_end ?? ''} />
              <SelectField label="Status" name="status" defaultValue={c.status ?? 'active'} options={[{ value: 'prospect', label: 'Prospect' }, { value: 'active', label: 'Active' }, { value: 'ended', label: 'Ended' }]} />
            </div>
            <TextArea label="Notes" name="notes" optional defaultValue={c.notes ?? ''} rows={2} />
            <div className="form-foot"><button className="btn" type="submit">Save the client</button></div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
