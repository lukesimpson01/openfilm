/* Local surface: the wall, floor or door under a click, found from the footage itself (no model, no network).
   1. a patch around the click is tracked as a plane over the whole shot, forward and backward from the click's frame;
   2. how that patch deforms as the camera moves gives the surface's orientation (homography decomposition), so text
      lies on the surface the way it does in the world, not flat on the screen;
   3. frames where the patch cannot be followed continue with the whole camera's motion instead of vanishing.
   Everything here works on small grayscale proxies and is exact in the tracker's pixel space. */
import { createTracker, inv3, mul3, apply } from './track-core.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const scale3 = (v, k) => [v[0] * k, v[1] * k, v[2] * k];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;

export const intrinsics = (w, h, focal = 0.75 * Math.max(w, h)) => [focal, 0, w / 2, 0, focal, h / 2, 0, 0, 1];

/** eigen-decomposition of a symmetric 3x3 (Jacobi): values descending, vectors as columns of V (array of 3 vectors) */
function eigenSym(M) {
  const A = M.map((r) => [...r]), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += A[i][j] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < 2; p++) for (let q = p + 1; q < 3; q++) {
      if (Math.abs(A[p][q]) < 1e-18) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const kp = A[k][p], kq = A[k][q]; A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = A[p][k], qk = A[q][k]; A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = V[k][p], kq = V[k][q]; V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq; }
    }
  }
  const order = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]);
  return { values: order.map((i) => A[i][i]), vectors: order.map((i) => [V[0][i], V[1][i], V[2][i]]) };
}

/**
 * The two candidate unit normals (camera frame of the reference view, pointing away from the camera) of the plane that
 * moved by the pixel homography H, for intrinsics K. Null when there is too little parallax to tell (pure turning).
 */
export function normalCandidates(H, K) {
  const Ki = inv3(K); if (!Ki) return null;
  let M = mul3(Ki, mul3(H, K)); const d = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null; if (d < 0) M = M.map((v) => -v);
  const HtH = [0, 1, 2].map((i) => [0, 1, 2].map((j) => M[i] * M[j] + M[3 + i] * M[3 + j] + M[6 + i] * M[6 + j]));
  const { values, vectors } = eigenSym(HtH); if (!(values[1] > 1e-9)) return null;
  const l1 = values[0] / values[1], l3 = values[2] / values[1];
  if (!(l1 - l3 > 0.0008)) return null; /* no parallax: the camera only turned */
  const [v1, v2, v3] = vectors, a = Math.sqrt(Math.max(0, 1 - l3)), b = Math.sqrt(Math.max(0, l1 - 1)), k = Math.sqrt(l1 - l3);
  const s2 = Math.sqrt(values[1]), Mn = M.map((v) => v / s2), mv = (v) => [Mn[0] * v[0] + Mn[1] * v[1] + Mn[2] * v[2], Mn[3] * v[0] + Mn[4] * v[1] + Mn[5] * v[2], Mn[6] * v[0] + Mn[7] * v[1] + Mn[8] * v[2]];
  const out = [];
  for (const s of [1, -1]) {
    const u = scale3(add3(scale3(v1, a), scale3(v3, s * b)), 1 / k);
    let n = norm(cross(v2, u)); if (n[2] < 0) n = scale3(n, -1);
    /* the camera turn that goes with this solution: handheld footage turns little, the mirror solution often turns a lot */
    const U = [v2, u, cross(v2, u)], Wc = [mv(v2), mv(u), cross(mv(v2), mv(u))];
    let tr = 0; for (let c = 0; c < 3; c++) tr += dot(Wc[c], U[c]);
    const rot = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
    /* R and t/d of this solution, to test that the clicked point stays in front of the second camera (cheirality) */
    const R = [0, 1, 2].map((r) => [0, 1, 2].map((c) => Wc[0][r] * U[0][c] + Wc[1][r] * U[1][c] + Wc[2][r] * U[2][c]));
    const Rn = (v) => [dot(R[0], v), dot(R[1], v), dot(R[2], v)], nn = n, HN = mv(nn), RN = Rn(nn), td = [HN[0] - RN[0], HN[1] - RN[1], HN[2] - RN[2]];
    out.push(Object.assign(n, { rot, td, R }));
  }
  return out;
}

/** the orientation that the frames agree on: one candidate per frame, the combination with the least disagreement */
const turnBetween = (A, B) => { let tr = 0; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += A[r][c] * B[r][c]; return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI; };
/** others: for each frame, the whole scene's homography over the same frames. Every surface in a shot sees the same camera
 * turn, so the solution whose turn matches one of the scene's own solutions is the real one; its mirror usually does not. */
export function surfaceNormal(homographies, K, ray, others = null) {
  /* a surface the click is on must face the camera: the solution whose normal points away from the click's ray is impossible */
  const front = (n) => { if (!ray) return true; const r = [0, 1, 2].map((i) => dot(n.R[i], ray)), depth = r[2] + n.td[2] * dot(n, ray); return dot(n, ray) > 0.08 && depth > 0.02; };
  const sets = homographies.map((H, i) => {
    const c = normalCandidates(H, K)?.filter(front), g = others?.[i] ? normalCandidates(others[i], K) : null;
    if (c && g?.length) for (const n of c) n.agree = Math.min(...g.map((o) => turnBetween(n.R, o.R)));
    return c;
  }).filter((c) => c?.length);
  if (!sets.length) return null;
  /* every frame votes for the orientations it can explain; the one most frames agree on wins, so a few blurred or
     weakly tracked frames cannot drag it away */
  let best = null;
  for (const seed of sets.flat()) {
    const members = sets.map((c) => c.reduce((m, n) => (!m || angle(n, seed) < angle(m, seed) ? n : m), null)).filter((n) => angle(n, seed) < 16);
    if (members.length < Math.max(1, Math.ceil(sets.length / 2))) continue;
    const m = norm(members.reduce((s2, n) => add3(s2, n), [0, 0, 0])), spread = Math.max(...members.map((n) => angle(n, m)));
    /* the two solutions of a homography are mirror images; real surfaces are upright walls or flat floors and a handheld
       camera turns little, so the lean-over or large-turn solution loses */
    const upright = Math.min(Math.abs(m[1]), 1 - Math.abs(m[1])), turn = members.reduce((s2, n) => s2 + n.rot, 0) / members.length;
    const agree = members.reduce((s2, n) => s2 + (n.agree ?? 0), 0) / members.length;
    const score = -25 * members.length + spread + 80 * upright + 2 * turn + 1.5 * agree;
    if (!best || score < best.score) best = { n: m, spread, score, count: members.length, of: sets.length };
  }
  if (!best) return null;
  /* walls stand upright and floors lie flat: a normal within 25° of either snaps to it (the rest is measurement noise) */
  let n = best.n;
  if (Math.abs(n[1]) < 0.42) n = norm([n[0], 0, n[2]]); else if (Math.abs(n[1]) > 0.9) n = [0, Math.sign(n[1]), 0];
  return { normal: n, spread: best.spread, frames: best.count, of: best.of };
}

/** a rectangle on the surface around the click, as the camera sees it: 4 pixel corners (TL TR BR BL) */
export function orientedQuad(click, normal, K, { width = 0.4, aspect = 0.6 } = {}) {
  const f = K[0], cx = K[2], cy = K[5], ray = norm([(click[0] - cx) / f, (click[1] - cy) / f, 1]);
  const lambda = 1 / Math.max(0.05, dot(normal, ray)), C = scale3(ray, lambda);
  const up = [0, -1, 0]; let right = cross(up, normal); if (Math.hypot(...right) < 0.05) right = [1, 0, 0]; right = norm(right); if (right[0] < 0) right = scale3(right, -1);
  let planeUp = norm(cross(normal, right)); if (dot(planeUp, up) < 0) planeUp = scale3(planeUp, -1);
  const project = (P) => [f * P[0] / P[2] + cx, f * P[1] / P[2] + cy];
  const corners = (W) => [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => project(add3(C, add3(scale3(right, sx * W / 2), scale3(planeUp, sy * W * aspect / 2)))));
  let W = 1, q = corners(W); const span = (p) => Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) / 2 + Math.hypot(p[2][0] - p[3][0], p[2][1] - p[3][1]) / 2;
  W = W * (width * 2 * cx) / Math.max(1e-6, span(q)); q = corners(W);
  return q;
}

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** One direction of the patch track, as a tracker result whose reference is the frame at index k. */
function runPatch(grays, times, order, w, h, quad) {
  const tracker = createTracker({ w, h, mode: 'planar', plane: quad, region: [Math.min(...quad.map((p) => p[0])), Math.min(...quad.map((p) => p[1])), Math.max(...quad.map((p) => p[0])), Math.max(...quad.map((p) => p[1]))], adaptive: true, maxPoints: 90, lkWindow: 5, lkIters: 8, thresh: 1.6 });
  for (const i of order) tracker.push(grays[i], times[i]);
  return tracker.result();
}
/**
 * Track the patch `quad` (pixel corners at frame k) through every frame; frames the patch can't be followed continue with
 * the camera's own motion (`global`: the whole-frame tracker's frames, optional). Returns a tracker-shaped result.
 */
export function trackPatch(grays, times, w, h, k, quad, global = null) {
  const n = grays.length, fwd = runPatch(grays, times, Array.from({ length: n - k }, (_, i) => k + i), w, h, quad);
  const bwd = k > 0 ? runPatch(grays, times, Array.from({ length: k + 1 }, (_, i) => k - i), w, h, quad) : null;
  const frames = [...(bwd ? bwd.frames.slice(1).reverse() : []), ...fwd.frames];
  const Gk = global?.frames && frames.length === global.frames.length ? global.frames[k]?.H : null, Gi = Gk && inv3(Gk);
  /* lost frames: a patch that was leaving the picture keeps its own last motion and leaves (a poster walked past moves
     much faster than the distant street the camera track follows); one lost anywhere else continues with the camera */
  const cx = quad.reduce((s2, p) => s2 + p[0], 0) / 4, cy = quad.reduce((s2, p) => s2 + p[1], 0) / 4;
  const leaving = (A, B) => { const a = apply(A, [cx, cy]), b = apply(B, [cx, cy]), m = 0.14; const nearX = b[0] < w * m ? -1 : b[0] > w * (1 - m) ? 1 : 0, nearY = b[1] < h * m ? -1 : b[1] > h * (1 - m) ? 1 : 0; return (nearX && Math.sign(b[0] - a[0]) === nearX) || (nearY && Math.sign(b[1] - a[1]) === nearY); };
  const extend = (order) => {
    let lastGood = null, prevGood = null, lastG = null, run = null;
    for (const i of order) {
      const f = frames[i];
      if (!f.lost && !f.assumed) { prevGood = lastGood; lastGood = f.H; lastG = global?.frames?.[i]?.H ?? null; run = null; continue; }
      if (!f.lost) continue;
      if (lastGood && prevGood && (run || leaving(prevGood, lastGood))) { const Pi = inv3(prevGood); if (Pi) { run = run ? mul3(mul3(lastGood, Pi), run) : mul3(mul3(lastGood, Pi), lastGood); f.H = run; f.lost = false; f.assumed = true; continue; } }
      const G = global?.frames?.[i]?.H;
      if (lastGood && lastG && G && inv3(lastG)) { f.H = mul3(G, mul3(inv3(lastG), lastGood)); f.lost = false; f.assumed = true; }
    }
  };
  /* a patch that has mostly left the picture is gone: whatever it still "finds" there is the background behind it */
  const shown = (H) => { const q = quad.map((p) => apply(H, p)), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), A = (x1 - x0) * (y1 - y0); if (!(A > 0) || !Number.isFinite(A)) return 0; return Math.max(0, Math.min(w, x1) - Math.max(0, x0)) * Math.max(0, Math.min(h, y1) - Math.max(0, y0)) / A; };
  for (const order of [Array.from({ length: frames.length - k - 1 }, (_, j) => k + 1 + j), Array.from({ length: k }, (_, j) => k - 1 - j)]) {
    let gone = false; for (const i of order) { const f = frames[i]; if (!gone && !f.lost && shown(f.H) < 0.35) gone = true; if (gone) { f.lost = true; f.assumed = false; f.left = true; } }
  }
  extend(Array.from({ length: frames.length - k }, (_, j) => k + j));
  extend(Array.from({ length: k + 1 }, (_, j) => k - j));
  const lost = frames.filter((f) => f.lost).length / Math.max(1, frames.length), good = frames.filter((f) => Number.isFinite(f.err) && !f.assumed);
  const errs = good.map((f) => f.err).sort((a, b) => a - b), med = errs[errs.length >> 1] ?? Infinity;
  const quality = lost > 0.1 || med > 2.5 ? 'Poor' : med > 1.2 ? 'Fair' : 'Good';
  return { w, h, mode: 'planar', model: 'homography', plane: quad, frames, cuts: [...(fwd.cuts ?? [])], quality, medianError: med, inlierShare: fwd.inlierShare, lostShare: lost, refPoints: fwd.refPoints ?? [], reference: k, _Gi: Gi ? 1 : 0 };
}

/**
 * Everything for a click on the footage: the tracked patch, the surface orientation and the quad to put text in.
 * click: pixel in the tracker's space at frame index k. Returns { quad, result, normal | null, quality, tilted }.
 */
export function localSurface(grays, times, w, h, k, click, { global = null, focal } = {}) {
  const K = intrinsics(w, h, focal), ray = norm([(click[0] - K[2]) / K[0], (click[1] - K[5]) / K[0], 1]);
  const box = (c, r) => [[c[0] - r, c[1] - r * 1.3], [c[0] + r, c[1] - r * 1.3], [c[0] + r, c[1] + r * 1.3], [c[0] - r, c[1] + r * 1.3]].map(([x, y]) => [Math.min(w - 2, Math.max(1, x)), Math.min(h - 2, Math.max(1, y))]);
  /* three looks at different widths: a small patch is precise but blank walls give it little to hold, a wide one holds
     on but can mix a wall with the door beside it. Orientations the looks agree on are trusted. */
  const t0 = times[k], looks = [];
  const agree = () => { const valid = looks.filter((l) => l.est); let best = null; for (const l of valid) { const group = valid.filter((o) => angle(o.est.normal, l.est.normal) < 25); if (group.length >= 2 && (!best || group.length > best.length)) best = group; } return best; };
  let agreed = null;
  for (const f of [0.24, 0.16, 0.34]) {
    const patch = trackPatch(grays, times, w, h, k, box(click, f * w), global), picks = [];
    for (const dt of [0.2, 0.35, 0.5, 0.7, 0.9, 1.1]) {
      let best = -1, gap = Infinity; patch.frames.forEach((fr, i) => { if (fr.lost || fr.assumed || i === k || !(fr.inliers >= 10)) return; const g = Math.abs(Math.abs(times[i] - t0) - dt); if (g < gap && g < 0.25) { gap = g; best = i; } });
      if (best >= 0) picks.push(best);
    }
    const used = [...new Set(picks)], Gk = global?.frames?.length === grays.length ? inv3(global.frames[k].H) : null;
    const est = surfaceNormal(used.map((i) => patch.frames[i].H), K, ray, Gk ? used.map((i) => mul3(global.frames[i].H, Gk)) : null);
    const upright = est && (Math.abs(est.normal[1]) < 0.05 || Math.abs(est.normal[1]) > 0.95);
    looks.push({ patch, est: est && est.spread < 18 && est.frames >= Math.max(2, Math.ceil(est.of * 0.5)) && upright ? est : null, assumed: patch.frames.filter((fr) => fr.assumed).length });
    agreed = agree(); if (agreed) break; /* two looks agree: no need for the third */
  }
  const probe = looks.reduce((b, l) => (l.assumed < b.assumed ? l : b), looks[0]).patch;
  if (!agreed) return { quad: probe.plane, result: probe, normal: null, spread: null, quality: probe.quality, tilted: false };
  const normal = norm(agreed.reduce((s2, l) => add3(s2, l.est.normal), [0, 0, 0])), quad = orientedQuad(click, normal, K, { width: 0.4 });
  const result = trackPatch(grays, times, w, h, k, quad, global);
  return { quad, result, normal, spread: Math.max(...agreed.map((l) => angle(l.est.normal, normal))), quality: result.quality, tilted: true };
}
export { apply };
