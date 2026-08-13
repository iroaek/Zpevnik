const BACKUP_APPLICATION = 'cesky-digitalni-zpevnik-encrypted';
const BACKUP_VERSION = 1;
const PBKDF2_ITERATIONS = 310_000;

interface EncryptedBackupEnvelope {
  application: typeof BACKUP_APPLICATION;
  version: typeof BACKUP_VERSION;
  algorithm: 'AES-GCM';
  keyDerivation: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  if (password.length < 12) throw new Error('Heslo zálohy musí mít alespoň 12 znaků.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: ownedBuffer(salt), iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export async function encryptBackup(payload: unknown, password: string): Promise<Blob> {
  if (!crypto?.subtle) throw new Error('Tento prohlížeč nepodporuje bezpečné šifrování záloh.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ownedBuffer(iv) }, key, ownedBuffer(plaintext)));
  const envelope: EncryptedBackupEnvelope = {
    application: BACKUP_APPLICATION,
    version: BACKUP_VERSION,
    algorithm: 'AES-GCM',
    keyDerivation: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    createdAt: new Date().toISOString(),
  };
  return new Blob([JSON.stringify(envelope)], { type: 'application/vnd.zpevnik.backup+json' });
}

export async function decryptBackup(file: Blob, password: string): Promise<Blob> {
  if (file.size > 80 * 1024 * 1024) throw new Error('Záloha je větší než povolených 80 MB.');
  let envelope: EncryptedBackupEnvelope;
  try {
    envelope = JSON.parse(await readBlobText(file)) as EncryptedBackupEnvelope;
  } catch {
    throw new Error('Zašifrovaná záloha má neplatný formát.');
  }
  if (envelope.application !== BACKUP_APPLICATION || envelope.version !== BACKUP_VERSION || envelope.algorithm !== 'AES-GCM' || envelope.keyDerivation !== 'PBKDF2-SHA256' || envelope.iterations !== PBKDF2_ITERATIONS) {
    throw new Error('Soubor není podporovaná zašifrovaná záloha zpěvníku.');
  }
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error('invalid envelope');
    const key = await deriveKey(password, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ownedBuffer(iv) }, key, ownedBuffer(base64ToBytes(envelope.ciphertext)));
    return new Blob([plaintext], { type: 'application/json' });
  } catch {
    throw new Error('Zálohu nelze odemknout. Zkontrolujte heslo a neporušenost souboru.');
  }
}

export async function isEncryptedBackup(file: Blob): Promise<boolean> {
  try {
    const text = await readBlobText(file.slice(0, 256));
    return text.includes(`"application":"${BACKUP_APPLICATION}"`);
  } catch {
    return false;
  }
}

export function downloadEncryptedBackup(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zpevnik-zaloha-${new Date().toISOString().slice(0, 10)}.zpevnik`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
import { readBlobText } from '../domain/readBlobBytes';
