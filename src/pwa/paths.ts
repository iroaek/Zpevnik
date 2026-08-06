export const APP_BASE_PATH = import.meta.env.BASE_URL;
export const PUBLIC_BASE_URL = import.meta.env.VITE_PUBLIC_BASE_URL || `${window.location.origin}${APP_BASE_PATH}`;

export function resolvePublicPath(relativePath: string): string {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const clean = relativePath.replace(/^\/+/, '');
  return new URL(`${APP_BASE_PATH}${clean}`.replace(/\/{2,}/g, '/'), window.location.origin).toString();
}

export function routePath(relativePath = ''): string {
  const clean = relativePath.replace(/^\/+|\/+$/g, '');
  return clean ? `${APP_BASE_PATH}${clean}`.replace(/\/{2,}/g, '/') : APP_BASE_PATH;
}

export function canonicalUrl(relativePath = ''): string {
  return new URL(relativePath.replace(/^\/+/, ''), PUBLIC_BASE_URL.endsWith('/') ? PUBLIC_BASE_URL : `${PUBLIC_BASE_URL}/`).toString();
}

export function relativeRoute(pathname: string): string {
  const normalizedBase = APP_BASE_PATH.endsWith('/') ? APP_BASE_PATH : `${APP_BASE_PATH}/`;
  const withoutBase = pathname.startsWith(normalizedBase) ? pathname.slice(normalizedBase.length) : pathname.replace(/^\/+/, '');
  return withoutBase.replace(/^\/+|\/+$/g, '');
}
