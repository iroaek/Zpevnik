import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncDeadlineError, withDeadline } from './asyncDeadline';

describe('časový limit asynchronní hydratace', () => {
  afterEach(() => vi.useRealTimers());

  it('vrátí včasný výsledek a zruší časovač', async () => {
    vi.useFakeTimers();
    await expect(withDeadline(Promise.resolve('hotovo'), 1000, 'timeout')).resolves.toBe('hotovo');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ukončí navždy čekající operaci s rozlišitelnou chybou', async () => {
    vi.useFakeTimers();
    const result = withDeadline(new Promise<never>(() => undefined), 1000, 'Úložiště neodpovídá.');
    const assertion = expect(result).rejects.toEqual(new AsyncDeadlineError('Úložiště neodpovídá.'));
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
