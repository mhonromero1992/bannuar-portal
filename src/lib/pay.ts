/**
 * The pay engine: client pay rules (formulas), night differential, pay for a cutoff and the 13th
 * month. Plain arithmetic on what the portal reads from the database; it writes nothing. It has no
 * imports so `npm run test:pay` can test it directly in Node.
 *
 * A pay rule belongs to a client and is shared by its posts; each post has its own hourly rate. A
 * guard's assignment history says which post, duty and shift applied on which days.
 */

// ---------------------------------------------------------------------------------- types
export type NightRule = 'last_shift' | 'night_hours' | 'none';
export interface FormulaLine { code: string; label: string; formula: string; kind?: 'earning' | 'deduction'; thirteenth?: boolean }
export interface PayRule {
  id: string; client_id: string | null; name: string; is_default: boolean; is_active?: boolean;
  regular_hours: number; night_diff: NightRule; night_diff_hours: number; days_per_month: number; formulas: FormulaLine[];
  notes?: string | null;
}
export interface PayRate { site_id: string | null; client_id: string | null; effective_from: string; hourly_rate: number }
export interface Post { id: string; name: string; code?: string | null; client_id: string | null; pay_rule_id?: string | null }
export interface Assignment { employee_id: string; site_id: string; start_date: string; end_date: string | null; duty_hours: number; shift_start: string }
export interface Person { id: string; employee_no: string; name: string; date_hired?: string | null; date_separated?: string | null }

// ---------------------------------------------------------------------------------- formulas
export class FormulaError extends Error {
  pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.pos = pos;
  }
}

/** What a formula can use. Each line's code also becomes a name for the lines after it. */
export const VARIABLES: { name: string; meaning: string }[] = [
  { name: 'rate', meaning: 'hourly rate at the post' },
  { name: 'daily_rate', meaning: 'hourly rate × regular hours a day' },
  { name: 'days', meaning: 'duty days' },
  { name: 'duty_length', meaning: 'hours in one duty: 8, 12 or 24' },
  { name: 'duty_hours', meaning: 'all hours on duty' },
  { name: 'regular_hours', meaning: 'regular hours, up to the rule’s regular hours a duty' },
  { name: 'overtime_hours', meaning: 'hours past the regular hours' },
  { name: 'night_hours', meaning: 'night differential hours under the rule' },
];
const FUNCTIONS: Record<string, [number, number]> = { min: [1, 20], max: [1, 20], round: [1, 2], floor: [1, 1], ceil: [1, 1], abs: [1, 1], if: [3, 3] };
const COMPARE = ['<', '<=', '>', '>=', '==', '!='];

type Tok = { k: 'num' | 'id' | 'op' | 'end'; v: string; n: number; pos: number };
export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string; pos: number }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node; pos: number }
  | { t: 'call'; fn: string; args: Node[]; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (/^\s/.test(rest)) { i++; continue; }
    const num = /^(\d+(?:\.\d+)?|\.\d+)(%?)/.exec(rest);
    if (num) {
      out.push({ k: 'num', v: num[0], n: Number(num[1]) / (num[2] ? 100 : 1), pos: i });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (id) { out.push({ k: 'id', v: id[0].toLowerCase(), n: 0, pos: i }); i += id[0].length; continue; }
    const op = /^(<=|>=|==|!=|[-+*/^(),<>])/.exec(rest);
    if (op) { out.push({ k: 'op', v: op[0], n: 0, pos: i }); i += op[0].length; continue; }
    throw new FormulaError(`"${src[i]}" cannot be used in a formula (character ${i + 1})`, i);
  }
  out.push({ k: 'end', v: '', n: 0, pos: src.length });
  return out;
}

/** Read a formula. Only the names given are allowed, so a typo is caught when the rule is saved. */
export function parseFormula(src: string, names: Set<string>): Node {
  if (!src.trim()) throw new FormulaError('Write a formula, for example rate * regular_hours');
  if (src.length > 300) throw new FormulaError('Keep a formula under 300 characters');
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (t: Tok, v: string) => t.k === 'op' && t.v === v;
  const fail = (t: Tok): never => {
    throw new FormulaError(t.k === 'end' ? 'The formula ends too early' : `Unexpected "${t.v}" at character ${t.pos + 1}`, t.pos);
  };
  const expect = (v: string) => {
    const t = toks[i++];
    if (!isOp(t, v)) throw new FormulaError(t.k === 'end' ? `Missing "${v}" at the end` : `Expected "${v}" at character ${t.pos + 1}`, t.pos);
  };
  const cmp = (): Node => {
    const a = add();
    const t = peek();
    if (t.k === 'op' && COMPARE.includes(t.v)) { i++; return { t: 'bin', op: t.v, a, b: add(), pos: t.pos }; }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    for (let t = peek(); isOp(t, '+') || isOp(t, '-'); t = peek()) { i++; a = { t: 'bin', op: t.v, a, b: mul(), pos: t.pos }; }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    for (let t = peek(); isOp(t, '*') || isOp(t, '/'); t = peek()) { i++; a = { t: 'bin', op: t.v, a, b: unary(), pos: t.pos }; }
    return a;
  };
  const unary = (): Node => {
    const t = peek();
    if (isOp(t, '-') || isOp(t, '+')) { i++; const a = unary(); return t.v === '-' ? { t: 'neg', a } : a; }
    return power();
  };
  const power = (): Node => {
    const a = primary();
    const t = peek();
    if (isOp(t, '^')) { i++; return { t: 'bin', op: '^', a, b: unary(), pos: t.pos }; }
    return a;
  };
  const primary = (): Node => {
    const t = toks[i++];
    if (t.k === 'num') return { t: 'num', v: t.n };
    if (t.k === 'id') {
      if (isOp(peek(), '(')) {
        const arity = FUNCTIONS[t.v];
        if (!arity) throw new FormulaError(`There is no function "${t.v}". Use min, max, round, floor, ceil, abs or if.`, t.pos);
        i++;
        const args: Node[] = [];
        if (!isOp(peek(), ')')) {
          args.push(cmp());
          while (isOp(peek(), ',')) { i++; args.push(cmp()); }
        }
        expect(')');
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new FormulaError(`${t.v}() takes ${arity[0] === arity[1] ? arity[0] : `${arity[0]} to ${arity[1]}`} value${arity[1] === 1 ? '' : 's'}`, t.pos);
        }
        return { t: 'call', fn: t.v, args, pos: t.pos };
      }
      if (!names.has(t.v)) throw new FormulaError(`Unknown name "${t.v}" at character ${t.pos + 1}`, t.pos);
      return { t: 'var', name: t.v, pos: t.pos };
    }
    if (isOp(t, '(')) { const e = cmp(); expect(')'); return e; }
    return fail(t);
  };
  const node = cmp();
  if (peek().k !== 'end') fail(peek());
  return node;
}

/** Round half away from zero: money to the centavo, or to any number of digits. */
export function roundTo(x: number, digits = 2): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-7)) / f;
}
export const money = (x: number) => roundTo(x, 2);

export function evaluate(node: Node, vars: Record<string, number>): number {
  switch (node.t) {
    case 'num': return node.v;
    case 'var': {
      const v = vars[node.name];
      if (v === undefined || !Number.isFinite(v)) throw new FormulaError(`"${node.name}" has no value here`, node.pos);
      return v;
    }
    case 'neg': return -evaluate(node.a, vars);
    case 'bin': {
      const a = evaluate(node.a, vars);
      const b = evaluate(node.b, vars);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/':
          if (b === 0) throw new FormulaError('Division by zero', node.pos);
          return a / b;
        case '^': return a ** b;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        default: return Math.abs(a - b) >= 1e-9 ? 1 : 0;
      }
    }
    case 'call': {
      if (node.fn === 'if') return evaluate(node.args[0], vars) !== 0 ? evaluate(node.args[1], vars) : evaluate(node.args[2], vars);
      const xs = node.args.map((a) => evaluate(a, vars));
      switch (node.fn) {
        case 'min': return Math.min(...xs);
        case 'max': return Math.max(...xs);
        case 'round': return roundTo(xs[0], xs[1] ?? 0);
        case 'floor': return Math.floor(xs[0] + 1e-9);
        case 'ceil': return Math.ceil(xs[0] - 1e-9);
        default: return Math.abs(xs[0]);
      }
    }
  }
}

export interface CompiledLine extends FormulaLine { node: Node }
export interface Compiled { lines: CompiledLine[]; errors: Record<number, string> }
const RESERVED = new Set([...VARIABLES.map((v) => v.name), ...Object.keys(FUNCTIONS)]);

/** Check every line of a rule: codes, names and formulas. Lines may use the codes of lines above. */
export function compileLines(lines: FormulaLine[]): Compiled {
  const names = new Set(VARIABLES.map((v) => v.name));
  const out: CompiledLine[] = [];
  const errors: Record<number, string> = {};
  lines.forEach((l, idx) => {
    const code = (l.code ?? '').trim();
    try {
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(code)) throw new FormulaError('Use a code of small letters, digits and _ (for example night_diff)');
      if (RESERVED.has(code)) throw new FormulaError(`"${code}" is already a name formulas use; pick another code`);
      if (out.some((x) => x.code === code)) throw new FormulaError(`Another line already uses the code "${code}"`);
      if (!(l.label ?? '').trim()) throw new FormulaError('Give the line a name');
      out.push({ ...l, code, node: parseFormula(l.formula ?? '', names) });
      names.add(code);
    } catch (e) {
      errors[idx] = e instanceof Error ? e.message : String(e);
    }
  });
  return { lines: out, errors };
}

export interface LineAmount { code: string; label: string; kind: 'earning' | 'deduction'; thirteenth: boolean; amount: number }

/** Work out each line, to the centavo, in order. */
export function runLines(lines: CompiledLine[], vars: Record<string, number>): LineAmount[] {
  const scope = { ...vars };
  return lines.map((l) => {
    const raw = evaluate(l.node, scope);
    if (!Number.isFinite(raw)) throw new FormulaError(`${l.label} does not give a number`);
    const amount = money(raw);
    scope[l.code] = amount;
    return { code: l.code, label: l.label.trim(), kind: l.kind === 'deduction' ? 'deduction' : 'earning', thirteenth: Boolean(l.thirteenth), amount };
  });
}

// ---------------------------------------------------------------------------------- night differential
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Hours of one duty between 10pm and 6am. */
export function nightOverlap(shiftStart: string, dutyHours: number): number {
  const s = toMinutes(shiftStart);
  const e = s + dutyHours * 60;
  let total = 0;
  for (const day of [-1440, 0, 1440]) total += Math.max(0, Math.min(e, day + 30 * 60) - Math.max(s, day + 22 * 60));
  return total / 60;
}

/**
 * Night differential hours one duty earns.
 * - last_shift: the last guard of the day earns the rule's hours (8): every 24-hour duty, and the
 *   shift that covers most of 10pm to 6am, which is the 12-hour shift from 6pm or the 8-hour shift
 *   from 10pm. Day shifts earn none.
 * - night_hours: every hour actually worked between 10pm and 6am, as the Labor Code counts it.
 */
export function nightHoursPerDuty(rule: Pick<PayRule, 'night_diff' | 'night_diff_hours'>, shiftStart: string, dutyHours: number): number {
  if (rule.night_diff === 'none') return 0;
  const overlap = nightOverlap(shiftStart, dutyHours);
  if (rule.night_diff === 'night_hours') return overlap;
  return dutyHours >= 24 || overlap > 4 ? Number(rule.night_diff_hours) : 0;
}

/** "18:00" as "6:00 PM". */
export function timeLabel(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h % 24 < 12 ? 'AM' : 'PM'}`;
}
const addHours = (t: string, n: number) => {
  const mins = (((toMinutes(t) + n * 60) % 1440) + 1440) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
};

/** The shifts of a duty pattern: one 24-hour duty, two 12-hour shifts or three 8-hour shifts. */
export function shiftSlots(dutyHours: number, firstStart: string): { start: string; label: string; night: boolean }[] {
  const count = Math.max(1, Math.round(24 / dutyHours));
  return Array.from({ length: count }, (_, i) => {
    const start = addHours(firstStart.slice(0, 5), i * dutyHours);
    const night = nightHoursPerDuty({ night_diff: 'last_shift', night_diff_hours: 8 }, start, dutyHours) > 0;
    return { start, night, label: dutyHours >= 24 ? `24 hours from ${timeLabel(start)}` : `${timeLabel(start)} to ${timeLabel(addHours(start, dutyHours))}` };
  });
}

/** The figures a formula sees for a stretch of duty at one post and one rate. */
export function dutyVariables(rule: PayRule, rate: number, days: number, dutyLength: number, shiftStart: string): Record<string, number> {
  const regular = Number(rule.regular_hours);
  return {
    rate,
    daily_rate: rate * regular,
    days,
    duty_length: dutyLength,
    duty_hours: days * dutyLength,
    regular_hours: days * Math.min(dutyLength, regular),
    overtime_hours: days * Math.max(dutyLength - regular, 0),
    night_hours: days * nightHoursPerDuty(rule, shiftStart, dutyLength),
  };
}

// ---------------------------------------------------------------------------------- dates (YYYY-MM-DD, calendar days)
const toTime = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, dd);
};
const fromTime = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromTime(toTime(d) + n * 86400000);
/** Days from a to b, counting both. */
export const dayCount = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / 86400000) + 1;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const maxDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort().at(-1) as string;
const minDate = (...ds: (string | null | undefined)[]) => ds.filter(Boolean).sort()[0] as string;

/** Each calendar month in a range, with the days of it the range covers. */
function monthParts(from: string, to: string): { covered: number; inMonth: number }[] {
  const out: { covered: number; inMonth: number }[] = [];
  let [y, m] = from.split('-').map(Number);
  for (;;) {
    const dim = daysInMonth(y, m);
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = `${y}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
    const a = maxDate(from, first);
    const b = minDate(to, last);
    if (a <= b) out.push({ covered: dayCount(a, b), inMonth: dim });
    if (last >= to) return out;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
}

/** Months a range covers: a whole month counts 1, part of a month its share of that month's days. */
export const monthsCovered = (from: string, to: string) => monthParts(from, to).reduce((t, p) => t + p.covered / p.inMonth, 0);

/** Duty days a rule expects in a range: days_per_month for each month, shared by its days. */
export const scheduledDays = (from: string, to: string, perMonth: number) => monthParts(from, to).reduce((t, p) => t + (p.covered * perMonth) / p.inMonth, 0);

// ---------------------------------------------------------------------------------- rules and rates
/** A post's rule: its own, else its client's default, else the agency default. */
export function ruleFor(post: Post | undefined, rules: PayRule[]): PayRule | null {
  if (!post) return null;
  return (
    (post.pay_rule_id ? rules.find((r) => r.id === post.pay_rule_id) : undefined) ??
    rules.find((r) => r.is_default && r.client_id !== null && r.client_id === post.client_id) ??
    rules.find((r) => r.is_default && r.client_id === null) ??
    null
  );
}

export interface RatePiece { from: string; to: string; rate: number | null }

/** Rates by post and client: the rate in force on a day, and a range cut where the rate changes. */
export function rateBook(rates: PayRate[]) {
  const bySite = new Map<string, PayRate[]>();
  const byClient = new Map<string, PayRate[]>();
  for (const r of rates) {
    const key = r.site_id ?? r.client_id;
    if (!key) continue;
    const map = r.site_id ? bySite : byClient;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const latest = (list: PayRate[] | undefined, day: string) => {
    let best: PayRate | undefined;
    for (const r of list ?? []) if (r.effective_from <= day && (!best || r.effective_from > best.effective_from)) best = r;
    return best;
  };
  const on = (post: Post, day: string): number | null => {
    const r = latest(bySite.get(post.id), day) ?? (post.client_id ? latest(byClient.get(post.client_id), day) : undefined);
    return r ? Number(r.hourly_rate) : null;
  };
  const split = (post: Post, from: string, to: string): RatePiece[] => {
    const cuts = new Set([from]);
    for (const r of [...(bySite.get(post.id) ?? []), ...(post.client_id ? byClient.get(post.client_id) ?? [] : [])]) {
      if (r.effective_from > from && r.effective_from <= to) cuts.add(r.effective_from);
    }
    const starts = [...cuts].sort();
    const out: RatePiece[] = [];
    starts.forEach((s, i) => {
      const piece = { from: s, to: i + 1 < starts.length ? addDays(starts[i + 1], -1) : to, rate: on(post, s) };
      const last = out.at(-1);
      if (last && last.rate === piece.rate) last.to = piece.to;
      else out.push(piece);
    });
    return out;
  };
  return { on, split };
}

function compiledFor(cache: Map<string, Compiled>, rule: PayRule): Compiled {
  let c = cache.get(rule.id);
  if (!c) {
    c = compileLines(Array.isArray(rule.formulas) ? rule.formulas : []);
    cache.set(rule.id, c);
  }
  return c;
}
const firstError = (c: Compiled) => Object.values(c.errors)[0];

// ---------------------------------------------------------------------------------- 13th month
export interface ThirteenthPiece {
  site_id: string; post: string; from: string; to: string; rate: number | null; duty_hours: number;
  months: number; days: number; basic: number; share: number; problem?: string;
}
export interface ThirteenthRow { person: Person; pieces: ThirteenthPiece[]; basic: number; amount: number; problems: string[] }

/**
 * 13th month pay (PD 851: a twelfth of the basic pay earned in the year), worked out for each stretch
 * of a guard's year at one post and one rate, then added up. Basic pay for a stretch is what the
 * post's rule calls basic (lines marked "13th month"), for the rule's duty days a month.
 * Example: ₱100 an hour for January to March at 8 regular hours and 26 days a month is
 * 100 × 8 × 26 × 3 = ₱62,400 basic, so ₱5,200 of 13th month.
 */
export function thirteenthMonth(year: number, people: Person[], assignments: Assignment[], posts: Post[], rules: PayRule[], rates: PayRate[]): ThirteenthRow[] {
  const yFrom = `${year}-01-01`;
  const yTo = `${year}-12-31`;
  const postById = new Map(posts.map((p) => [p.id, p]));
  const book = rateBook(rates);
  const cache = new Map<string, Compiled>();
  const byPerson = new Map<string, Assignment[]>();
  for (const a of assignments) byPerson.set(a.employee_id, [...(byPerson.get(a.employee_id) ?? []), a]);
  const out: ThirteenthRow[] = [];
  for (const person of people) {
    const pieces: ThirteenthPiece[] = [];
    for (const a of (byPerson.get(person.id) ?? []).sort((x, y) => x.start_date.localeCompare(y.start_date))) {
      const from = maxDate(a.start_date, yFrom, person.date_hired);
      const to = minDate(a.end_date ?? yTo, yTo, person.date_separated);
      if (!from || !to || to < from) continue;
      const post = postById.get(a.site_id);
      const rule = ruleFor(post, rules);
      const parts: RatePiece[] = post ? book.split(post, from, to) : [{ from, to, rate: null }];
      for (const part of parts) {
        const months = monthsCovered(part.from, part.to);
        const days = rule ? Number(rule.days_per_month) * months : 0;
        const piece: ThirteenthPiece = {
          site_id: a.site_id, post: post?.name ?? 'A post that no longer exists', from: part.from, to: part.to, rate: part.rate,
          duty_hours: a.duty_hours, months, days, basic: 0, share: 0,
        };
        const compiled = rule ? compiledFor(cache, rule) : null;
        if (!post) piece.problem = 'The post was not found';
        else if (!rule) piece.problem = `${post.name} has no pay rule`;
        else if (part.rate === null) piece.problem = `${post.name} has no hourly rate on ${part.from}`;
        else if (compiled && firstError(compiled)) piece.problem = `The rule ${rule.name} has a formula to fix: ${firstError(compiled)}`;
        else {
          try {
            const lines = runLines(compiled!.lines, dutyVariables(rule, part.rate, days, a.duty_hours, a.shift_start));
            piece.basic = money(lines.filter((l) => l.thirteenth && l.kind === 'earning').reduce((t, l) => t + l.amount, 0));
            piece.share = money(piece.basic / 12);
          } catch (e) {
            piece.problem = `${rule.name}: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
        pieces.push(piece);
      }
    }
    if (!pieces.length) continue;
    out.push({
      person,
      pieces,
      basic: money(pieces.reduce((t, p) => t + p.basic, 0)),
      amount: money(pieces.reduce((t, p) => t + p.share, 0)),
      problems: pieces.flatMap((p) => (p.problem ? [p.problem] : [])),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------- pay for a cutoff
/** One row of the attendance sheet: a guard's duty at one post during the cutoff. */
export interface AttendanceRow { employee_no: string; name?: string; post_code?: string; post: string; site_id?: string; from: string; to: string; days: number; duty_hours: number; shift_start: string }

/** The attendance sheet as scheduled: each assignment in the cutoff, with the rule's duty days for it. */
export function scheduleSheet(period: { start: string; end: string }, people: Person[], assignments: Assignment[], posts: Post[], rules: PayRule[]): AttendanceRow[] {
  const postById = new Map(posts.map((p) => [p.id, p]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const rows: AttendanceRow[] = [];
  for (const a of assignments) {
    const person = personById.get(a.employee_id);
    const post = postById.get(a.site_id);
    if (!person || !post) continue;
    const from = maxDate(a.start_date, period.start, person.date_hired);
    const to = minDate(a.end_date ?? period.end, period.end, person.date_separated);
    if (!from || !to || to < from) continue;
    const rule = ruleFor(post, rules);
    rows.push({
      employee_no: person.employee_no, name: person.name, post_code: post.code ?? '', post: post.name, site_id: post.id, from, to,
      days: Math.round(scheduledDays(from, to, Number(rule?.days_per_month ?? 26))), duty_hours: a.duty_hours, shift_start: a.shift_start.slice(0, 5),
    });
  }
  return rows.sort((x, y) => x.post.localeCompare(y.post) || (x.name ?? '').localeCompare(y.name ?? '') || x.from.localeCompare(y.from));
}

export const SHEET_COLUMNS = ['employee_no', 'name', 'post_code', 'post', 'from', 'to', 'days', 'duty_hours', 'shift_start'];

/** Read an attendance sheet back (rows of text keyed by header), checking each value. */
export function readSheet(rows: Record<string, string>[], period: { start: string; end: string }): { rows: AttendanceRow[]; errors: { row: number; message: string }[] } {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const ALIASES: Record<string, string> = { employee_number: 'employee_no', emp_no: 'employee_no', site: 'post', post_name: 'post', code: 'post_code', duty: 'duty_hours', shift: 'shift_start', start: 'shift_start', days_worked: 'days', duties: 'days' };
  const out: AttendanceRow[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = norm(k);
      r[ALIASES[n] ?? n] = String(v ?? '').trim();
    }
    const row = i + 2; // the header is line 1
    if (!r.employee_no) return;
    const days = Number(r.days);
    const duty = Number(r.duty_hours || 12);
    const from = r.from || period.start;
    const to = r.to || period.end;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (!r.post && !r.post_code) errors.push({ row, message: `${r.employee_no}: the post is missing` });
    else if (r.days === '' || !Number.isFinite(days) || days < 0) errors.push({ row, message: `${r.employee_no}: days must be a number of 0 or more` });
    else if (![8, 12, 24].includes(duty)) errors.push({ row, message: `${r.employee_no}: a duty is 8, 12 or 24 hours` });
    else if (!iso.test(from) || !iso.test(to) || to < from) errors.push({ row, message: `${r.employee_no}: write the dates as YYYY-MM-DD, the first before the last` });
    else if (days > dayCount(from, to) * (duty === 24 ? 1 : 24 / duty)) errors.push({ row, message: `${r.employee_no}: ${days} duties do not fit between ${from} and ${to}` });
    else if (r.shift_start && !/^\d{1,2}:\d{2}$/.test(r.shift_start)) errors.push({ row, message: `${r.employee_no}: write the shift start as 18:00` });
    else out.push({ employee_no: r.employee_no.toUpperCase(), name: r.name, post_code: r.post_code, post: r.post, from, to, days, duty_hours: duty, shift_start: r.shift_start || '06:00' });
  });
  return { rows: out, errors };
}

export interface PayPiece { post: string; from: string; to: string; rate: number; days: number; duty_hours: number; shift_start: string; lines: LineAmount[]; vars: Record<string, number> }
export interface PayResult {
  employee_no: string; name: string; posts: string[]; days: number; regular_hours: number; overtime_hours: number; night_hours: number;
  lines: LineAmount[]; pieces: PayPiece[]; problems: string[];
}

/** Pay for a cutoff from its attendance: each row at its post's rule and rate, added up per guard. */
export function computePay(rows: AttendanceRow[], people: Person[], posts: Post[], rules: PayRule[], rates: PayRate[]): PayResult[] {
  const personByNo = new Map(people.map((p) => [p.employee_no.toUpperCase(), p]));
  const lower = (s?: string | null) => (s ?? '').trim().toLowerCase();
  const findPost = (r: AttendanceRow) =>
    (r.site_id && posts.find((p) => p.id === r.site_id)) ||
    (r.post_code && posts.find((p) => lower(p.code) === lower(r.post_code))) ||
    posts.find((p) => lower(p.name) === lower(r.post));
  const book = rateBook(rates);
  const cache = new Map<string, Compiled>();
  const results = new Map<string, PayResult>();
  for (const r of rows) {
    const person = personByNo.get(r.employee_no.toUpperCase());
    const key = r.employee_no.toUpperCase();
    const res = results.get(key) ?? {
      employee_no: key, name: person?.name ?? r.name ?? '', posts: [], days: 0, regular_hours: 0, overtime_hours: 0, night_hours: 0, lines: [], pieces: [], problems: [],
    };
    results.set(key, res);
    const post = findPost(r);
    if (!person) { res.problems.push(`No employee has the number ${key}`); continue; }
    if (!post) { res.problems.push(`No post called ${r.post || r.post_code}`); continue; }
    if (!res.posts.includes(post.name)) res.posts.push(post.name);
    const rule = ruleFor(post, rules);
    if (!rule) { res.problems.push(`${post.name} has no pay rule`); continue; }
    const compiled = compiledFor(cache, rule);
    if (firstError(compiled)) { res.problems.push(`The rule ${rule.name} has a formula to fix: ${firstError(compiled)}`); continue; }
    const total = dayCount(r.from, r.to);
    for (const part of book.split(post, r.from, r.to)) {
      if (part.rate === null) { res.problems.push(`${post.name} has no hourly rate on ${part.from}`); continue; }
      const days = (r.days * dayCount(part.from, part.to)) / total;
      const vars = dutyVariables(rule, part.rate, days, r.duty_hours, r.shift_start);
      let lines: LineAmount[];
      try {
        lines = runLines(compiled.lines, vars);
      } catch (e) {
        res.problems.push(`${rule.name}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      res.pieces.push({ post: post.name, from: part.from, to: part.to, rate: part.rate, days, duty_hours: r.duty_hours, shift_start: r.shift_start, lines, vars });
      res.days += days;
      res.regular_hours += vars.regular_hours;
      res.overtime_hours += vars.overtime_hours;
      res.night_hours += vars.night_hours;
      for (const l of lines) {
        const same = res.lines.find((x) => x.code === l.code && x.label === l.label && x.kind === l.kind);
        if (same) same.amount = money(same.amount + l.amount);
        else res.lines.push({ ...l });
      }
    }
  }
  return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Lines with these codes fill the payslip's own columns; any other line is shown under its name. */
const PAYSLIP_COLUMN: Record<string, string> = { basic: 'basic_pay', overtime: 'overtime_pay', night_diff: 'night_diff_pay', holiday: 'holiday_pay', allowances: 'allowances', allowance: 'allowances' };

/** A computed result as a row of the payroll file, which import_payslips() reads. */
export function toPayrollRow(r: PayResult): Record<string, string | number> {
  const out: Record<string, string | number> = {
    employee_no: r.employee_no, site_name: r.posts.join(', '), days_worked: roundTo(r.days, 2), hours_worked: roundTo(r.regular_hours, 2),
    overtime_hours: roundTo(r.overtime_hours, 2), night_diff_hours: roundTo(r.night_hours, 2),
  };
  for (const l of r.lines) {
    const key = l.kind === 'deduction' ? `deduction: ${l.label}` : PAYSLIP_COLUMN[l.code] ?? `earning: ${l.label}`;
    out[key] = money(Number(out[key] ?? 0) + l.amount);
  }
  out.remarks = r.pieces.map((p) => `${p.post}: ${roundTo(p.days, 2)} duties of ${p.duty_hours} hours at ₱${p.rate.toFixed(2)} an hour`).join('; ');
  return out;
}

/** CSV for a spreadsheet. A text cell that starts like a formula gets a ' so the sheet shows it as text. */
export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const head = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[head.map(cell).join(','), ...rows.map((r) => head.map((h) => cell(r[h])).join(','))].join('\n')}\n`;
}

/** A sample run for the rule editor: ₱100 an hour, 13 duties of 12 hours from 6pm. */
export function sampleRun(rule: PayRule, rate = 100, days = 13, dutyLength = 12, shiftStart = '18:00') {
  const compiled = compileLines(rule.formulas);
  const vars = dutyVariables(rule, rate, days, dutyLength, shiftStart);
  if (Object.keys(compiled.errors).length) return { vars, lines: [] as LineAmount[], errors: compiled.errors };
  try {
    return { vars, lines: runLines(compiled.lines, vars), errors: compiled.errors };
  } catch (e) {
    return { vars, lines: [] as LineAmount[], errors: { [-1]: e instanceof Error ? e.message : String(e) } as Record<number, string> };
  }
}
