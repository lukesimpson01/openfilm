import test from 'node:test';
import assert from 'node:assert/strict';
import { focusOfExpansion, rectifier, rippleGeometryAt, matteAt, normalise } from '../ripple-env.js';
import { apply } from '../track-core.js';

/* a forward walk seen in track pixels (180 × 320): everything scales by s about the vanishing point (60, 120) */
const zoomAbout = (s, x, y) => [s, 0, x * (1 - s), 0, s, y * (1 - s), 0, 0, 1];

test('the focus of expansion of a forward walk is found where the scene expands from', () => {
  const p = focusOfExpansion(normalise(zoomAbout(1.3, 60, 120), 180, 320));
  assert.ok(p && Math.abs(p[0] - 60 / 180) < .002 && Math.abs(p[1] - 120 / 320) < .002, JSON.stringify(p));
});

test('a sideways pan (no forward motion) gives no corridor', () => {
  assert.equal(focusOfExpansion(normalise([1, 0, 30, 0, 1, 0, 0, 0, 1], 180, 320)), null);
});

test('a surface quad is rectified to its own proportions', () => {
  /* a 2:1 rectangle seen straight on */
  const R = rectifier([[.2, .4], [.6, .4], [.6, .6], [.2, .6]], 1);
  const a = apply(R, [.2, .4]), b = apply(R, [.6, .6]);
  assert.ok(Math.abs(a[0]) < 1e-6 && Math.abs(a[1]) < 1e-6);
  assert.ok(Math.abs(b[0] - 2) < 1e-6 && Math.abs(b[1] - 1) < 1e-6, JSON.stringify(b));
});

test('the wave origin stays on the same scene point while the camera moves', () => {
  const frames = [{ t: 0, H: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { t: 1, H: zoomAbout(1.5, 90, 160) }];
  const scene = { track: { w: 180, h: 320, frames }, matte: null, foe: null };
  const g0 = rippleGeometryAt(scene, 0, { want: 'scene', origin: [.3, .3], start: 0 });
  const g1 = rippleGeometryAt(scene, 1, { want: 'scene', origin: [.3, .3], start: 0 });
  assert.equal(g1.mode, 1);
  assert.deepEqual(g0.origin.map((v) => +v.toFixed(6)), g1.origin.map((v) => +v.toFixed(6)));
  /* the pixel where that scene point is now maps onto the origin */
  const now = apply(normalise(zoomAbout(1.5, 90, 160), 180, 320), [.3, .3]), back = apply(g1.M, now);
  assert.ok(Math.hypot(back[0] - .3, back[1] - .3) < 1e-6);
});

test('a corridor is used only when forward motion was measured; otherwise the scene model', () => {
  const frames = [{ t: 0, H: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { t: 1, H: [1, 0, 20, 0, 1, 0, 0, 0, 1] }];
  const flat = rippleGeometryAt({ track: { w: 180, h: 320, frames }, foe: null }, .5, { want: 'corridor' });
  assert.equal(flat.mode, 1);
  const walk = rippleGeometryAt({ track: { w: 180, h: 320, frames }, foe: [.5, .4] }, .5, { want: 'corridor' });
  assert.equal(walk.mode, 3);
  assert.deepEqual(walk.vp, [.5, .4]);
  assert.equal(rippleGeometryAt(null, 0, {}).mode, 0);
});

test('the matte frame for a moment is the nearest one, and none when the nearest is far away', () => {
  const matte = { images: ['a0'], times: [0, .1, .2], fps: 10, count: 3, cols: 2, rows: 2 };
  assert.deepEqual(matteAt(matte, .11).rect, [.5, 0, .5, .5]);
  assert.equal(matteAt(matte, 2), null);
});
