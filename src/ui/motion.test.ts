import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeMotionDirection, runElementTransition, runRouteTransition, scrollWindowInstantly } from './motion';

function reducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('.route-stage, .route-transition-scene, .route-transition-veil, .route-shared-ghost').forEach((stage) => stage.remove());
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.navigationDirection;
  delete document.documentElement.dataset.viewTransition;
  delete document.documentElement.dataset.transitionDriver;
  delete document.documentElement.dataset.transitionPhase;
  delete document.documentElement.dataset.componentTransition;
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
});

describe('směr navigačního pohybu', () => {
  it('obnoví pozici stránky okamžitě bez zděděného smooth scrollu', () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {
      expect(document.documentElement.style.scrollBehavior).toBe('auto');
    });
    document.documentElement.style.scrollBehavior = 'smooth';
    scrollWindowInstantly(640);
    expect(scrollTo).toHaveBeenCalledWith({ top: 640, left: 0, behavior: 'auto' });
    expect(document.documentElement.style.scrollBehavior).toBe('smooth');
  });

  it('otevírá detail dopředu a vrací se zpět', () => {
    expect(routeMotionDirection('library', 'song')).toBe('forward');
    expect(routeMotionDirection('song', 'library')).toBe('back');
    expect(routeMotionDirection('setlists', 'public-setlist')).toBe('forward');
  });

  it('respektuje pořadí hlavní mobilní navigace', () => {
    expect(routeMotionDirection('library', 'settings')).toBe('forward');
    expect(routeMotionDirection('settings', 'offline')).toBe('back');
    expect(routeMotionDirection('song', 'song')).toBe('lateral');
  });

  it('při omezení pohybu provede změnu bez animace', () => {
    reducedMotion(true);
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn();
    runRouteTransition(update, 'forward');
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('vynechá nativní snapshot celé stránky a použije filmovou kompozitní vrstvu', async () => {
    reducedMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const veil = document.createElement('div');
    veil.className = 'route-transition-veil';
    const veilAnimation = { finished, cancel: vi.fn() } as unknown as Animation;
    const animate = vi.fn(() => veilAnimation);
    Object.defineProperty(veil, 'animate', { configurable: true, value: animate });
    document.body.append(veil);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const update = vi.fn();
    runRouteTransition(update, 'back');
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.transitionDriver).toBe('cinematic-3d');
    expect(document.documentElement.dataset.transitionPhase).toBe('entering');
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('animuje pouze závoj a malé záhlaví, nikoli celý dlouhý obsah', async () => {
    reducedMotion(false);
    const stage = document.createElement('div');
    stage.className = 'route-stage';
    const heading = document.createElement('h1');
    stage.append(heading);
    Object.defineProperty(stage, 'scrollHeight', { configurable: true, value: window.innerHeight * 4 });
    const stageAnimate = vi.fn();
    Object.defineProperty(stage, 'animate', { configurable: true, value: stageAnimate });
    let finishHeading!: () => void;
    const headingFinished = new Promise<void>((resolve) => { finishHeading = resolve; });
    const headingAnimate = vi.fn(() => ({ finished: headingFinished, cancel: vi.fn() }));
    Object.defineProperty(heading, 'animate', { configurable: true, value: headingAnimate });
    const veil = document.createElement('div');
    veil.className = 'route-transition-veil';
    let finishVeil!: () => void;
    const veilFinished = new Promise<void>((resolve) => { finishVeil = resolve; });
    const veilAnimate = vi.fn(() => ({ finished: veilFinished, cancel: vi.fn() }));
    Object.defineProperty(veil, 'animate', { configurable: true, value: veilAnimate });
    document.body.append(stage, veil);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const update = vi.fn();

    runRouteTransition(update, 'forward');
    finishHeading();
    await headingFinished;
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(stageAnimate).not.toHaveBeenCalled();
    expect(veilAnimate).toHaveBeenCalledOnce();
    expect(headingAnimate).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finishVeil();
    await Promise.all([veilFinished, headingFinished]);
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    stage.remove();
    veil.remove();
  });

  it('zkrátí přechod a zklidní prostorový pohyb při zachování kompozice', async () => {
    reducedMotion(false);
    document.documentElement.dataset.motion = 'full';
    const resolvedAnimation = () => ({ finished: Promise.resolve(), cancel: vi.fn() }) as unknown as Animation;
    const animationMock = () => vi.fn((keyframes: Keyframe[], options?: KeyframeAnimationOptions) => {
      void keyframes;
      void options;
      return resolvedAnimation();
    });
    const stage = document.createElement('div');
    stage.className = 'route-stage';
    stage.append(document.createElement('h1'));
    const stageAnimate = animationMock();
    Object.defineProperty(stage, 'animate', { configurable: true, value: stageAnimate });
    const scene = document.createElement('div');
    scene.className = 'route-transition-scene';
    const veil = document.createElement('span');
    veil.className = 'route-transition-veil';
    const vignette = document.createElement('span');
    vignette.className = 'route-transition-vignette';
    const topBar = document.createElement('span');
    topBar.className = 'route-transition-bar route-transition-bar--top';
    const bottomBar = document.createElement('span');
    bottomBar.className = 'route-transition-bar route-transition-bar--bottom';
    const barAnimate = animationMock();
    [veil, vignette, topBar, bottomBar].forEach((element) => {
      Object.defineProperty(element, 'animate', { configurable: true, value: element === topBar || element === bottomBar ? barAnimate : animationMock() });
      scene.append(element);
    });
    document.body.append(stage, scene);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    runRouteTransition(vi.fn(), 'forward');
    const exitFrames = stageAnimate.mock.calls[0][0];
    expect(String(exitFrames[1]?.transform)).toContain('rotateY(0deg)');
    expect(String(exitFrames[1]?.transform)).toContain('translate3d(-12px, 0, 0px)');
    expect(Number(stageAnimate.mock.calls[0][1]?.duration)).toBeLessThanOrEqual(180);
    expect(barAnimate.mock.calls.every(([, options]) => Number(options?.duration) <= 180)).toBe(true);
    expect(barAnimate).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    await Promise.resolve();
  });

  it('změní režim uvnitř komponenty bez animování celé stránky', async () => {
    reducedMotion(false);
    const container = document.createElement('section');
    const surface = document.createElement('div');
    surface.className = 'surface';
    container.append(surface);
    document.body.append(container);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const animate = vi.fn(() => ({ finished, cancel: vi.fn() }));
    Object.defineProperty(surface, 'animate', { configurable: true, value: animate });
    const update = vi.fn();

    runElementTransition(container, update, { name: 'performance', targetSelector: '.surface' });
    expect(update).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.componentTransition).toBe('performance');
    expect(container.dataset.motionTransition).toBe('performance');
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.dataset.componentTransition).toBeUndefined();
    container.remove();
  });

  it('u velmi dlouhého obsahu nepořizuje ani neanimuje obří kompoziční vrstvu', () => {
    reducedMotion(false);
    const container = document.createElement('section');
    const surface = document.createElement('div');
    surface.className = 'surface';
    Object.defineProperty(surface, 'scrollHeight', { configurable: true, value: window.innerHeight * 4 });
    const animate = vi.fn();
    Object.defineProperty(surface, 'animate', { configurable: true, value: animate });
    container.append(surface);
    document.body.append(container);
    const update = vi.fn();

    runElementTransition(container, update, { name: 'long-reader', targetSelector: '.surface' });
    expect(update).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.componentTransition).toBeUndefined();
    container.remove();
  });
});
