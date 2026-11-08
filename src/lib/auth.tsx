import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './supabase';

export type Role = 'super_admin' | 'hr_admin' | 'hr_staff' | 'payroll' | 'operations' | 'management' | 'supervisor' | 'employee';

export interface Access {
  user_id: string;
  roles: Role[];
  full_name: string | null;
  email: string | null;
  must_change_password: boolean;
  employee: { id: string; employee_no: string; full_name: string; position: string; status: string } | null;
}

interface AuthState {
  ready: boolean;
  session: Session | null;
  access: Access | null;
  recovering: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  can: Can;
}

/** The same role groups the database uses in its policies (schema.sql section 3). */
export interface Can {
  admin: boolean;
  hr: boolean;
  payroll: boolean;
  ops: boolean;
  staff: boolean;
  publish: boolean;
  auditor: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

function rolesToCan(roles: Role[]): Can {
  const has = (...r: Role[]) => r.some((x) => roles.includes(x));
  return {
    admin: has('super_admin'),
    hr: has('super_admin', 'hr_admin', 'hr_staff'),
    payroll: has('super_admin', 'hr_admin', 'payroll'),
    ops: has('super_admin', 'hr_admin', 'operations'),
    staff: has('super_admin', 'hr_admin', 'hr_staff', 'payroll', 'operations', 'management'),
    publish: has('super_admin', 'hr_admin', 'hr_staff', 'operations'),
    auditor: has('super_admin', 'hr_admin'),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!configured);
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [recovering, setRecovering] = useState(false);

  const loadAccess = useCallback(async (s: Session | null) => {
    if (!s) {
      setAccess(null);
      return;
    }
    const { data, error } = await supabase.rpc('my_access');
    setAccess(error ? null : (data as Access));
  }, []);

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadAccess(data.session);
      if (alive) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // load outside the auth callback (supabase-js advises against awaiting inside it)
        setTimeout(() => loadAccess(s).then(() => setReady(true)), 0);
      }
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadAccess]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      session,
      access,
      recovering,
      refresh: () => loadAccess(session),
      signOut: async () => {
        await supabase.auth.signOut();
        setAccess(null);
      },
      can: rolesToCan(access?.roles ?? []),
    }),
    [ready, session, access, recovering, loadAccess],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
