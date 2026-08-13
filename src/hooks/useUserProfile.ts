import { useEffect, useState } from 'react';
import { withDeadline } from '../domain/asyncDeadline';
import { loadUserProfile, saveUserProfile, type UserProfile } from '../storage/database';

const LOCAL_HYDRATION_TIMEOUT_MS = 4_000;

export function useUserProfile(): [UserProfile | null, React.Dispatch<React.SetStateAction<UserProfile | null>>, boolean, string | null] {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    withDeadline(loadUserProfile(), LOCAL_HYDRATION_TIMEOUT_MS, 'Místní profil neodpovídá.')
      .then(setProfile)
      .catch(() => setError('Profil se nepodařilo načíst z tohoto zařízení.'))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || !profile) return;
    saveUserProfile(profile).catch(() => setError('Profil se nepodařilo uložit do tohoto zařízení.'));
  }, [hydrated, profile]);

  return [profile, setProfile, hydrated, error];
}
