export function describePdfImportError(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const normalized = detail.toLocaleLowerCase('cs');
  if (normalized.includes('password') || normalized.includes('hesl')) {
    return 'PDF je chráněné heslem. Uložte prosím nechráněnou kopii a zkuste ji znovu.';
  }
  if (normalized.includes('invalid pdf') || normalized.includes('invalidpdf') || normalized.includes('poškoz')) {
    return 'Soubor není platné PDF nebo je poškozený.';
  }
  if (normalized.includes('out of memory') || normalized.includes('allocation failed')) {
    return 'Telefon nemá pro toto PDF dostatek volné paměti. Rozdělte soubor na menší části.';
  }
  if (normalized.includes('undefined is not a function') || normalized.includes('is not a function')) {
    return 'Telefon používá starou nekompatibilní verzi aplikace. V části Offline zkontrolujte aktualizaci, aplikaci zavřete a znovu otevřete.';
  }
  return detail || 'PDF se nepodařilo přečíst.';
}
