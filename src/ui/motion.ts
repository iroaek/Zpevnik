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

type ViewTransitionElement = HTMLElement & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

export interface ElementTransitionOptions {
  name?: string;
  targetSelector?: string;
  duration?: number;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

const PRIMARY_ROUTE_ORDER = ['home', 'library', 'setlists', 'import', 'offline', 'settings'];
let transitionSequence = 0;
let fallbackAnimations: Animation[] = [];
const elementAnimations = new WeakMap<HTMLElement, Animation>();

function motionIsDisabled(): boolean {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced || document.documentElement.dataset.motion === 'off';
}

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
  const preference = document.documentElement.dataset.motion as MotionPreference | undefined;
  if (motionIsDisabled()) {
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

  const magnitude = preference === 'full' ? 8 : 5;
  const travel = direction === 'lateral' ? 0 : direction === 'forward' ? magnitude : -magnitude;
  const enterDuration = preference === 'full' ? 270 : 220;
  const leaveDuration = preference === 'full' ? 125 : 90;
  root.dataset.transitionPhase = 'preparing';
  requestAnimationFrame(() => {
    if (transitionId !== transitionSequence) return;
    root.dataset.transitionPhase = 'leaving';
    const leaving = currentStage.animate([
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      { opacity: 0.82, transform: `translate3d(${-travel}px, 0, 0)` },
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
        { opacity: 0.82, transform: `translate3d(${travel}px, 0, 0)` },
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

/** Animates an in-place mode or layout change without snapshotting the whole page. */
export function runElementTransition(container: HTMLElement | null, update: () => void, options: ElementTransitionOptions = {}): void {
  if (!container || motionIsDisabled()) {
    update();
    return;
  }
  const root = document.documentElement;
  const name = options.name ?? 'component';
  const scopedTransition = (container as ViewTransitionElement).startViewTransition;
  root.dataset.componentTransition = name;

  const cleanup = () => {
    if (root.dataset.componentTransition === name) delete root.dataset.componentTransition;
    delete container.dataset.motionTransition;
  };

  if (typeof scopedTransition === 'function') {
    try {
      const transition = scopedTransition.call(container, update);
      void transition.finished.then(cleanup, cleanup);
      return;
    } catch {
      // Older engines can expose the draft method but reject scoped transitions.
    }
  }

  update();
  const target = options.targetSelector
    ? container.querySelector<HTMLElement>(options.targetSelector) ?? container
    : container;
  elementAnimations.get(target)?.cancel();
  container.dataset.motionTransition = name;
  if (typeof target.animate !== 'function') {
    cleanup();
    return;
  }
  const preference = root.dataset.motion as MotionPreference | undefined;
  const animation = target.animate([
    { opacity: 0.78, transform: 'translate3d(0, 5px, 0) scale(.996)' },
    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
  ], {
    duration: options.duration ?? (preference === 'full' ? 300 : 230),
    easing: 'cubic-bezier(.16, 1, .3, 1)',
  });
  elementAnimations.set(target, animation);
  void animation.finished.then(cleanup, cleanup);
}
