import { useEffect, useState } from 'react';
import { loadDiagnostics, type DiagnosticEvent } from '../storage/database';

export function DiagnosticsPage({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDiagnostics().then(setEvents).catch(() => setError('Diagnostiku se nepodařilo načíst.'));
  }, []);

  return (
    <section className="info-page diagnostics-page" aria-labelledby="diagnostics-heading">
      <p className="eyebrow">Pouze vývoj</p>
      <h1 id="diagnostics-heading">Diagnostika offline provozu</h1>
      <p className="lead">Události neobsahují tokeny, hesla, texty písní ani podpisové klíče.</p>
      <button type="button" className="secondary-button" onClick={onBack}>Zpět do nastavení</button>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="diagnostics-list">
        {events.map((event) => <article key={event.id}><span><strong>{event.event}</strong><small>{event.category} · {event.level}</small></span><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString('cs-CZ')}</time></article>)}
        {events.length === 0 && !error && <p className="empty-state">Zatím nebyla zaznamenána žádná diagnostická událost.</p>}
      </div>
    </section>
  );
}
