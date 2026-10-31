/* Mask cleanup, kept apart from the page so a scan doesn't stall the editor: it runs in mask-worker.ts, one frame at
   a time and in order, so the same footage always gives the same masks. */
/* ---- mask helpers (all on w×h Float32 masks 0…1) ---- */
export function resample(src: Float32Array | Uint8Array, sw: number, sh: number, w: number, h: number, nearest = false) {
  const out = new Float32Array(w * h); if (sw === w && sh === h) { for (let i = 0; i < w * h; i++) out[i] = src[i]; return out; }
  /* where each output column and row reads from, worked out once */
  const X0 = new Int32Array(w), X1 = new Int32Array(w), AX = new Float32Array(w);
  for (let x = 0; x < w; x++) { const fx = ((x + 0.5) * sw) / w - 0.5; if (nearest) { X0[x] = Math.min(sw - 1, Math.max(0, Math.round(fx))); continue; } const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx))); X0[x] = x0; X1[x] = Math.min(sw - 1, x0 + 1); AX[x] = Math.min(1, Math.max(0, fx - x0)); }
  for (let y = 0; y < h; y++) {
    const fy = ((y + 0.5) * sh) / h - 0.5;
    if (nearest) { const r = Math.min(sh - 1, Math.max(0, Math.round(fy))) * sw; for (let x = 0; x < w; x++) out[y * w + x] = src[r + X0[x]]; continue; }
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy))), y1 = Math.min(sh - 1, y0 + 1), ay = Math.min(1, Math.max(0, fy - y0)); const r0 = y0 * sw, r1 = y1 * sw;
    for (let x = 0; x < w; x++) { const ax = AX[x], a = X0[x], b = X1[x]; out[y * w + x] = (src[r0 + a] * (1 - ax) + src[r0 + b] * ax) * (1 - ay) + (src[r1 + a] * (1 - ax) + src[r1 + b] * ax) * ay; }
  }
  return out;
}
export function boxMean(a: Float32Array, w: number, h: number, r: number) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += a[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1); out[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); } }
  return out;
}
/** fast guided filter (He & Sun 2015): the coefficients are found at half size and applied at full size, which keeps the
    edges where the picture's are at a quarter of the cost */
export function guided(p: Float32Array, I: Float32Array, w: number, h: number, r: number, eps: number) {
  if (w < 64 || h < 64) return guidedFull(p, I, w, h, r, eps);
  const sw = w >> 1, sh = h >> 1;
  const ps = resample(p, w, h, sw, sh), Is = resample(I, w, h, sw, sh), rs = Math.max(1, r >> 1);
  const mI = boxMean(Is, sw, sh, rs), mp = boxMean(ps, sw, sh, rs);
  const Ip = new Float32Array(sw * sh), II = new Float32Array(sw * sh); for (let i = 0; i < sw * sh; i++) { Ip[i] = Is[i] * ps[i]; II[i] = Is[i] * Is[i]; }
  const mIp = boxMean(Ip, sw, sh, rs), mII = boxMean(II, sw, sh, rs);
  const a = new Float32Array(sw * sh), b = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) { const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const A = resample(boxMean(a, sw, sh, rs), sw, sh, w, h), B = resample(boxMean(b, sw, sh, rs), sw, sh, w, h); const q = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) q[i] = Math.min(1, Math.max(0, A[i] * I[i] + B[i]));
  return q;
}
export function guidedFull(p: Float32Array, I: Float32Array, w: number, h: number, r: number, eps: number) {
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r);
  const Ip = new Float32Array(w * h), II = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mIp = boxMean(Ip, w, h, r), mII = boxMean(II, w, h, r);
  const a = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const cov = mIp[i] - mI[i] * mp[i], v = mII[i] - mI[i] * mI[i]; a[i] = cov / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r); const q = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) q[i] = Math.min(1, Math.max(0, ma[i] * I[i] + mb[i]));
  return q;
}
/** max/min filters (square), for closing cracks */
export function morph(m: Float32Array, w: number, h: number, r: number, max: boolean) {
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { const a = Math.max(0, x - r), b = Math.min(w - 1, x + r); let v = m[row + a]; for (let X = a + 1; X <= b; X++) { const u = m[row + X]; if (max ? u > v : u < v) v = u; } t[row + x] = v; } }
  for (let y = 0; y < h; y++) { const a = Math.max(0, y - r), b = Math.min(h - 1, y + r); for (let x = 0; x < w; x++) { let v = t[a * w + x]; for (let Y = a + 1; Y <= b; Y++) { const u = t[Y * w + x]; if (max ? u > v : u < v) v = u; } o[y * w + x] = v; } }
  return o;
}
export const dilateF = (m: Float32Array, w: number, h: number, r: number) => morph(m, w, h, r, true);
export const erodeF = (m: Float32Array, w: number, h: number, r: number) => morph(m, w, h, r, false);
/** small enclosed holes (background inside a subject, smaller than `max` px) become subject */
export function fillHoles(m: Float32Array, w: number, h: number, max: number) {
  const seen = new Uint8Array(w * h); const stack: number[] = []; const out = m;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || m[s] > 0.5) continue;
    const comp: number[] = []; let border = false; stack.push(s); seen[s] = 1;
    while (stack.length) { const i = stack.pop()!; if (comp.length <= max) comp.push(i); const x = i % w, y = (i / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !seen[i - 1] && m[i - 1] <= 0.5) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && m[i + 1] <= 0.5) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && m[i - w] <= 0.5) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && m[i + w] <= 0.5) { seen[i + w] = 1; stack.push(i + w); } }
    if (!border && comp.length <= max) for (const i of comp) out[i] = 1;
  }
  return out;
}
/** connected components of mask > .5: their boxes (px), for crops and for following a subject */
export function components(m: Float32Array, w: number, h: number, minArea: number) {
  const lab = new Int32Array(w * h).fill(-1); const boxes: { box: [number, number, number, number]; n: number; cx: number; cy: number; id: number }[] = []; const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] >= 0 || m[s] <= 0.5) continue; const id = boxes.length; let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0, sx = 0, sy = 0; stack.push(s); lab[s] = id;
    while (stack.length) { const i = stack.pop()!; const x = i % w, y = (i / w) | 0; n++; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && lab[i - 1] < 0 && m[i - 1] > 0.5) { lab[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && lab[i + 1] < 0 && m[i + 1] > 0.5) { lab[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && lab[i - w] < 0 && m[i - w] > 0.5) { lab[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && lab[i + w] < 0 && m[i + w] > 0.5) { lab[i + w] = id; stack.push(i + w); } }
    boxes.push({ box: [x0, y0, x1, y1], n, cx: sx / n, cy: sy / n, id });
  }
  return { lab, boxes: boxes.filter((b) => b.n >= minArea) };
}


export type Correction = { from: number; to: number; x: number; y: number; r: number; add: boolean };
export type CleanIn = { m: Float32Array; lum: Float32Array; mw: number; mh: number; tw: number; th: number; t: number; corrections: Correction[]; follow: { x: number; y: number; box: [number, number, number, number] } | null };
export type CleanOut = { tile: Uint8ClampedArray; small: Uint8Array; boxes: [number, number, number, number][]; follow: CleanIn['follow']; conf: number; frame: { box: [number, number, number, number]; foot: number; area: number; subjects?: { box: number[]; foot: number }[] } | null };

/** one frame's mask: corrections, closed cracks, filled holes, edges snapped to the picture, steadied where still */
export function cleanMask(input: CleanIn, state: { prev: Float32Array | null }): CleanOut {
  let { m } = input; const { lum, mw, mh, tw, th, t } = input; let follow = input.follow; let prev = state.prev;
  const o = { corrections: input.corrections };
  for (const c of o.corrections ?? []) {
    if (t < c.from || t > c.to) continue; const cx = c.x * mw, cy = c.y * mh, R = Math.max(2, c.r * mw);
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(mh, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(mw, Math.ceil(cx + R)); x++) { const d = Math.hypot(x - cx, y - cy) / R; if (d > 1) continue; const k = 1 - d * d; const j = y * mw + x; m[j] = c.add ? Math.max(m[j], k) : m[j] * (1 - k); }
  }
  /* clean: close cracks, fill small holes, snap edges to the picture, make them crisp, steady still parts */
  const rr = Math.max(1, Math.round(mw / 480));
  m = erodeF(dilateF(m, mw, mh, rr), mw, mh, rr);
  m = fillHoles(m, mw, mh, Math.round(mw * mh * 0.004));
  m = guided(m, lum, mw, mh, Math.max(2, Math.round(mw / 320)), 6e-4);
  for (let j = 0; j < mw * mh; j++) { const v = Math.min(1, Math.max(0, (m[j] - 0.3) / 0.4)); m[j] = v * v * (3 - 2 * v); }
  if (prev) for (let j = 0; j < mw * mh; j++) if (Math.abs(prev[j] - m[j]) < 0.35) m[j] = prev[j] * 0.25 + m[j] * 0.75;
  prev = m;
  /* the subjects now: follow the clicked one, remember the rest for the next frame's crops */
  const comp = components(m, mw, mh, Math.round(mw * mh * 0.0004));
  if (follow) {
    const hit = comp.boxes.find((b) => comp.lab[Math.round(follow!.y) * mw + Math.round(follow!.x)] === b.id) ?? comp.boxes.sort((a, b) => Math.hypot(a.cx - follow!.x, a.cy - follow!.y) - Math.hypot(b.cx - follow!.x, b.cy - follow!.y))[0];
    if (hit) { follow = { x: hit.cx, y: hit.cy, box: hit.box }; for (let j = 0; j < mw * mh; j++) if (comp.lab[j] >= 0 && comp.lab[j] !== hit.id) m[j] *= 0.1; }
  }
  const lastBoxes = comp.boxes.map((b) => b.box);
  let c2 = 0, n2 = 0; for (let j = 0; j < mw * mh; j += 7) { if (m[j] > 0.04 && m[j] < 0.96) n2++; c2++; } const confOne = 1 - Math.min(1, (n2 / c2) * 10);
  /* the subject's box and foot line, in tracking px (where objects are placed) */
  let frame: CleanOut['frame'] = null;
  const all = comp.boxes.filter((b) => !follow || m[Math.round(b.cy) * mw + Math.round(b.cx)] > 0.5);
  if (all.length) { const sx = tw / mw, sy = th / mh; const x0 = Math.min(...all.map((b) => b.box[0])), y0 = Math.min(...all.map((b) => b.box[1])), x1 = Math.max(...all.map((b) => b.box[2])), y1 = Math.max(...all.map((b) => b.box[3])); frame = { box: [x0 * sx, y0 * sy, x1 * sx, y1 * sy], foot: y1 * sy, area: all.reduce((s, b) => s + b.n, 0) / (mw * mh) }; }
  state.prev = prev;
  if (frame) frame.subjects = all.sort((a, b) => b.n - a.n).slice(0, 16).map(b => ({ box: [b.box[0] * tw / mw, b.box[1] * th / mh, b.box[2] * tw / mw, b.box[3] * th / mh], foot: b.box[3] * th / mh }));
  const tile = new Uint8ClampedArray(mw * mh * 4); for (let j = 0; j < mw * mh; j++) { const val = Math.round(m[j] * 255); tile[j * 4] = val; tile[j * 4 + 1] = val; tile[j * 4 + 2] = val; tile[j * 4 + 3] = 255; }
  const small = resample(m, mw, mh, tw, th); const subjectSmall = new Uint8Array(tw * th); for (let j = 0; j < tw * th; j++) subjectSmall[j] = small[j] > 0.3 ? 1 : 0;
  return { tile, small: subjectSmall, boxes: lastBoxes, follow, conf: confOne, frame };
}
