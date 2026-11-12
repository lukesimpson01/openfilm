/* Photometric refinement of a surface pin.
 *
 * The sparse reconstruction fixes the camera well, but the plane under a click is fitted to a handful of landmarks, so on
 * a wall with few of them its tilt can be a few degrees off — and text pinned to it then swims against the wall. The
 * footage itself is the better judge: if the plane (and the solved cameras) are right, every other frame warped through
 * that plane lines up with the reference frame. This searches the plane's two tilt angles and its distance for the
 * setting under which the wall texture agrees across the whole clip, then rebuilds the same persistent anchor from it.
 * One plane for the whole shot, never a per-frame estimate. */
import { spatialPoseAt, cameraRay, rayPlane, anchorFromGeometry, projectWorld } from './spatial-geometry.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mulM = (R, p) => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];
const matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const transpose = (R) => [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];

/** Rotation of v about unit axis k by angle a (Rodrigues). */
const rotate = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c); return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd]; };

function sample(frame, x, y) {
  if (x < 0 || y < 0 || x > frame.w - 1.001 || y > frame.h - 1.001) return -1;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, g = frame.gray, i = y0 * frame.w + x0;
  return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + frame.w] * (1 - fx) * fy + g[i + frame.w + 1] * fx * fy;
}

function zncc(a, b) {
  const n = a.length; let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa < 1e-6 || sbb < 1e-6 ? 0 : sab / Math.sqrt(saa * sbb);
}

/**
 * @param anchor     the surface anchor from surfaceAnchor()/anchorFromGeometry()
 * @param solution   the scene solution (poses in solution pixels)
 * @param frames     [{ timeUs, gray:Uint8Array|Float32Array, w, h }] decoded footage (any resolution; scaled to the solution)
 * @param click      [x, y] in solution pixels, in the reference frame
 * @param refTimeUs  the frame the click was made in
 * @returns {{ anchor, improved:boolean, before:number, after:number, tiltDeg:number, scale:number, frames:number }}
 */
export function refineSurfaceAnchor(anchor, solution, frames, click, refTimeUs, options = {}) {
  // A cancelled or partially decoded scan must not interrupt placement.
  if (!Array.isArray(frames) || !frames.length || !solution?.width || !solution?.height) return { anchor, improved: false, reason: 'no reference frame', frames: 0 };
  const ref = frames.reduce((a, b) => Math.abs(b.timeUs - refTimeUs) < Math.abs(a.timeUs - refTimeUs) ? b : a);
  if (!ref?.gray || ref.gray.length !== ref.w * ref.h || ref.w < 20 || ref.h < 20) return { anchor, improved: false, reason: 'incomplete reference frame', frames: 0 };
  const refPose = spatialPoseAt(solution, ref.timeUs);  /* the pose of the very frame the patch is read from */
  if (!refPose) return { anchor, improved: false, reason: 'no camera pose', frames: 0 };
  const sx = ref.w / solution.width, sy = ref.h / solution.height, Kp = refPose.intrinsics;
  const K = [[Kp[0][0] * sx, 0, Kp[0][2] * sx], [0, Kp[1][1] * sy, Kp[1][2] * sy], [0, 0, 1]], Kinv = [[1 / K[0][0], 0, -K[0][2] / K[0][0]], [0, 1 / K[1][1], -K[1][2] / K[1][1]], [0, 0, 1]];
  const Rr = refPose.worldToCamera.map((r) => r.slice(0, 3)), tr = refPose.worldToCamera.map((r) => r[3]);
  const X0 = mulM(Rr, anchor.position).map((v, i) => v + tr[i]), n0 = unit(mulM(Rr, anchor.normal));
  const cx = click[0] * sx, cy = click[1] * sy, edge = Math.floor(Math.min(cx, cy, ref.w - 1 - cx, ref.h - 1 - cy)) - 2, half = Math.min(options.half ?? Math.min(32, Math.max(10, Math.round(.14 * Math.min(ref.w, ref.h)))), edge), stride = options.stride ?? 3;
  if (half < 8) return { anchor, improved: false, reason: 'the click is too near the frame edge', frames: 0 };
  const grid = []; for (let v = -half; v <= half; v += stride) for (let u = -half; u <= half; u += stride) grid.push([cx + u, cy + v]);
  const refPatch = Float64Array.from(grid, ([x, y]) => sample(ref, x, y));
  if (refPatch.some((v) => v < 0)) return { anchor, improved: false, reason: 'the click is too near the frame edge', frames: 0 };
  /* the patch needs texture to be judged at all */
  let m = 0; for (const v of refPatch) m += v; m /= refPatch.length; let varsum = 0; for (const v of refPatch) varsum += (v - m) ** 2; if (Math.sqrt(varsum / refPatch.length) < 6) return { anchor, improved: false, reason: 'plain surface: nothing to align against', frames: 0 };

  /* per-frame relative pose, computed once */
  const maxFrames = Math.max(8, options.maxFrames ?? 24), step = Math.max(1, Math.ceil(frames.length / maxFrames)), used = [];
  for (let i = 0; i < frames.length; i += step) {
    const f = frames[i]; if (f === ref || !f?.gray || f.gray.length !== f.w * f.h || Math.abs(f.timeUs - refTimeUs) < 1500) continue;
    const pose = spatialPoseAt(solution, f.timeUs); if (!pose || pose.shotId !== refPose.shotId) continue;
    const Rf = pose.worldToCamera.map((r) => r.slice(0, 3)), tf = pose.worldToCamera.map((r) => r[3]), Rrel = matMul(Rf, transpose(Rr)), Rt = mulM(Rrel, tr), trel = tf.map((v, k) => v - Rt[k]);
    used.push({ f, Rrel, trel });
  }
  if (used.length < 4) return { anchor, improved: false, reason: 'too few frames', frames: used.length };

  /* the plane's tilt is searched about two axes perpendicular to its normal; its distance along the click ray */
  let pool = used;
  const t1 = unit(cross(n0, Math.abs(n0[1]) < .9 ? [0, 1, 0] : [1, 0, 0])), t2 = unit(cross(n0, t1)), scratch = new Float64Array(grid.length);
  const cost = (a, b, ls) => {
    let n = rotate(rotate(n0, t1, a), t2, b); n = unit(n); const s = Math.exp(ls), P = [X0[0] * s, X0[1] * s, X0[2] * s], d = dot(n, P); if (Math.abs(d) < 1e-6) return 9; /* d is negative: the normal faces the camera */
    let sum = 0, count = 0;
    for (const { f, Rrel, trel } of pool) {
      /* x_f ~ K (Rrel + trel n^T / d) K^-1 x_ref */
      const A = [0, 1, 2].map((r) => [0, 1, 2].map((c) => Rrel[r][c] + trel[r] * n[c] / d)), H = matMul(matMul(K, A), Kinv);
      let ok = true;
      for (let i = 0; i < grid.length; i++) {
        const [x, y] = grid[i], w = H[2][0] * x + H[2][1] * y + H[2][2]; if (w <= 1e-6) { ok = false; break; }
        const v = sample(f, (H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w); if (v < 0) { ok = false; break; }
        scratch[i] = v;
      }
      if (!ok) { sum += .9; count++; continue; }
      const z = zncc(refPatch, scratch); sum += Math.min(.9, 1 - z); count++;
    }
    return count ? sum / count : 9;
  };

  const limit = (options.maxTiltDeg ?? 28) * Math.PI / 180, lsLimit = Math.log(options.maxScale ?? 1.25);
  /* a wall patch leaves the frame as the camera walks on: judge it only over the frames where it is actually seen (decided at the unrefined plane, then held fixed) */
  const seen = used.filter((u) => { pool = [u]; const c = cost(0, 0, 0); return c < .6; }); pool = seen;
  pool = seen.filter((_, i) => i % 2 === 0);
  if (seen.length < 6) return { anchor, improved: false, reason: 'the patch is seen in too few frames to align', frames: seen.length };
  let p = [0, 0, 0], best = cost(0, 0, 0); const before = best; if (best >= 9) return { anchor, improved: false, reason: 'the reference patch is not visible in enough frames', frames: seen.length };
  let steps = [6 * Math.PI / 180, 6 * Math.PI / 180, .06];
  for (let round = 0; round < 7; round++) {
    let moved = true, guard = 0;
    while (moved && guard++ < 24) {
      moved = false;
      for (let k = 0; k < 3; k++) for (const sign of [1, -1]) {
        const q = p.slice(); q[k] += sign * steps[k]; if (Math.abs(q[0]) > limit || Math.abs(q[1]) > limit || Math.abs(q[2]) > lsLimit) continue;
        const c = cost(q[0], q[1], q[2]); if (c < best - 1e-5) { best = c; p = q; moved = true; }
      }
    }
    steps = steps.map((s) => s / 2);
  }
  const tiltDeg = Math.hypot(p[0], p[1]) * 180 / Math.PI, scale = Math.exp(p[2]);
  /* trust a refinement only if it clearly helps AND helps on frames it was not fitted to */
  const fitted = pool, held = seen.filter((_, i) => i % 2 === 1); pool = held; const heldBefore = cost(0, 0, 0), heldAfter = cost(p[0], p[1], p[2]); pool = fitted;
  const clear = (a, b) => b < a - Math.max(.02, a * .2);
  if (!clear(before, best) || (held.length >= 3 && !clear(heldBefore, heldAfter))) return { anchor, improved: false, before, after: best, tiltDeg: 0, scale: 1, frames: seen.length, reason: 'no clear gain' };

  /* rebuild the same kind of anchor from the refined plane, in world space */
  const nWorld = unit(mulM(transpose(Rr), rotate(rotate(n0, t1, p[0]), t2, p[1]))), Pc = [X0[0] * scale, X0[1] * scale, X0[2] * scale], Pw = mulM(transpose(Rr), Pc.map((v, i) => v - tr[i]));
  const ray = cameraRay(click, refPose), hit = rayPlane(ray, Pw, nWorld) ?? Pw;
  let refined; try { refined = anchorFromGeometry(solution, refTimeUs, hit, nWorld); } catch { return { anchor, improved: false, reason: 'could not rebuild the anchor', frames: used.length }; }
  refined = { ...anchor, position: refined.position, normal: refined.normal, right: refined.right, down: refined.down, refined: { tiltDeg, scale, before, after: best } };
  const q = projectWorld(refined.position, refPose); if (!q || Math.hypot(q.x - click[0], q.y - click[1]) > 2) return { anchor, improved: false, reason: 'refined plane moved off the click', frames: used.length };
  return { anchor: refined, improved: true, before, after: best, tiltDeg, scale, frames: seen.length };
}
