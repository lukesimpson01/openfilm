/**
 * The chat's bridge (`window.openfilmDesktop`, apps/desktop/chat/src/app-bridge.ts), for the web editor: what the
 * app's shell (apps/desktop/shell/bridge.ts) gives it, from `openfilmNative` (web-native.ts) and the editor's page.
 * The chat's column is the editor's slide-in panel (ChatPanel); the project is the one the editor shows.
 */
type Listener<T> = (value: T) => void;
type Project = { id: string; name: string; path: string };

function signal<T>(value: T) {
  const listeners = new Set<Listener<T>>();
  return { get: () => value, set(next: T) { value = next; for (const l of listeners) l(next); }, on(l: Listener<T>) { listeners.add(l); return () => { listeners.delete(l); }; } };
}

const root = document.documentElement;
const themeOf = () => (root.dataset.theme === 'dark' ? 'dark' : 'light') as 'light' | 'dark';
const theme = signal(themeOf());
const language = signal(root.lang || 'en');
new MutationObserver(() => {
  if (themeOf() !== theme.get()) theme.set(themeOf());
  if ((root.lang || 'en') !== language.get()) language.set(root.lang || 'en');
}).observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });

const NO_ASKS: never[] = [];
export const chatProject = signal<Project | null>(null);
export const chatOpen = signal(false);
const assets = signal(false);

/** The project the editor shows, as Studio lists it (its folder is what the agents work in). */
export async function followProject(id: string) {
  const body = await (await fetch('/api/projects')).json() as { projects?: Project[] };
  const found = body.projects?.find((p) => p.id === id);
  if (found) chatProject.set({ id: found.id, name: found.name, path: found.path });
}

export function installDesktop() {
  const w = window as unknown as { openfilmDesktop?: unknown; openfilmNative: Record<string, any> };
  if (w.openfilmDesktop) return;
  const native = w.openfilmNative;
  const hello = native.hello();
  w.openfilmDesktop = {
    bridgeVersion: '1',
    platform: native.platform,
    pathForFile: native.pathForFile,
    revealPath: native.revealPath,
    agents: { list: native.agents.list, connect: native.agents.connect, onChange: native.agents.onChange },
    localAgents: native.localAgents,
    openSettings: () => {},
    async hello() {
      const h = await hello;
      return { platform: native.platform, flavor: h.flavor, theme: theme.get(), language: language.get(), chatOpen: chatOpen.get(), project: chatProject.get(), selection: null, ffmpeg: h.ffmpeg, version: h.version, chatMin: 340 };
    },
    onTheme: theme.on,
    onLanguage: language.on,
    onProject: (l: Listener<Project>) => chatProject.on((p) => { if (p) l(p); }),
    onChatOpen: chatOpen.on,
    onStudioBrowser: native.onStudioBrowser,
    onStudioFailed: () => () => {},
    onRefer: () => () => {},
    onSelection: () => () => {},
    onFfmpeg: native.onFfmpeg,
    showInStudio: () => {},
    async exampleFolder(id: string) {
      const res = await fetch(`/api/examples/${encodeURIComponent(id)}/folder`, { method: 'POST' });
      const body = await res.json().catch(() => ({})) as { folder?: string; error?: string };
      if (!res.ok || !body.folder) throw new Error(body.error ?? `Studio answered ${res.status}`);
      return body.folder;
    },
    showExamples: () => {},
    onUseSkill: () => () => {},
    onAddSkill: () => () => {},
    useSkill: () => {},
    withPicture: async (ref: unknown) => ref,
    highlightInStudio: () => {},
    draftRefsInStudio: () => {},
    onStudioHover: () => () => {},
    async projectFiles() {
      const id = chatProject.get()?.id;
      if (!id) return { files: [] };
      try { return await (await fetch(`/api/projects/${encodeURIComponent(id)}/files`)).json(); } catch { return { files: [] }; }
    },
    setChatWidth: () => {},
    setChatOpen: (open: boolean) => chatOpen.set(open),
    assetsOpen: () => false,
    setAssetsOpen: () => {},
    onAssets: assets.on,
    setComposerHeight: () => {},
    setMenuOpen: () => {},
    chat: native.chat,
    skills: native.skills,
    /* one empty list, the same each time: the chat reads it as a store (a new [] each read would never settle) */
    asks: { get: () => NO_ASKS, onChange: () => () => {}, answer: () => {} },
    developer: {
      get: async () => { const p = await native.prefs.get(); return { logs: p.developer === true, changes: p.changes !== false }; },
      set: (next: { logs?: boolean; changes?: boolean }) => native.prefs.set({ ...(typeof next.logs === 'boolean' ? { developer: next.logs } : {}), ...(typeof next.changes === 'boolean' ? { changes: next.changes } : {}) }),
      onChange: (l: Listener<{ logs: boolean; changes: boolean }>) => native.prefs.onChange((p: { developer: boolean; changes: boolean }) => l({ logs: p.developer === true, changes: p.changes !== false })),
    },
  };
}
