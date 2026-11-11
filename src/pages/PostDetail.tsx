import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fullName } from '../lib/format';
import { EMPLOYEE_STATUS } from '../lib/labels';
import { safeSearch } from '../lib/refs';
import { mapsLink } from '../lib/attendance';
import { Badge, Dialog, Empty, ErrorState, Loading, Search, StatusBadge, useDebounced, useToast } from '../ui/kit';
import { SiteForm, type Site } from './Posts';
import { PostPay, ShiftPicker, defaultShift } from './Pay';

export default function PostDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const site = useQuery({
    queryKey: ['site', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('sites').select('*, client:clients(name), area:areas(name)').eq('id', id).single();
      if (error) throw error;
      return data as Site & { client: { name: string } | null; area: { name: string } | null };
    },
  });
  const people = useQuery({
    queryKey: ['site-people', id],
    queryFn: async () => {
      const [guards, sups] = await Promise.all([
        supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix,position,status').eq('site_id', id).order('last_name'),
        supabase.from('site_supervisors').select('employee_id, role').eq('site_id', id),
      ]);
      if (guards.error) throw guards.error;
      if (sups.error) throw sups.error;
      return { guards: guards.data, sups: sups.data };
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['site-people', id] });
    qc.invalidateQueries({ queryKey: ['site-staffing'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const toggleCommander = async (employeeId: string, isOne: boolean) => {
    const res = isOne
      ? await supabase.from('site_supervisors').delete().eq('site_id', id).eq('employee_id', employeeId)
      : await supabase.from('site_supervisors').insert({ site_id: id, employee_id: employeeId, role: 'detachment_commander' });
    if (res.error) return toast(errorText(res.error), 'error');
    refresh();
    toast(isOne ? 'No longer commands this post.' : 'Named detachment commander. Leave requests from this post now go to them first.');
  };
  const relieve = async (employeeId: string) => {
    if (!confirm('Take this guard off the post and set them to floating?')) return;
    const { error } = await supabase.rpc('deploy_employees', { p_employee_ids: [employeeId], p_site_id: null });
    if (error) return toast(errorText(error), 'error');
    refresh();
    toast('Set to floating.');
  };
  if (site.isLoading) return <Loading />;
  if (site.error || !site.data) return <ErrorState error={errorText(site.error)} />;
  const s = site.data;
  const supIds = new Set((people.data?.sups ?? []).map((x) => x.employee_id));
  const assigned = people.data?.guards.filter((g) => ['active', 'on_leave', 'suspended'].includes(g.status)).length ?? 0;
  return (
    <>
      <Link className="back" to="/posts">← Posts and clients</Link>
      <div className="page-head">
        <div>
          <h1>{s.name}</h1>
          <p className="row" style={{ marginTop: 8 }}>{s.client?.name ?? 'No client'} · {[s.city, s.province].filter(Boolean).join(', ') || 'No town set'} · {s.is_active ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>}</p>
        </div>
        {can.ops && <div className="page-actions"><button className="btn btn-line" type="button" onClick={() => setEditing(true)}>Edit the post</button><button className="btn" type="button" onClick={() => setDeploying(true)}>Deploy guards here</button></div>}
      </div>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="label">Guards assigned</span><span className="big">{assigned} of {s.guards_required}</span>{assigned < s.guards_required && <span className="muted small">{s.guards_required - assigned} short</span>}</div>
        <div className="tile"><span className="label">Area</span><span style={{ fontSize: 20, fontWeight: 700 }}>{s.area?.name ?? 'None'}</span></div>
        <div className="tile"><span className="label">Commanders</span><span className="big">{supIds.size}</span></div>
      </div>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2>Location for time in and out</h2>
          <Link className="btn btn-line btn-sm" to={`/attendance?site=${s.id}`}>Attendance at this post</Link>
        </div>
        <div className="panel-pad">
          {s.latitude != null && s.longitude != null ? (
            <p>
              Guards count as at the post within <b>{s.geofence_radius_m} m</b> of <span className="tabular">{s.latitude}, {s.longitude}</span>.{' '}
              <a href={mapsLink(s.latitude, s.longitude)} target="_blank" rel="noreferrer">Check it in Google Maps</a>
            </p>
          ) : (
            <p className="callout warn">
              Not set yet, so time in and out at this post are marked "Post location not set".{' '}
              {can.ops && <button className="link-btn" type="button" onClick={() => setEditing(true)}>Set the location</button>}
            </p>
          )}
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Guards at this post</h2></div>
        {people.isLoading ? <Loading /> : people.error ? <ErrorState error={errorText(people.error)} /> : !people.data?.guards.length ? <Empty title="Nobody is deployed here yet" /> : (
          <table className="table">
            <thead><tr><th>Employee</th><th>Position</th><th>Status</th><th>Commander</th>{can.ops && <th />}</tr></thead>
            <tbody>{people.data.guards.map((g) => {
              const isSup = supIds.has(g.id);
              return (
                <tr key={g.id}>
                  <td><Link className="cell-main" to={`/employees/${g.id}`}>{fullName(g)}</Link><span className="cell-sub tabular">{g.employee_no}</span></td>
                  <td>{g.position}</td>
                  <td><StatusBadge map={EMPLOYEE_STATUS} value={g.status} /></td>
                  <td>{isSup ? <Badge tone="info">Detachment commander</Badge> : ''}</td>
                  {can.ops && <td><span className="row"><button className="link-btn" type="button" onClick={() => toggleCommander(g.id, isSup)}>{isSup ? 'Remove as commander' : 'Make commander'}</button><button className="link-btn" type="button" onClick={() => relieve(g.id)}>Set to floating</button></span></td>}
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {(can.payroll || can.hr) && <PostPay site={s} />}
      <Dialog open={editing} title="Edit the post" onClose={() => setEditing(false)} wide>
        <SiteForm site={s} onDone={() => { setEditing(false); qc.invalidateQueries({ queryKey: ['site', id] }); qc.invalidateQueries({ queryKey: ['site-staffing'] }); qc.invalidateQueries({ queryKey: ['sites-list'] }); }} />
      </Dialog>
      <Dialog open={deploying} title={`Deploy guards to ${s.name}`} onClose={() => setDeploying(false)} wide>
        {deploying && <DeployPicker site={s} onDone={() => { setDeploying(false); refresh(); }} />}
      </Dialog>
    </>
  );
}

function DeployPicker({ site, onDone }: { site: Site; onDone: () => void }) {
  const siteId = site.id;
  const toast = useToast();
  const [shift, setShift] = useState(defaultShift(site));
  const [text, setText] = useState('');
  const q = useDebounced(text);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const list = useQuery({
    queryKey: ['deployable', q],
    queryFn: async () => {
      let req = supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix,status,site:sites!employees_site_id_fkey(name)').in('status', ['active', 'floating']).eq('is_field', true).neq('site_id', siteId).order('status', { ascending: false }).order('last_name').limit(50);
      const s = safeSearch(q);
      if (s) req = req.or(`employee_no.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`);
      const { data, error } = await req;
      if (error) throw error;
      // employees with no post are not matched by neq: fetch the floating ones separately
      let floatReq = supabase.from('employees').select('id,employee_no,first_name,middle_name,last_name,suffix,status,site:sites!employees_site_id_fkey(name)').is('site_id', null).in('status', ['active', 'floating']).eq('is_field', true).order('last_name').limit(50);
      if (s) floatReq = floatReq.or(`employee_no.ilike.%${s}%,last_name.ilike.%${s}%,first_name.ilike.%${s}%`);
      const floating = await floatReq;
      if (floating.error) throw floating.error;
      return [...floating.data, ...data];
    },
  });
  const deploy = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('deploy_employees', { p_employee_ids: picked, p_site_id: siteId, p_duty_hours: shift.duty, p_shift_start: shift.start });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast(`${data} deployed. They are told in the app.`);
    onDone();
  };
  return (
    <div className="stack">
      <Search value={text} onChange={setText} label="Search guards" />
      {list.isLoading ? <Loading /> : list.error ? <ErrorState error={errorText(list.error)} /> : !list.data?.length ? <Empty title="No guard matches" /> : (
        <div className="preview-table" style={{ maxHeight: 380 }}>
          <table className="table">
            <tbody>{list.data.map((g) => (
              <tr key={g.id}>
                <td style={{ width: 40 }}><input type="checkbox" aria-label={`Pick ${fullName(g)}`} checked={picked.includes(g.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, g.id] : picked.filter((x) => x !== g.id))} /></td>
                <td><b>{fullName(g)}</b><span className="cell-sub tabular">{g.employee_no}</span></td>
                <td><StatusBadge map={EMPLOYEE_STATUS} value={g.status} /></td>
                <td>{(g.site as unknown as { name: string } | null)?.name ?? <span className="muted">No post</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <ShiftPicker firstStart={site.first_shift_start} value={shift} onChange={setShift} />
      <div className="form-foot"><button className="btn" type="button" disabled={!picked.length} aria-busy={busy} onClick={deploy}>Deploy {picked.length || ''} {picked.length === 1 ? 'guard' : 'guards'}</button></div>
    </div>
  );
}
