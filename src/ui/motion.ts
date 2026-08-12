export type MotionDirection = 'forward' | 'back' | 'lateral';

const PRIMARY_ROUTE_ORDER = ['home', 'library', 'setlists', 'import', 'offline', 'settings'];

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
  const currentStage = document.querySelector<HTMLElement>('.route-stage');
  if (!currentStage) {
    update();
    cleanup();
    return;
  }

  const bounds = currentStage.getBoundingClientRect();
  const snapshot = currentStage.cloneNode(true) as HTMLElement;
  snapshot.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
  snapshot.classList.add('route-transition-snapshot');
  snapshot.setAttribute('aria-hidden', 'true');
  snapshot.setAttribute('inert', '');
  snapshot.style.setProperty('--route-snapshot-top', `${bounds.top}px`);
  snapshot.style.setProperty('--route-snapshot-left', `${bounds.left}px`);
  snapshot.style.setProperty('--route-snapshot-width', `${bounds.width}px`);
  snapshot.style.setProperty('--route-snapshot-height', `${bounds.height}px`);
  document.body.append(snapshot);

  root.dataset.transitionPhase = 'preparing';
  try {
    update();
  } catch (error) {
    snapshot.remove();
    cleanup();
    throw error;
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.dataset.transitionPhase = 'entering';
    snapshot.dataset.transitionPhase = 'leaving';
    window.setTimeout(() => {
      snapshot.remove();
      cleanup();
    }, 500);
  }));
}
