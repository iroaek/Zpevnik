import { useCallback, useEffect, useState } from 'react';
import { defaultUserState, loadUserState, saveUserState, type UserState } from '../storage/database';

export function useUserState(): [UserState, React.Dispatch<React.SetStateAction<UserState>>, boolean, string | null] {
  const [state, setState] = useState<UserState>(defaultUserState);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadUserState()
      .then((stored) => setState(stored))
      .catch(() => setError('Místní data se nepodařilo načíst; používá se dočasné výchozí nastavení.'))
      .finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveUserState(state).catch(() => setError('Změny se nepodařilo uložit do místního úložiště.'));
  }, [hydrated, state]);

  const updateState = useCallback<React.Dispatch<React.SetStateAction<UserState>>>((change) => {
    setState((current) => {
      const next = typeof change === 'function' ? change(current) : change;
      if (next === current) return current;
      return { ...next, schemaVersion: 3, updatedAt: new Date().toISOString() };
    });
  }, []);

  return [state, updateState, hydrated, error];
}
