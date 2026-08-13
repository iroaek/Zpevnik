export type HapticKind = 'selection' | 'success' | 'warning';

const patterns: Record<HapticKind, number | number[]> = {
  selection: 7,
  success: [8, 32, 12],
  warning: [18, 38, 18],
};

/** Jemná odezva pro podporovaná zařízení. Na iOS a desktopu bezpečně nic neudělá. */
export function haptic(kind: HapticKind = 'selection'): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  try {
    return navigator.vibrate(patterns[kind]);
  } catch {
    return false;
  }
}
