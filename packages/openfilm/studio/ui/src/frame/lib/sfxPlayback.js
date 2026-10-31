import { renderSfx, sfxById, waveformPeaks, soundDuration } from "./sfxLibrary.js";
import { sampleProperty } from "./animationEngine.js";
import { defaultSegments, segOutDur, editedPeaks } from "./soundEdit.js";

/* Shared WebAudio scheduling for sound clips (sound effects, music and imported audio).
   One scheduler feeds the speakers in preview and the MediaStream destination in export.
   A clip's `segments` (cuts / speed changes) live on the timeline layer — the library sound is never changed. */
let shared = null;
export const getAudioContext = () => shared || (shared = new (window.AudioContext || window.webkitAudioContext)());

const buffers = new WeakMap();
export function getSfxBuffer(ctx, id) {
  const entry = sfxById(id);
  if (!entry || entry.needsFile) return null;
  let map = buffers.get(ctx);
  if (!map) buffers.set(ctx, (map = new Map()));
  const key = id + (entry.samples ? "|imp" + entry.samples.length : "");
  if (!map.has(key)) {
    const data = renderSfx(entry, ctx.sampleRate), sr = entry.samples ? entry.sr : ctx.sampleRate;
    if (!data) return null;
    const buf = ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    map.set(key, buf);
  }
  return map.get(key);
}
const irCache = new WeakMap();
function impulse(ctx) {
  if (irCache.has(ctx)) return irCache.get(ctx);
  const len = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 1234567;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = rand() * Math.pow(1 - i / len, 2.6); }
  irCache.set(ctx, ir);
  return ir;
}
const peakCache = new Map();
/** Waveform peaks of a sound as edited on a clip (or the raw sound when `segments` is omitted). */
export function sfxPeaks(id, buckets = 40, segments = null) {
  const entry = sfxById(id);
  if (!entry || entry.needsFile) return [];
  const key = id + "|" + buckets + "|" + (segments ? JSON.stringify(segments) : "raw") + (entry.samples ? "|" + entry.samples.length : "");
  if (!peakCache.has(key)) {
    const sr = entry.samples ? entry.sr : 22050, data = renderSfx(entry, sr);
    peakCache.set(key, !data ? [] : segments ? editedPeaks(data, sr, segments, buckets) : waveformPeaks(data, buckets));
  }
  return peakCache.get(key);
}
export const clipSegments = (layer) => layer.segments || defaultSegments(soundDuration(sfxById(layer.sfxId) || { dur: 1 }));

/** Linear fade envelope for a clip at timeline time t. */
export const fadeGain = (layer, t) => {
  const rel = t - layer.start, left = layer.start + layer.duration - t;
  let g = 1;
  if (layer.fadeIn > 0) g *= Math.min(1, Math.max(0, rel / layer.fadeIn));
  if (layer.fadeOut > 0) g *= Math.min(1, Math.max(0, left / layer.fadeOut));
  return g;
};
/** Smooth ducking gain: `ranges` are [start,end] seconds where speech is on screen. */
const duckGain = (ranges, level, t) => {
  let g = 1;
  for (const [a, b] of ranges) {
    const amt = t >= a && t <= b ? 1 : t < a ? Math.max(0, 1 - (a - t) / 0.15) : Math.max(0, 1 - (t - b) / 0.2);
    g = Math.min(g, 1 - (1 - level) * amt);
  }
  return g;
};

function connectClip(ctx, dest, layer, startAt, offset, opts) {
  const buf = getSfxBuffer(ctx, layer.sfxId);
  if (!buf) return [];
  const speed = layer.speed || 1, clipLen = layer.duration - offset;
  if (clipLen <= 0.005) return [];
  const gain = ctx.createGain(), steps = Math.max(2, Math.ceil(clipLen * 60) + 1), curve = new Float32Array(steps), ducking = layer.music && opts?.duckRanges?.length;
  for (let i = 0; i < steps; i++) {
    const t = layer.start + offset + (clipLen * i) / (steps - 1);
    curve[i] = Math.max(0, (Number(sampleProperty(layer, "volume", t)) / 100) * fadeGain(layer, t) * (ducking ? duckGain(opts.duckRanges, opts.duckLevel ?? 0.3, t) : 1));
  }
  gain.gain.setValueCurveAtTime(curve, startAt, clipLen);
  let node = gain;
  if (layer.filter?.type && layer.filter.type !== "none") { const f = ctx.createBiquadFilter(); f.type = layer.filter.type; f.frequency.value = layer.filter.freq || 1200; node.connect(f); node = f; }
  if (layer.eqLow) { const f = ctx.createBiquadFilter(); f.type = "lowshelf"; f.frequency.value = 220; f.gain.value = layer.eqLow; node.connect(f); node = f; }
  if (layer.eqHigh) { const f = ctx.createBiquadFilter(); f.type = "highshelf"; f.frequency.value = 3800; f.gain.value = layer.eqHigh; node.connect(f); node = f; }
  const out = ctx.createGain();
  node.connect(out);
  if (layer.echo > 0) { const d = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(); d.delayTime.value = 0.23; fb.gain.value = 0.38; wet.gain.value = layer.echo; node.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out); }
  if (layer.reverb > 0) { const c = ctx.createConvolver(), wet = ctx.createGain(); c.buffer = impulse(ctx); wet.gain.value = layer.reverb; node.connect(c); c.connect(wet); wet.connect(out); }
  let tail = out;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, Number(sampleProperty(layer, "pan", layer.start + offset)) / 100)); out.connect(p); tail = p; }
  for (const d of Array.isArray(dest) ? dest : [dest]) tail.connect(d);

  /* Segments play back to back; each has its own rate. startOut = position inside the edited result. */
  const startOut = offset + (layer.sourceOffset || 0), endOut = startOut + clipLen, sources = [];
  let acc = 0;
  for (const seg of clipSegments(layer)) {
    const d = segOutDur(seg) / speed, segStart = acc, segEnd = acc + d;
    acc = segEnd;
    if (segEnd <= startOut) continue;
    if (segStart >= endOut) break;
    const from = Math.max(segStart, startOut), to = Math.min(segEnd, endOut), when = startAt + (from - startOut);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = seg.rate * speed;
    src.connect(gain);
    src.start(when, seg.a + (from - segStart) * speed * seg.rate);
    src.stop(when + (to - from) + 0.01);
    sources.push(src);
  }
  return sources;
}

/** Schedule every sound clip that overlaps [fromTime, ∞). `when` is an AudioContext time. */
export function scheduleSfx(ctx, dest, layers, fromTime, when, opts = {}) {
  const sources = [], anySolo = layers.some((x) => x.solo);
  for (const l of layers) {
    if (l.kind !== "sfx" || l.muted || l.hidden || (anySolo && !l.solo)) continue;
    if (l.start + l.duration <= fromTime) continue;
    const startAt = when + Math.max(0, l.start - fromTime), offset = Math.max(0, fromTime - l.start);
    sources.push(...connectClip(ctx, dest, l, startAt, offset, opts));
  }
  return { stop: () => sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } }) };
}

let previewing = null;
export function previewSfx(id, onEnd) {
  const ctx = getAudioContext();
  ctx.resume?.();
  stopPreview();
  const buf = getSfxBuffer(ctx, id);
  if (!buf) return false;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; g.gain.value = 0.9; src.connect(g); g.connect(ctx.destination);
  src.onended = () => { if (previewing?.src === src) previewing = null; onEnd?.(); };
  src.start();
  previewing = { src, id, startedAt: ctx.currentTime, dur: buf.duration };
  return true;
}
/** Preview a single clip with its edits (used by the sound editor). */
export function previewClip(layer, onEnd) {
  const ctx = getAudioContext();
  ctx.resume?.();
  stopPreview();
  const handle = scheduleSfx(ctx, ctx.destination, [{ ...layer, start: 0, sourceOffset: 0, volume: layer.volume ?? 100, keyframes: {}, procedural: {} }], 0, ctx.currentTime + 0.02);
  const len = layer.duration;
  const timer = setTimeout(() => { previewing = null; onEnd?.(); }, len * 1000 + 80);
  previewing = { src: { stop: () => { handle.stop(); clearTimeout(timer); } }, id: "clip" };
}
export function stopPreview() { if (previewing) { try { previewing.src.stop(); } catch { /* ended */ } previewing = null; } }
export const previewingId = () => previewing?.id || null;
export const previewProgress = () => { if (!previewing?.dur) return null; const ctx = getAudioContext(); return { id: previewing.id, t: Math.min(previewing.dur, ctx.currentTime - previewing.startedAt), dur: previewing.dur }; };
