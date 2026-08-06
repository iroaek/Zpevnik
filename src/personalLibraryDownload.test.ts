// @vitest-environment node
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptPersonalLibraryEnvelope } from './personalLibraryDownload';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  globalThis.atob ??= (value: string) => Buffer.from(value, 'base64').toString('binary');
});

describe('zašifrovaný osobní balíček', () => {
  it('odmítne neplatný formát ještě před importem', async () => {
    await expect(decryptPersonalLibraryEnvelope({ application: 'něco-jiného' }, 'DOSTATECNE-DLOUHY-KOD')).rejects.toThrow();
  });

  it('odemkne syntetický obsah správným kódem a odmítne chybný', async () => {
    const code = 'TEST-ONLY-ACCESS-CODE';
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const keyMaterial = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const plaintext = '{"synthetic":true}';
    const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
    const envelope = {
      application: 'cesky-digitalni-zpevnik', envelopeVersion: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA-256', iterations: 100_000,
      salt: Buffer.from(salt).toString('base64'), iv: Buffer.from(iv).toString('base64'), ciphertext: Buffer.from(ciphertext).toString('base64'),
    };

    await expect((await decryptPersonalLibraryEnvelope(envelope, code)).text()).resolves.toBe(plaintext);
    await expect(decryptPersonalLibraryEnvelope(envelope, 'WRONG-ACCESS-CODE')).rejects.toThrow('Přístupový kód');
  });
});
