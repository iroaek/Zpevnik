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
  document.querySelectorAll('.route-stage').forEach((stage) => stage.remove());
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

  it('použije nativní View Transition pouze nad stabilním obsahem', async () => {
    reducedMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn();
    runRouteTransition(update, 'back');
    expect(update).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.transitionDriver).toBe('native');
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finish();
    await finished;
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('přenese pojmenovaný prvek ze zdroje do cílové obrazovky', async () => {
    reducedMotion(false);
    const source = document.createElement('strong');
    source.textContent = 'Zdroj';
    document.body.append(source);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn(() => {
      const target = document.createElement('h1');
      target.dataset.viewTransitionTarget = 'song-title';
      document.body.append(target);
    });

    runRouteTransition(update, 'forward', { source, targetSelector: '[data-view-transition-target="song-title"]', name: 'shared-song-title' });
    const target = document.querySelector<HTMLElement>('[data-view-transition-target="song-title"]');
    expect(source.style.getPropertyValue('view-transition-name')).toBe('shared-song-title');
    expect(target?.style.getPropertyValue('view-transition-name')).toBe('shared-song-title');
    finish();
    await finished;
    await Promise.resolve();
    expect(source.style.getPropertyValue('view-transition-name')).toBe('');
    expect(target?.style.getPropertyValue('view-transition-name')).toBe('');
    source.remove();
    target?.remove();
  });

  it('ve fallbacku plynule propojí starou a novou obrazovku změnou polohy i opacity', async () => {
    reducedMotion(false);
    const stage = document.createElement('div');
    stage.className = 'route-stage';
    let finishLeaving!: () => void;
    let finishEntering!: () => void;
    const leavingFinished = new Promise<void>((resolve) => { finishLeaving = resolve; });
    const enteringFinished = new Promise<void>((resolve) => { finishEntering = resolve; });
    let animationIndex = 0;
    const animate = vi.fn((keyframes: Keyframe[]) => {
      void keyframes;
      return { finished: animationIndex++ === 0 ? leavingFinished : enteringFinished, cancel: vi.fn() };
    });
    Object.defineProperty(stage, 'animate', { configurable: true, value: animate });
    document.body.append(stage);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const update = vi.fn();

    runRouteTransition(update, 'forward');
    expect(update).not.toHaveBeenCalled();
    finishLeaving();
    await leavingFinished;
    await Promise.resolve();
    expect(update).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0]?.[0]).toEqual([
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
      { opacity: 0.82, transform: 'translate3d(-5px, 0, 0)' },
    ]);
    expect(animate.mock.calls[1]?.[0]).toEqual([
      { opacity: 0.82, transform: 'translate3d(5px, 0, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' },
    ]);
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finishEntering();
    await enteringFinished;
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    stage.remove();
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
});
