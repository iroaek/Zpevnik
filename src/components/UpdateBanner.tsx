import { useState } from 'react';

export function UpdateBanner({ onUpdate, onLater }: { onUpdate: () => void | Promise<void>; onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const install = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onUpdate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Aktualizaci se nepodařilo aktivovat.');
      setBusy(false);
    }
  };
  return <aside className="update-banner" role="status" aria-live="polite" aria-busy={busy}><div><strong>{busy ? 'Bezpečně přepínám na novou verzi…' : 'Je dostupná nová verze zpěvníku.'}</strong><span>{busy ? 'Počkejte na automatické znovunačtení. Místní data zůstanou zachovaná.' : 'Oblíbené, setlisty a nastavení zůstanou zachované.'}</span>{error && <small role="alert">{error}</small>}</div><div><button type="button" className="primary-button" disabled={busy} onClick={() => void install()}>{busy ? 'Aktualizuji…' : 'Aktualizovat nyní'}</button><button type="button" className="secondary-button" disabled={busy} onClick={onLater}>Později</button></div></aside>;
}
