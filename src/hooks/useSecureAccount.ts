import { useCallback, useEffect, useState } from 'react';
import {
  getSecureSession,
  loadSecureProfile,
  secureAccessConfigured,
  secureAccessConfigurationError,
  secureAccessRequired,
  subscribeToSecureSession,
  touchSecurePresence,
  type SecureProfile,
  type SecureSession,
} from '../auth/secureAccess';

export interface SecureAccountState {
  enabled: boolean;
  required: boolean;
  hydrated: boolean;
  session: SecureSession | null;
  profile: SecureProfile | null;
  error: string | null;
  passwordRecovery: boolean;
  refresh: () => Promise<void>;
  finishPasswordRecovery: () => void;
}

export function useSecureAccount(): SecureAccountState {
  const enabled = secureAccessConfigured;
  const [hydrated, setHydrated] = useState(!enabled);
  const [session, setSession] = useState<SecureSession | null>(null);
  const [profile, setProfile] = useState<SecureProfile | null>(null);
  const [error, setError] = useState<string | null>(secureAccessConfigurationError);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const nextSession = await getSecureSession();
      setSession(nextSession);
      setProfile(nextSession ? await loadSecureProfile() : null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Účet se nepodařilo ověřit.');
    } finally {
      setHydrated(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToSecureSession((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setHydrated(true);
      } else {
        window.setTimeout(() => void refresh(), 0);
      }
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled || !session) return;
    const refreshIfActive = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      void refresh();
    };
    const polling = window.setInterval(refreshIfActive, 2 * 60_000);
    window.addEventListener('focus', refreshIfActive);
    document.addEventListener('visibilitychange', refreshIfActive);
    return () => {
      window.clearInterval(polling);
      window.removeEventListener('focus', refreshIfActive);
      document.removeEventListener('visibilitychange', refreshIfActive);
    };
  }, [enabled, refresh, session]);

  useEffect(() => {
    if (!enabled || !session || !profile) return;
    const touchIfActive = () => {
      if (document.visibilityState === 'hidden' || !navigator.onLine) return;
      void touchSecurePresence().catch(() => undefined);
    };
    const firstTouch = window.setTimeout(touchIfActive, 0);
    const heartbeat = window.setInterval(touchIfActive, 60_000);
    document.addEventListener('visibilitychange', touchIfActive);
    window.addEventListener('online', touchIfActive);
    return () => {
      window.clearTimeout(firstTouch);
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', touchIfActive);
      window.removeEventListener('online', touchIfActive);
    };
  }, [enabled, profile, session]);

  return { enabled, required: secureAccessRequired, hydrated, session, profile, error, passwordRecovery, refresh, finishPasswordRecovery: () => setPasswordRecovery(false) };
}
