/* Finds the surface under a click without blocking the editor: { id, grays, times, w, h, k, click, global } → { id, r }. */
import { localSurface } from './local-surface.js';
self.onmessage = (e) => {
  const m = e.data;
  try { self.postMessage({ id: m.id, ok: true, r: localSurface(m.grays, m.times, m.w, m.h, m.k, m.click, { global: m.global }) }); }
  catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err?.message ?? err) }); }
};
