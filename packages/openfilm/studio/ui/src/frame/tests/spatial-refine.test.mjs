import test from 'node:test';import assert from 'node:assert/strict';
import { W, H, K, unit, dot } from './synthetic-wall.mjs';
import { refineSurfaceAnchor } from '../spatial-refine.js';
import { anchorFromGeometry, cameraRay, rayPlane } from '../spatial-geometry.js';

/* A textured plane seen by a camera that walks forward, drifts and turns (synthetic-wall.mjs), solved with exact cameras.
   The pin starts from a plane that is tilted wrongly; refinement must recover the true wall from the pictures alone. */
const trueNormal = unit([0.5, -0.1, 1]), d = 3;
/* the wall: value noise at three scales plus a few crisp marks, i.e. the kind of texture a brick or plaster wall has */
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const noise = (u, v) => { const x = Math.floor(u), y = Math.floor(v), fx = u - x, fy = v - y, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (hash(x, y) * (1 - sx) + hash(x + 1, y) * sx) * (1 - sy) + (hash(x, y + 1) * (1 - sx) + hash(x + 1, y + 1) * sx) * sy; };
function renderWall(n, dd, j) {
  const right = unit([n[2], 0, -n[0]]), up = unit([n[1] * right[2] - n[2] * right[1], n[2] * right[0] - n[0] * right[2], n[0] * right[1] - n[1] * right[0]]);
  const c = [0.14 * j, 0, 0.12 * j], yaw = -0.012 * j, cy = Math.cos(yaw), sy = Math.sin(yaw), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = [(x - K[2]) / K[0], (y - K[5]) / K[4], 1], dir = [cy * r[0] + sy * r[2], r[1], -sy * r[0] + cy * r[2]], lam = (dd - dot(n, c)) / dot(n, dir);
    if (!(lam > 0)) { out[y * W + x] = 128; continue; }
    const P = [c[0] + lam * dir[0], c[1] + lam * dir[1], c[2] + lam * dir[2]], u = dot(P, right), v = dot(P, up);
    out[y * W + x] = Math.max(0, Math.min(255, 255 * (0.5 * noise(u * 6, v * 6) + 0.3 * noise(u * 17, v * 17) + 0.2 * noise(u * 41, v * 41))));
  }
  return out;
}
const frames0 = { grays: Array.from({ length: 14 }, (_, j) => renderWall(trueNormal, d, j)) };
const pose = (j) => { const yaw = -0.012 * j, cy = Math.cos(yaw), sy = Math.sin(yaw), R = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], c = [0.14 * j, 0, 0.12 * j];
  const Rt = [0, 1, 2].map((r) => [0, 1, 2].map((k) => R[k][r])), t = Rt.map((row) => -dot(row, c));
  return { shotId: 0, sourceTimeUs: j * 100000, worldToCamera: Rt.map((row, i) => [...row, t[i]]), intrinsics: [[K[0], 0, K[2]], [0, K[4], K[5]], [0, 0, 1]], distortion: [0], status: 'observed' }; };
const solution = { width: W, height: H, shots: [{ id: 0, fromUs: 0, toUs: 1300000, poses: frames0.grays.map((_, j) => pose(j)), points: [], gravity: { direction: [0, 1, 0] } }] };
const frames = frames0.grays.map((gray, j) => ({ timeUs: j * 100000, gray, w: W, h: H }));
const angle = (a, b) => Math.acos(Math.min(1, Math.abs(dot(unit(a), unit(b))))) * 180 / Math.PI;

function startingPin(tiltDeg) {
  const click = [W / 2 + 6, H / 2 - 10], ray = cameraRay(click, solution.shots[0].poses[0]), truth = rayPlane(ray, mulScale(trueNormal, d), trueNormal);
  const a = tiltDeg * Math.PI / 180, wrong = unit([trueNormal[0] * Math.cos(a) + trueNormal[2] * Math.sin(a), trueNormal[1] + .03, trueNormal[2] * Math.cos(a) - trueNormal[0] * Math.sin(a)]);
  return { click, truth, anchor: { ...anchorFromGeometry(solution, 0, truth, wrong), support: 20 } };
}
const mulScale = (v, k) => v.map((x) => x * k);

test('a plane fitted well off is pulled back toward the real wall by the footage alone (9° → ~3°, 20° → ~4°)', () => {
  for (const deg of [9, 20]) {
    const { click, anchor } = startingPin(deg), before = angle(anchor.normal, trueNormal), r = refineSurfaceAnchor(anchor, solution, frames, click, 0);
    assert.ok(r.improved, `${deg}°: ${r.reason}`); const after = angle(r.anchor.normal, trueNormal);
    assert.ok(after < before / 2 && after < 5.5, `${deg}°: ${before.toFixed(1)}° → ${after.toFixed(2)}°`); assert.ok(r.after < r.before);
  }
});
test('a small tilt error is within the noise of what the pictures can show, so it is left alone rather than guessed at', () => {
  const { click, anchor } = startingPin(4), r = refineSurfaceAnchor(anchor, solution, frames, click, 0); assert.equal(r.improved, false);
});
test('a pin that is already right is left alone', () => {
  const { click, anchor } = startingPin(0);
  const exact = { ...anchor, ...anchorFromGeometry(solution, 0, anchor.position, trueNormal) };
  const r = refineSurfaceAnchor(exact, solution, frames, click, 0); assert.equal(r.improved, false);
});
test('refinement never moves the anchor off the clicked pixel', () => {
  const { click, anchor } = startingPin(7), r = refineSurfaceAnchor(anchor, solution, frames, click, 0);
  if (r.improved) { const ray = cameraRay(click, solution.shots[0].poses[0]); const p = r.anchor.position, v = p.map((x, i) => x - ray.origin[i]), l = Math.hypot(...v); assert.ok(angle(v, ray.direction) < .2 && l > 0); }
});
test('a blank wall has nothing to align against, so nothing changes', () => {
  const { click, anchor } = startingPin(9), flat = frames.map((f) => ({ ...f, gray: new Uint8Array(f.gray.length).fill(120) }));
  const r = refineSurfaceAnchor(anchor, solution, flat, click, 0); assert.equal(r.improved, false); assert.deepEqual(r.anchor.normal, anchor.normal);
});
test('a fit that does not hold on frames it was not trained on is rejected', () => {
  const { click, anchor } = startingPin(9), noisy = frames.map((f, j) => j % 2 ? { ...f, gray: f.gray.map((v, i) => (v + (i * 2654435761 >>> 24)) & 255) } : f);
  const r = refineSurfaceAnchor(anchor, solution, noisy, click, 0); if (r.improved) assert.ok(angle(r.anchor.normal, trueNormal) < angle(anchor.normal, trueNormal));
});

test('empty and partial scans fail safely without moving the anchor', () => {
  const { click, anchor } = startingPin(9);
  for (const unavailable of [[], [{ ...frames[0], gray: new Uint8Array(3) }]]) {
    const result = refineSurfaceAnchor(anchor, solution, unavailable, click, 0);
    assert.equal(result.improved, false);
    assert.deepEqual(result.anchor.position, anchor.position);
  }
});
