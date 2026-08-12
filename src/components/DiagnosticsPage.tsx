import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearDiagnostics, loadDiagnostics, type DiagnosticEvent } from '../storage/database';
import { Icon } from '../ui/Icon';

interface DeviceDiagnostics {
  online: boolean;
  serviceWorker: 'active' | 'available' | 'unsupported';
  storageUsage: number | null;
  storageQuota: number | null;
  standalone: boolean;
  userAgent: string;
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Neznámé';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

async function inspectDevice(): Promise<DeviceDiagnostics> {
  let estimate: StorageEstimate | undefined;
  try { estimate = await navigator.storage?.estimate?.(); } catch { estimate = undefined; }
  const standalone = (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return {
    online: navigator.onLine,
    serviceWorker: !navigator.serviceWorker ? 'unsupported' : navigator.serviceWorker.controller ? 'active' : 'available',
    storageUsage: estimate?.usage ?? null,
    storageQuota: estimate?.quota ?? null,
    standalone,
    userAgent: navigator.userAgent,
  };
}

export function DiagnosticsPage({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [device, setDevice] = useState<DeviceDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextEvents, nextDevice] = await Promise.all([loadDiagnostics(), inspectDevice()]);
      setEvents(nextEvents);
      setDevice(nextDevice);
      setError(null);
    } catch {
      setError('Diagnostiku se nepodařilo načíst.');
    }
  }, []);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(firstLoad);
  }, [refresh]);

  const counts = useMemo(() => ({
    error: events.filter((event) => event.level === 'error').length,
    warning: events.filter((event) => event.level === 'warning').length,
    info: events.filter((event) => event.level === 'info').length,
  }), [events]);

  const exportDiagnostics = () => {
    if (!device) return;
    const payload = JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      app: { catalogRoute: location.pathname, online: device.online, serviceWorker: device.serviceWorker, standalone: device.standalone },
      storage: { usage: device.storageUsage, quota: device.storageQuota },
      browser: device.userAgent,
      events,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `zpevnik-diagnostika-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const removeEvents = async () => {
    try {
      await clearDiagnostics();
      setEvents([]);
      setConfirmClear(false);
    } catch {
      setError('Diagnostické záznamy se nepodařilo odstranit.');
    }
  };

  return (
    <section className="info-page diagnostics-page" aria-labelledby="diagnostics-heading">
      <p className="eyebrow">Soukromě v zařízení</p>
      <h1 id="diagnostics-heading">Diagnostika provozu</h1>
      <p className="lead">Pomáhá zjistit potíže s přihlášením, synchronizací, úložištěm a PWA. Nic se nikam neodesílá; export vytvoříte pouze ručně.</p>

      <div className="diagnostics-toolbar">
        <button type="button" className="secondary-button" onClick={onBack}><Icon name="back" />Zpět do nastavení</button>
        <button type="button" className="secondary-button" onClick={() => void refresh()}><Icon name="sync" />Obnovit</button>
        <button type="button" className="primary-button" disabled={!device} onClick={exportDiagnostics}><Icon name="download" />Exportovat pro podporu</button>
      </div>

      {error && <p className="error-message" role="alert">{error}</p>}

      <div className="diagnostics-summary" aria-label="Souhrn diagnostiky">
        <article><Icon name={device?.online ? 'wifi' : 'cloud'} /><span><small>Připojení</small><strong>{device?.online ? 'Online' : 'Offline'}</strong></span></article>
        <article><Icon name="shield" /><span><small>Offline jádro</small><strong>{device?.serviceWorker === 'active' ? 'Aktivní' : device?.serviceWorker === 'available' ? 'Připravené po obnovení' : 'Nepodporované'}</strong></span></article>
        <article><Icon name="database" /><span><small>Využití úložiště</small><strong>{formatBytes(device?.storageUsage ?? null)} / {formatBytes(device?.storageQuota ?? null)}</strong></span></article>
        <article><Icon name="alert" /><span><small>Záznamy</small><strong>{counts.error} chyb · {counts.warning} upozornění · {counts.info} informací</strong></span></article>
      </div>

      <div className="results-heading diagnostics-events-heading"><h2>Poslední události</h2><span>Nejvýše 200 záznamů</span></div>
      <div className="diagnostics-list" aria-live="polite">
        {events.map((event) => <article className={`diagnostic-event diagnostic-event--${event.level}`} key={event.id}><span><strong>{event.event}</strong><small>{event.category} · {event.level}</small></span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('cs-CZ')}</time></article>)}
        {events.length === 0 && !error && <p className="empty-state">Zatím nebyla zaznamenána žádná diagnostická událost.</p>}
      </div>

      <details className="danger-zone diagnostics-danger" open={confirmClear} onToggle={(event) => setConfirmClear(event.currentTarget.open)}>
        <summary>Správa místních záznamů</summary>
        <div className="danger-zone__content"><span><strong>Vymazat diagnostiku</strong><p>Tím se odstraní pouze provozní záznamy z tohoto zařízení. Písně, přihlášení ani setlisty zůstanou zachované.</p></span><button type="button" className="danger-button" disabled={events.length === 0} onClick={() => void removeEvents()}><Icon name="trash" />Vymazat záznamy</button></div>
      </details>
    </section>
  );
}
