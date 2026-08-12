export type MotionDirection = 'forward' | 'back' | 'lateral';
export type MotionPreference = 'full' | 'gentle' | 'off';

const PRIMARY_ROUTE_ORDER = ['home', 'library', 'setlists', 'import', 'offline', 'settings'];
let transitionSequence = 0;
let fallbackAnimations: Animation[] = [];

export function routeMotionDirection(current: string, target: string): MotionDirection {
  if (target === 'song' || target === 'public-setlist') return current === target ? 'lateral' : 'forward';
  if (current === 'song' || current === 'public-setlist') return 'back';
  const currentIndex = PRIMARY_ROUTE_ORDER.indexOf(current);
  const targetIndex = PRIMARY_ROUTE_ORDER.indexOf(target);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return 'lateral';
  return targetIndex > currentIndex ? 'forward' : 'back';
}

export function scrollWindowInstantly(top: number): void {
  const root = document.documentElement;
  const previousScrollBehavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo({ top: Math.max(0, top), left: 0, behavior: 'auto' });
  if (previousScrollBehavior) root.style.scrollBehavior = previousScrollBehavior;
  else root.style.removeProperty('scroll-behavior');
}

export function runRouteTransition(update: () => void, direction: MotionDirection): void {
  const transitionId = ++transitionSequence;
  fallbackAnimations.forEach((animation) => animation.cancel());
  fallbackAnimations = [];
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const preference = document.documentElement.dataset.motion as MotionPreference | undefined;
  if (reduced || preference === 'off') {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.navigationDirection = direction;
  root.dataset.viewTransition = 'active';
  const cleanup = () => {
    if (transitionId !== transitionSequence) return;
    fallbackAnimations.forEach((animation) => animation.cancel());
    fallbackAnimations = [];
    delete root.dataset.viewTransition;
    delete root.dataset.navigationDirection;
    delete root.dataset.transitionPhase;
  };

  const currentStage = document.querySelector<HTMLElement>('.route-stage');
  if (!currentStage || typeof currentStage.animate !== 'function') {
    update();
    cleanup();
    return;
  }

  const magnitude = preference === 'full' ? 6 : 3;
  const travel = direction === 'lateral' ? 0 : direction === 'forward' ? magnitude : -magnitude;
  const enterDuration = preference === 'full' ? 240 : 165;
  const leaveDuration = preference === 'full' ? 110 : 75;
  root.dataset.transitionPhase = 'preparing';
  requestAnimationFrame(() => {
    if (transitionId !== transitionSequence) return;
    root.dataset.transitionPhase = 'leaving';
    const leaving = currentStage.animate([
      { transform: 'translate3d(0, 0, 0)' },
      { transform: `translate3d(${-travel}px, 0, 0)` },
    ], {
      duration: leaveDuration,
      easing: 'cubic-bezier(.4, 0, 1, 1)',
      fill: 'both',
    });
    fallbackAnimations = [leaving];
    const enter = () => {
      if (transitionId !== transitionSequence) return;
      try {
        update();
      } catch (error) {
        cleanup();
        queueMicrotask(() => { throw error; });
        return;
      }
      root.dataset.transitionPhase = 'entering';
      const nextStage = document.querySelector<HTMLElement>('.route-stage');
      if (!nextStage || typeof nextStage.animate !== 'function') {
        cleanup();
        return;
      }
      const entering = nextStage.animate([
        { transform: `translate3d(${travel}px, 0, 0)` },
        { transform: 'translate3d(0, 0, 0)' },
      ], {
        duration: enterDuration,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
        fill: 'both',
      });
      fallbackAnimations = [entering];
      void entering.finished.then(cleanup, cleanup);
    };
    void leaving.finished.then(enter, cleanup);
  });
}
