import { createClient } from 'npm:@supabase/supabase-js@2.112.1';

interface LibraryManifest {
  version: string;
  scope: 'admin' | 'members';
  songCount: number;
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const allowed = (Deno.env.get('OFFLINE_GRANT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function encodedJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  if (request.method === 'OPTIONS') {
    if (!origin) return json({ error: 'origin_not_allowed' }, 403, null);
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      },
    });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
  if (request.headers.get('Origin') && !origin) return json({ error: 'origin_not_allowed' }, 403, null);

  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const privateJwkValue = Deno.env.get('OFFLINE_GRANT_PRIVATE_JWK');
  const issuer = Deno.env.get('OFFLINE_GRANT_ISSUER');
  const audience = Deno.env.get('OFFLINE_GRANT_AUDIENCE') || 'cesky-zpevnik-offline';
  if (!authorization || !supabaseUrl || !anonKey || !serviceRoleKey || !privateJwkValue || !issuer) {
    return json({ error: 'server_not_configured' }, 503, origin);
  }

  let requestBody: { deviceId?: unknown };
  try {
    requestBody = await request.json() as { deviceId?: unknown };
  } catch {
    return json({ error: 'invalid_json' }, 400, origin);
  }
  const deviceId = typeof requestBody.deviceId === 'string' ? requestBody.deviceId.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(deviceId)) return json({ error: 'invalid_device_id' }, 400, origin);

  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return json({ error: 'authentication_required' }, 401, origin);

  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('id,display_name,status,role')
    .eq('id', userData.user.id)
    .single();
  if (profileError || !profile) return json({ error: 'profile_not_found' }, 403, origin);
  if (profile.status === 'suspended' || profile.status === 'rejected') return json({ error: 'account_revoked', code: 'account_revoked' }, 403, origin);
  if (profile.status !== 'approved') return json({ error: 'account_not_approved' }, 403, origin);

  const scope = profile.role === 'admin' ? 'admin' : 'members';
  const manifestPath = scope === 'admin' ? 'admin/admin-library.manifest.json' : 'members/member-library.manifest.json';
  const { data: manifestBlob, error: manifestError } = await service.storage.from('song-library').download(manifestPath);
  if (manifestError || !manifestBlob) return json({ error: 'content_manifest_unavailable' }, 503, origin);
  let manifest: LibraryManifest;
  try {
    manifest = JSON.parse(await manifestBlob.text()) as LibraryManifest;
    if (manifest.scope !== scope || !/^[a-f0-9]{12,64}$/.test(manifest.version)) throw new Error('invalid manifest');
  } catch {
    return json({ error: 'content_manifest_invalid' }, 503, origin);
  }

  let privateJwk: JsonWebKey;
  try {
    privateJwk = JSON.parse(privateJwkValue) as JsonWebKey;
    if (privateJwk.kty !== 'EC' || privateJwk.crv !== 'P-256' || !privateJwk.d || !privateJwk.kid) throw new Error('invalid key');
  } catch {
    return json({ error: 'signing_key_invalid' }, 503, origin);
  }

  const now = new Date();
  const validityDays = Math.min(90, Math.max(1, Number(Deno.env.get('OFFLINE_GRANT_VALIDITY_DAYS') || 30)));
  const validUntil = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const payload = {
    version: 1,
    issuer,
    audience,
    subject: profile.id,
    displayName: profile.display_name,
    scopes: profile.role === 'admin' ? ['songs:read', 'content:download', 'admin:local'] : ['songs:read', 'content:download'],
    contentPackages: [scope],
    contentVersion: manifest.version,
    issuedAt: now.toISOString(),
    notBefore: new Date(now.getTime() - 60_000).toISOString(),
    offlineValidUntil: validUntil.toISOString(),
    keyId: privateJwk.kid,
    deviceId,
  };
  const header = { alg: 'ES256', typ: 'JWT', kid: privateJwk.kid };
  const signingInput = `${encodedJson(header)}.${encodedJson(payload)}`;
  const signingKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(signingInput)));
  const token = `${signingInput}.${base64Url(signature)}`;

  const { error: auditError } = await service.from('offline_grant_audit').insert({
    user_id: profile.id,
    key_id: privateJwk.kid,
    device_hash: await sha256(deviceId),
    content_package: scope,
    content_version: manifest.version,
    issued_at: now.toISOString(),
    valid_until: validUntil.toISOString(),
  });
  if (auditError) return json({ error: 'grant_audit_failed' }, 503, origin);
  return json({ token }, 200, origin);
});
