interface InstallPageProps {
  canPrompt: boolean;
  installed: boolean;
  isIosLike: boolean;
  onInstall: () => Promise<boolean>;
  onNavigate: (path: string) => void;
}

export function InstallPage({ canPrompt, installed, isIosLike, onInstall, onNavigate }: InstallPageProps) {
  const secureForInstall = window.isSecureContext;
  return (
    <section className="info-page install-page" aria-labelledby="install-heading">
      <p className="eyebrow">Jedním klepnutím</p><h1 id="install-heading">Nainstalovat zpěvník</h1>
      {installed ? <div className="offline-status offline-status--ready"><span className="status-dot" /><div><strong>Zpěvník už běží jako aplikace</strong><p>Najdete jej mezi ostatními aplikacemi a můžete jej spouštět z domovské obrazovky.</p></div></div> : (
        <>
          <p className="lead">Instalace není povinná. Zpěvník funguje také jako běžná webová stránka a nevyžaduje obchod s aplikacemi.</p>
          {!secureForInstall && <p className="global-warning" role="alert">Tato adresa není zabezpečená pomocí HTTPS. Import PDF a čtečku lze v místní síti vyzkoušet, ale mobilní prohlížeč instalaci PWA obvykle nenabídne. Pro instalaci otevřete nasazenou HTTPS verzi.</p>}
          {canPrompt && <button type="button" className="primary-button install-primary" onClick={() => void onInstall()}>Nainstalovat do zařízení</button>}
          {!canPrompt && !isIosLike && <p className="score-note">Prohlížeč právě nenabízí automatickou instalaci. Otevřete jeho nabídku a zvolte „Nainstalovat aplikaci“ nebo „Přidat na plochu“, pokud je volba dostupná.</p>}
          {isIosLike && <article className="instruction-card"><h2>iPhone a iPad</h2><ol><li>Otevřete stránku v Safari.</li><li>Klepněte na <strong>Sdílet</strong>.</li><li>Zvolte <strong>Přidat na plochu</strong>.</li><li>Zapněte <strong>Otevřít jako webovou aplikaci</strong> a potvrďte.</li></ol></article>}
        </>
      )}
      <article className="instruction-card"><h2>Po instalaci stáhněte své písně</h2><p>GitHub už otevírat nemusíte. V aplikaci přejděte do <strong>Nastavení → Stáhnout moje písně</strong> a zadejte svůj osobní přístupový kód.</p><button className="primary-button" type="button" onClick={() => onNavigate('settings')}>Přejít ke stažení písní</button></article>
      <article className="instruction-card"><h2>Vlastní PDF v telefonu</h2><p>Po otevření aplikace zvolte v dolní navigaci <strong>Import PDF</strong>. Soubor se zpracuje a zůstane pouze v daném zařízení.</p><button className="secondary-button" type="button" onClick={() => onNavigate('import')}>Otevřít Import PDF</button></article>
      <article className="instruction-card"><h2>Než vyrazíte bez signálu</h2><p>Samotná instalace automaticky nestáhne všechny písně ani noty. Otevřete Offline obsah a zvolte, co chcete uložit.</p><button className="secondary-button" type="button" onClick={() => onNavigate('offline')}>Přejít na Offline obsah</button></article>
    </section>
  );
}
