import { useState } from 'react';
import { FAQ, SECTIONS } from './content';
import { FaqList, TopicCard, VideoDialog, VideoTour } from './parts';

/** The client portal's Help: the client's part of the guide, the client part of the video, and questions. */
const ORDER = ['client-start', 'sign-in', 'client-posts', 'client-attendance', 'client-cutoff', 'client-reports', 'client-requests'];
const ALL = SECTIONS.flatMap((s) => s.topics.filter((t) => t.client));
const TOPICS = [...ALL].sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
const QUESTIONS = FAQ.filter((f) => f.client || f.clientOnly);

export default function ClientHelp() {
  const [watch, setWatch] = useState<number | null>(null);
  return (
    <div className="guide stack">
      <div className="guide-tour">
        <VideoTour chapters={[{ at: '4:31', label: 'The client portal' }]} label="The client portal, in the tour video" playLabel="Watch the client portal part" />
        <section className="panel panel-pad stack guide-aside" aria-labelledby="client-help-title">
          <h2 id="client-help-title">How to use the client portal</h2>
          <p>See who is on duty at your posts, check attendance, confirm each cutoff, and send Bannuar a report or a request.</p>
          <p className="muted small">The steps below show the real screens. Tap a picture to see it larger. In an emergency at a post, call the detachment commander there.</p>
        </section>
      </div>
      <div className="topics">
        {TOPICS.map((t) => <TopicCard key={t.id} t={t} onWatch={setWatch} />)}
      </div>
      <h2 className="guide-h2">Questions</h2>
      <FaqList items={QUESTIONS} />
      <VideoDialog at={watch} onClose={() => setWatch(null)} />
    </div>
  );
}
