import { post } from './files';

/**
 * Discipline (schema.sql section 16). The database enforces due process (DOLE D.O. 147-15): the notice
 * to explain names an approved rule and gives at least five calendar days, the employee is heard, a
 * dismissal needs a hearing or conference, and a penalty other than the code's needs a reason. Claude,
 * through the discipline-ai Edge Function, only proposes: rules HR approves, and suggestions HR edits.
 */
export interface Penalty { offense: number; action: string; days?: number; text?: string }
export interface OffenseRule {
  id: string; code_id: string; ref: string; title: string; description: string; category: string; gravity: string;
  penalties: Penalty[]; just_cause: string; source_text: string; page: number | null; sort: number;
  status: 'proposed' | 'approved' | 'rejected'; from_ai: boolean; reviewed_at: string | null;
}
export interface DisciplineCode {
  id: string; title: string; effective_on: string | null; file_key: string; status: 'draft' | 'active' | 'retired';
  read_status: 'not_read' | 'reading' | 'read' | 'failed'; read_error: string | null; read_started_at: string | null; read_at: string | null;
  read_model: string | null; summary: string | null; compliance_notes: { ref: string; note: string }[]; created_at: string; activated_at: string | null;
}
export interface Suggestion {
  matches: { rule_id: string; confidence: 'high' | 'medium' | 'low'; why: string }[];
  missing_facts: string[]; nte_draft: string; cautions: string[]; model?: string;
}

export const RULE_COLUMNS = 'id,code_id,ref,title,description,category,gravity,penalties,just_cause,source_text,page,sort,status,from_ai,reviewed_at';
export const CODE_COLUMNS = 'id,title,effective_on,file_key,status,read_status,read_error,read_started_at,read_at,read_model,summary,compliance_notes,created_at,activated_at';

async function ai<T>(body: Record<string, string>): Promise<T> {
  return (await (await post('discipline-ai', JSON.stringify(body))).json()) as T;
}
export const readCode = (codeId: string) => ai<{ status: string }>({ action: 'read_code', code_id: codeId });
export const checkCode = (codeId: string) => ai<{ status: string; rules?: number; message?: string }>({ action: 'check_code', code_id: codeId });
export const suggestForCase = (caseId: string) => ai<Suggestion>({ action: 'suggest', case_id: caseId });

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
export const ordinal = (n: number) => ORD[n] ?? `${n}th`;

/** "Suspension, 7 days" */
export function penaltyText(p: Penalty | null | undefined): string {
  if (!p) return 'Not in the code';
  const name = { warning: 'Warning', reprimand: 'Reprimand', suspension: 'Suspension', dismissal: 'Dismissal', other: 'Other' }[p.action] ?? p.action;
  return p.action === 'suspension' && p.days ? `${name}, ${p.days} ${p.days === 1 ? 'day' : 'days'}` : p.action === 'other' && p.text ? p.text : name;
}

/** The code's penalty for this offense count: the last one listed covers later offenses (code_penalty). */
export function codePenalty(rule: Pick<OffenseRule, 'penalties'> | null | undefined, offenseNo: number | null | undefined): Penalty | null {
  if (!rule) return null;
  const n = Math.max(offenseNo ?? 1, 1);
  return [...(rule.penalties ?? [])].filter((p) => p.offense <= n).sort((a, b) => b.offense - a.offense)[0] ?? null;
}

/** Fills Claude's draft notice: {{employee_name}}, {{case_no}}, {{explain_by}}, {{post}}, {{rule}}. */
export function fillDraft(draft: string, v: Record<'employee_name' | 'case_no' | 'explain_by' | 'post' | 'rule', string>): string {
  return draft.replace(/\{\{(employee_name|case_no|explain_by|post|rule)\}\}/g, (_, k: keyof typeof v) => v[k] || '[to fill in]');
}

/** The earliest deadline the database accepts: five calendar days from now, at 5 PM Manila, as datetime-local. */
export function defaultExplainBy(now = new Date()): string {
  const d = new Date(now.getTime() + 5 * 86400000 + 8 * 3600000); // Manila wall clock
  let day = d.toISOString().slice(0, 10);
  if (d.getUTCHours() >= 17) day = new Date(d.getTime() + 86400000).toISOString().slice(0, 10);
  return `${day}T17:00`;
}

/** A Manila datetime-local value as an ISO time. */
export const manilaIso = (local: string) => new Date(`${local}:00+08:00`).toISOString();
