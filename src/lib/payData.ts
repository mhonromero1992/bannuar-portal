import { supabase } from './supabase';
import { fullName } from './format';
import type { Assignment, PayRate, PayRule, Person, Post } from './pay';

/** Supabase answers at most 1,000 rows a request: read a whole list page by page. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

type EmployeeRow = { id: string; employee_no: string; first_name: string; middle_name: string | null; last_name: string; suffix: string | null; date_hired: string | null; date_separated: string | null };
const PERSON = 'id,employee_no,first_name,middle_name,last_name,suffix,date_hired,date_separated';
const toPerson = (e: EmployeeRow): Person => ({ id: e.id, employee_no: e.employee_no, name: fullName(e), date_hired: e.date_hired, date_separated: e.date_separated });

/** Employees by id or by number, a few hundred a request so the address stays short. */
export async function loadPeople(by: 'id' | 'employee_no', values: string[]): Promise<Person[]> {
  const out: Person[] = [];
  for (let i = 0; i < values.length; i += 150) {
    const { data, error } = await supabase.from('employees').select(PERSON).in(by, values.slice(i, i + 150));
    if (error) throw error;
    out.push(...(data as EmployeeRow[]).map(toPerson));
  }
  return out;
}

export interface PayInputs { assignments: Assignment[]; posts: Post[]; rules: PayRule[]; rates: PayRate[]; people: Person[] }

/** Everything pay needs for the days from..to: the assignments in them, every post, rule and rate. */
export async function loadPayInputs(from: string, to: string): Promise<PayInputs> {
  const [assignments, posts, rules, rates] = await Promise.all([
    fetchAll<Assignment>((a, b) => supabase.from('employee_assignments').select('employee_id,site_id,start_date,end_date,duty_hours,shift_start').lte('start_date', to).or(`end_date.is.null,end_date.gte.${from}`).order('id').range(a, b)),
    fetchAll<Post>((a, b) => supabase.from('sites').select('id,name,code,client_id,pay_rule_id').order('id').range(a, b)),
    fetchAll<PayRule>((a, b) => supabase.from('pay_rules').select('*').order('id').range(a, b)),
    fetchAll<PayRate>((a, b) => supabase.from('pay_rates').select('site_id,client_id,effective_from,hourly_rate').order('id').range(a, b)),
  ]);
  const people = await loadPeople('id', [...new Set(assignments.map((x) => x.employee_id))]);
  return { assignments, posts, rules, rates, people };
}

/** Hand the person a file. A byte order mark lets Excel read ñ and ₱ in a CSV. */
export function downloadFile(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([type === 'text/csv' ? `﻿${text}` : text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function readCsv(file: File): Promise<{ rows: Record<string, string>[]; error?: string }> {
  const Papa = (await import('papaparse')).default;
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => resolve({ rows: res.data }),
      error: (err) => resolve({ rows: [], error: err.message }),
    });
  });
}

interface ImportResult { inserted: number; updated: number; errors: { row: number; employee_no?: string; message: string }[] }

/** Save payroll rows into a cutoff through import_payslips, 500 at a time. */
export async function savePayslips(periodId: string, rows: Record<string, string | number>[], progress?: (text: string) => void): Promise<ImportResult> {
  const total: ImportResult = { inserted: 0, updated: 0, errors: [] };
  for (let i = 0; i < rows.length; i += 500) {
    progress?.(`Saving ${i + 1} to ${Math.min(rows.length, i + 500)} of ${rows.length}…`);
    const { data, error } = await supabase.rpc('import_payslips', { p_period_id: periodId, p_rows: rows.slice(i, i + 500) });
    if (error) throw error;
    const r = data as ImportResult;
    total.inserted += r.inserted;
    total.updated += r.updated;
    total.errors.push(...r.errors.map((x) => ({ ...x, row: x.row + i })));
  }
  return total;
}
