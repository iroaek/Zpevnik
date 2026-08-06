import type { SecureProfile } from '../auth/secureAccess';

export const ONLINE_THRESHOLD_MS = 2 * 60 * 1_000;

export function isProfileOnline(profile: SecureProfile, now = Date.now()): boolean {
  if (!profile.last_seen_at) return false;
  const lastSeen = new Date(profile.last_seen_at).getTime();
  return Number.isFinite(lastSeen) && now - lastSeen <= ONLINE_THRESHOLD_MS;
}
