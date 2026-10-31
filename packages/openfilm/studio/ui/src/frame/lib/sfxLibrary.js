/* Named sound effects resolve to the local source-recording manifest. Legacy DSP
   recipes remain for old generated projects; named recordings never fall back to them. */
import {SOUND_RECORDINGS} from '../../../../../src/sound-recordings.mjs';
import {recordingIssue} from '../../../../../src/recording-identity.mjs';

export const SFX_SAMPLE_RATE = 44100;
export const SFX_CATEGORIES = ["Brainrot", "Whoosh & Transition", "UI & Typing", "Impact & Cinematic", "Sparkle & Pop", "Camera"];
export const SFX_LICENSE = { license: "CC0-1.0 (original Shorts synthesis)", creator: "Shorts", source: "Procedural synthesis (src/sfxLibrary.js)", attribution: "None required", verified: "Generated in-app; contains no third-party recordings" };

const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
const lerpExp = (a, b, k) => (a <= 0 || b <= 0 ? a + (b - a) * k : a * Math.pow(b / a, k));
const envAt = (t, a, d, curve) => (t < 0 ? 0 : t < a ? t / Math.max(1e-4, a) : Math.pow(Math.max(0, 1 - (t - a) / Math.max(1e-4, d)), curve));

/* -------- layer constructors -------- */
const osc = (w, f0, f1, g, a, d, o = {}) => ({ t: "osc", w, f: [f0, f1], g, a, d, curve: 2.2, at: 0, ...o });
const nz = (c, g, a, d, o = {}) => ({ t: "noise", c, g, a, d, curve: 2.2, at: 0, ...o });
const seqNotes = (w, notes, d, g = 0.5, o = {}) => notes.map(([f, at, len = d]) => osc(w, f, f, g, 0.004, len, { at, curve: 1.6, ...o }));

/* -------- recipe builders (each returns { dur, layers, post }) -------- */
const whoosh = (dur, f0, f1, q, o = {}) => ({ dur, layers: [nz("white", 1, dur * (o.peak ?? 0.45), dur * (1 - (o.peak ?? 0.45)), { bp: [f0, f1, q], curve: 1.4 }), nz("pink", 0.35, dur * 0.5, dur * 0.5, { lp: [f1 * 0.6, f0 * 0.6], curve: 1.2 })], post: { reverse: !!o.rev, fadeOut: 0.02 } });
const impact = (dur, f0, f1, noise = 0.5, o = {}) => ({ dur, layers: [osc("sine", f0, f1, 1, 0.001, dur * 0.9, { curve: 2.6 }), nz("white", noise, 0.001, dur * 0.18, { lp: [o.lp ?? 3500, 300], curve: 3 }), ...(o.sub ? [osc("sine", 38, 30, 0.8, 0.005, dur, { curve: 1.6 })] : [])], post: { reverse: !!o.rev, dist: o.dist ?? 0 } });
const click = (f, dur, o = {}) => ({ dur, layers: [nz("white", 0.8, 0.0005, dur, { bp: [f, f * 0.8, 3], curve: 4 }), osc("sine", f * 0.5, f * 0.3, 0.4, 0.0005, dur, { curve: 4 })], post: { echo: o.echo } });
const beep = (freqs, dur, w = "sine", o = {}) => ({ dur: o.total ?? dur * freqs.length + 0.1, layers: freqs.flatMap((f, i) => osc(w, f, f, o.g ?? 0.5, 0.004, dur, { at: i * (o.gap ?? dur), curve: 1.4 })), post: { echo: o.echo } });
const arpeggio = (w, notes, step, len, o = {}) => ({ dur: notes.length * step + len, layers: notes.map((f, i) => osc(w, f, o.slide ? f * o.slide : f, o.g ?? 0.5, 0.003, len, { at: i * step, curve: 1.8 })), post: { echo: o.echo } });
const riser = (dur, f0, f1, o = {}) => ({ dur, layers: [nz("white", 0.9, dur * 0.97, dur * 0.03, { bp: [f0, f1, 1.1], curve: 0.5 }), osc("saw", f0 * 0.5, f1 * 0.5, 0.35, dur * 0.97, dur * 0.03, { curve: 0.5 })], post: { reverse: !!o.down, fadeOut: 0.01 } });
const drone = (dur, base, o = {}) => ({ dur, layers: [osc("saw", base, base, 0.35, dur * 0.3, dur * 0.7, { curve: 1.2 }), osc("saw", base * 1.005, base * 1.005, 0.3, dur * 0.3, dur * 0.7, { curve: 1.2 }), osc("sine", base / 2, base / 2, 0.6, dur * 0.2, dur * 0.8, { curve: 1.2 }), nz("pink", 0.15, dur * 0.4, dur * 0.6, { lp: [900, 300], curve: 1 })], post: { lp: o.lp ?? 800 } });
const bed = (dur, c, lp, o = {}) => ({ dur, layers: [nz(c, o.g ?? 0.6, dur * 0.2, dur * 0.8, { lp: [lp, lp * (o.sweep ?? 0.7)], curve: 0.35 }), ...(o.hp ? [nz("white", 0.15, 0.1, dur, { hp: [o.hp, o.hp], curve: 0.3 })] : [])], post: { fadeOut: 0.2 } });
const steps = (n, gap, f, o = {}) => ({ dur: n * gap + 0.25, layers: Array.from({ length: n }, (_, i) => nz("brown", 1, 0.002, 0.11, { at: i * gap + (i % 2 ? 0.01 : 0), lp: [f * (1 + (i % 2) * 0.15), 120], curve: 3 })), post: {} });
const taps = (n, gap, f) => ({ dur: n * gap + 0.1, layers: Array.from({ length: n }, (_, i) => nz("white", 0.7 - (i % 3) * 0.1, 0.0005, 0.018, { at: i * gap + (i * 37 % 7) * 0.003, bp: [f + (i % 4) * 240, f, 4], curve: 4 })), post: {} });
const thumps = (times, f, d) => ({ dur: Math.max(...times) + d + 0.1, layers: times.map((at) => osc("sine", f, f * 0.45, 0.95, 0.004, d, { at, curve: 2.4 })), post: {} });
const sweepTone = (w, f0, f1, dur, o = {}) => ({ dur, layers: [osc(w, f0, f1, o.g ?? 0.55, o.a ?? 0.004, dur, { curve: o.curve ?? 1.5, vib: o.vib })], post: { echo: o.echo, bits: o.bits } });
const glitch = (dur, o = {}) => ({ dur, layers: Array.from({ length: 9 }, (_, i) => nz("white", 0.7, 0.001, 0.035, { at: i * dur / 9, bp: [300 + i * 410 % 3000, 1500, 2.5], curve: 1.5 })).concat(osc("square", 180, 60, 0.25, 0.001, dur, { curve: 1.4 })), post: { bits: o.bits ?? 5 } });
const horn = (dur, f, o = {}) => ({ dur, layers: [0, 1, 2].map((k) => osc("saw", f * (1 + k * 0.006), f * (1 + k * 0.006), 0.32, 0.01, dur, { curve: 0.55, vib: [6, 4] })).concat(osc("square", f * 2.003, f * 2.003, 0.12, 0.01, dur, { curve: 0.55 })), post: { dist: 0.4, lp: 5200 } });
const boing = (dur, f0, f1) => ({ dur, layers: [osc("sine", f0, f1, 0.8, 0.003, dur, { curve: 1.3, vib: [18, 40] })], post: {} });
const shimmer = (dur, base, o = {}) => ({ dur, layers: [1, 1.5, 2, 3].map((m, i) => osc("sine", base * m, base * m, 0.45 / (i + 1), 0.003, dur, { at: i * 0.012, curve: 2.2 })), post: { echo: o.echo ?? [0.13, 0.35, 0.3] } });
const clang = (dur, f) => ({ dur, layers: [1, 2.76, 5.4, 8.93, 11.34].map((m, i) => osc("sine", f * m, f * m * 0.995, 0.5 / (i + 1), 0.001, dur * (1 - i * 0.12), { curve: 2.4 })).concat(nz("white", 0.5, 0.0005, 0.06, { hp: [1500, 1500], curve: 3 })), post: { echo: [0.045, 0.3, 0.25] } });
const slap = (dur) => ({ dur, layers: [nz("white", 1, 0.0005, 0.07, { bp: [2400, 900, 1.5], curve: 3 }), osc("sine", 420, 120, 0.5, 0.0005, 0.09, { curve: 3 })], post: {} });
const door = (dur, f, o = {}) => ({ dur, layers: [nz("brown", 1, 0.005, dur * 0.4, { lp: [f, f * 0.4], curve: 2 }), osc("sine", f * 0.45, f * 0.3, 0.6, 0.003, dur * 0.5, { at: o.at ?? 0, curve: 2.4 }), ...(o.creak ? [osc("saw", 220, 340, 0.12, 0.05, dur * 0.7, { vib: [9, 30], curve: 0.9 })] : [])], post: {} });
const chirps = (n, dur) => ({ dur, layers: Array.from({ length: n }, (_, i) => osc("sine", 2600 + (i * 331) % 1400, 4200 - (i * 211) % 900, 0.4, 0.003, 0.09, { at: 0.1 + i * dur / (n + 1), curve: 1.5, vib: [30, 60] })).concat(nz("pink", 0.08, 0.2, dur - 0.2, { hp: [900, 900], curve: 0.4 })), post: {} });
const camera = () => ({ dur: 0.28, layers: [nz("white", 0.9, 0.0005, 0.03, { bp: [3600, 2400, 2], curve: 3 }), nz("white", 0.7, 0.0005, 0.05, { at: 0.11, bp: [2000, 1200, 2], curve: 3 }), osc("sine", 160, 90, 0.4, 0.001, 0.05, { curve: 3 })], post: {} });
const scanner = () => ({ dur: 1, layers: [osc("sine", 500, 2200, 0.35, 0.02, 0.45, { curve: 0.8 }), osc("sine", 2200, 500, 0.35, 0.02, 0.45, { at: 0.5, curve: 0.8 })], post: { echo: [0.09, 0.3, 0.3] } });
const gliss = (w, f0, f1, dur, o = {}) => sweepTone(w, f0, f1, dur, o);
const scratch = () => ({ dur: 0.8, layers: [nz("white", 0.9, 0.01, 0.7, { bp: [1800, 700, 3], curve: 0.9 }), osc("saw", 600, 110, 0.4, 0.01, 0.7, { curve: 0.8, vib: [14, 200] })], post: { dist: 0.3 } });
const paper = () => ({ dur: 0.7, layers: Array.from({ length: 14 }, (_, i) => nz("white", 0.5, 0.001, 0.03, { at: i * 0.04 + ((i * 13) % 5) * 0.004, hp: [2500, 2500], curve: 2 })), post: {} });
const glass = () => ({ dur: 0.9, layers: [1, 2.32, 4.15, 6.7].map((m, i) => osc("sine", 2100 * m, 2100 * m, 0.4 / (i + 1), 0.0005, 0.8 - i * 0.1, { curve: 3 })).concat(nz("white", 0.4, 0.0005, 0.02, { hp: [4000, 4000], curve: 2 })), post: { echo: [0.07, 0.25, 0.2] } });
const water = () => ({ dur: 1.2, layers: Array.from({ length: 7 }, (_, i) => osc("sine", 700 + i * 130, 1400 + i * 220, 0.35, 0.003, 0.09, { at: i * 0.15, curve: 2 })).concat(nz("pink", 0.15, 0.1, 1, { bp: [1200, 900, 0.8], curve: 0.5 })), post: {} });
const logo = () => ({ dur: 1.4, layers: [...[523.25, 659.25, 783.99, 1046.5].flatMap((f, i) => [osc("sine", f, f, 0.38, 0.004, 0.9, { at: i * 0.09, curve: 1.6 }), osc("tri", f * 2, f * 2, 0.08, 0.004, 0.6, { at: i * 0.09, curve: 2 })])], post: { echo: [0.17, 0.4, 0.32] } });
const textPop = () => ({ dur: 0.18, layers: [osc("sine", 420, 960, 0.8, 0.002, 0.12, { curve: 2.6 }), nz("white", 0.15, 0.001, 0.02, { hp: [3000, 3000], curve: 3 })], post: {} });
const heartbeat = () => thumps([0, 0.26, 0.95, 1.21], 62, 0.22);
const siren = () => ({ dur: 1.6, layers: [osc("saw", 600, 900, 0.3, 0.02, 1.5, { curve: 0.6, vib: [2.4, 300] })], post: { lp: 3500 } });

/* -------- catalogue -------- */
const E = (id, name, category, build, tags = "", aliases = "", seed = 1) => ({ id, name, category, group: "normal", build, seed, tags: tags.split(" ").filter(Boolean), aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean), ...SFX_LICENSE, originalRecording:true,license:'Source recording — original rights apply',creator:'Original source',source:'Local recording library',attribution:'See the source recording',verified:'Source URL, duration and hash are in the local recording manifest' });
const sparkle = () => ({ dur: 1.2, layers: Array.from({ length: 16 }, (_, i) => osc("sine", 4200 + ((i * 977) % 3800), 4200 + ((i * 977) % 3800), 0.35, 0.002, 0.2, { at: i * 0.045 + ((i * 7) % 5) * 0.01, curve: 2.6 })), post: { echo: [0.11, 0.4, 0.3] } });
const flashFx = () => ({ dur: 0.7, layers: [nz("white", 0.9, 0.001, 0.12, { hp: [2500, 800], curve: 2.6 }), osc("sine", 140, 50, 0.9, 0.001, 0.4, { curve: 2.4 })], post: {} });
const zoomFx = () => ({ dur: 0.7, layers: [...whoosh(0.7, 300, 5200, 1.2, { peak: 0.75 }).layers, osc("sine", 200, 900, 0.28, 0.02, 0.6, { curve: 0.8 })], post: {} });
const typewriterFx = () => ({ dur: 1.6, layers: [...taps(10, 0.11, 1900).layers, osc("sine", 1760, 1760, 0.4, 0.002, 0.5, { at: 1.15, curve: 2 })], post: { echo: [0.1, 0.3, 0.2] } });
const textRevealFx = () => ({ dur: 0.8, layers: [...whoosh(0.5, 1200, 4200, 2.4).layers, ...textPop().layers.map((l) => ({ ...l, at: (l.at || 0) + 0.3 }))], post: {} });
const cameraFlashFx = () => ({ dur: 0.9, layers: [...camera().layers, ...flashFx().layers.map((l) => ({ ...l, at: (l.at || 0) + 0.12, g: l.g * 0.6 }))], post: {} });
/* The 30 "normal" effects are ORIGINAL Shorts synthesis named after the common editing effect. Mixkit/Pixabay files are not bundled
   (their licences don't allow shipping the files inside an editor library) — each slot accepts your own downloaded copy instead. */
export const SFX_CATALOG = [
  E("camera-shutter", "Camera Shutter", "Camera", camera, "photo snap shutter", "photo,snapshot,camera click", 1),
  E("camera-flash", "Camera Flash", "Camera", cameraFlashFx, "photo flash shutter", "flash photo", 2),
  E("flash", "Flash", "Camera", flashFx, "flash hit transition", "flash impact", 3),
  E("razor-slash", "Razor Slash", "Whoosh & Transition", () => ({ dur: 0.34, layers: [nz("white", 1, 0.002, 0.3, { hp: [4200, 7200], curve: 1.6 }), nz("white", 0.6, 0.002, 0.2, { bp: [6000, 9000, 4], curve: 1.8 }), osc("saw", 5200, 2600, 0.12, 0.002, 0.2, { curve: 2 })], post: { echo: [0.035, 0.25, 0.2] } }), "razor slash cut blade sharp sword", "razor,blade,sword,knife,sharp swish", 4),
  E("whoosh", "Whoosh", "Whoosh & Transition", () => whoosh(0.6, 400, 2600, 1.2), "transition swipe air", "swoosh,swish,woosh", 5),
  E("swoosh", "Swoosh", "Whoosh & Transition", () => whoosh(0.5, 600, 3400, 1.8, { peak: 0.38 }), "movement swipe", "whoosh,swish", 6),
  E("swipe", "Swipe", "Whoosh & Transition", () => whoosh(0.22, 3000, 7500, 3, { peak: 0.4 }), "swipe quick sharp swish", "swish,flick", 7),
  E("zoom-in-out", "Zoom In / Out", "Whoosh & Transition", zoomFx, "zoom punch push", "zoom,push in", 8),
  E("reverse-whoosh", "Reverse Whoosh", "Whoosh & Transition", () => whoosh(0.7, 500, 3000, 1.2, { rev: true }), "reverse transition build", "reversed whoosh", 9),
  E("transition-sweep", "Transition Sweep", "Whoosh & Transition", () => whoosh(1.1, 200, 6000, 1, { peak: 0.7 }), "sweep riser transition", "sweep,air sweep", 10),
  E("glitch", "Glitch", "Whoosh & Transition", () => glitch(0.5), "digital error stutter", "glitchy,bit crush", 11),
  E("riser", "Riser", "Impact & Cinematic", () => riser(2.6, 300, 7000), "build tension rise", "build up,tension riser", 12),
  E("impact-hit", "Impact Hit", "Impact & Cinematic", () => impact(0.8, 120, 38, 0.6, { sub: true }), "hit boom punch", "impact,slam,hit", 13),
  E("cinematic-boom", "Cinematic Boom", "Impact & Cinematic", () => impact(2.4, 80, 26, 0.6, { sub: true, dist: 0.15 }), "trailer boom huge movie", "boom,trailer boom", 14),
  E("bass-drop", "Bass Drop", "Impact & Cinematic", () => ({ dur: 1.8, layers: [osc("sine", 150, 30, 1, 0.005, 1.7, { curve: 1.4 }), nz("white", 0.25, 0.001, 0.2, { lp: [2000, 200], curve: 3 })], post: { dist: 0.3 } }), "bass drop sub low", "drop,sub drop", 15),
  {...E("vine-boom", "Vine Boom", "Impact & Cinematic", () => impact(1.4, 110, 28, 0.35, { sub: true, dist: 0.5 }), "boom meme drop heavy bass", "boom,meme boom,loud boom", 16),originalRecording:true,sourceUrl:'https://www.myinstants.com/en/instant/vine-boom-sound-70972/',license:'Original recording — source rights apply'},
  E("metal-clang", "Metal Clang", "Impact & Cinematic", () => clang(1.2, 340), "metal pipe clang steel", "metal pipe,clang,pipe drop", 17),
  E("record-scratch", "Record Scratch", "Impact & Cinematic", scratch, "vinyl stop freeze dj", "scratch,vinyl stop,freeze frame", 18),
  E("click", "Click", "UI & Typing", () => click(1500, 0.07), "button press ui", "press,tap button", 19),
  E("mouse-click", "Mouse Click", "UI & Typing", () => click(2400, 0.05), "click ui desktop mouse", "mouse,desktop click", 20),
  E("ui-tap", "UI Tap", "UI & Typing", () => click(700, 0.05), "tap touch interface", "touch,tap", 21),
  E("keyboard-typing", "Keyboard Typing", "UI & Typing", () => taps(14, 0.075, 2100), "typing keys keyboard", "keys,typing", 22),
  E("typewriter", "Typewriter", "UI & Typing", typewriterFx, "typewriter keys ding", "type,typing ding", 23),
  E("text-reveal", "Text Reveal", "UI & Typing", textRevealFx, "text reveal title appear", "title pop,word reveal", 24),
  E("digital-beep", "Digital Beep", "UI & Typing", () => beep([1200], 0.14, "square", { g: 0.3 }), "beep tech", "beep,bleep", 25),
  E("notification-ding", "Notification Ding", "Sparkle & Pop", () => shimmer(0.8, 880), "alert ping message ding", "ping,alert,notification", 26),
  E("pop", "Pop", "Sparkle & Pop", textPop, "bubble pop short", "blip,tap pop", 27),
  E("bubble-pop", "Bubble Pop", "Sparkle & Pop", () => ({ dur: 0.2, layers: [osc("sine", 300, 1100, 0.9, 0.001, 0.14, { curve: 2.6 })], post: {} }), "pop bubble bloop", "bloop,cartoon pop", 28),
  E("shimmer", "Shimmer", "Sparkle & Pop", () => shimmer(1.4, 1318.5, { echo: [0.2, 0.4, 0.3] }), "shimmer glimmer magic", "glimmer,magic", 29),
  E("sparkle", "Sparkle", "Sparkle & Pop", sparkle, "sparkle twinkle magic stars", "twinkle,glitter,stars", 30),
];
/* Brainrot: the real clips are third-party recordings, so Shorts ships its OWN original sound-alike takes (synthesised) that play and
   export like any other sound. Each can be replaced with the real clip via "Use my file" — that copy stays on your device only. */
const gong = (f, dur, o = {}) => ({ dur, layers: [1, 2.01, 2.76, 4.07].map((m, i) => osc("sine", f * m, f * m * 0.998, 0.55 / (i + 1), 0.002, dur * (1 - i * 0.1), { curve: 1.7 })).concat(nz("white", 0.25, 0.001, 0.08, { lp: [1500, 300], curve: 3 })), post: { echo: o.echo ?? [0.09, 0.4, 0.3] } });
const BR = {
  "rizz-sound-effect": () => ({ dur: 1.3, layers: [osc("sine", 330, 880, 0.55, 0.05, 1.0, { curve: 0.9, vib: [6, 24] }), osc("tri", 660, 1760, 0.18, 0.1, 0.9, { curve: 1.1 }), ...[1568, 2093, 2637].map((f, i) => osc("sine", f, f, 0.3, 0.003, 0.4, { at: 0.75 + i * 0.07, curve: 2.4 }))], post: { echo: [0.12, 0.3, 0.25] } }),
  "among-us-role-reveal": () => ({ dur: 2.2, layers: [osc("saw", 98, 92, 0.4, 0.4, 1.7, { curve: 1.3 }), osc("saw", 147, 139, 0.25, 0.4, 1.7, { curve: 1.3 }), ...[392, 349, 311, 262].map((f, i) => osc("square", f, f, 0.28, 0.003, 0.22, { at: 0.5 + i * 0.28, curve: 1.8 })), ...impact(0.9, 90, 36, 0.4).layers.map((l) => ({ ...l, at: 1.55 }))], post: { lp: 3200 } }),
  "taco-bell-bong": () => gong(98, 2.6),
  "death-sound-fortnite": () => ({ dur: 0.9, layers: [osc("saw", 520, 70, 0.55, 0.003, 0.6, { curve: 1.6, vib: [10, 30] }), nz("white", 0.5, 0.001, 0.18, { lp: [5000, 300], curve: 3 }), osc("sine", 140, 40, 0.8, 0.003, 0.5, { at: 0.08, curve: 2.2 })], post: { dist: 0.25 } }),
  "heavenly-music": () => ({ dur: 4.5, layers: [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [987.77, 0.3], [1318.5, 0.5]].flatMap(([f, at]) => [osc("sine", f, f, 0.26, 0.8, 3.4, { at, curve: 1.1, vib: [4.5, 3] }), osc("tri", f * 2, f * 2, 0.07, 1.0, 3.2, { at, curve: 1.2 })]), post: { echo: [0.22, 0.45, 0.35] } }),
  "fah": () => ({ dur: 0.9, layers: [osc("saw", 349, 330, 0.5, 0.012, 0.75, { curve: 1.7, vib: [5.5, 5] }), osc("saw", 698, 660, 0.12, 0.012, 0.6, { curve: 1.8 }), nz("pink", 0.1, 0.01, 0.4, { bp: [1200, 900, 1.5], curve: 1.5 })], post: { lp: 3600 } }),
  "fah-2": () => ({ dur: 1.1, layers: [osc("saw", 440, 392, 0.5, 0.01, 0.95, { curve: 1.5, vib: [6, 7] }), osc("square", 880, 784, 0.08, 0.01, 0.8, { curve: 1.7 }), nz("pink", 0.12, 0.01, 0.5, { bp: [1600, 1100, 1.4], curve: 1.4 })], post: { lp: 4200, echo: [0.08, 0.25, 0.2] } }),
  "dexter-meme": () => arpeggio("tri", [392, 330, 392, 523, 440, 392, 330], 0.14, 0.34, { g: 0.5, echo: [0.15, 0.3, 0.2] }),
  "tuco-get-out": () => ({ dur: 0.8, layers: [osc("saw", 150, 112, 0.6, 0.01, 0.55, { curve: 1.3, vib: [14, 22] }), osc("saw", 300, 224, 0.2, 0.01, 0.5, { curve: 1.4 }), nz("white", 0.35, 0.005, 0.2, { bp: [1800, 900, 1.2], curve: 2 })], post: { dist: 0.5, lp: 3800 } }),
  "romance": () => ({ dur: 3.6, layers: [[220, 0], [277.18, 0], [329.63, 0], [415.3, 0.05]].flatMap(([f, at]) => [osc("saw", f, f, 0.2, 0.5, 2.9, { at, curve: 1.2, vib: [5, 4] }), osc("sine", f / 2, f / 2, 0.18, 0.4, 3, { at, curve: 1.2 })]), post: { lp: 1700, echo: [0.2, 0.35, 0.3] } }),
  "the-undertaker-bell": () => ({ dur: 5, layers: [...gong(82, 3.2, { echo: [0.14, 0.45, 0.35] }).layers, ...gong(82, 3.2).layers.map((l) => ({ ...l, at: 1.6, g: l.g * 0.9 })), ...impact(2.2, 60, 28, 0.5, { lp: 600 }).layers.map((l) => ({ ...l, g: l.g * 0.5 }))], post: { echo: [0.2, 0.4, 0.3] } }),
  "fart-with-reverb": () => ({ dur: 1.6, layers: [osc("saw", 68, 48, 0.55, 0.01, 0.55, { curve: 1.2, vib: [34, 20] }), nz("brown", 0.5, 0.01, 0.5, { lp: [400, 120], curve: 1.4 })], post: { lp: 900, echo: [0.17, 0.5, 0.4] } }),
  "discord-leave-noise": () => ({ dur: 0.7, layers: [osc("sine", 740, 740, 0.5, 0.003, 0.16, { curve: 2 }), osc("sine", 523, 523, 0.5, 0.003, 0.3, { at: 0.14, curve: 2 }), osc("sine", 370, 370, 0.4, 0.003, 0.34, { at: 0.28, curve: 2 })], post: {} }),
  "emotional-damage-meme": () => ({ dur: 1.9, layers: [...slap(0.2).layers, osc("saw", 330, 150, 0.4, 0.05, 1.3, { at: 0.35, curve: 1.2, vib: [6, 14] }), osc("saw", 247, 110, 0.3, 0.05, 1.3, { at: 0.35, curve: 1.2, vib: [6, 14] })], post: { lp: 2600 } }),
};
const BRAINROT = [
  ["rizz-sound-effect", "Rizz Sound Effect", "https://www.myinstants.com/en/instant/rizz-sound-effect-54189/"],
  ["among-us-role-reveal", "Among Us Role Reveal", "https://www.myinstants.com/en/instant/among-us-role-reveal-sound-34956/"],
  ["taco-bell-bong", "Taco Bell Bong", "https://www.myinstants.com/en/instant/taco-bell-bong-42481/"],
  ["death-sound-fortnite", "Death Sound (Fortnite)", "https://www.myinstants.com/en/instant/death-sound-fortnite-13941/"],
  ["heavenly-music", "Heavenly Music", "https://www.myinstants.com/en/instant/heavenly-musiic-80491/"],
  ["fah", "Fah", "https://www.myinstants.com/en/instant/fah-17296/"],
  ["fah-2", "Fah 2", "https://www.myinstants.com/en/instant/fah-2-5686/"],
  ["dexter-meme", "Dexter Meme", "https://www.myinstants.com/en/instant/dexter-meme-26140/"],
  ["tuco-get-out", "Tuco Get Out", "https://www.myinstants.com/en/instant/tuco-get-out-30566/"],
  ["romance", "Romance", "https://www.myinstants.com/en/instant/romanceeeeeeeeeeeeee-29042/"],
  ["the-undertaker-bell", "The Undertaker Bell", "https://www.myinstants.com/en/instant/the-undertaker-bell-30938/"],
  ["fart-with-reverb", "Fart With Reverb", "https://www.myinstants.com/en/instant/fart-with-reverb-17715/"],
  ["discord-leave-noise", "Discord Leave Noise", "https://www.myinstants.com/en/instant/discord-leave-noise-46083/"],
  ["emotional-damage-meme", "Emotional Damage Meme", "https://www.myinstants.com/en/instant/emotional-damage-meme-74555/"],
];
BRAINROT.forEach(([id, name, url], i) => SFX_CATALOG.push({ ...E(id, name, "Brainrot", BR[id], "brainrot meme", "", 100 + i), group: "brainrot", original: true, sourceUrl: url, license: "Original recording — source rights apply", source: "Local recording library", verified: "Source and duration are stored in the local recording manifest" }));
for(const entry of SFX_CATALOG){const pin=SOUND_RECORDINGS[entry.id];entry.recordingStatus=pin?.status??'unresolved';entry.sourceUrl=pin?.status==='verified'?pin.pageUrl:undefined;entry.sourceTitle=pin?.title;entry.dur=pin?.duration??0;entry.verified=pin?.status==='verified'?'Exact source title, page, media and SHA-256 verified':'Unresolved exact recording; preview and import disabled';}
export const SFX_COUNT = SFX_CATALOG.filter((s) => !s.needsFile).length;
export const catalogEntry = (id) => SFX_CATALOG.find((s) => s.id === id) || EXTRA.find((s) => s.id === id);
/* Registry: imported audio (user files), custom sounds and generated music all resolve through sfxById. */
const IMPORTED = new Map(), EXTRA = [];
export function registerImported(id, data) { IMPORTED.set(id, data); }
export function unregisterImported(id) { IMPORTED.delete(id); const i = EXTRA.findIndex((e) => e.id === id); if (i >= 0) EXTRA.splice(i, 1); }
export function registerEntries(list) { for (const e of list) if (!EXTRA.some((x) => x.id === e.id)) EXTRA.push(e); }
export function applyRecordingMetadata(manifest){for(const entry of [...SFX_CATALOG,...EXTRA]){const saved=manifest?.[entry.id];if(saved?.duration>0&&entry.originalRecording&&!recordingIssue(entry.id,saved,entry.name)){entry.dur=saved.duration;entry.sourceUrl=saved.sourceUrl;entry.source=saved.sourceTitle??'Local recording library';}}}
export function registerCustom(entry) { const i = EXTRA.findIndex((e) => e.id === entry.id); if (i >= 0) EXTRA[i] = entry; else EXTRA.push(entry); }
export const importedIds = () => [...IMPORTED.keys()];
export function sfxById(id) {
  const base = SFX_CATALOG.find((s) => s.id === id) || EXTRA.find((s) => s.id === id), imp = IMPORTED.get(id);
  if (!base) return imp ? { id, name: imp.name || id, category: "My sounds", samples: imp.samples, sr: imp.sr, dur: imp.dur, imported: true, tags: [], aliases: [], license: "Your file" } : undefined;
  return imp ? { ...base, samples: imp.samples, sr: imp.sr, dur: imp.dur, needsFile: false, imported: !imp.fromUrl, replaced: !imp.fromUrl } : base;
}
export const allSfx = () => [...SFX_CATALOG.map((s) => sfxById(s.id)), ...EXTRA.filter((e) => !e.music).map((e) => sfxById(e.id))];
export const isPlayable = (e) => !!e && !e.needsFile && (e.samples || e.recordingStatus!=='unresolved');
export function soundDuration(e) { return e.samples ? e.samples.length / e.sr : e.originalRecording ? e.dur??0 : e.dur ? e.dur : e.render ? e.dur : e.build ? e.build().dur : 0; }

/* -------- renderer -------- */
function svf(c, state, x, f, q, mode) {
  const cutoff = Math.min(0.49 * SFX_SAMPLE_RATE, Math.max(20, f)), g = 2 * Math.sin(Math.PI * cutoff / SFX_SAMPLE_RATE), damp = 1 / Math.max(0.2, q);
  state.low += g * state.band; const high = x - state.low - damp * state.band; state.band += g * high;
  return mode === "lp" ? state.low : mode === "hp" ? high : state.band;
}
const cache = new Map();
export function renderSfx(entry, sampleRate = SFX_SAMPLE_RATE) {
  if (entry.samples) return entry.samples;
  if (entry.originalRecording || entry.take || entry.group === 'brainrot') return null;
  if (entry.render) { const k = entry.id + "@r" + sampleRate; if (!cache.has(k)) cache.set(k, entry.render(sampleRate)); return cache.get(k); }
  if (entry.needsFile || typeof entry.build !== "function") return null;   // URL sounds have no audio until they finish loading
  const key = entry.id + "@" + sampleRate;
  if (cache.has(key)) return cache.get(key);
  const recipe = entry.build(), rand = rng(entry.seed * 2654435761), n = Math.ceil(recipe.dur * sampleRate), out = new Float32Array(n);
  for (const layer of recipe.layers) {
    const start = Math.floor((layer.at || 0) * sampleRate), len = Math.min(n - start, Math.ceil((layer.a + layer.d + 0.01) * sampleRate));
    let phase = 0, b0 = 0, b1 = 0, b2 = 0, brown = 0; const state = { low: 0, band: 0 };
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate, k = Math.min(1, t / Math.max(1e-3, layer.a + layer.d)), amp = envAt(t, layer.a, layer.d, layer.curve) * layer.g;
      let s;
      if (layer.t === "osc") {
        let f = lerpExp(layer.f[0], layer.f[1], k);
        if (layer.vib) f *= 1 + (layer.vib[1] / Math.max(1, f)) * Math.sin(2 * Math.PI * layer.vib[0] * t);
        phase += f / sampleRate; const p = phase - Math.floor(phase);
        s = layer.w === "sine" ? Math.sin(2 * Math.PI * p) : layer.w === "square" ? (p < 0.5 ? 1 : -1) * 0.6 : layer.w === "saw" ? (2 * p - 1) * 0.7 : (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) * 0.9;
      } else {
        const w = rand() * 2 - 1;
        if (layer.c === "pink") { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; s = (b0 + b1 + b2 + w * 0.1848) * 0.25; }
        else if (layer.c === "brown") { brown = (brown + 0.02 * w) / 1.02; s = brown * 3.5; }
        else s = w;
        if (layer.bp) s = svf(layer, state, s, lerpExp(layer.bp[0], layer.bp[1], k), layer.bp[2], "bp") * 1.6;
        else if (layer.lp) s = svf(layer, state, s, lerpExp(layer.lp[0], layer.lp[1], k), 0.7, "lp");
        else if (layer.hp) s = svf(layer, state, s, lerpExp(layer.hp[0], layer.hp[1], k), 0.7, "hp");
      }
      out[start + i] += s * amp;
    }
  }
  const post = recipe.post || {};
  if (post.lp) { const st = { low: 0, band: 0 }; for (let i = 0; i < n; i++) out[i] = svf(null, st, out[i], post.lp, 0.7, "lp"); }
  if (post.dist) { const d = 1 + post.dist * 8; for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * d) / Math.tanh(d); }
  if (post.bits) { const levels = Math.pow(2, post.bits); for (let i = 0; i < n; i++) out[i] = Math.round(out[i] * levels) / levels; }
  if (post.echo) { const [delay, fb, mix] = post.echo, d = Math.floor(delay * sampleRate); for (let i = d; i < n; i++) out[i] += out[i - d] * fb * (mix / 0.3); }
  if (post.reverse) out.reverse();
  let peak = 1e-6; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const fadeIn = Math.floor(0.002 * sampleRate), fadeOut = Math.floor((post.fadeOut ?? 0.008) * sampleRate);
  for (let i = 0; i < n; i++) { let g = 0.89 / peak; if (i < fadeIn) g *= i / fadeIn; if (i > n - fadeOut) g *= (n - i) / fadeOut; out[i] *= g; }
  cache.set(key, out);
  return out;
}
export const sfxDuration = (entry) => soundDuration(entry);
export function waveformPeaks(samples, buckets = 36) {
  const per = Math.max(1, Math.floor(samples.length / buckets)), peaks = [];
  for (let b = 0; b < buckets; b++) { let m = 0; for (let i = b * per; i < Math.min(samples.length, (b + 1) * per); i++) m = Math.max(m, Math.abs(samples[i])); peaks.push(m); }
  return peaks;
}

/* -------- search: aliases, tags, fuzzy prefix, suggestions -------- */
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const SYNONYMS = { boom: ["impact", "hit", "explosion", "bass"], razor: ["slash", "swish", "blade", "sharp"], swish: ["whoosh", "swoosh"], click: ["tap", "tick"], laugh: [], punch: ["hit", "impact"] };
export function searchSfx(query, { category = "All", ids = null, favorites = null, limit = 200 } = {}) {
  const q = norm(query), words = q.split(" ").filter(Boolean);
  let pool = allSfx().filter((s) => (category === "All" || s.category === category) && (!ids || ids.includes(s.id)) && (!favorites || favorites.includes(s.id)));
  if (!words.length) return pool.slice(0, limit);
  const scored = [];
  for (const s of pool) {
    const name = norm(s.name), tags = s.tags.map(norm), aliases = s.aliases.map(norm), hay = [name, ...tags, ...aliases, norm(s.category)].join(" ");
    let score = 0;
    for (const w of words) {
      const syn = SYNONYMS[w] || [];
      if (name === w) score += 12; else if (name.startsWith(w)) score += 9; else if (name.includes(w)) score += 7;
      if (aliases.some((a) => a === w || a.startsWith(w) || a.includes(w))) score += 6;
      if (tags.some((t) => t === w || t.startsWith(w))) score += 4;
      if (hay.includes(w)) score += 1;
      for (const sy of syn) if (hay.includes(sy)) score += 1.5;
      if (w.length > 3 && !hay.includes(w) && hay.split(" ").some((h) => h.length > 3 && (h.startsWith(w.slice(0, -1)) || w.startsWith(h.slice(0, -1))))) score += 1;
    }
    if (score > 0) scored.push([score, s]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map((x) => x[1]);
}
export function sfxSuggestions(query, max = 6) {
  const q = norm(query);
  if (!q) return ["whoosh", "impact", "boom", "razor", "pop", "riser"].slice(0, max);
  const set = new Set();
  for (const s of allSfx()) for (const term of [s.name, ...s.aliases, ...s.tags]) { const t = norm(term); if (t.startsWith(q) && t !== q) set.add(t); if (set.size >= max) return [...set]; }
  return [...set];
}

/* -------- WAV encoding for the license-verified asset export & tests -------- */
export function toWav(samples, sampleRate = SFX_SAMPLE_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Uint8Array(buf);
}
