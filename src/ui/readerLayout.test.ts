import { describe, expect, it } from 'vitest';
import { mobileColumnPercent } from './readerLayout';

describe('mobileColumnPercent', () => {
  it('převádí desktopové nastavení na zřetelný mobilní rozsah', () => {
    expect(mobileColumnPercent(320)).toBe(84);
    expect(mobileColumnPercent(650)).toBe(92);
    expect(mobileColumnPercent(980)).toBe(100);
  });

  it('bezpečně omezuje hodnoty mimo rozsah', () => {
    expect(mobileColumnPercent(0)).toBe(84);
    expect(mobileColumnPercent(2_000)).toBe(100);
  });
});
