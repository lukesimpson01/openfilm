/* Shorts transitions renderer: render(A, B, p, params) → the frame, the same for the panel's previews, the editor's
   preview and export (a transition page draws with it at the host's t).
   - Mirror-repeat sampling: a shrunk, moved or turned picture never shows black edges.
   - Linear light: blends and flashes happen in linear colour (no muddy dip in a dissolve).
   - Velocity motion blur: the frame is averaged over a short shutter around p; the spread of the taps follows how far
     each pixel moves in one output frame, so linear moves streak, zooms blur radially and spins blur along the arc,
     strongest at peak speed, nothing at rest. The shutter closes at p = 0 and p = 1, so the ends are exactly A and B.
   - Deterministic: noise is hashed from the instance's seed. */
import { transitionById } from './transitions-catalog.js';

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = vec2(aPos.x * .5 + .5, .5 - aPos.y * .5); gl_Position = vec4(aPos, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uA, uB;
uniform int uEffect, uEase, uDir, uStrips, uTaps;
uniform float uP, uIntensity, uMotionBlur, uFeather, uHold, uAngle, uGrain, uSeed, uAspect, uAspA, uAspB, uDp;
uniform float uAmount, uBalance, uSplit, uMatch, uShadow, uGlow, uScale, uIn, uOut;
uniform vec3 uColor, uColor2; uniform vec2 uCenter, uRes; uniform bool uLinear, uMotion;
/* the ripple: uRip (style, waves, thickness, refraction), uRip2 (build-up, dissipation, reach, impact), uRip3 (geometry,
   interference, crest softness, highlight); uRipM takes a source point into the space the wave is measured in */
uniform vec4 uRip, uRip2, uRip3; uniform mat3 uRipM; uniform vec2 uRipO, uRipVP; uniform sampler2D uMatte; uniform vec4 uMatteRect; uniform bool uMatteOn;
in vec2 vUv; out vec4 outColor;
const float PI = 3.14159265359;

vec3 lin(vec3 c){ return uLinear ? pow(max(c, 0.), vec3(2.2)) : c; }
vec3 srgb(vec3 c){ return uLinear ? pow(max(c, 0.), vec3(1. / 2.2)) : c; }
/* stage uv (0..1, y down) → the picture's uv, the picture filling the stage (cover) */
vec2 cover(vec2 uv, float tex){ float r = uAspect / tex; vec2 s = r > 1. ? vec2(1., 1. / r) : vec2(r, 1.); return (uv - .5) * s + .5; }
vec3 SA(vec2 uv){ return lin(texture(uA, cover(uv, uAspA)).rgb); }
vec3 SB(vec2 uv){ return lin(texture(uB, cover(uv, uAspB)).rgb); }

float hash(float n){ return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.13) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
float noise1(float x){ float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(i), hash(i + 1.), f) * 2. - 1.; }

float bez(float x, vec4 b){
  float t = x;
  float cx = 3. * b.x, bx = 3. * (b.z - b.x) - cx, ax = 1. - cx - bx;
  for (int i = 0; i < 8; i++) { float xt = ((ax * t + bx) * t + cx) * t - x; float d = (3. * ax * t + 2. * bx) * t + cx; if (abs(d) < 1e-6) break; t = clamp(t - xt / d, 0., 1.); }
  float cy = 3. * b.y, by = 3. * (b.w - b.y) - cy, ay = 1. - cy - by;
  return ((ay * t + by) * t + cy) * t;
}
float ease(float p){
  p = clamp(p, 0., 1.);
  if (uEase == 0) return bez(p, vec4(.75, 0., .25, 1.));
  if (uEase == 1) return bez(p, vec4(.42, 0., .58, 1.));
  if (uEase == 2) return p * p * p;
  if (uEase == 3) return 1. - pow(1. - p, 3.);
  if (uEase == 4) return p;
  if (uEase == 5) return bez(p, vec4(.9, 0., .1, 1.));
  float c1 = 1.70158, c3 = c1 + 1.; return 1. + c3 * pow(p - 1., 3.) + c1 * pow(p - 1., 2.);
}
/* where the content goes: left, right, up, down (y down) */
vec2 dirv(){ return uDir == 0 ? vec2(-1, 0) : uDir == 1 ? vec2(1, 0) : uDir == 2 ? vec2(0, -1) : vec2(0, 1); }
vec2 zoomAt(vec2 uv, float s){ return uCenter + (uv - uCenter) / s; }
vec2 rotAt(vec2 uv, float a, float s){ vec2 q = (uv - uCenter) * vec2(uAspect, 1.); float c = cos(a), n = sin(a); q = mat2(c, -n, n, c) * q / s; return q / vec2(uAspect, 1.) + uCenter; }
/* p from -f..1+f so a feathered edge starts and ends fully off the frame */
float spread(float q, float f){ return q * (1. + 2. * f) - f; }
float edge(float s, float q, float f){ return 1. - smoothstep(q - f, q + f, s); }
/* small disc blur of one input (radius in stage height units) */
vec3 discA(vec2 uv, float r){ vec3 c = SA(uv); if (r < 1e-4) return c; float w = 1.;
  for (int i = 0; i < 12; i++){ float a = float(i) * 2.39996; float d = sqrt(float(i) + .5) / sqrt(12.); vec2 o = vec2(cos(a), sin(a)) * d * r * vec2(1. / uAspect, 1.); c += SA(uv + o); w += 1.; } return c / w; }
vec3 discB(vec2 uv, float r){ vec3 c = SB(uv); if (r < 1e-4) return c; float w = 1.;
  for (int i = 0; i < 12; i++){ float a = float(i) * 2.39996; float d = sqrt(float(i) + .5) / sqrt(12.); vec2 o = vec2(cos(a), sin(a)) * d * r * vec2(1. / uAspect, 1.); c += SB(uv + o); w += 1.; } return c / w; }
/* directional blur: 24 taps, each pixel's taps offset by its own hashed fraction, so a long streak reads as one smooth
   smear instead of stepped copies of the picture */
vec3 lineA(vec2 uv, vec2 dir, float r){ if (r < 1e-4) return SA(uv); float j = hash2(floor(uv * uRes)); vec3 c = vec3(0.); for (int i = 0; i < 24; i++){ float k = (float(i) + j) / 24. - .5; c += SA(uv + dir * k * r); } return c / 24.; }
vec3 lineB(vec2 uv, vec2 dir, float r){ if (r < 1e-4) return SB(uv); float j = hash2(floor(uv * uRes)); vec3 c = vec3(0.); for (int i = 0; i < 24; i++){ float k = (float(i) + j) / 24. - .5; c += SB(uv + dir * k * r); } return c / 24.; }
float bright(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float sdHeart(vec2 p){ p.x = abs(p.x); if (p.y + p.x > 1.) return sqrt(dot(p - vec2(.25, .75), p - vec2(.25, .75))) - sqrt(2.) / 4.;
  return sqrt(min(dot(p - vec2(0, 1), p - vec2(0, 1)), dot(p - .5 * max(p.x + p.y, 0.), p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y); }
float sdStar(vec2 p, float r, float rf){ const vec2 k1 = vec2(.809016994375, -.587785252292); const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x); p -= 2. * max(dot(k1, p), 0.) * k1; p -= 2. * max(dot(k2, p), 0.) * k2; p.x = abs(p.x); p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1); float h = clamp(dot(p, ba) / dot(ba, ba), 0., r); return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y); }
vec3 bg(vec2 uv, float q){ return mix(discA(uv, .04), discB(uv, .04), q) * .28; }

/* 3D: a card (2a × 2) seen through a 45° camera; ray from the camera through this pixel */
const float D = 2.41421356;
vec3 rayDir(vec2 uv){ return normalize(vec3((uv.x - .5) * 2. * uAspect, (.5 - uv.y) * 2., -D)); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0., -s, 0., 1., 0., s, 0., c); }
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1., 0., 0., 0., c, s, 0., -s, c); }
/* intersect a face: center, normal, in-face axes, half size; returns t (or -1) and the face uv */
float face(vec3 C, vec3 r, vec3 c, vec3 n, vec3 u, vec3 v, vec2 hs, out vec2 fuv){
  float dn = dot(r, n); fuv = vec2(-1.); if (abs(dn) < 1e-5) return -1.;
  float t = dot(c - C, n) / dn; if (t <= 0.) return -1.;
  vec3 h = C + r * t - c; float x = dot(h, u), y = dot(h, v);
  if (abs(x) > hs.x || abs(y) > hs.y) return -1.;
  if (dot(n, -r) <= 0.) return -1.;
  fuv = vec2(x / (2. * hs.x) + .5, .5 - y / (2. * hs.y)); return t;
}
vec3 cube(vec2 uv, float p){
  float q = ease(p), th = q * PI * .5; bool vert = uDir >= 2; float a = uAspect;
  float depth = vert ? 2. : 2. * a; vec3 C = vec3(0., 0., D + 1.1 * sin(PI * p) * (vert ? 1. : a)); vec3 r = rayDir(uv);
  float sgn = (uDir == 0 || uDir == 2) ? -1. : 1.; mat3 R = vert ? rotX(sgn * th) : rotY(sgn * th);
  vec3 cc = vec3(0., 0., -depth * .5);
  vec2 fa, fb; float best = 1e9; vec3 col = bg(uv, q);
  vec3 nA = R * vec3(0, 0, 1); vec3 cA = R * vec3(0, 0, depth * .5) + cc;
  float tA = face(C, r, cA, nA, R * vec3(1, 0, 0), R * vec3(0, 1, 0), vec2(a, 1.), fa);
  vec3 nB, cB, fu, fv;
  if (!vert) { nB = R * vec3(-sgn, 0, 0); cB = R * vec3(-sgn * a, 0, 0) + cc; fu = R * vec3(0, 0, sgn); fv = R * vec3(0, 1, 0); }
  else { nB = R * vec3(0, sgn, 0); cB = R * vec3(0, sgn, 0) + cc; fu = R * vec3(1, 0, 0); fv = R * vec3(0, 0, -sgn); }
  float tB = face(C, r, cB, nB, fu, fv, vec2(a, 1.), fb);
  if (tA > 0. && tA < best) { best = tA; col = SA(fa) * (.25 + .75 * max(nA.z, 0.)); }
  if (tB > 0. && tB < best) { best = tB; col = SB(fb) * (.25 + .75 * max(nB.z, 0.)); }
  return col;
}
vec3 flip(vec2 uv, float p, bool vertical){
  float q = ease(p), th = q * PI; vec3 C = vec3(0., 0., D + .9 * sin(PI * p)); vec3 r = rayDir(uv);
  mat3 R = vertical ? rotX(th) : rotY(th); vec3 n = R * vec3(0, 0, 1), u = R * vec3(1, 0, 0), v = R * vec3(0, 1, 0);
  float dn = dot(r, n); if (abs(dn) < 1e-5) return bg(uv, q);
  float t = dot(-C, n) / dn; vec3 h = C + r * t; float x = dot(h, u), y = dot(h, v);
  if (t <= 0. || abs(x) > uAspect || abs(y) > 1.) return bg(uv, q);
  float shade = .3 + .7 * abs(n.z);
  vec2 f = vec2(x / (2. * uAspect) + .5, .5 - y / 2.);
  if (dot(n, -r) > 0.) return SA(f) * shade;
  return SB(vertical ? vec2(f.x, 1. - f.y) : vec2(1. - f.x, f.y)) * shade;
}
vec3 fold(vec2 uv, float p){
  float q = ease(p), th = q * PI * .6; vec3 C = vec3(0., 0., D); vec3 r = rayDir(uv); float a = uAspect;
  vec3 col = SB(uv) * (.55 + .45 * q); float best = 1e9; vec2 f;
  /* left half hinged at its left edge, right half at its right edge; both swing away */
  mat3 RL = rotY(th), RR = rotY(-th);
  vec3 nL = RL * vec3(0, 0, 1), uL = RL * vec3(1, 0, 0); vec3 cL = vec3(-a, 0, 0) + uL * (a * .5);
  float tL = face(C, r, cL, nL, uL, vec3(0, 1, 0), vec2(a * .5, 1.), f);
  if (tL > 0.) { best = tL; col = SA(vec2(f.x * .5, f.y)) * (.35 + .65 * max(nL.z, 0.)); }
  vec3 nR = RR * vec3(0, 0, 1), uR = RR * vec3(1, 0, 0); vec3 cR = vec3(a, 0, 0) - uR * (a * .5);
  float tR = face(C, r, cR, nR, uR, vec3(0, 1, 0), vec2(a * .5, 1.), f);
  if (tR > 0. && tR < best) col = SA(vec2(.5 + f.x * .5, f.y)) * (.35 + .65 * max(nR.z, 0.));
  return col;
}
vec3 pageCurl(vec2 uv, float p){
  float q = ease(p); float a = uAspect; vec2 Q = vec2(uv.x * a, uv.y), corner = vec2(a, 1.);
  vec2 d = normalize(vec2(a, 1.)); float L = length(vec2(a, 1.)); float fl = L * q * 1.25;
  float s = dot(corner - Q, d);
  if (s > fl) return SA(uv);
  vec2 Qb = Q - 2. * (fl - s) * d;
  if (Qb.x >= 0. && Qb.x <= a && Qb.y >= 0. && Qb.y <= 1.) {
    vec3 back = SA(vec2(Qb.x / a, Qb.y)); float g = bright(back); back = mix(vec3(g), back, .35) * .55 + .38;
    float curve = .75 + .25 * smoothstep(0., .25, fl - s);
    return back * curve;
  }
  float shadow = 1. - .55 * exp(-(fl - s) * 9.) * (1. - smoothstep(.85, 1., p));
  return SB(uv) * shadow;
}


/* ---- Premium library ---- */
float easeInC(float x){ return bez(clamp(x, 0., 1.), vec4(.55, 0., 1., .45)); }
float easeOutC(float x){ return bez(clamp(x, 0., 1.), vec4(0., .55, .45, 1.)); }
float easeIOC(float x){ return bez(clamp(x, 0., 1.), vec4(.65, 0., .35, 1.)); }
/* speed of the eased progress (for blur that follows real velocity) */
float speedOf(float p){ float h = .01; return (ease(clamp(p + h, 0., 1.)) - ease(clamp(p - h, 0., 1.))) / (2. * h); }
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }

/* Landscape Close (horizontal shutters, top and bottom) and Portrait Close (vertical, left and right).
   The shutters close over the first 'split' of the time (after any hold, the rest opens), to 'amount' of the frame:
   the aperture left is exactly (1 − amount × c) of the frame, c the eased closing. The panels' edges are
   anti-aliased so that where they meet their coverage sums to exactly 1: no seam, no flash. The opening is the closing
   reversed (same curve, same geometry). The clip changes at the middle of the hold, under the shutters (a soft
   match-cut through the aperture when 'match' is set, for a partial close). */
vec3 shutter(vec2 uv, float p, bool vertical){
  float h = clamp(uHold, 0., .6);
  float cs = clamp(uSplit, .05, 1.) * (1. - h);
  float os = (1. - h) - cs;
  float c = p < cs ? ease(p / cs) : p < cs + h ? 1. : (os > 0. ? ease(1. - (p - cs - h) / os) : 1.);
  float a = clamp(uAmount, 0., 1.) * c;
  float line = clamp(vertical ? uCenter.x : uCenter.y, .02, .98);
  float s = vertical ? uv.x : uv.y;
  /* the strip (1 − a of the frame) is centred on the chosen line by the time it reaches the chosen amount (at full
     close the panels meet on it); balance lets one panel lead mid-move without changing where they end */
  float A = max(uAmount, 1e-3), hv = (1. - a) * .5;
  float ctr = .5 + (line - .5) * clamp(a / A, 0., 1.) + clamp(uBalance, -1., 1.) * .22 * sin(PI * clamp(a / A, 0., 1.)) * (1. - a);
  ctr = clamp(ctr, hv, 1. - hv);
  float e1 = ctr - hv, e2 = ctr + hv;
  float mid = cs + h * .5, m = clamp(uMatch, 0., .5);
  float k = m > .001 ? smoothstep(mid - m * .5, mid + m * .5, p) : step(mid, p);
  vec3 content = mix(SA(uv), SB(uv), k);
  if (a < 1e-5) return content;
  float px = 1. / (vertical ? uRes.x : uRes.y);
  float f = max(uFeather * .25, px * .75);
  float c1 = 1. - smoothstep(e1 - f, e1 + f, s), c2 = smoothstep(e2 - f, e2 + f, s);
  float cover = clamp(c1 + c2, 0., 1.);
  float inside = min(s - e1, e2 - s);
  content *= 1. - clamp(uShadow, 0., 1.) * .6 * exp(-max(inside, 0.) * 26.);
  float dp = s < line ? e1 - s : s - e2;
  vec3 panel = mix(lin(uColor2), lin(uColor), clamp(dp * 5., 0., 1.));
  vec3 col = mix(content, panel, cover);
  float glow = clamp(uGlow, 0., 1.) * exp(-abs(dp) * 70.) * step(px, abs(e2 - e1) + px);
  return col + lin(vec3(1.)) * glow * .5;
}
/* a card of the stage (2a × 2) at 'center', turned 'ang' about y: its face uv, or -1 when missed or seen from behind */
float cardHit(vec3 C, vec3 r, vec3 center, float ang, out vec2 fuv, out float shade){ mat3 R = rotY(ang); vec3 n = R * vec3(0, 0, 1);
  float t = face(C, r, center, n, R * vec3(1, 0, 0), vec3(0, 1, 0), vec2(uAspect, 1.), fuv); shade = .35 + .65 * max(n.z, 0.); return t; }

vec3 premium(vec2 uv, float p, int e){
  float q = ease(p);
  float f = max(uFeather, .0005);
  vec2 dv = dirv();
  if (e == 60) return shutter(uv, p, false);
  if (e == 61) return shutter(uv, p, true);
  if (e == 62) { /* whip pan: A leaves and B arrives in one fast camera move; the streak follows the move's speed */
    float o = bez(p, vec4(.7, 0., .3, 1.)); float h = .01; float sp = (bez(min(p + h, 1.), vec4(.7, 0., .3, 1.)) - bez(max(p - h, 0.), vec4(.7, 0., .3, 1.))) / (2. * h);
    vec2 pos = uv - dv * o; float idx = floor(dot(pos, abs(dv))); vec2 w = pos - abs(dv) * idx; float r = uIntensity * .22 * sp;
    return idx == 0. ? lineA(w, dv, r) : lineB(w, dv, r); }
  if (e == 63) { /* lens push: accelerate into the focus with barrel distortion, land in B as it relaxes */
    float I = max(uIntensity, .05); vec2 c = uCenter;
    if (p < .5) { float k = easeInC(p * 2.); float s = 1. + 1.1 * I * k; vec2 d = uv - c; d *= 1. + .9 * I * k * dot(d, d); return SA(c + d / s) * (1. + .25 * k * k); }
    float k = 1. - easeOutC((p - .5) * 2.); float s = 1. + 1.1 * I * k; vec2 d = uv - c; d *= 1. + .9 * I * k * dot(d, d); return SB(c + d / s) * (1. + .25 * k * k); }
  if (e == 64) { /* perspective slide: A swings away in depth to one side as B slides in from the other */
    vec3 C = vec3(0., 0., D); vec3 r = rayDir(uv); float a = uAspect; float sg = uDir == 1 ? 1. : -1.;
    vec2 fa, fb; float sa, sb; vec3 col = bg(uv, q) * .6;
    float tA = cardHit(C, r, vec3(sg * q * 2.3 * a, 0., -q * 1.2), sg * q * .95, fa, sa);
    float tB = cardHit(C, r, vec3(-sg * (1. - q) * 2.3 * a, 0., -(1. - q) * 1.2), -sg * (1. - q) * .95, fb, sb);
    float best = 1e9;
    if (tA > 0.) { best = tA; col = SA(fa) * sa; }
    if (tB > 0. && tB < best) col = SB(fb) * sb;
    return col; }
  if (e == 65) { /* pullback reveal: A pulls back into a floating window, which rises away to reveal B behind */
    float k1 = easeIOC(clamp(p / .55, 0., 1.)), k2 = easeInC(clamp((p - .45) / .55, 0., 1.));
    float s = mix(1., .64, k1); vec2 c = vec2(.5, .5 - 1.3 * k2); vec2 l = (uv - c) / s + .5;
    vec2 pp = (l - .5) * vec2(uAspect, 1.); float rad = .07 * k1; float d = sdRound(pp, vec2(uAspect * .5, .5), rad);
    vec3 back = SB(uv) * mix(.55, 1., k2);
    float shadow = exp(-max(d * s, 0.) * 14.) * .55 * k1; back *= 1. - shadow;
    float m = 1. - smoothstep(-.002, .002, d);
    return mix(back, SA(l), m); }
  if (e == 66) { /* card stack: A drops back in the stack, B slides up to the front */
    float k = easeIOC(p); vec2 cA = vec2(.5, .5 - .07 * k); float sA = mix(1., .86, k);
    vec2 lA = (uv - cA) / sA + .5; vec2 pa = (lA - .5) * vec2(uAspect, 1.); float rA = .06 * smoothstep(0., .2, p);
    float dA = sdRound(pa, vec2(uAspect * .5, .5), rA);
    vec3 col = vec3(.02) + SA(uv) * .0; col = mix(col, SA(lA) * mix(1., .55, k), 1. - smoothstep(-.002, .002, dA));
    float yB = mix(1.08, 0., k); vec2 lB = uv - vec2(0., yB); vec2 pb = (lB - .5) * vec2(uAspect, 1.); float rB = .06 * (1. - smoothstep(.8, 1., p));
    float dB = sdRound(pb, vec2(uAspect * .5, .5), rB); col *= 1. - .5 * exp(-max(dB, 0.) * 18.) * (1. - k * k);
    return mix(col, SB(lB), 1. - smoothstep(-.002, .002, dB)); }
  if (e == 67) { /* flash zoom: one short exposure peak at the cut, with a controlled zoom through it */
    float I = max(uIntensity, .05); float peak = exp(-pow((p - .5) / .075, 2.)) * I;
    vec3 c = p < .5 ? SA(zoomAt(uv, 1. + .32 * I * easeInC(p * 2.))) : SB(zoomAt(uv, 1. + .32 * I * (1. - easeOutC((p - .5) * 2.))));
    return mix(c * (1. + peak * 2.5), vec3(1.), clamp(peak, 0., 1.) * .85); }
  if (e == 68) { /* lens cover: something close to the lens passes across; the cut happens behind it */
    vec2 c = (uv - .5) * vec2(uAspect, 1.);
    float inner = max(.55, length(vec2(uAspect * .275, .58)) + .03), outer = inner + .5;
    float travel = uAspect * .5 + outer / .55 + .02;
    float x = mix(-travel, travel, q) * (uDir == 1 ? -1. : 1.);
    float d = length((c - vec2(x, .08 * sin(q * PI))) * vec2(.55, 1.)); float m = 1. - smoothstep(inner, outer, d);
    vec3 dark = vec3(.012, .011, .01) * (.7 + .6 * vnoise(uv * 6.));
    return mix(p < .5 ? SA(uv) : SB(uv), dark, m); }
  if (e == 69) { /* film burn: a warm light leak blooms, the cut hides in its peak */
    float env = sin(PI * p); float n = vnoise(uv * 2.6 + vec2(p * 1.7, -p)) * .65 + vnoise(uv * 7. - p * 2.) * .35;
    float burn = smoothstep(1. - env * 1.15, 1. - env * .55, n + uv.x * .25 * env);
    vec3 warm = mix(vec3(1., .42, .08), vec3(1., .86, .55), n) * (1.4 + 1.6 * env) * max(uIntensity, .1);
    vec3 base = mix(SA(uv), SB(uv), smoothstep(.42, .58, p));
    return mix(base * (1. + env * .6 * uIntensity), warm, clamp(burn, 0., 1.)); }
  if (e == 70) { /* light sweep: a band of light crosses the frame and leaves B behind it */
    float an = radians(uAngle); vec2 d = vec2(cos(an), sin(an)); vec2 c = (uv - .5) * vec2(uAspect, 1.);
    float L = abs(d.x) * uAspect + abs(d.y); float s = .5 + dot(c, d) / L; float pos = spread(q, .12);
    vec3 col = mix(SA(uv), SB(uv), edge(s, pos, .015)); float band = exp(-pow((s - pos) / .05, 2.)) * uIntensity * sin(PI * p);
    return col * (1. + band * 2.) + vec3(band * .6); }
  if (e == 71) { /* portal zoom: B appears inside an opening that grows from the focus, zooming out to rest */
    vec2 c = (uv - uCenter) * vec2(uAspect, 1.); float far = length(max(abs(uCenter), abs(1. - uCenter)) * vec2(uAspect, 1.));
    float R = mix(-.08, far + .05, easeIOC(p)); float d = length(c);
    float m = 1. - smoothstep(R - .006, R + .006, d);
    vec3 a = SA(zoomAt(uv, 1. + .22 * q)), b = SB(zoomAt(uv, mix(2.2, 1., easeOutC(p))));
    float ring = exp(-pow((d - R) / .012, 2.)) * (1. - smoothstep(.85, 1., p)) * .5;
    return mix(a, b, m) + vec3(ring); }
  if (e == 72) { /* liquid morph: the picture flows, and B pours in through the flow */
    float env = sin(PI * p) * max(uIntensity, .05); vec2 n2 = vec2(vnoise(uv * 3.5 + p * 2.), vnoise(uv * 3.5 + 7. - p * 2.)) - .5;
    vec2 dA = n2 * .14 * env, dB = -n2 * .14 * env; float t = vnoise(uv * 2.2 + 3.) * .55 + uv.y * .45;
    float k = 1. - smoothstep(spread(q, .2) - .2, spread(q, .2) + .2, t);
    return mix(SA(uv + dA), SB(uv + dB), k); }
  if (e == 73) { /* smooth stretch: A stretches along the move, B snaps back from the stretch */
    vec2 ax = abs(dv); float k = p < .5 ? easeInC(p * 2.) : 1. - easeOutC((p - .5) * 2.); float st = 1. + 1.6 * uIntensity * k;
    vec2 u2 = .5 + (uv - .5) / mix(vec2(1.), vec2(1.) + ax * (st - 1.), 1.); float r = .12 * uIntensity * k;
    return p < .5 ? lineA(u2, ax, r) : lineB(u2, ax, r); }
  if (e == 74) { /* glass refraction: a pane of glass slides across, bending the picture; B is behind it */
    float x = mix(-.35, 1.35, q); float w = .22; float s = (uv.x - x) / w;
    if (abs(s) < 1.) { float bend = sin(s * PI * .5) * .09 * uIntensity; vec2 u2 = uv + vec2(bend, 0.);
      vec3 c = mix(SB(u2), SA(u2), smoothstep(-.2, .2, s)); float hl = exp(-pow((s + .55) / .12, 2.)) * .35 + exp(-pow((s - .7) / .05, 2.)) * .18;
      return c * 1.04 + vec3(hl); }
    return uv.x < x ? SB(uv) : SA(uv); }
  if (e == 75) { /* prism split: colour fringes open up and close back on B (subtle by default) */
    float env = sin(PI * p) * .028 * max(uIntensity, .05); vec2 o = (uv - .5) * env * 2. + dv * env;
    vec3 a = vec3(SA(uv + o).r, SA(uv).g, SA(uv - o).b), b = vec3(SB(uv + o).r, SB(uv).g, SB(uv - o).b);
    return mix(a, b, smoothstep(.44, .56, p)); }
  if (e == 76) { /* paper tear: A tears away top to bottom along a ragged edge, with its paper rim and a shadow */
    float j = (vnoise(vec2(uv.x * 22., 3.1)) - .5) * .05 + (vnoise(vec2(uv.x * 70., 9.)) - .5) * .012;
    float y = mix(-.08, 1.08, q) + j; float d = uv.y - y;
    if (d < 0.) return SB(uv) * (1. - .45 * exp(d * 40.));
    if (d < .011) return lin(vec3(.96, .95, .92)) * (.85 + .15 * vnoise(uv * 90.));
    return SA(uv); }
  if (e == 77) { /* sliding panels: the frame splits into panels that slide away in turn */
    float n = float(max(uStrips, 2)); float i = floor(uv.x * n);
    float qi = easeIOC(clamp(p * 1.55 - i / n * .55, 0., 1.)); float sg = mod(i, 2.) < .5 ? 1. : -1.;
    vec2 u2 = uv - vec2(0., sg * qi * 1.02); bool inA = u2.y >= 0. && u2.y <= 1.;
    float edgeShade = 1. - .35 * qi * (1. - qi) * 4. * exp(-abs(fract(uv.x * n) - .5) * 2.);
    return inA ? SA(u2) * edgeShade : SB(uv); }
  if (e == 78) { /* film strip: the two shots are frames on a strip that rolls on, pulling back a little as it moves */
    float env = max(0., sin(PI * p)), border = .055 * env;
    float s = 1. - .14 * env; vec2 l = (uv - .5) / s + .5; float gap = .06 * env; float y = l.y + q * (1. + gap);
    float fi = floor(y / (1. + gap)); float fy = y - fi * (1. + gap);
    vec3 col = vec3(.02);
    float side = min(l.x, 1. - l.x); if (side < border) { float hole = step(.35, fract(y * 9.)) * step(fract(y * 9.), .75); return mix(col, vec3(.85), hole * step(.015 * env, side) * step(side, .04 * env)); }
    if (fy > 1.) return col;
    vec2 fuv = vec2((l.x - border) / (1. - 2. * border), fy);
    return fi < .5 ? SA(fuv) : SB(fuv); }
  if (e == 79) { /* beat punch: a sharp impact on the beat, settling cleanly */
    float I = max(uIntensity, .05); if (p < .5) { float k = easeInC(p * 2.); return SA(zoomAt(uv, 1. + .05 * I * k)); }
    float k = 1. - easeOutC((p - .5) * 2.); float flash = exp(-pow((p - .5) / .04, 2.)) * .35 * I;
    return SB(zoomAt(uv, 1. + .16 * I * k)) * (1. + flash) + vec3(flash * .3); }
  if (e == 80) { /* split screen merge: three bands carry A out and B in, each on its own beat, then rejoin */
    float i = floor(uv.y * 3.); float qi = easeIOC(clamp(p * 1.5 - i * .25, 0., 1.)); float sg = mod(i, 2.) < .5 ? -1. : 1.;
    vec2 ua = uv + vec2(sg * qi * 1.02, 0.), ub = uv + vec2(sg * (qi - 1.) * 1.02, 0.);
    return (ua.x >= 0. && ua.x <= 1.) ? SA(ua) : SB(ub); }
  if (e == 81) { /* speed ramp: A races into the cut (its footage speeds up), B eases out of it */
    float I = max(uIntensity, .05); float k = smoothstep(.47, .53, p);
    return mix(SA(zoomAt(uv, 1. + .12 * I * easeInC(p * 2.))), SB(zoomAt(uv, 1. + .12 * I * (1. - easeOutC(p * 2. - 1.)))), k); }
  if (e == 83) { /* camera spin: an exact turn (90°, 180° or 360°) with a matched zoom, landing level on B */
    float ang = radians(uAngle) * (uDir == 1 ? -1. : 1.); float k = smoothstep(.47, .53, p);
    float h1 = clamp(q / .5, 0., 1.), h2 = clamp((q - .5) / .5, 0., 1.);
    vec3 ca = SA(rotAt(uv, ang * .5 * h1, 1. + .28 * h1)); vec3 cb = SB(rotAt(uv, -ang * .5 * (1. - h2), 1. + .28 * (1. - h2)));
    return mix(ca, cb, k); }
  if (e == 85) { /* freeze frame: A's last frame freezes as a photo, tilts back and slides away over B */
    float k1 = easeIOC(clamp(p / .5, 0., 1.)), k2 = easeInC(clamp((p - .4) / .6, 0., 1.));
    float s = mix(1., .72, k1); float rot = radians(-6.) * k1; vec2 c = vec2(.5 + 1.25 * k2, .5);
    vec2 l = rotAt(uv - c + .5, rot, s); vec2 pp = (l - .5) * vec2(uAspect, 1.);
    float border = .035 * k1; float d = sdRound(pp, vec2(uAspect * .5 + border, .5 + border), .012 * k1);
    vec3 back = SB(uv) * mix(.6, 1., k2) * (1. - .45 * exp(-max(d, 0.) * 16.) * k1);
    if (d > 0.) return back;
    float inner = sdRound(pp, vec2(uAspect * .5, .5), .006);
    return inner > 0. ? lin(vec3(.97)) : SA(l); }
  if (e == 86) { /* parallax split: the top and bottom of the frame travel at different speeds */
    float top = step(uv.y, .5); float sp = mix(1.18, .86, top); float o = pow(q, sp);
    vec2 ua = uv - dv * o, ub = uv - dv * (o - 1.);
    return (ua.x >= 0. && ua.x <= 1. && ua.y >= 0. && ua.y <= 1.) ? SA(ua) : SB(ub); }
  if (e == 87) { /* snap rotate: a quick turn into the cut, settling level on B */
    float a = radians(14.) * max(uIntensity, .1) * (uDir == 1 ? -1. : 1.);
    if (p < .5) { float k = easeInC(p * 2.); return SA(rotAt(uv, a * k, 1. + .12 * k)); }
    float k = 1. - easeOutC((p - .5) * 2.); return SB(rotAt(uv, -a * k, 1. + .12 * k)); }
  if (e == 91) { /* piercing bullet: a projectile streaks to the impact point, the frame punches open there and B is seen
                    through the opening, which grows to fill the frame. Styles (uStrips): 1 clean, 2 cinematic, 3 glass,
                    4 metal, 5 comic, 6 energy */
    float hit = clamp(uSplit, .1, .8); vec2 c = uCenter; float an = radians(uAngle); vec2 d = vec2(cos(an), sin(an));
    vec2 asp = vec2(uAspect, 1.); vec2 rel = (uv - c) * asp; int st = uStrips;
    vec3 tone = st == 6 ? vec3(.35, .8, 1.) : st == 5 ? vec3(1., .85, .2) : st == 4 ? vec3(.86, .82, .76) : st == 3 ? vec3(.85, .95, 1.) : vec3(1., .96, .88);
    if (p < hit) {
      float k = p / hit; float travel = mix(.62, 0., k); vec2 head = -d * travel;
      float pre = smoothstep(.6, 1., k); vec3 col = SA(c + (uv - c) * (1. - .035 * pre * max(uShadow, .2)));
      vec2 a0 = head - d * (.3 + .5 * (1. - k)) * (.4 + uMotionBlur), ba = head - a0, pa = rel - a0; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0., 1.);
      float dist = length(pa - ba * h); float w = .006 + .009 * h;
      float streak = (1. - smoothstep(w * .5, w * 2.5, dist)) * pow(h, 1.5) + exp(-pow(length(rel - head) / .012, 2.)) * .9;
      return mix(col, tone * 1.8, clamp(streak, 0., 1.));
    }
    float k = (p - hit) / max(1. - hit, 1e-4);
    float shake = uShadow * .012 * exp(-k * 9.) * sin(k * 80.);
    vec2 uvA = uv + vec2(shake, -shake * .6);
    float open = easeOutC(clamp(k / .3, 0., 1.)) * max(uAmount, .05) * .42 + easeIOC(clamp((k - .25) / .75, 0., 1.)) * 1.75;
    float ang2 = atan(rel.y, rel.x); float r = length(rel); float jag = 0.;
    if (st == 3) jag = (vnoise(vec2(ang2 * 6., 3.)) - .5) * .4 + (hash(floor(ang2 * 9. + 20.)) - .5) * .3;
    else if (st == 4) jag = -abs(sin(ang2 * 7.)) * .22 + (vnoise(vec2(ang2 * 12., 1.)) - .5) * .14;
    else if (st == 5) jag = fract(ang2 * 8. / 6.2831853) < .5 ? .28 : -.08;
    else if (st == 2) jag = (vnoise(vec2(ang2 * 4., 7.)) - .5) * .12;
    float R = open * (1. + jag * (1. - smoothstep(.4, 1., k)));
    float inside = 1. - smoothstep(R - .005, R + .005, r);
    float ring = exp(-pow((r - R) / .06, 2.)) * max(uShadow, .1);
    vec2 nr = r > 1e-4 ? rel / r : vec2(0.);
    vec3 a = SA(uvA + nr / asp * ring * .035);
    vec3 b = SB(c + (uv - c) * (1. - .1 * (1. - easeOutC(k))));
    vec3 col = mix(a, b, inside);
    float fade = 1. - k;
    col += tone * exp(-pow((r - R) / .007, 2.)) * fade * (st == 1 ? .5 : 1.2);
    if (st == 6) col += tone * exp(-pow((r - R) / .03, 2.)) * fade * .9;
    if (st == 3) { float rays = pow(abs(sin(ang2 * 7. + vnoise(vec2(r * 3., 2.)) * .6)), 140.) * smoothstep(R, R + .02, r) * (1. - smoothstep(R + .08, R + .35, r)) * fade; col += vec3(.95) * rays * .45; }
    if (uGlow > .01) for (int i = 0; i < 20; i++) { float fi = float(i); float pa2 = hash(fi * 3.1) * 6.2831853; float sp = .25 + hash(fi * 7.7) * .9; vec2 pp = vec2(cos(pa2), sin(pa2)) * (k * sp + .02); col += tone * (1. - smoothstep(.0025, .008, length(rel - pp))) * fade * uGlow; }
    if (st == 5) { float burst = (1. - smoothstep(R, R + .12 * fade, r)) * (1. - inside); vec2 g = fract(uv * uRes / 14.) - .5; col = mix(col, vec3(1., .85, .2), burst * (1. - smoothstep(.18, .24, length(g))) * .55 * fade); }
    col += vec3(1.) * exp(-k * 22.) * uIntensity * (1. - smoothstep(0., .28, r));
    return col;
  }
  if (e == 92) { /* beat shake (one clip): a directional hit at the beat (uSplit), decaying */
    float hit = clamp(uSplit, 0., .95); float k = max(0., p - hit) / max(1. - hit, .05);
    float env = p < hit ? 0. : exp(-k * 7.) * uIntensity; vec2 o = dirv() * .05 * env * sin(k * 55.) + vec2(.0, .012 * env * cos(k * 40.));
    return SA(uCenter + (uv - uCenter) / (1. + .04 * env) - o);
  }
  if (e == 93) { /* flash impact: an exposure pulse with a punch zoom and a colour split, at the beat (uSplit) */
    float hit = clamp(uSplit, 0., .95); float x = (p - hit) / .12; float env = exp(-x * x) * uIntensity;
    vec2 q = uCenter + (uv - uCenter) / (1. + .08 * env); vec2 ca = (uv - .5) * .012 * env * (1. + uGlow * 2.);
    vec3 col = vec3(SA(q + ca).r, SA(q).g, SA(q - ca).b);
    return col + vec3(1.) * env * .9;
  }
  if (e == 94) { /* glitch snap: a very short RGB displacement and frame break at the beat (uSplit) */
    float hit = clamp(uSplit, 0., .95); float w = .1; float on = step(hit, p) * step(p, hit + w); float s = floor(p * 30.);
    float row = floor(uv.y * 18.); float off = (hash(row + s * 7.) - .5) * .12 * uIntensity * on;
    vec2 q = uv + vec2(off, 0.); vec2 ca = vec2(.012 * uIntensity * on, 0.);
    vec3 col = vec3(SA(q + ca).r, SA(q).g, SA(q - ca).b);
    return mix(col, col.bgr, on * step(.85, hash(row + s)));
  }
  if (e == 95) { /* film burn / light leak: warm light drifting across, exposure rising and falling over the effect */
    float env = sin(PI * p) * uIntensity; vec3 col = SA(uv);
    vec2 q = uv * vec2(uAspect, 1.); float n = vnoise(q * 2.2 + vec2(p * 2.5, p * .8)) * .7 + vnoise(q * 5. - vec2(p * 3., 0.)) * .3;
    float leak = smoothstep(.35, .9, n + (uv.x - .5) * .6 * (uDir == 1 ? -1. : 1.)) * env;
    vec3 warm = mix(vec3(1., .45, .15), vec3(1., .85, .5), n);
    return col + warm * leak * 1.3 + vec3(.06, .03, 0.) * env;
  }
  if (e == 96) { /* smooth camera roll: turns about the chosen point with a matched zoom (so no corner shows), and back */
    float zi = clamp(uIn, .001, 1.), zo = clamp(uOut, 0., 1. - zi);
    float k = p < zi ? ease(p / zi) : p > 1. - zo && zo > .001 ? ease((1. - p) / zo) : 1.;
    float a = radians(uAngle) * k * (uDir == 1 ? -1. : 1.); float cover = abs(cos(a)) + max(uAspect, 1. / uAspect) * abs(sin(a));
    return SA(rotAt(uv, a, cover * (1. + .05 * k)));
  }
  if (e == 97) { /* split-frame freeze: the held frame cut into strips that slide apart in turn */
    float n = float(max(uStrips, 2)); float i = floor(uv.x * n); float stag = i / n * .35; float k = ease(clamp((p - stag) / .65, 0., 1.));
    float dirS = mod(i, 2.) < 1. ? 1. : -1.; vec2 q = vec2(uv.x, uv.y - dirS * k * uAmount * 1.1);
    if (q.y < 0. || q.y > 1.) return lin(uColor);
    return SA(q) * (1. - .25 * k);
  }
  if (e == 98) { /* velocity edit: the footage itself is retimed (the page plays it faster and slower); drawn as it is */
    return SA(uv);
  }
  if (e == 90) { /* zoom (one clip): into the chosen point at the chosen size; the point glides to the centre */
    float zi = clamp(uIn, .001, 1.), zo = clamp(uOut, 0., 1. - zi);
    float k = p < zi ? ease(p / zi) : p > 1. - zo && zo > .001 ? ease((1. - p) / zo) : 1.;
    float S = max(uScale, 1.); float sc = mix(1., S, k);
    vec2 tgt = clamp(uCenter, vec2(.5 / S), vec2(1. - .5 / S));
    vec2 cv = mix(vec2(.5), tgt, (sc - 1.) / max(S - 1., 1e-4));
    return SA(cv + (uv - .5) / sc); }
  return mix(SA(uv), SB(uv), p);
}


/* ---- Clyra ripple, NameDrop preset: several thick refractive waves that gather, release, travel, strike and settle ---- */
/* how far a stage point is from the wave's origin, in the space the scan gives: screen, the shot's scene (taken back
   through the camera), a rectified surface, or a corridor's depth through connected floor, walls and ceiling */
float ripDist(vec2 uv){
  vec2 s = cover(uv, uAspA); int m = int(uRip3.x + .5);
  if (m == 0) return length((s - uRipO) * vec2(uAspA, 1.));
  vec3 h = uRipM * vec3(s, 1.); if (h.z <= 1e-4) return 1e3; vec2 r = h.xy / h.z;
  if (m == 1) return length((r - uRipO) * vec2(uAspA, 1.));
  if (m == 2) return length(r - uRipO);
  vec2 q = (r - uRipVP) * vec2(uAspA, 1.), q0 = (uRipO - uRipVP) * vec2(uAspA, 1.); float ax = .5 * uAspA, ay = .5;
  float z = 1. / max(max(abs(q.x) / ax, abs(q.y) / ay), .03), z0 = 1. / max(max(abs(q0.x) / ax, abs(q0.y) / ay), .03);
  return abs(z - z0) * .25;
}
/* the wave field at a distance d: x = displacement along the distance gradient (distance units), y = crest height */
vec2 ripField(float d, float p){
  float N = clamp(uRip.y, 1., 8.), w0 = max(uRip.z, .004), A = uRip.w * (.4 + .9 * uIntensity);
  float bld = clamp(uRip2.x, .03, .45), dis = clamp(uRip2.y, .05, .6), reach = max(uRip2.z, .05), imp = uRip2.w;
  float ti = 1. - dis, soft = mix(.7, 1.5, clamp(uRip3.z, 0., 1.));
  float decay = 1. - smoothstep(ti, 1., p); decay *= decay;
  float disp = 0., hgt = 0.;
  /* A: formation — the picture tightens toward the origin while small close rings gather */
  float f = smoothstep(0., bld, p) * (1. - smoothstep(bld, bld + .12, p)), rf = .11 * reach;
  disp += -A * .5 * f * f * d * exp(-pow(d / rf, 2.));
  disp += A * .006 * f * sin(d / rf * 16. - p * 70.) * exp(-pow(d / (rf * 1.7), 2.));
  hgt += .3 * f * exp(-pow(d / rf, 2.));
  /* B, C: release and travel — thick waves one after another, each a little slower, wider and gentler; they arrive
     together at the reach, where the impact happens */
  float ip = imp * exp(-pow((p - ti) / .04, 2.));
  for (int i = 0; i < 8; i++) { float fi = float(i); if (fi >= N) break;
    float L = bld + (ti - bld) * .34 * fi / max(N - 1., 1.);
    float k = (p - L) / max(ti - L, .05); if (k <= 0.) continue;
    float sp = 1. - .055 * fi + .03 * sin(fi * 2.3 + uSeed) * uRip3.y;
    float r = reach * sp * ((1. - pow(1. - min(k, 1.), 2.2)) + max(k - 1., 0.) * .3);
    float lead = i == 0 ? 1. : 0.;
    float w = w0 * soft * (1. + .22 * sin(fi * 1.7 + 1.)) * (.75 + .45 * min(k, 1.)) * (1. + lead * .9 * ip);
    float a = A * (1. - .1 * fi) * smoothstep(0., .08, k * (ti - L)) * (.6 + .4 * min(k, 1.)) * (1. + lead * 1.4 * ip) * decay;
    float x = (d - r) / w, en = exp(-.5 * x * x);
    disp += -a * x * en * w; hgt += a * en;
  }
  /* D: impact — a short burst of finer rings out of the main front */
  float pb = p - ti;
  if (pb > 0. && imp > 0.) for (int j = 0; j < 3; j++) { float fj = float(j);
    float r = reach * (1. + pb * (1. + .6 * fj)), w = w0 * .5;
    float a = A * .5 * imp * exp(-pb * (8. + 3. * fj)) * (1. - fj * .25) * decay;
    float x = (d - r) / w, en = exp(-.5 * x * x); disp += -a * x * en * w; hgt += .6 * a * en; }
  return vec2(disp, hgt);
}
float ripMatte(vec2 s){ if (!uMatteOn || s.x < 0. || s.y < 0. || s.x > 1. || s.y > 1.) return 0.; return smoothstep(.35, .65, texture(uMatte, uMatteRect.xy + s * uMatteRect.zw).r); }
vec3 rippleWaves(vec2 uv, float p){
  vec2 ex = vec2(1.5 / uRes.x, 0.), ey = vec2(0., 1.5 / uRes.y);
  float d = ripDist(uv);
  vec2 g = vec2(ripDist(uv + ex) - ripDist(uv - ex), ripDist(uv + ey) - ripDist(uv - ey)) / vec2(2. * ex.x, 2. * ey.y);
  vec2 W = ripField(d, p);
  /* a displacement measured along the surface, as a move on the picture: far (compressed) waves move less */
  vec2 off = g / max(dot(g, g), 1e-3) * W.x;
  off *= smoothstep(0., .035, min(min(uv.x, 1. - uv.x), min(uv.y, 1. - uv.y)));
  off = clamp(off, vec2(-.05), vec2(.05));
  /* people in front of the wave keep their own pixels, and the wave never drags them across the background */
  float fg = ripMatte(cover(uv, uAspA)); off *= (1. - fg) * (1. - ripMatte(cover(uv + off, uAspA)));
  vec2 q = clamp(uv + off, vec2(.0005), vec2(.9995)), dq = off * uGlow * .3;
  vec3 a = vec3(SA(q + dq).r, SA(q).g, SA(q - dq).b), b = vec3(SB(q + dq).r, SB(q).g, SB(q - dq).b);
  vec3 col = mix(a, b, smoothstep(.4, .6, p));
  /* light on the crest's lit slope: from the displacement itself, which passes smoothly through zero at the crest line
     (its direction flips there, and lighting by direction drew a hard-edged band) */
  float lit = smoothstep(0., 1., clamp(dot(off, normalize(vec2(-.55, -.83))) / .012, 0., 1.));
  return col + vec3(.92, .96, 1.) * lit * min(W.y, 1.2) * uRip3.w * .12 * (1. - fg);
}
vec3 frameAt(vec2 uv, float p){
  float q = ease(p);
  int e = uEffect;
  if (e >= 60) return premium(uv, p, e);
  float f = max(uFeather, .0005);
  if (e == 1) return mix(SA(uv), SB(uv), smoothstep(0., 1., p));
  if (e == 2) { float h = clamp(uHold, 0., .4), hh = (1. - h) * .5; vec3 c = lin(uColor);
    if (p < hh) return mix(SA(uv), c, 1. - pow(1. - p / hh, 2.));
    if (p < hh + h) return c; return mix(c, SB(uv), 1. - pow(1. - (p - hh - h) / hh, 2.)); }
  if (e == 3 || e == 53) { float peak = e == 3 ? .45 : .5;
    float expo = e == 3 ? (p < peak ? pow(p / peak, 3.) : p < peak + .05 ? 1. : pow(1. - (p - peak - .05) / (1. - peak - .05), 2.)) : exp(-pow((p - .5) / .1, 2.));
    expo *= (e == 3 ? max(uIntensity, .05) : 1.);
    vec3 base = p < peak + .025 ? SA(uv) : SB(uv);
    vec3 bloom = vec3(0.); for (int i = 0; i < 8; i++){ float an = float(i) * PI * .25; vec2 o = vec2(cos(an), sin(an)) * .03 * vec2(1. / uAspect, 1.); vec3 s = p < peak + .025 ? SA(uv + o) : SB(uv + o); bloom += s * smoothstep(.4, 1., bright(s)); } bloom /= 8.;
    vec3 c = base * (1. + expo * 5.) + bloom * expo * 3.; return mix(c, vec3(1.), clamp(expo, 0., 1.) * .9); }
  if (e == 4) { float r = uIntensity * .05 * sin(PI * p); return mix(discA(uv, r), discB(uv, r), smoothstep(.4, .6, p)); }
  if (e == 5) { float n = vnoise(uv * mix(8., 80., uGrain) * vec2(uAspect, 1.)); float t = spread(p, f); return mix(SB(uv), SA(uv), smoothstep(t - f, t + f, n)); }
  if (e == 6 || e == 7) { vec2 ax = e == 6 ? vec2(0, 1) : vec2(1, 0); float k = sin(PI * p); float st = 1. + .15 * k;
    vec2 u2 = uCenter + (uv - uCenter) / mix(vec2(1.), e == 6 ? vec2(1., st) : vec2(st, 1.), 1.); float r = uIntensity * .12 * k;
    return mix(lineA(u2, ax, r), lineB(u2, ax, r), smoothstep(.4, .6, p)); }
  if (e == 10 || e == 11) { float big = 1. + .8 * uIntensity, small = .55; float k = smoothstep(.46, .54, p);
    float sa = e == 10 ? mix(1., big, clamp(q / .5, 0., 1.)) : mix(1., small, clamp(q / .5, 0., 1.));
    float sb = e == 10 ? mix(small, 1., clamp((q - .5) / .5, 0., 1.)) : mix(big, 1., clamp((q - .5) / .5, 0., 1.));
    return mix(SA(zoomAt(uv, sa)), SB(zoomAt(uv, sb)), k); }
  if (e == 12 || e == 13) { float m = .3 * uIntensity; float k = smoothstep(.3, .7, p);
    float sa = e == 12 ? 1. + m * q : 1. - m * .5 * q; float sb = e == 12 ? 1. - m * .5 * (1. - q) : 1. + m * (1. - q);
    return mix(SA(zoomAt(uv, sa)), SB(zoomAt(uv, sb)), k); }
  if (e == 14 || e == 16) { float o = e == 14 ? q + uIntensity * .06 * sin(2. * PI * q) * q : bez(p, vec4(.42, 0., .58, 1.));
    vec2 dv = dirv(); vec2 pos = uv - dv * o; float idx = floor(dot(pos, abs(dv))); vec2 w = pos - abs(dv) * idx;
    return idx == 0. ? SA(w) : SB(w); }
  if (e == 15) { vec2 dv = dirv(); vec2 posB = uv + dv * (1. - q);
    if (posB.x >= 0. && posB.x <= 1. && posB.y >= 0. && posB.y <= 1.) return SB(posB);
    float d = max(max(-posB.x, posB.x - 1.), max(-posB.y, posB.y - 1.));
    return SA(uv) * mix(1., .85, q) * (1. - .35 * q * exp(-d * 22.)); }
  if (e == 17) { float ang = PI * mix(.6, 1.2, uIntensity) * (uDir == 1 ? -1. : 1.); float k = smoothstep(.46, .54, p);
    float sa = 1. + .3 * clamp(q / .5, 0., 1.), sb = 1. + .3 * clamp(1. - (q - .5) / .5, 0., 1.);
    vec3 ca = SA(rotAt(uv, ang * clamp(q / .5, 0., 1.), sa)); vec3 cb = SB(rotAt(uv, -ang * (1. - clamp((q - .5) / .5, 0., 1.)), sb));
    return mix(ca, cb, k); }
  if (e == 18) { float env = pow(sin(PI * p), 2.) * uIntensity * .07; float tt = p * 26.;
    vec2 off = vec2(noise1(tt), noise1(tt + 17.3)) * env; float rot = noise1(tt + 41.7) * env * 1.2;
    vec2 u2 = rotAt(uv + off, rot, 1. + env); return mix(SA(u2), SB(u2), smoothstep(.47, .53, p)); }
  if (e == 20) { vec2 dv = dirv(); float s = dv.x < 0. ? 1. - uv.x : dv.x > 0. ? uv.x : dv.y < 0. ? 1. - uv.y : uv.y; return mix(SA(uv), SB(uv), edge(s, spread(q, f), f)); }
  if (e == 21) { float an = radians(uAngle); vec2 d = vec2(cos(an), sin(an)); vec2 c = (uv - .5) * vec2(uAspect, 1.);
    float L = abs(d.x) * uAspect + abs(d.y); float s = .5 + dot(c, d) / L; return mix(SA(uv), SB(uv), edge(s, spread(q, f), f)); }
  if (e == 22 || e == 23) { vec2 c = (uv - uCenter) * vec2(uAspect, 1.); float dist = length(c);
    float far = length(max(abs(uCenter), abs(1. - uCenter)) * vec2(uAspect, 1.)); float fr = f * 2.;
    if (e == 22) { float R = mix(-2. * fr, far + 2. * fr, q); return mix(SA(uv), SB(uv), 1. - smoothstep(R - fr, R + fr, dist)); }
    float R = mix(far + 2. * fr, -2. * fr, q); return mix(SB(uv), SA(uv), 1. - smoothstep(R - fr, R + fr, dist)); }
  if (e == 24) { vec2 c = (uv - .5) * vec2(uAspect, 1.); float an = atan(c.x, -c.y) / (2. * PI); an = fract(an + 1.); if (uDir == 1) an = 1. - an;
    return mix(SA(uv), SB(uv), edge(an, spread(q, f), f)); }
  if (e == 25 || e == 26) { float x = e == 25 ? uv.x : uv.y; vec2 ax = e == 25 ? vec2(1, 0) : vec2(0, 1); float o = q * .5;
    if (x < .5) { float sx = x + o; if (sx < .5) return SA(uv + ax * o) * (1. - .3 * exp(-(.5 - sx) * 40.) * q); }
    else { float sx = x - o; if (sx >= .5) return SA(uv - ax * o) * (1. - .3 * exp(-(sx - .5) * 40.) * q); }
    return SB(uv) * mix(.8, 1., q); }
  if (e == 27) { float n = float(max(uStrips, 1)); float i = floor(uv.y * n); float stag = .5;
    float lq = clamp((p * (1. + stag) - i / n * stag), 0., 1.); lq = ease(lq);
    return mix(SA(uv), SB(uv), edge(uv.x, spread(lq, f), f)); }
  if (e >= 28 && e <= 31) { vec2 c = (uv - uCenter) * vec2(uAspect, 1.); float sc = max(q, 1e-3) * (e == 28 ? 2.5 : e == 29 ? 3.0 : e == 30 ? 1.12 : 1.7) * max(uAspect, 1.); float dsd;
    if (e == 28) dsd = sdHeart(vec2(c.x, -c.y + .5 * sc) / max(sc, 1e-3)) * sc;
    else if (e == 29) dsd = sdStar(c / max(sc, 1e-3), .5, .45) * sc;
    else if (e == 30) { vec2 b = abs(c) - vec2(uAspect, 1.) * .5 * sc; dsd = length(max(b, 0.)) + min(max(b.x, b.y), 0.); }
    else { vec2 pp = abs(c) / max(sc, 1e-3); dsd = (pp.x + pp.y - .5) * .7071 * sc; }
    float m = (1. - smoothstep(-f, f, dsd)) * smoothstep(0., .04, p);
    m = mix(m, 1., smoothstep(.96, 1., p)); return mix(SA(uv), SB(uv), m); }
  if (e == 40) return cube(uv, p);
  if (e == 41) return flip(uv, p, false);
  if (e == 42) return flip(uv, p, true);
  if (e == 43) return fold(uv, p);
  if (e == 44) return pageCurl(uv, p);
  if (e == 50) { float b = mix(1., max(2., uIntensity * uRes.y * .09), sin(PI * p)); vec2 cell = uRes / b; vec2 u2 = (floor(uv * cell) + .5) / cell;
    if (b < 1.01) u2 = uv; return mix(SA(u2), SB(u2), smoothstep(.45, .55, p)); }
  if (e == 51 && uRip.x < .5) { vec2 c = (uv - uCenter) * vec2(uAspect, 1.); float dist = length(c); float env = uIntensity * .035 * sin(PI * p);
    float w = sin(dist * 55. - p * 22.); vec2 u2 = uv + normalize(c + 1e-5) / vec2(uAspect, 1.) * w * env;
    vec3 col = mix(SA(u2), SB(u2), smoothstep(.4, .6, p)); return col + vec3(max(w, 0.) * env * 4.); }
  if (e == 51) return rippleWaves(uv, p);
  if (e == 52) { float st = floor(p * 10.) / 10.; float env = uIntensity * pow(sin(PI * p), 1.5); float slice = floor(uv.y * 24.);
    float h = hash(slice + st * 31.); float off = h > .55 ? (hash(slice * 3.1 + st * 7.) - .5) * env * .25 : 0.; vec2 u2 = uv + vec2(off, 0.); float sp = env * .02;
    bool useB = p >= .5; vec3 col = useB ? vec3(SB(u2 + vec2(sp, 0)).r, SB(u2).g, SB(u2 - vec2(sp, 0)).b) : vec3(SA(u2 + vec2(sp, 0)).r, SA(u2).g, SA(u2 - vec2(sp, 0)).b);
    vec3 other = useB ? SA(u2) : SB(u2); return mix(col, other, (1. - smoothstep(0., .04, abs(p - .5))) * .5); }
  if (e == 54) { float k = exp(-pow((p - .5) / .1, 2.)); return mix(p < .5 ? SA(uv) : SB(uv), vec3(0.), k); }
  return mix(SA(uv), SB(uv), p);
}

void main(){
  float p = clamp(uP, 0., 1.);
  // Every transition meets the adjoining source frames exactly, including effects
  // whose geometric formula retains a shadow, lens or strip at its endpoint.
  if (p <= 0.) { outColor = vec4(texture(uA, cover(vUv, uAspA)).rgb, 1.); return; }
  if (p >= 1.) { outColor = vec4(texture(uB, cover(vUv, uAspB)).rgb, 1.); return; }
  vec3 c;
  if (uMotion && uMotionBlur > 0.) {
    /* one output frame of motion, spread over the taps; closed at the ends */
    float shutter = uMotionBlur * 1.8 * uDp * sin(PI * p);
    vec3 acc = vec3(0.); float wsum = 0.;
    for (int j = 0; j < 32; j++) {
      if (j >= uTaps) break;
      float k = float(j) / float(uTaps - 1) - .5; float w = 1. - abs(k) * 1.2;
      acc += frameAt(vUv, clamp(p + k * shutter, 0., 1.)) * w; wsum += w;
    }
    c = acc / wsum;
  } else c = frameAt(vUv, p);
  outColor = vec4(srgb(c), 1.);
}`;

const EASE = { smooth: 0, easeInOut: 1, easeIn: 2, easeOut: 3, linear: 4, snappy: 5, overshoot: 6 };
const DIR = { left: 0, right: 1, up: 2, down: 3, cw: 0, ccw: 1, in: 0, out: 1 };
const hex = (c = '#000000') => { const n = parseInt(String(c).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const aspectOf = (src) => { const w = src.videoWidth || src.naturalWidth || src.width || 1, h = src.videoHeight || src.naturalHeight || src.height || 1; return w / h; };

/**
 * A speed graph: progress (0..1) over time (0..1) through its points [[x, y], …] (x increasing; (0,0) and (1,1) are
 * its ends), monotone cubic between them (Fritsch–Carlson), so it never overshoots: a flat stretch holds the motion
 * still, a steep one runs it fast. Shared by the page that draws a transition and the graph that edits it.
 */
export function curveAt(points, x) {
  const pts = [...points].map(([a, b]) => [Math.min(1, Math.max(0, +a)), Math.min(1, Math.max(0, +b))]).sort((m, n) => m[0] - n[0]);
  if (pts[0][0] > 0) pts.unshift([0, 0]);
  if (pts[pts.length - 1][0] < 1) pts.push([1, 1]);
  const n = pts.length;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { const h = pts[i + 1][0] - pts[i][0]; d.push(h > 1e-9 ? (pts[i + 1][1] - pts[i][1]) / h : 0); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], r = a * a + b * b;
    if (r > 9) { const t = 3 / Math.sqrt(r); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let i = 0; while (i < n - 2 && x > pts[i + 1][0]) i++;
  const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = x1 - x0;
  if (h < 1e-9) return y1;
  const t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
}

export class TransitionRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('Transitions need WebGL2, which this browser does not have.');
    this.gl = gl; this.canvas = canvas;
    this.programs=new Map();
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.tex = [0, 1].map((unit) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255])); return t; });
  }
  useEffect(code){
    const gl=this.gl,cached=this.programs.get(code);if(cached){this.prog=cached.prog;this.u=cached.u;gl.useProgram(cached.prog);return;}
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG.replace('uniform int uEffect,',`const int uEffect=${code}; uniform int`))); gl.bindAttribLocation(prog,0,'aPos'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog; gl.useProgram(prog);
    this.u = {};
    for (const name of ['uA', 'uB', 'uEffect', 'uEase', 'uDir', 'uStrips', 'uTaps', 'uP', 'uIntensity', 'uMotionBlur', 'uFeather', 'uHold', 'uAngle', 'uGrain', 'uSeed', 'uAspect', 'uAspA', 'uAspB', 'uDp', 'uColor', 'uColor2', 'uCenter', 'uRes', 'uLinear', 'uMotion',
      'uAmount', 'uBalance', 'uSplit', 'uMatch', 'uShadow', 'uGlow', 'uScale', 'uIn', 'uOut', 'uRip', 'uRip2', 'uRip3', 'uRipM', 'uRipO', 'uRipVP', 'uMatte', 'uMatteRect', 'uMatteOn']) this.u[name] = gl.getUniformLocation(prog, name);
    gl.uniform1i(this.u.uA, 0); gl.uniform1i(this.u.uB, 1); gl.uniform1i(this.u.uMatte, 2);
    this.programs.set(code,{prog:this.prog,u:this.u});if(this.programs.size>12){const first=this.programs.keys().next().value;gl.deleteProgram(this.programs.get(first).prog);this.programs.delete(first);}
  }

  /** Draw transition `id` between A and B at progress p (0..1). `fps` and `duration` set one frame of motion blur. */
  render(srcA, srcB, p, params = {}) {
    const gl = this.gl, def = transitionById(params.id) ?? transitionById('classic.mix'), o = { ...def.defaults, ...params };
    this.useEffect(def.code);
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    [srcA, srcB].forEach((src, i) => { if (!src) return; gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.tex[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); });
    const u = this.u, fps = o.fps || 40, dur = Math.max(.05, o.duration || def.defaultDuration);
    gl.uniform1i(u.uEffect, def.code); gl.uniform1i(u.uEase, Array.isArray(o.curve) && o.curve.length > 1 ? EASE.linear : EASE[o.easing] ?? 0); gl.uniform1i(u.uDir, DIR[o.direction] ?? 0);
    gl.uniform1i(u.uStrips, def.styles ? Math.max(1, def.styles.indexOf(o.pierce) + 1) : Math.round(o.strips || 8)); gl.uniform1i(u.uTaps, o.taps || 16);
    gl.uniform1f(u.uP, p); gl.uniform1f(u.uIntensity, o.intensity); gl.uniform1f(u.uMotionBlur, def.motion ? o.motionBlur : 0);
    gl.uniform1f(u.uFeather, o.feather); gl.uniform1f(u.uHold, o.hold); gl.uniform1f(u.uAngle, o.angle); gl.uniform1f(u.uGrain, o.grain);
    gl.uniform1f(u.uSeed, (o.seed ?? 1) % 997); gl.uniform1f(u.uAspect, w / h);
    gl.uniform1f(u.uAspA, srcA ? aspectOf(srcA) : w / h); gl.uniform1f(u.uAspB, srcB ? aspectOf(srcB) : w / h);
    gl.uniform1f(u.uDp, 1 / (fps * dur)); gl.uniform3fv(u.uColor, hex(o.color)); gl.uniform2fv(u.uCenter, o.center || [0.5, 0.5]);
    gl.uniform2f(u.uRes, w, h); gl.uniform1i(u.uLinear, o.linear === false ? 0 : 1); gl.uniform1i(u.uMotion, def.motion ? 1 : 0);
    gl.uniform1f(u.uAmount, o.amount ?? 1); gl.uniform1f(u.uBalance, o.balance ?? 0); gl.uniform1f(u.uSplit, o.split ?? 0.5);
    gl.uniform1f(u.uMatch, o.match ?? 0); gl.uniform1f(u.uShadow, o.shadow ?? 0); gl.uniform1f(u.uGlow, o.glow ?? 0);
    gl.uniform3fv(u.uColor2, hex(o.color2 ?? o.color)); gl.uniform1f(u.uScale, o.scale ?? 2); gl.uniform1f(u.uIn, o.zoomIn ?? 0.35); gl.uniform1f(u.uOut, o.zoomOut ?? 0.35);
    if (def.code === 51) this.ripple(o, w / h, srcA ? aspectOf(srcA) : w / h, params);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The ripple's own settings and, when the clip was scanned, this frame's geometry and people matte (ripple-env.js). */
  ripple(o, stageAspect, sourceAspect, saved = {}) {
    const gl = this.gl, u = this.u, num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    /* a ripple saved before the NameDrop preset existed (its settings stored, but no style among them) keeps the classic
       wave it was made with; a new one, or one with a style, draws that style */
    const classic = (saved.rippleStyle ?? ('intensity' in saved ? 'classic' : o.rippleStyle)) === 'classic';
    const geo = o.rippleGeometry ?? null, placement = o.placement ?? 'scene';
    /* the start point, as the source pixel under it (the picture covers the stage) */
    const r = stageAspect / sourceAspect, sc = r > 1 ? [1, 1 / r] : [r, 1], c = o.center ?? [0.5, 0.5];
    const screenOrigin = [(c[0] - 0.5) * sc[0] + 0.5, (c[1] - 0.5) * sc[1] + 0.5];
    const mode = placement === 'screen' || !geo ? 0 : geo.mode;
    gl.uniform4f(u.uRip, classic ? 0 : 1, Math.round(num(o.waves, 5)), num(o.thickness, 0.045), num(o.refraction, 0.6));
    gl.uniform4f(u.uRip2, num(o.buildUp, 0.18), num(o.dissipate, 0.25), num(o.reach, 0.9), num(o.impact, 0.7));
    gl.uniform4f(u.uRip3, mode, num(o.interference, 0.5), num(o.softness, 0.5), num(o.highlight, 0.5));
    gl.uniformMatrix3fv(u.uRipM, true, mode ? geo.M : [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    gl.uniform2fv(u.uRipO, mode ? geo.origin : screenOrigin);
    gl.uniform2fv(u.uRipVP, mode ? geo.vp : screenOrigin);
    const matte = placement === 'scene' && geo?.matte?.image ? geo.matte : null;
    gl.uniform1i(u.uMatteOn, matte ? 1 : 0);
    if (matte) {
      if (!this.matteTex) { this.matteTex = gl.createTexture(); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.matteTex); for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, k, v); }
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.matteTex);
      /* an atlas holds many frames: uploaded once, then only the sub-rectangle changes */
      if (this.matteImage !== matte.image) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, matte.image); this.matteImage = matte.image; }
      gl.uniform4fv(u.uMatteRect, matte.rect);
    }
  }
}
