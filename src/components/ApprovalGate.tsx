import { useState } from 'react';
import { signOutSecureAccount, type SecureProfile } from '../auth/secureAccess';

interface ApprovalGateProps {
  profile: SecureProfile;
  onRefresh: () => Promise<void>;
}

const statusCopy = {
  pending: {
    eyebrow: 'Registrace přijata',
    heading: 'Účet čeká na schválení',
    body: 'Administrátor vaši žádost ještě neposoudil. Do schválení se nestahují žádné písně a nelze přidávat návrhy.',
  },
  rejected: {
    eyebrow: 'Přístup nebyl udělen',
    heading: 'Registrace byla zamítnuta',
    body: 'Tento účet nemá přístup k soukromému obsahu. Pokud jde o omyl, obraťte se na administrátora.',
  },
  suspended: {
    eyebrow: 'Přístup pozastaven',
    heading: 'Účet je dočasně zablokovaný',
    body: 'Server tomuto účtu nevydá katalog ani nové soubory. Již dříve uložená offline data může být nutné odstranit přímo ze zařízení.',
  },
  approved: {
    eyebrow: 'Účet schválen',
    heading: 'Načítám soukromý zpěvník',
    body: 'Obnovuji oprávnění účtu.',
  },
} as const;

export function ApprovalGate({ profile, onRefresh }: ApprovalGateProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const copy = statusCopy[profile.status];

  const refresh = async () => {
    setBusy(true);
    setMessage('');
    try {
      await onRefresh();
      setMessage('Stav účtu byl právě zkontrolován.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-main">
      <section className="registration-page" aria-labelledby="approval-heading">
        <div className="registration-card approval-card">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 id="approval-heading">{copy.heading}</h1>
          <p className="lead">{copy.body}</p>
          <dl className="account-summary"><div><dt>Uživatel</dt><dd>{profile.display_name}</dd></div><div><dt>E-mail</dt><dd>{profile.email}</dd></div></dl>
          <button type="button" className="primary-button" disabled={busy} onClick={() => void refresh()}>{busy ? 'Kontroluji…' : 'Zkontrolovat schválení'}</button>
          <button type="button" className="secondary-button" onClick={() => void signOutSecureAccount()}>Odhlásit se</button>
          {message && <p role="status">{message}</p>}
        </div>
      </section>
    </main>
  );
}
