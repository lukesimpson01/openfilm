/* Motion graphic page: draws its graphic (motion-graphics.js) at the host's t, the same renderer the editor's previews
   use. Its media (photos, screen recordings) are project files, loaded once; a video is seeked to the graphic's t. */
import { renderGraphic, graphicById, decodeWorld } from './motion-graphics.js';

const VIDEO = /\.(mp4|mov|webm|m4v|mkv)$/i;
function load(path) {
  const url = `../${String(path).split('#')[0]}`;
  if (VIDEO.test(url)) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    return new Promise((done) => { if (v.readyState >= 2) done(v); else { v.addEventListener('loadeddata', () => done(v), { once: true }); v.addEventListener('error', () => done(null), { once: true }); } });
  }
  const img = new Image(); img.decoding = 'sync'; img.src = url;
  return img.decode().then(() => img, () => null);
}
function seek(v, t) {
  if (!(v instanceof HTMLVideoElement)) return Promise.resolve();
  const d = Number.isFinite(v.duration) && v.duration > 0.1 ? v.duration : 0;
  const target = d ? t % Math.max(0.1, d - 0.05) : Math.max(0, t);
  if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return Promise.resolve();
  return new Promise((done) => { const fin = () => done(); v.addEventListener('seeked', fin, { once: true }); v.currentTime = target; setTimeout(fin, 1500); });
}

export function createMotionGraphic(layer, root) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  root.appendChild(canvas);
  const g = canvas.getContext('2d');
  const size = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } };
  size();
  const def = graphicById(layer.graphic);
  const params = { ...(def?.defaults || {}), ...(layer.params || {}) };
  const assets = {};
  let world = null;
  const jobs = Object.entries(params).filter(([, v]) => typeof v === 'string' && /\.(png|jpe?g|webp|gif|avif|svg|mp4|mov|webm|m4v|mkv)$/i.test(v)).map(async ([k, v]) => { assets[k] = await load(v); });
  if (def?.map) jobs.push(fetch('world.json').then((r) => r.json()).then((d) => { world = decodeWorld(d); }).catch(() => {}));
  const ready = Promise.all(jobs).then(() => document.fonts?.ready);
  const duration = Math.max(0.1, layer.duration || def?.duration || 4);
  return {
    duration,
    ready,
    async frame(t) {
      size();
      const tt = Math.min(Math.max(t, 0), duration);
      await Promise.all(Object.values(assets).map((a) => seek(a, tt)));
      renderGraphic(g, canvas.width, canvas.height, layer, tt, (k) => assets[k] ?? null, world);
    },
  };
}
