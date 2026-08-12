import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadAllProfiles,
  loadSongCorrections,
  reviewSongCorrection,
  type SecureProfile,
  type SongCorrection,
} from '../auth/secureAccess';
import { friendlyError } from '../ui/friendlyError';
import { Icon } from '../ui/Icon';

type CorrectionFilter = 'pending' | 'history' | 'all';

const statusLabel: Record<SongCorrection['status'], string> = {
  pending: 'Čeká', accepted: 'Přijato', rejected: 'Zamítnuto', rolled_back: 'Vráceno',
};

export function AdminCorrectionsPanel() {
  const [corrections, setCorrections] = useState<SongCorrection[]>([]);
  const [profiles, setProfiles] = useState<SecureProfile[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<CorrectionFilter>('pending');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({ id: '', proposedValue: '', adminNote: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextCorrections, nextProfiles] = await Promise.all([loadSongCorrections(), loadAllProfiles()]);
      setCorrections(nextCorrections);
      setProfiles(nextProfiles);
      setSelectedId((current) => current && nextCorrections.some((item) => item.id === current) ? current : nextCorrections[0]?.id ?? '');
      setMessage('');
    } catch (error) {
      setMessage(friendlyError(error, 'Centrum oprav se nepodařilo načíst. Ověřte, že je na Neonu použita nejnovější migrace.'));
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);

  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.display_name])), [profiles]);
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('cs');
    return corrections.filter((item) => {
      const matchesFilter = filter === 'all' || (filter === 'pending' ? item.status === 'pending' : item.status !== 'pending');
      const haystack = `${item.song_title} ${item.song_id} ${profileNames.get(item.user_id) ?? ''}`.toLocaleLowerCase('cs');
      return matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [corrections, filter, profileNames, query]);
  const selected = corrections.find((item) => item.id === selectedId) ?? visible[0];

  const editedValue = selected && draft.id === selected.id ? draft.proposedValue : selected?.proposed_value ?? '';
  const adminNote = selected && draft.id === selected.id ? draft.adminNote : selected?.admin_note ?? '';

  const decide = async (decision: 'accepted' | 'rejected' | 'pending') => {
    if (!selected) return;
    setBusy(true);
    try {
      await reviewSongCorrection({ id: selected.id, decision, note: adminNote, proposedValue: editedValue });
      await refresh();
      setDraft({ id: '', proposedValue: '', adminNote: '' });
      setMessage(decision === 'accepted' ? 'Oprava byla přijata a zapsána do historie.' : decision === 'rejected' ? 'Návrh byl zamítnut a zapsán do historie.' : 'Rozhodnutí bylo vráceno; auditní historie zůstala zachována.');
    } catch (error) {
      setMessage(friendlyError(error, 'Rozhodnutí se nepodařilo uložit.'));
    } finally {
      setBusy(false);
    }
  };

  return <section className="admin-corrections" aria-labelledby="admin-corrections-heading">
    <header className="admin-panel-heading"><span><p className="eyebrow">Kontrola kvality</p><h2 id="admin-corrections-heading">Centrum oprav</h2><p>Porovnání původní a navržené hodnoty, rozhodnutí a úplná auditní historie.</p></span><button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}><Icon name="sync" />Obnovit</button></header>
    <div className="admin-correction-toolbar"><label><span className="visually-hidden">Hledat opravu</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Píseň, ID nebo člen…" /></label><div role="group" aria-label="Filtr oprav">{([['pending', `Čekající (${corrections.filter((item) => item.status === 'pending').length})`], ['history', 'Historie'], ['all', 'Vše']] as const).map(([value, label]) => <button type="button" key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
    {message && <p className={message.includes('nepodařilo') ? 'error-message' : 'info-message'} role="status">{message}</p>}
    <div className="admin-correction-workspace">
      <div className="admin-correction-list" aria-label="Návrhy oprav">{visible.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setDraft({ id: item.id, proposedValue: item.proposed_value, adminNote: item.admin_note }); }}><span><strong>{item.song_title}</strong><small>{profileNames.get(item.user_id) ?? 'Neznámý člen'} · {new Date(item.created_at).toLocaleDateString('cs-CZ')}</small></span><span className={`status-badge status-badge--${item.status}`}>{statusLabel[item.status]}</span></button>)}{visible.length === 0 && <p className="empty-state">V tomto filtru nejsou žádné návrhy.</p>}</div>
      {selected ? <article className="admin-correction-detail"><header><span><small>{selected.song_id}</small><h3>{selected.song_title}</h3><p>Navrhl {profileNames.get(selected.user_id) ?? 'neznámý člen'}.</p></span><span className={`status-badge status-badge--${selected.status}`}>{statusLabel[selected.status]}</span></header><div className="correction-diff" aria-label="Porovnání opravy"><div><small>Původní</small><strong>{selected.original_value || 'Bez konkrétní hodnoty'}</strong></div><div><small>Návrh</small><input value={editedValue} maxLength={160} onChange={(event) => setDraft({ id: selected.id, proposedValue: event.target.value, adminNote })} placeholder="Navržená hodnota" /></div></div><blockquote>{selected.note}</blockquote><label>Poznámka administrátora<textarea value={adminNote} maxLength={2000} onChange={(event) => setDraft({ id: selected.id, proposedValue: editedValue, adminNote: event.target.value })} placeholder="Důvod rozhodnutí nebo úpravy…" /></label><div className="button-row"><button type="button" className="primary-button" disabled={busy} onClick={() => void decide('accepted')}>Přijmout</button><button type="button" className="danger-button" disabled={busy} onClick={() => void decide('rejected')}>Zamítnout</button>{selected.status !== 'pending' && <button type="button" className="secondary-button" disabled={busy} onClick={() => void decide('pending')}>Vrátit rozhodnutí</button>}</div><details className="correction-history"><summary>Historie ({selected.history.length})</summary>{selected.history.length === 0 ? <p>Bez předchozího rozhodnutí.</p> : <ol>{[...selected.history].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}><strong>{entry.from} → {entry.to}</strong><small>{new Date(entry.at).toLocaleString('cs-CZ')} · {profileNames.get(entry.by) ?? entry.by}</small>{entry.note && <p>{entry.note}</p>}</li>)}</ol>}</details></article> : <p className="empty-state">Vyberte návrh opravy.</p>}
    </div>
  </section>;
}
