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
