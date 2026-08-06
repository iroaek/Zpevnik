/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Navigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
}

interface ImportMetaEnv {
  readonly VITE_PUBLIC_BASE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_REQUIRE_SECURE_ACCESS?: 'true' | 'false';
}

interface ScreenOrientation {
  lock?(orientation: 'portrait' | 'landscape' | 'portrait-primary' | 'landscape-primary'): Promise<void>;
  unlock?(): void;
}

interface WakeLockSentinel extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}
