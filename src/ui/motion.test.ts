import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeMotionDirection, runRouteTransition } from './motion';

function reducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  delete document.documentElement.dataset.navigationDirection;
  delete document.documentElement.dataset.viewTransition;
  delete document.documentElement.dataset.transitionPhase;
  vi.restoreAllMocks();
});

describe('směr navigačního pohybu', () => {
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

  it('při omezení pohybu provede změnu bez View Transition', () => {
    reducedMotion(true);
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn();
    runRouteTransition(update, 'forward');
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('při chybě nativního přechodu nikdy neprovede navigaci dvakrát', () => {
    reducedMotion(false);
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (update: () => void) => {
        update();
        throw new Error('synthetic transition failure');
      },
    });
    const update = vi.fn();
    runRouteTransition(update, 'back');
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('použije nativní kompozitorový přechod bez kopírování katalogu', async () => {
    reducedMotion(false);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
    const update = vi.fn();

    runRouteTransition(update, 'forward');
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    expect(document.querySelector('.route-transition-snapshot')).toBeNull();
    finish();
    await finished;
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });
});
