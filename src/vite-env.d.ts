/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface Navigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
}

interface ImportMetaEnv {
  readonly VITE_PUBLIC_BASE_URL?: string;
}

interface ScreenOrientation {
  lock?(orientation: 'portrait' | 'landscape' | 'portrait-primary' | 'landscape-primary'): Promise<void>;
  unlock?(): void;
}

interface WakeLockSentinel extends EventTarget {
  released: boolean;
  release(): Promise<void>;
}
