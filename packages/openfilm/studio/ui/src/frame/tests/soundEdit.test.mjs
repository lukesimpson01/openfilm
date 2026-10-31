import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSegments, totalOut, splitAt, cutRange, keepRange, speedRange, setRateRange, isEdited, editedPeaks } from '../lib/soundEdit.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
test('cutting a middle section shortens the output and keeps both ends', () => {
  const s = cutRange(defaultSegments(2), 0.5, 1.0);
  assert.equal(s.length, 2); close(totalOut(s), 1.5); close(s[1].a, 1.0);
});
test('keep range trims to the selection', () => {
  const s = keepRange(defaultSegments(2), 0.5, 1.5);
  assert.equal(s.length, 1); close(s[0].a, 0.5); close(s[0].b, 1.5);
});
test('speed on a selection only changes that part; no selection changes everything', () => {
  const part = speedRange(defaultSegments(2), 2, 0.5, 1.5);
  close(totalOut(part), 1.5);
  assert.deepEqual(part.map((x) => x.rate), [1, 2, 1]);
  const all = speedRange(defaultSegments(2), 0.5);
  close(totalOut(all), 4);
});
test('rates are clamped and cuts never delete everything', () => {
  assert.equal(speedRange(defaultSegments(1), 100)[0].rate, 4);
  assert.equal(speedRange(defaultSegments(1), 0.001)[0].rate, 0.25);
  assert.equal(cutRange(defaultSegments(1), 0, 1).length, 1);
});
test('edits compose: cut after a speed change uses output time', () => {
  let s = setRateRange(defaultSegments(4), 2, 0, 2);   // output 0..2 = source 0..2, now at 2x => 1s, plus source 2..4 => 2s
  close(totalOut(s), 3);
  s = cutRange(s, 0.25, 0.75);
  close(totalOut(s), 2.5);
});
test('the original sound is never mutated and edits are detected', () => {
  const base = defaultSegments(1.2), copy = JSON.stringify(base);
  cutRange(base, 0.1, 0.2); speedRange(base, 2, 0, 0.5);
  assert.equal(JSON.stringify(base), copy);
  assert.equal(isEdited(base, 1.2), false);
  assert.equal(isEdited(speedRange(base, 2), 1.2), true);
});
test('edited peaks have the requested bucket count and follow cuts', () => {
  const sr = 1000, samples = new Float32Array(2000); samples.fill(0.1); for (let i = 500; i < 1000; i++) samples[i] = 1;
  const full = editedPeaks(samples, sr, defaultSegments(2), 8), cut = editedPeaks(samples, sr, cutRange(defaultSegments(2), 0.5, 1.0), 6);
  assert.equal(full.length, 8); assert.equal(cut.length, 6); assert.ok(Math.max(...cut) < 0.2 && Math.max(...full) === 1);
});
test('splitAt is idempotent at boundaries', () => {
  const a = splitAt(defaultSegments(2), 1), b = splitAt(a, 1);
  assert.equal(a.length, 2); assert.equal(b.length, 2);
});
