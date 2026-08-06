import { useEffect, useMemo, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function standaloneMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(standaloneMode);
  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const appInstalled = () => {
      setPromptEvent(null);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  const isIosLike = useMemo(() => {
    const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const appleMobilePlatform = /iPhone|iPad|iPod/.test(navigator.platform);
    const webkitTouch = 'ontouchend' in document && /AppleWebKit/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    return appleMobilePlatform || touchMac || webkitTouch;
  }, []);

  const install = async () => {
    if (!promptEvent) return false;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setPromptEvent(null);
    return choice.outcome === 'accepted';
  };

  return { canPrompt: Boolean(promptEvent), installed, isIosLike, install };
}
