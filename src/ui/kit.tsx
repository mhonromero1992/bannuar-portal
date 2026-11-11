import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { label as labelOf, tone as toneOf, type Tone } from '../lib/labels';

/* ---------------------------------------------------------------- states (R-27: empty, loading, error) */
export function Loading({ what = 'Loading' }: { what?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{what}…</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <span className="beacon" aria-hidden="true" />
      <b>{title}</b>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <b style={{ color: 'inherit' }}>Could not load this</b>
      <span>{error}</span>
      {retry && <button className="btn btn-line btn-sm" type="button" onClick={retry}>Try again</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- badge */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value?: string | null }) {
  if (!value) return null;
  return <Badge tone={toneOf(map, value)}>{labelOf(map, value)}</Badge>;
}

/* ---------------------------------------------------------------- page head */
export function PageHead({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {intro && <p>{intro}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- fields */
interface FieldProps { label: string; error?: string; hint?: ReactNode; optional?: boolean }
function useFieldIds() {
  const id = useId();
  return { id, err: `${id}-err`, hint: `${id}-hint` };
}
function Wrap({ label, error, hint, optional, id, err, hintId, children }: FieldProps & { id: string; err: string; hintId: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional && <span className="muted" style={{ fontWeight: 450 }}> (optional)</span>}</label>
      {children}
      {hint && <span className="field-hint" id={hintId}>{hint}</span>}
      {error && <p className="field-error" id={err}>{error}</p>}
    </div>
  );
}
export function TextField({ label, error, hint, optional, ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds();
  return (
    <Wrap label={label} error={error} hint={hint} optional={optional} id={ids.id} err={ids.err} hintId={ids.hint}>
      <input className="input" id={ids.id} aria-invalid={error ? true : undefined} aria-describedby={[error && ids.err, hint && ids.hint].filter(Boolean).join(' ') || undefined} {...rest} />
    </Wrap>
  );
}
export function SelectField({ label, error, hint, optional, options, placeholder, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const ids = useFieldIds();
  return (
    <Wrap label={label} error={error} hint={hint} optional={optional} id={ids.id} err={ids.err} hintId={ids.hint}>
      <select className="select" id={ids.id} aria-invalid={error ? true : undefined} aria-describedby={error ? ids.err : undefined} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Wrap>
  );
}
export function TextArea({ label, error, hint, optional, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ids = useFieldIds();
  return (
    <Wrap label={label} error={error} hint={hint} optional={optional} id={ids.id} err={ids.err} hintId={ids.hint}>
      <textarea className="textarea" id={ids.id} aria-invalid={error ? true : undefined} aria-describedby={error ? ids.err : undefined} {...rest} />
    </Wrap>
  );
}

/* ---------------------------------------------------------------- dialog (native <dialog>: Escape closes, focus is kept inside) */
export function Dialog({ open, title, onClose, wide, children }: { open: boolean; title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog${wide ? ' wide' : ''}`} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <>
          <div className="dialog-head">
            <h2 id={titleId}>{title}</h2>
            <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Close</button>
          </div>
          <div className="dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/* ---------------------------------------------------------------- tabs (the underline slides to the chosen tab) */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const measure = () => {
      const on = list.querySelector<HTMLElement>('[aria-selected="true"]');
      setInk(on ? { x: on.offsetLeft + 10, w: Math.max(on.offsetWidth - 20, 0) } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value, tabs.length]);
  // arrow keys move between tabs, as people expect of a tab list
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = tabs.findIndex((t) => t.id === value);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    onChange(next.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div ref={ref} className={`tabs${ink ? ' has-ink' : ''}`} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} className="tab" role="tab" type="button" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
      {ink && <span className="tabs-ink" aria-hidden="true" style={{ '--ink-x': `${ink.x}px`, '--ink-w': `${ink.w}px` } as CSSProperties} />}
    </div>
  );
}

/* ---------------------------------------------------------------- pager */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number | null; onPage: (p: number) => void }) {
  const last = total === null ? page : Math.max(0, Math.ceil(total / pageSize) - 1);
  if (!total) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="pager">
      <span className="tabular">{from} to {to} of {total}</span>
      <span className="row">
        <button className="btn btn-line btn-sm" type="button" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn btn-line btn-sm" type="button" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */
type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastContext = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            {t.tone === 'ok' && <span className="beacon" aria-hidden="true" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

/* ---------------------------------------------------------------- search input */
export function Search({ value, onChange, label = 'Search', placeholder }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string }) {
  const id = useId();
  return (
    <div className="search">
      <label htmlFor={id} className="visually-hidden">{label}</label>
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <input id={id} className="input" type="search" value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Debounce a fast-changing value (search boxes). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
