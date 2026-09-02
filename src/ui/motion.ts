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

interface SharedGhost {
  element: HTMLElement;
  sourceRect: DOMRect;
  sourceFontSize: number;
  target?: HTMLElement;
  targetOpacity?: string;
}

const PRIMARY_ROUTE_ORDER = ['home', 'library', 'setlists', 'import', 'offline', 'settings'];
let transitionSequence = 0;
let activeRouteCleanup: (() => void) | null = null;
const elementAnimations = new WeakMap<HTMLElement, Animation>();

function motionIsDisabled(): boolean {
  const reduced = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced || document.documentElement.dataset.motion === 'off';
}

function animationFor(
  element: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!element || typeof element.animate !== 'function') return null;
  try {
    return element.animate(keyframes, options);
  } catch {
    return null;
  }
}

function stageAccent(stage: HTMLElement | null): HTMLElement | null {
  const heading = stage?.querySelector<HTMLElement>('h1');
  return heading?.closest<HTMLElement>('.reader-header, .library-dashboard__heading, .catalog-page-heading, .admin-page-hero') ?? heading ?? null;
}

function animationTarget(stage: HTMLElement | null): HTMLElement | null {
  if (!stage) return null;
  const oversized = stage.scrollHeight > window.innerHeight * 1.75
    || stage.scrollWidth > window.innerWidth * 1.5;
  return oversized ? stageAccent(stage) : stage;
}

function cinematicTransform(direction: MotionDirection, phase: 'out' | 'in', full: boolean): string {
  const enteringSide = direction === 'forward' ? 1 : direction === 'back' ? -1 : 0;
  const side = phase === 'in' ? enteringSide : -enteringSide;
  const travel = full ? 48 : 19;
  const depth = full ? -105 : -34;
  const angle = full ? 4.8 : 1.35;
  if (direction === 'lateral') {
    return `perspective(1400px) translate3d(0, ${phase === 'in' ? 13 : -7}px, ${depth}px) rotateX(${phase === 'in' ? 2.6 : -1.8}deg) scale(${full ? 0.982 : 0.993})`;
  }
  return `perspective(1400px) translate3d(${side * travel}px, 0, ${depth}px) rotateY(${side * angle}deg) scale(${full ? 0.982 : 0.993})`;
}

function createSharedGhost(shared?: SharedElementTransition): SharedGhost | null {
  const source = shared?.source;
  if (!source?.isConnected) return null;
  const sourceRect = source.getBoundingClientRect();
  if (sourceRect.width < 1 || sourceRect.height < 1) return null;
  const computed = window.getComputedStyle(source);
  const ghost = document.createElement('span');
  ghost.className = 'route-shared-ghost';
  ghost.textContent = source.textContent;
  ghost.dataset.transitionName = shared?.name ?? 'shared-title';
  Object.assign(ghost.style, {
    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,
    width: `${sourceRect.width}px`,
    height: `${sourceRect.height}px`,
    color: computed.color,
    fontFamily: computed.fontFamily,
    fontSize: computed.fontSize,
    fontStyle: computed.fontStyle,
    fontWeight: computed.fontWeight,
    letterSpacing: computed.letterSpacing,
    lineHeight: computed.lineHeight,
    opacity: '0',
    textAlign: computed.textAlign,
  });
  document.body.append(ghost);
  return {
    element: ghost,
    sourceRect,
    sourceFontSize: Number.parseFloat(computed.fontSize) || 16,
  };
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
  activeRouteCleanup?.();
  activeRouteCleanup = null;
  const transitionId = ++transitionSequence;
  if (motionIsDisabled()) {
    update();
    return;
  }

  const root = document.documentElement;
  const preference = root.dataset.motion as MotionPreference | undefined;
  const full = preference === 'full';
  const exitDuration = full ? 155 : 85;
  const enterDuration = full ? 355 : 235;
  const totalDuration = exitDuration + enterDuration;
  const animations: Animation[] = [];
  const transformOrigins = new Map<HTMLElement, string>();
  let cleanupTimer: number | null = null;
  const sharedGhost = createSharedGhost(shared);
  let settled = false;

  root.dataset.navigationDirection = direction;
  root.dataset.viewTransition = 'active';
  root.dataset.transitionDriver = 'cinematic-3d';
  root.dataset.transitionPhase = 'leaving';

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (cleanupTimer !== null) window.clearTimeout(cleanupTimer);
    animations.forEach((animation) => animation.cancel());
    transformOrigins.forEach((origin, element) => { element.style.transformOrigin = origin; });
    if (sharedGhost?.target) sharedGhost.target.style.opacity = sharedGhost.targetOpacity ?? '';
    sharedGhost?.element.remove();
    if (transitionId === transitionSequence) {
      delete root.dataset.viewTransition;
      delete root.dataset.transitionDriver;
      delete root.dataset.navigationDirection;
      delete root.dataset.transitionPhase;
      activeRouteCleanup = null;
    }
  };
  activeRouteCleanup = cleanup;

  const addAnimation = (animation: Animation | null) => {
    if (animation) animations.push(animation);
    return animation;
  };

  const setTransformOrigin = (element: HTMLElement | null, origin: string) => {
    if (!element) return;
    if (!transformOrigins.has(element)) transformOrigins.set(element, element.style.transformOrigin);
    element.style.transformOrigin = origin;
  };

  const finishAfterAnimations = () => {
    if (animations.length === 0) {
      cleanupTimer = window.setTimeout(cleanup, enterDuration);
      return;
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(cleanup);
  };

  const animateSharedTitle = () => {
    if (!sharedGhost || !shared) return;
    const target = document.querySelector<HTMLElement>(shared.targetSelector);
    if (!target) return;
    const targetRect = target.getBoundingClientRect();
    if (targetRect.width < 1 || targetRect.height < 1) return;
    const targetStyle = window.getComputedStyle(target);
    const targetFontSize = Number.parseFloat(targetStyle.fontSize) || sharedGhost.sourceFontSize;
    const scale = Math.min(2.4, Math.max(0.55, targetFontSize / sharedGhost.sourceFontSize));
    const x = targetRect.left - sharedGhost.sourceRect.left;
    const y = targetRect.top - sharedGhost.sourceRect.top;
    sharedGhost.target = target;
    sharedGhost.targetOpacity = target.style.opacity;
    target.style.opacity = '0';
    addAnimation(animationFor(sharedGhost.element, [
      { opacity: 1, transform: 'perspective(1400px) translate3d(0, 0, 0) scale(1)' },
      { opacity: 1, offset: 0.52, transform: `perspective(1400px) translate3d(${x * 0.72}px, ${y * 0.72}px, 72px) scale(${1 + (scale - 1) * 0.72})` },
      { color: targetStyle.color, opacity: 0, transform: `perspective(1400px) translate3d(${x}px, ${y}px, 0) scale(${scale})` },
    ], {
      duration: enterDuration + Math.round(exitDuration * 0.55),
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    }));
    addAnimation(animationFor(target, [
      { opacity: 0 },
      { opacity: 0, offset: 0.58 },
      { opacity: 1 },
    ], {
      duration: enterDuration,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'both',
    }));
  };

  const commit = () => {
    if (transitionId !== transitionSequence || settled) return;
    try {
      if (sharedGhost) sharedGhost.element.style.opacity = '1';
      update();
    } catch (error) {
      cleanup();
      queueMicrotask(() => { throw error; });
      return;
    }
    root.dataset.transitionPhase = 'entering';

    requestAnimationFrame(() => {
      if (transitionId !== transitionSequence || settled) return;
      const nextStage = document.querySelector<HTMLElement>('.route-stage');
      const target = animationTarget(nextStage);
      const accent = stageAccent(nextStage);
      const incomingOpacity = full ? 0.12 : 0.45;
      setTransformOrigin(target, direction === 'forward' ? '100% 45%' : direction === 'back' ? '0% 45%' : '50% 0%');
      addAnimation(animationFor(target, [
        { opacity: incomingOpacity, transform: cinematicTransform(direction, 'in', full) },
        { opacity: 1, transform: 'perspective(1400px) translate3d(0, 0, 0) rotateX(0) rotateY(0) scale(1)' },
      ], {
        duration: enterDuration,
        easing: 'cubic-bezier(.16, 1, .3, 1)',
        fill: 'both',
      }));
      if (full && accent && accent !== target) {
        addAnimation(animationFor(accent, [
          { opacity: 0, transform: 'translate3d(0, 12px, 36px)' },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ], {
          delay: 55,
          duration: enterDuration - 55,
          easing: 'cubic-bezier(.16, 1, .3, 1)',
          fill: 'both',
        }));
      }
      animateSharedTitle();
      finishAfterAnimations();
    });
  };

  requestAnimationFrame(() => {
    if (transitionId !== transitionSequence || settled) return;
    const currentStage = document.querySelector<HTMLElement>('.route-stage');
    const target = animationTarget(currentStage);
    setTransformOrigin(target, direction === 'forward' ? '0% 45%' : direction === 'back' ? '100% 45%' : '50% 100%');
    const outgoing = addAnimation(animationFor(target, [
      { opacity: 1, transform: 'perspective(1400px) translate3d(0, 0, 0) rotateX(0) rotateY(0) scale(1)' },
      { opacity: full ? 0.12 : 0.48, transform: cinematicTransform(direction, 'out', full) },
    ], {
      duration: exitDuration,
      easing: 'cubic-bezier(.55, .06, .68, .19)',
      fill: 'both',
    }));

    addAnimation(animationFor(document.querySelector<HTMLElement>('.route-transition-veil'), [
      { opacity: 0, transform: 'translate3d(-42%, 0, 0) skewX(-11deg) scaleX(.72)' },
      { opacity: full ? 0.72 : 0.38, offset: 0.42, transform: 'translate3d(0, 0, 0) skewX(-6deg) scaleX(1.06)' },
      { opacity: 0, transform: 'translate3d(45%, 0, 0) skewX(-2deg) scaleX(.78)' },
    ], {
      duration: totalDuration,
      easing: 'cubic-bezier(.22, 1, .36, 1)',
      fill: 'both',
    }));
    addAnimation(animationFor(document.querySelector<HTMLElement>('.route-transition-vignette'), [
      { opacity: 0, transform: 'scale(1.08)' },
      { opacity: full ? 0.48 : 0.2, offset: 0.34, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(1.04)' },
    ], {
      duration: totalDuration,
      easing: 'ease-out',
      fill: 'both',
    }));
    if (full) {
      document.querySelectorAll<HTMLElement>('.route-transition-bar').forEach((bar) => {
        const edge = bar.classList.contains('route-transition-bar--top') ? -1 : 1;
        addAnimation(animationFor(bar, [
          { transform: `translate3d(0, ${edge * 105}%, 0)` },
          { transform: 'translate3d(0, 0, 0)', offset: 0.28 },
          { transform: 'translate3d(0, 0, 0)', offset: 0.58 },
          { transform: `translate3d(0, ${edge * 105}%, 0)` },
        ], {
          duration: totalDuration,
          easing: 'cubic-bezier(.22, 1, .36, 1)',
          fill: 'both',
        }));
      });
    }

    if (!outgoing) {
      commit();
      return;
    }
    void outgoing.finished.then(commit, commit);
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
