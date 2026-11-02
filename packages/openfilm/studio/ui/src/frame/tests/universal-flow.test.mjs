import test from 'node:test';
import assert from 'node:assert/strict';
import { createUniversalTracker } from '../universal-core.js';

/* A textured target that moves, turns, grows and darkens over a still textured background — the first-frame template
 * stops matching within a few frames, as it does for a logo on a moving shirt. */
const W = 768, H = 432, GW = 384, GH = 216;
const noise = (seed) => { let s = seed; return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296); };
const bg = (() => { const r = noise(3), a = new Float32Array(W * H); for (let i = 0; i < a.length; i++) a[i] = 60 + r() * 50; return a; })();
const tex = (() => { const r = noise(9), n = 48, a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = r() < .5 ? 30 : 230; return { n, a }; })();
const blur = (a, w, h) => { const o = new Float32Array(a.length); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * w + x + i]; o[y * w + x] = s / 9; } return o; };

function frame(f, hidden = false) {
  const cx = 300 + f * 4, cy = 200 + Math.sin(f / 6) * 20, ang = f * .012, sc = 1 + f * .006, gain = 1 - f * .012, half = 60 * sc;
  const img = Float32Array.from(bg), c = Math.cos(ang), s = Math.sin(ang);
  for (let y = Math.floor(cy - half * 1.5); y < cy + half * 1.5; y++) for (let x = Math.floor(cx - half * 1.5); x < cx + half * 1.5; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    /* squash: the target narrows along one axis as it turns away — no similarity template can model that */
    const dx = x - cx, dy = y - cy, u = (c * dx + s * dy) / sc / (1 - f * .012), v = (-s * dx + c * dy) / sc;
    if (Math.abs(u) > 60 || Math.abs(v) > 60) continue;
    if (hidden) { img[y * W + x] = 128; continue; }
    const tu = Math.min(tex.n - 1, Math.max(0, Math.floor((u + 60) / 120 * tex.n))), tv = Math.min(tex.n - 1, Math.max(0, Math.floor((v + 60) / 120 * tex.n)));
    img[y * W + x] = 128 + (tex.a[tv * tex.n + tu] - 128) * gain;
  }
  const full = blur(img, W, H), data = Uint8Array.from(full, (v) => Math.max(0, Math.min(255, v)));
  const g = new Uint8Array(GW * GH); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) g[y * GW + x] = (data[2 * y * W + 2 * x] + data[2 * y * W + 2 * x + 1] + data[(2 * y + 1) * W + 2 * x] + data[(2 * y + 1) * W + 2 * x + 1]) / 4;
  return { data, global: { x: 0, y: 0, w: GW, h: GH, sourceW: W, sourceH: H, data: g }, truth: [cx, cy] };
}
const roi = (data, x, y, r) => { const w = Math.min(W, Math.ceil(r * 2)) & ~1, h = Math.min(H, Math.ceil(r * 2)) & ~1, left = Math.max(0, Math.min(W - w, Math.round(x - w / 2))), top = Math.max(0, Math.min(H - h, Math.round(y - h / 2))), d = new Uint8Array(w * h); for (let j = 0; j < h; j++) d.set(data.subarray((top + j) * W + left, (top + j) * W + left + w), j * w); return { x: left, y: top, w, h, step: 1, data: d }; };

function run(frames, hideFrom = Infinity) {
  const selection = { id: 't', kind: 'object', sourceTimeUs: 0, anchorX: 300, anchorY: 200, region: { x: 240, y: 140, width: 120, height: 120 } };
  const engine = createUniversalTracker(selection, W, H), out = [];
  let prev = null;
  for (let f = 0; f < frames; f++) {
    const fr = frame(f, f >= hideFrom), t = Math.round(f / 30 * 1e6), dt = prev ? Math.min(.2, (t - prev.sourceTimeUs) / 1e6) : 0;
    const at = prev && ['observed', 'reacquired'].includes(prev.status) ? [prev.x + prev.velocity[0] * dt, prev.y + prev.velocity[1] * dt] : [prev?.x ?? 300, prev?.y ?? 200];
    const packet = { selection, sourceW: W, sourceH: H, sourceTimeUs: t, roi: roi(fr.data, at[0], at[1], 150), global: fr.global };
    prev = f === 0 ? engine.initialize(packet) : engine.observe(packet).observation;
    out.push({ ...prev, truth: fr.truth });
  }
  return out;
}

test('a turning, darkening target is followed by its point cloud after the first-frame template stops matching', () => {
  const obs = run(40);
  const observed = obs.filter((o) => o.status === 'observed').length, errors = obs.map((o) => Math.hypot(o.x - o.truth[0], o.y - o.truth[1]));
  assert.equal(observed, 40, `observed ${observed}/40`);
  assert.ok(Math.max(...errors) < 4, `max error ${Math.max(...errors).toFixed(2)} px`);
  assert.ok(obs.some((o) => o.method === 'point-cloud-flow'), 'flow carried at least part of the shot');
});

test('a target that is covered up is not reported as observed', () => {
  const obs = run(24, 12), after = obs.slice(14);
  assert.ok(after.every((o) => o.status !== 'observed'), after.map((o) => o.status).join(','));
});

test('a track whose first frame is stamped after zero still covers time zero, but not earlier', async () => {
  const { observationAt } = await import('../universal-core.js');
  const obs = [{ sourceTimeUs: 33007, x: 10, y: 20, width: 4, height: 4, rotation: 0, status: 'observed' }, { sourceTimeUs: 66374, x: 12, y: 20, width: 4, height: 4, rotation: 0, status: 'observed' }];
  assert.equal(observationAt(obs, 0)?.x, 10);
  assert.equal(observationAt(obs, -200000), null);
});
