import { useState } from 'react';
import {
  registerSecureAccount,
  sendEmailVerificationCode,
  sendPasswordReset,
  signInSecureAccount,
  verifyEmailVerificationCode,
} from '../auth/secureAccess';

interface AccountAccessPageProps {
  canInstall: boolean;
  installed: boolean;
  onInstall: () => Promise<boolean>;
}

export function AccountAccessPage({ canInstall, installed, onInstall }: AccountAccessPageProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (mode === 'verify') {
        await verifyEmailVerificationCode(email, verificationCode);
        setVerificationCode('');
        setMessage('E-mail je ověřený. Původní profil, schválení i setlisty se nyní bezpečně propojí s Neon účtem.');
      } else if (mode === 'register') {
        if (password.length < 10) throw new Error('Heslo musí mít alespoň 10 znaků.');
        if (password !== passwordAgain) throw new Error('Zadaná hesla se neshodují.');
        if (!privacyAccepted) throw new Error('Pro vytvoření účtu potvrďte zpracování registračních údajů.');
        const result = await registerSecureAccount({ displayName, email, password });
        setPassword('');
        setPasswordAgain('');
        if (result.needsEmailConfirmation) {
          await sendEmailVerificationCode(email);
          setMode('verify');
          setMessage('Registrace byla přijata. Na e-mail jsme poslali ověřovací kód; po jeho zadání účet počká na schválení administrátorem.');
        } else {
          setMessage('Registrace byla přijata a nyní čeká na schválení administrátorem.');
        }
      } else {
        await signInSecureAccount(email, password);
        setPassword('');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Požadavek se nepodařilo dokončit.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setError('Nejprve zadejte e-mail účtu.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await sendPasswordReset(email);
      setMessage('Pokud účet existuje, na e-mail dorazí odkaz pro nastavení nového hesla.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Obnovu hesla se nepodařilo zahájit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="registration-page" aria-labelledby="account-access-heading">
      <div className="registration-card account-access-card">
        <p className="eyebrow">Soukromý členský zpěvník</p>
        <h1 id="account-access-heading">{mode === 'login' ? 'Přihlášení' : mode === 'register' ? 'Žádost o registraci' : 'Ověření e-mailu'}</h1>
        <p className="lead">Písně nejsou veřejné. Každý nový účet musí před prvním použitím schválit administrátor.</p>
        {mode !== 'verify' && <div className="account-mode-switch" role="tablist" aria-label="Přihlášení nebo registrace">
          <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); setMessage(''); }}>Přihlásit se</button>
          <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); setMessage(''); }}>Registrovat se</button>
        </div>}
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {mode === 'verify' ? <>
            <p className="migration-note">Při přechodu na Neon se ověřením e-mailu bezpečně zachová váš dřívější profil, role, schválení, oblíbené i setlisty.</p>
            <label htmlFor="account-verification-code">Šestimístný kód<input id="account-verification-code" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\s/g, ''))} /></label>
          </> : <>
          {mode === 'register' && <label htmlFor="account-name">Jméno nebo přezdívka<input id="account-name" autoComplete="nickname" required minLength={2} maxLength={60} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}
          <label htmlFor="account-email">E-mail<input id="account-email" type="email" inputMode="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label htmlFor="account-password">Heslo<input id="account-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === 'register' && <>
            <label htmlFor="account-password-again">Heslo znovu<input id="account-password-again" type="password" autoComplete="new-password" required minLength={10} value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)} /></label>
            <label className="switch-row registration-consent"><input type="checkbox" required checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> Souhlasím s uložením jména, e-mailu a stavu schválení pro provoz soukromého zpěvníku.</label>
          </>}
          </>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Ověřuji…' : mode === 'login' ? 'Přihlásit se' : mode === 'register' ? 'Odeslat registraci' : 'Ověřit kód'}</button>
          {mode === 'login' && <button type="button" className="text-button" disabled={busy} onClick={() => void resetPassword()}>Zapomenuté heslo</button>}
          {mode === 'verify' && <button type="button" className="text-button" disabled={busy} onClick={() => { setMode('login'); setVerificationCode(''); }}>Zpět na přihlášení</button>}
        </form>
        {message && <p className="success-message" role="status">{message}</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        {!installed && canInstall && <button type="button" className="secondary-button" onClick={() => void onInstall()}>Nainstalovat aplikaci</button>}
        <small>Registrace sama přístup neudělí. Písně a formulář návrhů server zpřístupní až po schválení.</small>
      </div>
    </section>
  );
}
