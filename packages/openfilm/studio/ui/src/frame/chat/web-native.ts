/**
 * The desktop app's `window.openfilmNative` (apps/desktop/src/preload.cjs), in a browser: the preload itself, run with
 * an `ipcRenderer` that goes to the chat host (apps/desktop/web/chat-host.mjs) over HTTP, and hears what the app
 * sends over server-sent events. The chat then works as it does in the app: its agents, its record of each project.
 */
import preload from '@desktop/src/preload.cjs?raw';

export const CHAT_HOST = `http://127.0.0.1:${(window as unknown as { SHORTS_CHAT_PORT?: number }).SHORTS_CHAT_PORT ?? 4851}`;

type Listener = (event: unknown, value: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | null = null;
function listen() {
  if (source) return;
  source = new EventSource(`${CHAT_HOST}/events`);
  source.onmessage = (e) => {
    try {
      const { channel, value } = JSON.parse(e.data) as { channel: string; value: unknown };
      for (const fn of listeners.get(channel) ?? []) fn({}, decode(value));
    } catch { /* a line it cannot read */ }
  };
}

/* bytes travel as base64 (a reference's picture, a pasted file) */
function toBase64(bytes: Uint8Array) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }
function encode(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return { __bytes: toBase64(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { __bytes: toBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
function decode(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { __bytes?: unknown }).__bytes === 'string') {
    const bin = atob((value as { __bytes: string }).__bytes); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
}

const ipcRenderer = {
  async invoke(channel: string, ...args: unknown[]) {
    const res = await fetch(`${CHAT_HOST}/ipc/${encodeURIComponent(channel)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: encode(args) }) });
    const said = await res.json() as { ok: boolean; value?: unknown; error?: string };
    if (!said.ok) throw new Error(said.error ?? `${channel} failed`);
    return decode(said.value);
  },
  send(channel: string, ...args: unknown[]) {
    void fetch(`${CHAT_HOST}/send/${encodeURIComponent(channel)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ args: encode(args) }) }).catch(() => {});
  },
  on(channel: string, fn: Listener) { listen(); (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(fn); },
  removeListener(channel: string, fn: Listener) { listeners.get(channel)?.delete(fn); },
};

/** Whether the chat host answers (it runs beside Studio: apps/desktop/web/chat-host.mjs). */
export async function chatHostUp() {
  try { const r = await fetch(`${CHAT_HOST}/ipc/desktop%3Ahello`, { method: 'POST', body: '{}' }); return r.ok; } catch { return false; }
}

/** Puts `window.openfilmNative` on the page, once. */
export function installNative() {
  const w = window as unknown as { openfilmNative?: unknown };
  if (w.openfilmNative) return;
  const electron = {
    contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { (window as unknown as Record<string, unknown>)[key] = api; } },
    ipcRenderer,
    webUtils: { getPathForFile: () => '' },
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'process', preload)((name: string) => (name === 'electron' ? electron : {}), { platform: navigator.platform.startsWith('Mac') ? 'darwin' : 'linux' });
}
