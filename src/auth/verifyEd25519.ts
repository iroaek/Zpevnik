import { ed25519 } from '@noble/curves/ed25519.js';

export async function verifyEd25519Signature(
  key: JsonWebKey & { x: string },
  signature: Uint8Array<ArrayBuffer>,
  message: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  try {
    const cryptoKey = await crypto.subtle.importKey('jwk', key, 'Ed25519', false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, signature, message);
  } catch (error) {
    // Some installable browsers have WebCrypto without Ed25519. Only that
    // capability error selects the bundled verifier; native rejections stand.
    if (!error || typeof error !== 'object' || !('name' in error) || error.name !== 'NotSupportedError') throw error;
  }
  const base64 = key.x.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.x.length / 4) * 4, '=');
  const publicKey = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  // Strict RFC 8032 verification: never accept permissive ZIP215 encodings
  // or small-order keys when checking an authorization signature.
  return ed25519.verify(signature, message, publicKey, { zip215: false });
}
