/* Non-destructive per-clip sound editing. A timeline clip stores `segments` (source ranges + playback rate).
   The library sound is never modified, so editing "Fah" on the timeline does not change the saved "Fah".
   All times passed to these helpers are OUTPUT seconds (what you hear/see in the editor), before the clip-level speed multiplier. */
export const MIN_RATE = 0.25, MAX_RATE = 4, EPS = 1e-4;
export const defaultSegments = (dur) => [{ a: 0, b: dur, rate: 1 }];
export const segOutDur = (s) => (s.b - s.a) / s.rate;
export const totalOut = (segs) => segs.reduce((n, s) => n + segOutDur(s), 0);
const clampRate = (r) => Math.min(MAX_RATE, Math.max(MIN_RATE, r));

export function splitAt(segs, t) {
  const out = []; let acc = 0;
  for (const s of segs) {
    const d = segOutDur(s);
    if (t > acc + EPS && t < acc + d - EPS) { const mid = s.a + (t - acc) * s.rate; out.push({ ...s, b: mid }, { ...s, a: mid }); } else out.push(s);
    acc += d;
  }
  return out;
}
export function tidy(segs) {
  const out = [];
  for (const s of segs) {
    if (s.b - s.a < EPS) continue;
    const last = out.at(-1);
    if (last && Math.abs(last.b - s.a) < EPS && Math.abs(last.rate - s.rate) < 1e-6) last.b = s.b; else out.push({ ...s });
  }
  return out;
}
/** Walk segments yielding [segment, outStart, outEnd]. */
function spans(segs) { let acc = 0; return segs.map((s) => { const d = segOutDur(s), r = [s, acc, acc + d]; acc += d; return r; }); }
const inside = (start, end, t0, t1) => start >= t0 - EPS && end <= t1 + EPS;

export function cutRange(segs, t0, t1) {
  if (!(t1 > t0)) return segs;
  const parts = spans(splitAt(splitAt(segs, t0), t1)).filter(([, a, b]) => !inside(a, b, t0, t1)).map(([s]) => s);
  return parts.length ? tidy(parts) : segs; // never delete everything
}
export function keepRange(segs, t0, t1) {
  if (!(t1 > t0)) return segs;
  const parts = spans(splitAt(splitAt(segs, t0), t1)).filter(([, a, b]) => inside(a, b, t0, t1)).map(([s]) => s);
  return parts.length ? tidy(parts) : segs;
}
/** Multiply playback rate within [t0,t1] by `factor` (selection) or everywhere when no range is given. */
export function speedRange(segs, factor, t0 = null, t1 = null) {
  if (t0 === null || t1 === null || !(t1 > t0)) return tidy(segs.map((s) => ({ ...s, rate: clampRate(s.rate * factor) })));
  return tidy(spans(splitAt(splitAt(segs, t0), t1)).map(([s, a, b]) => (inside(a, b, t0, t1) ? { ...s, rate: clampRate(s.rate * factor) } : s)));
}
export function setRateRange(segs, rate, t0 = null, t1 = null) {
  if (t0 === null || t1 === null || !(t1 > t0)) return tidy(segs.map((s) => ({ ...s, rate: clampRate(rate) })));
  return tidy(spans(splitAt(splitAt(segs, t0), t1)).map(([s, a, b]) => (inside(a, b, t0, t1) ? { ...s, rate: clampRate(rate) } : s)));
}
/** Peaks of the edited result, one per bucket across OUTPUT time. */
export function editedPeaks(samples, sr, segs, buckets = 80) {
  const total = totalOut(segs), sp = spans(segs), peaks = new Array(buckets).fill(0);
  if (!samples || !total) return peaks;
  for (let b = 0; b < buckets; b++) {
    const o0 = (b / buckets) * total, o1 = ((b + 1) / buckets) * total;
    for (const [s, a, e] of sp) {
      if (e <= o0 || a >= o1) continue;
      const lo = Math.max(o0, a), hi = Math.min(o1, e), i0 = Math.floor((s.a + (lo - a) * s.rate) * sr), i1 = Math.ceil((s.a + (hi - a) * s.rate) * sr);
      let m = 0; for (let i = Math.max(0, i0); i < Math.min(samples.length, Math.max(i1, i0 + 1)); i++) m = Math.max(m, Math.abs(samples[i]));
      peaks[b] = Math.max(peaks[b], m);
    }
  }
  return peaks;
}
export const isEdited = (segs, dur) => !(segs.length === 1 && segs[0].a < EPS && Math.abs(segs[0].b - dur) < 1e-3 && Math.abs(segs[0].rate - 1) < 1e-6);
