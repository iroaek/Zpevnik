import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnimatedPresence } from './useAnimatedPresence';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.motion;
});

describe('useAnimatedPresence', () => {
  it('ponechá zavíranou vrstvu namontovanou po dobu výstupní animace', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { result, rerender } = renderHook(({ open }) => useAnimatedPresence(open, 240), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, phase: 'entered' });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, phase: 'exiting' });
    act(() => vi.advanceTimersByTime(240));
    expect(result.current.mounted).toBe(false);
  });

  it('při vypnutém pohybu vrstvu odpojí bez čekání', () => {
    vi.useFakeTimers();
    document.documentElement.dataset.motion = 'off';
    const { result, rerender } = renderHook(({ open }) => useAnimatedPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => vi.runAllTimers());
    expect(result.current.mounted).toBe(false);
  });
});
