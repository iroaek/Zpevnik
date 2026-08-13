export class AsyncDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AsyncDeadlineError';
  }
}

/**
 * Zabrání tomu, aby poškozené nebo jiným oknem blokované úložiště drželo
 * celou PWA navždy na startovací obrazovce. Původní operace může doběhnout,
 * její pozdní výsledek už ale nerozhoduje o aktuálním vykreslení.
 */
export function withDeadline<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new AsyncDeadlineError(message));
    }, timeoutMs);
    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}
