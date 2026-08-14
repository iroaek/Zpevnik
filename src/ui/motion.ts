export type MotionDirection = 'forward' | 'back' | 'lateral';
export type MotionPreference = 'full' | 'gentle' | 'off';

export interface SharedElementTransition {
  source?: HTMLElement | null;
  targetSelector: string;
  name?: string;
}

export interface ElementTransitionOptions {
  name?: string;
  targetSelector?: string;
  duration?: number;
}

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

export function runRouteTransition(update: () => void, direction: MotionDirection, _shared?: SharedElementTransition): void {
  void _shared;
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
  const cleanup = () => {
    if (transitionId !== transitionSequence) return;
    fallbackAnimations.forEach((animation) => animation.cancel());
    fallbackAnimations = [];
    delete root.dataset.viewTransition;
    delete root.dataset.transitionDriver;
    delete root.dataset.navigationDirection;
    delete root.dataset.transitionPhase;
  };
  root.dataset.transitionDriver = 'compositor';
  root.dataset.transitionPhase = 'leaving';
  requestAnimationFrame(() => {
    if (transitionId !== transitionSequence) return;
    try {
      update();
    } catch (error) {
      cleanup();
      queueMicrotask(() => { throw error; });
      return;
    }
    root.dataset.transitionPhase = 'entering';

    const duration = preference === 'full' ? 230 : 185;
    const travel = direction === 'lateral' ? 8 : direction === 'forward' ? 22 : -22;
    const animations: Animation[] = [];
    const veil = document.querySelector<HTMLElement>('.route-transition-veil');
    if (veil && typeof veil.animate === 'function') {
      animations.push(veil.animate([
        { opacity: 0, transform: `translate3d(${-travel}px, 0, 0)` },
        { opacity: 0.28, transform: 'translate3d(0, 0, 0)', offset: 0.38 },
        { opacity: 0, transform: `translate3d(${travel}px, 0, 0)` },
      ], {
        duration,
        easing: 'cubic-bezier(.22, 1, .36, 1)',
      }));
    }

    const nextStage = document.querySelector<HTMLElement>('.route-stage');
    const heading = nextStage?.querySelector<HTMLElement>('h1');
    const accent = heading?.closest<HTMLElement>('.reader-header, .library-dashboard__heading, .catalog-page-heading, .admin-page-hero') ?? heading;
    if (accent && typeof accent.animate === 'function') {
      animations.push(accent.animate([
        { opacity: 0.72, transform: `translate3d(${travel * 0.3}px, 3px, 0)` },
        { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      ], {
        duration,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
      }));
    }

    fallbackAnimations = animations;
    if (animations.length === 0) {
      window.setTimeout(cleanup, duration);
      return;
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(cleanup);
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
  root.dataset.componentTransition = name;

  const cleanup = () => {
    if (root.dataset.componentTransition === name) delete root.dataset.componentTransition;
    delete container.dataset.motionTransition;
  };

  update();
  const target = options.targetSelector
    ? container.querySelector<HTMLElement>(options.targetSelector) ?? container
    : container;
  const targetIsOversized = target.scrollHeight > window.innerHeight * 1.75
    || target.scrollWidth > window.innerWidth * 1.5;
  if (targetIsOversized) {
    cleanup();
    return;
  }
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
