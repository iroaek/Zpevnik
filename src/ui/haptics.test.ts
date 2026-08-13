import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptics';

describe('jemná haptická odezva', () => {
  const originalVibrate = navigator.vibrate;

  afterEach(() => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: originalVibrate });
  });

  it('použije krátkou odezvu výběru, pokud ji zařízení podporuje', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
    expect(haptic('selection')).toBe(true);
    expect(vibrate).toHaveBeenCalledWith(7);
  });

  it('bez podpory vibrací bezpečně pokračuje', () => {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: undefined });
    expect(haptic('success')).toBe(false);
  });
});
