// Cancels work synchronously at an intentional account transition. The durable
// revision in IndexedDB additionally orders writes from different tabs.
let controller = new AbortController();
export function authWorkSignal(): AbortSignal { return controller.signal; }
export function cancelAuthWork(): void {
  controller.abort();
  controller = new AbortController();
}
export function assertAuthWork(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Ověření účtu bylo zrušeno.', 'AbortError');
}

export async function authFetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const signals = [authWorkSignal(), options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  for (const signal of signals) { assertAuthWork(signal); signal.addEventListener('abort', abort, { once: true }); }
  const timer = setTimeout(abort, 8_000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); for (const signal of signals) signal.removeEventListener('abort', abort); }
}
