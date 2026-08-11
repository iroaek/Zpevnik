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
  if (reduced || !startViewTransition) {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.navigationDirection = direction;
  root.dataset.viewTransition = 'active';
  let updated = false;
  const commitUpdate = () => {
    updated = true;
    update();
  };
  try {
    const transition = startViewTransition.call(document, commitUpdate);
    const cleanup = () => {
      delete root.dataset.viewTransition;
      delete root.dataset.navigationDirection;
    };
    void transition.finished.then(cleanup, cleanup);
  } catch {
    delete root.dataset.viewTransition;
    delete root.dataset.navigationDirection;
    if (!updated) update();
  }
}
