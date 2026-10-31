/* A person printed on a poster, a face on a screen, a figure in a painting: the segmenter calls them people, but they are
   part of the surface the text is placed on, so they must not cover it. Real passers-by move across the surface; a
   printed one stays at the same place in the surface's own coordinates, frame after frame. */
import { transformAt, inv3, apply } from './track-core.js';

const inside = (p, quad) => { let sign = 0; for (let i = 0; i < quad.length; i++) { const a = quad[i], b = quad[(i + 1) % quad.length], c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (Math.abs(c) < 1e-9) continue; if (sign && Math.sign(c) !== sign) return false; sign = Math.sign(c); } return true; };
const median = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

/**
 * matte: the scan's mask meta ({ times, frames:[{ subjects:[{ box:[x0,y0,x1,y1] }] }] }, boxes in tracker px);
 * track: the surface's track (its reference coordinates are the quad's); quad: the surface in reference px.
 * Returns the printed subject's box in reference px, or null when every subject over the surface moves across it.
 */
export function printedOnSurface(matte, track, quad) {
  if (!matte?.frames?.length || !track?.frames?.length || !quad?.length) return null;
  const width = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]) || 1, hits = [];
  let visible = 0;
  matte.frames.forEach((f, i) => {
    const t = matte.times?.[i]; if (!Number.isFinite(t) || !f) return;
    const H = transformAt(track, t), Hi = inv3(H); if (!Hi) return;
    const now = quad.map((p) => apply(H, p)); visible++;
    for (const s of f.subjects ?? []) {
      const b = s.box, c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
      if (!inside(c, now)) continue;
      const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map((p) => apply(Hi, p));
      hits.push({ i, at: apply(Hi, c), corners });
    }
  });
  if (hits.length < 4) return null;
  const mx = median(hits.map((h) => h.at[0])), my = median(hits.map((h) => h.at[1])), r = 0.08 * width;
  const still = hits.filter((h) => Math.hypot(h.at[0] - mx, h.at[1] - my) < r), frames = new Set(still.map((h) => h.i)).size;
  if (frames < Math.max(4, visible * 0.4)) return null;
  const xs = still.flatMap((h) => h.corners.map((p) => p[0])), ys = still.flatMap((h) => h.corners.map((p) => p[1]));
  return [median(xs.filter((x) => x <= mx)), median(ys.filter((y) => y <= my)), median(xs.filter((x) => x >= mx)), median(ys.filter((y) => y >= my))];
}

/**
 * Who walks across the element and when: the stretch where detected people overlap its surface (printed figures
 * excluded), at most `longest` seconds from the first overlap, with those people's boxes on that first frame (0…1 of
 * the frame) so a precise segmenter can follow exactly them. Null when nobody crosses it.
 * @param {any} matte @param {any} track @param {number[][]} quad
 * @param {{ w: number, h: number, longest?: number, pad?: number }} opts
 * @returns {{ from: number, to: number, instances: { box: number[] }[] } | null}
 */
export function crossingPeople(matte, track, quad, { w, h, longest = 4, pad = 0.15 }) {
  if (!matte?.frames?.length || !track?.frames?.length || !quad?.length || !w || !h) return null;
  const overlaps = (b, q) => { const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), mx = (x1 - x0) * pad, my = (y1 - y0) * pad; return b[2] > x0 - mx && b[0] < x1 + mx && b[3] > y0 - my && b[1] < y1 + my; };
  let start = -1, boxes = [], end = -1;
  matte.frames.forEach((f, i) => {
    const t = matte.times?.[i]; if (!Number.isFinite(t) || !f) return;
    const H = transformAt(track, t), q = quad.map((p) => apply(H, p)), bottom = Math.max(...q.map((p) => p[1])), top = Math.min(...q.map((p) => p[1]));
    const across = (f.subjects ?? []).filter((s) => { const b = s.box, c4 = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; const printed = c4.every((c) => inside(c, q)) && b[3] < bottom - 0.08 * (bottom - top); return !printed && overlaps(b, q); });
    if (!across.length) return;
    if (start < 0) { start = t; boxes = across.slice(0, 4).map((s) => [s.box[0] / w, s.box[1] / h, s.box[2] / w, s.box[3] / h]); }
    if (t - start <= longest) end = t;
  });
  if (start < 0) return null;
  return { from: Math.max(0, start - 0.05), to: Math.max(end, start + 0.5) + 0.2, instances: boxes.map((box) => ({ box: box.map((v) => Math.min(1, Math.max(0, v))) })) };
}
