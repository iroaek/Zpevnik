export function HelpPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <section className="info-page help-page" aria-labelledby="help-heading">
      <p className="eyebrow">Krátce a jednoduše</p><h1 id="help-heading">Jak používat zpěvník</h1>
      <div className="help-steps">
        <article><span>1</span><div><h2>Otevřete zpěvník</h2><p>Naskenujte QR kód nebo otevřete odkaz. Do vyhledávání napište název, autora nebo první řádek.</p></div></article>
        <article><span>2</span><div><h2>Přidejte jej na plochu</h2><p>Na Androidu použijte nabídku instalace. Na iPhonu v Safari zvolte Sdílet → Přidat na plochu.</p><button type="button" className="text-button" onClick={() => onNavigate('install')}>Podrobný návod k instalaci</button></div></article>
        <article><span>3</span><div><h2>Stáhněte písně offline</h2><p>Před cestou otevřete Offline obsah a klepněte na „Stáhnout celý zpěvník“. Noty se stahují samostatně.</p><button type="button" className="text-button" onClick={() => onNavigate('offline')}>Otevřít Offline obsah</button></div></article>
        <article><span>4</span><div><h2>Zvětšete text</h2><p>V otevřené písni použijte tlačítka A− a A+. Režim „U ohně“ nastaví velké teplé tmavé zobrazení.</p></div></article>
        <article><span>5</span><div><h2>Transponujte akordy</h2><p>Tlačítky − a + posunete všechny akordy po půltónech. „Původní“ vrátí výchozí tóninu.</p></div></article>
        <article><span>6</span><div><h2>Zobrazte noty</h2><p>V písni otevřete záložku Noty a vyberte melodii, housle nebo violoncello. Nestažený part bez internetu zobrazí jasné upozornění.</p></div></article>
        <article><span>7</span><div><h2>Uvolněte místo</h2><p>Na obrazovce Offline obsah lze odstranit jen noty nebo celý stažený obsah. Oblíbené a soukromé setlisty tím nezmizí.</p></div></article>
      </div>
    </section>
  );
}
