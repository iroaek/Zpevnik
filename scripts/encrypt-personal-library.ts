import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const inputFlag = process.argv.indexOf('--input');
const outputFlag = process.argv.indexOf('--output');
const input = inputFlag >= 0 ? process.argv[inputFlag + 1] : undefined;
const output = outputFlag >= 0 ? process.argv[outputFlag + 1] : undefined;
const accessCode = process.env.ZPEVNIK_LIBRARY_ACCESS_CODE?.trim();

if (!input || !output) throw new Error('Použití: --input <záloha.json> --output <library.enc.json>');
if (!accessCode || accessCode.length < 16) throw new Error('Nastavte ZPEVNIK_LIBRARY_ACCESS_CODE o délce alespoň 16 znaků.');

const plaintext = await readFile(path.resolve(input));
const parsed = JSON.parse(plaintext.toString('utf8')) as { application?: unknown; personalSongs?: unknown };
if (parsed.application !== 'cesky-digitalni-zpevnik' || !Array.isArray(parsed.personalSongs)) {
  throw new Error('Vstup není platná úplná záloha Českého zpěvníku.');
}

const iterations = 310_000;
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(accessCode, salt, iterations, 32, 'sha256');
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
const envelope = {
  application: 'cesky-digitalni-zpevnik',
  envelopeVersion: 1,
  algorithm: 'AES-GCM',
  kdf: 'PBKDF2-SHA-256',
  iterations,
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  ciphertext: ciphertext.toString('base64'),
};

await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(path.resolve(output), `${JSON.stringify(envelope)}\n`, 'utf8');
console.log(`Zašifrováno ${parsed.personalSongs.length} osobních písní (${plaintext.byteLength} B).`);
