import test from 'node:test';
import assert from 'node:assert/strict';
import { normalCandidates, surfaceNormal, orientedQuad, localSurface } from '../local-surface.js';
import { apply } from '../track-core.js';

import { W, H, K, dot, unit, angle, scene } from './synthetic-wall.mjs';

test('homography decomposition recovers the plane orientation (exact synthetic motion)', () => {
  /* H = K (R + t nᵀ/d) K⁻¹ for a camera that moved forward by 0.5 */
  const n = unit([0.7, 0, 0.7]), d = 2.5, t = [0, 0, -0.5];
  const Hn = [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v, i) => v + t[Math.floor(i / 3)] * n[i % 3] / d);
  const Ki = [1 / K[0], 0, -K[2] / K[0], 0, 1 / K[4], -K[5] / K[4], 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return C; };
  const Hpx = mul(K, mul(Hn, Ki)), cands = normalCandidates(Hpx, K);
  assert.ok(cands && Math.min(...cands.map((c) => angle(c, n))) < 0.5, JSON.stringify(cands));
});

test('a pure turn has no parallax, so no orientation is claimed', () => {
  const a = 0.05, Hn = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const Ki = [1 / K[0], 0, -K[2] / K[0], 0, 1 / K[4], -K[5] / K[4], 0, 0, 1];
  const mul = (A, B) => { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return C; };
  assert.equal(normalCandidates(mul(K, mul(Hn, Ki)), K), null);
});

test('text quad lies on the surface: a wall receding to the right gets a perspective quad, a frontal one a plain one', () => {
  const wall = orientedQuad([100, 160], unit([0.8, 0, 0.6]), K), front = orientedQuad([90, 160], [0, 0, 1], K);
  const h = (q, i, j) => Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
  assert.ok(Math.abs(h(front, 0, 3) - h(front, 1, 2)) < 1e-6, 'frontal: parallel sides');
  assert.ok(Math.abs(h(wall, 0, 3) - h(wall, 1, 2)) > 2, 'oblique: the far side is shorter');
});

for (const deg of [0, 35, 60]) {
  test(`tracks a synthetic wall tilted ${deg}° and finds its orientation`, () => {
    const a = deg * Math.PI / 180, n = [Math.sin(a), 0, Math.cos(a)], d = dot(n, [0.4 * Math.sin(a), 0, 3]);
    const { grays, times } = scene(n, d);
    const r = localSurface(grays, times, W, H, 0, [W / 2 + 10, H / 2]);
    assert.equal(r.result.frames.length, grays.length);
    assert.ok(r.quality !== 'Poor', `quality ${r.quality}`);
    if (deg >= 35) { assert.ok(r.tilted, 'orientation found'); assert.ok(angle(r.normal, n) < 22, `normal off by ${angle(r.normal, n).toFixed(1)}°`); }
    /* the text quad follows the surface: its centre stays on the same texture across frames */
    const last = r.result.frames.at(-1).H, c0 = r.quad.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]), c1 = apply(last, c0);
    assert.ok(Number.isFinite(c1[0]) && Math.abs(c1[0]) < 4 * W, 'finite projection');
  });
}

test('frames the patch loses continue with the camera motion instead of vanishing', () => {
  const n = unit([0.5, 0, 0.87]), { grays, times } = scene(n, 2.6);
  const blank = grays.map((g, i) => (i >= 8 ? new Uint8Array(g.length).fill(120) : g));
  const global = { frames: times.map((t, i) => ({ t, H: [1 + 0.02 * i, 0, 0, 0, 1 + 0.02 * i, 0, 0, 0, 1] })) };
  const r = localSurface(blank, times, W, H, 0, [W / 2, H / 2], { global });
  assert.ok(r.result.frames.slice(9).every((f) => !f.lost), 'no lost frames once continued');
  assert.ok(r.result.frames.slice(9).some((f) => f.assumed));
});
