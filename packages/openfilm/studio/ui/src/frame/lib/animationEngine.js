const clamp01 = value => Math.max(0, Math.min(1, value));

function cubicBezier(x1, y1, x2, y2, progress) {
  const bezier = (a, b, t) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 22; i++) {
    const middle = (low + high) / 2;
    if (bezier(x1, x2, middle) < progress) low = middle; else high = middle;
  }
  return bezier(y1, y2, (low + high) / 2);
}

export const EASING_OPTIONS = ['Linear', 'Ease in', 'Ease out', 'Ease in-out', 'Smooth', 'Bounce', 'Elastic', 'Back', 'Hold'];
export const EASING_LABELS = { 'Linear': 'Linear', 'Ease in': 'Ease In', 'Ease out': 'Ease Out', 'Ease in-out': 'Ease In & Out', 'Smooth': 'Smooth', 'Bounce': 'Bounce', 'Elastic': 'Elastic', 'Back': 'Back', 'Hold': 'Hold' };
export const DEFAULT_BEZIER = [0.42, 0, 0.58, 1];
export const isCustomEasing = easing => !!easing && typeof easing === 'object' && easing.type === 'cubicBezier';
export const customEasing = (points = DEFAULT_BEZIER) => ({ type: 'cubicBezier', points: points.map(Number) });
const EASING_ALIASES = { linear: 'Linear', easein: 'Ease in', easeout: 'Ease out', easeinout: 'Ease in-out', 'ease in & out': 'Ease in-out', smooth: 'Smooth', bounce: 'Bounce', elastic: 'Elastic', back: 'Back', hold: 'Hold' };
export function normalizeEasing(easing) {
  if (easing && typeof easing === 'object') return easing;
  if (EASING_OPTIONS.includes(easing)) return easing;
  return EASING_ALIASES[String(easing || '').toLowerCase().replace(/[\s_-]/g, '')] || EASING_ALIASES[String(easing || '').toLowerCase()] || 'Linear';
}

export function easingAt(progress, rawEasing = 'Linear') {
  const easing = normalizeEasing(rawEasing);
  const t = clamp01(progress);
  if (easing && typeof easing === 'object' && easing.type === 'cubicBezier') {
    const [x1, y1, x2, y2] = easing.points || [0, 0, 1, 1];
    return cubicBezier(x1, y1, x2, y2, t);
  }
  switch (easing) {
    case 'Hold': return 0;
    /* cubic curves (as After Effects' easy ease and CSS's ease-in-out-cubic feel): a visible slow start / slow stop */
    case 'Ease in': return cubicBezier(.55, 0, 1, .45, t);
    case 'Ease out': return cubicBezier(0, .55, .45, 1, t);
    case 'Ease in-out': return cubicBezier(.65, 0, .35, 1, t);
    case 'Smooth': return cubicBezier(.4, 0, .2, 1, t);
    case 'Back': return 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
    case 'Bounce': {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t - 1.5 / d) ** 2 + .75;
      if (t < 2.5 / d) return n * (t - 2.25 / d) ** 2 + .9375;
      return n * (t - 2.625 / d) ** 2 + .984375;
    }
    case 'Elastic': return t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1;
    default: return t;
  }
}

const parseColor = value => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value));
  if (!hex) return null;
  const full = hex[1].length === 3 ? [...hex[1]].map(char => char + char).join('') : hex[1];
  return [0, 2, 4].map(start => Number.parseInt(full.slice(start, start + 2), 16));
};

function mixValue(a, b, progress) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * progress;
  const first = parseColor(a), second = parseColor(b);
  if (first && second) return '#' + first.map((channel, index) => Math.max(0, Math.min(255, Math.round(channel + (second[index] - channel) * progress))).toString(16).padStart(2, '0')).join('');
  return progress < 1 ? a : b;
}

/** Snap a time in seconds to the nearest frame boundary for a given fps. */
export const snapToFrame = (time, fps = 30) => Math.round(time * fps) / fps;
export const timeToFrame = (time, fps = 30) => Math.round(time * fps);
export const frameToTime = (frame, fps = 30) => frame / fps;

/** Map a time into the keyframe span for repeat / ping-pong / reverse playback. */
export function loopTime(time, first, last, mode = 'none') {
  const span = last - first;
  if (!(span > 0) || mode === 'none' || !mode) return time;
  if (mode === 'reverse') return last - Math.min(Math.max(time - first, 0), span);
  if (time <= first) return time;
  const elapsed = time - first;
  if (mode === 'repeat') return first + (elapsed % span);
  if (mode === 'pingpong') {
    const phase = elapsed % (span * 2);
    return first + (phase <= span ? phase : span * 2 - phase);
  }
  return time;
}

function sampleKeyframes(layer, key, rawTime) {
  const list = layer.keyframes?.[key];
  if (!list || list.length === 0 || layer.animationEnabled?.[key] === false) return layer[key] ?? PROPERTY_DEFS[key]?.default;
  let frames = list;
  for (let i = 1; i < frames.length; i++) if (frames[i].time < frames[i - 1].time) { frames = [...list].sort((a, b) => a.time - b.time); break; }
  const time = frames.length > 1 ? loopTime(rawTime, frames[0].time, frames.at(-1).time, layer.keyframeLoop?.[key] || layer.keyframeLoop?.all) : rawTime;
  if (time <= frames[0].time) return frames[0].value;
  if (time >= frames.at(-1).time) return frames.at(-1).value;
  let index = 1;
  while (index < frames.length - 1 && frames[index].time < time) index++;
  const before = frames[index - 1], after = frames[index];
  if (after.time === before.time) return after.value;
  const amount = easingAt((time - before.time) / (after.time - before.time), after.ease || 'Linear');
  return mixValue(before.value, after.value, amount);
}

/** Canonical evaluator shared by preview, scrubbing and export. `ctx.envelope(time, spec)` feeds audio-reactive motion. */
export function sampleProperty(layer, key, rawTime, ctx) {
  let value = sampleKeyframes(layer, key, rawTime);
  if (typeof value !== 'number') return value;
  if (!layer.expressions?.[key] && !layer.procedural?.[key]) return PROPERTY_DEFS[key] ? clampToProperty(key, value) : value;
  const expression = layer.expressions?.[key];
  if (expression) { const r = evaluateExpression(expression, { t: rawTime - (layer.start || 0), value }); if (r !== null) value = r; }
  const spec = layer.procedural?.[key];
  if (spec) value += proceduralOffset(spec, rawTime, ctx);
  return PROPERTY_DEFS[key] ? clampToProperty(key, value) : value;
}

/** Sample every animated property of a layer at one timeline time (deterministic, no wall-clock). */
export function sampleLayer(layer, time, keys = Object.keys(layer.keyframes || {}), ctx) {
  const out = {};
  for (const key of keys) out[key] = sampleProperty(layer, key, time, ctx);
  return out;
}

/* ------------------------------------------------------------------ */
/* Easing speed (derivative) — drives the Graph Editor speed curve     */
/* ------------------------------------------------------------------ */
export function easingSpeedAt(progress, easing = 'Linear') {
  const h = 1 / 400, a = clamp01(progress - h), b = clamp01(progress + h);
  if (b === a) return 0;
  return (easingAt(b, easing) - easingAt(a, easing)) / (b - a);
}

/* ------------------------------------------------------------------ */
/* Property registry: one typed definition per animatable property     */
/* ------------------------------------------------------------------ */
const num = (label, group, min, max, step, unit, def, extra = {}) => ({ label, group, type: 'number', min, max, step, unit, default: def, ...extra });
export const PROPERTY_DEFS = {
  x: num('Position X', 'Transform', -100, 200, 0.1, '%', 50, { basic: 'Position' }),
  y: num('Position Y', 'Transform', -100, 200, 0.1, '%', 50, { basic: 'Position' }),
  scale: num('Scale', 'Transform', 0, 500, 1, '%', 100, { basic: 'Size' }),
  width: num('Width', 'Transform', 0, 300, 0.1, '%', 50, { advanced: true, shapes: true }),
  height: num('Height', 'Transform', 0, 300, 0.1, '%', 50, { advanced: true, shapes: true }),
  rotation: num('Rotation', 'Transform', -3600, 3600, 1, '°', 0, { basic: 'Rotation' }),
  anchorX: num('Anchor X', 'Transform', -100, 100, 0.5, '%', 0, { advanced: true }),
  anchorY: num('Anchor Y', 'Transform', -100, 100, 0.5, '%', 0, { advanced: true }),
  skewX: num('Skew', 'Transform', -80, 80, 0.5, '°', 0, { advanced: true }),
  opacity: num('Opacity', 'Appearance', 0, 100, 1, '%', 100, { basic: 'Opacity' }),
  color: { label: 'Color', group: 'Appearance', type: 'color', default: '#ffffff', basic: 'Color' },
  color2: { label: 'Gradient end', group: 'Appearance', type: 'color', default: '#38bdf8', advanced: true },
  strokeColor: { label: 'Stroke color', group: 'Appearance', type: 'color', default: '#000000', advanced: true },
  strokeWidth: num('Stroke width', 'Appearance', 0, 40, 0.5, 'px', 0, { advanced: true }),
  cornerRadius: num('Corner radius', 'Appearance', 0, 100, 0.5, '%', 0, { advanced: true, shapes: true }),
  shadowBlur: num('Shadow', 'Appearance', 0, 80, 1, 'px', 0, { advanced: true }),
  glow: num('Glow', 'Effects', 0, 80, 1, 'px', 0, { advanced: true, basic: 'Effects' }),
  blur: num('Blur', 'Effects', 0, 60, 0.5, 'px', 0, { basic: 'Effects' }),
  brightness: num('Brightness', 'Effects', 0, 300, 1, '%', 100, { advanced: true }),
  contrast: num('Contrast', 'Effects', 0, 300, 1, '%', 100, { advanced: true }),
  saturation: num('Saturation', 'Effects', 0, 400, 1, '%', 100, { advanced: true }),
  hue: num('Hue', 'Effects', -180, 180, 1, '°', 0, { advanced: true }),
  letterSpacing: num('Letter spacing', 'Text', -20, 80, 0.5, 'px', 0, { advanced: true, text: true }),
  fontSize: num('Font size', 'Text', 12, 400, 1, 'px', 90, { advanced: true, text: true }),
  vignette: num('Vignette', 'Effects', 0, 100, 1, '%', 0, { advanced: true }),
  arc: num('Text curve', 'Text', -360, 360, 1, '°', 0, { advanced: true, text: true }),
  reveal: num('Reveal', 'Effects', 0, 100, 1, '%', 100, { advanced: true }),
  maskW: num('Mask width', 'Mask', 0, 300, 0.5, '%', 100, { advanced: true }),
  maskH: num('Mask height', 'Mask', 0, 300, 0.5, '%', 100, { advanced: true }),
  maskX: num('Mask X', 'Mask', -100, 100, 0.5, '%', 0, { advanced: true }),
  maskY: num('Mask Y', 'Mask', -100, 100, 0.5, '%', 0, { advanced: true }),
  maskFeather: num('Mask feather', 'Mask', 0, 120, 0.5, 'px', 0, { advanced: true }),
  volume: num('Volume', 'Audio', 0, 200, 1, '%', 100, { audio: true }),
  pan: num('Pan', 'Audio', -100, 100, 1, '', 0, { audio: true, advanced: true }),
};
export const ANIMATABLE_KEYS = Object.keys(PROPERTY_DEFS);
export function clampToProperty(key, value) {
  const def = PROPERTY_DEFS[key];
  if (!def) return value;
  if (def.type === 'color') return parseColor(value) ? String(value).toLowerCase() : def.default;
  const n = Number(value);
  if (!Number.isFinite(n)) return def.default;
  return Math.min(def.max, Math.max(def.min, n));
}
export const propertyDefault = key => PROPERTY_DEFS[key]?.default;
/** Layer value of a property regardless of animation (falls back to registry default). */
export const baseValue = (layer, key) => layer[key] ?? PROPERTY_DEFS[key]?.default;

/* ------------------------------------------------------------------ */
/* Keyframe operations (pure; operate on arrays of {id,time,value,ease})*/
/* ------------------------------------------------------------------ */
let idCounter = 0;
export const keyframeId = () => 'kf_' + Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
const sortFrames = frames => [...frames].sort((a, b) => a.time - b.time);
const eps = fps => 0.5 / fps;

export function upsertKeyframe(frames = [], { time, value, ease }, fps = 30) {
  const at = snapToFrame(time, fps), existing = frames.find(f => Math.abs(f.time - at) < eps(fps));
  if (existing) return sortFrames(frames.map(f => f === existing ? { ...f, time: at, value, ...(ease ? { ease } : {}) } : f));
  return sortFrames([...frames, { id: keyframeId(), time: at, value, ease: ease || 'Linear' }]);
}
export const removeKeyframeById = (frames = [], id) => frames.filter(f => f.id !== id);
export const keyframeAt = (frames = [], time, fps = 30) => frames.find(f => Math.abs(f.time - time) < eps(fps));
export function nextKeyframeTime(frames = [], time, fps = 30) { return sortFrames(frames).find(f => f.time > time + eps(fps))?.time ?? null; }
export function prevKeyframeTime(frames = [], time, fps = 30) { return sortFrames(frames).reverse().find(f => f.time < time - eps(fps))?.time ?? null; }

/** Move selected keyframes together; neighbours keep order and times never go below minTime. */
export function moveKeyframes(frames = [], ids, delta, fps = 30, minTime = -Infinity, maxTime = Infinity) {
  const set = new Set(ids), selected = frames.filter(f => set.has(f.id));
  if (!selected.length) return frames;
  const lo = Math.min(...selected.map(f => f.time)), hi = Math.max(...selected.map(f => f.time));
  const d = Math.min(maxTime - hi, Math.max(minTime - lo, delta));
  const moved = frames.map(f => set.has(f.id) ? { ...f, time: snapToFrame(f.time + d, fps) } : f);
  // collisions: a moved key replaces an unselected key at the same frame
  const result = [];
  for (const f of sortFrames(moved)) {
    const clash = result.find(r => Math.abs(r.time - f.time) < eps(fps));
    if (!clash) result.push(f); else if (set.has(f.id)) result[result.indexOf(clash)] = f;
  }
  return result;
}
/** Stretch/compress timing of the selected keyframes around the earliest selected one. */
export function stretchKeyframes(frames = [], ids, factor, fps = 30) {
  const set = new Set(ids), selected = frames.filter(f => set.has(f.id));
  if (selected.length < 2 || !(factor > 0)) return frames;
  const pivot = Math.min(...selected.map(f => f.time));
  return sortFrames(frames.map(f => set.has(f.id) ? { ...f, time: snapToFrame(pivot + (f.time - pivot) * factor, fps) } : f));
}
const FLIP = { 'Ease in': 'Ease out', 'Ease out': 'Ease in' };
const flipEasing = e => isCustomEasing(e) ? customEasing([1 - e.points[2], 1 - e.points[3], 1 - e.points[0], 1 - e.points[1]]) : (FLIP[e] || e);
/** Reverse an animation: mirrored in time, values reversed, segment easings flipped. */
export function reverseKeyframes(frames = []) {
  const s = sortFrames(frames);
  if (s.length < 2) return s;
  const first = s[0].time, last = s.at(-1).time;
  return s.map((f, i) => ({ ...f, time: first + last - f.time, value: f.value })).reverse()
    .map((f, i, arr) => ({ ...f, ease: flipEasing(s[s.length - 2 - i]?.ease ?? f.ease) }));
}
export function copyKeyframes(frames = [], ids) {
  const picked = sortFrames(frames.filter(f => ids.includes(f.id)));
  if (!picked.length) return null;
  const origin = picked[0].time;
  return picked.map(f => ({ offset: f.time - origin, value: f.value, ease: f.ease }));
}
export function pasteKeyframes(frames = [], clip, at, fps = 30) {
  if (!clip?.length) return frames;
  let out = frames;
  for (const c of clip) out = upsertKeyframe(out, { time: at + c.offset, value: c.value, ease: c.ease }, fps);
  return out;
}
/** Duplicate the animation so it plays again straight after the last keyframe. */
export function duplicateAnimation(frames = [], fps = 30) {
  const s = sortFrames(frames);
  if (s.length < 2) return s;
  const span = s.at(-1).time - s[0].time, gap = 1 / fps;
  const copy = s.slice(1).map(f => ({ ...f, id: keyframeId(), time: snapToFrame(f.time + span + gap, fps) }));
  const bridge = { ...s[0], id: keyframeId(), time: snapToFrame(s.at(-1).time + gap, fps) };
  return sortFrames([...s, bridge, ...copy]);
}
/** Snap a time to frames, then to nearby markers / keyframes / playhead if within threshold (seconds). */
export function snapTime(time, { fps = 30, targets = [], threshold = 0.06 } = {}) {
  let best = null, dist = threshold;
  for (const target of targets) { const d = Math.abs(target - time); if (d < dist) { dist = d; best = target; } }
  return best ?? snapToFrame(time, fps);
}

/* ------------------------------------------------------------------ */
/* Procedural animation: deterministic noise / oscillators / audio      */
/* ------------------------------------------------------------------ */
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return s - Math.floor(s); }
/** Smooth 1-D value noise in [-1,1]; same (seed,t) always yields the same number. */
export function noise1d(t, seed = 1) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash(i + seed * 97.13) * (1 - u) + hash(i + 1 + seed * 97.13) * u) * 2 - 1;
}
export const PROCEDURAL_TYPES = ['wiggle', 'oscillate', 'bounce', 'shake', 'audio', 'follow'];
export function proceduralOffset(spec, time, ctx = {}) {
  if (!spec || spec.enabled === false) return 0;
  const amp = Number(spec.amount ?? 0), freq = Number(spec.frequency ?? 2), seed = Number(spec.seed ?? 1);
  switch (spec.type) {
    case 'wiggle': return amp * (noise1d(time * freq, seed) * 0.7 + noise1d(time * freq * 2.3, seed + 7) * 0.3);
    case 'shake': return amp * noise1d(time * freq * 8, seed);
    case 'oscillate': return amp * Math.sin(2 * Math.PI * freq * time + (spec.phase || 0));
    case 'bounce': return amp * Math.abs(Math.sin(Math.PI * freq * time));
    case 'audio': return amp * (ctx.envelope ? ctx.envelope(time, spec) : 0);
    default: return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Sandboxed expressions — a tiny parser, never eval / Function         */
/* ------------------------------------------------------------------ */
const EXPR_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, abs: Math.abs, sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  min: Math.min, max: Math.max, pow: Math.pow, log: Math.log, exp: Math.exp,
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)), lerp: (a, b, k) => a + (b - a) * k,
  noise: (t, seed = 1) => noise1d(t, seed), wiggle: (freq, amp, t, seed = 1) => amp * noise1d(t * freq, seed),
  random: (seed) => hash(seed), deg: v => v * Math.PI / 180,
};
export const EXPRESSION_FUNCTIONS = Object.keys(EXPR_FUNCS);
export const EXPRESSION_VARIABLES = ['t', 'value', 'index', 'pi'];
function tokenize(src) {
  const tokens = [], re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_]\w*)|(\*\*|[-+*/%^(),]))/y;
  let m, pos = 0; src = String(src);
  while (pos < src.length) {
    re.lastIndex = pos; m = re.exec(src);
    if (!m) { if (!src.slice(pos).trim()) break; throw new Error('Unexpected character at ' + pos); }
    pos = re.lastIndex;
    tokens.push(m[1] !== undefined ? { n: parseFloat(m[1]) } : m[2] !== undefined ? { id: m[2] } : { op: m[3] });
  }
  return tokens;
}
export function compileExpression(src) {
  const tokens = tokenize(src); let i = 0;
  const peek = () => tokens[i], eat = () => tokens[i++];
  const expectOp = op => { if (peek()?.op !== op) throw new Error('Expected ' + op); i++; };
  function primary() {
    const tok = eat();
    if (!tok) throw new Error('Unexpected end');
    if (tok.n !== undefined) return () => tok.n;
    if (tok.op === '(') { const e = add(); expectOp(')'); return e; }
    if (tok.op === '-') { const e = unary(); return v => -e(v); }
    if (tok.op === '+') return unary();
    if (tok.id) {
      if (peek()?.op === '(') {
        i++; const args = [];
        if (peek()?.op !== ')') { do { args.push(add()); } while (peek()?.op === ',' && i++); }
        expectOp(')');
        const fn = EXPR_FUNCS[tok.id];
        if (!fn) throw new Error('Unknown function ' + tok.id);
        return v => fn(...args.map(a => a(v)));
      }
      if (!EXPRESSION_VARIABLES.includes(tok.id)) throw new Error('Unknown variable ' + tok.id);
      return v => tok.id === 'pi' ? Math.PI : v[tok.id];
    }
    throw new Error('Unexpected token');
  }
  function unary() { return primary(); }
  function power() { let l = unary(); while (peek()?.op === '^' || peek()?.op === '**') { i++; const r = unary(), a = l; l = v => Math.pow(a(v), r(v)); } return l; }
  function mul() { let l = power(); while (['*', '/', '%'].includes(peek()?.op)) { const op = eat().op, r = power(), a = l; l = v => op === '*' ? a(v) * r(v) : op === '/' ? a(v) / r(v) : a(v) % r(v); } return l; }
  function add() { let l = mul(); while (['+', '-'].includes(peek()?.op)) { const op = eat().op, r = mul(), a = l; l = v => op === '+' ? a(v) + r(v) : a(v) - r(v); } return l; }
  const program = add();
  if (i < tokens.length) throw new Error('Unexpected token');
  return program;
}
export function evaluateExpression(src, vars) {
  try { const r = compileExpression(src)({ pi: Math.PI, index: 0, value: 0, t: 0, ...vars }); return Number.isFinite(r) ? r : null; }
  catch { return null; }
}
export function validateExpression(src) { try { compileExpression(src); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }

/* ------------------------------------------------------------------ */
/* Audio envelope analysis + baking                                    */
/* ------------------------------------------------------------------ */
/** Reduce PCM samples to one 0..1 amplitude value per video frame. Pure and deterministic. */
export function analyzeEnvelope(samples, sampleRate, fps = 30, { smoothing = 0.35 } = {}) {
  const per = Math.max(1, Math.floor(sampleRate / fps)), count = Math.ceil(samples.length / per), out = new Float32Array(count);
  let peak = 1e-6;
  for (let f = 0; f < count; f++) {
    let sum = 0; const from = f * per, to = Math.min(samples.length, from + per);
    for (let s = from; s < to; s++) sum += samples[s] * samples[s];
    out[f] = Math.sqrt(sum / Math.max(1, to - from)); if (out[f] > peak) peak = out[f];
  }
  let prev = 0;
  for (let f = 0; f < count; f++) { out[f] = out[f] / peak; prev = out[f] > prev ? out[f] : prev * smoothing + out[f] * (1 - smoothing); out[f] = prev; }
  return out;
}
/** Beat onsets (seconds) from an envelope: local maxima above `sensitivity` following a rise. */
export function detectBeats(envelope, fps = 30, sensitivity = 0.55, minGap = 0.18) {
  const beats = []; let last = -Infinity;
  for (let i = 2; i < envelope.length - 1; i++) {
    const rise = envelope[i] - envelope[i - 2];
    if (envelope[i] >= sensitivity && rise > 0.12 && envelope[i] >= envelope[i - 1] && envelope[i] >= envelope[i + 1] && i / fps - last >= minGap) { beats.push(i / fps); last = i / fps; }
  }
  return beats;
}
export const envelopeAt = (envelope, fps, time) => {
  if (!envelope?.length) return 0;
  const p = Math.max(0, time) * fps, i = Math.min(envelope.length - 1, Math.floor(p)), j = Math.min(envelope.length - 1, i + 1);
  return envelope[i] + (envelope[j] - envelope[i]) * (p - i);
};
/** Convert any sampled function into editable keyframes ("Bake to Keyframes"), dropping redundant points. */
export function bakeToKeyframes(fn, start, end, fps = 30, { step = 1, tolerance = 0.0005 } = {}) {
  const frames = [], a = Math.round(start * fps), b = Math.round(end * fps);
  for (let f = a; f <= b; f += Math.max(1, step)) frames.push({ id: keyframeId(), time: f / fps, value: fn(f / fps), ease: 'Linear' });
  if (frames.at(-1) && Math.round(frames.at(-1).time * fps) !== b) frames.push({ id: keyframeId(), time: b / fps, value: fn(b / fps), ease: 'Linear' });
  return frames.filter((f, i) => {
    if (i === 0 || i === frames.length - 1) return true;
    const p = frames[i - 1], n = frames[i + 1];
    if (typeof f.value !== 'number') return true;
    const expect = p.value + (n.value - p.value) * ((f.time - p.time) / (n.time - p.time));
    return Math.abs(expect - f.value) > tolerance * Math.max(1, Math.abs(f.value));
  });
}
/** Offset each layer's animation start so a set of layers reveals one after another. */
export function staggerLayers(layers, ids, gap = 0.12) {
  return layers.map(layer => { const k = ids.indexOf(layer.id); if (k < 0) return layer; const shift = k * gap; return { ...layer, start: layer.start + shift, keyframes: shiftKeyframes(layer.keyframes, shift) }; });
}
export function shiftKeyframes(keyframes = {}, delta) {
  return Object.fromEntries(Object.entries(keyframes).map(([name, frames]) => [name, frames.map(f => ({ ...f, time: f.time + delta }))]));
}

/* ------------------------------------------------------------------ */
/* Migration & validation for saved projects (versioned schema)         */
/* ------------------------------------------------------------------ */
export const ANIMATION_SCHEMA_VERSION = 2;
export function migrateLayer(layer) {
  if (!layer || typeof layer !== 'object') return layer;
  const keyframes = {};
  for (const [key, frames] of Object.entries(layer.keyframes || {})) {
    if (!Array.isArray(frames)) continue;
    const seen = new Set();
    keyframes[key] = sortFrames(frames.filter(f => f && Number.isFinite(f.time)).map(f => {
      let id = f.id; if (!id || seen.has(id)) id = keyframeId(); seen.add(id);
      return { ...f, id, time: f.time, value: PROPERTY_DEFS[key] ? clampToProperty(key, f.value) : f.value, ease: f.ease ?? 'Linear' };
    }));
  }
  return { ...layer, keyframes, animationEnabled: layer.animationEnabled || {}, procedural: layer.procedural || {}, expressions: layer.expressions || {}, schema: ANIMATION_SCHEMA_VERSION };
}
