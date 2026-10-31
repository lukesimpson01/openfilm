/* Shorts' shared motion engine: one definition of "how a thing moves" for devices, 3D text, floating cards, the 2D
   camera and the 3D camera. A motion is a list of keys (time, position, rotation, scale…) plus a few plain switches:
   smooth start, smooth stop, hold, return to start (with its own length and smoothing), exit, loop. Its state at a
   time t is a pure function of t (SPEC §3): the same t always gives the same state, in the editor, the preview and
   the export, however the playhead got there.

   - Keys are reached exactly at their times. Between them the move keeps a continuous speed (a monotone cubic
     time-warp), so a path through five points does not stop at each one; smooth start / stop shape only the ends.
   - With arcLength on, the speed along the path is even in space: the curve is measured and walked by distance.
   - The path between positions is a centripetal Catmull–Rom curve (no loops or overshoot at uneven spacing), or
     straight lines.
   - After the last key the state holds exactly (no drift). A return, when asked, starts at its own time.
   Plain JS with no imports: the page runtimes and the editor both load it. */

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
export function quaternionFromEuler(v=[0,0,0]){const [x,y,z]=v.map(a=>a*Math.PI/360),sx=Math.sin(x),cx=Math.cos(x),sy=Math.sin(y),cy=Math.cos(y),sz=Math.sin(z),cz=Math.cos(z);return [sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz];}
export function quaternionProduct(a,b){const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
export const quaternionInverse=q=>[-q[0],-q[1],-q[2],q[3]];
export function quaternionEuler(q){const [x,y,z,w]=q;return [Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y)),Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x)))),Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))].map(v=>v*180/Math.PI);}
export function quaternionMix(a,b,k){let dot=a.reduce((s,v,i)=>s+v*b[i],0),sign=dot<0?-1:1;dot=Math.max(-1,Math.min(1,dot*sign));const angle=Math.acos(dot),s=Math.sin(angle);let q=angle<.001?a.map((v,i)=>v*(1-k)+b[i]*sign*k):a.map((v,i)=>(v*Math.sin((1-k)*angle)+b[i]*sign*Math.sin(k*angle))/s),length=Math.hypot(...q);return q.map(v=>v/length);}
export const EASE = {
  linear: (k) => k,
  smooth: (k) => k * k * (3 - 2 * k),
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
};
export function bezierEase(t,control=[.22,1,.36,1]){if(t<=0)return 0;if(t>=1)return 1;const [x1,y1,x2,y2]=control,c=(a,b,u)=>3*(1-u)*(1-u)*u*a+3*(1-u)*u*u*b+u*u*u;let low=0,high=1;for(let i=0;i<18;i++){const u=(low+high)/2;if(c(x1,x2,u)<t)low=u;else high=u;}return c(y1,y2,(low+high)/2);}
const ease = (on, k) => (on ? EASE.inOut(k) : k);

/* ---- the path through positions ---- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
/** centripetal Catmull–Rom between p1 and p2 (p0, p3 the neighbours), k in 0..1 */
function catmull(p0, p1, p2, p3, k) {
  const tj = (ti, a, b) => ti + Math.max(1e-6, Math.sqrt(len(sub(b, a))));
  const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
  const t = lerp(t1, t2, k);
  const L = (a, b, ta, tb) => a.map((v, i) => ((tb - t) / (tb - ta)) * v + ((t - ta) / (tb - ta)) * b[i]);
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
const P3 = (p) => [p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0];
/** a point on segment i (from key i to key i+1) at k */
function onPath(pts, i, k, curved) {
  const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)];
  if (!curved || pts.length < 3) return a.map((v, j) => lerp(v, b[j], k));
  const p0 = pts[i - 1] ?? a.map((v, j) => 2 * v - b[j]);
  const p3 = pts[i + 2] ?? b.map((v, j) => 2 * v - a[j]);
  return catmull(p0, a, b, p3, k);
}
/** each segment measured: [cumulative length at each key], and a table to walk a segment by distance */
function measure(pts, curved, N = 24) {
  const cum = [0]; const tables = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const tab = [0]; let prev = onPath(pts, i, 0, curved), d = 0;
    for (let s = 1; s <= N; s++) { const q = onPath(pts, i, s / N, curved); d += len(sub(q, prev)); tab.push(d); prev = q; }
    tables.push(tab); cum.push(cum[i] + d);
  }
  return { cum, tables, N };
}
/** k along segment i by distance (0..1 of its length) → curve parameter */
function byDistance(m, i, f) {
  const tab = m.tables[i]; const total = tab[tab.length - 1] || 1; const want = f * total;
  let j = 1; while (j < tab.length - 1 && tab[j] < want) j++;
  const a = tab[j - 1], b = tab[j];
  return ((j - 1) + (b > a ? (want - a) / (b - a) : 0)) / m.N;
}

/* ---- the time-warp: film time → place along the keys (a "key index", fractional) ---- */
/** Monotone cubic Hermite (Fritsch–Carlson) through (T[i], Y[i]); end slopes 0 when smoothed. */
function warp(T, Y, t, smoothStart, smoothStop) {
  const n = T.length;
  if (n < 2) return Y[0] ?? 0;
  if (t <= T[0]) return Y[0]; if (t >= T[n - 1]) return Y[n - 1];
  const d = []; for (let i = 0; i < n - 1; i++) d.push((Y[i + 1] - Y[i]) / Math.max(1e-6, T[i + 1] - T[i]));
  const m = [d[0]]; for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2); m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i]; const s = a * a + b * b; if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; } }
  if (smoothStart) m[0] = 0; if (smoothStop) m[n - 1] = 0;
  /* a smoothed end eases over its whole first/last segment, whatever its neighbour does */
  let i = 0; while (i < n - 2 && t > T[i + 1]) i++;
  const h = T[i + 1] - T[i], s = (t - T[i]) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return h00 * Y[i] + h10 * h * m[i] + h01 * Y[i + 1] + h11 * h * m[i + 1];
}

/* ---- one channel set ---- */
const CHANNELS = ['r', 's', 'o', 'fov', 'look', 'zoom', 'lid', 'extra','scale3','q'];
function mixKey(a, b, k) {
  const out = {};
  for (const c of CHANNELS) {
    if (a[c] == null && b[c] == null) continue;
    const x = a[c] ?? b[c], y = b[c] ?? a[c];
    out[c] = c==='q'?quaternionMix(x,y,k):Array.isArray(x) ? x.map((v, i) => lerp(v, y[i] ?? v, k)) : lerp(x, y, k);
  }
  return out;
}

/**
 * The state of `motion` at time `t` (seconds from the start of the clip it belongs to).
 * motion: { keys: [{ t, p:[x,y,z], r:[x,y,z]°, s, o, fov, look:[x,y,z], zoom, lid }], curved=true, arcLength=true,
 *   smoothStart=true, smoothStop=true, returnBack=false, returnAt (s; default: after the hold), returnDuration=0.8,
 *   smoothReturn=true, loop: 'none'|'loop'|'pingpong', reverse=false, faceCamera=false, faceShare=0.35,
 *   alongPath=0 (0–1: how much it turns to face where it goes), bank=0, shake: { amount, speed } }
 * Returns { p, r, s, o, …the other channels, moving, phase: 'before'|'move'|'hold'|'return'|'after' }.
 */
export function motionAt(motion, t, length = Infinity) {
  const m = motion || {};
  if(m.introMotion&&t<m.continueFrom)return motionAt(m.introMotion,t,m.introLength??length);
  if(m.enabled===false&&m.holdPose)return {...m.holdPose,moving:false,phase:'hold'};
  const keys = (m.keys || []).filter((k) => Number.isFinite(k.t)).slice().sort((a, b) => a.t - b.t);
  if (!keys.length) return { p: [0, 0, 0], r: [0, 0, 0], s: 1, o: 1, moving: false, phase: 'hold' };
  if(m.segmentEase&&t>=(m.continueFrom??0)){
    let i=keys.findLastIndex(k=>k.t<=t);i=Math.max(0,i);
    const a=keys[i],b=keys[Math.min(keys.length-1,i+1)],u=clamp((t-a.t)/Math.max(.000001,b.t-a.t));
    // Minimum-jerk easing reaches each action exactly, with zero velocity and acceleration at its boundaries.
    const q=a.hold&&t<b.t?0:a.ease==='linear'?u:Array.isArray(a.bezier)?bezierEase(u,a.bezier):u*u*u*(10+u*(-15+6*u)),out={p:P3(a.p).map((v,j)=>lerp(v,P3(b.p)[j],q)),r:[0,0,0],s:1,o:1,moving:u>0&&u<1,phase:'move'};
    for(const c of CHANNELS){const av=a[c]??b[c],bv=b[c]??a[c];if(av!=null)out[c]=c==='q'?quaternionMix(av,bv,q):Array.isArray(av)?av.map((v,j)=>v+(bv[j]-v)*q):av+(bv-av)*q;}
    if(out.q)out.r=quaternionEuler(out.q);return out;
  }
  const T0 = keys[0].t, TN = keys[keys.length - 1].t, span = Math.max(1e-6, TN - T0);
  /* loop / ping-pong / reverse remap the time inside the move */
  let tt = t;
  if (m.reverse) tt = T0 + TN - tt;
  if (m.loop === 'loop' && tt > TN) tt = T0 + ((tt - T0) % span);
  if (m.loop === 'pingpong' && tt > TN) { const c = Math.floor((tt - T0) / span); const f = ((tt - T0) % span) / span; tt = T0 + (c % 2 ? 1 - f : f) * span; }
  const pts = keys.map((k) => P3(k.p));
  const curved = m.curved !== false;
  const smoothStart = m.smoothStart !== false, smoothStop = m.smoothStop !== false;
  const meas = m.arcLength !== false && keys.length > 1 ? measure(pts, curved) : null;
  /* where along the keys at film time x: key index (fractional) */
  const along = (x) => {
    /* which segment, and how far through it, by time (keys reached exactly at their times, continuous through them);
       with arcLength, the place inside a segment is walked by distance, so the speed there is even in space. A segment
       that does not move (a turn in place, a hold) is walked by time */
    const T = keys.map((k) => k.t), Y = keys.map((_, i) => i);
    const u = warp(T, Y, x, smoothStart, smoothStop);
    const i = Math.min(keys.length - 2, Math.max(0, Math.floor(u)));
    const f = clamp(u - i);
    const segLen = meas ? meas.cum[i + 1] - meas.cum[i] : 0;
    return { i, k: meas && segLen > 1e-9 ? byDistance(meas, i, f) : f, f };
  };
  const stateAt = (x) => {
    if (keys.length === 1) return { ...mixKey(keys[0], keys[0], 0), p: pts[0] };
    const { i, k, f } = along(clamp(x, T0, TN));
    const a = keys[i], b = keys[i + 1];
    if(a.hold&&x<b.t)return {...mixKey(a,a,0),p:pts[i]};
    const st = mixKey(a, b, curved ? f : k);
    st.p = onPath(pts, i, k, curved);
    /* channels as smooth as the position: rotation and scale follow the same curve through their keys */
    if (curved && keys.length > 2) for (const c of ['r', 's', 'zoom']) {
      if (a[c] == null) continue;
      const vals = keys.map((q) => (Array.isArray(q[c]) ? P3(q[c]) : [q[c] ?? 1, 0, 0]));
      const v = onPath(vals, i, f, true);
      st[c] = Array.isArray(a[c]) ? v : v[0];
    }
    st.tangent = sub(onPath(pts, i, Math.min(1, k + 0.01), curved), onPath(pts, i, Math.max(0, k - 0.01), curved));
    return st;
  };
  let st, phase;
  const end = stateAt(TN);
  const returnDur = Math.max(0.05, m.returnDuration ?? 0.8);
  const returnAt = m.returnBack ? (Number.isFinite(m.returnAt) ? Math.max(TN, m.returnAt) : Math.max(TN, (Number.isFinite(length) ? length : TN + 1) - returnDur)) : Infinity;
  if (tt < T0) { st = stateAt(T0); phase = 'before'; }
  else if (tt <= TN) { st = stateAt(tt); phase = 'move'; }
  else if (tt < returnAt) { st = end; phase = 'hold'; }
  else {
    const k = ease(m.smoothReturn !== false, clamp((tt - returnAt) / returnDur));
    const to = m.returnTo === 'last' ? end : stateAt(T0);
    st = mixKey(end, to, k); st.p = end.p.map((v, i) => lerp(v, to.p[i], k));
    phase = k >= 1 ? 'after' : 'return';
  }
  /* turning to face where it goes, banking into curves, and facing the viewer at the end */
  st.r = st.q?quaternionEuler(st.q):P3(st.r);
  if (m.alongPath && st.tangent && phase === 'move') {
    const [dx, dy, dz] = st.tangent; const yaw = Math.atan2(dx, -dz) * 180 / Math.PI, pitch = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
    st.r = [lerp(st.r[0], pitch, m.alongPath), lerp(st.r[1], yaw, m.alongPath), st.r[2]];
  }
  if (m.bank && st.tangent && phase === 'move') st.r[2] += clamp(-st.tangent[0] * 40, -1, 1) * m.bank * 25;
  if (m.faceCamera && phase !== 'before') {
    const share = clamp(m.faceShare ?? 0.35, 0.05, 1); const from = TN - span * share;
    const k = phase === 'move' ? EASE.inOut(clamp((tt - from) / Math.max(1e-6, TN - from))) : phase === 'return' || phase === 'after' ? 1 : 1;
    if (phase === 'move' || phase === 'hold') st.r = st.r.map((v, i) => lerp(v, keys[keys.length - 1].r?.[i] ?? 0, k));
  }
  if (m.shake?.amount) {
    const a = m.shake.amount, f = m.shake.speed ?? 8; const n = (s) => Math.sin(tt * f * 1.3 + s) * 0.6 + Math.sin(tt * f * 2.9 + s * 2.1) * 0.4;
    st.p = [st.p[0] + n(1) * a, st.p[1] + n(2) * a, st.p[2]]; st.r[2] += n(3) * a * 0.15;
  }
  st.s ??= 1; st.o ??= 1;
  st.moving = phase === 'move' || phase === 'return';
  st.phase = phase;
  return st;
}

/** The moments a motion's parts begin and end, for the timeline's markers: move, hold, return. */
export function motionMarks(motion, length) {
  const ks = (motion?.keys || []).map((k) => k.t).filter(Number.isFinite).sort((a, b) => a - b);
  if (!ks.length) return [];
  const marks = [{ t: ks[0], label: 'Move' }, { t: ks[ks.length - 1], label: 'Stop' }];
  if (motion.returnBack) { const d = motion.returnDuration ?? 0.8; const at = Number.isFinite(motion.returnAt) ? motion.returnAt : length - d; marks.push({ t: at, label: 'Return' }, { t: at + d, label: 'Back' }); }
  return marks;
}

/* ---- path presets: from a start point to an end point, in the time given ---- */
export const PATH_PRESETS = ['straight', 'arcLeft', 'arcRight', 'sCurve', 'spiral', 'orbit', 'approach', 'flyby', 'pullback'];
/**
 * Keys for a path preset from `a` to `b` (positions [x,y,z]) between t0 and t1. Rotations are added by the caller.
 * Units are the caller's (stage-relative for 2D, scene units for 3D).
 */
export function pathKeys(preset, a, b, t0, t1, n = 5) {
  const A = P3(a), B = P3(b); const D = sub(B, A); const L = Math.max(1e-6, len(D));
  const side = [-D[1] / L, D[0] / L, 0]; /* perpendicular in the picture plane */
  const at = (k) => t0 + (t1 - t0) * k;
  const pt = (k, off = 0, z = 0) => [A[0] + D[0] * k + side[0] * off, A[1] + D[1] * k + side[1] * off, A[2] + D[2] * k + z];
  const bow = L * 0.35;
  switch (preset) {
    case 'arcLeft': return [0, 0.5, 1].map((k) => ({ t: at(k), p: pt(k, -bow * Math.sin(Math.PI * k)) }));
    case 'arcRight': return [0, 0.5, 1].map((k) => ({ t: at(k), p: pt(k, bow * Math.sin(Math.PI * k)) }));
    case 'sCurve': return [0, 0.25, 0.5, 0.75, 1].map((k) => ({ t: at(k), p: pt(k, bow * 0.7 * Math.sin(2 * Math.PI * k)) }));
    case 'spiral': return Array.from({ length: n + 3 }, (_, i) => { const k = i / (n + 2); const r = bow * 4 * k * (1 - k); return { t: at(k), p: pt(k, r * Math.cos(k * Math.PI * 3), r * Math.sin(k * Math.PI * 3)) }; });
    case 'orbit': return Array.from({ length: 7 }, (_, i) => { const k = i / 6; const ang = k * Math.PI * 1.5; return { t: at(k), p: [B[0] + Math.sin(ang) * L * (1 - k * 0.6), B[1] + (A[1] - B[1]) * (1 - k), B[2] + Math.cos(ang) * L * (1 - k * 0.6)] }; });
    case 'approach': return [0, 0.6, 1].map((k) => ({ t: at(k), p: pt(k, 0, (1 - k) * (1 - k) * -L) }));
    case 'flyby': return [0, 0.5, 1].map((k) => ({ t: at(k), p: pt(k, 0, Math.sin(Math.PI * k) * L * 0.5) }));
    case 'pullback': return [0, 0.5, 1].map((k) => ({ t: at(k), p: pt(k, 0, -k * L * 0.6) }));
    default: return [{ t: at(0), p: A }, { t: at(1), p: B }];
  }
}

/* ---- the 2D camera: what part of the stage shows ---- */
/**
 * The 2D camera's view at t: centre (stage px), zoom (1 = whole stage), roll (°). Its motion's keys use p:[cx, cy, 0]
 * and zoom. `bounds`: 'constrain' keeps the view inside the stage (never showing past its edge); others allow it.
 * Returns also `outside`: whether the view shows past the stage (for the editor's warning).
 */
/** @param {any} motion @param {number} t @param {number} length @param {{ w: number, h: number }} stage @param {string} [bounds] @param {{ x: number, y: number, w: number, h: number } | null} [media] */
export function cameraView(motion, t, length, stage, bounds = 'constrain', media = null) {
  const st = motionAt(motion, t, length);
  let z = Math.max(0.05, st.zoom ?? st.s ?? 1);
  let [cx, cy] = st.p; const roll = st.r?.[2] ?? 0;
  const W = stage.w, H = stage.h;
  const hw = W / (2 * z), hh = H / (2 * z);
  let outside = z < 0.999 || cx - hw < -0.5 || cx + hw > W + 0.5 || cy - hh < -0.5 || cy + hh > H + 0.5 || Math.abs(roll) > 0.01;
  if (bounds === 'constrain') {
    /* inside the footage (media: its rect on the stage, e.g. a 16:9 video letterboxed in 9:16), else the stage: the view
       never shows past it, zooming in at least enough to fill the frame with it */
    const M = media && media.w > 1 && media.h > 1 ? media : { x: 0, y: 0, w: W, h: H };
    if (z < 1) z = 1;
    const hw2 = W / (2 * z), hh2 = H / (2 * z);
    /* per axis: a view smaller than the footage stays inside the footage; a larger one stays inside the stage (as the
       normal framing does), so it never shows more empty space than without the camera, and never jumps */
    cx = hw2 <= M.w / 2 ? clamp(cx, M.x + hw2, M.x + M.w - hw2) : clamp(cx, hw2, W - hw2);
    cy = hh2 <= M.h / 2 ? clamp(cy, M.y + hh2, M.y + M.h - hh2) : clamp(cy, hh2, H - hh2);
    /* a roll shows corners past the edge unless it zooms in enough to cover them */
    if (Math.abs(roll) > 0.01) { const a = Math.abs(roll) * Math.PI / 180; const need = Math.cos(a) + Math.max(W / H, H / W) * Math.sin(a); z = Math.max(z, need); }
    outside = false;
  }
  return { cx, cy, zoom: z, roll, outside, phase: st.phase, moving: st.moving };
}
/** The CSS transform that shows the camera's view of the stage (put before each clip's own transform). */
export function cameraCss(view, stage) {
  return `translate(${stage.w / 2}px, ${stage.h / 2}px) rotate(${-view.roll}deg) scale(${view.zoom}) translate(${-view.cx}px, ${-view.cy}px)`;
}

/* ---- 2D camera presets (their keys, for a clip of length `len`) ---- */
export const CAMERA_PRESETS = {
  zoomTarget: 'Zoom to Target', zoomOut: 'Zoom Out', panLeft: 'Pan Left', panRight: 'Pan Right', panUp: 'Pan Up', panDown: 'Pan Down',
  punch: 'Punch Zoom', slowZoom: 'Slow Cinematic Zoom', between: 'Move Between Targets', reveal: 'Reveal Whole Scene', handheld: 'Shake / Handheld',
  documentary: 'Documentary Pan', whip: 'Whip Camera', orbit: 'Orbit Simulation', follow: 'Follow Object', focusText: 'Focus on Text',
};
/**
 * A preset's motion. o: { target:[x,y] stage px, targets:[[x,y]…], zoom, start, stop (s, clip-local), smoothStart,
 *   smoothStop, returnBack, returnDuration, smoothReturn, shake }. Every value stays editable on the clip afterwards.
 */
export function cameraPreset(id, stage, len, o = {}) {
  const W = stage.w, H = stage.h, C = [W / 2, H / 2, 0];
  const start = clamp(o.start ?? 0, 0, len), stop = clamp(o.stop ?? Math.min(len, start + 1.2), start + 0.05, len);
  const z = o.zoom ?? 1.75; const tg = P3(o.target ?? [W / 2, H / 2]);
  const base = { smoothStart: o.smoothStart ?? true, smoothStop: o.smoothStop ?? true, returnBack: o.returnBack ?? false, returnDuration: o.returnDuration ?? 0.8, smoothReturn: o.smoothReturn ?? true, curved: true, arcLength: true };
  const k = (t, p, zoom, roll = 0) => ({ t, p: P3(p), zoom, r: [0, 0, roll] });
  switch (id) {
    case 'zoomOut': return { ...base, keys: [k(start, tg, z), k(stop, C, 1)] };
    case 'panLeft': case 'panRight': { const zz = o.zoom ?? 1.3, dx = W / (2 * zz) - W / 2; return { ...base, keys: [k(start, [W / 2 + (id === 'panLeft' ? -dx : dx), H / 2, 0], zz), k(stop, [W / 2 + (id === 'panLeft' ? dx : -dx), H / 2, 0], zz)] }; }
    case 'panUp': case 'panDown': { const zz = o.zoom ?? 1.3, dy = H / (2 * zz) - H / 2; return { ...base, keys: [k(start, [W / 2, H / 2 + (id === 'panUp' ? -dy : dy), 0], zz), k(stop, [W / 2, H / 2 + (id === 'panUp' ? dy : -dy), 0], zz)] }; }
    case 'punch': { const hit = Math.min(stop, start + 0.18); return { ...base, smoothStart: false, keys: [k(start, C, 1), k(hit, tg, o.zoom ?? 1.6)], returnBack: o.returnBack ?? true, returnDuration: o.returnDuration ?? 0.35 }; }
    case 'slowZoom': return { ...base, keys: [k(start, C, 1), k(stop, tg, o.zoom ?? 1.15)] };
    case 'between': { const ts = (o.targets?.length ? o.targets : [[W * 0.3, H * 0.35], [W * 0.7, H * 0.65]]).map(P3); return { ...base, keys: ts.map((p, i) => k(start + (stop - start) * (i / Math.max(1, ts.length - 1)), p, z)) }; }
    case 'reveal': return { ...base, keys: [k(start, tg, z), k(stop, C, 1)] };
    case 'handheld': return { ...base, keys: [k(start, C, o.zoom ?? 1.08), k(stop, C, o.zoom ?? 1.08)], shake: { amount: o.shake ?? 10, speed: 3 } };
    case 'documentary': { const zz = o.zoom ?? 1.25; return { ...base, smoothStart: true, smoothStop: true, keys: [k(start, [W * 0.4, H * 0.45, 0], zz), k(stop, [W * 0.6, H * 0.55, 0], zz * 1.08)] }; }
    case 'whip': { const dx = W * 0.9; return { ...base, smoothStart: true, smoothStop: true, keys: [k(start, C, 1), k(start + (stop - start) * 0.5, [W / 2 + dx, H / 2, 0], 1.15), k(stop, C, 1)] }; }
    case 'orbit': return { ...base, keys: [k(start, [W * 0.45, H * 0.5, 0], 1.15, -4), k((start + stop) / 2, C, 1.2, 0), k(stop, [W * 0.55, H * 0.5, 0], 1.15, 4)] };
    case 'follow': case 'focusText': case 'zoomTarget': default: return { ...base, keys: [k(start, C, 1), k(stop, tg, z)] };
  }
}

/* ---- the 3D camera ---- */
/** The 3D camera at t: position, look-at target, field of view (°), roll (°). Keys use p (position), look, fov, r[2] roll. */
export function camera3dAt(motion, t, length) {
  const st = motionAt(motion, t, length);
  return { position: st.p, target: P3(st.look ?? [0, 0, 0]), fov: st.fov ?? 35, roll: st.r?.[2] ?? 0, phase: st.phase, moving: st.moving };
}
/**
 * A 3D camera's view of flat footage: the stage is a plane at the origin (its height is what the default camera —
 * 4.5 away, 35° — exactly fills), the camera looks from c.position at c.target with c.fov and c.roll. Returns the CSS
 * transform (put before each clip's own place) that projects the plane with real perspective, so footage, photos and
 * text move and tilt like they were filmed. bounds 'constrain' enlarges the plane just enough that the view never shows
 * past its edges.
 */
export function camera3dMatrix(c, stage, bounds = 'constrain') {
  const W = stage.w, H = stage.h, fov = (c.fov ?? 35) * Math.PI / 180;
  const s = 2 * 4.5 * Math.tan(35 * Math.PI / 360) / H, f = (H / 2) / Math.tan(fov / 2);
  const P = P3(c.position), T = P3(c.target);
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const fw = norm([T[0] - P[0], T[1] - P[1], T[2] - P[2]]);
  let r = cross(fw, Math.abs(fw[1]) > 0.999 ? [0, 0, -Math.sign(fw[1])] : [0, 1, 0]); r = norm(r);
  let u = cross(r, fw);
  const a = (c.roll ?? 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  [r, u] = [r.map((v, i) => v * ca + u[i] * sa), r.map((v, i) => -v * sa + u[i] * ca)];
  const build = (k) => ({
    m11: f * s * k * r[0], m12: -f * s * k * r[1], m14: -f * dot(P, r),
    m21: -f * s * k * u[0], m22: f * s * k * u[1], m24: f * dot(P, u),
    m41: s * k * fw[0], m42: -s * k * fw[1], m44: -dot(P, fw),
  });
  let m = build(1);
  if (bounds !== 'allow') {
    /* screen corners back onto the plane: how much larger must the plane be to hold them all */
    const A = [[m.m11, m.m12, m.m14], [m.m21, m.m22, m.m24], [m.m41, m.m42, m.m44]];
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    if (Math.abs(det) > 1e-9) {
      const inv = [
        [A[1][1] * A[2][2] - A[1][2] * A[2][1], A[0][2] * A[2][1] - A[0][1] * A[2][2], A[0][1] * A[1][2] - A[0][2] * A[1][1]],
        [A[1][2] * A[2][0] - A[1][0] * A[2][2], A[0][0] * A[2][2] - A[0][2] * A[2][0], A[0][2] * A[1][0] - A[0][0] * A[1][2]],
        [A[1][0] * A[2][1] - A[1][1] * A[2][0], A[0][1] * A[2][0] - A[0][0] * A[2][1], A[0][0] * A[1][1] - A[0][1] * A[1][0]],
      ];
      let need = 1;
      for (const [cx, cy] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]) {
        const w = inv[2][0] * cx + inv[2][1] * cy + inv[2][2]; if (!Number.isFinite(w) || Math.abs(w) < 1e-9) { need = 1; break; }
        const x = (inv[0][0] * cx + inv[0][1] * cy + inv[0][2]) / w, y = (inv[1][0] * cx + inv[1][1] * cy + inv[1][2]) / w;
        need = Math.max(need, Math.abs(x) / (W / 2), Math.abs(y) / (H / 2));
      }
      if (need > 1.0001) m = build(Math.min(need, 6));
    }
  }
  return m;
}
export function camera3dCss(c, stage, bounds = 'constrain') {
  const m = camera3dMatrix(c, stage, bounds), n = (v) => +v.toFixed(6);
  return `translate(${stage.w / 2}px, ${stage.h / 2}px) matrix3d(${[m.m11, m.m21, 0, m.m41, m.m12, m.m22, 0, m.m42, 0, 0, 1, 0, m.m14, m.m24, 0, m.m44].map(n).join(',')}) translate(${-stage.w / 2}px, ${-stage.h / 2}px)`;
}
export const CAMERA3D_PRESETS = {
  manual:'No preset · custom path',
  orbit: 'Orbit', slowOrbit: 'Slow Orbit', flyToward: 'Push In', flyThrough: 'Fly Through', zoomScreen: 'Zoom In',
  pullback: 'Pull Back', crane: 'Camera Crane', dollyLR: 'Dolly Left/Right', dollyIn: 'Dolly In/Out', topDown: 'Top-Down Reveal', tilt: 'Tilt',
  focusPull: 'Focus Pull', hero: 'Hero Orbit', sweep: 'Sweep', flyText: 'Swing Around',
};
/** A 3D camera preset's motion around `target` ([x,y,z]) at `distance`, `orbit` degrees, from start to stop. */
export function camera3dPreset(id, len, o = {}) {
  const T = P3(o.target ?? [0, 0, 0]); const d = o.distance ?? 4.5; const orbit = (o.orbit ?? 65) * Math.PI / 180;
  const start = clamp(o.start ?? 0, 0, len), stop = clamp(o.stop ?? len, start + 0.05, len);
  const base = { smoothStart: o.smoothStart ?? true, smoothStop: o.smoothStop ?? true, returnBack: o.returnBack ?? false, returnDuration: o.returnDuration ?? 0.8, smoothReturn: true, curved: true, arcLength: false };
  const fov = o.fov ?? 35;
  const around = (a, dist, h) => [T[0] + Math.sin(a) * dist, T[1] + h, T[2] + Math.cos(a) * dist];
  const k = (t, p, extra = {}) => ({ t, p, look: T, fov, ...extra });
  const n = 6; const orbitKeys = (from, to, dist, h) => Array.from({ length: n + 1 }, (_, i) => k(start + (stop - start) * (i / n), around(from + (to - from) * (i / n), dist, h)));
  switch (id) {
    case 'manual':return {...base,keys:[k(0,around(0,d,0))]};
    case 'slowOrbit': return { ...base, keys: orbitKeys(-orbit / 4, orbit / 4, d, d * 0.12) };
    case 'flyToward': return { ...base, keys: [k(start, around(0, d * 2, d * 0.3)), k(stop, around(0, d * 0.75, 0))] };
    case 'flyThrough': return { ...base, keys: [k(start, [T[0] - d, T[1] + d * 0.2, T[2] + d * 2]), k((start + stop) / 2, [T[0], T[1] + d * 0.1, T[2] + d * 0.6]), k(stop, [T[0] + d, T[1], T[2] - d * 0.4])] };
    case 'zoomScreen': return { ...base, keys: [k(start, around(orbit * 0.4, d, d * 0.25)), k(stop, around(0, d * 0.45, 0), { fov: fov * 0.9 })] };
    case 'pullback': return { ...base, keys: [k(start, around(0, d * 0.5, 0)), k(stop, around(orbit * 0.3, d * 1.6, d * 0.35))] };
    case 'crane': return { ...base, keys: [k(start, around(0, d, -d * 0.2)), k(stop, around(0, d, d * 0.8))] };
    case 'dollyLR': return { ...base, keys: [k(start, [T[0] - d * 0.6, T[1] + d * 0.1, T[2] + d]), k(stop, [T[0] + d * 0.6, T[1] + d * 0.1, T[2] + d])] };
    case 'dollyIn': return { ...base, keys: [k(start, around(0, d * 1.4, d * 0.1)), k(stop, around(0, d * 0.8, d * 0.05))] };
    case 'topDown': return { ...base, keys: [k(start, [T[0], T[1] + d * 1.6, T[2] + 0.01]), k(stop, around(0, d, d * 0.25))] };
    case 'tilt': return { ...base, keys: [k(start, around(0, d, d * 0.1), { look: [T[0], T[1] - d * 0.4, T[2]] }), k(stop, around(0, d, d * 0.1), { look: T })] };
    case 'focusPull': return { ...base, keys: [k(start, around(0, d, d * 0.1)), k(stop, around(0, d * 0.95, d * 0.1))] };
    case 'hero': return { ...base, keys: orbitKeys(-Math.PI * 0.75, Math.PI * 0.25, d, d * 0.15) };
    case 'sweep': return { ...base, keys: [k(start, around(-orbit, d * 1.2, d * 0.5)), k(stop, around(orbit * 0.2, d, d * 0.1))] };
    case 'flyText': return { ...base, keys: orbitKeys(-orbit, orbit, d, d * 0.2) };
    case 'orbit': default: return { ...base, keys: orbitKeys(-orbit / 2, orbit / 2, d, d * 0.2) };
  }
}

/* Shots: the easy way to write a 3D camera path. Each shot is a moment and a named view of the target — front, left,
   right, back, left45, right45 (three-quarter), top, low, plus close / wide (nearer / further) — combined freely
   ("close left45", "wide top"). The camera flies between them smoothly, always looking at the target. */
export const SHOT_VIEWS = ['front', 'left45', 'left', 'back', 'right', 'right45', 'top', 'low', 'close', 'wide'];
export function shotPosition(view, o = {}) {
  const T = P3(o.target ?? [0, 0, 0]); let d = o.distance ?? 4.5; const w = String(view ?? 'front').toLowerCase();
  let a = 0, h = 0.15;
  if (/left45|left 45|three.?quarter left/.test(w)) a = -Math.PI / 4; else if (/right45|right 45|three.?quarter/.test(w)) a = Math.PI / 4;
  else if (/\bleft\b/.test(w)) a = -Math.PI / 2; else if (/\bright\b/.test(w)) a = Math.PI / 2; else if (/\bback\b|behind/.test(w)) a = Math.PI;
  if (/close|tight/.test(w)) d *= 0.5; if (/wide|far/.test(w)) d *= 1.6;
  if (/\blow\b/.test(w)) h = -0.22; if (/\bhigh\b/.test(w)) h = 0.6;
  if (/\btop\b|overhead|bird/.test(w)) return [T[0] + Math.sin(a) * 0.01, T[1] + d * 1.5, T[2] + Math.cos(a) * 0.01 + 0.01];
  return [T[0] + Math.sin(a) * d, T[1] + d * h, T[2] + Math.cos(a) * d];
}
export function camera3dShots(shots, len, o = {}) {
  const T = P3(o.target ?? [0, 0, 0]); const fov = o.fov ?? 35;
  const list = (shots ?? []).filter((s) => s && Number.isFinite(Number(s.t))).map((s) => ({ ...s, t: clamp(Number(s.t), 0, len) })).sort((p, q) => p.t - q.t);
  if (!list.length) list.push({ t: 0, view: 'front' });
  const keys = list.map((s) => ({ t: s.t, p: shotPosition(s.view, { ...o, distance: s.distance ?? o.distance }), look: P3(s.target ?? T), fov: s.fov ?? fov }));
  return { smoothStart: o.smoothStart ?? true, smoothStop: o.smoothStop ?? true, returnBack: false, curved: true, arcLength: false, keys };
}
