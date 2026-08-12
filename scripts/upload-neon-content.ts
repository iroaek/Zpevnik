import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const authUrl = argument('--auth-url')?.replace(/\/+$/, '') ?? process.env.NEON_AUTH_URL?.replace(/\/+$/, '') ?? '';
const dataApiUrl = argument('--data-api-url')?.replace(/\/+$/, '') ?? process.env.NEON_DATA_API_URL?.replace(/\/+$/, '') ?? '';
const origin = argument('--origin') ?? process.env.NEON_APP_ORIGIN ?? 'https://iroaek.github.io';
const email = process.env.NEON_MIGRATION_EMAIL?.trim() ?? '';
const password = process.env.NEON_MIGRATION_PASSWORD ?? '';

if (!authUrl || !dataApiUrl || !email || !password) {
  throw new Error('Doplňte NEON_AUTH_URL, NEON_DATA_API_URL, NEON_MIGRATION_EMAIL a NEON_MIGRATION_PASSWORD. Tajné údaje nezapisujte do repozitáře.');
}

interface Manifest {
  schemaVersion: 1;
  scope: 'admin' | 'members';
  version: string;
  generatedAt: string;
  songCount: number;
  contentBytes: number;
  packageBytes: number;
  sha256: string;
}

async function signIn(): Promise<string> {
  const response = await fetch(`${authUrl}/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password, callbackURL: `${origin}/Zpevnik/` }),
  });
  if (!response.ok) throw new Error(`Neon Auth přihlášení selhalo (${response.status}).`);
  const cookies = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  if (!cookies) throw new Error('Neon Auth nevrátil session cookie.');
  const tokenResponse = await fetch(`${authUrl}/token`, { headers: { Cookie: cookies, Origin: origin } });
  const tokenData = await tokenResponse.json() as { token?: unknown };
  if (!tokenResponse.ok || typeof tokenData.token !== 'string') throw new Error(`Neon Auth nevydal Data API token (${tokenResponse.status}).`);
  return tokenData.token;
}

async function api(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${dataApiUrl}/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as unknown : null;
  if (!response.ok) {
    const message = data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string'
      ? (data as { message: string }).message
      : `HTTP ${response.status}`;
    throw new Error(`Neon Data API: ${message}`);
  }
  return data;
}

async function assertStagingAdmin(token: string): Promise<void> {
  const allowed = await api(token, 'rpc/is_app_admin', {
    method: 'POST',
    body: '{}',
  });
  if (allowed !== true) {
    throw new Error('Přihlášený Neon účet nemá podle databázové RLS administrátorské oprávnění. Upload nebyl zahájen.');
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface StoredPackage {
  version: string;
  package_bytes: number;
  chunk_count: number;
  sha256: string;
  is_active: boolean;
}

interface StoredChunk {
  chunk_index: number;
  byte_size: number;
  sha256: string;
  data_base64: string;
}

async function verifyPackage(token: string, scope: 'admin' | 'members', manifest: Manifest): Promise<void> {
  const packages = await api(token, `content_packages?select=version,package_bytes,chunk_count,sha256,is_active&scope=eq.${scope}&version=eq.${manifest.version}&limit=1`) as StoredPackage[];
  const stored = packages[0];
  if (!stored?.is_active || stored.sha256 !== manifest.sha256 || stored.package_bytes !== manifest.packageBytes) {
    throw new Error(`${scope}: aktivní metadata balíčku v Neon neodpovídají manifestu.`);
  }
  const chunks = await api(token, `content_package_chunks?select=chunk_index,byte_size,sha256,data_base64&scope=eq.${scope}&version=eq.${manifest.version}&order=chunk_index.asc`) as StoredChunk[];
  if (chunks.length !== stored.chunk_count) {
    throw new Error(`${scope}: očekáváno ${stored.chunk_count} částí, Data API vrátilo ${chunks.length}.`);
  }
  const bytes = chunks.map((chunk, index) => {
    const data = Buffer.from(chunk.data_base64, 'base64');
    if (chunk.chunk_index !== index || chunk.byte_size !== data.byteLength || chunk.sha256 !== sha256(data)) {
      throw new Error(`${scope}: část ${index} neprošla kontrolou integrity.`);
    }
    return data;
  });
  const reconstructed = Buffer.concat(bytes);
  if (reconstructed.byteLength !== manifest.packageBytes || sha256(reconstructed) !== manifest.sha256) {
    throw new Error(`${scope}: znovu sestavený balíček neodpovídá lokálnímu manifestu.`);
  }
  console.log(`${scope}: ověřeno stažení ${chunks.length} částí a SHA-256 přes oprávněné Neon Data API.`);
}

async function uploadPackage(token: string, scope: 'admin' | 'members'): Promise<void> {
  const baseName = scope === 'admin' ? 'admin-library' : 'member-library';
  const [packageBuffer, manifestText] = await Promise.all([
    readFile(resolve('tmp', 'private-library', `${baseName}.json`)),
    readFile(resolve('tmp', 'private-library', `${baseName}.manifest.json`), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText) as Manifest;
  if (manifest.scope !== scope || manifest.packageBytes !== packageBuffer.byteLength || manifest.sha256 !== sha256(packageBuffer)) {
    throw new Error(`Manifest ${scope} balíčku neodpovídá souboru.`);
  }

  const active = await api(token, `content_packages?select=version,sha256&scope=eq.${scope}&is_active=eq.true&limit=1`) as Array<{ version?: string; sha256?: string }>;
  if (active[0]?.version === manifest.version && active[0]?.sha256 === manifest.sha256) {
    console.log(`${scope}: verze ${manifest.version} už je aktivní; upload není potřeba.`);
    await verifyPackage(token, scope, manifest);
    return;
  }

  const chunkSize = 256 * 1024;
  const chunkCount = Math.ceil(packageBuffer.byteLength / chunkSize);
  const revision = await api(token, `content_packages?select=version,sha256,is_active&scope=eq.${scope}&version=eq.${manifest.version}&limit=1`) as Array<{ version?: string; sha256?: string; is_active?: boolean }>;
  if (revision[0] && revision[0].sha256 !== manifest.sha256) {
    throw new Error(`${scope}: existující revize ${manifest.version} má jiný SHA-256; upload byl zastaven.`);
  }
  if (!revision[0]) {
    await api(token, 'content_packages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        scope,
        version: manifest.version,
        manifest,
        package_bytes: packageBuffer.byteLength,
        chunk_count: chunkCount,
        sha256: manifest.sha256,
        is_active: false,
      }),
    });
  }
  await api(token, `content_package_chunks?scope=eq.${scope}&version=eq.${manifest.version}`, { method: 'DELETE' });
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunk = packageBuffer.subarray(chunkIndex * chunkSize, Math.min((chunkIndex + 1) * chunkSize, packageBuffer.byteLength));
    await api(token, 'content_package_chunks', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        scope,
        version: manifest.version,
        chunk_index: chunkIndex,
        byte_size: chunk.byteLength,
        sha256: sha256(chunk),
        data_base64: chunk.toString('base64'),
      }),
    });
  }
  await api(token, 'rpc/activate_content_package', {
    method: 'POST',
    body: JSON.stringify({ target_scope: scope, target_version: manifest.version }),
  });
  console.log(`${scope}: aktivována verze ${manifest.version}, ${manifest.songCount} písní, ${packageBuffer.byteLength} B.`);
  await verifyPackage(token, scope, manifest);
}

const token = await signIn();
await assertStagingAdmin(token);
await uploadPackage(token, 'members');
await uploadPackage(token, 'admin');
