import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../lib/animationEngine.js';

const kf = (time, value, ease = 'Linear') => ({ id: 'k' + time, time, value, ease });

test('upsert replaces a keyframe on the same frame and never duplicates', () => {
  let f = E.upsertKeyframe([], { time: 1, value: 10 });
  f = E.upsertKeyframe(f, { time: 1.001, value: 20 });
  assert.equal(f.length, 1); assert.equal(f[0].value, 20);
  f = E.upsertKeyframe(f, { time: 2, value: 5 });
  assert.deepEqual(f.map(x => x.time), [1, 2]);
});
test('moving the second keyframe from 2s to 4s doubles the duration', () => {
  const layer = { x: 0, keyframes: { x: [kf(0, 0), kf(2, 100)] } };
  assert.equal(E.sampleProperty(layer, 'x', 1), 50);
  layer.keyframes.x = E.moveKeyframes(layer.keyframes.x, ['k2'], 2);
  assert.equal(E.sampleProperty(layer, 'x', 2), 50);
  assert.equal(E.sampleProperty(layer, 'x', 4), 100);
});
test('stretch and reverse', () => {
  const s = E.stretchKeyframes([kf(0, 0), kf(1, 10), kf(2, 20)], ['k0', 'k1', 'k2'], 2);
  assert.deepEqual(s.map(f => f.time), [0, 2, 4]);
  const r = E.reverseKeyframes([kf(0, 0, 'Linear'), kf(2, 100, 'Ease in')]);
  assert.deepEqual(r.map(f => f.value), [100, 0]); assert.deepEqual(r.map(f => f.time), [0, 2]);
});
test('copy/paste keeps relative timing', () => {
  const clip = E.copyKeyframes([kf(1, 5), kf(2, 9)], ['k1', 'k2']);
  const pasted = E.pasteKeyframes([], clip, 4);
  assert.deepEqual(pasted.map(f => f.time), [4, 5]); assert.deepEqual(pasted.map(f => f.value), [5, 9]);
});
test('prev/next keyframe navigation', () => {
  const f = [kf(1, 0), kf(3, 0)];
  assert.equal(E.nextKeyframeTime(f, 1), 3); assert.equal(E.prevKeyframeTime(f, 3), 1);
  assert.equal(E.nextKeyframeTime(f, 3), null); assert.equal(E.prevKeyframeTime(f, 1), null);
});
test('snapping prefers targets, falls back to frames', () => {
  assert.equal(E.snapTime(1.02, { targets: [1], threshold: 0.05 }), 1);
  assert.equal(E.snapTime(1.5004, { fps: 30 }), 1.5);
});
test('custom bezier easing and speed curve', () => {
  const custom = E.customEasing([0.25, 0.1, 0.25, 1]);
  assert.ok(E.easingAt(0.5, custom) > 0.5);
  assert.ok(E.easingSpeedAt(0.5, 'Linear') > 0.99 && E.easingSpeedAt(0.5, 'Linear') < 1.01);
  assert.ok(E.easingSpeedAt(0.02, 'Ease in-out') < E.easingSpeedAt(0.5, 'Ease in-out'));
});
test('property clamping validates ranges and colours', () => {
  assert.equal(E.clampToProperty('opacity', 150), 100);
  assert.equal(E.clampToProperty('opacity', 'abc'), 100);
  assert.equal(E.clampToProperty('color', 'nope'), '#ffffff');
});
test('procedural motion is deterministic', () => {
  const layer = { x: 50, procedural: { x: { type: 'wiggle', amount: 10, frequency: 3, seed: 4 } }, keyframes: {} };
  assert.equal(E.sampleProperty(layer, 'x', 1.37), E.sampleProperty(layer, 'x', 1.37));
  assert.notEqual(E.sampleProperty(layer, 'x', 1.37), E.sampleProperty(layer, 'x', 2.9));
});
test('expressions are sandboxed and reject anything unknown', () => {
  assert.equal(E.evaluateExpression('50 + sin(t) * 0', { t: 3 }), 50);
  assert.equal(E.evaluateExpression('clamp(value*2, 0, 10)', { value: 9 }), 10);
  assert.equal(E.evaluateExpression('constructor.constructor("return 1")()', {}), null);
  assert.equal(E.evaluateExpression('process.exit()', {}), null);
  assert.equal(E.validateExpression('1 +').ok, false);
});
test('audio envelope, beats and baking', () => {
  const sr = 3000, samples = new Float32Array(sr * 2);
  for (let i = 0; i < samples.length; i++) { const t = i / sr; samples[i] = (t % 0.5 < 0.05 ? 1 : 0.02) * Math.sin(i * 0.3); }
  const env = E.analyzeEnvelope(samples, sr, 30);
  const beats = E.detectBeats(env, 30, 0.5);
  assert.ok(beats.length >= 3);
  const baked = E.bakeToKeyframes(t => E.envelopeAt(env, 30, t), 0, 2, 30);
  assert.ok(baked.length > 2 && baked.length < 61);
});
test('migration clamps invalid values and adds ids', () => {
  const l = E.migrateLayer({ keyframes: { opacity: [{ time: 0, value: 999 }, { time: 'x', value: 1 }] } });
  assert.equal(l.keyframes.opacity.length, 1); assert.equal(l.keyframes.opacity[0].value, 100); assert.ok(l.keyframes.opacity[0].id);
});
test('boundaries: before first, after last, duplicate times', () => {
  const layer = { x: 1, keyframes: { x: [kf(1, 10), kf(1, 99), kf(3, 30)] } };
  assert.equal(E.sampleProperty(layer, 'x', 0), 10);
  assert.equal(E.sampleProperty(layer, 'x', 5), 30);
  assert.ok(Number.isFinite(E.sampleProperty(layer, 'x', 2)));
});
test('migration gives duplicated keyframe ids unique values', () => {
  const l = E.migrateLayer({ keyframes: { x: [{ id: 'a', time: 0, value: 1 }, { id: 'a', time: 1, value: 2 }] } });
  assert.notEqual(l.keyframes.x[0].id, l.keyframes.x[1].id);
});
