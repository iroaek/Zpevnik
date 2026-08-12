import { installBrowserCompatibility } from './domain/browserCompatibility';

// Neon Auth creates a per-tab UUID while its module is evaluated. Install the
// standards-compatible fallback before App (and therefore Neon SDK) is loaded.
installBrowserCompatibility();
