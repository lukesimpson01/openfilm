import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMATION_PRESETS, applyPreset, removePreset, previewPose, PRESET_CATEGORIES, presetById } from '../lib/animationPresets.js';
import { sampleProperty } from '../lib/animationEngine.js';

const layer = () => ({ id: 'a', start: 1, duration: 4, x: 50, y: 50, scale: 100, rotation: 0, opacity: 100, keyframes: {}, procedural: {}, keyframeLoop: {} });

test('every category is populated and ids are unique', () => {
  for (const c of PRESET_CATEGORIES) assert.ok(ANIMATION_PRESETS.some(p => p.category === c), c);
  assert.equal(new Set(ANIMATION_PRESETS.map(p => p.id)).size, ANIMATION_PRESETS.length);
});
test('entrance preset creates editable keyframes starting at layer start', () => {
  const out = applyPreset(layer(), presetById('fade-in'));
  const frames = out.keyframes.opacity;
  assert.equal(frames[0].time, 1); assert.equal(frames[0].value, 0); assert.equal(frames.at(-1).value, 100);
  assert.equal(sampleProperty(out, 'opacity', 1), 0); assert.equal(sampleProperty(out, 'opacity', 4), 100);
});
test('exit preset ends exactly at layer end and does not clobber entrance', () => {
  let l = applyPreset(layer(), presetById('fade-in'));
  l = applyPreset(l, presetById('fade-out'));
  assert.equal(sampleProperty(l, 'opacity', 1), 0);
  assert.equal(sampleProperty(l, 'opacity', 3), 100);
  assert.equal(sampleProperty(l, 'opacity', 5), 0);
  l = removePreset(l, 'out');
  assert.equal(sampleProperty(l, 'opacity', 5), 100);
});
test('options change duration, delay and intensity', () => {
  const a = applyPreset(layer(), presetById('slide-in'), { duration: 1, delay: 0.5, intensity: 2, direction: 'Right' });
  assert.equal(a.keyframes.x[0].time, 1.5); assert.equal(a.keyframes.x.at(-1).time, 2.5);
  assert.ok(a.keyframes.x[0].value > 50);
});
test('continuous presets are procedural/looping and deterministic', () => {
  const l = applyPreset(layer(), presetById('float'));
  assert.equal(sampleProperty(l, 'y', 2.2), sampleProperty(l, 'y', 2.2));
  const r = applyPreset(layer(), presetById('rotate'));
  assert.equal(r.keyframeLoop.rotation, 'repeat');
});
test('preview pose matches the same engine', () => {
  const pose = previewPose(presetById('pop'), 0);
  assert.equal(pose.scale, 0);
});
