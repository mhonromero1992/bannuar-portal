import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './motion';

/**
 * The sign-in page's signature: a 24-hour dial of the two duties Bannuar's guards keep (6 AM to
 * 6 PM, 6 PM to 6 AM), noon at the top, the badge at the centre and a gold lamp at the real time
 * in Manila. The duty under way is drawn in gold up to now. The dial leans a few degrees towards
 * the pointer; under reduced motion it stays flat (the time still moves, once a minute).
 */
const C = 200;
const R = 150;
const MANILA_MS = 8 * 3600000;

function manilaMinutes(d: Date): number {
  const t = new Date(d.getTime() + MANILA_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
/** clock position (minutes since midnight) to an angle from the top, clockwise; noon sits at the top */
const angleOf = (min: number) => ((min - 720) / 1440) * 360;
function point(min: number, r: number): [number, number] {
  const a = (angleOf(min) * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}
function arc(fromMin: number, toMin: number, r: number): string {
  const span = (toMin - fromMin + 1440) % 1440;
  const [x1, y1] = point(fromMin, r);
  const [x2, y2] = point(fromMin + span, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${span > 720 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}
const fmtTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const fmtSpan = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

export function DutyClock() {
  const [now, setNow] = useState(() => manilaMinutes(new Date()));
  const stage = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const tick = () => setNow(manilaMinutes(new Date()));
    const t = window.setInterval(tick, 20000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const el = stage.current;
    const room = el?.closest<HTMLElement>('.auth__art');
    if (!el || !room || reduce) return;
    let frame = 0;
    const lean = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = room.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ry', `${(dx * 12).toFixed(2)}deg`);
        el.style.setProperty('--rx', `${(-dy * 10).toFixed(2)}deg`);
      });
    };
    const rest = () => {
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--rx', '0deg');
    };
    room.addEventListener('pointermove', lean);
    room.addEventListener('pointerleave', rest);
    return () => {
      cancelAnimationFrame(frame);
      room.removeEventListener('pointermove', lean);
      room.removeEventListener('pointerleave', rest);
    };
  }, [reduce]);

  const day = now >= 360 && now < 1080;
  const start = day ? 360 : 1080;
  const done = (now - start + 1440) % 1440;
  const left = 720 - done;
  const duty = day ? 'Day duty' : 'Night duty';
  const change = day ? '6 PM' : '6 AM';
  const ticks = Array.from({ length: 24 }, (_, h) => h * 60);

  return (
    <>
      <div className="clock">
        <div className="clock__stage" ref={stage}>
          <svg className="clock__dial" viewBox="0 0 400 400" role="img" aria-label={`A 24-hour dial of the two duties. It is ${fmtTime(now)} in Manila, ${duty.toLowerCase()}, ${fmtSpan(left)} to the ${change} change of shift.`}>
            <circle className="clock__ring" cx={C} cy={C} r={R} />
            <path className="clock__day" d={arc(360, 1080, R)} />
            <path className="clock__night" d={arc(1080, 360, R)} />
            {done > 0 && <path className="clock__done" d={arc(start, now, R)} />}
            {ticks.map((m) => {
              const major = m % 360 === 0;
              const [x1, y1] = point(m, R + 16);
              const [x2, y2] = point(m, R + (major ? 30 : 22));
              return <line key={m} className={`clock__tick${major ? ' major' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
            })}
            <text className="clock__hour" x={C} y={C - R - 40} textAnchor="middle">Noon</text>
            <text className="clock__hour" x={C + R + 40} y={C + 4} textAnchor="start">6 PM</text>
            <text className="clock__hour" x={C} y={C + R + 52} textAnchor="middle">Midnight</text>
            <text className="clock__hour" x={C - R - 40} y={C + 4} textAnchor="end">6 AM</text>
            <text className="clock__duty" x={C} y={C - R + 40} textAnchor="middle">Day duty</text>
            <text className="clock__duty" x={C} y={C + R - 32} textAnchor="middle">Night duty</text>
            <g className="clock__lamp" style={{ transform: `rotate(${angleOf(now)}deg)`, transformOrigin: `${C}px ${C}px` }}>
              <circle cx={C} cy={C - R} r={15} />
              <circle cx={C} cy={C - R} r={7} />
            </g>
          </svg>
          <img className="clock__badge" src="/badge-288.png" alt="" width={144} height={144} />
        </div>
      </div>
      <p className="clock__now">
        Now in Manila <b>{fmtTime(now)}</b> <span>{duty}</span> {fmtSpan(left)} to the {change} change
      </p>
    </>
  );
}
