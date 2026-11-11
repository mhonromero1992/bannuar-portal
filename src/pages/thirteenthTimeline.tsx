import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { fmtDate, fmtMoney, todayManila } from '../lib/format';
import { roundTo, type ThirteenthPiece, type ThirteenthRow } from '../lib/pay';

/**
 * The 13th month as a timeline: one row per employee, one bar for each stretch at a post and rate,
 * placed on the year by its dates. The list view is this chart's table twin: every figure here is
 * also there, so nothing hides behind a hover.
 *
 * Colour follows the post (the chart method's validated categorical slots 1 to 6; slot 1 is the
 * documented blue one step darker so its white label reads at 5.4:1). Posts are given colours in
 * name order over the whole year, so searching never repaints a post. Past six posts the bars share
 * one blue and the legend picks a post out instead. A stretch that cannot be worked out yet wears
 * the status red with a mark and says why.
 */
type Slot = { fill: string; ink: string };
const SLOTS: Slot[] = [
  { fill: '#256abf', ink: '#ffffff' },
  { fill: '#eb6834', ink: '#0b0b0b' },
  { fill: '#1baf7a', ink: '#0b0b0b' },
  { fill: '#eda100', ink: '#0b0b0b' },
  { fill: '#e87ba4', ink: '#0b0b0b' },
  { fill: '#008300', ink: '#ffffff' },
];
const PROBLEM: Slot = { fill: '#d03b3b', ink: '#ffffff' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;
const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

/** Each post of the year with its colour, or one shared colour past six posts. */
export function postColours(rows: ThirteenthRow[]): { posts: { id: string; name: string; slot: Slot }[]; shared: boolean } {
  const names = new Map<string, string>();
  for (const r of rows) for (const p of r.pieces) if (!names.has(p.site_id)) names.set(p.site_id, p.post);
  const sorted = [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shared = sorted.length > SLOTS.length;
  return { shared, posts: sorted.map(([id, name], i) => ({ id, name, slot: shared ? SLOTS[0] : SLOTS[i] })) };
}

/** "Demo Post · Main Gate" → "Main Gate", for a bar too short for the whole name. */
const shortName = (post: string) => post.split(' · ').pop() ?? post;

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = `620 12px ${getComputedStyle(document.body).fontFamily || 'system-ui'}`;
  }
  return measureCtx ? measureCtx.measureText(text).width : text.length * 7;
}

/** The longest label that fits inside the bar with 8px either side, or none (the tooltip and the list carry it). */
function labelFor(post: string, px: number): string {
  for (const t of [post, shortName(post)]) if (textWidth(t) + 16 <= px) return t;
  return '';
}

function describe(r: ThirteenthRow, p: ThirteenthPiece): string {
  const when = `${fmtDate(p.from)} to ${fmtDate(p.to)}`;
  if (p.problem) return `${r.person.name}, ${p.post}, ${when}: not worked out yet. ${p.problem}.`;
  return `${r.person.name}, ${p.post}, ${when}, ${p.rate === null ? '' : `${fmtMoney(p.rate)} an hour, `}13th month ${fmtMoney(p.share)}`;
}

interface Tip { row: ThirteenthRow; piece: ThirteenthPiece; slot: Slot; x: number; y: number }

export function ThirteenthTimeline({ year, rows, allRows, open, onToggle, renderBreakdown, stale }: {
  year: number;
  /** the rows shown (after the search) */
  rows: ThirteenthRow[];
  /** every row of the year, so a post keeps its colour whatever the search */
  allRows: ThirteenthRow[];
  open: string | null;
  onToggle: (personId: string) => void;
  renderBreakdown: (r: ThirteenthRow) => ReactNode;
  stale?: boolean;
}) {
  const { posts, shared } = useMemo(() => postColours(allRows), [allRows]);
  const slotOf = useMemo(() => new Map(posts.map((p) => [p.id, p.slot])), [posts]);
  const [focusPost, setFocusPost] = useState<string | null>(null);
  const [hoverPost, setHoverPost] = useState<string | null>(null);
  const picked = hoverPost ?? focusPost;
  const [tip, setTip] = useState<Tip | null>(null);
  const figRef = useRef<HTMLElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(0);
  const hasProblems = rows.some((r) => r.problems.length);

  useLayoutEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const measure = () => setTrackPx(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setFocusPost((p) => (p && slotOf.has(p) ? p : null)), [slotOf]);
  // a tooltip never floats away from its bar: any scroll (the page or the chart) puts it away
  useEffect(() => {
    if (!tip) return;
    const away = () => setTip(null);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [tip]);

  const start = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - start) / DAY;
  const pct = (d: string) => ((utc(d) - start) / DAY / days) * 100;
  const monthStart = MONTHS.map((_, m) => ((Date.UTC(year, m, 1) - start) / DAY / days) * 100);
  const today = todayManila();
  const todayPct = today.startsWith(String(year)) ? ((utc(today) - start + DAY / 2) / DAY / days) * 100 : null;

  // month hairlines (and today) drawn once as the tracks' background: no extra elements per row
  const grid = useMemo(() => {
    const stops = ['transparent 0'];
    const line = (p: number, colour: string, half: number) => stops.push(
      `transparent calc(${p}% - ${half}px)`, `${colour} calc(${p}% - ${half}px)`, `${colour} calc(${p}% + ${half}px)`, `transparent calc(${p}% + ${half}px)`,
    );
    for (const p of monthStart.slice(1)) {
      if (todayPct !== null && Math.abs(p - todayPct) < 0.4) continue;
      line(p, 'var(--tl-grid)', 0.5);
    }
    if (todayPct !== null) line(todayPct, 'var(--tl-today)', 0.75);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }, [monthStart.join(), todayPct]); // eslint-disable-line react-hooks/exhaustive-deps

  const show = (el: HTMLElement, row: ThirteenthRow, piece: ThirteenthPiece, slot: Slot) => {
    const fig = figRef.current?.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (!fig) return;
    const x = Math.min(Math.max(b.left + b.width / 2 - fig.left, 130), fig.width - 130);
    setTip({ row, piece, slot, x, y: b.top - fig.top + 6 });
  };

  return (
    <figure ref={figRef} className={`tl${stale ? ' is-stale' : ''}`} aria-labelledby="tl-title" aria-busy={stale || undefined}>
      <figcaption className="tl-head">
        <div>
          <h2 id="tl-title">Where each employee worked in {year}</h2>
          <p className="muted small">Each bar is a stretch at one post and one hourly rate. Point at a bar for its 13th month share; open "How" for the working. The list view has every figure.</p>
        </div>
        <div className="tl-legend" role="group" aria-label={shared ? 'Pick out a post' : 'Posts'}>
          {posts.map((p) => (
            <button
              key={p.id}
              type="button"
              className="tl-key"
              aria-pressed={focusPost === p.id}
              onClick={() => setFocusPost(focusPost === p.id ? null : p.id)}
              onPointerEnter={() => setHoverPost(p.id)}
              onPointerLeave={() => setHoverPost(null)}
            >
              <span className="tl-swatch" style={{ background: p.slot.fill }} aria-hidden="true" />{p.name}
            </button>
          ))}
          {hasProblems && <span className="tl-key is-static"><span className="tl-swatch tl-swatch--problem" aria-hidden="true">!</span>Needs a rate or rule</span>}
          {todayPct !== null && <span className="tl-key is-static"><span className="tl-swatch tl-swatch--today" aria-hidden="true" />Today</span>}
        </div>
      </figcaption>
      <div className="tl-scroll">
        <div className="tl-inner" style={{ '--tl-grid-bg': grid } as CSSProperties}>
          <div className="tl-axis" aria-hidden="true">
            <span className="tl-who label">Employee</span>
            <div className="tl-track tl-track--axis" ref={axisRef}>
              {MONTHS.map((m, i) => (
                <span key={m} className="tl-month" style={{ left: `${monthStart[i]}%`, width: `${(i < 11 ? monthStart[i + 1] : 100) - monthStart[i]}%` }}>{m}</span>
              ))}
              {todayPct !== null && <span className="tl-today" style={{ left: `${todayPct}%` }} />}
            </div>
            <span className="label tl-amount">13th month</span>
            <span />
          </div>
          <ul className="tl-rows">
            {rows.map((r) => {
              const isOpen = open === r.person.id;
              return (
                <li key={r.person.id} className={`tl-row${isOpen ? ' is-open' : ''}`}>
                  <div className="tl-line">
                    <div className="tl-who">
                      <Link className="cell-main" to={`/employees/${r.person.id}?tab=deployment`}>{r.person.name}</Link>
                      <span className="cell-sub tabular">{r.person.employee_no}</span>
                    </div>
                    <div className="tl-track">
                      {r.pieces.map((p, i) => {
                        const slot = p.problem ? PROBLEM : slotOf.get(p.site_id) ?? SLOTS[0];
                        const left = pct(p.from);
                        const width = Math.max(pct(p.to) + (100 / days) - left, 0);
                        const px = (width / 100) * trackPx - 2;
                        const dim = picked !== null && p.site_id !== picked;
                        const text = dim ? '' : labelFor(p.post, px - (p.problem ? 18 : 0));
                        return (
                          <button
                            key={`${p.from}-${i}`}
                            type="button"
                            className={`tl-bar${dim ? ' is-dim' : ''}${picked === p.site_id ? ' is-picked' : ''}`}
                            style={{ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)`, '--bar': slot.fill, '--bar-ink': slot.ink } as CSSProperties}
                            aria-label={describe(r, p)}
                            aria-expanded={isOpen}
                            onClick={() => onToggle(r.person.id)}
                            onPointerEnter={(e) => show(e.currentTarget, r, p, slot)}
                            onPointerLeave={() => setTip(null)}
                            onFocus={(e) => show(e.currentTarget, r, p, slot)}
                            onBlur={() => setTip(null)}
                          >
                            <span className="tl-mark">
                              {p.problem && <span className="tl-flag" aria-hidden="true">!</span>}
                              {text}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="tl-amount">
                      {r.problems.length ? <span className="badge bad">Not yet</span> : <b className="tabular">{fmtMoney(r.amount)}</b>}
                    </div>
                    <button className="link-btn" type="button" aria-expanded={isOpen} onClick={() => onToggle(r.person.id)}>{isOpen ? 'Hide' : 'How'}</button>
                  </div>
                  {isOpen && <div className="tl-more">{renderBreakdown(r)}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {tip && (
        // the bar's own accessible name says the same, so screen readers skip this copy
        <div className="tl-tip" aria-hidden="true" style={{ left: tip.x, top: tip.y }}>
          <span className="tl-tip-value">{tip.piece.problem ? 'Not worked out yet' : fmtMoney(tip.piece.share)}<small>{tip.piece.problem ? '' : ' 13th month'}</small></span>
          <span className="tl-tip-post"><i style={{ background: tip.slot.fill }} aria-hidden="true" />{tip.piece.post}</span>
          <span>{fmtDate(tip.piece.from)} to {fmtDate(tip.piece.to)} · {roundTo(tip.piece.months, 2)} {tip.piece.months === 1 ? 'month' : 'months'}</span>
          {tip.piece.problem ? <span className="tl-tip-problem">{tip.piece.problem}</span> : (
            <span>{tip.piece.rate === null ? '' : `${fmtMoney(tip.piece.rate)} an hour · `}basic pay {fmtMoney(tip.piece.basic)}</span>
          )}
          <span className="tl-tip-who">{tip.row.person.name}</span>
        </div>
      )}
    </figure>
  );
}
