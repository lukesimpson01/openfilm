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
 * A mode the scan cannot support falls back to the simpler one (corridor needs measured forward motion). */
import { transformAt, homography, inv3, apply } from './track-core.js';

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
  return { result, track, matte: matte && atlases.every(Boolean) ? { ...matte, images: atlases } : null, foe };
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
export function rippleGeometryAt(scene, t, { want = 'scene', origin = [.5, .5], start = t, surfaceQuad = null, aspect = 9 / 16 } = {}) {
  if (!scene || want === 'screen') return { mode: 0, M: IDENTITY, origin, vp: origin, matte: null };
  const { track } = scene, n = (time) => normalise(transformAt(track, time), track.w, track.h);
  const Ht = n(t), back = inv3(Ht), H0 = n(start), back0 = inv3(H0);
  if (!back || !back0) return { mode: 0, M: IDENTITY, origin, vp: origin, matte: matteAt(scene.matte, t) };
  const originRef = apply(back0, origin);
  const matte = matteAt(scene.matte, t);
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
