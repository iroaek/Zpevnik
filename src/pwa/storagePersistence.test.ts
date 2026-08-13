import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage, storagePersistenceState } from './storagePersistence';

describe('ochrana offline úložiště', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nežádá znovu, pokud už je úložiště trvalé', async () => {
    const persist = vi.fn();
    vi.stubGlobal('navigator', { storage: { persisted: vi.fn().mockResolvedValue(true), persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('požádá prohlížeč o ochranu dat', async () => {
    vi.stubGlobal('navigator', { storage: { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(await storagePersistenceState()).toBe(false);
  });
});
