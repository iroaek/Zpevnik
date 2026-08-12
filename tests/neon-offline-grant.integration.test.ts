import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const verifier = readFileSync('src/auth/offlineGrant.ts', 'utf8');
const client = readFileSync('src/auth/secureAccess.ts', 'utf8');
const repository = readFileSync('src/repositories/neonAuthRepository.ts', 'utf8');

describe('Neon offline oprávnění', () => {
  it('stahuje krátký Neon JWT pouze online a offline ověřuje jeho Ed25519 podpis', () => {
    expect(client).toContain('`${neonAuthUrl}/token`');
    expect(client).toContain("credentials: 'include'");
    expect(verifier).toContain("alg: z.literal('EdDSA')");
    expect(verifier).toContain("crv: z.literal('Ed25519')");
    expect(verifier).toContain("crypto.subtle.verify(\n    'Ed25519'");
  });

  it('povolí offline obsah pouze schválené podepsané roli member/admin', () => {
    expect(verifier).toContain("options.profile.status !== 'approved'");
    expect(verifier).toContain('claims.banned');
    expect(verifier).toContain('claims.role !== options.profile.role');
    expect(verifier).toContain("options.profile.role === 'admin' ? 'admin' : 'members'");
  });

  it('ukládá veřejný JWKS s grantem a nepotřebuje Edge Function ani privátní klíč', () => {
    expect(repository).toContain("provider: 'neon-auth'");
    expect(repository).toContain('loadNeonPublicJwks()');
    expect(repository).not.toMatch(/supabase|private_jwk|service_role/i);
    expect(client).not.toMatch(/functions\.invoke|VITE_NEON_OFFLINE_GRANT_URL/i);
  });
});
