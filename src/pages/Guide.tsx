import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router';
import { PageHead, Search, Tabs } from '../ui/kit';
import { WEBSITE_URL } from '../lib/supabase';
import { FAQ, PARTS, ROLES, SECTIONS, VIDEO_URL, type Section, type TabId } from '../guide/content';
import { FaqList, Hits, PlayIcon, Rich, TopicCard, VideoDialog, VideoTour, searchGuide, type Hit } from '../guide/parts';

/**
 * The Guide: how to use Bannuar's system, for everyone in the office. The tour video, the four parts,
 * step-by-step guides with marked screenshots, and questions. No technical detail on purpose; the
 * words are in guide/content.ts and the pictures in public/guide (showcase/guide/images.py).
 */
const TABS: { id: TabId; label: string }[] = [...SECTIONS.map((s) => ({ id: s.id, label: s.label })), { id: 'faq', label: 'Questions' }];
const LABELS: Record<string, string> = Object.fromEntries(TABS.map((t) => [t.id, t.label]));
const STAFF_FAQ = FAQ.filter((f) => !f.clientOnly);

export default function Guide() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'start') as TabId;
  const [query, setQuery] = useState('');
  const [watch, setWatch] = useState<number | null>(null);
  // a topic or question to bring into view once its tab has drawn (from a search hit, a link, or #id)
  const [focus, setFocus] = useState<string | null>(() => decodeURIComponent(window.location.hash.slice(1)) || null);
  const searching = query.trim().length > 1;
  const hits = useMemo(() => (searching ? searchGuide(query, SECTIONS, STAFF_FAQ) : []), [query, searching]);

  useEffect(() => {
    if (!focus || searching) return;
    const el = document.getElementById(focus);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    setFocus(null);
  }, [focus, tab, searching]);

  const openHit = (h: Hit) => {
    setQuery('');
    setParams({ tab: h.tab });
    setFocus(h.id);
  };
  const section = SECTIONS.find((s) => s.id === tab);

  return (
    <div className="guide">
      <PageHead
        title="Guide"
        intro="How to use Bannuar's system: the HR portal, the client portal, the employee app and the website. Watch the tour, follow the steps on real screens, or look up a question."
        actions={<a className="btn btn-line" href={VIDEO_URL} target="_blank" rel="noreferrer"><PlayIcon /> The video on YouTube</a>}
      />
      <div className="guide-find">
        <Search value={query} onChange={setQuery} label="Search the guide" placeholder="Search the guide: leave, payslip, night differential" />
      </div>
      {searching ? (
        <section aria-label="Search results" className="stack">
          <p className="muted small" role="status">{hits.length === 1 ? '1 match' : `${hits.length} matches`} for "{query.trim()}"</p>
          <Hits hits={hits} labels={LABELS} onOpen={openHit} empty="Try another word, or look through the tabs." />
        </section>
      ) : (
        <>
          <Tabs tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} label="Parts of the guide" />
          {tab === 'start' && section && <StartHere s={section} onWatch={setWatch} onGo={(t, id) => { setParams({ tab: t }); setFocus(id ?? null); }} />}
          {tab !== 'start' && section && <SectionView s={section} onWatch={setWatch} onJump={setFocus} />}
          {tab === 'faq' && (
            <div className="stack">
              <p className="guide-lead">Short answers to what people ask most. Open a question to read the answer.</p>
              <FaqList items={STAFF_FAQ} />
            </div>
          )}
        </>
      )}
      <VideoDialog at={watch} onClose={() => setWatch(null)} />
    </div>
  );
}

function StartHere({ s, onWatch, onGo }: { s: Section; onWatch: (at: number) => void; onGo: (tab: TabId, id?: string) => void }) {
  return (
    <div className="stack guide-section">
      <div className="guide-tour">
        <VideoTour />
        <aside className="panel panel-pad guide-aside" aria-labelledby="parts-title">
          <h2 id="parts-title">The four parts</h2>
          <p className="muted small"><Rich text={s.intro} /></p>
          <ul className="guide-parts" role="list">
            {PARTS.map((p) => {
              const tab = ({ Website: 'website', 'HR portal': 'hr', 'Client portal': 'client', 'Employee app': 'app' } as Record<string, TabId>)[p.name];
              return (
                <li key={p.name}>
                  <button type="button" className="link-btn" onClick={() => onGo(tab)}>{p.name}</button>
                  <span className="label">{p.who}</span>
                  <span className="small">{p.what}</span>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
      <div className="topics">
        {s.topics.map((t) => <TopicCard key={t.id} t={t} onWatch={onWatch} />)}
      </div>
      <section className="panel" aria-labelledby="roles-title" id="roles">
        <div className="panel-head">
          <h2 id="roles-title">Who can do what</h2>
          <span className="muted small">An admin sets each person's roles in <b>Users and roles</b>.</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Role</th><th scope="col">What they use</th></tr></thead>
            <tbody>
              {ROLES.map((r) => <tr key={r.role}><td><b>{r.role}</b></td><td>{r.can}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SectionView({ s, onWatch, onJump }: { s: Section; onWatch: (at: number) => void; onJump: (id: string) => void }) {
  const jump = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    window.history.replaceState(window.history.state, '', `#${id}`);
    onJump(id);
  };
  return (
    <div className="stack guide-section">
      <p className="guide-lead">
        <Rich text={s.intro} />
        {s.id === 'website' && <> <a href={WEBSITE_URL} target="_blank" rel="noreferrer">Open the website</a>.</>}
      </p>
      <nav className="toc" aria-label="On this tab">
        {s.topics.map((t) => <a key={t.id} href={`#${t.id}`} onClick={(e) => jump(e, t.id)}>{t.title}</a>)}
      </nav>
      <div className="topics">
        {s.topics.map((t) => <TopicCard key={t.id} t={t} onWatch={onWatch} />)}
      </div>
    </div>
  );
}
