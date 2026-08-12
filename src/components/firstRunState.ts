const GUIDE_VERSION = 1;

export function firstRunGuideKey(userId: string): string {
  return `zpevnik:first-run:${userId}:v${GUIDE_VERSION}`;
}

export function hasCompletedFirstRunGuide(userId: string): boolean {
  try {
    return window.localStorage.getItem(firstRunGuideKey(userId)) === 'completed';
  } catch {
    return false;
  }
}

export function completeFirstRunGuide(userId: string): void {
  try {
    window.localStorage.setItem(firstRunGuideKey(userId), 'completed');
  } catch {
    // Průvodce nesmí zablokovat aplikaci ani při zakázaném localStorage.
  }
}
