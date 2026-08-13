import { useEffect, useRef, useState } from 'react';
import { completeFirstRunGuide } from './firstRunState';

interface FirstRunGuideProps {
  userId: string;
  role: 'member' | 'admin';
  onClose: () => void;
  onNavigate: (path: string) => void;
}

const STEPS = [
  {
    eyebrow: '1 · Vítejte',
    title: 'Zpěvník je připravený',
    body: 'Písně, hledání, oblíbené a setlisty najdete v hlavní navigaci. Klepnutím na akord otevřete jeho kytarový i klavírní hmat.',
    icon: '♪',
  },
  {
    eyebrow: '2 · Přístup',
    title: 'Přihlášení zůstává v zařízení',
    body: 'Po online ověření se bezpečné oprávnění uloží do telefonu. Při dalším otevření vás aplikace neodhlásí jen proto, že jste bez signálu. Neodstraňujte ale data webu nebo aplikace — tím by se smazal i bezpečný offline klíč.',
    icon: '✓',
  },
  {
    eyebrow: '3 · Bez signálu',
    title: 'Stáhněte si členskou knihovnu',
    body: 'V části Offline stáhněte písně do tohoto zařízení. Potom fungují i bez internetu; jednou za 30 dní stačí oprávnění krátce obnovit online.',
    icon: '⇩',
  },
  {
    eyebrow: '4 · Hraní',
    title: 'Pódium bez rušení',
    body: 'Pódiový režim drží displej aktivní, dovolí zamknout ovládání, měnit velikost textu a přecházet mezi písněmi tahem. Odpočet spustí automatický posun bez hledání malých tlačítek.',
    icon: '♯',
  },
  {
    eyebrow: '5 · Vlastní úpravy',
    title: 'Akord usaďte nad správnou slabiku',
    body: 'V režimu úprav lze akord přetáhnout prstem, vracet kroky a sjednotit české názvy s „is“ na zápis s #. Lokální oprava zůstane ve vašem zařízení, návrh můžete poslat správci.',
    icon: '↔',
  },
] as const;

export function FirstRunGuide({ userId, role, onClose, onNavigate }: FirstRunGuideProps) {
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const current = STEPS[step];
  const finish = (destination?: string) => {
    completeFirstRunGuide(userId);
    onClose();
    if (destination) onNavigate(destination);
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      completeFirstRunGuide(userId);
      onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, userId]);

  return <div className="first-run-scrim">
    <section ref={dialogRef} className="first-run-guide" role="dialog" aria-modal="true" aria-labelledby="first-run-title" tabIndex={-1}>
      <header>
        <span className="first-run-brand" aria-hidden="true">{current.icon}</span>
        <button type="button" className="first-run-close" aria-label="Přeskočit průvodce" onClick={() => finish()}>×</button>
      </header>
      <div className="first-run-copy">
        <p className="eyebrow">{current.eyebrow}</p>
        <h1 id="first-run-title">{current.title}</h1>
        <p>{current.body}</p>
        {role === 'admin' && step === 1 && <aside><strong>Administrátor</strong><span>Správa uživatelů zůstává dostupná na samostatné stránce Administrace.</span></aside>}
      </div>
      <ol className="first-run-progress" aria-label={`Krok ${step + 1} ze ${STEPS.length}`}>
        {STEPS.map((item, index) => <li key={item.title} className={index === step ? 'active' : index < step ? 'complete' : ''}><span>{index + 1}</span></li>)}
      </ol>
      <footer>
        {step > 0 ? <button type="button" className="secondary-button" onClick={() => setStep((value) => value - 1)}>Zpět</button> : <button type="button" className="secondary-button" onClick={() => finish()}>Přeskočit</button>}
        {step < STEPS.length - 1
          ? <button type="button" className="primary-button" onClick={() => setStep((value) => value + 1)}>Pokračovat</button>
          : <button type="button" className="primary-button" onClick={() => finish('offline')}>Otevřít Offline</button>}
      </footer>
    </section>
  </div>;
}
