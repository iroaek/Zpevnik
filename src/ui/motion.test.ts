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

  it('bez nativního View Transition použije plynulý CSS fallback', async () => {
    vi.useFakeTimers();
    reducedMotion(false);
    document.body.innerHTML = '<main><div class="route-stage">Původní</div></main>';
    const update = vi.fn(() => { document.querySelector('.route-stage')!.textContent = 'Nová'; });

    runRouteTransition(update, 'forward');
    expect(document.documentElement.dataset.viewTransition).toBe('active');
    expect(document.documentElement.dataset.transitionPhase).toBe('leaving');
    await vi.advanceTimersByTimeAsync(170);
    expect(document.documentElement.dataset.transitionPhase).toBe('preparing');
    await vi.advanceTimersToNextTimerAsync();
    expect(document.documentElement.dataset.transitionPhase).toBe('entering');
    await vi.advanceTimersByTimeAsync(310);

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });
});
