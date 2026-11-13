import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtDate } from '../lib/format';
import { parseLocation } from '../lib/attendance';
import { useAreas } from '../lib/refs';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, SelectField, Tabs, TextArea, TextField, useToast } from '../ui/kit';

export interface Site { id: string; name: string; code: string | null; client_id: string | null; area_id: string | null; address: string | null; city: string | null; province: string | null; region: string | null; guards_required: number; is_active: boolean; notes: string | null; latitude: number | null; longitude: number | null; geofence_radius_m: number; pay_rule_id: string | null; duty_hours: number; first_shift_start: string }

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (!f.name.trim()) return setError('Enter the post name.');
    const place = parseLocation(f.location);
    const radius = Number(f.geofence_radius_m || 150);
    const problems: Record<string, string> = {};
    if (place && 'error' in place) problems.location = place.error;
    if (!Number.isInteger(radius) || radius < 20 || radius > 5000) problems.geofence_radius_m = 'Use a whole number from 20 to 5000 metres.';
    setFieldErrors(problems);
    if (Object.keys(problems).length) return setError('');
    const point = place && !('error' in place) ? place : null;
    const row = {
      name: f.name.trim(), code: f.code.trim() || null, client_id: f.client_id || null, area_id: f.area_id || null, address: f.address.trim() || null,
      city: f.city.trim() || null, province: f.province.trim() || null, region: f.region.trim() || null, guards_required: Number(f.guards_required || 0),
      latitude: point?.lat ?? null, longitude: point?.lng ?? null, geofence_radius_m: radius, is_active: f.is_active === 'yes', notes: f.notes.trim() || null,
      duty_hours: Number(f.duty_hours || 12), first_shift_start: f.first_shift_start || '06:00',
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
      <div className="form-row">
        <SelectField label="Duty" name="duty_hours" defaultValue={String(site?.duty_hours ?? 12)} options={[{ value: '8', label: '8-hour shifts (three a day)' }, { value: '12', label: '12-hour shifts (two a day)' }, { value: '24', label: '24-hour duty' }]} />
        <TextField label="First shift starts" name="first_shift_start" type="time" defaultValue={(site?.first_shift_start ?? '06:00').slice(0, 5)} hint="6:00 gives 6am to 6pm and 6pm to 6am for 12-hour shifts." />
      </div>
      <TextField label="Address" name="address" optional defaultValue={site?.address ?? ''} />
      <div className="form-row">
        <TextField label="City or town" name="city" optional defaultValue={site?.city ?? ''} />
        <TextField label="Province" name="province" optional defaultValue={site?.province ?? ''} />
        <TextField label="Region (for the wage order)" name="region" optional defaultValue={site?.region ?? ''} />
      </div>
      <div className="form-row">
        <TextField
          label="Location for time in and out" name="location" optional inputMode="decimal" autoComplete="off"
          placeholder="14.554729, 121.024445" error={fieldErrors.location}
          defaultValue={site?.latitude != null && site?.longitude != null ? `${site.latitude}, ${site.longitude}` : ''}
          hint="In Google Maps, right-click the post's entrance and click the two numbers at the top of the menu to copy them, then paste them here."
        />
        <TextField
          label="Allowed distance (metres)" name="geofence_radius_m" type="number" min="20" max="5000" step="1"
          defaultValue={site?.geofence_radius_m ?? 150} error={fieldErrors.geofence_radius_m}
          hint="How far from that point a time in still counts as at the post. 150 m suits most posts; use more for a big compound."
        />
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
  const [portal, setPortal] = useState<{ id: string; name: string } | null>(null);
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
              <td>{can.ops && <span className="row"><button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(x)}>Edit</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => setPortal({ id: x.id, name: x.name })}>Portal access</button></span>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <Dialog open={portal !== null} title={portal ? `Client portal: ${portal.name}` : ''} onClose={() => setPortal(null)}>
        {portal && <ClientAccess clientId={portal.id} />}
      </Dialog>
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

/**
 * Who at the client may sign in to the client portal (schema.sql section 17): invite by email, then
 * give them the code; they make their account at /setup like staff, and see only their company's posts.
 */
function ClientAccess({ clientId }: { clientId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', email: '' });
  const [code, setCode] = useState<{ email: string; code: string } | null>(null);
  const [error, setError] = useState('');
  const users = useQuery({
    queryKey: ['client-users', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_client_users', { p_client_id: clientId });
      if (error) throw error;
      return data as { user_id: string | null; full_name: string; email: string; state: string; since: string }[];
    },
  });
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const { data, error: err } = await supabase.rpc('invite_client_user', { p_client_id: clientId, p_email: v.email, p_full_name: v.name });
    if (err) return setError(errorText(err));
    setCode({ email: v.email.trim().toLowerCase(), code: data as string });
    setV({ name: '', email: '' });
    qc.invalidateQueries({ queryKey: ['client-users', clientId] });
  };
  const setActive = async (userId: string, active: boolean) => {
    const { error: err } = await supabase.rpc('set_client_user_active', { p_user_id: userId, p_active: active });
    if (err) return toast(errorText(err), 'error');
    qc.invalidateQueries({ queryKey: ['client-users', clientId] });
  };
  return (
    <div className="stack">
      <p className="muted small">
        People at the client see their posts, the guards on duty and attendance by day, and file incident reports and requests. They never see pay,
        addresses, government numbers, photos, locations or discipline cases. It works on a tablet: open the portal in the browser and Add to Home Screen.
      </p>
      {users.isLoading ? <Loading /> : users.error ? <ErrorState error={errorText(users.error)} retry={() => users.refetch()} /> : (
        <ul className="client-list">
          {(users.data ?? []).map((u) => (
            <li key={`${u.email}-${u.state}`}>
              <span><b>{u.full_name}</b><span className="muted small"> · {u.email}</span></span>
              <span className="row">
                <Badge tone={u.state === 'active' ? 'ok' : u.state === 'invited' ? 'info' : 'neutral'}>{u.state === 'active' ? 'Can sign in' : u.state === 'invited' ? 'Invited' : u.state === 'expired' ? 'Invitation expired' : 'Turned off'}</Badge>
                {u.user_id && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setActive(u.user_id!, u.state !== 'active')}>{u.state === 'active' ? 'Turn off' : 'Turn on'}</button>}
              </span>
            </li>
          ))}
          {!users.data?.length && <li className="muted">Nobody yet.</li>}
        </ul>
      )}
      {code && (
        <p className="callout" role="status">
          Give <b>{code.email}</b> this code: <b className="tabular">{code.code}</b>. They open <b>{window.location.origin}/setup</b>, enter their email,
          the code and a password. The code works for 14 days.
        </p>
      )}
      <form className="form" onSubmit={invite} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-row">
          <TextField label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          <TextField label="Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </div>
        <div className="form-foot"><button className="btn" type="submit">Invite to the client portal</button></div>
      </form>
    </div>
  );
}
