import { useState } from 'react';
import { createUserProfile, type UserProfile } from '../storage/database';

interface RegistrationPageProps {
  canInstall: boolean;
  installed: boolean;
  onInstall: () => Promise<boolean>;
  onRegister: (profile: UserProfile) => void;
}

export function RegistrationPage({ canInstall, installed, onInstall, onRegister }: RegistrationPageProps) {
  const [displayName, setDisplayName] = useState('');
  const normalizedName = displayName.trim();

  return (
    <section className="registration-page" aria-labelledby="registration-heading">
      <div className="registration-card">
        <p className="eyebrow">Váš osobní zpěvník</p>
        <h1 id="registration-heading">Jak vám máme říkat?</h1>
        <p className="lead">Zvolte jméno nebo přezdívku. Profil se nyní bezpečně uloží do tohoto zařízení; přístup k písním a návrhům se aktivuje samostatně.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (normalizedName.length >= 2) onRegister(createUserProfile(normalizedName)); }}>
          <label htmlFor="registration-name">Jméno nebo přezdívka</label>
          <input id="registration-name" autoFocus autoComplete="nickname" minLength={2} maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Např. Kytarista Honza" />
          <button type="submit" className="primary-button" disabled={normalizedName.length < 2}>Vytvořit profil a pokračovat</button>
        </form>
        {!installed && canInstall && <button type="button" className="secondary-button" onClick={() => void onInstall()}>Nejprve nainstalovat aplikaci</button>}
        <small>Samotná přezdívka není veřejně zobrazena ani odesílána bez vašeho potvrzení.</small>
      </div>
    </section>
  );
}
