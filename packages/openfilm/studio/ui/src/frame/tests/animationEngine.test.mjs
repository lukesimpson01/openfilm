import test from 'node:test';
import assert from 'node:assert/strict';
import { easingAt, sampleProperty } from '../lib/animationEngine.js';

test('linear numeric keyframes sample at the timeline time', () => {
  const layer = { x: 0, keyframes: { x: [{ time: 0, value: 0 }, { time: 2, value: 100, ease: 'Linear' }] } };
  assert.equal(sampleProperty(layer, 'x', 1), 50);
  layer.keyframes.x[1].time = 4;
  assert.equal(sampleProperty(layer, 'x', 2), 50);
});

test('colors interpolate and hold is discrete', () => {
  const layer = { color: '#0000ff', keyframes: { color: [{ time: 0, value: '#0000ff' }, { time: 2, value: '#ff0000', ease: 'Linear' }] } };
  assert.equal(sampleProperty(layer, 'color', 1), '#800080');
  layer.keyframes.color[1].ease = 'Hold';
  assert.equal(sampleProperty(layer, 'color', 1), '#0000ff');
});

test('ease in and out has slower ends than linear', () => {
  assert.ok(easingAt(.25, 'Ease in-out') < .25);
  assert.ok(easingAt(.75, 'Ease in-out') > .75);
});

import { normalizeEasing, loopTime, snapToFrame, sampleLayer } from '../lib/animationEngine.js';

test('schema easing names normalise to engine names', () => {
  assert.equal(normalizeEasing('easeInOut'), 'Ease in-out');
  assert.equal(normalizeEasing('hold'), 'Hold');
  assert.equal(normalizeEasing('nonsense'), 'Linear');
});

test('before first and after last keyframe clamp; disabled animation is static', () => {
  const layer = { x: 7, keyframes: { x: [{ time: 1, value: 10 }, { time: 3, value: 30 }] } };
  assert.equal(sampleProperty(layer, 'x', 0), 10);
  assert.equal(sampleProperty(layer, 'x', 9), 30);
  layer.animationEnabled = { x: false };
  assert.equal(sampleProperty(layer, 'x', 2), 7);
});

test('repeat and ping-pong loops are deterministic', () => {
  assert.equal(loopTime(5, 0, 2, 'repeat'), 1);
  assert.equal(loopTime(3, 0, 2, 'pingpong'), 1);
  const layer = { keyframeLoop: { x: 'pingpong' }, keyframes: { x: [{ time: 0, value: 0 }, { time: 2, value: 100 }] } };
  assert.equal(sampleProperty(layer, 'x', 3), 50);
  assert.equal(sampleProperty(layer, 'x', 3), sampleLayer(layer, 3).x);
});

test('frame snapping avoids drift at 24/25/30/60 fps', () => {
  for (const fps of [24, 25, 30, 60]) assert.equal(snapToFrame(1.5004, fps) * fps, Math.round(1.5 * fps));
});

test('easings hit 0 and 1 at the ends', () => {
  for (const e of ['Linear', 'Ease in', 'Ease out', 'Ease in-out', 'Smooth', 'Bounce', 'Elastic', 'Back']) {
    assert.ok(Math.abs(easingAt(0, e)) < 1e-6, e); assert.ok(Math.abs(easingAt(1, e) - 1) < 1e-6, e);
  }
});
