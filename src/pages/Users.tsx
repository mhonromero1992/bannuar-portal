import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth, type Role } from '../lib/auth';
import { errorText, fmtDateTime } from '../lib/format';
import { ROLE_HINT, ROLE_LABEL } from '../lib/labels';
import { Badge, Dialog, Empty, ErrorState, Loading, PageHead, TextField, useToast } from '../ui/kit';

const STAFF_ROLES: Role[] = ['super_admin', 'hr_admin', 'hr_staff', 'payroll', 'operations', 'management', 'supervisor'];

interface UserRow { user_id: string; email: string; full_name: string | null; roles: Role[]; employee_id: string | null; last_sign_in_at: string | null; created_at: string }

function RolePicker({ value, onChange }: { value: Role[]; onChange: (r: Role[]) => void }) {
  return (
    <fieldset className="field">
      <legend className="field-label">Roles</legend>
      <div className="stack" style={{ gap: 4 }}>
        {STAFF_ROLES.map((r) => (
          <label key={r} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            <span><b>{ROLE_LABEL[r]}</b> <span className="muted small">{ROLE_HINT[r]}</span></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Users() {
  const { can, session } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [code, setCode] = useState<{ email: string; code: string } | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const users = useQuery({
    queryKey: ['users'],
    enabled: can.admin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_users');
      if (error) throw error;
      return data as UserRow[];
    },
  });
  const invites = useQuery({
    queryKey: ['invitations'],
    enabled: can.admin,
    queryFn: async () => {
      const { data, error } = await supabase.from('staff_invitations').select('*').is('accepted_at', null).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  if (!can.admin) return <Empty title="Only a super admin manages users" />;

  const resetPassword = async (u: UserRow) => {
    if (!confirm(`Give ${u.full_name ?? u.email} a temporary password? Their current one stops working.`)) return;
    const pwd = `Bannuar-${Array.from(crypto.getRandomValues(new Uint32Array(2))).map((n) => n.toString(36)).join('').slice(0, 8)}`;
    const { error } = await supabase.rpc('admin_reset_password', { p_user_id: u.user_id, p_temp_password: pwd });
    if (error) return toast(errorText(error), 'error');
    setTemp({ email: u.email, password: pwd });
  };
  const withdraw = async (email: string) => {
    if (!confirm(`Withdraw the invitation for ${email}?`)) return;
    const { error } = await supabase.from('staff_invitations').delete().eq('email', email);
    if (error) return toast(errorText(error), 'error');
    qc.invalidateQueries({ queryKey: ['invitations'] });
  };

  return (
    <>
      <PageHead title="Users and roles" intro="Office staff sign up with an invitation code you give them. Employees activate the app on their own with their 201 details."
        actions={<button className="btn" type="button" onClick={() => setInviting(true)}>Invite someone</button>} />
      <div className="stack">
        <div className="panel">
          <div className="panel-head"><h2>Staff accounts</h2></div>
          {users.isLoading ? <Loading /> : users.error ? <ErrorState error={errorText(users.error)} retry={() => users.refetch()} /> : !users.data?.length ? <Empty title="No staff accounts yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Person</th><th>Roles</th><th>Last sign-in</th><th /></tr></thead>
                <tbody>{users.data.map((u) => (
                  <tr key={u.user_id}>
                    <td><b>{u.full_name ?? u.email}</b><span className="cell-sub">{u.email}</span></td>
                    <td><span className="row">{u.roles.filter((r) => r !== 'employee').map((r) => <Badge key={r} tone={r === 'super_admin' ? 'bad' : 'info'}>{ROLE_LABEL[r]}</Badge>)}</span></td>
                    <td className="tabular">{u.last_sign_in_at ? fmtDateTime(u.last_sign_in_at) : <span className="muted">Never</span>}</td>
                    <td><span className="row"><button className="btn btn-line btn-sm" type="button" onClick={() => setEditing(u)}>Change roles</button>{u.user_id !== session?.user.id && <button className="btn btn-ghost btn-sm" type="button" onClick={() => resetPassword(u)}>Temporary password</button>}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Open invitations</h2></div>
          {invites.isLoading ? <Loading /> : invites.error ? <ErrorState error={errorText(invites.error)} /> : !invites.data?.length ? <Empty title="No open invitations" /> : (
            <table className="table">
              <thead><tr><th>Email</th><th>Roles</th><th>Code</th><th>Expires</th><th /></tr></thead>
              <tbody>{invites.data.map((i) => (
                <tr key={i.email}>
                  <td><b>{i.full_name}</b><span className="cell-sub">{i.email}</span></td>
                  <td>{(i.roles as Role[]).map((r) => ROLE_LABEL[r]).join(', ')}</td>
                  <td><span className="code">{i.code}</span></td>
                  <td className="tabular">{new Date(i.expires_at) < new Date() ? <Badge tone="bad">Expired</Badge> : fmtDateTime(i.expires_at)}</td>
                  <td><button className="link-btn" type="button" onClick={() => withdraw(i.email)}>Withdraw</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <Dialog open={inviting} title="Invite someone" onClose={() => setInviting(false)}>
        {inviting && <InviteForm onDone={(email, c) => { setInviting(false); setCode({ email, code: c }); qc.invalidateQueries({ queryKey: ['invitations'] }); }} />}
      </Dialog>
      <Dialog open={Boolean(code)} title="Invitation ready" onClose={() => setCode(null)}>
        {code && (
          <div className="stack">
            <p>Give <b>{code.email}</b> this code in person or by message. They open the portal, choose <b>Set up your account</b>, and use their email with the code. It works for 14 days.</p>
            <p style={{ fontSize: 28, fontWeight: 800, letterSpacing: '0.08em' }} className="tabular">{code.code}</p>
            <div className="form-foot"><button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(code.code).then(() => toast('Code copied.'))}>Copy the code</button></div>
          </div>
        )}
      </Dialog>
      <Dialog open={Boolean(editing)} title={`Roles of ${editing?.full_name ?? editing?.email ?? ''}`} onClose={() => setEditing(null)}>
        {editing && <EditRoles u={editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['users'] }); }} />}
      </Dialog>
      <Dialog open={Boolean(temp)} title="Temporary password" onClose={() => setTemp(null)}>
        {temp && <p>Give <b>{temp.email}</b> this password: <span className="code" style={{ fontSize: 16 }}>{temp.password}</span>. They choose their own at the next sign-in. It is not shown again.</p>}
      </Dialog>
    </>
  );
}

function InviteForm({ onDone }: { onDone: (email: string, code: string) => void }) {
  const [v, setV] = useState({ email: '', name: '' });
  const [roles, setRoles] = useState<Role[]>(['hr_staff']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.email.trim() || !v.name.trim()) return setError('Enter the name and email.');
    if (!roles.length) return setError('Choose at least one role.');
    setBusy(true);
    const { data, error: err } = await supabase.rpc('invite_staff', { p_email: v.email.trim(), p_full_name: v.name.trim(), p_roles: roles, p_employee_id: null });
    setBusy(false);
    if (err) return setError(errorText(err));
    onDone(v.email.trim().toLowerCase(), data as string);
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-row"><TextField label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /><TextField label="Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
      <RolePicker value={roles} onChange={setRoles} />
      <div className="form-foot"><button className="btn" type="submit" aria-busy={busy}>Make the invitation</button></div>
    </form>
  );
}

function EditRoles({ u, onDone }: { u: UserRow; onDone: () => void }) {
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>(u.roles.filter((r) => r !== 'employee'));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('set_user_roles', { p_user_id: u.user_id, p_roles: roles });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('Roles saved.');
    onDone();
  };
  return (
    <div className="stack">
      <RolePicker value={roles} onChange={setRoles} />
      {!roles.length && <p className="callout warn">With no role this person can no longer open the portal.</p>}
      <div className="form-foot"><button className="btn" type="button" aria-busy={busy} onClick={save}>Save the roles</button></div>
    </div>
  );
}
