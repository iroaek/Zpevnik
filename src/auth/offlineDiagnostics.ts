import { recordDiagnostic } from '../storage/database';
import { OfflineGrantValidationError } from './offlineGrant';

export type OfflineErrorCode = 'grant_missing' | 'grant_issue_failed' | 'grant_storage_failed' | 'grant_expired' | 'grant_signature_invalid' | 'verification_key_unavailable' | 'identity_mismatch' | 'shell_incomplete' | 'content_incomplete' | 'local_store_unavailable';
const messages: Record<OfflineErrorCode, string> = {
  grant_missing: 'V zařízení chybí offline oprávnění. Dokončete přípravu online.',
  grant_issue_failed: 'Server nevydal offline oprávnění. Zkuste to znovu po připojení.',
  grant_storage_failed: 'Oprávnění se nepodařilo uložit do tohoto zařízení.',
  grant_expired: 'Přístup offline vypršel. Obnovte jej připojením.',
  grant_signature_invalid: 'Podpis offline oprávnění není platný. Obnovte je online.',
  verification_key_unavailable: 'Ověřovací klíč není v zařízení dostupný. Obnovte oprávnění online.',
  identity_mismatch: 'Offline oprávnění neodpovídá tomuto účtu nebo zařízení.',
  shell_incomplete: 'Část souborů aplikace není uložená. Otevřete aktuální verzi online a zopakujte kontrolu.',
  content_incomplete: 'Některé texty a akordy nejsou úplně uložené. Dokončete stažení online.',
  local_store_unavailable: 'Místní úložiště neodpovídá. Zavřete ostatní okna zpěvníku a zkuste to znovu.',
};
export class OfflinePreparationError extends Error {
  constructor(public readonly code: OfflineErrorCode, public readonly status?: number) { super(messages[code]); this.name = 'OfflinePreparationError'; }
}
export function offlineError(error: unknown, fallback: OfflineErrorCode): OfflinePreparationError {
  if (error instanceof OfflinePreparationError) return error;
  if (error instanceof OfflineGrantValidationError) {
    const code = error.reason === 'expired' ? 'grant_expired' : error.reason === 'unknown-key' ? 'verification_key_unavailable' : error.reason === 'wrong-device' || error.reason === 'identity-mismatch' ? 'identity_mismatch' : error.reason === 'wrong-package' ? 'grant_issue_failed' : 'grant_signature_invalid';
    return new OfflinePreparationError(code);
  }
  const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return new OfflinePreparationError(fallback, status);
}
export function diagnoseOffline(phase: string, code: string, status?: number): void {
  // Fixed codes only. Never persist exception messages, claims or response bodies.
  void recordDiagnostic({ category: 'auth', event: code, level: code.endsWith('_valid') ? 'info' : 'warning', details: { phase, build: __BUILD_ID__, status: status ?? null } }).catch(() => undefined);
}
