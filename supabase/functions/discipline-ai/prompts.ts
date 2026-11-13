/**
 * What discipline-ai asks Claude, and the JSON shapes it asks for (structured outputs). Kept apart from
 * the handler so the requests can be read, reviewed by HR's counsel, and tested without the network.
 *
 * Claude proposes; people decide. Reading the code produces rules HR approves one by one, and a case
 * suggestion is a starting point HR edits. Nothing here names an employee: a case is described by its
 * facts, and the draft notice uses placeholders the portal fills in.
 */
import type Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';

/** Claude Opus 5.5, as Bannuar asked (at least Opus 5.5). */
export const MODEL = 'claude-opus-5-5';

export const CATEGORIES = [
  'attendance',
  'post_duty',
  'conduct',
  'uniform_equipment',
  'dishonesty',
  'safety_security',
  'substance',
  'insubordination',
  'other',
] as const;
export const GRAVITY = ['light', 'less_serious', 'serious', 'grave', 'unclassified'] as const;
export const ACTIONS = ['warning', 'reprimand', 'suspension', 'dismissal', 'other'] as const;
export const JUST_CAUSES = [
  'none',
  'serious_misconduct',
  'willful_disobedience',
  'gross_neglect',
  'fraud_breach_of_trust',
  'crime_against_employer',
  'analogous',
] as const;

const str = { type: 'string' };
const int = { type: 'integer' };
const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

/** Every offense in the code, as written. Empty strings and 0 stand for "not in the code". */
export const CODE_SCHEMA = obj({
  readable: { type: 'boolean' },
  summary: str,
  rules: {
    type: 'array',
    items: obj({
      ref: str,
      title: str,
      description: str,
      category: { type: 'string', enum: [...CATEGORIES] },
      gravity: { type: 'string', enum: [...GRAVITY] },
      penalties: {
        type: 'array',
        items: obj({ offense: int, action: { type: 'string', enum: [...ACTIONS] }, days: int, text: str }),
      },
      just_cause: { type: 'string', enum: [...JUST_CAUSES] },
      source_text: str,
      page: int,
    }),
  },
  compliance_notes: { type: 'array', items: obj({ ref: str, note: str }) },
});

export const CODE_SYSTEM = `You read a Philippine security agency's Code of Discipline (its company rules and regulations) for the agency's HR team. HR reviews every line you return before any of it is used, and people, not you, decide discipline cases. Accuracy to the document matters more than completeness of interpretation.

List every offense the code defines, in the order it appears. Copy the code's own numbering into ref and its wording into source_text (up to about 400 characters; end with "…" if you shorten it). Do not invent offenses, penalties or numbering, and do not merge offenses the code lists separately. When the code does not give a value, use an empty string, 0, "unclassified" or "none".

- title: the offense's name as the code gives it; description: one plain sentence on what it covers.
- penalties: one entry per offense count the code gives (offense 1 is the first offense). action is the closest of warning, reprimand, suspension, dismissal or other; days is the suspension's length in days, 0 when it is not a suspension; text is the code's own words for that penalty.
- gravity: the code's own class for the offense (light, less serious, serious, grave), or unclassified when the code does not class it.
- just_cause: only when dismissal is one of the code's penalties for the offense, the ground under Article 297 of the Labor Code it most plainly falls under; otherwise none.
- category: the closest topic.
- page: the PDF page where the offense appears (the first page is 1), or 0 when unsure.

compliance_notes: clauses the agency's lawyer should look at against Philippine labor law and DOLE rules. For example: penalties taken from wages or deposits (Labor Code Articles 113 and 116), discipline without a written notice to explain and a chance to be heard (DOLE Department Order 147-15), preventive suspension beyond 30 days, or a penalty out of proportion to its offense. Each note names the clause (ref) and says plainly why, in one or two sentences. These notes are for review by counsel, not legal advice. Return an empty list when nothing stands out.

summary: two or three sentences on what the code covers and how its penalties rise.

readable: false when the document is not a code of discipline or company rules, or cannot be read; then return no rules and no notes.`;

/** A Message Batch request (no time limit on reading a long PDF, at half the price). */
export function codeReadingRequest(pdfBase64: string, title: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: MODEL,
    max_tokens: 48000,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: CODE_SCHEMA } },
    system: CODE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }, title: title.slice(0, 200) },
          { type: 'text', text: 'This is the agency\'s Code of Discipline. List its offenses as described.' },
        ],
      },
    ],
  };
}

/** Matching rules, missing facts, a draft notice and cautions, for HR to check and edit. */
export const SUGGESTION_SCHEMA = obj({
  matches: {
    type: 'array',
    items: obj({ rule_id: str, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, why: str }),
  },
  missing_facts: { type: 'array', items: str },
  nte_draft: str,
  cautions: { type: 'array', items: str },
});

export const PLACEHOLDERS = ['{{employee_name}}', '{{case_no}}', '{{explain_by}}', '{{post}}', '{{rule}}'] as const;

export const SUGGESTION_SYSTEM = `You help the HR team of a Philippine security agency prepare a discipline case. You suggest; HR decides, and the employee must be heard before any decision is made.

You receive the facts recorded for the case, the incident report it came from (if any), the offense rules HR approved from the agency's Code of Discipline (each with an id), and the employee's earlier findings by rule. Return:

1. matches: up to three rules from the list that the facts most plainly fall under, best first. Give each rule's exact id from the list, a confidence (high, medium or low), and one or two sentences tying the facts to the rule's own words. Use only ids from the list. If no rule fits, return no matches.
2. missing_facts: what HR should establish before issuing a notice, such as exact times, the place, witnesses, the post logbook or CCTV. Short items.
3. nte_draft: a notice to explain in plain English that follows DOLE Department Order 147-15. State the specific acts with when and where they happened, the rule they may violate (its number and title), that the employee may explain in writing within at least five calendar days of receiving the notice, that they may ask for a conference or hearing and bring a representative, and that the notice is not a finding of guilt. Use these placeholders exactly where they belong: {{employee_name}}, {{case_no}}, {{explain_by}}, {{post}}, {{rule}}. Use only the facts given; write [to fill in] for anything unknown.
4. cautions: due-process or fairness points HR should keep in mind for this case, for example an unclear identity of the guard, a report resting on a single account, or a penalty heavier than the code gives for this offense count. Short items; an empty list if none.`;

export interface CaseContext {
  case_id: string;
  facts: string;
  report: { title: string; details: string; reported_by: string; occurred_at: string } | null;
  rules: { id: string; ref: string; title: string; description: string; gravity: string; penalties: unknown; source_text: string }[];
  earlier_findings: { rule: string; decision: string; decided: string }[];
}

/**
 * One request, answered while HR waits. Server-side fallbacks (beta) re-run the request on Anthropic's
 * recommended model if Claude Opus 5.5 declines it, instead of returning nothing.
 */
export function suggestionRequest(ctx: CaseContext): Anthropic.Beta.Messages.MessageCreateParamsNonStreaming {
  const { case_id: _omit, ...context } = ctx;
  return {
    model: MODEL,
    max_tokens: 12000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
    system: SUGGESTION_SYSTEM,
    messages: [{ role: 'user', content: `The case, as JSON:\n${JSON.stringify(context, null, 1)}` }],
  };
}
