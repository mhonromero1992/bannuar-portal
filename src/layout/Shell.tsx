import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { JumpTo } from './JumpTo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { ROLE_LABEL } from '../lib/labels';

export interface DashboardData {
  employees_by_status: Record<string, number>;
  employees_current: number;
  sites_active: number;
  guards_required: number;
  guards_deployed: number;
  sites_short: number;
  floating: number;
  floating_over_150_days: number;
  leave_pending_supervisor: number;
  leave_pending_hr: number;
  on_leave_today: number;
  coe_pending: number;
  coe_overdue: number;
  profile_changes_pending: number;
  payroll_concerns_open: number;
  documents_expired: number;
  documents_expiring: number;
  compliance_gaps: number;
  applications_new: number;
  inquiries_new: number;
  latest_period: { id: string; label: string; status: string; pay_date: string; payslips: number } | null;
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_dashboard');
      if (error) throw error;
      return data as DashboardData;
    },
    refetchInterval: 60_000,
  });
}

const SCREEN_ROUTES: Record<string, string> = {
  leave_request: '/requests?tab=leave',
  coe_request: '/requests?tab=coe',
  profile_change: '/requests?tab=changes',
  payroll_concern: '/requests?tab=concerns',
  job_application: '/recruitment',
  inquiry: '/inquiries',
  announcement: '/announcements',
  incident_report: '/discipline?tab=reports',
  discipline: '/discipline?tab=cases',
  discipline_code: '/discipline?tab=code',
};

function Bell() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ['notifications', uid],
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications').select('id,title,body,kind,read_at,created_at').order('created_at', { ascending: false }).limit(25);
      if (error) throw error;
      return data;
    },
    refetchInterval: 120_000,
  });
  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`notes-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => {
        qc.invalidateQueries({ queryKey: ['notifications', uid] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, qc]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  const markAll = async () => {
    const ids = (q.data ?? []).filter((n) => !n.read_at).map((n) => n.id);
    if (!ids.length) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
    qc.invalidateQueries({ queryKey: ['notifications', uid] });
  };
  return (
    <div className="bell" ref={box}>
      <button className="btn btn-ghost" type="button" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5a5 5 0 0 0-5 5v3.2L3.6 13.4c-.4.7.1 1.6.9 1.6h11c.8 0 1.3-.9.9-1.6L15 10.7V7.5a5 5 0 0 0-5-5Zm-2 14a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Notifications
      </button>
      {unread > 0 && <span className="bell-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      {open && (
        <div className="popover" role="dialog" aria-label="Notifications">
          <div className="panel-head">
            <b>Notifications</b>
            <button className="link-btn small" type="button" onClick={markAll} disabled={!unread}>Mark all read</button>
          </div>
          {(q.data ?? []).length === 0 && <p className="muted" style={{ padding: 16 }}>Nothing yet. New requests, applications and proposal requests appear here.</p>}
          {(q.data ?? []).map((n) => (
            <a
              key={n.id}
              href={SCREEN_ROUTES[n.kind] ?? '/'}
              className={`note${n.read_at ? '' : ' unread'}`}
              onClick={async (e) => {
                e.preventDefault();
                setOpen(false);
                if (!n.read_at) {
                  await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
                  qc.invalidateQueries({ queryKey: ['notifications', uid] });
                }
                navigate(SCREEN_ROUTES[n.kind] ?? '/');
              }}
            >
              <b>{n.title}</b>
              {n.body && <span className="muted small">{n.body}</span>}
              <span className="muted small">{fmtDateTime(n.created_at)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

type NavGroup = { title: string; items: { to: string; label: string; show: boolean; count?: number }[] };

/** The menu, with the lamp: one marker that slides to the page you open. */
function Nav({ groups }: { groups: NavGroup[] }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  const [lamp, setLamp] = useState<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const measure = () => {
      const on = nav.querySelector<HTMLElement>('.nav-link.active');
      setLamp(on ? { y: on.offsetTop, h: on.offsetHeight } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [location.pathname, groups.map((g) => g.items.filter((i) => i.show).length).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <nav ref={ref} className={`nav${lamp ? ' has-lamp' : ''}`} aria-label="Sections">
      {lamp && <span className="nav-lamp" aria-hidden="true" style={{ '--lamp-y': `${lamp.y}px`, height: lamp.h } as CSSProperties} />}
      {groups.map((g) => {
        const items = g.items.filter((i) => i.show);
        if (!items.length) return null;
        return (
          <div className="nav-group" key={g.title}>
            <p>{g.title}</p>
            {items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} viewTransition className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
                <span>{i.label}</span>
                {i.count ? <span className="nav-count" aria-label={`${i.count} waiting`}>{i.count}</span> : null}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

export default function Shell() {
  const { access, can, signOut } = useAuth();
  const dash = useDashboard();
  const d = dash.data;
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname, location.search]);
  // Escape closes the menu on a phone, like any drawer
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  const requestsCount = d ? (can.hr ? d.leave_pending_hr + d.coe_pending + d.profile_changes_pending : 0) + (can.payroll ? d.payroll_concerns_open : 0) : 0;

  const groups: { title: string; items: { to: string; label: string; show: boolean; count?: number }[] }[] = [
    { title: 'Overview', items: [{ to: '/', label: 'Dashboard', show: true }] },
    {
      title: 'People',
      items: [
        { to: '/employees', label: 'Employees', show: true },
        { to: '/posts', label: 'Posts and clients', show: true },
        { to: '/compliance', label: 'Licenses and documents', show: true, count: d ? d.documents_expired : 0 },
      ],
    },
    {
      title: 'Work',
      items: [
        { to: '/requests', label: 'Requests', show: can.hr || can.payroll || can.ops || access?.roles.includes('management') === true, count: requestsCount },
        { to: '/attendance', label: 'Attendance', show: true },
        { to: '/discipline', label: 'Discipline', show: can.hr || can.ops },
        { to: '/announcements', label: 'Announcements', show: true },
        { to: '/payroll', label: 'Payroll', show: can.payroll },
        { to: '/recruitment', label: 'Recruitment', show: can.hr, count: d?.applications_new },
        { to: '/inquiries', label: 'Proposal requests', show: true, count: d?.inquiries_new },
      ],
    },
    {
      title: 'Administration',
      items: [
        { to: '/users', label: 'Users and roles', show: can.admin },
        { to: '/audit', label: 'Audit log', show: can.auditor },
        { to: '/settings', label: 'Settings', show: can.hr || can.ops || can.payroll },
      ],
    },
  ];

  const pages = groups.flatMap((g) => g.items.filter((i) => i.show).map((i) => ({ to: i.to, label: i.label })));
  return (
    <div className="shell">
      <a className="skip-link" href="#content">Skip to content</a>
      <aside className={`side on-night${menu ? ' open' : ''}`} aria-label="Portal">
        <Link className="brand" to="/" viewTransition>
          <img src="/badge-128.png" alt="" width={40} height={40} />
          <span><b>Bannuar</b><small>HR portal</small></span>
        </Link>
        <Nav groups={groups} />
        <div className="side-foot">
          <b>{access?.full_name || access?.email}</b>
          <span>{access?.roles.filter((r) => r !== 'employee').map((r) => ROLE_LABEL[r]).join(', ')}</span>
          <div className="row" style={{ marginTop: 10 }}>
            <Link className="btn btn-night btn-sm" to="/account" viewTransition>Password</Link>
            <button className="btn btn-night btn-sm" type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </aside>
      <button className={`scrim${menu ? ' open' : ''}`} type="button" tabIndex={-1} aria-hidden="true" onClick={() => setMenu(false)} />
      <div className="main">
        <header className="topbar">
          <button className="btn btn-line btn-sm topbar__menu" type="button" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>Menu</button>
          <JumpTo pages={pages} />
          <span className="topbar__spacer" />
          <Bell />
        </header>
        <main className="content" id="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
