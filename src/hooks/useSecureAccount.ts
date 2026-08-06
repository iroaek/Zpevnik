import { useCallback, useEffect, useState } from 'react';
import {
  getSecureSession,
  loadSecureProfile,
  secureAccessConfigured,
  secureAccessConfigurationError,
  secureAccessRequired,
  subscribeToSecureSession,
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

  return { enabled, required: secureAccessRequired, hydrated, session, profile, error, passwordRecovery, refresh, finishPasswordRecovery: () => setPasswordRecovery(false) };
}
