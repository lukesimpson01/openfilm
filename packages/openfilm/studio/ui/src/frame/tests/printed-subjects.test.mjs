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

test('finds the stretch where a person walks across the element, with that person’s box to follow', async () => {
  const { crossingPeople } = await import('../printed-subjects.js');
  /* the person reaches the poster at frame 5 and leaves after frame 12 */
  const frames = times.map((_, i) => ({ subjects: [{ box: [20 + 14 * i, 30, 60 + 14 * i, 170] }] }));
  const c = crossingPeople({ times, frames }, track, quad, { w: 320, h: 180 });
  assert.ok(c, 'found');
  assert.ok(c.from >= 0.2 && c.from <= 0.5, `from ${c.from}`);
  assert.equal(c.instances.length, 1);
  assert.ok(c.instances[0].box.every((v) => v >= 0 && v <= 1));
  assert.equal(crossingPeople({ times, frames: times.map(() => ({ subjects: [] })) }, track, quad, { w: 320, h: 180 }), null);
});

test('specks the masks call subjects (a reflection, a figure in a picture) are not people crossing the text', async () => {
  const { crossingPeople } = await import('../printed-subjects.js');
  /* the hallway clip's two "subjects": 14×10 px and 6×7 px blobs on a 180×320 frame */
  const frames = times.map(() => ({ subjects: [{ box: [120, 60, 134, 70] }, { box: [104, 120, 110, 127] }] }));
  assert.equal(crossingPeople({ times, frames }, track, quad, { w: 180, h: 320 }), null);
});
