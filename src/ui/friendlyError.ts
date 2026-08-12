const replacements: Array<[RegExp, string]> = [
  [/invalid otp|otp.*invalid/i, 'Ověřovací kód není platný nebo už vypršel. Vyžádejte si nový kód.'],
  [/authentication required|not authenticated|unauthenticated/i, 'Přihlášení vypršelo. Připojte se k internetu a přihlaste se znovu.'],
  [/approved member access required|access denied|permission denied|42501/i, 'K této akci nemáte oprávnění. Obnovte oprávnění účtu nebo kontaktujte administrátora.'],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Server je momentálně nedostupný. Zkontrolujte připojení a zkuste to znovu.'],
  [/timeout|timed out/i, 'Server neodpověděl včas. Zkuste akci za chvíli znovu.'],
  [/undefined is not a function|is not a function/i, 'Tuto operaci zařízení nedokončilo. Aktualizujte aplikaci a zkuste to znovu.'],
  [/invalid input syntax|invalid format|validation/i, 'Odeslané údaje nejsou v očekávaném formátu. Zkontrolujte je a zkuste to znovu.'],
];

export function friendlyError(error: unknown, fallback = 'Akci se nepodařilo dokončit. Zkuste to znovu.'): string {
  const source = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = source.replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const translated = replacements.find(([pattern]) => pattern.test(cleaned));
  if (translated) return translated[1];
  if (/^[{[]|\b(code|details|hint|stack|sqlstate)\b/i.test(cleaned) || cleaned.length > 240) return fallback;
  return cleaned;
}
