import { useEffect, useRef, useState } from 'react';
import { loadSongSubmissions, saveSongSubmission, type SongSubmission, type UserProfile } from '../storage/database';

interface SongContributionProps {
  userProfile: UserProfile;
}

export function SongContribution({ userProfile }: SongContributionProps) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [submissions, setSubmissions] = useState<SongSubmission[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => setSubmissions(await loadSongSubmissions());
  useEffect(() => {
    let active = true;
    loadSongSubmissions().then((stored) => { if (active) setSubmissions(stored); });
    return () => { active = false; };
  }, []);

  const save = async (kind: 'request' | 'upload') => {
    setBusy(true);
    setMessage('');
    try {
      await saveSongSubmission({ profile: userProfile, kind, title, artist, notes, file: kind === 'upload' ? file : undefined });
      await refresh();
      setTitle('');
      setArtist('');
      setNotes('');
      setFile(undefined);
      setRightsConfirmed(false);
      if (uploadRef.current) uploadRef.current.value = '';
      setMessage(kind === 'upload' ? 'Soubor je uložený ve frontě ke kontrole.' : 'Žádost je uložená ve frontě ke kontrole.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Návrh se nepodařilo uložit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="contribution-section" aria-labelledby="contribution-heading">
      <p className="eyebrow">Komunitní návrhy</p>
      <h2 id="contribution-heading">Nahrát nebo vyžádat píseň</h2>
      <p>Položky se nejprve uloží do fronty pod přezdívkou <strong>{userProfile.displayName}</strong>. Bez ověření práv a schválení správce se nikdy nezveřejní.</p>
      <div className="contribution-grid">
        <form className="contribution-card" onSubmit={(event) => { event.preventDefault(); void save('request'); }}>
          <h3>Vyžádat přidání</h3>
          <label>Název písně<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Interpret nebo autor<input maxLength={160} value={artist} onChange={(event) => setArtist(event.target.value)} /></label>
          <label>Poznámka<textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button type="submit" className="secondary-button" disabled={busy || !title.trim()}>Uložit žádost</button>
        </form>
        <form className="contribution-card" onSubmit={(event) => { event.preventDefault(); void save('upload'); }}>
          <h3>Nahrát vlastní podklad</h3>
          <label>Název písně<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Interpret nebo autor<input maxLength={160} value={artist} onChange={(event) => setArtist(event.target.value)} /></label>
          <label className="secondary-button file-button">{file ? file.name : 'Vybrat PDF, ChordPro nebo TXT'}<input ref={uploadRef} type="file" accept="application/pdf,.pdf,.cho,.chordpro,text/plain,.txt" onChange={(event) => setFile(event.target.files?.[0])} /></label>
          <label className="switch-row contribution-rights"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> Potvrzuji, že soubor smím předat správci ke kontrole.</label>
          <button type="submit" className="primary-button" disabled={busy || !title.trim() || !file || !rightsConfirmed}>Uložit do fronty</button>
        </form>
      </div>
      {message && <p role="status" className={message.includes('nepodařilo') || message.includes('větší') ? 'error-message' : 'success-message'}>{message}</p>}
      <div className="submission-list"><strong>Fronta v tomto zařízení: {submissions.length}</strong>{submissions.slice(0, 5).map((submission) => <span key={submission.id}>{submission.kind === 'upload' ? 'Soubor' : 'Žádost'} · {submission.title} · čeká na odeslání</span>)}</div>
      <p className="score-note">Online odesílání bude aktivní po připojení zabezpečené serverové části. Do té doby fronta zůstává pouze v tomto zařízení.</p>
    </section>
  );
}
