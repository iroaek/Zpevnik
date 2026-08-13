export async function storagePersistenceState(): Promise<boolean | null> {
  if (!navigator.storage?.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  const current = await storagePersistenceState();
  if (current === true || !navigator.storage?.persist) return current;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
