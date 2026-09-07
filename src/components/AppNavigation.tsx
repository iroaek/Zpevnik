import { useLayoutEffect, useRef } from 'react';
import { Icon, type IconName } from '../ui/Icon';

const items: Array<{ path: string; label: string; icon: IconName; name: string }> = [
  { path: '', label: 'Domů', icon: 'home', name: 'home' },
  { path: 'songs', label: 'Písně', icon: 'music', name: 'library' },
  { path: 'setlists', label: 'Setlisty', icon: 'list', name: 'setlists' },
  { path: 'offline', label: 'Offline', icon: 'download', name: 'offline' },
  { path: 'more', label: 'Více', icon: 'menu', name: 'more' },
];
export function AppNavigation({ screen, onNavigate }: { screen: string; onNavigate: (path: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const active = ['home', 'library', 'setlists', 'offline'].includes(screen) ? screen : screen === 'song' ? 'library' : 'more';
  useLayoutEffect(() => {
    if (!ref.current) return;
    const measure = () => document.documentElement.style.setProperty('--navigation-height', `${ref.current?.getBoundingClientRect().height ?? 0}px`);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(ref.current);
    measure();
    return () => { observer?.disconnect(); document.documentElement.style.removeProperty('--navigation-height'); };
  }, []);
  return <nav ref={ref} className="bottom-nav" aria-label="Hlavní navigace">{items.map((item) => <button type="button" key={item.path} className={active === item.name ? 'active' : ''} aria-current={active === item.name ? 'page' : undefined} onClick={() => onNavigate(item.path)}><Icon name={item.icon} size={21} /><span>{item.label}</span></button>)}</nav>;
}
