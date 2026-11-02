/* The camera solve's landmarks as the picture's own placement targets, the way a camera tracker shows them: every solved
   point sits on the footage as a small target; hovering between three of them shows the plane they lie on, and a click puts
   text on that plane (several selected points give a best-fit plane). Everything here is derived from the reconstruction. */
import { spatialPoseAt, projectWorld, fitPlane, anchorFromGeometry, anchorQuad } from './spatial-geometry.js';

const cache = new WeakMap();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Reliable landmarks seen in this frame, thinned so no two targets crowd each other. x/y are in the units of (w, h). */
export function projectedTrackPoints(solution, time, w, h, max = 14) {
  const pose = solution && spatialPoseAt(solution, Math.round(time * 1e6)); if (!pose) return [];
  const shot = solution.shots.find((s) => s.id === pose.shotId); if (!shot?.points?.length) return [];
  let good = cache.get(shot); if (!good) { good = shot.points.filter((p) => (p.error ?? 0) < 1.2 && (p.observations ?? 3) >= 4); if (good.length < 30) good = shot.points; cache.set(shot, good); }
  /* the few most useful targets: the best-observed, lowest-error landmarks first, one per cell of an even grid, so the picture stays clean */
  const cell = Math.max(10, Math.sqrt(solution.width * solution.height / max)), taken = new Set(), out = [];
  const ranked = [...good].sort((a, b) => ((b.observations ?? 3) / (1 + (b.error ?? 0))) - ((a.observations ?? 3) / (1 + (a.error ?? 0))));
  for (const p of ranked) {
    if (out.length >= max) break;
    const q = projectWorld(p.xyz, pose); if (!q || q.depth <= 0 || q.x < 4 || q.y < 4 || q.x > solution.width - 4 || q.y > solution.height - 4) continue;
    const key = Math.floor(q.x / cell) + ':' + Math.floor(q.y / cell); if (taken.has(key)) continue; taken.add(key);
    out.push({ id: p.id, xyz: p.xyz, x: q.x / solution.width * w, y: q.y / solution.height * h, depth: q.depth });
  }
  return out;
}

const area2 = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const contains = (a, b, c, p) => { const d1 = area2(p, a, b), d2 = area2(p, b, c), d3 = area2(p, c, a); return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); };

/** The three targets around a cursor position: the smallest triangle of the nearest targets that contains it, else the nearest three. */
export function nearestTriangle(points, x, y, reach = 0.12) {
  if (points.length < 3) return null; const here = { x, y };
  const near = points.map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d).slice(0, 9).map((n) => n.p); let best = null;
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (let k = j + 1; k < near.length; k++) {
    const a = near[i], b = near[j], c = near[k], area = Math.abs(area2(a, b, c)) / 2; if (area < 1e-9) continue;
    if (!contains(a, b, c, here)) continue; if (!best || area < best.area) best = { tri: [a, b, c], area };
  }
  if (!best) { const t = near.slice(0, 3); if (Math.abs(area2(...t)) < 1e-9 || Math.hypot((t[0].x + t[1].x + t[2].x) / 3 - x, (t[0].y + t[1].y + t[2].y) / 3 - y) > reach) return null; best = { tri: t }; }
  return best.tri;
}

/** A persistent surface anchor from landmarks: the best-fit plane through them, the text's basis taken from gravity as for any surface pin. */
export function anchorFromPoints(solution, timeUs, pts) {
  if (pts.length < 3) return null;
  const xyz = pts.map((p) => p.xyz), fit = fitPlane(xyz); if (!fit) return null;
  const mid = xyz.reduce((a, p) => [a[0] + p[0] / xyz.length, a[1] + p[1] / xyz.length, a[2] + p[2] / xyz.length], [0, 0, 0]), onPlane = sub(mid, [0, 0, 0]);
  const d = dot(sub(mid, fit.point), fit.normal), position = [mid[0] - fit.normal[0] * d, mid[1] - fit.normal[1] * d, mid[2] - fit.normal[2] * d];
  let anchor; try { anchor = anchorFromGeometry(solution, timeUs, position, fit.normal); } catch { return null; }
  const spread = Math.max(...xyz.map((p) => Math.hypot(...sub(p, position))));
  return { ...anchor, support: pts.length, planeError: fit.error, fromPoints: pts.map((p) => p.id), size: Math.max(spread * 1.2, 1e-4), manual: pts.length > 3 || undefined, _unused: onPlane ? undefined : undefined };
}

/** The translucent target for a set of landmarks in the current frame: the plane's quad in (w, h) units, or null when it faces away. */
export function targetQuad(solution, time, anchor, w, h) {
  const pose = spatialPoseAt(solution, Math.round(time * 1e6)); if (!pose || !anchor) return null;
  const q = anchorQuad(anchor, anchor.size * 1.6, anchor.size * 1.1, pose); if (!q) return null;
  return q.map((p) => [p.x / solution.width * w, p.y / solution.height * h]);
}

/** The target as a circle lying on the plane: its outline in (w, h) units, drawn in the plane's own perspective. */
export function targetRing(solution, time, anchor, w, h, segments = 40) {
  const pose = spatialPoseAt(solution, Math.round(time * 1e6)); if (!pose || !anchor) return null;
  const r = anchor.size * .5, out = [];
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    const q = projectWorld([anchor.position[0] + anchor.right[0] * c + anchor.down[0] * s, anchor.position[1] + anchor.right[1] * c + anchor.down[1] * s, anchor.position[2] + anchor.right[2] * c + anchor.down[2] * s], pose);
    if (!q) return null; out.push([q.x / solution.width * w, q.y / solution.height * h]);
  }
  return out;
}
