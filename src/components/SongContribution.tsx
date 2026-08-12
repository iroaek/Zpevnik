import { useCallback, useEffect, useRef, useState } from 'react';
import { loadRemoteSongSubmissions, submitSecureSong, type SecureProfile } from '../auth/secureAccess';
import { loadSongSubmissions, saveSongSubmission, type SongSubmission, type UserProfile } from '../storage/database';
import { friendlyError } from '../ui/friendlyError';

interface SongContributionProps {
  userProfile: UserProfile;
  secureProfile?: SecureProfile | null;
  secureMode?: boolean;
}

interface SubmissionPreview {
  id: string;
  kind: 'request' | 'upload';
  title: string;
  status: string;
}

export function SongContribution({ userProfile, secureProfile = null, secureMode = false }: SongContributionProps) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | undefined>();
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionPreview[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (secureMode) {
      setSubmissions((await loadRemoteSongSubmissions()).map(({ id, kind, title, status }) => ({ id, kind, title, status })));
    } else {
      setSubmissions((await loadSongSubmissions()).map(({ id, kind, title, status }: SongSubmission) => ({ id, kind, title, status })));
    }
  }, [secureMode]);

  useEffect(() => {
    let active = true;
    const load = secureMode
      ? loadRemoteSongSubmissions().then((stored) => stored.map(({ id, kind, title, status }) => ({ id, kind, title, status })))
      : loadSongSubmissions().then((stored) => stored.map(({ id, kind, title, status }) => ({ id, kind, title, status })));
    load.then((stored) => { if (active) setSubmissions(stored); }).catch(() => { if (active) setMessage('Frontu návrhů se nepodařilo načíst.'); });
    return () => { active = false; };
  }, [secureMode]);

  const save = async (kind: 'request' | 'upload') => {
    setBusy(true);
    setMessage('');
    try {
      if (secureMode) {
        if (!secureProfile) throw new Error('Ověřený účet není dostupný. Přihlaste se znovu.');
        await submitSecureSong({ profile: secureProfile, kind, title, artist, notes, file: kind === 'upload' ? file : undefined });
      } else {
        await saveSongSubmission({ profile: userProfile, kind, title, artist, notes, file: kind === 'upload' ? file : undefined });
      }
      await refresh();
      setTitle('');
      setArtist('');
      setNotes('');
      setFile(undefined);
      setRightsConfirmed(false);
      if (uploadRef.current) uploadRef.current.value = '';
      setMessage(kind === 'upload' ? 'Soubor byl bezpečně odeslán správci ke kontrole.' : 'Žádost byla odeslána správci ke kontrole.');
    } catch (error) {
      setMessage(friendlyError(error, 'Návrh se nepodařilo uložit. Zkontrolujte připojení a zkuste to znovu.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="contribution-section" aria-labelledby="contribution-heading">
      <p className="eyebrow">Komunitní návrhy</p>
      <h2 id="contribution-heading">Nahrát nebo vyžádat píseň</h2>
      <p>Položky se uloží do soukromé fronty pod jménem <strong>{secureProfile?.display_name ?? userProfile.displayName}</strong>. Bez ověření práv a schválení správce se nikdy nezpřístupní členům.</p>
      <div className="contribution-grid">
        <form className="contribution-card" onSubmit={(event) => { event.preventDefault(); void save('request'); }}>
          <h3>Vyžádat přidání</h3>
          <label>Název písně<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Interpret nebo autor<input maxLength={160} value={artist} onChange={(event) => setArtist(event.target.value)} /></label>
          <label>Poznámka<textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          <button type="submit" className="secondary-button" disabled={busy || !title.trim()}>{secureMode ? 'Odeslat žádost' : 'Uložit žádost'}</button>
        </form>
        <form className="contribution-card" onSubmit={(event) => { event.preventDefault(); void save('upload'); }}>
          <h3>Nahrát vlastní podklad</h3>
          <label>Název písně<input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Interpret nebo autor<input maxLength={160} value={artist} onChange={(event) => setArtist(event.target.value)} /></label>
          <label className="secondary-button file-button">{file ? file.name : 'Vybrat PDF, ChordPro nebo TXT'}<input ref={uploadRef} type="file" accept="application/pdf,.pdf,.cho,.chordpro,text/plain,.txt" onChange={(event) => setFile(event.target.files?.[0])} /></label>
          <label className="switch-row contribution-rights"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> Potvrzuji, že soubor smím předat správci ke kontrole.</label>
          <button type="submit" className="primary-button" disabled={busy || !title.trim() || !file || !rightsConfirmed}>{secureMode ? 'Odeslat správci' : 'Uložit do fronty'}</button>
        </form>
      </div>
      {message && <p role="status" className={message.includes('nepodařilo') || message.includes('větší') ? 'error-message' : 'success-message'}>{message}</p>}
      <div className="submission-list"><strong>{secureMode ? 'Moje serverová fronta' : 'Fronta v tomto zařízení'}: {submissions.length}</strong>{submissions.slice(0, 5).map((submission) => <span key={submission.id}>{submission.kind === 'upload' ? 'Soubor' : 'Žádost'} · {submission.title} · {submission.status === 'pending_review' || submission.status === 'queued_local' ? 'čeká na kontrolu' : submission.status}</span>)}</div>
      <p className="score-note">{secureMode ? 'Soubor vidí pouze jeho autor a administrátor. Přijetí do kontroly není automatické zveřejnění.' : 'Online odesílání se aktivuje po připojení zabezpečené serverové části.'}</p>
    </section>
  );
}
