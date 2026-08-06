import { useEffect, useState } from 'react';
import { loadUserProfile, saveUserProfile, type UserProfile } from '../storage/database';

export function useUserProfile(): [UserProfile | null, React.Dispatch<React.SetStateAction<UserProfile | null>>, boolean, string | null] {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUserProfile()
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
