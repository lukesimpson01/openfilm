/**
 * The theme: light, dark or the system's, light until the person chooses. The choice is kept in localStorage `openfilm.theme` and shown as
 * `<html data-theme>`; index.html applies it before the first paint, this keeps it current afterwards, in every page
 * of Studio that is open.
 */
import React from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'openfilm.theme';
const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

function saved(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'light';
  } catch { return 'light'; }
}

let transitionEnd:ReturnType<typeof setTimeout>|undefined;
function apply(mode: ThemeMode) {
  const root=document.documentElement,next=mode === 'system' ? (dark().matches ? 'dark' : 'light') : mode;
  if(root.dataset.theme===next)return;
  root.dataset.themeTransition='';clearTimeout(transitionEnd);
  root.dataset.theme=next;
  transitionEnd=setTimeout(()=>delete root.dataset.themeTransition,340);
  window.dispatchEvent(new CustomEvent('frame-theme',{detail:next}));
}

const listeners = new Set<() => void>();

/* "System" follows the system while Studio is open, not only when it starts */
if (typeof window !== 'undefined') dark().addEventListener('change', () => { if (saved() === 'system') apply('system'); });
/* a theme chosen in another of Studio's pages (another tab of the app, another window) is this one's too */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY) return;
    apply(saved());
    for (const listener of listeners) listener();
  });
}

export function setThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* not kept past this page */ }
  apply(mode);
  for (const listener of listeners) listener();
}

/** The chosen theme and a way to change it; every user of it sees the change. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = React.useSyncExternalStore((on) => { listeners.add(on); return () => listeners.delete(on); }, saved, () => 'dark' as ThemeMode);
  return [mode, setThemeMode];
}
