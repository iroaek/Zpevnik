import { useCallback, useEffect, useState } from 'react';
import {
  loadPendingProfiles,
  loadRemoteSongSubmissions,
  reviewRemoteSongSubmission,
  reviewSecureProfile,
  type RemoteSongSubmission,
  type SecureProfile,
} from '../auth/secureAccess';

export function AdminAccessPanel({ mode = 'all' }: { mode?: 'all' | 'accounts' | 'songs' }) {
  const [profiles, setProfiles] = useState<SecureProfile[]>([]);
  const [submissions, setSubmissions] = useState<RemoteSongSubmission[]>([]);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextProfiles, nextSubmissions] = await Promise.all([loadPendingProfiles(), loadRemoteSongSubmissions()]);
      setProfiles(nextProfiles);
      setSubmissions(nextSubmissions.filter((submission) => submission.status === 'pending_review'));
      setMessage('');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Administraci se nepodařilo načíst.');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const reviewUser = async (profile: SecureProfile, decision: 'approved' | 'rejected') => {
    setBusyId(profile.id);
    try {
      await reviewSecureProfile(profile.id, decision);
      await refresh();
      setMessage(decision === 'approved' ? `Účet ${profile.display_name} byl schválen.` : `Registrace ${profile.display_name} byla zamítnuta.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Rozhodnutí se nepodařilo uložit.');
    } finally {
      setBusyId('');
    }
  };

  const reviewSubmission = async (submission: RemoteSongSubmission, decision: 'accepted_for_review' | 'rejected') => {
    setBusyId(submission.id);
    try {
      await reviewRemoteSongSubmission(submission.id, decision);
      await refresh();
      setMessage(decision === 'accepted_for_review' ? `Návrh „${submission.title}“ byl převzat ke kontrole.` : `Návrh „${submission.title}“ byl zamítnut.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Rozhodnutí se nepodařilo uložit.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <section className="backup-card admin-access-panel" aria-labelledby="admin-access-heading">
      <div className="results-heading"><span><p className="eyebrow">Pouze administrátor</p><h2 id="admin-access-heading">Schvalování přístupu</h2></span><button type="button" className="secondary-button" onClick={() => void refresh()}>Obnovit</button></div>
      {mode !== 'songs' && <><h3>Čekající registrace ({profiles.length})</h3>
      {profiles.length === 0 ? <p className="empty-state">Žádný nový účet nyní nečeká.</p> : <div className="admin-review-list">
        {profiles.map((profile) => <article key={profile.id}><span><strong>{profile.display_name}</strong><small>{profile.email}</small><small>{new Date(profile.created_at).toLocaleString('cs')}</small></span><span className="button-row"><button type="button" className="primary-button" disabled={busyId === profile.id} onClick={() => void reviewUser(profile, 'approved')}>Schválit</button><button type="button" className="danger-button" disabled={busyId === profile.id} onClick={() => void reviewUser(profile, 'rejected')}>Zamítnout</button></span></article>)}
      </div>}</>}
      {mode !== 'accounts' && <><h3>Nové návrhy a soubory ({submissions.length})</h3>
      {submissions.length === 0 ? <p className="empty-state">Žádný návrh nyní nečeká.</p> : <div className="admin-review-list">
        {submissions.map((submission) => <article key={submission.id}><span><strong>{submission.title}</strong><small>{submission.kind === 'upload' ? `Nahraný soubor · ${submission.file_name ?? ''}` : 'Požadavek na píseň'}{submission.artist ? ` · ${submission.artist}` : ''}</small><small>Práva: vyžadují ruční kontrolu</small></span><span className="button-row"><button type="button" className="primary-button" disabled={busyId === submission.id} onClick={() => void reviewSubmission(submission, 'accepted_for_review')}>Převzít ke kontrole</button><button type="button" className="danger-button" disabled={busyId === submission.id} onClick={() => void reviewSubmission(submission, 'rejected')}>Zamítnout</button></span></article>)}
      </div>}</>}
      {message && <p role="status">{message}</p>}
      <p className="score-note">Převzetí návrhu ještě píseň nezpřístupní. Publikovat lze až po doplnění zdroje, licence, atribuce a ověření práv.</p>
    </section>
  );
}
