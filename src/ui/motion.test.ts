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
  document.querySelectorAll('.route-stage, .route-transition-veil').forEach((stage) => stage.remove());
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.navigationDirection;
  delete document.documentElement.dataset.viewTransition;
  delete document.documentElement.dataset.transitionDriver;
  delete document.documentElement.dataset.transitionPhase;
  delete document.documentElement.dataset.componentTransition;
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

  it('vynechá nativní snapshot celé stránky a použije lehkou kompozitní vrstvu', async () => {
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
    expect(document.documentElement.dataset.transitionDriver).toBe('compositor');
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
    expect(update).toHaveBeenCalledOnce();
    expect(stageAnimate).not.toHaveBeenCalled();
    expect(veilAnimate).toHaveBeenCalledOnce();
    expect(headingAnimate).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finishVeil();
    finishHeading();
    await Promise.all([veilFinished, headingFinished]);
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    stage.remove();
    veil.remove();
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
