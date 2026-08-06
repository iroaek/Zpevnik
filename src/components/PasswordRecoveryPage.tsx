import { useState } from 'react';
import { updateSecurePassword } from '../auth/secureAccess';

interface PasswordRecoveryPageProps {
  onComplete: () => void;
}

export function PasswordRecoveryPage({ onComplete }: PasswordRecoveryPageProps) {
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    if (password !== passwordAgain) {
      setError('Zadaná hesla se neshodují.');
      return;
    }
    setBusy(true);
    try {
      await updateSecurePassword(password);
      onComplete();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Heslo se nepodařilo změnit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-main"><section className="registration-page" aria-labelledby="password-recovery-heading"><div className="registration-card">
      <p className="eyebrow">Obnova účtu</p><h1 id="password-recovery-heading">Nastavit nové heslo</h1>
      <p className="lead">Odkaz z e-mailu byl ověřen. Zvolte nové heslo s alespoň deseti znaky.</p>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label htmlFor="new-password">Nové heslo<input id="new-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label htmlFor="new-password-again">Nové heslo znovu<input id="new-password-again" type="password" autoComplete="new-password" required minLength={10} value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} /></label>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Ukládám…' : 'Uložit nové heslo'}</button>
      </form>
      {error && <p className="error-message" role="alert">{error}</p>}
    </div></section></main>
  );
}
