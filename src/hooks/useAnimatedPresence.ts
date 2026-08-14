import { useEffect, useState } from 'react';

export type PresencePhase = 'entering' | 'entered' | 'exiting';

function motionIsDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  if (document.documentElement.dataset.motion === 'off') return true;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keeps a transient layer mounted long enough to play a real exit animation. */
export function useAnimatedPresence(open: boolean, exitDuration = 240): { mounted: boolean; phase: PresencePhase } {
  const [presence, setPresence] = useState({ keepMounted: open, entered: false });

  useEffect(() => {
    if (open) {
      const frame = window.requestAnimationFrame(() => setPresence({ keepMounted: true, entered: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!presence.keepMounted) return undefined;
    const timer = window.setTimeout(() => setPresence({ keepMounted: false, entered: false }), motionIsDisabled() ? 0 : exitDuration);
    return () => window.clearTimeout(timer);
  }, [exitDuration, open, presence.keepMounted]);

  return {
    mounted: open || presence.keepMounted,
    phase: open ? (presence.entered ? 'entered' : 'entering') : 'exiting',
  };
}
