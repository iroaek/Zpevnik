import { useRef, useState } from 'react';
import type { ChordNotation } from '../domain/chords';
import type { Song } from '../domain/song';
import { removePersonalSong, savePersonalSongs } from '../storage/database';

interface PdfImportPageProps {
  allSongs: Song[];
  deviceSongs: Song[];
  defaultNotation: ChordNotation;
  onLibraryChanged: () => Promise<void>;
  onOpenSong: (id: string) => void;
}

function normalizedTitle(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function PdfImportPage({ allSongs, deviceSongs, defaultNotation, onLibraryChanged, onOpenSong }: PdfImportPageProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notation, setNotation] = useState<ChordNotation>(defaultNotation);
  const [chordsVerified, setChordsVerified] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fileName: string; page: number; totalPages: number } | null>(null);
  const [message, setMessage] = useState('');
  const [firstImportedId, setFirstImportedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage('');
    setFirstImportedId(null);
    if (files.length > 5) {
      setMessage('Najednou lze zpracovat nejvýše 5 PDF souborů.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setBusy(true);
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    let firstId: string | null = null;
    const knownTitles = new Set(allSongs.map((song) => normalizedTitle(song.title)));
    try {
      const { importPdfFile } = await import('../domain/pdfImport');
      for (const file of Array.from(files)) {
        const result = await importPdfFile(file, { sourceNotation: notation, chordsVerified }, setProgress);
        for (const entry of result.entries) {
          const titleKey = normalizedTitle(entry.song.title);
          if (knownTitles.has(titleKey)) {
            entry.song.reviewFlags = ['possible_duplicate'];
            duplicates += 1;
          }
          knownTitles.add(titleKey);
        }
        await savePersonalSongs(result.entries);
        if (!firstId && result.entries[0]) firstId = result.entries[0].song.id;
        imported += result.entries.length;
        skipped += result.skippedPages;
      }
      await onLibraryChanged();
      setFirstImportedId(firstId);
      setMessage(`Import dokončen: ${imported} osobních konceptů, ${skipped} prázdných stran přeskočeno${duplicates ? `, ${duplicates} možných duplicit označeno` : ''}.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Import se nezdařil: ${error.message}` : 'Import se nezdařil.');
    } finally {
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (songId: string) => {
    await removePersonalSong(songId);
    setConfirmDelete(null);
    await onLibraryChanged();
    setMessage('Osobní píseň byla odstraněna pouze z tohoto zařízení.');
  };

  const recentDeviceSongs = [...deviceSongs].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 20);

  return (
    <section className="pdf-import-page" aria-labelledby="pdf-import-heading">
      <p className="eyebrow">Pouze ve vašem zařízení</p>
      <h1 id="pdf-import-heading">Vložit PDF s akordy</h1>
      <p className="lead">PDF se přečte přímo v prohlížeči, nic se neodesílá. Každá textová stránka se uloží jako samostatný osobní koncept v interním formátu ChordPro.</p>

      <section className="pdf-import-card" aria-label="Nastavení importu PDF">
        <label>Značení akordů v PDF
          <select value={notation} disabled={busy} onChange={(event) => setNotation(event.target.value as ChordNotation)}>
            <option value="czech">České (H / B)</option>
            <option value="international">Mezinárodní (B / Bb)</option>
          </select>
        </label>
        <label className="switch-row"><input type="checkbox" checked={chordsVerified} disabled={busy} onChange={(event) => setChordsVerified(event.target.checked)} /> Akordy v PDF jsou zkontrolované</label>
        <p className="score-note">Rozpoznané samostatné řádky akordů se vloží nad odpovídající slabiky. Poté funguje barva akordů, transpozice i návrhy kapodastru.</p>
        <label className={busy ? 'primary-button file-button disabled' : 'primary-button file-button'}>
          {busy ? 'Zpracovávám PDF…' : 'Vybrat PDF ze zařízení'}
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(event) => void importFiles(event.target.files)} />
        </label>
        <small>Nejvýše 5 souborů najednou, 80 MB a 800 stran na soubor. Obrázkové skeny bez textové vrstvy vyžadují nejprve OCR.</small>
      </section>

      {progress && <div className="download-progress" aria-live="polite"><div className="results-heading"><strong>{progress.fileName}</strong><span>{progress.page}/{progress.totalPages}</span></div><progress max={progress.totalPages} value={progress.page} /><small>Převádím stránku do ChordPro…</small></div>}
      {message && <p className={message.includes('nezdař') || message.includes('nejvýše') ? 'error-message' : 'success-message'} role="status">{message}</p>}
      {firstImportedId && <button type="button" className="primary-button" onClick={() => onOpenSong(firstImportedId)}>Otevřít první importovanou píseň</button>}

      <section className="device-library" aria-labelledby="device-library-heading">
        <div className="results-heading"><h2 id="device-library-heading">Uložené v tomto zařízení</h2><span>{deviceSongs.length}</span></div>
        {recentDeviceSongs.length === 0 ? <p className="empty-state">Z mobilu zatím nebylo importováno žádné PDF.</p> : (
          <div className="device-song-list">
            {recentDeviceSongs.map((song) => (
              <article key={song.id}>
                <button type="button" className="device-song-open" onClick={() => onOpenSong(song.id)}><strong>{song.title}</strong><span>{song.authors.join(', ') || 'Autor neuveden'}</span></button>
                {confirmDelete === song.id
                  ? <span className="device-song-confirm"><button type="button" className="danger-button" onClick={() => void remove(song.id)}>Potvrdit</button><button type="button" className="secondary-button" onClick={() => setConfirmDelete(null)}>Zrušit</button></span>
                  : <button type="button" className="icon-button" aria-label={`Odstranit ${song.title} z tohoto zařízení`} onClick={() => setConfirmDelete(song.id)}>×</button>}
              </article>
            ))}
          </div>
        )}
        {deviceSongs.length > recentDeviceSongs.length && <p className="last-update">Zobrazeno posledních {recentDeviceSongs.length}; všechny importované písně najdete v části Písně.</p>}
      </section>
    </section>
  );
}
