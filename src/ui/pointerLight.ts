/**
 * The light on a button follows the pointer: one listener for the whole page sets --mx and --my on
 * the button under the pointer, and styles.css draws a soft radial light there. Not on touch (no
 * hover to show it) and not under reduced motion.
 */
export function installPointerLight(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    const e = last;
    if (!e || !(e.target instanceof Element)) return;
    const button = e.target.closest<HTMLElement>('.btn');
    if (!button) return;
    const r = button.getBoundingClientRect();
    button.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    button.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  };
  const move = (e: PointerEvent) => {
    if (reduce.matches || e.pointerType === 'touch') return;
    last = e;
    if (!frame) frame = requestAnimationFrame(apply);
  };
  document.addEventListener('pointermove', move, { passive: true });
  return () => {
    document.removeEventListener('pointermove', move);
    if (frame) cancelAnimationFrame(frame);
  };
}
