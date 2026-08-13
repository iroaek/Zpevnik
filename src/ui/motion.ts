export type MotionDirection = 'forward' | 'back' | 'lateral';
export type MotionPreference = 'full' | 'gentle' | 'off';

export interface SharedElementTransition {
  source?: HTMLElement | null;
  targetSelector: string;
  name?: string;
}

interface ViewTransitionLike {
  finished: Promise<unknown>;
  ready?: Promise<unknown>;
  skipTransition?: () => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

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

export function runRouteTransition(update: () => void, direction: MotionDirection, shared?: SharedElementTransition): void {
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
  const sharedName = shared?.name ?? 'shared-route-title';
  const sharedSource = shared?.source?.isConnected ? shared.source : null;
  let sharedTarget: HTMLElement | null = null;
  const clearSharedNames = () => {
    sharedSource?.style.removeProperty('view-transition-name');
    sharedTarget?.style.removeProperty('view-transition-name');
  };
  const cleanup = () => {
    if (transitionId !== transitionSequence) return;
    fallbackAnimations.forEach((animation) => animation.cancel());
    fallbackAnimations = [];
    clearSharedNames();
    delete root.dataset.viewTransition;
    delete root.dataset.transitionDriver;
    delete root.dataset.navigationDirection;
    delete root.dataset.transitionPhase;
  };

  const startViewTransition = (document as ViewTransitionDocument).startViewTransition;
  if (typeof startViewTransition === 'function') {
    root.dataset.transitionDriver = 'native';
    root.dataset.transitionPhase = 'preparing';
    if (sharedSource) sharedSource.style.setProperty('view-transition-name', sharedName);
    try {
      const transition = startViewTransition.call(document, () => {
        update();
        if (shared?.targetSelector) {
          sharedTarget = document.querySelector<HTMLElement>(shared.targetSelector);
          sharedTarget?.style.setProperty('view-transition-name', sharedName);
        }
        root.dataset.transitionPhase = 'entering';
      });
      void transition.finished.then(cleanup, cleanup);
      return;
    } catch {
      clearSharedNames();
      delete root.dataset.transitionDriver;
    }
  }

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
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      { opacity: 0.58, transform: `translate3d(${-travel}px, 0, 0)` },
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
        { opacity: 0.58, transform: `translate3d(${travel}px, 0, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
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
