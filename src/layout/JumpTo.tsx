import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { fullName } from '../lib/format';
import { safeSearch } from '../lib/refs';
import { useDebounced } from '../ui/kit';

export interface JumpPage { to: string; label: string }
type Item = { key: string; to: string; title: string; note?: string; group: 'Pages' | 'Employees' | 'Posts' };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Jump to a page, an employee or a post from anywhere: the button in the top bar, or Ctrl K
 * (Cmd K on a Mac). Employees are found by name or number, posts by name or code, both through
 * the same row level security as every other list.
 */
export function JumpTo({ pages }: { pages: JumpPage[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button className="jump" type="button" onClick={() => setOpen(true)} aria-label="Jump to a page, an employee or a post" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <span>Jump to an employee, a post or a page</span>
        <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      {open && <Palette pages={pages} onClose={() => setOpen(false)} />}
    </>
  );
}

function Palette({ pages, onClose }: { pages: JumpPage[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState('');
  const q = safeSearch(useDebounced(text, 200));
  const [active, setActive] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const people = useQuery({
    queryKey: ['jump-employees', q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from('employees')
        .select('id,employee_no,first_name,middle_name,last_name,suffix,status,site:sites!employees_site_id_fkey(name)')
        .or(`employee_no.ilike.%${q}%,last_name.ilike.%${q}%,first_name.ilike.%${q}%`)
        .order('last_name').limit(6);
      if (error) throw error;
      return data;
    },
  });
  const posts = useQuery({
    queryKey: ['jump-posts', q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.from('sites').select('id,name,code,city').or(`name.ilike.%${q}%,code.ilike.%${q}%`).order('name').limit(4);
      if (error) throw error;
      return data;
    },
  });

  const items = useMemo<Item[]>(() => {
    const t = text.trim().toLowerCase();
    const pageItems = pages.filter((p) => !t || p.label.toLowerCase().includes(t)).map((p) => ({ key: `p${p.to}`, to: p.to, title: p.label, group: 'Pages' as const }));
    const empItems = (q.length >= 2 ? people.data ?? [] : []).map((e) => ({
      key: `e${e.id}`, to: `/employees/${e.id}`, title: fullName(e), note: [e.employee_no, (e.site as unknown as { name: string } | null)?.name].filter(Boolean).join(' · '), group: 'Employees' as const,
    }));
    const postItems = (q.length >= 2 ? posts.data ?? [] : []).map((s) => ({ key: `s${s.id}`, to: `/posts/${s.id}`, title: s.name, note: [s.code, s.city].filter(Boolean).join(' · '), group: 'Posts' as const }));
    return [...empItems, ...postItems, ...pageItems];
  }, [text, q, pages, people.data, posts.data]);

  useEffect(() => setActive(0), [text]);
  const go = (item?: Item) => {
    if (!item) return;
    ref.current?.close();
    navigate(item.to, { viewTransition: true });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]); }
  };
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  const searching = q.length >= 2 && (people.isFetching || posts.isFetching);
  let lastGroup = '';
  return (
    <dialog ref={ref} className="dialog palette" aria-label="Jump to" onClose={onClose} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="palette-input">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Name, employee number, post or page"
          placeholder="Name, employee number, post or page"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <div className="dialog-body">
        {items.length ? (
          <ul className="palette-list" id={listId} role="listbox" aria-label="Results">
            {items.map((item, i) => {
              const head = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <li key={item.key} role="presentation">
                  {head && <p className="label group" aria-hidden="true">{item.group}</p>}
                  <a
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="palette-item"
                    href={item.to}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => { e.preventDefault(); go(item); }}
                  >
                    <b>{item.title}</b>{item.note && <small>{item.note}</small>}
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="state">{searching ? 'Searching…' : q.length >= 2 ? `Nothing matches "${text.trim()}". Try the employee number.` : 'Type two letters of a name, an employee number or a post.'}</p>
        )}
      </div>
      <div className="palette-foot" aria-hidden="true"><span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
    </dialog>
  );
}
