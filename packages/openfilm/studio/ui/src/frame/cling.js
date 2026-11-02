/* Cling: where to follow near a click. The tracker needs corners and texture, not a flat patch, so a click is nudged
   onto the strongest corner within `reach` px, and the window grows only until it holds enough to follow. A patch that
   never gets enough is reported as weak or empty so the editor can ask instead of tracking something it can't follow.
   Works on a grayscale crop (Uint8, w*h, at most ~640 px): cheap, no models, runs per click. */
const integral = (a, w, h) => { const I = new Float64Array((w + 1) * (h + 1)); for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += a[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } } return I; };
const box = (I, w, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
/** Shi-Tomasi: the smaller eigenvalue of the window's gradient tensor (mean per pixel). Flat or one-direction edges score low. */
export function cornerScores(gray, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; gx[i] = (gray[i + 1] - gray[i - 1]) / 2; gy[i] = (gray[i + w] - gray[i - w]) / 2; }
  const xx = new Float32Array(w * h), yy = new Float32Array(w * h), xy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { xx[i] = gx[i] * gx[i]; yy[i] = gy[i] * gy[i]; xy[i] = gx[i] * gy[i]; }
  const Ixx = integral(xx, w, h), Iyy = integral(yy, w, h), Ixy = integral(xy, w, h);
  return (cx, cy, size) => {
    const r = size / 2, x0 = Math.max(0, Math.round(cx - r)), y0 = Math.max(0, Math.round(cy - r)), x1 = Math.min(w, Math.round(cx + r)), y1 = Math.min(h, Math.round(cy + r));
    const n = Math.max(1, (x1 - x0) * (y1 - y0)), a = box(Ixx, w, x0, y0, x1, y1) / n, c = box(Iyy, w, x0, y0, x1, y1) / n, b = box(Ixy, w, x0, y0, x1, y1) / n;
    return (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
  };
}
export const GOOD = 12, WEAK = 1.2; /* measured on real footage: corners and markings 17-130, wood grain ~2, a flat wall or door <0.5 */
/**
 * gray: crop pixels; (x, y): the click in crop coordinates. Returns the spot to follow in crop px.
 * @returns {{ x: number, y: number, size: number, score: number, quality: 'good' | 'weak' | 'none' }}
 */
export function clingTarget(gray, w, h, x, y, { reach = 8, sizes = [16, 26, 40, 60] } = {}) {
  const score = cornerScores(gray, w, h);
  /** @type {{ x: number, y: number, size: number, score: number }} */
  let best = { x, y, size: sizes[0], score: -Infinity };
  for (const size of sizes) {
    /** @type {{ x: number, y: number, size: number, score: number } | null} */
    let pick = null;
    for (let dy = -reach; dy <= reach; dy += 2) for (let dx = -reach; dx <= reach; dx += 2) {
      const cx = Math.min(w - 1, Math.max(0, x + dx)), cy = Math.min(h - 1, Math.max(0, y + dy));
      const s = score(cx, cy, size) - Math.hypot(dx, dy) * 0.02;
      if (!pick || s > pick.score) pick = { x: cx, y: cy, size, score: s };
    }
    if (!pick) continue;
    best = pick;
    if (pick.score >= GOOD) return { ...pick, quality: 'good' };
  }
  return { ...best, quality: best.score >= WEAK ? 'weak' : 'none' };
}

/**
 * Places worth pointing at on a frame: the best well-separated corners and markings (diamonds the person can click).
 * gray: the frame (Uint8, w*h); content: the picture inside letterbox bars, in 0..1. Returns [{ x, y, score }] in px.
 */
/** avoid(u, v) (0…1 of the frame): spots it rejects (a person in front) never take a slot from the scene behind; minScore lowers
 * the bar for scenes whose only background is plain (a ceiling, a sky with clouds)
 * @param {ArrayLike<number>} gray @param {number} w @param {number} h
 * @param {{ count?: number, content?: { x: number, y: number, w: number, h: number }, separation?: number, avoid?: ((u: number, v: number) => boolean) | null, minScore?: number }} [options] */
export function suggestSpots(gray, w, h, { count = 8, content = { x: 0, y: 0, w: 1, h: 1 }, separation = 0.2, avoid = null, minScore = GOOD } = {}) {
  const score = cornerScores(gray, w, h), size = Math.max(14, Math.round(w / 9)), step = Math.max(3, Math.round(w / 45));
  const x0 = Math.max(size, content.x * w + 0.05 * w), x1 = Math.min(w - size, (content.x + content.w) * w - 0.05 * w), y0 = Math.max(size, content.y * h + 0.05 * h), y1 = Math.min(h - size, (content.y + content.h) * h - 0.05 * h);
  const cands = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) { const s = score(x, y, size); if (s >= minScore && !avoid?.(x / w, y / h)) cands.push({ x, y, score: s }); }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) { if (out.length >= count) break; if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > separation * w)) out.push(c); }
  return out;
}
