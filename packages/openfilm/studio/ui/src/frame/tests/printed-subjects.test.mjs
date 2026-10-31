import test from 'node:test';
import assert from 'node:assert/strict';
import { printedOnSurface } from '../printed-subjects.js';

/* a poster drifting right as the camera passes: H translates by 4 px a frame */
const N = 20, track = { frames: Array.from({ length: N }, (_, i) => ({ t: i / 10, H: [1, 0, 4 * i, 0, 1, 0, 0, 0, 1] })), cuts: [] };
const quad = [[100, 40], [180, 40], [180, 140], [100, 140]], times = Array.from({ length: N }, (_, i) => i / 10);

test('a figure printed on the poster moves with it, so it is recognised as part of the surface', () => {
  const frames = times.map((_, i) => ({ subjects: [{ box: [120 + 4 * i, 60, 150 + 4 * i, 120] }] }));
  const box = printedOnSurface({ times, frames }, track, quad);
  assert.ok(box, 'found');
  assert.ok(Math.abs(box[0] - 120) < 3 && Math.abs(box[2] - 150) < 3, JSON.stringify(box));
});
test('a person walking in front of the poster crosses it, so nothing is excluded', () => {
  const frames = times.map((_, i) => ({ subjects: [{ box: [100 + 12 * i, 50, 130 + 12 * i, 140] }] }));
  assert.equal(printedOnSurface({ times, frames }, track, quad), null);
});
