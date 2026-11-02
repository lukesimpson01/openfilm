import test from 'node:test';
import assert from 'node:assert/strict';
import { faceAt, faceObservations } from '../face-native.js';

const box = (cx, cy, s) => [cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2];
/* two faces; "a" walks right and grows, drops out for 0.1 s and then for 0.5 s; "b" stays put */
const frames = Array.from({ length: 40 }, (_, i) => {
  const t = i / 30, faces = [{ id: 'b', box: box(200, 300, 80), confidence: .8, source: 'detected' }];
  const gone = (i >= 10 && i < 13) || (i >= 20 && i < 35);
  if (!gone) faces.push({ id: 'a', box: box(600 + i * 5, 400, 100 + i), confidence: .9, source: i % 2 ? 'flow' : 'detected' });
  return { t, faces };
});
const data = { frames };
const sel = (x, y) => ({ id: 's', kind: 'face', sourceTimeUs: 0, anchorX: x, anchorY: y, region: { x: x - 50, y: y - 50, width: 100, height: 100 } });

test('a click picks the face under it, and nothing when no face is near', () => {
  assert.equal(faceAt(frames, 0, 610, 390).face.id, 'a');
  assert.equal(faceAt(frames, 0, 205, 295).face.id, 'b');
  assert.equal(faceAt(frames, 0, 1000, 1500), null);
  assert.equal(faceObservations(data, sel(1000, 1500)), null);
});

test('the clicked spot keeps its place on the face as the face moves and grows', () => {
  /* a quarter of the face right of centre */
  const { id, observations } = faceObservations(data, sel(625, 400));
  assert.equal(id, 'a');
  const o = observations[8], w = 100 + 8;
  assert.equal(o.status, 'observed');
  assert.ok(Math.abs(o.x - (600 + 8 * 5 + .25 * w)) < 1e-6);
  assert.ok(Math.abs(o.width - 100 * w / 100) < 1e-6);
});

test('a gap is never filled by the other face: short gaps are predicted, long ones lost, and the face is taken back', () => {
  const { observations } = faceObservations(data, sel(600, 400));
  assert.deepEqual(observations.slice(10, 13).map((o) => o.status), ['predicted', 'predicted', 'predicted']);
  assert.ok(observations.slice(20, 35).some((o) => o.status === 'lost'));
  assert.ok(observations.slice(10, 35).every((o) => o.status === 'observed' || Math.abs(o.x - 200) > 100), 'never moved to face b');
  assert.equal(observations[35].status, 'observed');
  assert.equal(observations[35].jump, true);
});
