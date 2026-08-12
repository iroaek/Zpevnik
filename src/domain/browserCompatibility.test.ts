import { describe, expect, it, vi } from 'vitest';
import { createUuid, installBrowserCompatibility } from './browserCompatibility';

describe('kompatibilita staršího Safari', () => {
  it('vytvoří platné UUID i bez crypto.randomUUID', () => {
    const originalCrypto = globalThis.crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, index) => index));
      return bytes;
    });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    try {
      expect(createUuid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });

  it('doplní randomUUID před inicializací Neon Auth SDK', () => {
    const originalCrypto = globalThis.crypto;
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0x2a);
      return bytes;
    });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    try {
      installBrowserCompatibility();
      expect(globalThis.crypto.randomUUID()).toBe('2a2a2a2a-2a2a-4a2a-aa2a-2a2a2a2a2a2a');
      expect(getRandomValues).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
});
