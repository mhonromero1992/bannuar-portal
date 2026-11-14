import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../lib/auth';
import { supabase, PORTAL_URL } from '../lib/supabase';
import { errorText } from '../lib/format';
import { TextField, useToast } from '../ui/kit';
import { DutyClock } from '../ui/DutyClock';

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__art on-night">
        <header>
          <p className="auth__eyebrow">Bannuar Security Agency, Inc. · San Juan, La Union</p>
          <p className="auth__title">Posts, people and pay, on <em>one desk</em>.</p>
          <p className="auth__lede">The HR portal for Bannuar's HR, payroll and operations staff: who is posted where, whose papers run out, what each cutoff pays.</p>
        </header>
        <DutyClock />
      </div>
      <main className="auth__panel">
        <div className="auth__box">{children}</div>
      </main>
    </div>
  );
}

const MIN_PASSWORD = 8;

function signInMessage(message: string) {
  if (/invalid login/i.test(message)) return 'The email or password is wrong.';
  if (/not confirmed/i.test(message)) return 'Confirm your email first: open the link that was sent to you, then sign in.';
  return errorText({ message });
}

export function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) return setError(signInMessage(err.message));
    navigate(params.get('next') || '/', { replace: true });
  };
  return (
    <AuthLayout>
      <h1>Sign in</h1>
      <form className="form" onSubmit={submit} noValidate>
        {error && <p className="form-error" role="alert">{error}</p>}
        <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn" type="submit" aria-busy={busy}>Sign in</button>
      </form>
      <div className="row between small">
        <Link to="/forgot-password">Forgot your password?</Link>
        <Link to="/setup">Set up your account</Link>
      </div>
    </AuthLayout>
  );
}

export function SetupAccount() {
  const navigate = useNavigate();
  const [f, setF] = useState({ email: '', code: '', name: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const errs: Record<string, string> = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) errs.email = 'Enter the email your invitation was made for.';
    if (f.code.replace(/[^A-Za-z0-9]/g, '').length !== 8) errs.code = 'The code has 8 letters and numbers, like K7QM-3XPD.';
    if (!f.name.trim()) errs.name = 'Enter your name.';
    if (f.password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (f.confirm !== f.password) errs.confirm = 'The two passwords are not the same.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const code = f.code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
    setBusy(true);
    const { data: ok, error: checkErr } = await supabase.rpc('check_staff_invitation', { p_email: f.email.trim(), p_code: code });
    if (checkErr || !ok) {
      setBusy(false);
      return setError(checkErr ? errorText(checkErr) : 'There is no open invitation for this email and code. Check both, or ask the administrator for a new code.');
    }
    const { data, error: err } = await supabase.auth.signUp({
      email: f.email.trim(),
      password: f.password,
      options: { data: { invite_code: code, full_name: f.name.trim() }, emailRedirectTo: `${PORTAL_URL}/sign-in` },
    });
    setBusy(false);
    if (err) return setError(/database error/i.test(err.message) ? 'The invitation could not be used. Ask the administrator for a new code.' : errorText(err));
    if (data.session) navigate('/', { replace: true });
    else setSent(true);
  };
  return (
    <AuthLayout>
      <h1>Set up your account</h1>
      {sent ? (
        <div className="stack">
          <p>Your account is made. Open the confirmation email sent to <b>{f.email}</b>, then sign in.</p>
          <Link className="btn btn-line" to="/sign-in">Go to sign in</Link>
        </div>
      ) : (
        <>
          <p className="muted">Use the email and the invitation code the administrator gave you.</p>
          <form className="form" onSubmit={submit} noValidate>
            {error && <p className="form-error" role="alert">{error}</p>}
            <TextField label="Email" type="email" autoComplete="email" value={f.email} onChange={set('email')} error={errors.email} />
            <TextField label="Invitation code" autoComplete="one-time-code" autoCapitalize="characters" value={f.code} onChange={set('code')} error={errors.code} placeholder="K7QM-3XPD" />
            <TextField label="Your name" autoComplete="name" value={f.name} onChange={set('name')} error={errors.name} />
            <TextField label="Password" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} error={errors.password} hint={`At least ${MIN_PASSWORD} characters.`} />
            <TextField label="Password again" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} error={errors.confirm} />
            <button className="btn" type="submit" aria-busy={busy}>Make my account</button>
          </form>
          <Link className="small" to="/sign-in">I already have an account</Link>
        </>
      )}
    </AuthLayout>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email.');
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${PORTAL_URL}/reset-password` });
    setBusy(false);
    if (err) return setError(errorText(err));
    setDone(true);
  };
  return (
    <AuthLayout>
      <h1>Forgot your password</h1>
      {done ? (
        <p>If <b>{email}</b> has an account, a link to choose a new password is on its way. It works once and expires within an hour.</p>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          {error && <p className="form-error" role="alert">{error}</p>}
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" type="submit" aria-busy={busy}>Send the link</button>
        </form>
      )}
      <Link className="small" to="/sign-in">Back to sign in</Link>
    </AuthLayout>
  );
}

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (confirm !== password) errs.confirm = 'The two passwords are not the same.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (!err) await supabase.rpc('mark_password_changed');
    setBusy(false);
    if (err) return setError(/different from the old/i.test(err.message) ? 'Choose a password different from the old one.' : errorText(err));
    onDone();
  };
  return (
    <form className="form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint={`At least ${MIN_PASSWORD} characters.`} />
      <TextField label="New password again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
      <button className="btn" type="submit" aria-busy={busy}>Save the new password</button>
    </form>
  );
}

export function ResetPassword() {
  const { session, ready, refresh } = useAuth();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <h1>Choose a new password</h1>
      {!ready ? (
        <p className="muted">Checking the link…</p>
      ) : session ? (
        <NewPasswordForm onDone={async () => { await refresh(); navigate('/', { replace: true }); }} />
      ) : (
        <>
          <p>This link has expired or was already used. Ask for a new one.</p>
          <Link className="btn btn-line" to="/forgot-password">Send a new link</Link>
        </>
      )}
    </AuthLayout>
  );
}

export function ChangePassword({ forced }: { forced?: boolean }) {
  const { refresh, signOut } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const body = (
    <NewPasswordForm
      onDone={async () => {
        await refresh();
        toast('Password changed.');
        if (!forced) navigate('/');
      }}
    />
  );
  if (forced) {
    return (
      <AuthLayout>
        <h1>Choose your own password</h1>
        <p className="muted">You signed in with a temporary password. Choose one only you know before going on.</p>
        {body}
        <button className="link-btn small" type="button" onClick={signOut}>Sign out</button>
      </AuthLayout>
    );
  }
  return (
    <div style={{ maxWidth: 460 }}>
      <div className="page-head"><div><h1>Change your password</h1></div></div>
      <div className="panel panel-pad">{body}</div>
    </div>
  );
}

export function NotConfigured() {
  return (
    <AuthLayout>
      <h1>Connect the database</h1>
      <p>This copy of the portal does not know Bannuar's Supabase project yet.</p>
      <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>
        <li>Run <span className="code">supabase/schema.sql</span> in the project (see <span className="code">supabase/SETUP.md</span>).</li>
        <li>Copy <span className="code">.env.example</span> to <span className="code">.env</span> and fill in <span className="code">VITE_SUPABASE_URL</span> and <span className="code">VITE_SUPABASE_ANON_KEY</span>.</li>
        <li>Build or start the portal again.</li>
      </ol>
    </AuthLayout>
  );
}

export function NoAccess() {
  const { signOut, access } = useAuth();
  return (
    <AuthLayout>
      <h1>This portal is for office staff</h1>
      <p>
        {access?.email ? <b>{access.email}</b> : 'This account'} has no staff role. Employees see their payslips, records and requests
        in the Bannuar app. If you work in the office, ask the administrator to add your role.
      </p>
      <button className="btn btn-line" type="button" onClick={signOut}>Sign out</button>
    </AuthLayout>
  );
}
