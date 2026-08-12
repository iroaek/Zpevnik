export type MotionDirection = 'forward' | 'back' | 'lateral';

const PRIMARY_ROUTE_ORDER = ['library', 'setlists', 'import', 'offline', 'settings'];

export function routeMotionDirection(current: string, target: string): MotionDirection {
  if (target === 'song' || target === 'public-setlist') return current === target ? 'lateral' : 'forward';
  if (current === 'song' || current === 'public-setlist') return 'back';
  const currentIndex = PRIMARY_ROUTE_ORDER.indexOf(current);
  const targetIndex = PRIMARY_ROUTE_ORDER.indexOf(target);
  if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return 'lateral';
  return targetIndex > currentIndex ? 'forward' : 'back';
}

export function runRouteTransition(update: () => void, direction: MotionDirection): void {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const startViewTransition = (document as unknown as {
    startViewTransition?: (update: () => void) => { finished: Promise<void> };
  }).startViewTransition;
  if (reduced) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.navigationDirection = direction;
  root.dataset.viewTransition = 'active';
  const cleanup = () => {
    delete root.dataset.viewTransition;
    delete root.dataset.navigationDirection;
    delete root.dataset.transitionPhase;
  };
  if (!startViewTransition) {
    const currentStage = document.querySelector<HTMLElement>('.route-stage');
    if (!currentStage) {
      update();
      cleanup();
      return;
    }
    root.dataset.transitionPhase = 'leaving';
    window.setTimeout(() => {
      // Keep the incoming route in its first animated pose before the next
      // paint. Removing the phase here would expose one fully rendered frame
      // between the outgoing and incoming animations (visible as a flash).
      root.dataset.transitionPhase = 'preparing';
      try {
        update();
      } catch (error) {
        cleanup();
        throw error;
      }
      requestAnimationFrame(() => {
        root.dataset.transitionPhase = 'entering';
        window.setTimeout(cleanup, 310);
      });
    }, 170);
    return;
  }
  let updated = false;
  const commitUpdate = () => {
    updated = true;
    update();
  };
  try {
    const transition = startViewTransition.call(document, commitUpdate);
    void transition.finished.then(cleanup, cleanup);
  } catch {
    delete root.dataset.viewTransition;
    delete root.dataset.navigationDirection;
    if (!updated) update();
  }
}
