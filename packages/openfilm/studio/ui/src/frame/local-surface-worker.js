/* Finds the surface under a click without blocking the editor: { id, grays, times, w, h, k, click, global } → { id, r }.
   { id, spots: [[x, y]…] } instead: which way the surface under each spot faces, one answer per spot as it is found. */
import { localSurface } from './local-surface.js';
self.onmessage = (e) => {
  const m = e.data;
  if (m.spots) {
    for (const [i, click] of m.spots.entries()) {
      try { self.postMessage({ id: m.id, i, ok: true, r: localSurface(m.grays, m.times, m.w, m.h, m.k ?? 0, click, { global: m.global, orientOnly: true }) }); }
      catch (err) { self.postMessage({ id: m.id, i, ok: false, error: String(err?.message ?? err) }); }
    }
    self.postMessage({ id: m.id, done: true });
    return;
  }
  try { self.postMessage({ id: m.id, ok: true, r: localSurface(m.grays, m.times, m.w, m.h, m.k, m.click, { global: m.global, normal: m.normal ?? null }) }); }
  catch (err) { self.postMessage({ id: m.id, ok: false, error: String(err?.message ?? err) }); }
};
