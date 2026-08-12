import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeMotionDirection, runRouteTransition, scrollWindowInstantly } from './motion';

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
  delete document.documentElement.dataset.transitionPhase;
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

  it('záměrně nepoužije nativní View Transition, která na mobilu bliká', () => {
    reducedMotion(false);
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn();
    runRouteTransition(update, 'back');
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('animuje pouze transformaci nové obrazovky bez změny průhlednosti', async () => {
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
      { transform: 'translate3d(0, 0, 0)' },
      { transform: 'translate3d(-3px, 0, 0)' },
    ]);
    expect(animate.mock.calls[1]?.[0]).toEqual([
      { transform: 'translate3d(3px, 0, 0)' },
      { transform: 'translate3d(0, 0, 0)' },
    ]);
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    finishEntering();
    await enteringFinished;
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    stage.remove();
  });
});
