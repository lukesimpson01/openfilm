/* The environment for Clyra's ripple: what the 3D scan already measured, turned into the few numbers the ripple shader
 * needs each frame. Nothing is analysed again here — the scan's camera homographies (reference frame → each frame),
 * its foreground matte atlas and, when the ripple was placed on a surface, that surface's four corners.
 *
 * Geometry modes (the shader measures the wave's distance in the space each one gives):
 *   0 screen   — the frame itself (no scan, or the effect is screen-space by choice)
 *   1 scene    — the reference frame of the shot: each pixel is taken back through the camera homography, so the wave
 *                stays where it was started while the camera moves
 *   2 surface  — scene, then the chosen surface rectified (its quad mapped to a rectangle of its own proportions): rings
 *                on a wall are ellipses foreshortened by the wall's real perspective
 *   3 corridor — a walking-forward shot: depth read from the vanishing point (the camera's focus of expansion, measured
 *                from the homographies) through a box of connected floor, walls and ceiling; the wave travels down it
 *   4 corridor, solved — the same box, driven by the scan's 3D camera solve: the vanishing point each frame is where
 *                the camera is heading, depth is measured in units of the scene's own median depth, and the wave is
 *                offset by how far the camera has actually walked, so a crest stays at one place in the corridor
 * A mode the scan cannot support falls back to the simpler one (corridor needs measured forward motion). */
import { transformAt, homography, inv3, apply } from './track-core.js';
import { spatialPoseAt } from './spatial-geometry.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const norm = (H) => H.map((v) => v / (H[8] || 1));

/** A homography in track pixels as one in normalised source coordinates (0…1 both ways). */
export function normalise(H, w, h) {
  const S = [w, 0, 0, 0, h, 0, 0, 0, 1], Si = [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1];
  return norm(mul(Si, mul(H, S)));
}
function mul(A, B) { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return C; }

/**
 * The camera's focus of expansion between the reference frame and a later one: the point the homography leaves in place
 * while everything else moves away from it (a camera walking forward). Null when the shot does not move forward enough
 * (scale under 2 %) or the fixed point is off the frame: a corridor model is then not supported by the footage.
 */
export function focusOfExpansion(Hn) {
  const s = Math.sqrt(Math.abs(Hn[0] * Hn[4] - Hn[1] * Hn[3]));
  if (!(s > 1.02)) return null;
  let best = null, bestD = Infinity;
  const residual = (x, y) => { const q = apply(Hn, [x, y]); return Math.hypot(q[0] - x, q[1] - y); };
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const x = -.25 + i * 1.5 / 40, y = -.25 + j * 1.5 / 40, d = residual(x, y); if (d < bestD) { bestD = d; best = [x, y]; } }
  let step = 1.5 / 40;
  for (let it = 0; it < 30; it++) { let moved = false; for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) { const d = residual(best[0] + dx, best[1] + dy); if (d < bestD) { bestD = d; best = [best[0] + dx, best[1] + dy]; moved = true; } } if (!moved) step /= 2; }
  return best[0] >= 0 && best[0] <= 1 && best[1] >= 0 && best[1] <= 1 && bestD < .01 ? best : null;
}

/** The surface quad (reference-frame, normalised) mapped to a rectangle of its own measured proportions. */
export function rectifier(quad, aspect) {
  const d = (a, b) => Math.hypot((a[0] - b[0]) * aspect, a[1] - b[1]);
  const wq = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2, hq = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2, r = wq / Math.max(1e-6, hq);
  const H = homography(quad, [[0, 0], [r, 0], [r, 1], [0, 1]]);
  return H ? norm(H) : null;
}

/** Everything the scan gives, loaded once. `fetchJson(path)` / `loadImage(path)` read project files. */
export async function loadRippleScene(resultPath, { fetchJson, loadImage }) {
  const result = await fetchJson(resultPath);
  if (!result?.track) return null;
  const track = await fetchJson(result.track);
  if (!track?.frames?.length) return null;
  const matte = result.matte ? await fetchJson(result.matte) : null;
  const atlases = matte?.atlases ? await Promise.all(matte.atlases.map((p) => loadImage(p))) : [];
  /* forward motion over the shot: the reference frame against the last verified frame */
  const last = [...track.frames].reverse().find((f) => !f.lost);
  const foe = last ? focusOfExpansion(normalise(last.H, track.w, track.h)) : null;
  const solution = result.spatial ? await fetchJson(result.spatial) : null;
  return { result, track, matte: matte && atlases.every(Boolean) ? { ...matte, images: atlases } : null, foe, solution: solution?.shots?.length ? solution : null };
}


const center = (pose) => { const R = pose.worldToCamera.map((r) => r.slice(0, 3)), t = pose.worldToCamera.map((r) => r[3]); return [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2])); };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Where world direction d vanishes in a pose's frame, as a normalised point; null when d points sideways (under
 * `forward` of its length toward the view) or back. */
function headingPoint(solution, pose, d, forward = 0.35) {
  const R = pose.worldToCamera.map((r) => r.slice(0, 3)), q = R.map((r) => dot3(r, d)), K = pose.intrinsics;
  if (!(q[2] > forward * Math.hypot(...q))) return null;
  return [(K[0][0] * q[0] / q[2] + K[0][2]) / solution.width, (K[1][1] * q[1] / q[2] + K[1][2]) / solution.height];
}
/** Depth through the corridor box at a normalised point, seen from vanishing point vp (the shader's own formula). */
export const tunnelDepth = (p, vp, aspect) => 1 / Math.max(Math.abs((p[0] - vp[0]) * aspect) / (0.5 * aspect), Math.abs(p[1] - vp[1]) / 0.5, 0.03);
/**
 * The solved corridor at source second t: null unless the camera solve covers t and the start, and the camera really
 * walks forward (at least a tenth of the scene's depth, heading into the view rather than sideways).
 */
export function solvedCorridor(solution, t, { start = t, origin = [0.5, 0.5], aspect = 9 / 16 } = {}) {
  const at = (s) => spatialPoseAt(solution, Math.round(s * 1e6)), p0 = at(start), pt = at(t);
  if (!p0 || !pt || p0.shotId !== pt.shotId) return null;
  const shot = solution.shots.find((s) => s.id === p0.shotId), first = shot.poses[0], last = shot.poses[shot.poses.length - 1];
  const travel = sub3(center(last), center(first)), length = Math.hypot(...travel);
  /* the scene's own depth unit: the median depth of the solved points the start frame sees */
  const R = p0.worldToCamera; const depths = [];
  for (const point of shot.points ?? []) { const z = dot3(R[2].slice(0, 3), point.xyz) + R[2][3]; if (z > 0) depths.push(z); }
  depths.sort((a, b) => a - b); const D = depths[depths.length >> 1];
  if (!(D > 0) || !(length > 0.1 * D)) return null;
  const heading = travel.map((v) => v / length);
  /* the corridor is one direction of the world (the way the camera walks): its vanishing point in each frame is that
     direction seen by that frame's camera, so it moves exactly as the scene does while the camera turns. It must face
     into the view at the start; later it may swing far to a side (the box then reaches past the frame edge) */
  const vp0 = headingPoint(solution, p0, heading), vp = headingPoint(solution, pt, heading, 0.08);
  if (!vp0 || !vp) return null;
  return { vp, z0: tunnelDepth(origin, vp0, aspect), advance: dot3(sub3(center(pt), center(p0)), heading) / D };
}
/** The matte frame nearest a source second, as an image and the sub-rectangle of its atlas (0…1). */
export function matteAt(matte, t) {
  if (!matte?.images?.length) return null;
  let i;
  if (Array.isArray(matte.times) && matte.times.length) { let lo = 0, hi = matte.times.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (matte.times[m] <= t) lo = m; else hi = m; } i = Math.abs(matte.times[hi] - t) < Math.abs(matte.times[lo] - t) ? hi : lo; }
  else i = Math.round((t - (matte.start ?? 0)) * matte.fps);
  i = Math.max(0, Math.min(matte.count - 1, i));
  /* a matte frame far from this moment is not this moment's people */
  if (Array.isArray(matte.times) && Math.abs(matte.times[i] - t) > 1.5 / (matte.fps || 10)) return null;
  const per = matte.cols * matte.rows, a = Math.floor(i / per), j = i % per;
  return { image: matte.images[a], rect: [(j % matte.cols) / matte.cols, Math.floor(j / matte.cols) / matte.rows, 1 / matte.cols, 1 / matte.rows] };
}

/**
 * What the shader needs at source second t. `origin` is the ripple's start point in source coordinates at the effect's
 * first frame (start). Returns { mode, M (frame → distance space, row-major), origin (in distance space), vp, matte }.
 */
/**
 * Whether the solved corridor holds for the whole of a ripple (start … end): its vanishing point must stay near the
 * frame and move smoothly. A camera that turns to face sideways mid-ripple fails this, and the ripple then uses the
 * scene model for its whole length — never a switch of model partway through, which would be a visible jump.
 */
export function corridorHolds(solution, start, end, origin, aspect) {
  let previous = null;
  for (let t = start; t <= end + 1e-6; t += 1 / 30) {
    const c = solvedCorridor(solution, t, { start, origin, aspect });
    if (!c || c.vp[0] < -0.6 || c.vp[0] > 1.6 || c.vp[1] < -0.6 || c.vp[1] > 1.6) return false;
    if (previous && Math.hypot(c.vp[0] - previous[0], c.vp[1] - previous[1]) > 0.2) return false;
    previous = c.vp;
  }
  return true;
}

export function rippleGeometryAt(scene, t, { want = 'scene', origin = [.5, .5], start = t, end = null, surfaceQuad = null, aspect = 9 / 16 } = {}) {
  if (!scene || want === 'screen') return { mode: 0, M: IDENTITY, origin, vp: origin, matte: null };
  const { track } = scene, n = (time) => normalise(transformAt(track, time), track.w, track.h);
  const Ht = n(t), back = inv3(Ht), H0 = n(start), back0 = inv3(H0);
  if (!back || !back0) return { mode: 0, M: IDENTITY, origin, vp: origin, matte: matteAt(scene.matte, t) };
  const originRef = apply(back0, origin);
  const matte = matteAt(scene.matte, t);
  if (want === 'corridor' && scene.solution) {
    /* decided once per ripple (its start, end and origin), then reused for every frame */
    const key = `${start}:${end}:${origin}`;
    if (scene.corridorKey !== key) { scene.corridorKey = key; scene.corridorOk = end == null || corridorHolds(scene.solution, start, end, origin, aspect); }
    const c = scene.corridorOk ? solvedCorridor(scene.solution, t, { start, origin, aspect }) : null;
    if (c) return { mode: 4, M: IDENTITY, origin: [c.z0, c.advance], vp: c.vp, matte };
  }
  if (want === 'corridor' && scene.foe) {
    /* measured in the reference frame, where a forward walk is a scaling about the focus of expansion: a crest at one
       corridor depth stays at that depth while the camera walks on */
    return { mode: 3, M: norm(back), origin: originRef, vp: scene.foe, matte };
  }
  if ((want === 'surface' || want === 'corridor') && surfaceQuad) {
    const R = rectifier(surfaceQuad, aspect);
    if (R) return { mode: 2, M: norm(mul(R, back)), origin: apply(R, originRef), vp: origin, matte };
  }
  return { mode: 1, M: norm(back), origin: originRef, vp: origin, matte };
}
