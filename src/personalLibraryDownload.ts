import { z } from 'zod';
import { importFullBackup, type BackupImportResult } from './storage/database';

const encryptedLibrarySchema = z.object({
  application: z.literal('cesky-digitalni-zpevnik'),
  envelopeVersion: z.literal(1),
  algorithm: z.literal('AES-GCM'),
  kdf: z.literal('PBKDF2-SHA-256'),
  iterations: z.number().int().min(100_000).max(2_000_000),
  salt: z.string().min(16),
  iv: z.string().min(12),
  ciphertext: z.string().min(16),
});

export type EncryptedLibraryEnvelope = z.infer<typeof encryptedLibrarySchema>;

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function decryptPersonalLibraryEnvelope(payload: unknown, accessCode: string): Promise<Blob> {
  const envelope = encryptedLibrarySchema.parse(payload);
  const normalizedCode = accessCode.trim();
  if (!normalizedCode) throw new Error('Zadejte osobní přístupový kód.');

  try {
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(normalizedCode),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: decodeBase64(envelope.salt), iterations: envelope.iterations },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64(envelope.iv) },
      key,
      decodeBase64(envelope.ciphertext),
    );
    return new Blob([plaintext], { type: 'application/json' });
  } catch {
    throw new Error('Přístupový kód není správný nebo je balíček poškozený.');
  }
}

export async function downloadPersonalLibrary(accessCode: string, signal?: AbortSignal): Promise<BackupImportResult> {
  const response = await fetch(`${import.meta.env.BASE_URL}personal-library/library.enc.json`, {
    cache: 'no-store',
    signal,
  });
  if (response.status === 404) throw new Error('Osobní balíček zatím není na serveru připravený.');
  if (!response.ok) throw new Error(`Osobní balíček nelze stáhnout (${response.status}).`);
  const backup = await decryptPersonalLibraryEnvelope(await response.json(), accessCode);
  return importFullBackup(backup);
}
