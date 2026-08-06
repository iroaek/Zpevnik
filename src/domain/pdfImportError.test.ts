import { describe, expect, it } from 'vitest';
import { describePdfImportError } from './pdfImportError';

describe('srozumitelné chyby PDF importu', () => {
  it('nahradí nečitelnou chybu starého WebKitu pokynem k aktualizaci', () => {
    expect(describePdfImportError(new TypeError("undefined is not a function (near '...e of t...')")))
      .toContain('zkontrolujte aktualizaci');
  });

  it('vysvětlí PDF chráněné heslem', () => {
    expect(describePdfImportError(new Error('PasswordException: No password given'))).toContain('chráněné heslem');
  });
});
