import test from 'node:test';
import assert from 'node:assert/strict';
import { clingTarget } from '../cling.js';

const W = 160, H = 160;
const flat = () => new Uint8Array(W * H).fill(128);
/* a dark square on light ground: four real corners */
const square = () => { const g = new Uint8Array(W * H).fill(210); for (let y = 60; y < 100; y++) for (let x = 60; x < 100; x++) g[y * W + x] = 40; return g; };
/* one vertical edge only: it constrains motion across it, not along it (the aperture problem) */
const edge = () => { const g = new Uint8Array(W * H).fill(210); for (let y = 0; y < H; y++) for (let x = 80; x < W; x++) g[y * W + x] = 40; return g; };

test('a flat area is reported as nothing to follow', () => {
  assert.equal(clingTarget(flat(), W, H, 80, 80).quality, 'none');
});
test('a click near a corner clings onto it with a small window', () => {
  const r = clingTarget(square(), W, H, 66, 66);
  assert.equal(r.quality, 'good');
  assert.ok(Math.abs(r.x - 60) <= r.size / 2 && Math.abs(r.y - 60) <= r.size / 2, `the window must hold the corner, landed at ${r.x},${r.y} size ${r.size}`);
  assert.ok(r.size <= 26);
});
test('a lone straight edge is not good enough to follow', () => {
  assert.notEqual(clingTarget(edge(), W, H, 80, 80).quality, 'good');
});
