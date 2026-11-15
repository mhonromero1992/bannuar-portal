import { useState, type ReactNode } from 'react';
import { Dialog } from '../ui/kit';
import shots from './shots.json';
import { CHAPTERS, VIDEO_ID, VIDEO_LENGTH, VIDEO_URL, seconds, type Faq, type Pic, type Section, type TabId, type Topic } from './content';

/** The parts of the Guide page and of the client portal's Help. */

type ShotInfo = { src: string; w: number; h: number; device: string; marks: Record<string, number[]> };
const SHOTS = shots as Record<string, ShotInfo>;

/** Text with **bold** for what reads on screen (a button, a tab, a field). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p))}</>;
}
export const plain = (text: string) => text.replace(/\*\*/g, '');

export function PlayIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4c0 .6.7 1 1.2.7l8.2-5.2a.8.8 0 0 0 0-1.4L5.7 2.1c-.5-.3-1.2.1-1.2.7Z" fill="currentColor" /></svg>;
}

/* ---------------------------------------------------------------- screenshots with numbered markers */
function ShotView({ pic, active, eager }: { pic: Pic; active: number | null; eager?: boolean }) {
  const s = SHOTS[pic.shot];
  const pins = Object.entries(pic.pins ?? {})
    .map(([n, name]) => ({ n: Number(n), box: s.marks[name] }))
    .filter((p) => p.box);
  return (
    <div className="shot-img">
      <img src={s.src} width={s.w} height={s.h} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" />
      {pins.map(({ n, box: [x, y, w, h] }) => {
        // a large part of the screen gets its number inside, without a ring round the whole of it
        const area = w * h > 1500;
        const inside = area || x < 2.5 || y < 2.5;
        return (
          <span key={n} className={`pin${area ? ' pin--area' : ''}${inside ? ' pin--inside' : ''}${active === n ? ' on' : ''}`} style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }} aria-hidden="true">
            <b>{n}</b>
          </span>
        );
      })}
    </div>
  );
}

function Picture({ pic, active, alt }: { pic: Pic; active: number | null; alt: string }) {
  const [open, setOpen] = useState(false);
  const s = SHOTS[pic.shot];
  if (!s) return null;
  return (
    // screenshots are made at twice the size they show at, so they stay sharp; never wider than that
    // and never taller than a screenful (560 px): a tall picture still opens larger
    <figure className={`shot shot--${s.device}`} style={s.device === 'video' ? undefined : { maxWidth: Math.min(s.w / 2, Math.round((560 * s.w) / s.h)) }}>
      <button type="button" className="shot-zoom" onClick={() => setOpen(true)} aria-label={`Enlarge the picture: ${alt}`}>
        <span className="shot-frame"><ShotView pic={pic} active={active} /></span>
        <span className="shot-hint" aria-hidden="true">Enlarge</span>
      </button>
      {pic.caption && <figcaption><Rich text={pic.caption} /></figcaption>}
      <Dialog open={open} title={alt} onClose={() => setOpen(false)} className={`shot-dialog shot-dialog--${s.device}`}>
        <div className={`shot shot--${s.device} shot--large`} style={{ maxWidth: s.device === 'phone' ? s.w / 2 : s.w }}>
          <span className="shot-frame"><ShotView pic={pic} active={null} eager /></span>
        </div>
        {pic.caption && <p className="muted small shot-dialog-caption"><Rich text={pic.caption} /></p>}
      </Dialog>
    </figure>
  );
}

/* ---------------------------------------------------------------- a topic: what it is, the screen, the steps */
export function TopicCard({ t, onWatch }: { t: Topic; onWatch?: (at: number) => void }) {
  const [active, setActive] = useState<number | null>(null);
  const pics = (t.pics ?? []).filter((p) => SHOTS[p.shot]);
  const pinned = new Set(pics.flatMap((p) => Object.keys(p.pins ?? {}).map(Number)));
  const phone = pics.length > 0 && pics.every((p) => SHOTS[p.shot].device === 'phone');
  const video = pics.length > 0 && pics.every((p) => SHOTS[p.shot].device === 'video');
  return (
    <article id={t.id} className={`topic panel${phone ? ' topic--phone' : ''}${video ? ' topic--video' : ''}`} aria-labelledby={`${t.id}-title`}>
      <header className="topic-head">
        <div>
          {t.who && <p className="label">{t.who}</p>}
          <h3 id={`${t.id}-title`}>{t.title}</h3>
        </div>
        {t.video && onWatch && (
          <button className="btn btn-line btn-sm" type="button" onClick={() => onWatch(seconds(t.video!))} aria-label={`Watch ${t.title} in the tour video, at ${t.video}`}>
            <PlayIcon /> Watch it · {t.video}
          </button>
        )}
      </header>
      <p className="topic-lead"><Rich text={t.lead} /></p>
      {(pics.length > 0 || t.steps || t.tips) && (
        <div className={`topic-body${pics.length ? '' : ' no-pics'}${t.steps || t.tips ? '' : ' no-text'}`}>
          {pics.length > 0 && (
            <div className="topic-pics">
              {pics.map((p, i) => <Picture key={p.shot + i} pic={p} active={active} alt={`${t.title}${pics.length > 1 ? `, picture ${i + 1}` : ''}`} />)}
            </div>
          )}
          {(t.steps || t.tips) && (
            <div className="topic-text">
              {t.steps && (
                <ol className="steps" role="list">
                  {t.steps.map((step, i) => {
                    const n = i + 1;
                    const has = pinned.has(n);
                    return (
                      <li key={n} className={`${has ? 'has-pin' : ''}${active === n ? ' on' : ''}`} onMouseEnter={has ? () => setActive(n) : undefined} onMouseLeave={has ? () => setActive(null) : undefined}>
                        <span className="step-n" aria-hidden="true">{n}</span>
                        <span><Rich text={step} /></span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {t.tips && <ul className="tips">{t.tips.map((tip, i) => <li key={i}><Rich text={tip} /></li>)}</ul>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/* ---------------------------------------------------------------- the tour video */
const embed = (at: number) => `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&rel=0&playsinline=1&start=${Math.max(0, Math.floor(at))}`;
const Frame = ({ at }: { at: number }) => (
  <iframe src={embed(at)} title="Bannuar system tour (video)" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
);

/** The video stays a picture until someone plays it: nothing loads from YouTube before that. */
export function VideoTour({ chapters = CHAPTERS, poster = 'video-poster', label, playLabel = 'Play the tour' }: { chapters?: { at: string; label: string }[]; poster?: string; label?: string; playLabel?: string }) {
  const [at, setAt] = useState<number | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);
  const play = (c?: { at: string }) => {
    setChapter(c?.at ?? null);
    setAt(seconds(c?.at ?? chapters[0]?.at ?? '0:00'));
  };
  return (
    <div className="guide-video">
      <div className="video">
        {at === null ? (
          <button type="button" className="video-facade" onClick={() => play(chapters[0])} aria-label={`Play ${label ?? 'the tour video'} (${VIDEO_LENGTH}, plays from YouTube)`}>
            <img src={SHOTS[poster]?.src} width={1600} height={900} alt="" />
            <span className="video-play" aria-hidden="true"><PlayIcon size={18} /> {playLabel} <span className="video-len">{VIDEO_LENGTH}</span></span>
            <span className="video-note" aria-hidden="true">Plays from YouTube</span>
          </button>
        ) : (
          <Frame key={at} at={at} />
        )}
      </div>
      {chapters.length > 1 && (
        <ol className="chapters" role="list" aria-label="Chapters of the video">
          {chapters.map((c) => (
            <li key={c.at}>
              <button type="button" aria-current={chapter === c.at ? 'true' : undefined} onClick={() => play(c)}>
                <span className="t">{c.at}</span>
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A topic's "Watch it": the video in a dialog, from that moment. */
export function VideoDialog({ at, onClose }: { at: number | null; onClose: () => void }) {
  return (
    <Dialog open={at !== null} title="The tour video" onClose={onClose} className="video-dialog">
      {at !== null && <div className="video"><Frame at={at} /></div>}
      <p className="muted small" style={{ marginTop: 12 }}>
        Not playing? <a href={`${VIDEO_URL}?t=${at ?? 0}`} target="_blank" rel="noreferrer">Open it on YouTube</a>.
      </p>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- questions */
export const faqId = (f: Faq) => `faq-${f.q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;

export function FaqList({ items }: { items: Faq[] }) {
  const groups = [...new Set(items.map((f) => f.group))];
  return (
    <div className="faq">
      {groups.map((g) => (
        <section key={g} className="panel faq-group" aria-label={g}>
          <h3>{g}</h3>
          {items.filter((f) => f.group === g).map((f) => (
            <details key={f.q} id={faqId(f)} className="faq-item">
              <summary>{f.q}</summary>
              <div className="faq-a">{f.a.map((p, i) => <p key={i}><Rich text={p} /></p>)}</div>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- search */
export interface Hit { tab: TabId; id: string; title: string; text: string; kind: 'topic' | 'faq' }

export function searchGuide(query: string, sections: Section[], faq: Faq[]): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: Hit[] = [];
  const matches = (text: string) => words.every((w) => text.includes(w));
  for (const s of sections) {
    for (const t of s.topics) {
      const text = plain([t.title, t.who ?? '', t.lead, ...(t.steps ?? []), ...(t.tips ?? []), ...(t.pics ?? []).map((p) => p.caption ?? '')].join(' ')).toLowerCase();
      if (matches(text)) hits.push({ tab: s.id, id: t.id, title: t.title, text: plain(t.lead), kind: 'topic' });
    }
  }
  for (const f of faq) {
    if (matches(plain([f.q, ...f.a].join(' ')).toLowerCase())) hits.push({ tab: 'faq', id: faqId(f), title: f.q, text: plain(f.a[0]), kind: 'faq' });
  }
  return hits;
}

export function Hits({ hits, labels, onOpen, empty }: { hits: Hit[]; labels: Record<string, string>; onOpen: (h: Hit) => void; empty: ReactNode }) {
  if (!hits.length) return <div className="panel"><div className="state"><span className="beacon" aria-hidden="true" /><b>Nothing found</b><div>{empty}</div></div></div>;
  return (
    <ul className="guide-hits" role="list">
      {hits.map((h) => (
        <li key={h.kind + h.id}>
          <button type="button" onClick={() => onOpen(h)}>
            <span className="label">{h.kind === 'faq' ? 'Question' : labels[h.tab]}</span>
            <b>{h.title}</b>
            <span className="muted small">{h.text}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
