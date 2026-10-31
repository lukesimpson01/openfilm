import {apply,homography} from './track-core.js';
/* Shared by scan, placement guides and exported pages. Coordinates stay in source pixels,
   including embedded letterboxing; depth is relative to the tracked plane, not measured metres. */
export const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
export function proxySize(w, h, longest) {
  const k = Math.min(1, longest / Math.max(w, h));
  return { w: Math.max(2, Math.round(w * k / 2) * 2), h: Math.max(2, Math.round(h * k / 2) * 2) };
}
export function contentRect(gray, w, h) {
  // Only crop symmetric, consistently near-black bars. A dark scene alone is not a portrait inset.
  const row = y => { let n = 0; for (let x = 0; x < w; x++) if (gray[y * w + x] > 18) n++; return n / w < .015; };
  const col = x => { let n = 0; for (let y = 0; y < h; y++) if (gray[y * w + x] > 18) n++; return n / h < .015; };
  let l = 0, r = w - 1, t = 0, b = h - 1;
  while (l < w * .42 && col(l)) l++; while (r > w * .58 && col(r)) r--;
  while (t < h * .42 && row(t)) t++; while (b > h * .58 && row(b)) b--;
  if (Math.abs(l - (w - 1 - r)) > w * .025 || l < w * .025) { l = 0; r = w - 1; }
  if (Math.abs(t - (h - 1 - b)) > h * .025 || t < h * .025) { t = 0; b = h - 1; }
  let bright = 0, n = 0;
  for (let y = t; y <= b; y += 3) for (let x = l; x <= r; x += 3) { n++; if (gray[y * w + x] > 32) bright++; }
  if (!n || bright / n < .12) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: l / w, y: t / h, w: (r - l + 1) / w, h: (b - t + 1) / h };
}
export function footageRect(W, H, w, h, box, fit = 'contain') {
  const B = box ?? { x: 0, y: 0, w: W, h: H };
  const bw = B.w ?? W, bh = B.h ?? H;
  const k = fit === 'cover' ? Math.max(bw / w, bh / h) : Math.min(bw / w, bh / h);
  return { x: (B.x + (bw - w * k) / 2) / W, y: (B.y + (bh - h * k) / 2) / H, w: w * k / W, h: h * k / H };
}
export const clipFit = clip => /object-fit\s*:\s*cover/.test(clip?.style ?? '') ? 'cover' : 'contain';
export function depthFactor(depth = .5) { return 1.65 - clamp(depth) * 1.1; }
/** Surface pins follow the measured plane at every distance. Relative size/occlusion is applied by the renderer;
 * mixing camera transforms by depth creates a new, unobserved plane and can flip as the camera passes it. */
export function surfaceDepthMatrix(H,_quad,_depth=.5){ return H; }

export function placedPoint(H, anchor, depth = .5) {
  const [x, y] = anchor, z = H[6] * x + H[7] * y + H[8];
  const k = depthFactor(depth);
  return [x + ((H[0] * x + H[1] * y + H[2]) / z - x) * k, y + ((H[3] * x + H[4] * y + H[5]) / z - y) * k];
}
export function referencePoint(H, point, depth = .5) {
  let p = [...point];
  for (let i = 0; i < 10; i++) {
    const q = placedPoint(H, p, depth), a = placedPoint(H, [p[0] + .1, p[1]], depth), b = placedPoint(H, [p[0], p[1] + .1], depth);
    const ax = (a[0]-q[0])*10, ay = (a[1]-q[1])*10, bx = (b[0]-q[0])*10, by = (b[1]-q[1])*10, det = ax*by-ay*bx;
    if (Math.abs(det) < 1e-8) break;
    const dx = point[0]-q[0], dy = point[1]-q[1]; p[0] += (dx*by-dy*bx)/det; p[1] += (dy*ax-dx*ay)/det;
    if (Math.hypot(dx,dy)<.001) break;
  }
  return p;
}
export function fitItem(item, content, w, h) {
  const R = content ?? { x: 0, y: 0, w: 1, h: 1 };
  // Conservative width estimate including glyph padding and spacing; preserves user size edits later.
  const chars = Math.max(2, [...String(item.text ?? '')].length);
  const size = Math.min(item.size, h * R.h * .32, w * R.w * .82 / (chars * .46));
  return { ...item, size, anchor: [clamp(item.anchor[0], w * R.x + size * .3, w * (R.x + R.w) - size * .3), clamp(item.anchor[1], h * R.y + size, h * (R.y + R.h) - h * .025)] };
}
