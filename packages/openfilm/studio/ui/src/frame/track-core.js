/* Shorts' footage tracker, plain JS (runs in a worker, and in node for its tests). Frames are grayscale Uint8Arrays
   of one proxy size. It finds corners (Shi–Tomasi, spread over a grid), follows them frame to frame (pyramidal
   Lucas–Kanade, with a forward–backward check that drops points it lost), and fits how the reference frame maps onto
   each frame: a homography (a plane seen in perspective: a wall, the ground, a screen) or a similarity (motion only:
   move, turn, scale), with RANSAC so moving people and bad points do not pull it. Every frame says how well it fits
   (inliers, reprojection error in proxy px); a hard cut is found and starts a new stretch, never tracked across. */

/* ---- images ---- */
export function blur3(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; const l = src[y * w + Math.max(0, x - 1)], r = src[y * w + Math.min(w - 1, x + 1)]; tmp[i] = (l + 2 * src[i] + r) / 4; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; const u = tmp[Math.max(0, y - 1) * w + x], d = tmp[Math.min(h - 1, y + 1) * w + x]; out[i] = (u + 2 * tmp[i] + d) / 4; }
  return out;
}
function down(src, w, h) {
  const W = w >> 1, H = h >> 1, out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 2 * y * w + 2 * x; out[y * W + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4; }
  return { data: out, w: W, h: H };
}
export function pyramid(gray, w, h, levels = 3) {
  const p = [{ data: blur3(gray, w, h), w, h }];
  for (let i = 1; i < levels; i++) { const d = down(p[i - 1].data, p[i - 1].w, p[i - 1].h); p.push({ data: blur3(d.data, d.w, d.h), w: d.w, h: d.h }); }
  for (const l of p) { l.gx = new Float32Array(l.w * l.h); l.gy = new Float32Array(l.w * l.h); for (let y = 1; y < l.h - 1; y++) for (let x = 1; x < l.w - 1; x++) { const i = y * l.w + x; l.gx[i] = (l.data[i + 1] - l.data[i - 1]) / 2; l.gy[i] = (l.data[i + l.w] - l.data[i - l.w]) / 2; } }
  return p;
}
const sample = (a, w, h, x, y) => {
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (a[i] * (1 - fx) + a[i + 1] * fx) * (1 - fy) + (a[i + w] * (1 - fx) + a[i + w + 1] * fx) * fy;
};

/* ---- corners ---- */
/** Up to `max` strong corners, at least `gap` px apart, avoiding `mask(x, y)` (true = do not use, e.g. a person). */
export function corners(pyr, max = 300, gap = 10, mask = null, region = null) {
  const { data: _d, gx, gy, w, h } = pyr[0]; const r = 3; const scores = [];
  for (let y = r + 1; y < h - r - 1; y += 2) for (let x = r + 1; x < w - r - 1; x += 2) {
    if (region && (x < region[0] || y < region[1] || x > region[2] || y > region[3])) continue;
    if (mask && mask(x, y)) continue;
    let a = 0, b = 0, c = 0;
    for (let v = -r; v <= r; v++) for (let u = -r; u <= r; u++) { const i = (y + v) * w + x + u; a += gx[i] * gx[i]; b += gx[i] * gy[i]; c += gy[i] * gy[i]; }
    const tr = a + c, det = a * c - b * b; const lmin = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    if (lmin > 1e-3) scores.push([lmin, x, y]);
  }
  scores.sort((p, q) => q[0] - p[0]);
  const cell = gap, gw = Math.ceil(w / cell), taken = new Uint8Array(gw * Math.ceil(h / cell)); const out = [];
  const floor = (scores[0]?.[0] ?? 0) * 0.01;
  for (const [s, x, y] of scores) {
    if (s < floor || out.length >= max) break;
    const cx = (x / cell) | 0, cy = (y / cell) | 0; if (taken[cy * gw + cx]) continue;
    taken[cy * gw + cx] = 1; out.push([x, y]);
  }
  return out;
}

/* ---- Lucas–Kanade ---- */
function lkPoint(P, Q, x, y, win = 7, iters = 12, workspace = null) {
  /* coarse to fine: the guess g (in this level's px) doubles going down a level */
  // One flat, reusable workspace replaces hundreds of short arrays at every pyramid level and point.
  // Float64 preserves the original interpolation precision and arithmetic order.
  const tmpl=workspace??new Float64Array((2*win+1)**2*3);
  let gx = 0, gy = 0;
  for (let L = P.length - 1; L >= 0; L--) {
    const s = 2 ** L, A = P[L], B = Q[L]; const px = x / s, py = y / s;
    let a = 0, b = 0, c = 0, cursor=0;
    for (let v = -win; v <= win; v++) for (let u = -win; u <= win; u++) {
      const ix = sample(A.gx, A.w, A.h, px + u, py + v), iy = sample(A.gy, A.w, A.h, px + u, py + v);
      a += ix * ix; b += ix * iy; c += iy * iy; tmpl[cursor++]=ix;tmpl[cursor++]=iy;tmpl[cursor++]=sample(A.data,A.w,A.h,px+u,py+v);
    }
    const det = a * c - b * b; if (det < 1e-6) return null;
    let dx = 0, dy = 0;
    for (let k = 0; k < iters; k++) {
      let ex = 0, ey = 0;
      cursor=0;
      for(let v=-win;v<=win;v++)for(let u=-win;u<=win;u++){const ix=tmpl[cursor++],iy=tmpl[cursor++],val=tmpl[cursor++];const e=sample(B.data,B.w,B.h,px+gx+dx+u,py+gy+dy+v)-val;ex+=e*ix;ey+=e*iy;}
      const sx = (c * ex - b * ey) / det, sy = (a * ey - b * ex) / det; dx -= sx; dy -= sy;
      if (sx * sx + sy * sy < 1e-4) break;
    }
    if (L > 0) { gx = 2 * (gx + dx); gy = 2 * (gy + dy); } else { gx += dx; gy += dy; }
  }
  return [x + gx, y + gy];
}
/** Each point of frame P followed into frame Q; null where it was lost (left the frame, or failed the way back). */
export function track(P, Q, pts, fbMax = 1.0, win = 7, iters = 12) {
  const w = P[0].w, h = P[0].h;
  const workspace=new Float64Array((2*win+1)**2*3);
  return pts.map(([x, y]) => {
    const f = lkPoint(P, Q, x, y, win, iters,workspace); if (!f || f[0] < 2 || f[1] < 2 || f[0] > w - 3 || f[1] > h - 3) return null;
    const b = lkPoint(Q, P, f[0], f[1], win, iters,workspace); if (!b || Math.hypot(b[0] - x, b[1] - y) > fbMax) return null;
    return f;
  });
}

/* ---- fitting ---- */
function solve(A, b) { /* Gaussian elimination with partial pivoting, n×n */
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return null; [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < n; r++) { if (r === i) continue; const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
/** Homography (row-major, h22 = 1) mapping src points onto dst points, least squares (≥ 4 pairs). */
export function homography(src, dst) {
  /* normalised for stability */
  const norm = (pts) => { const n = pts.length; let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= n; my /= n; let d = 0; for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my); const s = Math.SQRT2 / Math.max(1e-9, d / n); return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], f: (p) => [(p[0] - mx) * s, (p[1] - my) * s] }; };
  const ns = norm(src), nd = norm(dst);
  const ATA = Array.from({ length: 8 }, () => new Array(8).fill(0)), ATb = new Array(8).fill(0);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = ns.f(src[i]), [u, v] = nd.f(dst[i]);
    const rows = [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    for (const r of rows) for (let a = 0; a < 8; a++) { ATb[a] += r[a] * r[8]; for (let b = 0; b < 8; b++) ATA[a][b] += r[a] * r[b]; }
  }
  const h = solve(ATA, ATb); if (!h) return null;
  const Hn = [...h, 1];
  /* H = Td^-1 · Hn · Ts */
  const Tdi = inv3(nd.T); const H = mul3(Tdi, mul3(Hn, ns.T));
  return H.map((v) => v / H[8]);
}
/** Similarity (scale, rotation, move) mapping src onto dst, as a homography. */
export function similarity(src, dst) {
  let sx = 0, sy = 0, dx = 0, dy = 0; const n = src.length; for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n; let a = 0, b = 0, d = 0;
  for (let i = 0; i < n; i++) { const x = src[i][0] - sx, y = src[i][1] - sy, u = dst[i][0] - dx, v = dst[i][1] - dy; a += x * u + y * v; b += x * v - y * u; d += x * x + y * y; }
  if (d < 1e-9) return null; const c = a / d, s = b / d;
  return [c, -s, dx - c * sx + s * sy, s, c, dy - s * sx - c * sy, 0, 0, 1];
}
/** Six-parameter fit for surfaces without enough spatial evidence for projective foreshortening. */
export function affine(src,dst){
  if(src.length<3)return null;
  const a=Array.from({length:3},()=>[0,0,0]),bx=[0,0,0],by=[0,0,0];
  const mx=src.reduce((s,p)=>s+p[0],0)/src.length,my=src.reduce((s,p)=>s+p[1],0)/src.length;
  for(let i=0;i<src.length;i++){const row=[src[i][0]-mx,src[i][1]-my,1];for(let j=0;j<3;j++){bx[j]+=row[j]*dst[i][0];by[j]+=row[j]*dst[i][1];for(let k=0;k<3;k++)a[j][k]+=row[j]*row[k];}}
  const x=solve(a.map(r=>[...r]),bx),y=solve(a.map(r=>[...r]),by);
  return x&&y?[x[0],x[1],x[2]-x[0]*mx-x[1]*my,y[0],y[1],y[2]-y[0]*mx-y[1]*my,0,0,1]:null;
}
export function apply(H, [x, y]) { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; }
export function mul3(A, B) { const C = new Array(9).fill(0); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) C[r * 3 + c] += A[r * 3 + k] * B[k * 3 + c]; return C; }
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m; const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g; const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null; const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
/** RANSAC fit: { H, inliers (indices), err (median px over inliers) } or null. Deterministic (seeded). */
export function ransac(src, dst, model = 'homography', thresh = 2.0, iters = 300, seed = 7) {
  const n = src.length; const need = model === 'homography' ? 4 : model==='affine'?3:2; if (n < need + 2) return null;
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const fit = model === 'homography' ? homography : model==='affine'?affine:similarity;
  let best = null;
  for (let it = 0; it < iters; it++) {
    const pick = new Set(); while (pick.size < need) pick.add((rnd() * n) | 0);
    const idx = [...pick]; const H = fit(idx.map((i) => src[i]), idx.map((i) => dst[i])); if (!H) continue;
    const inl = []; for (let i = 0; i < n; i++) { const p = apply(H, src[i]); if (Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) < thresh) inl.push(i); }
    if (!best || inl.length > best.inliers.length) best = { H, inliers: inl };
    if (best.inliers.length > n * 0.9) break;
  }
  if (!best || best.inliers.length < need + 2) return null;
  const H = fit(best.inliers.map((i) => src[i]), best.inliers.map((i) => dst[i])) ?? best.H;
  const errs = best.inliers.map((i) => { const p = apply(H, src[i]); return Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]); }).sort((a, b) => a - b);
  const inliers = []; for (let i = 0; i < n; i++) { const p = apply(H, src[i]); if (Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]) < thresh) inliers.push(i); }
  return { H, inliers, err: errs[errs.length >> 1] ?? 0 };
}
const meanDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 7) s += Math.abs(a[i] - b[i]); return s / (a.length / 7); };

/** A low residual on clustered corners can still fold an entire wall through the projective horizon. */
export function validPlaneProjection(H,plane,previous=null){
  if(!H?.every(Number.isFinite)||!plane?.length)return false;
  const z=plane.map(p=>H[6]*p[0]+H[7]*p[1]+H[8]);
  if(z.some(v=>!Number.isFinite(v)||v<=.025))return false;
  const q=plane.map(p=>apply(H,p));
  const area=p=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0);
  const origin=area(plane),now=area(q);if(origin*now<=0)return false;
  let sign=0;for(let i=0;i<q.length;i++){const a=q[i],b=q[(i+1)%q.length],c=q[(i+2)%q.length],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(!Number.isFinite(cross)||Math.abs(cross)<1e-5||sign&&sign!==Math.sign(cross))return false;sign=Math.sign(cross);}
  if(previous){const old=plane.map(p=>apply(previous,p)),ratio=now/area(old);if(ratio<.35||ratio>2.85)return false;
    for(let i=0;i<q.length;i++){const j=(i+1)%q.length,a=Math.atan2(q[j][1]-q[i][1],q[j][0]-q[i][0]),b=Math.atan2(old[j][1]-old[i][1],old[j][0]-old[i][0]);if(Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))>.5)return false;}
  }
  return true;
}
export function planeFitSupported(fit,points,plane){
  if(!fit||fit.inliers.length<8)return false;
  const local=fit.inliers.map(i=>points[i]),bounds=boxOf(plane),b=boxOf(local);
  if((b[2]-b[0])/Math.max(1,bounds[2]-bounds[0])<.22||(b[3]-b[1])/Math.max(1,bounds[3]-bounds[1])<.22)return false;
  const mx=local.reduce((s,p)=>s+p[0],0)/local.length,my=local.reduce((s,p)=>s+p[1],0)/local.length;
  let xx=0,yy=0,xy=0;for(const p of local){const x=p[0]-mx,y=p[1]-my;xx+=x*x;yy+=y*y;xy+=x*y;}
  return xx*yy-xy*xy>.025*(xx+yy)**2;
}

/**
 * A tracker over a sequence: feed frames in order with push(gray, t, mask?); `result()` gives per-frame transforms from
 * the reference frame (the first of each stretch). opts: { w, h, mode: 'planar'|'camera'|'motion'|'point', region:
 * [x0,y0,x1,y1] (planar: the surface), point: [x,y] (point mode), maxPoints }.
 */
export function createTracker(opts) {
  const { w, h } = opts; const model = opts.mode === 'motion' || opts.mode === 'point' ? 'similarity' : 'homography';
  let prev = null, prevGray = null; let pts = [], refPts = [];
  const frames = [], cuts = []; let firstPoints = null;
  const seedPoints = (pyr, mask, Hcur) => {
    const region = opts.mode === 'planar' && opts.region ? (Hcur ? boxOf(opts.region.length === 8 ? quad(opts.region).map((p) => apply(Hcur, p)) : corners4(opts.region).map((p) => apply(Hcur, p))) : opts.region) : opts.mode === 'point' && opts.point ? [opts.point[0] - 24, opts.point[1] - 24, opts.point[0] + 24, opts.point[1] + 24].map((v, i) => (Hcur && i < 2 ? v : v)) : null;
    const polygon=opts.plane?.map(p=>Hcur?apply(Hcur,p):p);
    const outside=(x,y)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return !yes;};
    const exclude=polygon?(x,y)=>(mask&&mask(x,y))||outside(x,y):mask;
    const fresh = corners(pyr, opts.maxPoints ?? 260, 9, exclude, region);
    const Hi = Hcur ? inv3(Hcur) : null;
    return { cur: fresh, ref: Hi ? fresh.map((p) => apply(Hi, p)) : fresh.map((p) => [...p]) };
  };
  return {
    push(gray, t, mask = null, sharedPyramid = null) {
      const pyr = sharedPyramid??pyramid(gray, w, h, 3);
      let histogramChange=0;
      if(prevGray&&meanDiff(prevGray,gray)>(opts.cutThreshold??42)){const a=new Uint32Array(32),b=new Uint32Array(32);let n=0;for(let j=0;j<gray.length;j+=13){a[prevGray[j]>>3]++;b[gray[j]>>3]++;n++;}for(let j=0;j<32;j++)histogramChange+=Math.abs(a[j]-b[j])/Math.max(1,n);}
      // Camera shake changes aligned pixels too. Confirm a cut from the image distribution before resetting.
      if (!prev || histogramChange>.65) {
        if (prev) cuts.push(t);
        const s = seedPoints(pyr, mask, null); pts = s.cur; refPts = s.ref; if (!firstPoints) firstPoints = pts.slice(0, 160).map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
        frames.push({ t, H: [1, 0, 0, 0, 1, 0, 0, 0, 1], inliers: pts.length, points: pts.length, err: 0, ref: true });
        prev = pyr; prevGray = gray; return;
      }
      const match=(window,iters)=>{const moved=track(prev,pyr,pts,1,window,iters),src=[],dst=[],keepCur=[],keepRef=[];moved.forEach((p,i)=>{if(p&&!(mask&&mask(p[0],p[1]))){src.push(refPts[i]);dst.push(p);keepCur.push(p);keepRef.push(refPts[i]);}});return {src,keepCur,keepRef,fit:ransac(src,dst,model,opts.thresh??2,opts.ransacIters??300)};};
      let matched=match(opts.lkWindow??7,opts.lkIters??12);
      // Small windows handle easy frames cheaply. Retry only weak fits with a wider, stricter flow solve, so fast
      // shakes do not lose a pin merely to meet the ordinary per-frame budget.
      if(opts.adaptive&&(!matched.fit||matched.fit.inliers.length<8||matched.fit.inliers.length/Math.max(1,matched.src.length)<.55)){
        const recovery=match(Math.max(6,opts.lkWindow??0),Math.max(10,opts.lkIters??0));
        if(recovery.fit&&(!matched.fit||recovery.fit.inliers.length>matched.fit.inliers.length))matched=recovery;
      }
      const {src,keepCur,keepRef}=matched;let fit=matched.fit,method=model;
      const last = frames[frames.length - 1];
      if(opts.plane&&(!planeFitSupported(fit,src,opts.plane)||!validPlaneProjection(fit?.H,opts.plane,last.H))){
        // Retain measured motion using a simpler model only when its pixel residual is independently verified.
        const fallback=ransac(src,keepCur,'affine',Math.min(1.25,opts.thresh??2),100);
        fit=fallback&&fallback.inliers.length>=6&&validPlaneProjection(fallback.H,opts.plane,last.H)?fallback:null;method='affine';
      }
      if (!fit) { frames.push({ t, H: last.H, inliers: 0, points: src.length, err: Infinity, lost: true }); return; }
      else frames.push({ t, H: fit.H, inliers: fit.inliers.length, points: src.length, err: fit.err,method });
      /* keep the points that agree; top up from fresh corners when few are left (their reference place found through H) */
      const agree = fit ? new Set(fit.inliers) : new Set();
      pts = keepCur.filter((_, i) => agree.has(i)); refPts = keepRef.filter((_, i) => agree.has(i));
      if (pts.length < (opts.maxPoints ?? 260) * 0.45 && fit) { const s = seedPoints(pyr, mask, fit.H); const far = s.cur.map((p, i) => [p, s.ref[i]]).filter(([p]) => pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 6)).slice(0,Math.max(0,(opts.maxPoints??260)-pts.length)); pts.push(...far.map((x) => x[0])); refPts.push(...far.map((x) => x[1])); }
      prev = pyr; prevGray = gray;
    },
    points() { return pts.map((p) => [...p]); },
    result() {
      const good = frames.filter((f) => Number.isFinite(f.err));
      const errs = good.map((f) => f.err).sort((a, b) => a - b);
      const med = errs[errs.length >> 1] ?? Infinity; const lost = frames.filter((f) => f.lost).length / Math.max(1, frames.length);
      const inl = good.reduce((s, f) => s + f.inliers / Math.max(1, f.points), 0) / Math.max(1, good.length);
      const quality = lost > 0.1 || med > 2.5 ? 'Poor' : med > 1.2 || inl < 0.55 ? 'Fair' : 'Good';
      return { w, h, mode: opts.mode, model,plane:opts.plane, frames, cuts, quality, medianError: med, inlierShare: inl, lostShare: lost, refPoints: firstPoints ?? [] };
    },
  };
}
const corners4 = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const quad = (q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
const boxOf = (ps) => [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))];

/** The transform at time t, between the analysed frames (each entry blended, normalised): for drawing. */
export function transformAt(result, t) {
  const f = result.frames; if (!f.length) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (t <= f[0].t) return f[0].H; if (t >= f[f.length - 1].t) return f[f.length - 1].H;
  let i = 1; while (i < f.length - 1 && f[i].t < t) i++;
  const a = f[i - 1], b = f[i]; if(t===b.t)return b.H;if (b.ref||a.lost||b.lost) return a.H; /* no invented motion across a cut or unverified interval */
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  // Interpolate actual plane corners, avoiding coefficient blends with a transient horizon or scale singularity.
  if(result.plane){const A=result.plane.map(p=>apply(a.H,p)),B=result.plane.map(p=>apply(b.H,p)),H=homography(result.plane,A.map((p,i)=>p.map((v,j)=>v+(B[i][j]-v)*k)));if(H&&validPlaneProjection(H,result.plane))return H;return a.H;}
  const H = a.H.map((v, j) => v + (b.H[j] - v) * k);
  return H.map((v) => v / H[8]);
}
/** transformAt, but never a projection that has crossed the camera at the anchor (a blurred or featureless wall up close can make the solve degenerate): the last verified one holds, so the element stays on its surface instead of vanishing. */
export function transformAtAnchored(result,t,anchor){
  const H=transformAt(result,t);if(!anchor||anchorProjects(H,anchor))return H;
  const f=result.frames;let i=f.length-1;while(i>0&&f[i].t>t)i--;
  for(;i>=0;i--)if(anchorProjects(f[i].H,anchor))return f[i].H;
  return H;
}
const anchorProjects=(H,a)=>{const z=(H[6]*a[0]+H[7]*a[1]+H[8])/H[8];return Number.isFinite(z)&&z>.25;};
/** A pin belongs to its original scene. Fade a lost solve instead of teleporting it across a cut or holding a stale wall. */
export function pinVisibilityAt(result,t){
  if(!result?.frames?.length)return 1;if(result.cuts?.some(c=>t>=c))return 0;
  let index=0;while(index<result.frames.length-1&&result.frames[index+1].t<=t)index++;
  const frame=result.frames[index];if(!frame.lost)return 1;
  let good=index-1;while(good>=0&&result.frames[good].lost)good--;
  return good<0?0:Math.max(0,Math.min(1,1-(t-result.frames[good].t-.04)/.16));
}
/** Smoothing of the per-frame transforms (removes jitter, keeps the motion): a centred moving average of `radius` frames. */
export function smoothTransforms(result, radius = 2) {
  const f = result.frames; const out = f.map((x) => ({ ...x }));
  for (let i = 0; i < f.length; i++) {
    let s = new Array(9).fill(0), n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(f.length - 1, i + radius); j++) {
      if (cutBetween(f, i, j)) continue; const H = f[j].H.map((v) => v / f[j].H[8]); s = s.map((v, k) => v + H[k]); n++;
    }
    out[i].H = s.map((v) => v / n);
  }
  return { ...result, frames: out };
}
function cutBetween(f, i, j) { const [a, b] = i < j ? [i, j] : [j, i]; for (let k = a + 1; k <= b; k++) if (f[k].ref) return true; return false; }
