import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeText, buildWyr, buildReddit, CHAT_THEMES } from '../lib/storyBuilders.js';
import { presetById, applyPreset } from '../lib/animationPresets.js';
import { sampleProperty } from '../lib/animationEngine.js';

const realise = (spec, total) => { let l = { id: 'x', kind: spec.kind, start: spec.at || 0, duration: spec.dur || total, x: 50, y: 50, scale: 100, rotation: 0, opacity: 100, keyframes: {}, procedural: {}, keyframeLoop: {}, ...spec.props }; for (const [id, o] of spec.presets || []) { const p = presetById(id); assert.ok(p, 'unknown preset ' + id); l = applyPreset(l, p, o || {}); } return l; };

test('fake text story: bubbles appear one after another, on the right side per sender', () => {
  const { specs, duration } = buildFakeText({ contact: 'Sam', theme: 'dark', messages: [{ from: 'them', text: 'hi there' }, { from: 'me', text: 'hello back to you' }, { from: 'them', text: '' }] });
  const bubbles = specs.filter((s) => s.name.startsWith('Bubble'));
  assert.equal(bubbles.length, 2, 'empty messages are skipped');
  assert.ok(bubbles[1].at > bubbles[0].at && duration > bubbles[1].at);
  assert.ok(bubbles[0].props.x < 50 && bubbles[1].props.x > 50);
  assert.ok(bubbles[1].props.y > bubbles[0].props.y, 'messages stack downwards');
  assert.equal(bubbles[1].props.color, CHAT_THEMES.dark.me);
  for (const s of specs) realise(s, duration);
});
test('would you rather: panels, question and counting percentages that add to 100', () => {
  const { specs, duration } = buildWyr({ question: 'Q?', a: 'A', b: 'B', pctA: 70, reveal: 4 });
  const pa = specs.find((s) => s.name === 'A %'), pb = specs.find((s) => s.name === 'B %');
  assert.equal(pa.props.text, '70%'); assert.equal(pb.props.text, '30%'); assert.ok(pa.at >= 4);
  const layer = realise(pa, duration); assert.equal(sampleProperty(layer, 'counter', pa.at), 0); assert.equal(sampleProperty(layer, 'counter', duration), 100);
});
test('reddit: card, header, title and typed body; body optional', () => {
  const full = buildReddit({ title: 'AITA?', body: 'long story short we argued', subreddit: 'AITA' });
  assert.ok(full.specs.some((s) => s.name === 'Body') && full.specs.some((s) => s.props.text === 'r/AITA'));
  assert.ok(!buildReddit({ title: 'No body' }).specs.some((s) => s.name === 'Body'));
  for (const s of full.specs) realise(s, full.duration);
});
