export function UpdateBanner({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  return <aside className="update-banner" role="status"><div><strong>Je dostupná nová verze zpěvníku.</strong><span>Oblíbené, setlisty a nastavení zůstanou zachované.</span></div><div><button type="button" className="primary-button" onClick={onUpdate}>Aktualizovat nyní</button><button type="button" className="secondary-button" onClick={onLater}>Později</button></div></aside>;
}
