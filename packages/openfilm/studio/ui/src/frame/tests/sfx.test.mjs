import test from 'node:test';
import assert from 'node:assert/strict';
import { SFX_CATALOG, SFX_COUNT, SFX_CATEGORIES, renderSfx, searchSfx, sfxSuggestions, waveformPeaks, toWav, sfxById, registerImported, unregisterImported, isPlayable, soundDuration } from '../lib/sfxLibrary.js';
import { MUSIC_CATALOG, searchMusic } from '../lib/musicLibrary.js';
import { matchSlot } from '../lib/soundStore.js';

const playable = SFX_CATALOG, slots = SFX_CATALOG.filter((s) => s.group === 'brainrot');

test('the requested lists are present: 30 normal effects and 14 brainrot sounds, in two groups', () => {
  assert.equal(SFX_COUNT, 44); assert.equal(SFX_CATALOG.filter((s) => s.group === 'normal').length, 30); assert.equal(slots.length, 14);
  for (const name of ['Camera Shutter', 'Razor Slash', 'Vine Boom', 'Zoom In / Out', 'Metal Clang', 'Cinematic Boom', 'Sparkle', 'Typewriter']) assert.ok(SFX_CATALOG.some((s) => s.name === name), name);
  for (const name of ['Rizz Sound Effect', 'Fah', 'Fah 2', 'Emotional Damage Meme', 'Discord Leave Noise']) assert.ok(slots.some((s) => s.name === name), name);
  assert.equal(new Set(SFX_CATALOG.map((s) => s.id)).size, SFX_CATALOG.length);
  for (const s of SFX_CATALOG) { assert.ok(s.license && s.source && s.verified, s.id); assert.ok(SFX_CATEGORIES.includes(s.category), s.id); }
});
test('named brainrot recordings retain exact provenance; unresolved labels cannot play', () => {
  for (const s of slots) { assert.equal(!!isPlayable(s),s.recordingStatus==='verified', s.id); assert.equal(s.originalRecording, true); assert.equal(renderSfx(s), null); if(isPlayable(s))assert.ok(s.sourceUrl.startsWith('https://www.myinstants.com/'));else assert.equal(s.sourceUrl,undefined); }
});
test('all named effects wait for their source recording', () => {
  for (const s of playable) {assert.equal(s.originalRecording,true);assert.equal(renderSfx(s),null,s.id);}
});
test('loaded source samples are used exactly, with no generated fallback after unloading', () => {
  registerImported('fah', { samples: new Float32Array(4410).fill(0.2), sr: 44100, dur: 0.1, name: 'Fah' });
  const e = sfxById('fah'); assert.equal(e.replaced, true); assert.ok(Math.abs(soundDuration(e) - 0.1) < 1e-6); assert.equal(renderSfx(e).length, 4410);
  unregisterImported('fah'); assert.equal(sfxById('fah').replaced, undefined); assert.equal(renderSfx(sfxById('fah')), null);
});
test('custom imports are searchable under My sounds but music stays out of Sound FX', async () => {
  const { registerCustom, allSfx } = await import('../lib/sfxLibrary.js');
  registerCustom({ id: 'imp-test', name: 'My Test Sound', category: 'My sounds', tags: [], aliases: [], samples: new Float32Array(100), sr: 8000, dur: 0.0125, imported: true });
  assert.ok(searchSfx('', { category: 'My sounds' }).some((s) => s.id === 'imp-test'));
  assert.ok(allSfx().every((s) => !s.music), 'music tracks are not listed as sound effects');
  unregisterImported('imp-test');
});
test('filenames match the right slot', () => {
  assert.equal(matchSlot('fah-2.mp3')?.id, 'fah-2'); assert.equal(matchSlot('Fah.wav')?.id, 'fah');
  assert.equal(matchSlot('emotional-damage-meme.mp3')?.id, 'emotional-damage-meme'); assert.equal(matchSlot('discord leave noise.mp3')?.id, 'discord-leave-noise');
  assert.equal(matchSlot('random-song.mp3'), null);
  for(const name of ['Fah!!.mp3','Fahh.mp3','Original Fah.mp3','fah-2-remix.mp3','Romanceeeeeeeeeeeeee.mp3','Heavenly Musiic.mp3'])assert.equal(matchSlot(name),null,name);
});
test('search finds razor, boom, and ignores unplayable slots in aliases', () => {
  assert.equal(searchSfx('razor')[0].id, 'razor-slash');
  const boom = searchSfx('boom').map((s) => s.id); assert.ok(boom.includes('vine-boom') && boom.includes('cinematic-boom'));
  assert.ok(searchSfx('fah').some((s) => s.id === 'fah'));
  assert.deepEqual(searchSfx('zzzzqq'), []);
  assert.ok(sfxSuggestions('wh').length > 0 && searchSfx('', { category: 'Brainrot' }).length === 14);
});
test('peaks and wav encoding', () => {
  const a = Float32Array.from({length:1000},(_,i)=>Math.sin(i*.1)*.3); assert.equal(waveformPeaks(a, 20).length, 20); assert.equal(String.fromCharCode(...toWav(a).slice(0, 4)), 'RIFF');
});
test('music browse offers 18 real recordings and preserves the legacy registry', async () => {
  const { BROWSE_CATALOG, ALL_MUSIC, MACLEOD_CREDIT } = await import('../lib/musicLibrary.js');
  const bundled = BROWSE_CATALOG.filter((m) => m.bundled), takes = BROWSE_CATALOG.filter((m) => m.take);
  assert.equal(bundled.length, 6); assert.equal(takes.length, 12); assert.equal(MUSIC_CATALOG.length, 14); assert.equal(ALL_MUSIC.length, 18);
  for (const m of bundled) { assert.ok(m.url.startsWith('/assets/media/music/') && m.dur > 30 && /CC BY 4.0/.test(m.license)); assert.ok(m.attribution.includes('creativecommons.org/licenses/by/4.0') && /Kevin MacLeod/.test(m.attribution)); }
  for (const s of takes) { assert.ok(/^https:\/\//.test(s.sourceUrl)); assert.ok(s.originalRecording);assert.equal(renderSfx(sfxById(s.id)),null);assert.ok(s.dur>20); }
  assert.ok(ALL_MUSIC.every((m) => !m.needsFile), 'every track is playable and addable');
  assert.ok(MACLEOD_CREDIT('X').startsWith('X Kevin MacLeod'));
});
test('music: FRAME originals render, and search covers sections, titles and artists', () => {
  for (const t2 of MUSIC_CATALOG.slice(0, 3)) { const a = t2.render(16000); let pk = 0; for (const v of a) { assert.ok(Number.isFinite(v)); pk = Math.max(pk, Math.abs(v)); } assert.ok(pk > 0.5 && pk <= 1, t2.id); }
  assert.ok(searchMusic('sneaky').some((m) => m.title === 'Sneaky Snitch')); assert.ok(searchMusic('', 'cinematic').length === 5 && searchMusic('', 'cinematic').every((m) => m.section === 'cinematic'));
  assert.ok(searchMusic('kanye').length === 1 && searchMusic('HOME').some(m=>m.title==='Resonance'));
});
test('an unloaded URL sound renders nothing instead of throwing', async () => {
  const { renderSfx: r, sfxById: byId } = await import('../lib/sfxLibrary.js');
  await import('../lib/musicLibrary.js');
  const e = byId('mx-sneaky-snitch'); assert.ok(e.url && !e.samples);
  assert.equal(r(e), null);
});
