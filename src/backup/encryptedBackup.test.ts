import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup, isEncryptedBackup } from './encryptedBackup';

describe('šifrovaná záloha', () => {
  it('obnoví původní obsah pouze se správným heslem', async () => {
    const source = { application: 'cesky-digitalni-zpevnik', value: 'syntetická data' };
    const encrypted = await encryptBackup(source, 'bezpecne-heslo-123');
    expect(await isEncryptedBackup(encrypted)).toBe(true);
    const decrypted = await decryptBackup(encrypted, 'bezpecne-heslo-123');
    expect(JSON.parse(await decrypted.text())).toEqual(source);
    await expect(decryptBackup(encrypted, 'nespravne-heslo')).rejects.toThrow('Zálohu nelze odemknout');
  });

  it('odmítne krátké heslo', async () => {
    await expect(encryptBackup({ ok: true }, 'kratke')).rejects.toThrow('alespoň 12 znaků');
  });
});
