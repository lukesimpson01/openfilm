import { registerEntries, SFX_LICENSE } from "./sfxLibrary.js";

export const MACLEOD_CREDIT = (title) => `${title} Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0\nhttps://creativecommons.org/licenses/by/4.0/`;

/* Original background music, composed and synthesised by Shorts's own code (chords, bass, arpeggio, drums).
   Deterministic: the same track renders identically for preview, export and tests. No third-party recordings. */
const MUSIC_SR = 32000;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const degreeNote = (root, scale, d) => root + SCALES[scale][((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
const rng = (seed) => { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };

function tone(buf, sr, start, dur, f, wave, gain, a, r, decayPow = 1) {
  const s0 = Math.floor(start * sr), n = Math.floor((dur + r) * sr);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / sr, env = Math.min(1, t / Math.max(1e-3, a)) * (t < dur ? Math.pow(Math.max(0, 1 - (t / dur) * (decayPow > 1 ? 1 : 0)), decayPow > 1 ? decayPow : 1) : Math.max(0, 1 - (t - dur) / r));
    ph += f / sr; const p = ph - Math.floor(ph);
    const v = wave === "saw" ? 2 * p - 1 : wave === "square" ? (p < 0.5 ? 0.7 : -0.7) : wave === "tri" ? (p < 0.5 ? 4 * p - 1 : 3 - 4 * p) : Math.sin(2 * Math.PI * p);
    buf[s0 + i] += v * env * gain;
  }
}
function lowpass(buf, sr, cutoff) { const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr); let y = 0; for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; } }
function kick(buf, sr, at, g) { const s0 = Math.floor(at * sr), n = Math.floor(0.28 * sr); let ph = 0; for (let i = 0; i < n && s0 + i < buf.length; i++) { const t = i / sr, f = 45 + 110 * Math.exp(-t * 28); ph += f / sr; buf[s0 + i] += Math.sin(2 * Math.PI * ph) * Math.exp(-t * 11) * g; } }
function noiseHit(buf, sr, at, dur, g, hp, rand) { const s0 = Math.floor(at * sr), n = Math.floor(dur * sr); let prev = 0; for (let i = 0; i < n && s0 + i < buf.length; i++) { const w = rand() * 2 - 1, y = w - prev * hp; prev = w; buf[s0 + i] += y * Math.exp((-i / n) * 6) * g; } }

function renderTrack(def, sr = MUSIC_SR) {
  const beat = 60 / def.bpm, bar = beat * 4, bars = def.prog.length * (def.loops || 2), total = bars * bar + 1.2, n = Math.ceil(total * sr);
  const pad = new Float32Array(n), mid = new Float32Array(n), bass = new Float32Array(n), drums = new Float32Array(n), rand = rng(def.seed || 7);
  for (let b = 0; b < bars; b++) {
    const chord = def.prog[b % def.prog.length], t0 = b * bar, tones = [0, 2, 4, def.seventh ? 6 : 7].map((o) => degreeNote(def.root, def.scale, chord + o));
    if (def.pad !== false) for (const note of tones) for (const det of [-0.004, 0, 0.004]) tone(pad, sr, t0, bar * 0.92, midi(note) * (1 + det), def.padWave || "saw", 0.07, def.padAttack ?? 0.35, 0.6);
    const rootNote = degreeNote(def.root, def.scale, chord) - 24;
    const bassPattern = def.bassPattern || [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    for (let s = 0; s < 16; s++) if (bassPattern[s]) tone(bass, sr, t0 + (s * bar) / 16, (bar / 16) * (bassPattern[s] > 1 ? 3 : 1.8), midi(rootNote + (bassPattern[s] === 2 ? 12 : 0)), def.bassWave || "sine", 0.42, 0.01, 0.12, 2);
    if (def.arp) { const step = def.arp.rate === 16 ? 16 : 8, notes = tones.concat(tones.map((x) => x + 12)); for (let s = 0; s < step; s++) { const idx = def.arp.pattern[s % def.arp.pattern.length]; tone(mid, sr, t0 + (s * bar) / step + (s % 2 && def.swing ? beat * 0.08 : 0), (bar / step) * 1.4, midi(notes[idx % notes.length] + (def.arp.octave || 0)), def.arp.wave || "tri", def.arp.gain ?? 0.16, 0.004, 0.08, 2); } }
    if (def.drums) for (let s = 0; s < 16; s++) {
      const at = t0 + (s * bar) / 16 + (s % 2 && def.swing ? beat * 0.1 : 0);
      if (def.drums.kick[s]) kick(drums, sr, at, 0.8);
      if (def.drums.snare[s]) noiseHit(drums, sr, at, 0.16, 0.45, 0.2, rand);
      if (def.drums.hat[s]) noiseHit(drums, sr, at, 0.045, 0.2, 0.98, rand);
    }
  }
  lowpass(pad, sr, def.padCutoff || 1500); if (def.midCut) lowpass(mid, sr, def.midCut);
  const out = new Float32Array(n);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) { const v = Math.tanh((pad[i] + mid[i] + bass[i] + drums[i]) * 1.15); out[i] = v; peak = Math.max(peak, Math.abs(v)); }
  const fadeOut = Math.floor(1.0 * sr);
  for (let i = 0; i < n; i++) { let g = 0.82 / peak; if (i < sr * 0.01) g *= i / (sr * 0.01); if (i > n - fadeOut) g *= (n - i) / fadeOut; out[i] *= g; }
  return out;
}
const K = (...s) => Array.from({ length: 16 }, (_, i) => (s.includes(i) ? 1 : 0));
const T = (id, name, mood, bpm, def, tags = "") => {
  const bars = def.prog.length * (def.loops || 2), dur = bars * (60 / bpm) * 4 + 1.2;
  return { id: "music-" + id, name, mood, category: "Music", bpm, music: true, dur, tags: tags.split(" ").filter(Boolean), aliases: [], seed: def.seed || 7, ...SFX_LICENSE, render: (sr = MUSIC_SR) => renderTrack({ bpm, ...def }, sr), sr: MUSIC_SR };
};
export const MUSIC_MOODS = ["Lo-fi", "Chill", "Upbeat", "Cinematic", "Dark", "Retro", "Hip-hop"];
export const MUSIC_CATALOG = [
  T("lofi-study", "Lo-fi Study", "Lo-fi", 78, { root: 57, scale: "minor", prog: [0, 5, 3, 4], seventh: true, loops: 3, swing: true, padWave: "tri", padCutoff: 900, padAttack: 0.5, arp: { rate: 8, pattern: [0, 2, 4, 2, 5, 4, 2, 1], wave: "tri", gain: 0.13 }, midCut: 1800, drums: { kick: K(0, 10), snare: K(4, 12), hat: K(0, 2, 4, 6, 8, 10, 12, 14) }, bassPattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], seed: 11 }, "lofi study focus chill beats relaxed"),
  T("rainy-window", "Rainy Window", "Lo-fi", 70, { root: 52, scale: "minor", prog: [0, 3, 5, 4], seventh: true, loops: 3, swing: true, padWave: "tri", padCutoff: 700, padAttack: 0.6, arp: { rate: 8, pattern: [0, 3, 5, 3, 2, 5, 3, 1], wave: "sine", gain: 0.16 }, drums: { kick: K(0, 9), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], seed: 12 }, "lofi rain night calm cozy"),
  T("chill-waves", "Chill Waves", "Chill", 72, { root: 55, scale: "major", prog: [0, 4, 5, 3], loops: 3, padWave: "saw", padCutoff: 1100, padAttack: 0.9, arp: { rate: 8, pattern: [0, 2, 4, 6, 4, 2], wave: "sine", gain: 0.12 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], seed: 13 }, "ambient calm relaxing peaceful pads background"),
  T("sunset-drive", "Sunset Drive", "Chill", 96, { root: 60, scale: "major", prog: [0, 5, 3, 4], loops: 3, padWave: "saw", padCutoff: 1400, arp: { rate: 8, pattern: [0, 2, 4, 2, 4, 6, 4, 2], wave: "tri", gain: 0.15 }, drums: { kick: K(0, 8), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0], seed: 14 }, "driving road warm summer travel vlog"),
  T("happy-pop", "Happy Pop", "Upbeat", 118, { root: 62, scale: "major", prog: [0, 4, 5, 3], loops: 4, padWave: "square", padCutoff: 1800, arp: { rate: 16, pattern: [0, 2, 4, 7, 4, 2, 0, 2], wave: "square", gain: 0.09, octave: 0 }, drums: { kick: K(0, 4, 8, 12), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], bassWave: "tri", seed: 15 }, "happy upbeat energetic fun positive pop vlog"),
  T("corporate-upbeat", "Corporate Upbeat", "Upbeat", 110, { root: 57, scale: "major", prog: [0, 3, 4, 0], loops: 4, padWave: "saw", padCutoff: 1600, arp: { rate: 8, pattern: [0, 4, 2, 4, 5, 4, 2, 4], wave: "tri", gain: 0.14 }, drums: { kick: K(0, 8), snare: K(4, 12), hat: K(0, 2, 4, 6, 8, 10, 12, 14) }, bassPattern: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], seed: 16 }, "corporate explainer product motivational presentation"),
  T("epic-rise", "Epic Rise", "Cinematic", 74, { root: 50, scale: "minor", prog: [0, 5, 2, 6], loops: 3, padWave: "saw", padCutoff: 2200, padAttack: 0.8, arp: { rate: 16, pattern: [0, 2, 4, 2], wave: "saw", gain: 0.06, octave: 0 }, midCut: 2600, drums: { kick: K(0, 6, 8, 14), snare: K(4, 12), hat: [] }, bassPattern: [2, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0], bassWave: "saw", seed: 17 }, "epic trailer cinematic dramatic orchestral build hero"),
  T("quiet-hope", "Quiet Hope", "Cinematic", 66, { root: 53, scale: "major", prog: [0, 5, 3, 4], loops: 3, padWave: "tri", padCutoff: 1300, padAttack: 1.1, arp: { rate: 8, pattern: [0, 2, 4, 6, 4, 2, 4, 6], wave: "sine", gain: 0.15 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seed: 18 }, "emotional story piano soft inspiring documentary"),
  T("dark-pulse", "Dark Pulse", "Dark", 100, { root: 45, scale: "minor", prog: [0, 0, 5, 4], loops: 3, padWave: "saw", padCutoff: 800, padAttack: 0.7, arp: { rate: 16, pattern: [0, 0, 2, 0, 4, 0, 2, 0], wave: "saw", gain: 0.07, octave: -12 }, midCut: 1200, drums: { kick: K(0, 6, 10), snare: K(12), hat: K(2, 6, 10, 14) }, bassPattern: [2, 0, 1, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0], bassWave: "saw", seed: 19 }, "dark horror suspense creepy tension thriller story"),
  T("mystery-tension", "Mystery Tension", "Dark", 84, { root: 48, scale: "minor", prog: [0, 6, 5, 6], loops: 3, padWave: "tri", padCutoff: 700, padAttack: 1.0, arp: { rate: 8, pattern: [0, 3, 5, 3, 6, 3, 5, 3], wave: "sine", gain: 0.12 }, drums: { kick: K(0), snare: [], hat: K(4, 12) }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seed: 20 }, "mystery true crime tension investigation story"),
  T("retro-arcade", "Retro Arcade", "Retro", 128, { root: 64, scale: "major", prog: [0, 3, 4, 0], loops: 4, pad: false, arp: { rate: 16, pattern: [0, 4, 7, 4, 0, 4, 7, 9], wave: "square", gain: 0.12 }, drums: { kick: K(0, 4, 8, 12), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], bassWave: "square", seed: 21 }, "retro 8bit chiptune game arcade gaming"),
  T("neon-nights", "Neon Nights", "Retro", 112, { root: 57, scale: "minor", prog: [0, 5, 2, 6], loops: 4, padWave: "saw", padCutoff: 2000, padAttack: 0.4, arp: { rate: 16, pattern: [0, 2, 4, 2, 5, 2, 4, 2], wave: "saw", gain: 0.07 }, midCut: 3000, drums: { kick: K(0, 4, 8, 12), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0], bassWave: "saw", seed: 22 }, "synthwave neon retro 80s night city outrun"),
  T("trap-slow", "Trap Slow", "Hip-hop", 140, { root: 55, scale: "minor", prog: [0, 0, 5, 3], loops: 4, padWave: "tri", padCutoff: 900, arp: { rate: 8, pattern: [0, 2, 4, 2], wave: "sine", gain: 0.12 }, drums: { kick: K(0, 7, 10), snare: K(8), hat: K(0, 2, 4, 6, 8, 10, 12, 13, 14, 15) }, bassPattern: [2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0], seed: 23 }, "trap hip hop beat drill swag rap"),
  T("boom-bap-flow", "Boom Bap Flow", "Hip-hop", 90, { root: 53, scale: "minor", prog: [0, 3, 0, 4], loops: 4, swing: true, padWave: "tri", padCutoff: 1000, arp: { rate: 8, pattern: [0, 4, 2, 4], wave: "tri", gain: 0.12 }, midCut: 2000, drums: { kick: K(0, 3, 8, 11), snare: K(4, 12), hat: K(0, 2, 4, 6, 8, 10, 12, 14) }, bassPattern: [1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], seed: 24 }, "boom bap hip hop old school rap beat"),
];
/* ---- Browse catalogue (your list). Kevin MacLeod tracks are bundled under CC BY 4.0 (credit required).
   Commercial releases are NOT bundled: each is a slot that plays once you import your own licensed copy. ---- */
export const MUSIC_SECTIONS = [
  { id: "funny", title: "Funny clip music", sub: "Comedy & meme backgrounds" },
  { id: "emotional", title: "Normal / emotional", sub: "Original recordings from your local library" },
  { id: "cinematic", title: "Cinematic / streamer", sub: "Original recordings from your local library" },
  { id: "originals", title: "Shorts originals", sub: "Free to use in any export" },
];
const MAC = (id, file, title, artist, dur, isrc, tags, hue) => ({ id: "mx-" + id, name: title, title, artist, section: "funny", category: "Music", music: true, tags: tags.split(" "), aliases: [], url: `/assets/media/music/${file}.mp3`, dur, cover: hue, bundled: true, sourceUrl: `https://incompetech.com/music/royalty-free/index.html?isrc=${isrc}`, ...SFX_LICENSE, license: "CC BY 4.0 — credit required", creator: "Kevin MacLeod", source: "incompetech.com", attribution: MACLEOD_CREDIT(title), verified: "Downloaded from incompetech.com (CC BY 4.0)", seed: 1 });
/* Named songs resolve to original recordings in the private local library through audio.ts. */
const TAKE = (id, section, title, artist, sourceUrl, tags, hue, bpm, def) => {
  const bars = def.prog.length * (def.loops || 2), dur = bars * (60 / bpm) * 4 + 1.2;
  if(id==='thank-you')title='GONE, GONE / THANK YOU';
  if(id==='resonance'){artist='HOME';sourceUrl='https://www.youtube.com/watch?v=8GW6sLrK40k';}
  return { id: "mx-" + id, name: title, title, artist, section, category: "Music", music: true, take: true, mood: "Original recording", bpm, dur, tags: tags.split(" "), aliases: [], cover: hue, sourceUrl, seed: def.seed || 9, license: "Original recording — artist rights apply", creator: artist, source: "Local recording library", attribution: "", verified: "Source and duration are stored in the local recording manifest", sr: MUSIC_SR };
};
export const BROWSE_CATALOG = [
  MAC("sneaky-snitch", "sneaky-snitch", "Sneaky Snitch", "Kevin MacLeod", 136.62, "USUAN1100772", "funny comedy sneaky meme spy plucky", 212),
  MAC("fluffing-a-duck", "fluffing-a-duck", "Fluffing a Duck", "Kevin MacLeod", 67.37, "USUAN1100768", "funny comedy quirky bouncy meme", 38),
  MAC("scheming-weasel", "scheming-weasel-faster", "Scheming Weasel (faster)", "Kevin MacLeod", 89.13, "USUAN1100085", "funny comedy sneaky scheming meme", 280),
  MAC("monkeys-spinning-monkeys", "monkeys-spinning-monkeys", "Monkeys Spinning Monkeys", "Kevin MacLeod", 125.07, "USUAN1400011", "funny comedy silly circus meme", 150),
  MAC("investigations", "investigations", "Investigations", "Kevin MacLeod", 93.54, "USUAN1100646", "funny comedy detective mystery meme", 330),
  MAC("run-amok", "run-amok", "Run Amok", "Kevin MacLeod", 107.1, "USUAN1400024", "funny comedy chase chaotic meme", 14),
  TAKE("space-cadet", "emotional", "Space Cadet", "Metro Boomin", "https://www.qobuz.com/au-en/album/not-all-heroes-wear-capes-metro-boomin/vnpusog2c6wac", "emotional hip hop trap dark", 250, 140, { root: 53, scale: "minor", prog: [0, 0, 5, 3], loops: 3, padWave: "tri", padCutoff: 800, arp: { rate: 8, pattern: [0, 2, 4, 2], wave: "sine", gain: 0.12 }, drums: { kick: K(0, 7, 10), snare: K(8), hat: K(0, 2, 4, 6, 8, 10, 12, 14) }, bassPattern: [2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0], seed: 31 }),
  TAKE("dragonfly", "emotional", "Dragonfly", "Dana and Alden", "https://danaandalden.bandcamp.com/track/dragonfly", "emotional calm indie soft", 170, 82, { root: 57, scale: "major", prog: [0, 4, 5, 3], loops: 3, padWave: "tri", padCutoff: 1100, padAttack: 0.8, arp: { rate: 8, pattern: [0, 2, 4, 6, 4, 2], wave: "sine", gain: 0.17 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], seed: 32 }),
  TAKE("thank-you", "emotional", "Thank You", "Tyler, The Creator", "https://www.qobuz.com/au-en/album/igor-tyler-the-creator/qtz65tw2of0ha", "emotional hip hop soulful", 320, 86, { root: 55, scale: "major", prog: [0, 5, 3, 4], seventh: true, loops: 3, swing: true, padWave: "saw", padCutoff: 1000, arp: { rate: 8, pattern: [0, 3, 5, 3], wave: "tri", gain: 0.13 }, drums: { kick: K(0, 9), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0], seed: 33 }),
  TAKE("freedom", "emotional", "Freedom", "Pharrell Williams", "https://www.qobuz.com/us-en/album/freedom-pharrell-williams/0886445349689", "emotional uplifting joyful", 45, 118, { root: 60, scale: "major", prog: [0, 3, 4, 0], loops: 4, padWave: "square", padCutoff: 1700, arp: { rate: 16, pattern: [0, 2, 4, 7, 4, 2], wave: "tri", gain: 0.1 }, drums: { kick: K(0, 4, 8, 12), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], bassWave: "tri", seed: 34 }),
  TAKE("a-good-man-with-a-broken-heart", "emotional", "A Good Man With a Broken Heart", "Lovibe", "https://www.qobuz.com/ca-en/album/a-good-man-with-a-broken-heart-lovibe/sc9gnw0etrnob", "emotional sad piano slow", 200, 66, { root: 50, scale: "minor", prog: [0, 5, 2, 6], loops: 3, padWave: "tri", padCutoff: 900, padAttack: 1.0, arp: { rate: 8, pattern: [0, 2, 4, 2, 5, 4, 2, 1], wave: "sine", gain: 0.17 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seed: 35 }),
  TAKE("echo-sax-end", "emotional", "Echo Sax End", "Caleb Arredondo", "https://www.qobuz.com/nz-en/album/echo-sax-end-caleb-arredondo/avfgdoyfqf96b", "emotional saxophone jazz smooth", 25, 72, { root: 52, scale: "minor", prog: [0, 3, 5, 4], seventh: true, loops: 3, swing: true, padWave: "saw", padCutoff: 900, padAttack: 0.6, arp: { rate: 8, pattern: [0, 4, 2, 5, 3, 4, 2, 1], wave: "saw", gain: 0.08 }, midCut: 1400, bassPattern: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0], seed: 36 }),
  TAKE("runaway", "emotional", "Runaway", "Kanye West", "https://www.qobuz.com/au-en/album/runaway-kanye-west-pusha-t/0060252753826", "emotional hip hop piano", 350, 88, { root: 54, scale: "minor", prog: [0, 0, 3, 4], loops: 4, padWave: "tri", padCutoff: 1000, arp: { rate: 8, pattern: [0, 0, 4, 0, 4, 0, 4, 0], wave: "sine", gain: 0.2 }, drums: { kick: K(0, 8), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], seed: 37 }),
  TAKE("mist-cinematic-intro", "cinematic", "MIST CINEMATIC INTRO", "AMBNT", "https://www.youtube.com/watch?v=to1Chw2vvq0", "cinematic streamer intro ambient", 225, 60, { root: 45, scale: "minor", prog: [0, 5, 6, 4], loops: 3, padWave: "saw", padCutoff: 1400, padAttack: 1.4, arp: { rate: 16, pattern: [0, 2, 4, 2], wave: "saw", gain: 0.05 }, midCut: 2200, drums: { kick: K(0), snare: [], hat: [] }, bassPattern: [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bassWave: "saw", seed: 38 }),
  TAKE("memory-reboot", "cinematic", "Memory Reboot", "Voj, Narvent", "https://www.qobuz.com/au-en/album/memory-reboot-voj-narvent/b523urpwfmfmb", "cinematic phonk streamer dark", 290, 130, { root: 49, scale: "minor", prog: [0, 0, 5, 4], loops: 4, padWave: "saw", padCutoff: 900, arp: { rate: 16, pattern: [0, 0, 2, 0, 4, 0, 2, 0], wave: "square", gain: 0.07, octave: -12 }, drums: { kick: K(0, 6, 10), snare: K(4, 12), hat: K(2, 6, 10, 14) }, bassPattern: [2, 0, 1, 0, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0], bassWave: "saw", seed: 39 }),
  TAKE("resonance", "cinematic", "Resonance", "Eyewitness Records", "https://eyewitnessrecords.bandcamp.com/track/resonance", "cinematic ambient dark", 190, 70, { root: 48, scale: "minor", prog: [0, 6, 5, 6], loops: 3, padWave: "tri", padCutoff: 800, padAttack: 1.2, arp: { rate: 8, pattern: [0, 3, 5, 3, 6, 3], wave: "sine", gain: 0.12 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seed: 40 }),
  TAKE("mice-on-venus", "cinematic", "Mice on Venus", "C418", "https://c418.bandcamp.com/track/mice-on-venus", "cinematic calm ambient game", 130, 78, { root: 55, scale: "major", prog: [0, 3, 0, 4], loops: 3, padWave: "tri", padCutoff: 1000, padAttack: 0.7, arp: { rate: 8, pattern: [0, 2, 4, 6, 4, 2, 0, 2], wave: "sine", gain: 0.18 }, bassPattern: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], seed: 41 }),
  TAKE("can-you-feel-my-heart", "cinematic", "Can You Feel My Heart", "Bring Me the Horizon", "https://www.qobuz.com/us-en/album/can-you-feel-my-heart-bring-me-the-horizon/0886444115100", "cinematic rock intense", 5, 128, { root: 52, scale: "minor", prog: [0, 5, 2, 6], loops: 4, padWave: "saw", padCutoff: 2400, arp: { rate: 16, pattern: [0, 2, 4, 7, 4, 2], wave: "saw", gain: 0.07 }, midCut: 3000, drums: { kick: K(0, 4, 8, 12), snare: K(4, 12), hat: K(0, 2, 4, 6, 8, 10, 12, 14) }, bassPattern: [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0], bassWave: "saw", seed: 42 }),
];
for (const m of MUSIC_CATALOG) { m.title = m.name; m.artist = "Shorts"; m.section = "originals"; m.cover = (m.name.length * 37) % 360; }
for(const entry of BROWSE_CATALOG)entry.originalRecording=true;
export const ALL_MUSIC = [...BROWSE_CATALOG];
registerEntries(BROWSE_CATALOG);
registerEntries(MUSIC_CATALOG);
export const musicById = (id) => ALL_MUSIC.find((m) => m.id === id);
export function searchMusic(query, section = "All") {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return ALL_MUSIC.filter((m) => (section === "All" || m.section === section) && words.every((w) => (m.name + " " + (m.artist || "") + " " + (m.mood || "") + " " + m.tags.join(" ") + " " + (m.bpm || "")).toLowerCase().includes(w)));
}
