import { Icon, type IconName } from '../ui/Icon';

export function MorePage({ admin, onNavigate }: { admin: boolean; onNavigate: (path: string) => void }) {
  const entries: Array<[string, string, string, IconName]> = [
    ['songs/favorites', 'Oblíbené', 'Písně, ke kterým se vracíte', 'heart'],
    ['songs/artists', 'Autoři a interpreti', 'Procházet podle údajů v knihovně', 'users'],
    ['import', 'Přidat / importovat', 'Vlastní píseň nebo PDF', 'plus'],
    ['settings', 'Nastavení a účet', 'Zobrazení, zálohy a přihlášení', 'settings'],
    ['help', 'Nápověda', 'Jak se ve zpěvníku orientovat', 'info'],
    ['install', 'Instalace aplikace', 'Zpěvník na domovské obrazovce', 'download'],
  ];
  if (admin) entries.push(['admin', 'Administrace', 'Účty, návrhy písní a provoz', 'shield']);
  return <section className="more-page"><div className="page-heading"><h1>Více</h1></div><div className="destination-list">{entries.map(([path, title, detail, icon]) => <button type="button" key={path} onClick={() => onNavigate(path)}><Icon name={icon} /><span><strong>{title}</strong><small>{detail}</small></span><Icon name="chevronRight" size={18} /></button>)}</div></section>;
}
