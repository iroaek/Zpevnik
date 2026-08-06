import { describe, expect, it } from 'vitest';
import { readBlobBytes } from './readBlobBytes';

describe('načtení PDF souboru', () => {
  it('použije kompatibilní FileReader, když Safari nenabízí Blob.arrayBuffer', async () => {
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'pisen.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: undefined });

    await expect(readBlobBytes(file)).resolves.toEqual(new Uint8Array([37, 80, 68, 70]));
  });
});
