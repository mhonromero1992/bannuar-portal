import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errorText, fmtAmount, fmtDate, fullName, todayManila } from '../lib/format';
import { CUTOFF_CLIENT_STATUS, LEAVE_STATUS, label } from '../lib/labels';
import { useSites } from '../lib/refs';
import { downloadFile } from '../lib/payData';
import { toCsv } from '../lib/pay';
import type { ReportColumn } from '../lib/reportPdf';
import { Empty, ErrorState, Loading, PageHead, SelectField, TextField, useToast } from '../ui/kit';

/**
 * Reports: each one filtered on screen, then downloaded as an Excel file (CSV) or a PDF. A report reads
 * only what the person's role may read (the database's rules apply), so a report someone cannot use is
 * not offered. Figures that need the time in and out or the payslips come from the report_* functions
 * (schema.sql section 22).
 */
type Can = ReturnType<typeof useAuth>['can'];
type FilterKey = 'dates' | 'client' | 'site' | 'period' | 'month';
interface Filters { from: string; to: string; client: string; site: string; period: string; month: string }
type Cell = string | number | null;
interface Result { columns: ReportColumn[]; rows: Cell[][]; totals?: Cell[]; lines: string[] }
interface Ctx { f: Filters; clients: { id: string; name: string }[]; sites: { id: string; name: string }[]; periods: { id: string; label: string }[] }
interface Report { id: string; title: string; lead: string; show: (can: Can) => boolean; filters: FilterKey[]; load: (c: Ctx) => Promise<Result> }

const PREVIEW = 100;
const peso = (n: number | string | null) => (n === null || n === undefined || n === '' ? '' : Number(n).toFixed(2));
const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const sum = (rows: Cell[][], i: number) => rows.reduce((t, r) => t + Number(r[i] ?? 0), 0);
const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '';
const scope = (c: Ctx) => [c.f.client ? `Client: ${name(c.clients, c.f.client)}` : 'All clients', c.f.site ? `Post: ${name(c.sites, c.f.site)}` : 'All posts'].join(' · ');
const range = (f: Filters) => `${fmtDate(f.from)} to ${fmtDate(f.to)}`;
const monthName = (m: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
/** Every row of a table read, a thousand at a time (the API's page size). */
async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
type Person = { employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null };

const REPORTS: Report[] = [
  {
    id: 'attendance', title: 'Attendance summary', filters: ['dates', 'client', 'site'], show: (can) => can.staff,
    lead: 'Each guard\'s duties at each post between two dates: how many, how many count on their own, how many need payroll\'s look, and the hours.',
    load: async (c) => {
      const data = await rpc<{ employee_no: string; name: string; post: string | null; client: string | null; duties: number; clean: number; to_look: number; hours: number; first_day: string; last_day: string }[]>(
        'report_attendance', { p_from: c.f.from, p_to: c.f.to, p_client_id: c.f.client || null, p_site_id: c.f.site || null });
      const rows: Cell[][] = data.map((r) => [r.employee_no, r.name, r.client ?? '', r.post ?? 'No post', r.duties, r.clean, r.to_look, Number(r.hours), fmtDate(r.first_day), fmtDate(r.last_day)]);
      return {
        lines: [range(c.f), scope(c), 'A duty is a time in and the time out after it. "Needs a look": away from the post, a missing time in or out, logged by the commander or by hand, or from the logbook.'],
        columns: [{ label: 'No.', width: 0.8 }, { label: 'Name', width: 1.8 }, { label: 'Client', width: 1.3 }, { label: 'Post', width: 1.6 }, { label: 'Duties', width: 0.7, align: 'right' },
          { label: 'Count', width: 0.7, align: 'right' }, { label: 'Needs a look', width: 0.9, align: 'right' }, { label: 'Hours', width: 0.8, align: 'right' }, { label: 'First', width: 1 }, { label: 'Last', width: 1 }],
        rows,
        totals: ['', many(rows.length, 'guard-post row'), '', '', sum(rows, 4), sum(rows, 5), sum(rows, 6), Number(sum(rows, 7).toFixed(2)), '', ''],
      };
    },
  },
  {
    id: 'coverage', title: 'Client coverage for a cutoff', filters: ['period', 'client'], show: (can) => can.payroll || can.hr || can.ops,
    lead: 'For one cutoff, per client and post: duties logged, counted, not counted, still to decide, disputed by the client, the hours that count, and the client\'s answer. A basis for billing.',
    load: async (c) => {
      if (!c.f.period) throw new Error('Choose the cutoff.');
      const data = await rpc<{ client: string | null; post: string | null; duties: number; counted: number; not_counted: number; to_decide: number; disputed: number; hours_counted: number; client_status: string | null }[]>(
        'report_cutoff_coverage', { p_period_id: c.f.period });
      const want = c.f.client ? name(c.clients, c.f.client) : '';
      const rows: Cell[][] = data.filter((r) => !want || r.client === want).map((r) => [r.client ?? 'No client', r.post ?? 'No post', r.duties, r.counted, r.not_counted, r.to_decide, r.disputed, Number(r.hours_counted), label(CUTOFF_CLIENT_STATUS, r.client_status ?? 'not_asked')]);
      return {
        lines: [`Cutoff: ${c.periods.find((p) => p.id === c.f.period)?.label ?? ''}`, c.f.client ? `Client: ${want}` : 'All clients', 'Counted: clean duties payroll did not take out, and exceptions payroll counted.'],
        columns: [{ label: 'Client', width: 1.5 }, { label: 'Post', width: 1.8 }, { label: 'Duties', width: 0.7, align: 'right' }, { label: 'Counted', width: 0.8, align: 'right' }, { label: 'Not counted', width: 0.9, align: 'right' },
          { label: 'To decide', width: 0.8, align: 'right' }, { label: 'Disputed', width: 0.8, align: 'right' }, { label: 'Hours counted', width: 1, align: 'right' }, { label: 'Client\'s answer', width: 1.6 }],
        rows,
        totals: ['Total', '', sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), Number(sum(rows, 7).toFixed(2)), ''],
      };
    },
  },
  {
    id: 'register', title: 'Payroll register', filters: ['period'], show: (can) => can.payroll,
    lead: 'Every payslip in a cutoff, line by line, with the totals: earnings, deductions and net pay.',
    load: async (c) => {
      if (!c.f.period) throw new Error('Choose the cutoff.');
      const data = await all<Record<string, unknown> & { employee: Person }>((a, b) => supabase.from('payslips')
        .select('site_name,days_worked,basic_pay,overtime_pay,night_diff_pay,holiday_pay,allowances,other_earnings,gross_pay,sss,philhealth,pagibig,withholding_tax,loans,other_deductions,total_deductions,net_pay,employee:employees!inner(employee_no,first_name,middle_name,last_name,suffix)')
        .eq('payroll_period_id', c.f.period).order('created_at').range(a, b) as unknown as PromiseLike<{ data: (Record<string, unknown> & { employee: Person })[] | null; error: unknown }>);
      const money = ['basic_pay', 'overtime_pay', 'night_diff_pay', 'holiday_pay', 'allowances', 'other_earnings', 'gross_pay', 'sss', 'philhealth', 'pagibig', 'withholding_tax', 'loans', 'other_deductions', 'total_deductions', 'net_pay'];
      const rows: Cell[][] = data.sort((x, y) => x.employee.last_name.localeCompare(y.employee.last_name))
        .map((r) => [r.employee.employee_no, fullName(r.employee), String(r.site_name ?? ''), Number(r.days_worked ?? 0), ...money.map((k) => Number(r[k] ?? 0))]);
      return {
        lines: [`Cutoff: ${c.periods.find((p) => p.id === c.f.period)?.label ?? ''}`, `${many(rows.length, 'payslip')}. Amounts in pesos.`],
        columns: [{ label: 'No.', width: 1.1 }, { label: 'Name', width: 1.6 }, { label: 'Post', width: 1.25 }, { label: 'Days', width: 0.45, align: 'right' },
          ...['Basic', 'Overtime', 'Night diff.', 'Holiday', 'Allowances', 'Other earnings', 'Gross', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Tax', 'Loans', 'Other deductions', 'Total deductions', 'Net pay'].map((l) => ({ label: l, width: 0.85, align: 'right' as const, money: true }))],
        rows: rows.map((r) => r.map((v, i) => (i >= 4 ? peso(v as number) : v))),
        totals: ['', 'Total', '', Number(sum(rows, 3).toFixed(2)), ...money.map((_, i) => peso(sum(rows, i + 4)))],
      };
    },
  },
  {
    id: 'contributions', title: 'Government contributions', filters: ['month'], show: (can) => can.payroll,
    lead: 'For a month: each employee\'s SSS, PhilHealth and Pag-IBIG shares and withholding tax on the published cutoffs ending in it, with their numbers, to prepare the remittances. Opening it is written to the audit log.',
    load: async (c) => {
      const data = await rpc<{ employee_no: string; name: string; sss_no: string | null; philhealth_no: string | null; pagibig_no: string | null; tin: string | null; cutoffs: number; gross: number; sss: number; philhealth: number; pagibig: number; withholding_tax: number }[]>(
        'report_contributions', { p_month: `${c.f.month}-01` });
      const rows: Cell[][] = data.map((r) => [r.employee_no, r.name, r.sss_no ?? '', r.philhealth_no ?? '', r.pagibig_no ?? '', r.tin ?? '', r.cutoffs, Number(r.gross), Number(r.sss), Number(r.philhealth), Number(r.pagibig), Number(r.withholding_tax)]);
      return {
        lines: [`Month: ${monthName(c.f.month)} (published cutoffs ending in it)`, 'Employee shares as deducted on the payslips; add the employer shares when remitting.'],
        columns: [{ label: 'No.', width: 1 }, { label: 'Name', width: 1.6 }, { label: 'SSS no.', width: 1.1 }, { label: 'PhilHealth no.', width: 1.2 }, { label: 'Pag-IBIG no.', width: 1.2 }, { label: 'TIN', width: 1.1 },
          { label: 'Cutoffs', width: 0.6, align: 'right' }, { label: 'Gross', width: 0.9, align: 'right', money: true }, { label: 'SSS', width: 0.8, align: 'right', money: true }, { label: 'PhilHealth', width: 0.8, align: 'right', money: true }, { label: 'Pag-IBIG', width: 0.8, align: 'right', money: true }, { label: 'Tax', width: 0.8, align: 'right', money: true }],
        rows: rows.map((r) => r.map((v, i) => (i >= 7 ? peso(v as number) : v))),
        totals: ['', many(rows.length, 'employee'), '', '', '', '', '', peso(sum(rows, 7)), peso(sum(rows, 8)), peso(sum(rows, 9)), peso(sum(rows, 10)), peso(sum(rows, 11))],
      };
    },
  },
  {
    id: 'licenses', title: 'Licenses and documents', filters: ['site'], show: (can) => can.staff,
    lead: 'As of today: verified licenses and clearances that have expired or expire soon, and the deployable employees missing a required one.',
    load: async (c) => {
      type Alert = { employee_no: string; first_name: string; last_name: string; site_id: string | null; site_name: string | null; type_name: string; document_no: string | null; expires_on: string; days_left: number; state: string };
      type Gap = { employee_no: string; first_name: string; last_name: string; site_id: string | null; site_name: string | null; type_name: string; last_expiry: string | null };
      const [alerts, gaps] = await Promise.all([
        all<Alert>((a, b) => supabase.from('document_alerts').select('employee_no,first_name,last_name,site_id,site_name,type_name,document_no,expires_on,days_left,state').order('expires_on').range(a, b) as unknown as PromiseLike<{ data: Alert[] | null; error: unknown }>),
        all<Gap>((a, b) => supabase.from('compliance_gaps').select('employee_no,first_name,last_name,site_id,site_name,type_name,last_expiry').order('last_name').range(a, b) as unknown as PromiseLike<{ data: Gap[] | null; error: unknown }>),
      ]);
      const here = (x: { site_id: string | null }) => !c.f.site || x.site_id === c.f.site;
      const rows: Cell[][] = [
        ...alerts.filter(here).map((x) => [x.employee_no, `${x.first_name} ${x.last_name}`, x.site_name ?? 'No post', x.type_name, x.document_no ?? '', fmtDate(x.expires_on),
          x.state === 'expired' ? `Expired ${-x.days_left} days ago` : `Expires in ${x.days_left} days`]),
        ...gaps.filter(here).map((x) => [x.employee_no, `${x.first_name} ${x.last_name}`, x.site_name ?? 'No post', x.type_name, '', x.last_expiry ? fmtDate(x.last_expiry) : '', x.last_expiry ? 'Missing: last one expired' : 'Missing']),
      ];
      return {
        lines: [`As of ${fmtDate(todayManila())}`, c.f.site ? `Post: ${name(c.sites, c.f.site)}` : 'All posts'],
        columns: [{ label: 'No.', width: 0.8 }, { label: 'Name', width: 1.6 }, { label: 'Post', width: 1.5 }, { label: 'Document', width: 1.7 }, { label: 'Number', width: 1.2 }, { label: 'Expires', width: 1 }, { label: 'State', width: 1.5 }],
        rows,
        totals: ['', `${rows.length} to act on`, '', '', '', '', ''],
      };
    },
  },
  {
    id: 'headcount', title: 'Headcount and deployment', filters: ['client'], show: (can) => can.staff,
    lead: 'Each post\'s guards against the number its client needs, and the roll by status: active, floating, on leave, suspended.',
    load: async (c) => {
      const { data, error } = await supabase.from('site_staffing').select('name,client_id,client_name,area_name,city,guards_required,guards_assigned,is_active').eq('is_active', true).order('client_name').order('name');
      if (error) throw error;
      const counts = await Promise.all(['active', 'floating', 'on_leave', 'suspended'].map(async (s) => {
        const r = await supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', s);
        if (r.error) throw r.error;
        return `${r.count ?? 0} ${s.replace('_', ' ')}`;
      }));
      const rows: Cell[][] = (data ?? []).filter((s) => !c.f.client || s.client_id === c.f.client)
        .map((s) => [s.client_name ?? 'No client', s.name, [s.city, s.area_name].filter(Boolean).join(' · '), s.guards_required ?? 0, s.guards_assigned ?? 0, Math.max(0, (s.guards_required ?? 0) - (s.guards_assigned ?? 0))]);
      return {
        lines: [`As of ${fmtDate(todayManila())}`, c.f.client ? `Client: ${name(c.clients, c.f.client)}` : 'All clients', `Employees: ${counts.join(', ')}`],
        columns: [{ label: 'Client', width: 1.5 }, { label: 'Post', width: 1.8 }, { label: 'Where', width: 1.5 }, { label: 'Needed', width: 0.8, align: 'right' }, { label: 'Assigned', width: 0.8, align: 'right' }, { label: 'Short by', width: 0.8, align: 'right' }],
        rows,
        totals: ['Total', many(rows.length, 'post'), '', sum(rows, 3), sum(rows, 4), sum(rows, 5)],
      };
    },
  },
  {
    id: 'incidents', title: 'Incident reports', filters: ['dates', 'client'], show: (can) => can.hr || can.ops,
    lead: 'Incidents filed by clients, detachment commanders and staff between two dates, with where each stands.',
    load: async (c) => {
      type Inc = { report_no: string; occurred_at: string; title: string; reporter_kind: string; reporter_name: string | null; status: string; client_id: string | null; guard_described: string | null;
        site: { name: string } | null; client: { name: string } | null; employee: Person | null };
      const data = await all<Inc>((a, b) => {
        let q = supabase.from('incident_reports').select('report_no,occurred_at,title,reporter_kind,reporter_name,status,client_id,guard_described,site:sites(name),client:clients(name),employee:employees(employee_no,first_name,middle_name,last_name,suffix)')
          .gte('occurred_at', `${c.f.from}T00:00:00+08:00`).lt('occurred_at', `${c.f.to}T23:59:59+08:00`).order('occurred_at');
        if (c.f.client) q = q.eq('client_id', c.f.client);
        return q.range(a, b) as unknown as PromiseLike<{ data: Inc[] | null; error: unknown }>;
      });
      const rows: Cell[][] = data.map((x) => [x.report_no, fmtDate(x.occurred_at), x.client?.name ?? '', x.site?.name ?? '', x.title,
        x.employee ? fullName(x.employee) : x.guard_described ?? '', `${x.reporter_kind}${x.reporter_name ? `: ${x.reporter_name}` : ''}`, x.status.replace(/_/g, ' ')]);
      return {
        lines: [range(c.f), c.f.client ? `Client: ${name(c.clients, c.f.client)}` : 'All clients'],
        columns: [{ label: 'Report', width: 1.1 }, { label: 'Date', width: 0.9 }, { label: 'Client', width: 1.2 }, { label: 'Post', width: 1.3 }, { label: 'What happened', width: 2.2 }, { label: 'Guard', width: 1.3 }, { label: 'Reported by', width: 1.4 }, { label: 'Status', width: 0.9 }],
        rows,
        totals: [many(rows.length, 'report'), '', '', '', '', '', '', ''],
      };
    },
  },
  {
    id: 'cases', title: 'Discipline cases', filters: ['dates'], show: (can) => can.hr,
    lead: 'Cases opened between two dates: the employee, the rule and offense, where due process stands, and the decision.',
    load: async (c) => {
      type Case = { case_no: string; created_at: string; status: string; offense_no: number | null; decision: string | null; suspension_days: number | null; decided_at: string | null;
        employee: Person | null; rule: { ref: string | null; title: string } | null };
      const data = await all<Case>((a, b) => supabase.from('disciplinary_cases')
        .select('case_no,created_at,status,offense_no,decision,suspension_days,decided_at,employee:employees(employee_no,first_name,middle_name,last_name,suffix),rule:offense_rules(ref,title)')
        .gte('created_at', `${c.f.from}T00:00:00+08:00`).lt('created_at', `${c.f.to}T23:59:59+08:00`).order('created_at').range(a, b) as unknown as PromiseLike<{ data: Case[] | null; error: unknown }>);
      const rows: Cell[][] = data.map((x) => [x.case_no, fmtDate(x.created_at), x.employee ? `${fullName(x.employee)} · ${x.employee.employee_no}` : '', x.rule ? `${x.rule.ref ? `${x.rule.ref} ` : ''}${x.rule.title}` : '',
        x.offense_no ?? '', x.status.replace(/_/g, ' '), x.decision ? `${x.decision.replace(/_/g, ' ')}${x.suspension_days ? `, ${x.suspension_days} days` : ''}` : '', x.decided_at ? fmtDate(x.decided_at) : '']);
      return {
        lines: [range(c.f)],
        columns: [{ label: 'Case', width: 1.1 }, { label: 'Opened', width: 0.9 }, { label: 'Employee', width: 2 }, { label: 'Rule', width: 2.2 }, { label: 'Offense', width: 0.6, align: 'right' }, { label: 'Status', width: 1 }, { label: 'Decision', width: 1.3 }, { label: 'Decided', width: 0.9 }],
        rows,
        totals: [many(rows.length, 'case'), '', '', '', '', '', '', ''],
      };
    },
  },
  {
    id: 'leave', title: 'Leave', filters: ['dates'], show: (can) => can.hr || can.ops,
    lead: 'Leave falling between two dates: who, what kind, the days, and where each request stands.',
    load: async (c) => {
      type Lv = { start_date: string; end_date: string; days: number; status: string; employee: Person | null; type: { name: string } | null };
      const data = await all<Lv>((a, b) => supabase.from('leave_requests')
        .select('start_date,end_date,days,status,employee:employees!leave_requests_employee_id_fkey(employee_no,first_name,middle_name,last_name,suffix),type:leave_types(name)')
        .lte('start_date', c.f.to).gte('end_date', c.f.from).order('start_date').range(a, b) as unknown as PromiseLike<{ data: Lv[] | null; error: unknown }>);
      const rows: Cell[][] = data.map((x) => [x.employee?.employee_no ?? '', x.employee ? fullName(x.employee) : '', x.type?.name ?? '', fmtDate(x.start_date), fmtDate(x.end_date), Number(x.days), label(LEAVE_STATUS, x.status)]);
      const approved = data.filter((x) => x.status === 'approved').reduce((t, x) => t + Number(x.days), 0);
      return {
        lines: [range(c.f), 'Requests that overlap these dates, in whole.'],
        columns: [{ label: 'No.', width: 0.8 }, { label: 'Name', width: 1.8 }, { label: 'Leave', width: 1.7 }, { label: 'From', width: 1 }, { label: 'To', width: 1 }, { label: 'Days', width: 0.6, align: 'right' }, { label: 'Status', width: 1.2 }],
        rows,
        totals: ['', many(rows.length, 'request'), '', '', 'Approved days', approved, ''],
      };
    },
  },
];

export default function Reports() {
  const { can, access } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const offered = REPORTS.filter((r) => r.show(can));
  const report = offered.find((r) => r.id === params.get('r')) ?? offered[0];
  const today = todayManila();
  const [f, setF] = useState<Filters>({ from: `${today.slice(0, 7)}-01`, to: today, client: '', site: '', period: '', month: today.slice(0, 7) });
  const [busy, setBusy] = useState('');
  const sites = useSites();
  const clients = useQuery({
    queryKey: ['report-clients'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('id,name').order('name');
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });
  const periods = useQuery({
    queryKey: ['report-periods'],
    enabled: Boolean(report?.filters.includes('period')),
    queryFn: async () => {
      const { data, error } = await supabase.from('payroll_periods').select('id,label,period_start,status,kind').eq('kind', 'regular').order('period_start', { ascending: false }).limit(48);
      if (error) throw error;
      return data as { id: string; label: string; period_start: string; status: string }[];
    },
  });
  const period = f.period || periods.data?.[0]?.id || '';
  const ctx: Ctx = useMemo(() => ({
    f: { ...f, period }, clients: clients.data ?? [], sites: (sites.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    periods: (periods.data ?? []).map((p) => ({ id: p.id, label: `${p.label}${p.status === 'draft' ? ' (draft)' : ''}` })),
  }), [f, period, clients.data, sites.data, periods.data]);
  const used = report?.filters ?? [];
  const ready = !used.includes('period') || Boolean(period);
  const q = useQuery({
    queryKey: ['report', report?.id, used.includes('dates') ? [f.from, f.to] : null, used.includes('client') ? f.client : null, used.includes('site') ? f.site : null, used.includes('period') ? period : null, used.includes('month') ? f.month : null],
    enabled: Boolean(report) && ready && Boolean(clients.data) && Boolean(sites.data),
    queryFn: () => report!.load(ctx),
    placeholderData: (prev) => prev,
    retry: false,
  });
  if (!report) return <><PageHead title="Reports" /><Empty title="No reports for your role">Ask a super admin for the role you need.</Empty></>;

  const file = `${report.title} ${used.includes('period') ? (ctx.periods.find((p) => p.id === period)?.label ?? '') : used.includes('month') ? f.month : used.includes('dates') ? `${f.from} to ${f.to}` : today}`.replace(/[^\w .-]+/g, ' ').trim();
  const csv = () => {
    const r = q.data!;
    const head = r.columns.map((c) => c.label);
    const rows = [...r.rows, ...(r.totals ? [r.totals] : [])].map((row) => Object.fromEntries(head.map((h, i) => [h, row[i] ?? ''])));
    downloadFile(`${file}.csv`, toCsv(rows, head));
  };
  const pdf = async () => {
    setBusy('Making the PDF…');
    try {
      const { reportPdf } = await import('../lib/reportPdf');
      const r = q.data!;
      const bytes = await reportPdf({ title: report.title, lines: r.lines, columns: r.columns, rows: r.rows, totals: r.totals, madeBy: access?.full_name ?? access?.email ?? 'staff' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      a.download = `${file}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy('');
    }
  };
  const set = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <>
      <PageHead title="Reports" intro="Choose a report, filter it, and download it as an Excel file (CSV) or a PDF. Each report shows only what your role may see." />
      <div className="report-list" role="tablist" aria-label="Reports">
        {offered.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={r.id === report.id} className={`report-card${r.id === report.id ? ' on' : ''}`} onClick={() => setParams({ r: r.id }, { replace: true })}>
            <b>{r.title}</b><span>{r.lead}</span>
          </button>
        ))}
      </div>
      <div className="panel">
        <div className="panel-head"><h2>{report.title}</h2></div>
        <div className="toolbar">
          {used.includes('dates') && <>
            <TextField label="From" type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set('from', e.target.value)} style={{ width: 'auto' }} />
            <TextField label="To" type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set('to', e.target.value)} style={{ width: 'auto' }} />
          </>}
          {used.includes('month') && <TextField label="Month" type="month" value={f.month} onChange={(e) => e.target.value && set('month', e.target.value)} style={{ width: 'auto' }} />}
          {used.includes('period') && <SelectField label="Cutoff" value={period} onChange={(e) => set('period', e.target.value)} options={ctx.periods.map((p) => ({ value: p.id, label: p.label }))} style={{ width: 'auto' }} />}
          {used.includes('client') && <SelectField label="Client" value={f.client} onChange={(e) => set('client', e.target.value)} options={[{ value: '', label: 'All clients' }, ...ctx.clients.map((c) => ({ value: c.id, label: c.name }))]} style={{ width: 'auto' }} />}
          {used.includes('site') && <SelectField label="Post" value={f.site} onChange={(e) => set('site', e.target.value)} options={[{ value: '', label: 'All posts' }, ...ctx.sites.map((s) => ({ value: s.id, label: s.name }))]} style={{ width: 'auto' }} />}
          <span className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn btn-line" type="button" disabled={!q.data || Boolean(busy)} onClick={csv}>Download Excel (CSV)</button>
            <button className="btn" type="button" disabled={!q.data || Boolean(busy)} aria-busy={Boolean(busy)} onClick={pdf}>Download PDF</button>
          </span>
        </div>
        {used.includes('period') && !periods.isLoading && !ctx.periods.length ? <Empty title="No cutoffs yet">Make a cutoff on the Payroll page first.</Empty>
          : q.isLoading || !q.data && !q.error ? <Loading what="Making the report" /> : q.error ? <ErrorState error={errorText(q.error)} retry={() => q.refetch()} /> : (
          <div className={q.isPlaceholderData ? 'is-stale' : ''}>
            <p className="report-lines muted small">{q.data!.lines.join(' · ')}</p>
            {!q.data!.rows.length ? <Empty title="Nothing to report">Nothing matches these filters.</Empty> : (
              <div className="table-wrap">
                <table className="table report-table">
                  <thead><tr>{q.data!.columns.map((c) => <th key={c.label} className={c.align === 'right' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                  <tbody>
                    {q.data!.rows.slice(0, PREVIEW).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={q.data!.columns[j].align === 'right' ? 'num' : undefined}>{q.data!.columns[j].money ? fmtAmount(v) : v}</td>)}</tr>)}
                    {q.data!.totals && <tr className="report-total">{q.data!.totals.map((v, j) => <td key={j} className={q.data!.columns[j].align === 'right' ? 'num' : undefined}><b>{q.data!.columns[j].money ? fmtAmount(v) : v}</b></td>)}</tr>}
                  </tbody>
                </table>
              </div>
            )}
            {q.data!.rows.length > PREVIEW && <p className="pager">Showing {PREVIEW} of {q.data!.rows.length} rows here. The downloads have them all.</p>}
          </div>
        )}
        {busy && <p className="muted small" role="status" style={{ margin: '0 18px 14px' }}>{busy}</p>}
      </div>
    </>
  );
}
