import { keyframeId, snapToFrame, sampleProperty, PROPERTY_DEFS } from "./animationEngine.js";

/* One-click animation presets. Each preset *builds editable keyframes / procedural
   specs* on the layer (never an opaque overlay), relative to the layer's own timing:
   entrance → starts at layer start + delay, exit → ends at layer end - delay,
   continuous → loops across the whole layer. */

const FPS = 30;
export const PRESET_CATEGORIES = ["Entrance", "Exit", "Continuous", "Motion Graphics", "Social Media"];
export const DIRECTIONS = ["Left", "Right", "Up", "Down"];

const dirVec = (dir = "Up") => ({ Left: [-1, 0], Right: [1, 0], Up: [0, -1], Down: [0, 1] }[dir] || [0, -1]);

/* Track builder: steps are [fraction 0..1, value, ease?] mapped onto [t0, t0 + dur]. */
const track = (t0, dur, steps) => steps.map(([f, value, ease]) => ({ id: keyframeId(), time: snapToFrame(t0 + dur * f, FPS), value, ease: ease || "Linear" }));

/* ctx = { layer, t0, t1, dur, k (intensity 0..2), dir, ease } */
const entrance = (build) => (ctx) => build({ ...ctx, a: ctx.t0, d: ctx.dur, sign: 1 });
const exitOf = (build) => (ctx) => build({ ...ctx, a: ctx.t1 - ctx.dur, d: ctx.dur, sign: -1 });

/* helper: animate from -> to over the window; for exits it plays "to -> from" semantic by flipping */
const tween = (ctx, key, from, to, ease) => {
  const e = ease || ctx.ease || "Smooth";
  return { [key]: ctx.sign === 1 ? track(ctx.a, ctx.d, [[0, from], [1, to, e]]) : track(ctx.a, ctx.d, [[0, to], [1, from, e]]) };
};
const merge = (...parts) => Object.assign({}, ...parts);
const base = (layer, key) => layer[key] ?? PROPERTY_DEFS[key]?.default;

const slide = (ctx) => {
  const [vx, vy] = dirVec(ctx.dir === "Up" ? "Left" : ctx.dir), dist = 28 * ctx.k, { layer } = ctx;
  return merge(tween(ctx, "x", base(layer, "x") + vx * dist, base(layer, "x")), tween(ctx, "y", base(layer, "y") + vy * dist, base(layer, "y")), tween(ctx, "opacity", 0, base(layer, "opacity")));
};
const fade = (ctx) => tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out");
const zoom = (ctx) => merge(tween(ctx, "scale", base(ctx.layer, "scale") * (ctx.sign === 1 ? 0.4 : 1.6) * (ctx.k > 1 ? 0.8 : 1), base(ctx.layer, "scale")), tween(ctx, "opacity", 0, base(ctx.layer, "opacity")));
const pop = (ctx) => merge(tween(ctx, "scale", 0, base(ctx.layer, "scale"), "Back"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out"));
const bounce = (ctx) => merge(tween(ctx, "y", base(ctx.layer, "y") - 40 * ctx.k, base(ctx.layer, "y"), "Bounce"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out"));
const drop = (ctx) => merge(tween(ctx, "y", base(ctx.layer, "y") - 45 * ctx.k, base(ctx.layer, "y"), "Ease in"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out"));
const rise = (ctx) => merge(tween(ctx, "y", base(ctx.layer, "y") + 22 * ctx.k, base(ctx.layer, "y"), "Ease out"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out"));
const spin = (ctx) => merge(tween(ctx, "rotation", -270 * ctx.k, base(ctx.layer, "rotation"), "Ease out"), tween(ctx, "scale", 0.2, base(ctx.layer, "scale"), "Ease out"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity")));
const blur = (ctx) => merge(tween(ctx, "blur", 24 * ctx.k, 0, "Ease out"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Ease out"));
const wipe = (ctx) => tween(ctx, "reveal", 0, 100, ctx.ease || "Ease in-out");
const shrink = (ctx) => merge(tween(ctx, "scale", 0, base(ctx.layer, "scale"), "Ease in"), tween(ctx, "opacity", 0, base(ctx.layer, "opacity")));
const dissolve = (ctx) => merge(tween(ctx, "opacity", 0, base(ctx.layer, "opacity"), "Linear"), tween(ctx, "blur", 14 * ctx.k, 0, "Linear"));

const loopSpec = (key, type, amount, frequency, extra = {}) => ({ [key]: { type, amount, frequency, seed: 1, ...extra } });
const continuous = (fn) => (ctx) => fn({ ...ctx, a: ctx.t0, d: Math.max(0.1, ctx.t1 - ctx.t0) });

export const ANIMATION_PRESETS = [
  /* Entrance */
  ...[["fade-in", "Fade In", fade], ["slide-in", "Slide In", slide, true], ["zoom-in", "Zoom In", zoom], ["pop", "Pop", pop], ["bounce-in", "Bounce", bounce], ["drop-in", "Drop", drop], ["rise-in", "Rise", rise], ["spin-in", "Spin In", spin], ["blur-in", "Blur In", blur], ["reveal", "Reveal", wipe], ["wipe-in", "Wipe", wipe]]
    .map(([id, name, fn, dir]) => ({ id, name, category: "Entrance", phase: "in", dir: !!dir, duration: 0.5, build: entrance(fn) })),
  { id: "typewriter", name: "Typewriter", category: "Entrance", phase: "in", duration: 1.2, build: entrance((ctx) => tween(ctx, "reveal", 0, 100, "Linear")) },
  /* Exit */
  ...[["fade-out", "Fade Out", fade], ["slide-out", "Slide Out", slide, true], ["shrink", "Shrink", shrink], ["spin-out", "Spin Out", spin], ["blur-out", "Blur Out", blur], ["dissolve", "Dissolve", dissolve], ["drop-out", "Drop", drop], ["wipe-out", "Wipe", wipe]]
    .map(([id, name, fn, dir]) => ({ id, name, category: "Exit", phase: "out", dir: !!dir, duration: 0.5, build: exitOf(fn) })),
  /* Continuous */
  { id: "float", name: "Float", category: "Continuous", phase: "loop", duration: 2, build: continuous((c) => ({ procedural: loopSpec("y", "oscillate", 1.4 * c.k, 0.5) })) },
  { id: "pulse", name: "Pulse", category: "Continuous", phase: "loop", duration: 1, build: continuous((c) => ({ procedural: loopSpec("scale", "oscillate", 6 * c.k, 1.2) })) },
  { id: "wiggle", name: "Wiggle", category: "Continuous", phase: "loop", duration: 2, build: continuous((c) => ({ procedural: { ...loopSpec("x", "wiggle", 2 * c.k, 3), ...loopSpec("rotation", "wiggle", 6 * c.k, 3, { seed: 2 }) } })) },
  { id: "shake", name: "Shake", category: "Continuous", phase: "loop", duration: 1, build: continuous((c) => ({ procedural: { ...loopSpec("x", "shake", 1.4 * c.k, 4), ...loopSpec("y", "shake", 1.4 * c.k, 4, { seed: 3 }) } })) },
  { id: "rotate", name: "Rotate", category: "Continuous", phase: "loop", duration: 3, build: continuous((c) => ({ keyframes: { rotation: track(c.a, c.d, [[0, 0], [1, 360 * (c.dir === "Left" ? -1 : 1)]]) }, loop: { rotation: "repeat" } })) },
  { id: "bob", name: "Bob", category: "Continuous", phase: "loop", duration: 1, build: continuous((c) => ({ procedural: loopSpec("y", "bounce", -2.2 * c.k, 1) })) },
  { id: "sway", name: "Sway", category: "Continuous", phase: "loop", duration: 2, build: continuous((c) => ({ procedural: loopSpec("rotation", "oscillate", 7 * c.k, 0.6) })) },
  { id: "blink", name: "Blink", category: "Continuous", phase: "loop", duration: 1, build: continuous((c) => ({ keyframes: { opacity: track(c.a, 1, [[0, 100, "Hold"], [0.5, 15, "Hold"], [1, 100, "Hold"]]) }, loop: { opacity: "repeat" } })) },
  { id: "glow-pulse", name: "Glow Pulse", category: "Continuous", phase: "loop", duration: 1.5, build: continuous((c) => ({ keyframes: { glow: track(c.a, 1.5, [[0, 0], [0.5, 36 * c.k, "Ease in-out"], [1, 0, "Ease in-out"]]) }, loop: { glow: "repeat" } })) },
  { id: "breathing", name: "Breathing", category: "Continuous", phase: "loop", duration: 4, build: continuous((c) => ({ procedural: loopSpec("scale", "oscillate", 3.5 * c.k, 0.25) })) },
  /* Motion graphics */
  { id: "counter", name: "Counter Increase", category: "Motion Graphics", phase: "in", duration: 2, textOnly: true, build: entrance((c) => ({ keyframes: { counter: track(c.a, c.d, [[0, 0], [1, 100, c.ease || "Ease out"]]) } })) },
  { id: "progress", name: "Progress Bar Fill", category: "Motion Graphics", phase: "in", duration: 1.6, build: entrance((c) => tween(c, "reveal", 0, 100, c.ease || "Ease in-out")) },
  { id: "line-reveal", name: "Line Reveal", category: "Motion Graphics", phase: "in", duration: 0.8, build: entrance((c) => tween(c, "reveal", 0, 100, c.ease || "Ease out")) },
  { id: "shape-morph", name: "Shape Morph", category: "Motion Graphics", phase: "in", duration: 1, shapeOnly: true, build: entrance((c) => merge(tween(c, "cornerRadius", 0, 50, c.ease || "Ease in-out"), tween(c, "rotation", 0, 90 * c.k, c.ease || "Ease in-out"))) },
  { id: "logo-reveal", name: "Logo Reveal", category: "Motion Graphics", phase: "in", duration: 1.1, build: entrance((c) => merge(tween(c, "scale", base(c.layer, "scale") * 0.55, base(c.layer, "scale"), "Back"), tween(c, "blur", 18 * c.k, 0, "Ease out"), tween(c, "opacity", 0, base(c.layer, "opacity"), "Ease out"), tween(c, "glow", 40 * c.k, 0, "Ease out"))) },
  { id: "parallax", name: "Parallax", category: "Motion Graphics", phase: "loop", duration: 5, build: continuous((c) => ({ keyframes: { x: track(c.a, c.d, [[0, base(c.layer, "x") - 3 * c.k], [1, base(c.layer, "x") + 3 * c.k, "Linear"]]) } })) },
  /* Social */
  { id: "punch-zoom", name: "Punch Zoom", category: "Social Media", phase: "in", duration: 0.35, build: entrance((c) => ({ keyframes: { scale: track(c.a, c.d, [[0, base(c.layer, "scale")], [0.35, base(c.layer, "scale") * (1 + 0.25 * c.k), "Ease out"], [1, base(c.layer, "scale"), "Ease in-out"]]) } })) },
  { id: "emphasis-pop", name: "Emphasis Pop", category: "Social Media", phase: "in", duration: 0.4, build: entrance((c) => ({ keyframes: { scale: track(c.a, c.d, [[0, base(c.layer, "scale") * 0.8], [0.5, base(c.layer, "scale") * (1 + 0.18 * c.k), "Back"], [1, base(c.layer, "scale"), "Ease in-out"]]) } })) },
  { id: "caption-bounce", name: "Caption Bounce", category: "Social Media", phase: "in", duration: 0.5, build: entrance((c) => merge(tween(c, "y", base(c.layer, "y") + 8 * c.k, base(c.layer, "y"), "Bounce"), tween(c, "scale", base(c.layer, "scale") * 0.7, base(c.layer, "scale"), "Back"), tween(c, "opacity", 0, base(c.layer, "opacity"), "Ease out"))) },
  { id: "emoji-pop", name: "Emoji Pop", category: "Social Media", phase: "in", duration: 0.6, build: entrance((c) => merge(tween(c, "scale", 0, base(c.layer, "scale"), "Elastic"), tween(c, "rotation", -25 * c.k, 0, "Elastic"))) },
  { id: "notification", name: "Notification Slide", category: "Social Media", phase: "in", duration: 0.45, build: entrance((c) => merge(tween(c, "y", -20, base(c.layer, "y"), "Back"), tween(c, "opacity", 0, base(c.layer, "opacity"), "Ease out"))) },
  { id: "screen-shake", name: "Screen Shake", category: "Social Media", phase: "loop", duration: 0.6, build: (c) => ({ procedural: { ...loopSpec("x", "shake", 2.4 * c.k, 5), ...loopSpec("y", "shake", 2.4 * c.k, 5, { seed: 5 }) }, window: [c.t0, Math.min(c.t1, c.t0 + 0.6)] }) },
  { id: "meme-zoom", name: "Meme Zoom", category: "Social Media", phase: "in", duration: 1.2, build: entrance((c) => ({ keyframes: { scale: track(c.a, c.d, [[0, base(c.layer, "scale")], [1, base(c.layer, "scale") * (1 + 0.6 * c.k), "Ease in"]]) } })) },
  { id: "dramatic-pause", name: "Dramatic Pause", category: "Social Media", phase: "in", duration: 1.4, build: entrance((c) => ({ keyframes: { scale: track(c.a, c.d, [[0, base(c.layer, "scale") * 1.08], [0.15, base(c.layer, "scale"), "Ease out"], [1, base(c.layer, "scale") * 0.96, "Linear"]]), saturation: track(c.a, c.d, [[0, 100], [0.2, 40, "Ease out"], [1, 40]]) } })) },
  { id: "quick-flash", name: "Quick Flash", category: "Social Media", phase: "in", duration: 0.25, build: entrance((c) => ({ keyframes: { brightness: track(c.a, c.d, [[0, 100 + 160 * c.k], [1, 100, "Ease out"]]) } })) },
];
export const presetById = (id) => ANIMATION_PRESETS.find((p) => p.id === id);

export function presetOptions(preset, over = {}) {
  return { duration: preset.duration, delay: 0, intensity: 1, direction: preset.dir ? "Left" : "Up", ease: null, ...over };
}

/** Build the animation patch for a layer. Pure: returns { keyframes, procedural, keyframeLoop }. */
export function buildPreset(preset, layer, opts = {}) {
  const o = presetOptions(preset, opts), t0 = layer.start + o.delay, t1 = layer.start + layer.duration;
  const ctx = { layer, t0, t1, dur: Math.min(o.duration, Math.max(0.1, layer.duration - o.delay)), k: o.intensity, dir: o.direction, ease: o.ease };
  const out = preset.build(ctx) || {};
  return { keyframes: out.keyframes || Object.fromEntries(Object.entries(out).filter(([k]) => k !== "procedural" && k !== "loop" && k !== "window")), procedural: out.procedural || {}, keyframeLoop: out.loop || {}, window: out.window };
}

/** Apply a preset to a layer, replacing only the properties the preset animates. Everything stays editable. */
export function applyPreset(layer, preset, opts = {}) {
  const built = buildPreset(preset, layer, opts);
  const keyframes = { ...(layer.keyframes || {}) };
  // an entrance and an exit may share a property: merge instead of replace
  for (const [key, frames] of Object.entries(built.keyframes)) {
    const kept = (layer.keyframes?.[key] || []).filter((f) => f.preset?.phase !== preset.phase);
    keyframes[key] = [...kept, ...frames.map((f) => ({ ...f, preset: { id: preset.id, phase: preset.phase } }))].sort((a, b) => a.time - b.time);
  }
  return {
    ...layer,
    keyframes,
    procedural: { ...(layer.procedural || {}), ...built.procedural },
    keyframeLoop: { ...(layer.keyframeLoop || {}), ...built.keyframeLoop },
    appliedPresets: { ...(layer.appliedPresets || {}), [preset.phase]: { id: preset.id, ...presetOptions(preset, opts) } },
  };
}
export function removePreset(layer, phase) {
  const keyframes = {};
  for (const [key, frames] of Object.entries(layer.keyframes || {})) {
    const kept = frames.filter((f) => f.preset?.phase !== phase);
    if (kept.length) keyframes[key] = kept;
  }
  const procedural = phase === "loop" ? {} : layer.procedural;
  const { [phase]: _drop, ...rest } = layer.appliedPresets || {};
  return { ...layer, keyframes, procedural, appliedPresets: rest };
}

/** User presets: stored relative to the layer start so they can be re-applied anywhere. */
const STORE = "frame-custom-animation-presets";
export const loadCustomPresets = () => { try { return JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { return []; } };
export function saveCustomPreset(name, layer) {
  const entry = {
    id: "custom-" + Date.now().toString(36), name: name || "My animation", category: "Custom",
    keyframes: Object.fromEntries(Object.entries(layer.keyframes || {}).map(([k, fr]) => [k, fr.map((f) => ({ time: f.time - layer.start, value: f.value, ease: f.ease }))])),
    procedural: layer.procedural || {}, keyframeLoop: layer.keyframeLoop || {},
  };
  const list = [...loadCustomPresets(), entry];
  try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage full: preset stays session-only */ }
  return entry;
}
export function applyCustomPreset(layer, entry) {
  const keyframes = { ...(layer.keyframes || {}) };
  for (const [k, fr] of Object.entries(entry.keyframes)) keyframes[k] = fr.map((f) => ({ id: keyframeId(), time: layer.start + f.time, value: f.value, ease: f.ease }));
  return { ...layer, keyframes, procedural: { ...(layer.procedural || {}), ...entry.procedural }, keyframeLoop: { ...(layer.keyframeLoop || {}), ...entry.keyframeLoop } };
}

/** Sample a preset on a neutral layer for the hover preview (same engine as the editor). */
export function previewPose(preset, time, opts = {}) {
  const layer = { start: 0, duration: 2, x: 50, y: 50, scale: 100, rotation: 0, opacity: 100, keyframes: {}, procedural: {}, keyframeLoop: {} };
  const built = applyPreset(layer, preset, { ...opts });
  const out = {};
  for (const key of ["x", "y", "scale", "rotation", "opacity", "blur", "reveal", "glow", "brightness"]) {
    const v = sampleProperty(built, key, time);
    out[key] = v;
  }
  if (out.reveal === undefined || out.reveal === null) out.reveal = 100;
  return out;
}
