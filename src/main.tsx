import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installBrowserCompatibility } from './domain/browserCompatibility';
import './styles.css';

// Externí moduly (zejména Neon Auth) mohou při vyhodnocení okamžitě použít
// moderní browser API. Nejdřív proto synchronně nainstalujeme fallbacky a až
// potom dynamicky načteme zbytek aplikace. Dělení bundle tak nemůže změnit pořadí.
installBrowserCompatibility();
const [{ default: App }, { registerPwa }] = await Promise.all([
  import('./App'),
  import('./pwa/updateManager'),
]);

registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
