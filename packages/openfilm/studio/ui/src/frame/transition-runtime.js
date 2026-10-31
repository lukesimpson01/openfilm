/* Shorts transition page: sits over a cut between clip A and clip B (centered on it, duration/2 each side) and draws
   both through the transition renderer as a pure function of t. A plays from where its clip ends minus half the
   duration, B from where its clip starts minus half; past a clip's footage the first or last frame is held, so no
   clip on the timeline moves. Footage plays in muted <video> elements seeked to t (the host makes seeks exact).
   The same page draws a Zoom (kind 'effect'): one clip's own footage, zoomed into a point.
   A placed transition can carry its own speed graph (`params.curve`): progress over its time, for that one transition
   only (the catalog's defaults never change). */
import { TransitionRenderer, curveAt } from './transition-gl.js';

const VIDEO = /\.(mp4|mov|webm|m4v|mkv)$/i;
const DIPS = new Set(['classic.black_fade', 'classic.black_flash']);
function media(src) {
  /* a free edge (a fade in from, or out to, black): a black frame */
  if (!src) { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 4, 4); return c; }
  const url = `../${String(src).split('#')[0]}`;
  if (VIDEO.test(url)) { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url; return v; }
  const img = new Image(); img.decoding = 'sync'; img.src = url; return img;
}
const loaded = (el) => new Promise((done) => {
  if (el instanceof HTMLVideoElement) { if (el.readyState >= 2) done(); else { el.addEventListener('loadeddata', () => done(), { once: true }); el.addEventListener('error', () => done(), { once: true }); } }
  else if (el instanceof HTMLCanvasElement || el.complete) done(); else { el.onload = () => done(); el.onerror = () => done(); }
});
function seek(el, time) {
  if (!(el instanceof HTMLVideoElement)) return Promise.resolve();
  const d = Number.isFinite(el.duration) ? el.duration : time + 1;
  const target = Math.min(Math.max(0, time), Math.max(0, d - 0.04));
  if (Math.abs(el.currentTime - target) < 0.001 && el.readyState >= 2) return Promise.resolve();
  return new Promise((done) => { const fin = () => done(); el.addEventListener('seeked', fin, { once: true }); el.currentTime = target; setTimeout(fin, 1500); });
}

/* Speed Ramp retimes the footage itself: A accelerates into the cut, B leaves it fast and settles to normal speed,
   arriving exactly where its clip continues (f(1) = 1, f'(1) = 1). Past A's out point its handle plays (or its last
   frame holds). */
const rampA = (u, k) => u + k * u * u * u;
const rampB = (u, k) => u + k * u * (1 - u) * (1 - u);

export function createTransition(layer, root) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  root.appendChild(canvas);
  const size = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } };
  size();
  const renderer = new TransitionRenderer(canvas);
  const single = layer.kind === 'effect';
  const A = media(layer.aSrc), B = single ? A : media(layer.bSrc);
  const duration = Math.max(0.05, layer.duration || 0.5);
  const curve = Array.isArray(layer.params?.curve) && layer.params.curve.length > 1 ? layer.params.curve : null;
  /* ready means ready to play through: both videos already at their first frames and that frame drawn, while the page
     wakes ahead of the cut. Seeking them only once the cut is reached (mid-GOP, both at once) left a live preview
     black for its first part, and the motion late */
  const ready = Promise.all([loaded(A), loaded(B)]).then(() => run.frame(0)).catch(() => {});
  const run = {
    duration,
    get ready() { return ready; },
    async frame(t) {
      size();
      const tt = Math.min(Math.max(t, 0), duration);
      const u = tt / duration;
      const aS = layer.aSpeed || 1, bS = layer.bSpeed || 1;
      let aTime = (layer.aAt ?? 0) + tt * aS, bTime = (layer.bAt ?? 0) + tt * bS;
      if (layer.effect === 'classic.speed_ramp') {
        const k = 1.4 * (layer.params?.intensity ?? 0.6);
        aTime = (layer.aAt ?? 0) + duration * aS * rampA(u, k);
        bTime = (layer.bAt ?? 0) + duration * bS * rampB(u, k);
      } else if (layer.effect === 'fx.velocity') {
        /* fast → slow → fast, f(0) = 0 and f(1) = 1: it lands exactly where the clip goes on (a speed graph shapes it) */
        const k = Math.min(0.95, layer.params?.intensity ?? 0.65); const f = curve ? curveAt(curve, u) : u + (k * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);
        aTime = (layer.aAt ?? 0) + duration * aS * f;
      } else if (layer.effect === 'fx.splitFreeze') {
        aTime = layer.aAt ?? 0;
      } else if (layer.effect === 'classic.freeze_frame') {
        /* A's frame at the cut, held */
        aTime = (layer.aAt ?? 0) + (layer.edge === 'cut' ? duration / 2 : 0) * aS;
      }
      await (single ? seek(A, aTime) : Promise.all([seek(A, aTime), seek(B, bTime)]));
      /* a dip through black at a free edge: only the half that leaves or reaches the picture */
      let p = curve ? curveAt(curve, u) : u;
      if (DIPS.has(layer.effect) && layer.edge === 'in') p = 0.5 + p / 2;
      else if (DIPS.has(layer.effect) && layer.edge === 'out') p = p / 2;
      /* velocity: the curve retimed the footage, the picture is drawn straight */
      if (layer.effect === 'fx.velocity') p = u;
      /* a reversed reveal: B opens back into A */
      if (layer.params?.reverse) renderer.render(B, A, 1 - p, { ...layer.params, id: layer.effect, duration, fps: layer.fps || 40, seed: layer.seed });
      else renderer.render(A, B, p, { ...layer.params, id: layer.effect, duration, fps: layer.fps || 40, seed: layer.seed });
    },
  };
  return run;
}
