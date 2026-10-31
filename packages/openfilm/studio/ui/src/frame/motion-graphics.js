/* Shorts motion graphics: one registry and one renderer for every graphic, shared by the panel's previews and the
   pages on the timeline (mg-runtime.js), so what is previewed is what is exported.

   A graphic is a pure function of time: draw(g, t) paints frame t of a graphic `duration` seconds long. Its timing
   is written in shares of its length (phase(0.1, 0.3) is "from 10% to 30% of the way through"), so a longer graphic
   plays the same animation more slowly, with the same proportions and easing. Everything it shows is in its params
   (text, numbers, places, colours, media): nothing is baked into a picture. Map graphics draw Natural Earth's country
   outlines (public domain) themselves: no tile server, no third-party imagery. */

/* ------------------------------------------------------------------ easing and timing */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
function bezier(x1, y1, x2, y2, x) {
  const B = (a, b, t) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (B(x1, x2, m) < x) lo = m; else hi = m; }
  return B(y1, y2, (lo + hi) / 2);
}
export const EASE = {
  linear: (x) => clamp(x),
  smooth: (x) => bezier(0.4, 0, 0.2, 1, clamp(x)),
  in: (x) => bezier(0.55, 0, 1, 0.45, clamp(x)),
  out: (x) => bezier(0, 0.55, 0.45, 1, clamp(x)),
  inOut: (x) => bezier(0.65, 0, 0.35, 1, clamp(x)),
  /* a settle with a whisper of overshoot, for pops that should feel physical (≈3%) */
  settle: (x) => { x = clamp(x); return 1 - Math.pow(1 - x, 3) * Math.cos(x * Math.PI * 0.55) ; },
};
export const SPEEDS = { Smooth: 'smooth', Gentle: 'inOut', Snappy: 'out', Linear: 'linear' };
/** Progress of a stage running from share a to share b of the graphic (0 before, 1 after). */
const phase = (u, a, b) => clamp((u - a) / Math.max(1e-6, b - a));

/* ------------------------------------------------------------------ colour */
function rgb(hex) { const h = String(hex || '#000').replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0'); const n = parseInt(f.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const rgba = (hex, a = 1) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const mixHex = (a, b, k) => { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], k))).join(',')})`; };
const THEMES = {
  light: { bg: '#f6f7f9', card: '#ffffff', text: '#0f1115', sub: '#5f6672', line: 'rgba(15,17,21,0.10)', shadow: 'rgba(15,17,21,0.16)' },
  dark: { bg: '#0d0f14', card: '#171a21', text: '#f3f5f8', sub: '#9aa3b2', line: 'rgba(255,255,255,0.10)', shadow: 'rgba(0,0,0,0.5)' },
};
const theme = (P) => THEMES[P.theme === 'dark' ? 'dark' : 'light'];

/* ------------------------------------------------------------------ drawing helpers */
function rr(g, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function shadowed(g, color, blur, oy, fn) { g.save(); g.shadowColor = color; g.shadowBlur = blur; g.shadowOffsetY = oy; fn(); g.restore(); }
function font(g, size, weight = 600, family) { g.font = `${weight} ${Math.max(1, size)}px ${family || 'Inter, "SF Pro Display", system-ui, sans-serif'}`; }
function textLines(g, text, maxW) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (g.measureText(next).width > maxW && line) { out.push(line); line = word; } else line = next; }
    out.push(line);
  }
  return out;
}
/** Media drawn to cover (or contain) a box, rounded. */
function drawMedia(g, el, x, y, w, h, r = 0, fit = 'cover') {
  if (!el) { g.save(); rr(g, x, y, w, h, r); g.fillStyle = 'rgba(127,127,127,0.18)'; g.fill(); g.restore(); return; }
  const iw = el.videoWidth || el.naturalWidth || el.width || 1, ih = el.videoHeight || el.naturalHeight || el.height || 1;
  const s = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.save(); rr(g, x, y, w, h, r); g.clip();
  try { g.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch { /* not decoded yet */ }
  g.restore();
}
function seeded(seed) { let s = (seed * 9301 + 49297) % 233280 || 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
const fmtNumber = (v, P) => {
  const dec = clamp(Math.round(P.decimals ?? 0), 0, 4);
  let s = Number(v).toFixed(dec);
  if (P.separator !== false) { const [i, f] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : ''); }
  return `${P.prefix ?? ''}${s}${P.suffix ?? ''}`;
};

/* ------------------------------------------------------------------ geography */
let worldCache = null;
/** Natural Earth outlines, decoded once: [{ n, iso, c:[lon,lat], rings:[Float32Array lon,lat,…] }]. */
export function decodeWorld(data) {
  if (!data) return null;
  if (worldCache && worldCache.src === data) return worldCache.list;
  const k = 1 / (data.scale || 10);
  const list = data.countries.map((c) => ({ n: c.n, iso: c.iso, c: c.c, rings: c.p.map((ring) => Float32Array.from(ring, (v) => v * k)) }));
  worldCache = { src: data, list };
  return list;
}
const RAD = Math.PI / 180;
const vec = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const latlon = ([x, y, z]) => [Math.atan2(z, Math.hypot(x, y)) / RAD, Math.atan2(y, x) / RAD];
/** The great-circle route through the points, as [lat, lon] with longitudes unwrapped (no jump at ±180°). */
export function greatCircle(points, steps = 96) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = vec(points[i].lat, points[i].lon), b = vec(points[i + 1].lat, points[i + 1].lon);
    const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(dot), so = Math.sin(om) || 1e-9;
    for (let s = 0; s <= steps; s++) {
      if (i > 0 && s === 0) continue;
      const t = s / steps; const ka = om < 1e-6 ? 1 - t : Math.sin((1 - t) * om) / so, kb = om < 1e-6 ? t : Math.sin(t * om) / so;
      out.push(latlon([a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb]));
    }
  }
  for (let i = 1; i < out.length; i++) { while (out[i][1] - out[i - 1][1] > 180) out[i][1] -= 360; while (out[i][1] - out[i - 1][1] < -180) out[i][1] += 360; }
  return out;
}
/** A stylised arc (not a real flight path): a curve bowed away from the straight line by `bend`, in map space. */
function bowed(points, bend, steps = 64) {
  const out = [];
  for (let i = 0; i + 1 < points.length; i++) {
    let a = [points[i].lat, points[i].lon], b = [points[i + 1].lat, points[i + 1].lon];
    while (b[1] - a[1] > 180) b[1] -= 360; while (b[1] - a[1] < -180) b[1] += 360;
    const mx = (a[1] + b[1]) / 2, my = (a[0] + b[0]) / 2, dx = b[1] - a[1], dy = b[0] - a[0];
    const cx = mx - dy * bend, cy = my + dx * bend;
    for (let s = i ? 1 : 0; s <= steps; s++) { const t = s / steps; out.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * cy + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * cx + t * t * b[1]]); }
  }
  for (let i = 1; i < out.length; i++) { while (out[i][1] - out[i - 1][1] > 180) out[i][1] -= 360; while (out[i][1] - out[i - 1][1] < -180) out[i][1] += 360; }
  return out;
}
const mercY = (lat) => -Math.log(Math.tan(Math.PI / 4 + clamp(lat, -84, 84) * RAD / 2)) / RAD;
/** A Mercator camera: centre (lon, mercator y) and degrees per pixel. */
function mercator(cam, w, h) {
  const k = 1 / cam.dpp;
  return { x: (lon) => w / 2 + (lon - cam.lon) * k, y: (lat) => h / 2 + (mercY(lat) - cam.my) * k, k };
}
/** The camera that frames these [lat, lon] points with padding (a share of the frame). */
function frame(points, w, h, pad = 0.18, minSpan = 6) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lat, lon] of points) { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); const y = mercY(lat); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const sx = Math.max(minSpan, x1 - x0), sy = Math.max(minSpan, y1 - y0);
  return { lon: (x0 + x1) / 2, my: (y0 + y1) / 2, dpp: Math.max(sx / (w * (1 - 2 * pad)), sy / (h * (1 - 2 * pad))) };
}
const lerpCam = (a, b, k) => ({ lon: lerp(a.lon, b.lon, k), my: lerp(a.my, b.my, k), dpp: Math.exp(lerp(Math.log(a.dpp), Math.log(b.dpp), k)) });
export const MAP_STYLES = {
  vivid: { sea: '#9ed3f7', sea2: '#6db8ee', land: '#f6f1e3', border: '#ffffff', grid: 'rgba(255,255,255,0.18)', label: '#10233d', halo: '#ffffff', shade: 'rgba(16,35,61,0.10)' },
  sunset: { sea: '#ffd9c2', sea2: '#ffb4a2', land: '#fff4ea', border: '#ffffff', grid: 'rgba(255,255,255,0.25)', label: '#3d1f2b', halo: '#fff4ea', shade: 'rgba(61,31,43,0.10)' },
  night: { sea: '#0b1430', sea2: '#141f4a', land: '#1f2c5c', border: '#3a4c8f', grid: 'rgba(120,150,255,0.07)', label: '#eef2ff', halo: '#0b1430', shade: 'rgba(0,0,0,0.35)' },
  minimal: { sea: '#eef1f6', land: '#ffffff', border: '#d9dee7', grid: null, label: '#141820', halo: '#ffffff', shade: 'rgba(20,24,32,0.06)' },
  dark: { sea: '#0b0e14', land: '#1b202b', border: '#2a3140', grid: 'rgba(255,255,255,0.04)', label: '#f2f4f8', halo: '#0b0e14', shade: 'rgba(0,0,0,0.4)' },
  atlas: { sea: '#cfe2ea', land: '#f1e8d4', border: '#d8c9a8', grid: 'rgba(60,80,90,0.12)', label: '#2b2418', halo: '#f1e8d4', shade: 'rgba(43,36,24,0.08)' },
  blueprint: { sea: '#1d3b6e', land: '#2a4f8c', border: '#6d8fc9', grid: 'rgba(255,255,255,0.07)', label: '#ffffff', halo: '#1d3b6e', shade: 'rgba(0,0,0,0.25)' },
  mono: { sea: '#f4f4f4', land: '#dcdcdc', border: '#c4c4c4', grid: null, label: '#111111', halo: '#f4f4f4', shade: 'rgba(0,0,0,0.06)' },
};
/* The world as paths in (longitude, Mercator y) space, built once: Mercator is then a plain scale and shift, so a frame
   is one transformed fill and stroke instead of re-projecting every vertex (light enough for many previews at once). */
let flatCache = null;
function flatPaths(world) {
  if (flatCache && flatCache.src === world) return flatCache;
  const all = new Path2D(); const by = new Map();
  for (const c of world) {
    const p = new Path2D();
    for (const r of c.rings) { for (let i = 0; i < r.length; i += 2) { const x = r[i], y = mercY(r[i + 1]); if (i) p.lineTo(x, y); else p.moveTo(x, y); } p.closePath(); }
    all.addPath(p); by.set(c.iso, p); by.set(c.n, p);
  }
  flatCache = { src: world, all, by };
  return flatCache;
}
/** Draws the world flat (Mercator) through the cached paths, one copy per visible repeat of the world. */
function drawFlatWorld(g, world, cam, w, h, style, highlight) {
  const m = mercator(cam, w, h);
  if (style.sea2) { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, style.sea); grd.addColorStop(1, style.sea2); g.fillStyle = grd; } else g.fillStyle = style.sea;
  g.fillRect(0, 0, w, h);
  if (style.grid) {
    g.strokeStyle = style.grid; g.lineWidth = 1;
    for (let lon = -180 * 3; lon <= 180 * 3; lon += 15) { const x = m.x(lon); if (x < -2 || x > w + 2) continue; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let lat = -75; lat <= 75; lat += 15) { const y = m.y(lat); if (y < -2 || y > h + 2) continue; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }
  if (!world || typeof Path2D === 'undefined') return m;
  const P = flatPaths(world); const k = m.k;
  const span = w * cam.dpp; const copies = [-360, 0, 360].filter((o) => Math.abs(cam.lon - o) < 180 + span);
  const lw = Math.max(0.6, Math.min(1.8, 0.9 / Math.sqrt(cam.dpp * 4)));
  for (const off of copies) {
    g.save();
    g.transform(k, 0, 0, k, w / 2 + (off - cam.lon) * k, h / 2 - cam.my * k);
    /* a soft drop shadow under the land gives the map depth */
    if (style.shade) { g.save(); g.translate(0, 2.2 / k); g.fillStyle = style.shade; g.fill(P.all); g.restore(); }
    g.fillStyle = style.land; g.fill(P.all);
    if (highlight) { g.fillStyle = highlight.color; for (const key of highlight) { const p = P.by.get(key); if (p) g.fill(p); } }
    g.lineJoin = 'round'; g.lineWidth = lw / k; g.strokeStyle = style.border; g.stroke(P.all);
    g.restore();
  }
  return m;
}
/** Draws the world as a globe (orthographic), centred on (lat0, lon0), radius R, lit from `sun`. */
function drawGlobe(g, world, w, h, cx, cy, R, lat0, lon0, o) {
  const s0 = Math.sin(lat0 * RAD), c0 = Math.cos(lat0 * RAD);
  const proj = (lon, lat) => {
    const dl = (lon - lon0) * RAD, cl = Math.cos(lat * RAD), sl = Math.sin(lat * RAD);
    const cosc = s0 * sl + c0 * cl * Math.cos(dl);
    return [cx + R * cl * Math.sin(dl), cy - R * (c0 * sl - s0 * cl * Math.cos(dl)), cosc];
  };
  /* space and atmosphere */
  if (o.atmosphere > 0) {
    const grd = g.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * (1.06 + 0.1 * o.atmosphere));
    grd.addColorStop(0, rgba(o.glow, 0.55 * o.atmosphere)); grd.addColorStop(1, rgba(o.glow, 0));
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * (1.06 + 0.1 * o.atmosphere), 0, Math.PI * 2); g.fill();
  }
  const sea = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  sea.addColorStop(0, o.seaHi); sea.addColorStop(1, o.sea);
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = sea; g.fill(); g.clip();
  if (world) {
    g.fillStyle = o.land; g.strokeStyle = o.border; g.lineWidth = Math.max(0.5, Math.min(1.4, R / 500)); g.lineJoin = 'round';
    for (const c of world) {
      /* a country entirely on the far side is skipped (its label point is a good enough test with a margin) */
      const [, , vis] = proj(c.c[0], c.c[1]); if (vis < -0.35) continue;
      g.beginPath();
      for (const r of c.rings) {
        let open = false;
        for (let i = 0; i < r.length; i += 2) {
          const [x, y, v] = proj(r[i], r[i + 1]);
          if (v < 0) { open = false; continue; }
          if (!open) { g.moveTo(x, y); open = true; } else g.lineTo(x, y);
        }
        g.closePath();
      }
      g.fill(); g.stroke();
    }
  }
  /* clouds: soft seeded blobs drifting with the globe's turn */
  if (o.clouds > 0) {
    const rnd = seeded(31); g.fillStyle = `rgba(255,255,255,${0.22 * o.clouds})`;
    for (let i = 0; i < 70; i++) {
      const lat = (rnd() - 0.5) * 140, lon = rnd() * 360 - 180 + o.drift; const [x, y, v] = proj(lon, lat); if (v < 0.05) continue;
      const rad = R * (0.03 + rnd() * 0.07) * Math.sqrt(v); g.beginPath(); g.ellipse(x, y, rad * 1.8, rad, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  /* day and night: a soft terminator from the light direction */
  if (o.night > 0) {
    const ang = o.sun * RAD; const lx = Math.cos(ang), ly = Math.sin(ang);
    const sh = g.createLinearGradient(cx + lx * R, cy + ly * R, cx - lx * R, cy - ly * R);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(0.72, `rgba(2,6,18,${0.55 * o.night})`); sh.addColorStop(1, `rgba(2,6,18,${0.85 * o.night})`);
    g.fillStyle = sh; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  const rim = g.createRadialGradient(cx, cy, R * 0.75, cx, cy, R);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,0.28)'); g.fillStyle = rim; g.fillRect(cx - R, cy - R, R * 2, R * 2);
  g.restore();
  return proj;
}
function stars(g, w, h, seed, a = 1) { const rnd = seeded(seed); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${(0.25 + rnd() * 0.6) * a})`; const s = rnd() < 0.08 ? 1.6 : 0.9; g.fillRect(rnd() * w, rnd() * h, s, s); } }
function pin(g, x, y, s, color, k = 1) {
  g.save(); g.translate(x, y); g.scale(k, k);
  shadowed(g, 'rgba(0,0,0,0.3)', 8 * s, 3 * s, () => { g.beginPath(); g.arc(0, -16 * s, 9 * s, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(0, 0); g.closePath(); g.fillStyle = color; g.fill(); });
  g.beginPath(); g.arc(0, -16 * s, 3.6 * s, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.restore();
}
/** A map pin that drops in from above and settles (drop 0→1), with its shadow growing on the ground. */
function droppedPin(g, x, y, s, color, drop) {
  if (drop <= 0) return;
  const fall = 1 - EASE.out(clamp(drop / 0.7)); const squash = drop > 0.7 ? Math.sin(clamp((drop - 0.7) / 0.3) * Math.PI) * 0.12 : 0;
  g.save(); g.globalAlpha = clamp(drop * 3);
  g.beginPath(); g.ellipse(x, y + 1.5 * s, 7 * s * (0.5 + 0.5 * (1 - fall)), 2.6 * s * (0.5 + 0.5 * (1 - fall)), 0, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fill();
  g.translate(x, y - fall * 60 * s); g.scale(1 + squash, 1 - squash);
  const grd = g.createLinearGradient(0, -26 * s, 0, 0); grd.addColorStop(0, mixHex(color, '#ffffff', 0.25)); grd.addColorStop(1, color);
  shadowed(g, 'rgba(0,0,0,0.28)', 10 * s, 4 * s, () => { g.beginPath(); g.arc(0, -17 * s, 10 * s, Math.PI * 0.82, Math.PI * 0.18); g.quadraticCurveTo(4 * s, -6 * s, 0, 0); g.quadraticCurveTo(-4 * s, -6 * s, -10 * s * Math.cos(Math.PI * 0.18), -17 * s + 10 * s * Math.sin(Math.PI * 0.82)); g.closePath(); g.fillStyle = grd; g.fill(); });
  g.beginPath(); g.arc(0, -17 * s, 4 * s, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.restore();
}
function ripple(g, x, y, s, color, k) { if (k <= 0 || k >= 1) return; for (const d of [0, 0.25]) { const kk = clamp((k - d) / (1 - d)); if (kk <= 0) continue; g.beginPath(); g.ellipse(x, y, (6 + 34 * kk) * s, (2.4 + 13 * kk) * s, 0, 0, Math.PI * 2); g.strokeStyle = rgba(color, 0.55 * (1 - kk)); g.lineWidth = 2.2 * s; g.stroke(); } }
function dot(g, x, y, s, color, pulse = 0) {
  if (pulse > 0) { g.beginPath(); g.arc(x, y, s * (1.6 + 2.2 * pulse), 0, Math.PI * 2); g.fillStyle = rgba(color, 0.35 * (1 - pulse)); g.fill(); }
  g.beginPath(); g.arc(x, y, s * 1.35, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
  g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fillStyle = color; g.fill();
}
function label(g, text, x, y, size, color, halo, align = 'left', weight = 650) {
  font(g, size, weight); g.textAlign = align; g.textBaseline = 'middle';
  g.lineWidth = size * 0.32; g.strokeStyle = halo; g.lineJoin = 'round'; g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
}
/** A place's name on a white card with a coloured dot and its country beneath: pops up from its anchor (k 0→1). */
function placeCard(g, x, y, unit, name, sub, color, k, above = true, dark = false) {
  if (k <= 0) return;
  font(g, 30 * unit, 750); const tw = g.measureText(name).width; font(g, 20 * unit, 550); const sw = sub ? g.measureText(sub).width : 0;
  const w = Math.max(tw, sw) + 64 * unit, h = (sub ? 78 : 56) * unit; const bx = x - w / 2, by = above ? y - h - 46 * unit : y + 20 * unit;
  const e = EASE.settle(k);
  g.save(); g.globalAlpha = clamp(k * 2); g.translate(x, above ? y - 40 * unit : y + 20 * unit); g.scale(0.85 + 0.15 * e, 0.85 + 0.15 * e); g.translate(-x, -(above ? y - 40 * unit : y + 20 * unit)); g.translate(0, (1 - e) * 10 * unit);
  shadowed(g, 'rgba(10,20,40,0.22)', 24 * unit, 8 * unit, () => { rr(g, bx, by, w, h, h / 2.4); g.fillStyle = dark ? 'rgba(18,24,44,0.95)' : '#ffffff'; g.fill(); });
  g.beginPath(); g.arc(bx + 26 * unit, by + h / 2, 7 * unit, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.textAlign = 'left'; g.textBaseline = 'middle'; font(g, 30 * unit, 750); g.fillStyle = dark ? '#ffffff' : '#10233d'; g.fillText(name, bx + 44 * unit, by + (sub ? 28 * unit : h / 2));
  if (sub) { font(g, 20 * unit, 550); g.fillStyle = dark ? 'rgba(255,255,255,0.65)' : '#5b6b82'; g.fillText(sub, bx + 44 * unit, by + 56 * unit); }
  g.restore();
}
/* vehicles, drawn nose to the right (rotated to the route's heading) */
const VEHICLES = {
  airplane(g, s, c) {
    const body = g.createLinearGradient(0, -4 * s, 0, 4 * s); body.addColorStop(0, '#ffffff'); body.addColorStop(1, mixHex(c, '#ffffff', 0.55));
    g.fillStyle = c; /* wings and tail in the accent */
    g.beginPath(); g.moveTo(4 * s, -2.5 * s); g.lineTo(-7 * s, -22 * s); g.lineTo(-11.5 * s, -22 * s); g.lineTo(-5 * s, -2.5 * s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(4 * s, 2.5 * s); g.lineTo(-7 * s, 22 * s); g.lineTo(-11.5 * s, 22 * s); g.lineTo(-5 * s, 2.5 * s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-15 * s, -2.5 * s); g.lineTo(-21 * s, -10 * s); g.lineTo(-24 * s, -10 * s); g.lineTo(-20 * s, -1 * s); g.lineTo(-20 * s, 1 * s); g.lineTo(-24 * s, 10 * s); g.lineTo(-21 * s, 10 * s); g.lineTo(-15 * s, 2.5 * s); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(22 * s, 0); g.quadraticCurveTo(22 * s, 3.4 * s, 16 * s, 3.4 * s); g.lineTo(-20 * s, 3 * s); g.lineTo(-20 * s, -3 * s); g.lineTo(16 * s, -3.4 * s); g.quadraticCurveTo(22 * s, -3.4 * s, 22 * s, 0); g.closePath(); g.fillStyle = body; g.fill();
    g.fillStyle = rgba('#10233d', 0.55); g.beginPath(); g.ellipse(15 * s, 0, 2.6 * s, 1.8 * s, 0, 0, Math.PI * 2); g.fill();
  },
  jet(g, s, c) { g.beginPath(); g.moveTo(22 * s, 0); g.lineTo(-6 * s, -16 * s); g.lineTo(-10 * s, -16 * s); g.lineTo(-4 * s, -3 * s); g.lineTo(-18 * s, -3 * s); g.lineTo(-22 * s, -9 * s); g.lineTo(-24 * s, -9 * s); g.lineTo(-21 * s, 0); g.lineTo(-24 * s, 9 * s); g.lineTo(-22 * s, 9 * s); g.lineTo(-18 * s, 3 * s); g.lineTo(-4 * s, 3 * s); g.lineTo(-10 * s, 16 * s); g.lineTo(-6 * s, 16 * s); g.closePath(); g.fillStyle = c; g.fill(); },
  paper(g, s, c) { g.beginPath(); g.moveTo(20 * s, 0); g.lineTo(-16 * s, -13 * s); g.lineTo(-8 * s, 0); g.lineTo(-16 * s, 13 * s); g.closePath(); g.fillStyle = c; g.fill(); g.beginPath(); g.moveTo(20 * s, 0); g.lineTo(-8 * s, 0); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1.2 * s; g.stroke(); },
  smallplane(g, s, c) { g.fillStyle = c; rr(g, -16 * s, -3 * s, 34 * s, 6 * s, 3 * s); g.fill(); rr(g, -2 * s, -18 * s, 7 * s, 36 * s, 2 * s); g.fill(); rr(g, -16 * s, -7 * s, 4 * s, 14 * s, 1.5 * s); g.fill(); },
  car(g, s, c) {
    /* top-down: tyres, a glossy body in the accent, glass, headlight glow */
    g.fillStyle = '#1b1f27'; for (const [x, y] of [[9, -9.5], [9, 9.5], [-10, -9.5], [-10, 9.5]]) { rr(g, (x - 4) * s, (y - 2.2) * s, 8 * s, 4.4 * s, 1.6 * s); g.fill(); }
    const body = g.createLinearGradient(0, -9 * s, 0, 9 * s); body.addColorStop(0, mixHex(c, '#ffffff', 0.35)); body.addColorStop(0.5, c); body.addColorStop(1, mixHex(c, '#000000', 0.2));
    rr(g, -18 * s, -8.5 * s, 37 * s, 17 * s, 6.5 * s); g.fillStyle = body; g.fill();
    g.fillStyle = 'rgba(16,30,60,0.75)'; rr(g, 3 * s, -6 * s, 8 * s, 12 * s, 2.5 * s); g.fill(); rr(g, -12 * s, -5.5 * s, 6 * s, 11 * s, 2 * s); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; rr(g, -5 * s, -6.5 * s, 7 * s, 13 * s, 2 * s); g.fill();
    const glow = g.createRadialGradient(24 * s, 0, 0, 24 * s, 0, 14 * s); glow.addColorStop(0, 'rgba(255,244,190,0.55)'); glow.addColorStop(1, 'rgba(255,244,190,0)'); g.fillStyle = glow; g.fillRect(16 * s, -14 * s, 22 * s, 28 * s);
    g.fillStyle = '#fff6c8'; rr(g, 17 * s, -7 * s, 2 * s, 3.5 * s, 1 * s); g.fill(); rr(g, 17 * s, 3.5 * s, 2 * s, 3.5 * s, 1 * s); g.fill();
  },
  train(g, s, c) { g.fillStyle = c; rr(g, -20 * s, -7 * s, 40 * s, 14 * s, 6 * s); g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = -12; i <= 8; i += 10) { rr(g, i * s, -4 * s, 6 * s, 8 * s, 1.5 * s); g.fill(); } },
  ship(g, s, c) { g.beginPath(); g.moveTo(20 * s, 0); g.lineTo(8 * s, -8 * s); g.lineTo(-18 * s, -8 * s); g.lineTo(-18 * s, 8 * s); g.lineTo(8 * s, 8 * s); g.closePath(); g.fillStyle = c; g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; rr(g, -10 * s, -4 * s, 12 * s, 8 * s, 2 * s); g.fill(); },
  walker(g, s, c) { dot(g, 0, 0, 7 * s, c); },
};
const KM = 6371;
function pathKm(path) { let d = 0; for (let i = 1; i < path.length; i++) { const a = vec(path[i - 1][0], path[i - 1][1]), b = vec(path[i][0], path[i][1]); d += Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)) * KM; } return d; }
/** A road for the car: the bowed route with gentle bends (none at either end), so it reads as driving, not flying. */
function roadPath(points, steps = 140) {
  const base = bowed(points, 0.08, Math.round(steps / Math.max(1, points.length - 1)));
  const n = base.length; if (n < 3) return base;
  const span = Math.hypot(base[n - 1][1] - base[0][1], base[n - 1][0] - base[0][0]) || 1;
  return base.map(([lat, lon], i) => {
    const a = base[Math.max(0, i - 1)], b = base[Math.min(n - 1, i + 1)]; const dx = b[1] - a[1], dy = b[0] - a[0], len = Math.hypot(dx, dy) || 1;
    const t = i / (n - 1); const off = span * 0.035 * Math.sin(t * Math.PI * 7) * Math.sin(t * Math.PI);
    return [lat + (dx / len) * off, lon - (dy / len) * off];
  });
}
/* ------------------------------------------------------------------ the graphics */
const F = (o) => ({ featured: false, sfx: null, about: '', ...o });
const media = (key, label, extra = {}) => ({ key, label, type: 'media', ...extra });
const text = (key, label, extra = {}) => ({ key, label, type: 'text', ...extra });
const num = (key, label, min, max, step, extra = {}) => ({ key, label, type: 'number', min, max, step, ...extra });
const color = (key, label) => ({ key, label, type: 'color' });
const select = (key, label, options) => ({ key, label, type: 'select', options });
const bool = (key, label) => ({ key, label, type: 'bool' });
const place = (key, label) => ({ key, label, type: 'place' });
const places = (key, label) => ({ key, label, type: 'places' });
const list = (key, label, hint) => ({ key, label, type: 'list', hint });
const BRAND = [color('accent', 'Accent'), select('theme', 'Theme', ['light', 'dark']), select('speed', 'Motion', Object.keys(SPEEDS))];

/* A point the route passes: from the destination search ({ name, lat, lon, country }). Never a made-up place. */
const routePoints = (P) => [P.from, ...(Array.isArray(P.stops) ? P.stops : []), P.to].filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));

function flightJourney(g, e) {
  const { w, h, u, P, world, unit } = e; const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  const style = MAP_STYLES[P.mapStyle] ?? MAP_STYLES.vivid; const pts = routePoints(P); const dark = P.mapStyle === 'night' || P.mapStyle === 'dark' || P.mapStyle === 'blueprint';
  if (pts.length < 2) { g.fillStyle = style.sea; g.fillRect(0, 0, w, h); label(g, 'Choose where the journey starts and ends', w / 2, h / 2, 34 * unit, style.label, style.halo, 'center'); return; }
  const isCar = P.vehicle === 'car';
  const path = P.route === 'great' ? greatCircle(pts) : P.route === 'straight' ? bowed(pts, 0) : P.route === 'road' || (isCar && P.route !== 'curved') ? roadPath(pts) : bowed(pts, (P.curve ?? 0.25));
  const seg = [0]; for (let i = 1; i < path.length; i++) { const dx = path[i][1] - path[i - 1][1], dy = mercY(path[i][0]) - mercY(path[i - 1][0]); seg.push(seg[i - 1] + Math.hypot(dx, dy)); }
  const total = seg[seg.length - 1] || 1;
  const at = (k) => { const d = clamp(k) * total; let i = 1; while (i < seg.length - 1 && seg[i] < d) i++; const t = (d - seg[i - 1]) / Math.max(1e-9, seg[i] - seg[i - 1]); return [lerp(path[i - 1][0], path[i][0], t), lerp(path[i - 1][1], path[i][1], t)]; };
  /* timing (shares of the length): pins drop, the journey, arrival, settle */
  const delay = clamp(P.takeoff ?? 0.16, 0.04, 0.4), arrive = clamp(1 - (P.arrival ?? 0.16), delay + 0.2, 0.96);
  const fly = ez(phase(u, delay, arrive));
  const [plat, plon] = at(fly);
  const whole = frame(path, w, h, 0.2);
  const endCam = frame([path[path.length - 1]], w, h, 0.3, 14);
  let cam;
  if (P.camera === 'follow') cam = lerpCam(lerpCam(frame([path[0]], w, h, 0.3, 22), { lon: plon, my: mercY(plat), dpp: whole.dpp * 0.55 }, EASE.inOut(phase(u, 0, delay + 0.05))), endCam, EASE.inOut(phase(u, arrive - 0.02, 1)));
  else if (P.camera === 'cinematic') cam = u < 0.5 ? lerpCam({ ...whole, dpp: whole.dpp * 1.25 }, whole, EASE.inOut(phase(u, 0, 0.35))) : lerpCam(whole, endCam, EASE.inOut(phase(u, arrive - 0.05, 1)) * 0.65);
  else cam = lerpCam({ ...whole, dpp: whole.dpp * 1.1 }, whole, EASE.out(phase(u, 0, 0.35)));
  const highlight = P.highlight ? Object.assign(new Set(pts.map((p) => p.country).filter(Boolean)), { color: mixHex(style.land, P.accent, 0.1) }) : null;
  const m = drawFlatWorld(g, world, cam, w, h, style, highlight);
  const X = (lon) => { let best = m.x(lon), d = Math.abs(best - w / 2); for (const o of [-360, 360]) { const x = m.x(lon + o); if (Math.abs(x - w / 2) < d) { best = x; d = Math.abs(x - w / 2); } } return best; };
  const lw = (P.lineWidth ?? 6) * unit; const c1 = P.routeColor || P.accent, c2 = P.accent2 || mixHex(P.accent, '#397aa9', 0.6);
  const trace = (k0, k1) => { g.beginPath(); const n = Math.max(2, Math.round(path.length * (k1 - k0) * 1.5)); for (let i = 0; i <= n; i++) { const [la, lo] = at(lerp(k0, k1, i / n)); const x = X(lo), y = m.y(la); if (i) g.lineTo(x, y); else g.moveTo(x, y); } };
  const [sx, sy] = [X(path[0][1]), m.y(path[0][0])], [ex, ey] = [X(path[path.length - 1][1]), m.y(path[path.length - 1][0])];
  const grad = () => { const gr = g.createLinearGradient(sx, sy, ex, ey); gr.addColorStop(0, c1); gr.addColorStop(1, c2); return gr; };
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  if (isCar) {
    /* the road ahead, faint; driven road dark with a dashed centre line */
    trace(0, 1); g.strokeStyle = rgba(dark ? '#ffffff' : '#10233d', 0.08); g.lineWidth = lw * 2.4; g.stroke();
    if (fly > 0.001) { trace(0, fly); g.strokeStyle = dark ? '#6b78b0' : '#3b4252'; g.lineWidth = lw * 2.2; g.stroke(); g.strokeStyle = '#ffffff'; g.lineWidth = lw * 0.35; g.setLineDash([lw * 1.4, lw * 1.4]); g.stroke(); g.setLineDash([]); }
  } else {
    trace(0, 1); g.strokeStyle = rgba(c1, 0.18); g.lineWidth = lw; if (P.pattern !== 'solid') g.setLineDash(P.pattern === 'dotted' ? [0.1, lw * 2.2] : [lw * 2.2, lw * 1.8]); g.stroke(); g.setLineDash([]);
    if (fly > 0.001) {
      trace(P.trail === 'fade' ? Math.max(0, fly - 0.35) : 0, fly); g.strokeStyle = grad(); g.lineWidth = lw;
      if (P.trail === 'glow' || dark) { g.shadowColor = rgba(c1, 0.75); g.shadowBlur = lw * 3; }
      if (P.pattern === 'dashed') g.setLineDash([lw * 2.2, lw * 1.8]); else if (P.pattern === 'dotted') g.setLineDash([0.1, lw * 2.2]);
      g.stroke(); g.setLineDash([]); g.shadowBlur = 0;
    }
  }
  g.restore();
  /* pins drop in, the origin ripples as the trip begins, the destination drops when the vehicle arrives */
  const lastIdx = pts.length - 1; const ps = (P.pinSize ?? 1.6) * unit;
  pts.forEach((p, i) => {
    const x = X(p.lon), y = m.y(p.lat);
    const drop = i === 0 ? phase(u, 0.02, delay - 0.01) : i === lastIdx ? phase(u, arrive - 0.07, arrive + 0.05) : phase(fly, i / lastIdx - 0.08, i / lastIdx);
    const col = i === 0 ? c1 : i === lastIdx ? c2 : mixHex(c1, c2, i / lastIdx);
    if (i === 0) ripple(g, x, y, ps, col, phase(u, delay - 0.02, delay + 0.16)); if (i === lastIdx) ripple(g, x, y, ps, col, phase(u, arrive + 0.02, arrive + 0.18));
    if (P.markerStyle === 'dot') { if (drop > 0) dot(g, x, y, 7 * unit * EASE.settle(drop), col); } else droppedPin(g, x, y, ps, col, drop);
    const lk = i === 0 ? phase(u, delay - 0.08, delay + 0.06) : i === lastIdx ? phase(u, arrive, arrive + 0.1) : phase(fly, i / lastIdx - 0.02, i / lastIdx + 0.06);
    if (P.labels !== false) placeCard(g, x, y - (P.markerStyle === 'dot' ? 0 : 22 * ps / unit * unit), unit * (P.labelSize ?? 1), p.label || p.name, P.showCountry === false ? '' : p.country || '', col, lk, y > h * 0.25, dark);
  });
  /* the vehicle: a plane climbs (bigger, its shadow further off) and lands; a car drives with a gentle bob */
  const showV = EASE.out(phase(u, delay - 0.03, delay + 0.03)) * (1 - phase(u, arrive + 0.01, arrive + 0.05));
  if (showV > 0) {
    const [a1, o1] = at(Math.min(1, fly + 0.004)), [a0, o0] = at(Math.max(0, fly - 0.004));
    const ang = Math.atan2(m.y(a1) - m.y(a0), X(o1) - X(o0)) + (P.rotationOffset ?? 0) * RAD;
    const alt = isCar ? 0 : Math.sin(Math.PI * fly); const s = (P.vehicleSize ?? 1.6) * unit * (1 + 0.28 * alt) * (P.camera === 'follow' ? 1.2 : 1);
    const vx = X(plon), vy = m.y(plat) + (isCar ? Math.sin(u * 60) * 0.6 * unit : 0);
    if (!isCar && P.contrail !== false) { g.save(); trace(Math.max(0, fly - 0.08), fly); g.strokeStyle = rgba('#ffffff', 0.55); g.lineWidth = lw * 0.8; g.lineCap = 'round'; g.stroke(); g.restore(); }
    if (!isCar) { g.save(); g.translate(vx + 10 * unit * alt, vy + 22 * unit * alt); g.rotate(ang); g.scale(showV * 0.9, showV * 0.9); g.globalAlpha = 0.16; (VEHICLES[P.vehicle] ?? VEHICLES.airplane)(g, s, '#000000'); g.restore(); }
    g.save(); g.translate(vx, vy); g.rotate(ang); g.scale(showV, showV);
    shadowed(g, 'rgba(0,0,0,0.25)', 8 * unit, 3 * unit, () => (VEHICLES[P.vehicle] ?? VEHICLES.airplane)(g, s, P.vehicleColor || c1));
    g.restore();
  }
  /* trip badge: the vehicle, the route, the distance counting up as it travels */
  if (P.showDistance !== false) {
    const k = EASE.settle(phase(u, delay, delay + 0.12)) * (1 - EASE.in(phase(u, 0.97, 1)));
    if (k > 0) {
      /* real distance between the stops (great circle), not the drawn curve; roads run ~1.2× the straight line */
      const km = Math.round(pathKm(pts.map((p) => [p.lat, p.lon])) * (isCar ? 1.2 : 1)); const shown = Math.round(km * clamp(fly));
      const text = `${pts[0].label || pts[0].name}  →  ${pts[lastIdx].label || pts[lastIdx].name}`; const dist = `${shown.toLocaleString('en')} km`;
      font(g, 26 * unit, 700); const tw = g.measureText(text).width; font(g, 34 * unit, 800); const dw = g.measureText(dist).width;
      const bw = Math.max(tw, dw) + 130 * unit, bh = 108 * unit, bx = (w - bw) / 2, by = h - bh - 70 * unit + (1 - k) * 40 * unit;
      g.save(); g.globalAlpha = clamp(k * 1.5);
      shadowed(g, 'rgba(10,20,40,0.25)', 30 * unit, 10 * unit, () => { rr(g, bx, by, bw, bh, 30 * unit); g.fillStyle = dark ? 'rgba(18,24,44,0.94)' : 'rgba(255,255,255,0.97)'; g.fill(); });
      const ig = g.createLinearGradient(bx, by, bx + 76 * unit, by + bh); ig.addColorStop(0, c1); ig.addColorStop(1, c2);
      rr(g, bx + 18 * unit, by + 18 * unit, 72 * unit, 72 * unit, 22 * unit); g.fillStyle = ig; g.fill();
      g.save(); g.translate(bx + 54 * unit, by + 54 * unit); g.rotate(isCar ? 0 : -0.5); (VEHICLES[P.vehicle] ?? VEHICLES.airplane)(g, unit * 1.05, '#ffffff'); g.restore();
      g.textAlign = 'left'; g.textBaseline = 'middle'; font(g, 34 * unit, 800); g.fillStyle = dark ? '#ffffff' : '#10233d'; g.fillText(dist, bx + 108 * unit, by + 40 * unit);
      font(g, 22 * unit, 600); g.fillStyle = dark ? 'rgba(255,255,255,0.65)' : '#5b6b82'; g.fillText(text, bx + 108 * unit, by + 76 * unit);
      g.restore();
    }
  }
  if (P.title) { g.save(); const k = EASE.out(phase(u, 0.04, 0.18)); g.globalAlpha = k; font(g, 44 * unit, 850); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = style.label; g.lineWidth = 10 * unit; g.strokeStyle = style.halo; g.lineJoin = 'round'; g.strokeText(P.title, w / 2, h * 0.08 + (1 - k) * 12 * unit); g.fillText(P.title, w / 2, h * 0.08 + (1 - k) * 12 * unit); g.restore(); }
  attribution(g, w, h, unit, style.label);
}
function attribution(g, w, h, unit, c) { g.save(); font(g, 13 * unit, 500); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillStyle = rgba(c.startsWith('#') ? c : '#888888', 0.45); g.fillText('Map: Natural Earth', w - 12 * unit, h - 10 * unit); g.restore(); }

function earthZoom(g, e) {
  const { w, h, u, P, world, unit, media: M } = e;
  const to = P.to && Number.isFinite(P.to.lat) ? P.to : null, from = P.from && Number.isFinite(P.from.lat) ? P.from : null;
  g.fillStyle = '#02040a'; g.fillRect(0, 0, w, h);
  if (!to) { label(g, 'Choose a destination', w / 2, h / 2, 34 * unit, '#ffffff', '#02040a', 'center'); return; }
  const mode = P.mode || 'in';
  /* k: 0 = the whole Earth in space, 1 = arrived at the destination (regional scale) */
  const hold = clamp(P.hold ?? 0.15, 0, 0.5);
  let k, lat0, lon0;
  const travel = phase(u, 0.05, 1 - hold);
  const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  if (mode === 'out') { k = 1 - ez(phase(u, hold, 0.95)); lat0 = to.lat; lon0 = to.lon; }
  else if (mode === 'between' && from) {
    /* A, out to the globe, across, and down into B */
    const a = ez(phase(u, 0.02, 0.36)), b = EASE.inOut(phase(u, 0.3, 0.66)), c = ez(phase(u, 0.6, 1 - hold));
    k = u < 0.48 ? 1 - a : c; let dl = to.lon - from.lon; while (dl > 180) dl -= 360; while (dl < -180) dl += 360;
    lat0 = lerp(from.lat, to.lat, b); lon0 = from.lon + dl * b;
  } else {
    /* in: the globe turns toward the destination while it approaches, then dives */
    const turn = EASE.inOut(phase(u, 0, 0.55)); k = ez(phase(travel, 0.25, 1));
    lat0 = lerp(to.lat * 0.35 - 12, to.lat, turn); lon0 = lerp(to.lon - (P.spin ?? 70), to.lon, turn);
  }
  const base = Math.min(w, h) * 0.36;
  /* the radius grows exponentially (an even feeling of speed); regional scale is ~45× the whole-globe size */
  const zoomTo = P.depth ?? 45; const R = base * Math.exp(Math.log(zoomTo) * k);
  const spaceA = clamp(1 - k * 2.5); if (spaceA > 0) stars(g, w, h, 7, spaceA);
  const cx = w / 2, cy = h / 2 + (1 - k) * h * (P.tilt ?? 0.0);
  const proj = drawGlobe(g, world, w, h, cx, cy, R, lat0, lon0, {
    sea: P.sea || '#0f3b6f', seaHi: P.seaHi || '#2a6fb8', land: P.land || '#8fb174', border: P.border || 'rgba(255,255,255,0.35)', glow: P.glow || '#7fc4ff',
    atmosphere: (P.atmosphere ?? 0.8) * clamp(1 - k * 1.3), clouds: (P.clouds ?? 0.5) * clamp(1 - k * 1.1), drift: u * 20, night: P.night ?? 0.35, sun: P.sunAngle ?? -30,
  });
  /* a radial streak at speed, following the real zoom rate */
  const rate = Math.abs(phase(u + 0.01, 0.05, 1) - phase(u - 0.01, 0.05, 1)) * (P.motionBlur ?? 0.6);
  if (rate > 0.001 && k > 0.05 && k < 0.98) { g.save(); g.globalAlpha = Math.min(0.35, rate * 6); g.translate(cx, cy); g.scale(1.03, 1.03); g.translate(-cx, -cy); g.restore(); }
  /* the destination */
  const arrived = EASE.out(phase(u, mode === 'out' ? 0 : 1 - hold - 0.06, mode === 'out' ? hold : 1 - hold + 0.04)) * (mode === 'out' ? 1 - phase(u, hold, hold + 0.1) : 1);
  const [px, py, vis] = proj(to.lon, to.lat);
  if (vis > 0 && arrived > 0) {
    pin(g, px, py, unit * 2.1, P.accent || '#ff4d4f', arrived);
    if (P.labels !== false) { g.save(); g.globalAlpha = arrived; label(g, to.label || to.name, px, py - 62 * unit, 40 * unit, '#ffffff', 'rgba(0,0,0,0.55)', 'center', 750);
      if (to.country && P.showCountry !== false) label(g, to.country, px, py - 28 * unit, 24 * unit, 'rgba(255,255,255,0.85)', 'rgba(0,0,0,0.5)', 'center', 550); g.restore(); }
  }
  /* into your footage: a planned match-cut (a push through the pin into the clip) — not a claim of continuous imagery */
  const clip = M('destination');
  if (clip && mode !== 'out') {
    const kk = EASE.inOut(phase(u, 1 - hold * 0.9, 1)); if (kk > 0) { const s = lerp(0.12, 1, kk); const ww = w * s, hh = h * s;
      g.save(); g.globalAlpha = clamp(kk * 1.6); drawMedia(g, clip, px - ww / 2 + (w / 2 - px) * kk, py - hh / 2 + (h / 2 - py) * kk, ww, hh, (1 - kk) * 40 * unit); g.restore(); }
  } else if (clip && mode === 'out') {
    const kk = 1 - EASE.inOut(phase(u, 0, hold)); if (kk > 0) { const s = lerp(0.12, 1, kk); g.save(); g.globalAlpha = clamp(kk * 1.6); drawMedia(g, clip, w / 2 - w * s / 2, h / 2 - h * s / 2, w * s, h * s, (1 - kk) * 40 * unit); g.restore(); }
  }
  g.save(); font(g, 12 * unit, 500); g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillText('Illustrated globe · Natural Earth', w - 12 * unit, h - 10 * unit); g.restore();
}

function counter(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  if (P.background !== 'none') { g.fillStyle = P.background === 'accent' ? P.accent : T.bg; g.fillRect(0, 0, w, h); }
  const k = ez(phase(u, 0.08, 0.82)); const v = lerp(Number(P.from) || 0, Number(P.to) || 0, k);
  const appear = EASE.out(phase(u, 0, 0.12));
  g.save(); g.globalAlpha = appear; g.translate(0, (1 - appear) * 24 * unit);
  font(g, (P.size ?? 180) * unit, 800); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = P.background === 'accent' ? '#ffffff' : P.numberColor || T.text; g.fillText(fmtNumber(v, P), w / 2, h / 2);
  if (P.caption) { font(g, 40 * unit, 550); g.fillStyle = P.background === 'accent' ? 'rgba(255,255,255,0.85)' : T.sub; g.fillText(P.caption, w / 2, h / 2 + (P.size ?? 180) * unit * 0.72); }
  g.restore();
}

const parseRows = (s) => String(s ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = /^(.*?)[,:\t]\s*(-?[\d.]+)\s*(?:[,:\t]\s*(-?[\d.]+))?\s*$/.exec(l); return m ? { label: m[1].trim(), a: Number(m[2]), b: m[3] != null ? Number(m[3]) : Number(m[2]) } : { label: l, a: 0, b: 0 }; });
function barChart(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const rows = parseRows(P.data); const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  if (!rows.length) return;
  const grow = ez(phase(u, 0.06, 0.45)), change = ez(phase(u, 0.5, 0.92));
  const vals = rows.map((r) => lerp(r.a, r.b, change) * grow); const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.a, r.b)));
  /* the order eases with the values (a bar race): each bar's slot glides to its rank */
  const rankOf = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]); const r = new Array(arr.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const r0 = rankOf(rows.map((r) => r.a)), r1 = rankOf(rows.map((r) => r.b));
  const top = h * 0.2, rowH = Math.min(120 * unit, (h * 0.7) / rows.length), left = w * 0.1, labelW = w * 0.26, barMax = w * 0.8 - labelW;
  if (P.title) { font(g, 46 * unit, 750); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = T.text; g.globalAlpha = EASE.out(phase(u, 0, 0.1)); g.fillText(P.title, left, top - 40 * unit); g.globalAlpha = 1; }
  rows.forEach((r, i) => {
    const slot = P.race === false ? i : lerp(r0[i], r1[i], change); const y = top + slot * rowH;
    const appear = EASE.out(phase(u, 0.02 + i * 0.03, 0.14 + i * 0.03));
    g.save(); g.globalAlpha = appear;
    font(g, 30 * unit, 600); g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillStyle = T.sub; g.fillText(r.label, left + labelW - 16 * unit, y + rowH * 0.42);
    const bw = Math.max(4 * unit, (vals[i] / max) * barMax); const c = i === 0 || P.highlightAll ? P.accent : mixHex(P.accent, T.bg, 0.35 + 0.1 * (i % 3));
    rr(g, left + labelW, y + rowH * 0.12, bw, rowH * 0.6, rowH * 0.16); g.fillStyle = c; g.fill();
    font(g, 28 * unit, 700); g.textAlign = 'left'; g.fillStyle = T.text; g.fillText(fmtNumber(vals[i], P), left + labelW + bw + 12 * unit, y + rowH * 0.42);
    g.restore();
  });
}
function lineGraph(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const pts = String(P.values ?? '').split(/[,\s]+/).map(Number).filter(Number.isFinite);
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h); if (pts.length < 2) return;
  const x0 = w * 0.1, x1 = w * 0.9, y0 = h * 0.72, y1 = h * 0.28; const lo = Math.min(...pts), hi = Math.max(...pts); const span = hi - lo || 1;
  const X = (i) => lerp(x0, x1, i / (pts.length - 1)), Y = (v) => lerp(y0, y1, (v - lo) / span);
  g.strokeStyle = T.line; g.lineWidth = 1.5; for (let i = 0; i <= 4; i++) { const y = lerp(y0, y1, i / 4); g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  const k = EASE[SPEEDS[P.speed] ?? 'smooth'](phase(u, 0.08, 0.85)); const upto = k * (pts.length - 1);
  g.save(); g.beginPath(); for (let i = 0; i <= Math.floor(upto); i++) { if (i) g.lineTo(X(i), Y(pts[i])); else g.moveTo(X(i), Y(pts[i])); }
  const fi = Math.floor(upto), fr = upto - fi; if (fi < pts.length - 1) g.lineTo(lerp(X(fi), X(fi + 1), fr), lerp(Y(pts[fi]), Y(pts[fi + 1]), fr));
  g.strokeStyle = P.accent; g.lineWidth = 7 * unit; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
  g.lineTo(lerp(X(fi), X(Math.min(fi + 1, pts.length - 1)), fr), y0); g.lineTo(x0, y0); g.closePath(); const grd = g.createLinearGradient(0, y1, 0, y0); grd.addColorStop(0, rgba(P.accent, 0.22)); grd.addColorStop(1, rgba(P.accent, 0)); g.fillStyle = grd; g.fill(); g.restore();
  pts.forEach((v, i) => { const a = EASE.out(clamp((upto - i + 0.3) * 2)); if (a <= 0) return; dot(g, X(i), Y(v), 7 * unit * a, P.accent); if (P.showValues !== false) { g.save(); g.globalAlpha = a; font(g, 24 * unit, 650); g.textAlign = 'center'; g.fillStyle = T.text; g.fillText(fmtNumber(v, P), X(i), Y(v) - 26 * unit); g.restore(); } });
  if (P.title) { font(g, 46 * unit, 750); g.textAlign = 'left'; g.fillStyle = T.text; g.fillText(P.title, x0, h * 0.18); }
}
function donut(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const rows = parseRows(P.data); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const total = rows.reduce((s, r) => s + Math.max(0, r.a), 0) || 1; const cx = w / 2, cy = h * 0.44, R = Math.min(w, h) * 0.3, th = R * (P.thickness ?? 0.32);
  let a0 = -Math.PI / 2; const pal = [P.accent, mixHex(P.accent, '#22c55e', 0.6), mixHex(P.accent, '#f59e0b', 0.7), mixHex(P.accent, '#ef4444', 0.6), mixHex(P.accent, '#a855f7', 0.6), T.sub];
  rows.forEach((r, i) => {
    const share = Math.max(0, r.a) / total; const k = EASE.inOut(phase(u, 0.08 + i * 0.08, 0.4 + i * 0.08)); const a1 = a0 + share * Math.PI * 2 * k;
    g.beginPath(); g.arc(cx, cy, R, a0, a1); g.strokeStyle = pal[i % pal.length]; g.lineWidth = th; g.lineCap = 'butt'; g.stroke();
    const la = EASE.out(phase(u, 0.5 + i * 0.05, 0.6 + i * 0.05)); if (la > 0) { g.save(); g.globalAlpha = la; font(g, 26 * unit, 600); g.textAlign = 'left'; g.fillStyle = T.text; const ly = h * 0.78 + i * 40 * unit; rr(g, w * 0.22, ly - 10 * unit, 20 * unit, 20 * unit, 5 * unit); g.fillStyle = pal[i % pal.length]; g.fill(); g.fillStyle = T.text; g.textBaseline = 'middle'; g.fillText(`${r.label}  ${Math.round(share * 100)}%`, w * 0.22 + 32 * unit, ly); g.restore(); }
    a0 += share * Math.PI * 2;
  });
  if (P.title) { font(g, 40 * unit, 750); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(P.title, cx, cy); }
}
function progressRing(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.28; const k = EASE[SPEEDS[P.speed] ?? 'smooth'](phase(u, 0.08, 0.8)) * clamp((P.percent ?? 75) / 100);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.strokeStyle = T.line; g.lineWidth = R * 0.16; g.stroke();
  g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.strokeStyle = P.accent; g.lineCap = 'round'; g.stroke();
  font(g, R * 0.55, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(`${Math.round(k * 100)}%`, cx, cy);
  if (P.caption) { font(g, 34 * unit, 600); g.fillStyle = T.sub; g.fillText(P.caption, cx, cy + R + 70 * unit); }
}
function percentChange(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const v = Number(P.value) || 0; const up = v >= 0; const k = EASE.smooth(phase(u, 0.1, 0.7)); const c = up ? (P.upColor || '#16a34a') : (P.downColor || '#dc2626');
  const a = EASE.out(phase(u, 0, 0.15)); g.save(); g.globalAlpha = a;
  g.translate(w / 2, h / 2 - 40 * unit); const s = 70 * unit; g.save(); g.translate(-s * 2.2, 0); g.rotate(up ? 0 : Math.PI);
  g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.85, 0); g.lineTo(s * 0.32, 0); g.lineTo(s * 0.32, s); g.lineTo(-s * 0.32, s); g.lineTo(-s * 0.32, 0); g.lineTo(-s * 0.85, 0); g.closePath(); g.fillStyle = c; g.fill(); g.restore();
  font(g, 150 * unit, 800); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = c; g.fillText(`${up ? '+' : '−'}${Math.abs(v * k).toFixed(P.decimals ?? 0)}%`, -s * 1.2, 0);
  if (P.caption) { font(g, 38 * unit, 600); g.textAlign = 'center'; g.fillStyle = T.sub; g.fillText(P.caption, 0, 130 * unit); }
  g.restore();
}
function rankingList(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const items = String(P.items ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const top = h * 0.2, rowH = Math.min(130 * unit, h * 0.68 / Math.max(1, items.length));
  if (P.title) { font(g, 52 * unit, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.globalAlpha = EASE.out(phase(u, 0, 0.1)); g.fillText(P.title, w / 2, top - 70 * unit); g.globalAlpha = 1; }
  const order = P.countdown ? items.map((_, i) => items.length - 1 - i) : items.map((_, i) => i);
  order.forEach((i, k) => {
    const a = EASE.out(phase(u, 0.1 + k * (0.7 / Math.max(1, items.length)), 0.18 + k * (0.7 / Math.max(1, items.length)))); if (a <= 0) return;
    const y = top + i * rowH; g.save(); g.globalAlpha = a; g.translate((1 - a) * -60 * unit, 0);
    shadowed(g, T.shadow, 24 * unit, 8 * unit, () => { rr(g, w * 0.1, y, w * 0.8, rowH * 0.82, 22 * unit); g.fillStyle = T.card; g.fill(); });
    rr(g, w * 0.1 + 18 * unit, y + rowH * 0.13, rowH * 0.56, rowH * 0.56, 14 * unit); g.fillStyle = i === 0 ? P.accent : mixHex(P.accent, T.card, 0.75); g.fill();
    font(g, rowH * 0.3, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = i === 0 ? '#fff' : P.accent; g.fillText(String(i + 1), w * 0.1 + 18 * unit + rowH * 0.28, y + rowH * 0.41);
    font(g, rowH * 0.28, 650); g.textAlign = 'left'; g.fillStyle = T.text; g.fillText(items[i], w * 0.1 + rowH * 0.8, y + rowH * 0.41); g.restore();
  });
}
function eventsTimeline(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const rows = String(P.events ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...b] = l.split(/\s*[—–:-]\s*/); return { when: a, what: b.join(' — ') }; });
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h); if (!rows.length) return;
  const x = w * 0.22, y0 = h * 0.16, y1 = h * 0.86; const k = EASE.inOut(phase(u, 0.05, 0.85));
  g.strokeStyle = T.line; g.lineWidth = 6 * unit; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
  g.strokeStyle = P.accent; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, lerp(y0, y1, k)); g.stroke();
  rows.forEach((r, i) => {
    const at = rows.length === 1 ? 0.5 : i / (rows.length - 1); const y = lerp(y0, y1, at); const a = EASE.out(clamp((k - at) * 6 + 0.4)); if (a <= 0) return;
    dot(g, x, y, 12 * unit * a, P.accent); g.save(); g.globalAlpha = a; g.translate((1 - a) * 30 * unit, 0);
    font(g, 30 * unit, 750); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = P.accent; g.fillText(r.when, x + 40 * unit, y - 18 * unit);
    font(g, 30 * unit, 550); g.fillStyle = T.text; textLines(g, r.what, w * 0.62).slice(0, 2).forEach((line, j) => g.fillText(line, x + 40 * unit, y + 20 * unit + j * 36 * unit)); g.restore();
  });
}
function stepsProcess(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const steps = String(P.steps ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h); if (!steps.length) return;
  const n = steps.length; const cx = w / 2, y0 = h * 0.18, gap = (h * 0.68) / Math.max(1, n - 1 || 1);
  steps.forEach((s, i) => {
    const y = n === 1 ? h / 2 : y0 + gap * i; const st = 0.06 + i * (0.8 / n); const a = EASE.out(phase(u, st, st + 0.12));
    if (i > 0) { const k = EASE.inOut(phase(u, st - 0.08, st + 0.02)); g.strokeStyle = P.accent; g.lineWidth = 5 * unit; g.setLineDash([12 * unit, 10 * unit]); g.beginPath(); g.moveTo(cx, y - gap + 60 * unit); g.lineTo(cx, lerp(y - gap + 60 * unit, y - 60 * unit, k)); g.stroke(); g.setLineDash([]); }
    if (a <= 0) return; g.save(); g.globalAlpha = a; g.translate(0, (1 - a) * 20 * unit);
    shadowed(g, T.shadow, 30 * unit, 10 * unit, () => { rr(g, w * 0.14, y - 52 * unit, w * 0.72, 104 * unit, 26 * unit); g.fillStyle = T.card; g.fill(); });
    g.beginPath(); g.arc(w * 0.14 + 56 * unit, y, 30 * unit, 0, Math.PI * 2); g.fillStyle = P.accent; g.fill();
    font(g, 30 * unit, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(String(i + 1), w * 0.14 + 56 * unit, y);
    font(g, 32 * unit, 650); g.textAlign = 'left'; g.fillStyle = T.text; g.fillText(s, w * 0.14 + 106 * unit, y); g.restore();
  });
}
function beforeAfter(g, e) {
  const { w, h, u, P, unit, media: M } = e; const A = M('before'), B = M('after');
  drawMedia(g, A, 0, 0, w, h); const k = P.divider === 'auto' || !P.divider ? lerp(0.92, 0.08, EASE.inOut(phase(u, 0.15, 0.85))) : clamp(Number(P.divider));
  g.save(); g.beginPath(); g.rect(w * k, 0, w * (1 - k), h); g.clip(); drawMedia(g, B, 0, 0, w, h); g.restore();
  g.fillStyle = '#fff'; g.fillRect(w * k - 2 * unit, 0, 4 * unit, h); g.beginPath(); g.arc(w * k, h / 2, 34 * unit, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 4 * unit; g.beginPath(); g.moveTo(w * k - 10 * unit, h / 2 - 12 * unit); g.lineTo(w * k - 20 * unit, h / 2); g.lineTo(w * k - 10 * unit, h / 2 + 12 * unit); g.moveTo(w * k + 10 * unit, h / 2 - 12 * unit); g.lineTo(w * k + 20 * unit, h / 2); g.lineTo(w * k + 10 * unit, h / 2 + 12 * unit); g.stroke();
  const tag = (t, x, align) => { font(g, 26 * unit, 700); const tw = g.measureText(t).width + 28 * unit; const bx = align === 'left' ? x : x - tw; rr(g, bx, 40 * unit, tw, 46 * unit, 23 * unit); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill(); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, bx + 14 * unit, 63 * unit); };
  if (P.beforeLabel) tag(P.beforeLabel, 30 * unit, 'left'); if (P.afterLabel) tag(P.afterLabel, w - 30 * unit, 'right');
}

function lowerThird(g, e) {
  const { w, h, u, P, unit } = e; const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  const inK = ez(phase(u, 0, 0.18)), outK = P.exit === false ? 0 : EASE.in(phase(u, 0.85, 1));
  const k = inK * (1 - outK); if (k <= 0) return;
  const x = w * 0.07, y = h * (P.position === 'top' ? 0.1 : 0.78); font(g, 46 * unit, 750); const tw = Math.max(g.measureText(P.title || '').width, (font(g, 30 * unit, 500), g.measureText(P.subtitle || '').width)) + 60 * unit;
  g.save(); g.beginPath(); g.rect(x, y - 10 * unit, tw * k + 20 * unit, 140 * unit); g.clip();
  shadowed(g, 'rgba(0,0,0,0.25)', 30 * unit, 10 * unit, () => { rr(g, x, y, tw, 120 * unit, 18 * unit); g.fillStyle = P.theme === 'dark' ? 'rgba(15,17,21,0.88)' : 'rgba(255,255,255,0.94)'; g.fill(); });
  g.fillStyle = P.accent; rr(g, x, y, 10 * unit, 120 * unit, 5 * unit); g.fill();
  const tk = EASE.out(phase(u, 0.08, 0.26)) * (1 - outK);
  g.globalAlpha = tk; font(g, 46 * unit, 750); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = P.theme === 'dark' ? '#fff' : '#0f1115'; g.fillText(P.title || '', x + 34 * unit, y + 44 * unit + (1 - tk) * 10 * unit);
  font(g, 30 * unit, 500); g.fillStyle = P.theme === 'dark' ? 'rgba(255,255,255,0.7)' : '#5f6672'; g.fillText(P.subtitle || '', x + 34 * unit, y + 88 * unit + (1 - tk) * 10 * unit);
  g.restore();
}
function chapterTitle(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); g.fillStyle = P.background === 'transparent' ? 'rgba(0,0,0,0)' : T.bg; if (P.background !== 'transparent') g.fillRect(0, 0, w, h);
  const a = EASE.out(phase(u, 0.05, 0.3)), out = EASE.in(phase(u, 0.82, 1)), k = a * (1 - out);
  g.save(); g.globalAlpha = k; g.textAlign = 'center'; g.textBaseline = 'middle';
  font(g, 30 * unit, 700); g.fillStyle = P.accent; g.fillText(String(P.kicker || '').toUpperCase(), w / 2, h / 2 - 80 * unit - (1 - a) * 12 * unit);
  font(g, (P.size ?? 96) * unit, 800); g.fillStyle = T.text; textLines(g, P.title, w * 0.82).forEach((l, i, arr) => g.fillText(l, w / 2, h / 2 + (i - (arr.length - 1) / 2) * (P.size ?? 96) * unit * 1.08 + (1 - a) * 16 * unit));
  const lw = w * 0.16 * EASE.inOut(phase(u, 0.15, 0.45)); g.fillStyle = P.accent; rr(g, w / 2 - lw / 2, h / 2 + 110 * unit, lw, 8 * unit, 4 * unit); g.fill();
  g.restore();
}
function kineticText(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); if (P.background !== 'transparent') { g.fillStyle = T.bg; g.fillRect(0, 0, w, h); }
  const words = String(P.text ?? '').split(/\s+/).filter(Boolean); const size = (P.size ?? 110) * unit; font(g, size, 850);
  const lines = textLines(g, words.join(' '), w * 0.84); let wi = 0; const total = words.length;
  lines.forEach((line, li) => {
    const lw = line.split(' '); let x = w / 2 - g.measureText(line).width / 2; const y = h / 2 + (li - (lines.length - 1) / 2) * size * 1.05;
    lw.forEach((word) => {
      const st = 0.05 + (wi / Math.max(1, total)) * 0.6; const a = EASE[P.style === 'pop' ? 'settle' : 'out'](phase(u, st, st + 0.14)); const ww = g.measureText(`${word} `).width;
      g.save(); g.globalAlpha = clamp(a * 1.2); g.translate(x, y); if (P.style === 'pop') g.scale(0.6 + 0.4 * a, 0.6 + 0.4 * a); else g.translate(0, (1 - a) * size * 0.4);
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = (P.emphasis && word.replace(/\W/g, '').toLowerCase() === String(P.emphasis).toLowerCase()) ? P.accent : T.text; g.fillText(word, 0, 0); g.restore();
      x += ww; wi++;
    });
  });
}
function quoteCard(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const a = EASE.out(phase(u, 0, 0.2)); const cw = w * 0.82; font(g, 52 * unit, 650); const lines = textLines(g, `“${P.quote ?? ''}”`, cw - 100 * unit); const ch = lines.length * 66 * unit + 200 * unit;
  g.save(); g.globalAlpha = a; g.translate(0, (1 - a) * 30 * unit);
  shadowed(g, T.shadow, 50 * unit, 18 * unit, () => { rr(g, (w - cw) / 2, (h - ch) / 2, cw, ch, 36 * unit); g.fillStyle = T.card; g.fill(); });
  g.fillStyle = P.accent; font(g, 160 * unit, 800); g.textAlign = 'left'; g.textBaseline = 'top'; g.globalAlpha = a * 0.25; g.fillText('“', (w - cw) / 2 + 30 * unit, (h - ch) / 2 - 10 * unit); g.globalAlpha = a;
  font(g, 52 * unit, 650); g.fillStyle = T.text; lines.forEach((l, i) => { const la = EASE.out(phase(u, 0.1 + i * 0.05, 0.25 + i * 0.05)); g.globalAlpha = a * la; g.fillText(l, (w - cw) / 2 + 50 * unit, (h - ch) / 2 + 70 * unit + i * 66 * unit); });
  g.globalAlpha = a * EASE.out(phase(u, 0.35, 0.5)); font(g, 32 * unit, 600); g.fillStyle = T.sub; g.fillText(`— ${P.author ?? ''}`, (w - cw) / 2 + 50 * unit, (h + ch) / 2 - 80 * unit);
  g.restore();
}
function highlight(g, e) {
  const { w, h, u, P, unit, media: M } = e; const bg = M('background'); if (bg) drawMedia(g, bg, 0, 0, w, h);
  const k = EASE.inOut(phase(u, 0.08, 0.5)); const x = (P.x ?? 0.5) * w, y = (P.y ?? 0.5) * h, rw = (P.width ?? 0.4) * w, rh = (P.height ?? 0.14) * h;
  g.save(); g.strokeStyle = P.accent; g.lineWidth = (P.stroke ?? 8) * unit; g.lineCap = 'round'; g.lineJoin = 'round';
  if (P.dim > 0) { g.fillStyle = `rgba(0,0,0,${P.dim * k})`; g.beginPath(); g.rect(0, 0, w, h); if (P.shape === 'circle') g.ellipse(x, y, rw / 2, rh / 2, 0, 0, Math.PI * 2, true); else rr(g, x - rw / 2, y - rh / 2, rw, rh, 20 * unit); g.fill('evenodd'); }
  if (P.shape === 'circle') { g.beginPath(); g.ellipse(x, y, rw / 2 * 1.04, rh / 2 * 1.04, -0.08, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2.04); g.stroke(); }
  else if (P.shape === 'arrow') { const ax = x - rw * 0.9, ay = y + rh * 1.6, tx = lerp(ax, x - rw * 0.08, k), ty = lerp(ay, y + rh * 0.3, k); g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax + rw * 0.1, y, tx, ty); g.stroke();
    if (k > 0.9) { const an = Math.atan2(ty - y, tx - (ax + rw * 0.1)); g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx - Math.cos(an - 0.5) * 30 * unit, ty - Math.sin(an - 0.5) * 30 * unit); g.moveTo(tx, ty); g.lineTo(tx - Math.cos(an + 0.5) * 30 * unit, ty - Math.sin(an + 0.5) * 30 * unit); g.stroke(); } }
  else { const per = 2 * (rw + rh); g.setLineDash([per * k, per]); rr(g, x - rw / 2, y - rh / 2, rw, rh, 20 * unit); g.stroke(); g.setLineDash([]); }
  g.restore();
  if (P.note) { const a = EASE.out(phase(u, 0.45, 0.6)); g.save(); g.globalAlpha = a; font(g, 34 * unit, 700); const tw = g.measureText(P.note).width + 40 * unit; const bx = clamp(x - tw / 2, 20 * unit, w - tw - 20 * unit), by = y + rh / 2 + 30 * unit;
    shadowed(g, 'rgba(0,0,0,0.3)', 20 * unit, 6 * unit, () => { rr(g, bx, by, tw, 64 * unit, 18 * unit); g.fillStyle = P.accent; g.fill(); }); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(P.note, bx + 20 * unit, by + 32 * unit); g.restore(); }
}
function checklist(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); const items = String(P.items ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  g.fillStyle = T.bg; g.fillRect(0, 0, w, h); const top = h / 2 - items.length * 55 * unit;
  if (P.title) { font(g, 54 * unit, 800); g.textAlign = 'left'; g.fillStyle = T.text; g.textBaseline = 'middle'; g.fillText(P.title, w * 0.14, top - 70 * unit); }
  items.forEach((it, i) => {
    const st = 0.08 + i * (0.75 / Math.max(1, items.length)); const a = EASE.out(phase(u, st, st + 0.08)), c = EASE.out(phase(u, st + 0.06, st + 0.14)); if (a <= 0) return;
    const y = top + i * 110 * unit; g.save(); g.globalAlpha = a; g.translate((1 - a) * 24 * unit, 0);
    rr(g, w * 0.14, y - 28 * unit, 56 * unit, 56 * unit, 16 * unit); g.fillStyle = c > 0 ? P.accent : T.card; g.fill(); g.strokeStyle = T.line; g.lineWidth = 2; g.stroke();
    if (c > 0) { g.strokeStyle = '#fff'; g.lineWidth = 7 * unit; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); const sx = w * 0.14 + 14 * unit, sy = y; g.moveTo(sx, sy); g.lineTo(sx + 11 * unit * Math.min(1, c * 2), sy + 11 * unit * Math.min(1, c * 2)); if (c > 0.5) g.lineTo(sx + 11 * unit + 19 * unit * (c - 0.5) * 2, sy + 11 * unit - 22 * unit * (c - 0.5) * 2); g.stroke(); }
    font(g, 38 * unit, 620); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(it, w * 0.14 + 86 * unit, y); g.restore();
  });
}
function countdown(g, e) {
  const { w, h, u, P, unit, t, duration } = e; const T = theme(P); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const total = Math.max(1, Number(P.from) || duration); const left = Math.max(0, total * (1 - u)); const sec = Math.ceil(left - 1e-6);
  const frac = left - Math.floor(left); const pulse = EASE.out(1 - frac);
  const R = Math.min(w, h) * 0.3; g.beginPath(); g.arc(w / 2, h / 2, R, 0, Math.PI * 2); g.strokeStyle = T.line; g.lineWidth = R * 0.08; g.stroke();
  g.beginPath(); g.arc(w / 2, h / 2, R, -Math.PI / 2, -Math.PI / 2 + (left / total) * Math.PI * 2); g.strokeStyle = P.accent; g.lineCap = 'round'; g.stroke();
  g.save(); g.translate(w / 2, h / 2); const sc = 1 + 0.06 * (1 - pulse); g.scale(sc, sc); font(g, R * 0.8, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.text;
  g.fillText(P.format === 'clock' ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec), 0, 0); g.restore();
  if (P.caption) { font(g, 34 * unit, 600); g.textAlign = 'center'; g.fillStyle = T.sub; g.fillText(P.caption, w / 2, h / 2 + R + 70 * unit); }
  void t;
}
function notification(g, e) {
  const { w, h, u, P, unit, media: M } = e; const T = theme(P); const icon = M('icon');
  const inK = EASE.out(phase(u, 0, 0.14)), outK = EASE.in(phase(u, 0.86, 1)); const k = inK * (1 - outK); if (k <= 0) return;
  const cw = w * 0.86, ch = 150 * unit, x = (w - cw) / 2, y = lerp(-ch - 20 * unit, h * 0.05, k);
  shadowed(g, 'rgba(0,0,0,0.25)', 40 * unit, 14 * unit, () => { rr(g, x, y, cw, ch, 36 * unit); g.fillStyle = P.theme === 'dark' ? 'rgba(30,32,38,0.94)' : 'rgba(250,250,252,0.96)'; g.fill(); });
  drawMedia(g, icon, x + 24 * unit, y + 30 * unit, 90 * unit, 90 * unit, 22 * unit); if (!icon) { rr(g, x + 24 * unit, y + 30 * unit, 90 * unit, 90 * unit, 22 * unit); g.fillStyle = P.accent; g.fill(); }
  font(g, 30 * unit, 700); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(P.app || '', x + 136 * unit, y + 50 * unit);
  font(g, 24 * unit, 500); g.fillStyle = T.sub; g.textAlign = 'right'; g.fillText(P.when || 'now', x + cw - 30 * unit, y + 50 * unit);
  font(g, 30 * unit, 500); g.textAlign = 'left'; g.fillStyle = T.text; g.fillText(textLines(g, P.message || '', cw - 170 * unit)[0] ?? '', x + 136 * unit, y + 100 * unit);
}
function polaroids(g, e) {
  const { w, h, u, P, unit, media: M } = e; const T = theme(P); g.fillStyle = T.bg; g.fillRect(0, 0, w, h);
  const n = clamp(Math.round(P.count ?? 4), 1, 6); const rnd = seeded(11);
  for (let i = 0; i < n; i++) {
    const st = 0.05 + i * (0.6 / n); const k = EASE.out(phase(u, st, st + 0.2)); if (k <= 0) continue;
    const pw = w * 0.56, ph = pw * 1.18; const rot = (rnd() - 0.5) * 0.4 * (P.scatter ?? 1); const dx = (rnd() - 0.5) * w * 0.25 * (P.scatter ?? 1), dy = (rnd() - 0.5) * h * 0.18 * (P.scatter ?? 1);
    g.save(); g.translate(w / 2 + dx, h / 2 + dy + (1 - k) * h * 0.6); g.rotate(rot * k + (1 - k) * 0.5);
    shadowed(g, 'rgba(0,0,0,0.3)', 30 * unit, 12 * unit, () => { g.fillStyle = '#fff'; g.fillRect(-pw / 2, -ph / 2, pw, ph); });
    drawMedia(g, M(`photo${i + 1}`) ?? M('photo1'), -pw / 2 + pw * 0.06, -ph / 2 + pw * 0.06, pw * 0.88, pw * 0.88, 2);
    const cap = String(P.captions ?? '').split('\n')[i]; if (cap) { font(g, 30 * unit, 600, '"Marker Felt", "Comic Sans MS", cursive'); g.fillStyle = '#333'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(cap, 0, ph / 2 - pw * 0.13); }
    g.restore();
  }
}

/* Open Folder: a folder enters, its front flap opens in perspective, the photos rise out of it and fan; one of them
   then grows to fill the frame (or stays a floating card). Drawn back to front — back panel, cards, front flap — so a
   card inside the folder is hidden by the flap until it rises above it. */
const FOLDERS = {
  desktop: { back: '#3b82f6', front: '#60a5fa', tab: '#2563eb', edge: 'rgba(255,255,255,0.25)' },
  yellow: { back: '#e9b949', front: '#f6cf62', tab: '#d9a73a', edge: 'rgba(255,255,255,0.3)' },
  white: { back: '#e9ebef', front: '#ffffff', tab: '#dcdfe5', edge: 'rgba(0,0,0,0.06)' },
  graphite: { back: '#2a2d33', front: '#3a3e46', tab: '#24272c', edge: 'rgba(255,255,255,0.08)' },
  frosted: { back: 'rgba(220,230,245,0.55)', front: 'rgba(240,246,255,0.62)', tab: 'rgba(210,222,240,0.6)', edge: 'rgba(255,255,255,0.6)' },
  paper: { back: '#d8c7a3', front: '#e8dbbd', tab: '#cdb98f', edge: 'rgba(120,90,40,0.15)' },
  explorer: { back: '#f2c94c', front: '#ffd866', tab: '#e0b43a', edge: 'rgba(0,0,0,0.08)' },
  archive: { back: '#9c7a4e', front: '#b89366', tab: '#8a6a40', edge: 'rgba(255,255,255,0.12)' },
  saas: { back: '#4f46e5', front: '#6366f1', tab: '#4338ca', edge: 'rgba(255,255,255,0.22)' },
};
function openFolder(g, e) {
  const { w, h, u, P, unit, media: M } = e; const T = theme(P);
  if (P.background !== 'transparent') { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, P.theme === 'dark' ? '#14161c' : '#f4f6fa'); grd.addColorStop(1, P.theme === 'dark' ? '#0b0c10' : '#e7eaf1'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }
  const st = FOLDERS[P.folderStyle] ?? FOLDERS.desktop; const col = P.folderColor ? { ...st, back: mixHex(P.folderColor, '#000000', 0.12), front: P.folderColor, tab: mixHex(P.folderColor, '#000000', 0.2) } : st;
  const reverse = !!P.reverse; const uu = reverse ? 1 - u : u;
  const enter = EASE.out(phase(uu, 0, 0.16)); const open = EASE.inOut(phase(uu, 0.14, 0.34)); const rise = phase(uu, 0.3, 0.62); const expand = P.final === 'card' ? 0 : EASE.inOut(phase(uu, 0.68, 0.92));
  const fw = w * (P.size ?? 0.62), fh = fw * 0.74; const cx = w / 2, cy = h * 0.58 + (1 - enter) * h * 0.25; const x = cx - fw / 2, y = cy - fh / 2;
  const n = clamp(Math.round(P.count ?? 3), 1, 6);
  const fade = 1 - expand;
  g.save(); g.globalAlpha = enter * fade;
  /* back panel and tab */
  shadowed(g, 'rgba(0,0,0,0.25)', 50 * unit, 24 * unit, () => { rr(g, x, y, fw, fh, 26 * unit); g.fillStyle = col.back; g.fill(); });
  rr(g, x + 24 * unit, y - 34 * unit, fw * 0.36, 60 * unit, 18 * unit); g.fillStyle = col.tab; g.fill();
  g.restore();
  /* the cards: rise from inside, fan out by arrangement */
  const cards = [];
  for (let i = 0; i < n; i++) {
    const k = EASE.out(clamp(rise * (1 + n * 0.25) - i * 0.25)); const ang = n === 1 ? 0 : lerp(-0.32, 0.32, i / (n - 1));
    const cw = fw * 0.5, ch = cw * 1.25;
    let px = cx, py = cy + fh * 0.1, rot = 0;
    if (P.arrange === 'grid') { const cols = Math.min(3, n); const gx = (i % cols) - (cols - 1) / 2, gy = Math.floor(i / cols); px = cx + gx * cw * 1.1 * k; py = lerp(cy + fh * 0.1, cy - fh * 0.75 - gy * ch * 0.9, k); }
    else if (P.arrange === 'stack') { px = cx + (i - (n - 1) / 2) * 12 * unit * k; py = lerp(cy + fh * 0.1, cy - fh * 0.62 - i * 10 * unit, k); rot = (i - (n - 1) / 2) * 0.05 * k; }
    else { px = cx + Math.sin(ang) * fw * 0.55 * k * (P.spacing ?? 1); py = lerp(cy + fh * 0.1, cy - fh * 0.62 + Math.abs(ang) * fh * 0.35, k); rot = ang * k; }
    cards.push({ i, k, px, py, rot, cw, ch });
  }
  const chosen = clamp(Math.round((P.focus ?? 1) - 1), 0, n - 1);
  for (const c of cards) {
    if (c.k <= 0) continue; if (c.i === chosen && expand > 0) continue;
    g.save(); g.globalAlpha = enter * fade; g.translate(c.px, c.py); g.rotate(c.rot);
    shadowed(g, 'rgba(0,0,0,0.25)', 24 * unit, 10 * unit, () => { rr(g, -c.cw / 2, -c.ch / 2, c.cw, c.ch, 16 * unit); g.fillStyle = '#ffffff'; g.fill(); });
    drawMedia(g, M(`item${c.i + 1}`), -c.cw / 2 + 10 * unit, -c.ch / 2 + 10 * unit, c.cw - 20 * unit, c.ch - 20 * unit, 10 * unit);
    g.restore();
  }
  /* front flap: hinged at the bottom, tipping toward the camera (perspective: it shortens and widens at the top) */
  g.save(); g.globalAlpha = enter * fade;
  const tilt = open * (P.angle ?? 0.55); const fy = y + fh * 0.18 + fh * 0.82 * (1 - Math.cos(tilt * 1.3)) * 0.0; const top = lerp(y + fh * 0.18, y + fh * 0.18 + fh * 0.82 * Math.sin(tilt) * 0.55, 1);
  const spread = fw * 0.06 * Math.sin(tilt);
  g.beginPath(); g.moveTo(x - spread, top); g.lineTo(x + fw + spread, top); g.lineTo(x + fw, y + fh); g.lineTo(x, y + fh); g.closePath();
  const fg = g.createLinearGradient(0, top, 0, y + fh); fg.addColorStop(0, mixHex(col.front.startsWith('#') ? col.front : '#ffffff', '#ffffff', 0.12 * (1 - tilt))); fg.addColorStop(1, col.front.startsWith('#') ? col.front : '#ffffff');
  g.fillStyle = col.front.startsWith('rgba') ? col.front : fg; g.fill(); g.strokeStyle = col.edge; g.lineWidth = 2 * unit; g.stroke();
  void fy;
  if (P.label) { font(g, 40 * unit, 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = P.folderStyle === 'white' || P.folderStyle === 'explorer' || P.folderStyle === 'yellow' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.92)'; g.fillText(P.label, cx, lerp(top, y + fh, 0.55)); }
  g.restore();
  /* the chosen card grows to the frame */
  if (expand > 0) {
    const c = cards[chosen]; const x0 = c.px - c.cw / 2, y0 = c.py - c.ch / 2;
    const ex = lerp(x0, 0, expand), ey = lerp(y0, 0, expand), ew = lerp(c.cw, w, expand), eh = lerp(c.ch, h, expand);
    g.save(); g.translate(ex + ew / 2, ey + eh / 2); g.rotate(c.rot * (1 - expand)); drawMedia(g, M(`item${chosen + 1}`), -ew / 2, -eh / 2, ew, eh, 16 * unit * (1 - expand)); g.restore();
  }
  void T;
}

/* ---- SaaS & technology ---- */
function windowChrome(g, x, y, w, h, r, unit, dark, title) {
  rr(g, x, y, w, h, r); g.fillStyle = dark ? '#1c1f26' : '#ffffff'; g.fill();
  g.save(); rr(g, x, y, w, h, r); g.clip(); g.fillStyle = dark ? '#262a33' : '#f3f4f7'; g.fillRect(x, y, w, 46 * unit);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { g.beginPath(); g.arc(x + 26 * unit + i * 22 * unit, y + 23 * unit, 7 * unit, 0, Math.PI * 2); g.fillStyle = c; g.fill(); });
  if (title) { font(g, 18 * unit, 600); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = dark ? '#9aa3b2' : '#6b7280'; g.fillText(title, x + w / 2, y + 23 * unit); }
  g.restore();
  return 46 * unit;
}
function backdrop(g, w, h, P) {
  const grd = g.createLinearGradient(0, 0, w, h);
  if (P.theme === 'dark') { grd.addColorStop(0, '#0b0d12'); grd.addColorStop(1, mixHex('#0b0d12', P.accent, 0.25)); } else { grd.addColorStop(0, '#f5f7fb'); grd.addColorStop(1, mixHex('#eef1f7', P.accent, 0.12)); }
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * 0.75, h * 0.2, 0, w * 0.75, h * 0.2, w * 0.7); glow.addColorStop(0, rgba(P.accent, P.theme === 'dark' ? 0.25 : 0.12)); glow.addColorStop(1, rgba(P.accent, 0)); g.fillStyle = glow; g.fillRect(0, 0, w, h);
}
function appWindow(g, e) {
  const { w, h, u, P, unit, media: M } = e; backdrop(g, w, h, P); const ez = EASE[SPEEDS[P.speed] ?? 'smooth'];
  const inK = ez(phase(u, 0, 0.35)), out = P.exit ? EASE.in(phase(u, 0.88, 1)) : 0;
  const ww = w * (P.width ?? 0.88), wh = ww * (P.aspect === 'tall' ? 1.5 : 0.66);
  const persp = (1 - inK) * (P.perspective ?? 0.5);
  g.save(); g.globalAlpha = inK * (1 - out); g.translate(w / 2, h / 2 + (1 - inK) * h * 0.12); g.scale(lerp(0.86, 1, inK), lerp(0.86, 1, inK) * (1 - persp * 0.25)); g.transform(1, 0, -persp * 0.18, 1, 0, 0);
  shadowed(g, P.theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(20,24,40,0.22)', 80 * unit, 40 * unit, () => { rr(g, -ww / 2, -wh / 2, ww, wh, (P.radius ?? 22) * unit); g.fillStyle = '#fff'; g.fill(); });
  const bar = windowChrome(g, -ww / 2, -wh / 2, ww, wh, (P.radius ?? 22) * unit, unit, P.theme === 'dark', P.title);
  drawMedia(g, M('screen'), -ww / 2, -wh / 2 + bar, ww, wh - bar, 0, P.fit || 'cover');
  g.restore();
}
function floatingUI(g, e) {
  const { w, h, u, P, unit, media: M } = e; backdrop(g, w, h, P);
  const n = clamp(Math.round(P.count ?? 4), 1, 6); const drift = (u - 0.5) * (P.camera ?? 1);
  const layout = [[-0.26, -0.2, 0.9, 0.5], [0.24, -0.06, 0.6, 0.62], [-0.2, 0.22, 0.5, 0.8], [0.26, 0.28, 0.4, 0.95], [0, -0.38, 0.35, 1.1], [0, 0.4, 0.3, 1.2]];
  const items = layout.slice(0, n).map((L, i) => ({ L, i })).sort((a, b) => a.L[3] - b.L[3]);
  for (const { L, i } of items) {
    const [px, py, scale, depth] = L; const st = 0.04 + i * (P.stagger ?? 0.06); const k = EASE.out(phase(u, st, st + 0.28));
    if (k <= 0) continue; const cw = w * 0.52 * (P.cardScale ?? 1) * lerp(0.9, 1, scale), ch = cw * 0.68;
    const x = w / 2 + px * w * (P.spacing ?? 1) - drift * 60 * unit * depth - cw / 2, y = h / 2 + py * h * (P.spacing ?? 1) + (1 - k) * 80 * unit * depth - ch / 2;
    g.save(); g.globalAlpha = k * lerp(0.7, 1, scale); if (depth > 0.9 && (P.depthBlur ?? 0.5) > 0) g.filter = `blur(${((depth - 0.9) * 6 * (P.depthBlur ?? 0.5)).toFixed(1)}px)`;
    shadowed(g, P.theme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(20,24,40,0.18)', 50 * unit, 22 * unit, () => { rr(g, x, y, cw, ch, 24 * unit); g.fillStyle = P.theme === 'dark' ? '#171a21' : '#ffffff'; g.fill(); });
    drawMedia(g, M(`card${i + 1}`), x + 10 * unit, y + 10 * unit, cw - 20 * unit, ch - 20 * unit, 16 * unit);
    g.restore();
  }
  if (P.headline) { const a = EASE.out(phase(u, 0.3, 0.5)); g.save(); g.globalAlpha = a; font(g, 64 * unit, 800); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = P.theme === 'dark' ? '#fff' : '#0f1115'; g.fillText(P.headline, w / 2, h * 0.88); g.restore(); }
}
function featureCallout(g, e) {
  const { w, h, u, P, unit, media: M } = e; const shot = M('screen');
  const zoom = EASE.inOut(phase(u, 0.1, 0.45)) * ((P.zoom ?? 1.6) - 1) + 1;
  const tx = P.x ?? 0.5, ty = P.y ?? 0.4; const cxs = lerp(0.5, tx, (zoom - 1) / Math.max(0.01, (P.zoom ?? 1.6) - 1)), cys = lerp(0.5, ty, (zoom - 1) / Math.max(0.01, (P.zoom ?? 1.6) - 1));
  g.save(); g.translate(w / 2, h / 2); g.scale(zoom, zoom); g.translate(-cxs * w, -cys * h); drawMedia(g, shot, 0, 0, w, h);
  const bw = (P.boxW ?? 0.42) * w, bh = (P.boxH ?? 0.08) * h; const k = EASE.inOut(phase(u, 0.42, 0.62));
  g.strokeStyle = P.accent; g.lineWidth = 5 * unit / zoom; const per = 2 * (bw + bh); g.setLineDash([per * k, per]); rr(g, tx * w - bw / 2, ty * h - bh / 2, bw, bh, 14 * unit / zoom); g.stroke(); g.setLineDash([]);
  g.fillStyle = rgba(P.accent, 0.08 * k); g.fill();
  g.restore();
  const a = EASE.out(phase(u, 0.55, 0.72)); if (a > 0 && P.note) {
    const cw = w * 0.7; font(g, 36 * unit, 700); const lines = textLines(g, P.note, cw - 60 * unit); const ch = 70 * unit + lines.length * 46 * unit;
    const bx = (w - cw) / 2, by = h * (P.noteAt === 'top' ? 0.08 : 0.74) + (1 - a) * 30 * unit;
    g.save(); g.globalAlpha = a; shadowed(g, 'rgba(0,0,0,0.3)', 40 * unit, 16 * unit, () => { rr(g, bx, by, cw, ch, 26 * unit); g.fillStyle = P.theme === 'dark' ? '#171a21' : '#ffffff'; g.fill(); });
    g.fillStyle = P.accent; rr(g, bx + 26 * unit, by + 26 * unit, 10 * unit, ch - 52 * unit, 5 * unit); g.fill();
    g.fillStyle = P.theme === 'dark' ? '#fff' : '#0f1115'; g.textAlign = 'left'; g.textBaseline = 'top'; lines.forEach((l, i) => g.fillText(l, bx + 56 * unit, by + 34 * unit + i * 46 * unit)); g.restore();
  }
}
function cursorDemo(g, e) {
  const { w, h, u, P, unit, media: M } = e; drawMedia(g, M('screen'), 0, 0, w, h);
  const pts = String(P.path ?? '').split('\n').map((l) => l.split(/[ ,]+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite)).map(([x, y, act]) => ({ x: x * w, y: y * h, click: act === 1 }));
  if (!pts.length) return; const n = pts.length; const per = 1 / Math.max(1, n);
  let i = Math.min(n - 1, Math.floor(u / per)); const local = (u - i * per) / per; const moveK = EASE.inOut(phase(local, 0.05, 0.7));
  const a = pts[Math.max(0, i - 1)], b = pts[i]; const midx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, midy = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
  const x = (1 - moveK) ** 2 * a.x + 2 * (1 - moveK) * moveK * midx + moveK * moveK * b.x, y = (1 - moveK) ** 2 * a.y + 2 * (1 - moveK) * moveK * midy + moveK * moveK * b.y;
  if (b.click && local > 0.7) { const r = phase(local, 0.7, 1); g.beginPath(); g.arc(b.x, b.y, (12 + 40 * r) * unit, 0, Math.PI * 2); g.fillStyle = rgba(P.accent, 0.35 * (1 - r)); g.fill(); }
  const press = b.click ? 1 - 0.12 * Math.sin(phase(local, 0.7, 0.85) * Math.PI) : 1; const s = (P.cursorSize ?? 1.2) * unit * press;
  g.save(); g.translate(x, y); g.scale(s, s);
  shadowed(g, 'rgba(0,0,0,0.35)', 8, 3, () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 34); g.lineTo(9, 26); g.lineTo(15, 40); g.lineTo(21, 37); g.lineTo(15, 24); g.lineTo(26, 24); g.closePath(); g.fillStyle = '#fff'; g.fill(); });
  g.beginPath(); g.moveTo(3, 6); g.lineTo(3, 27); g.lineTo(9.5, 21); g.lineTo(15.5, 34); g.lineTo(18, 33); g.lineTo(12, 20.5); g.lineTo(20, 20.5); g.closePath(); g.fillStyle = '#111'; g.fill();
  g.restore();
  void i;
}
function workflow(g, e) {
  const { w, h, u, P, unit } = e; backdrop(g, w, h, P); const T = theme(P); const nodes = String(P.nodes ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!nodes.length) return; const n = nodes.length; const vertical = P.direction !== 'horizontal';
  const pos = (i) => vertical ? [w / 2, lerp(h * 0.16, h * 0.84, n === 1 ? 0.5 : i / (n - 1))] : [lerp(w * 0.14, w * 0.86, n === 1 ? 0.5 : i / (n - 1)), h / 2];
  const nw = vertical ? w * 0.6 : w * 0.7 / n, nh = vertical ? Math.min(120 * unit, h * 0.5 / n) : 120 * unit;
  for (let i = 0; i < n; i++) {
    const st = 0.06 + i * (0.8 / n); const a = EASE.out(phase(u, st, st + 0.1));
    if (i > 0) { const k = EASE.inOut(phase(u, st - 0.07, st + 0.02)); const [x0, y0] = pos(i - 1), [x1, y1] = pos(i);
      const sx = vertical ? x0 : x0 + nw / 2, sy = vertical ? y0 + nh / 2 : y0, ex = vertical ? x1 : x1 - nw / 2, ey = vertical ? y1 - nh / 2 : y1;
      g.strokeStyle = P.accent; g.lineWidth = 5 * unit; g.lineCap = 'round'; g.beginPath(); g.moveTo(sx, sy); g.lineTo(lerp(sx, ex, k), lerp(sy, ey, k)); g.stroke();
      if (k > 0.95) { g.beginPath(); const an = Math.atan2(ey - sy, ex - sx); g.moveTo(ex, ey); g.lineTo(ex - Math.cos(an - 0.5) * 18 * unit, ey - Math.sin(an - 0.5) * 18 * unit); g.lineTo(ex - Math.cos(an + 0.5) * 18 * unit, ey - Math.sin(an + 0.5) * 18 * unit); g.closePath(); g.fillStyle = P.accent; g.fill(); }
      const pulse = phase(u, st - 0.07, st + 0.05); if (pulse > 0 && pulse < 1) dot(g, lerp(sx, ex, EASE.inOut(pulse)), lerp(sy, ey, EASE.inOut(pulse)), 6 * unit, P.accent);
    }
    if (a <= 0) continue; const [x, y] = pos(i);
    g.save(); g.globalAlpha = a; g.translate(x, y); g.scale(lerp(0.9, 1, a), lerp(0.9, 1, a));
    shadowed(g, T.shadow, 30 * unit, 12 * unit, () => { rr(g, -nw / 2, -nh / 2, nw, nh, 24 * unit); g.fillStyle = T.card; g.fill(); });
    rr(g, -nw / 2, -nh / 2, 10 * unit, nh, 5 * unit); g.fillStyle = P.accent; g.fill();
    font(g, Math.min(36 * unit, nh * 0.34), 700); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(nodes[i], 0, 0); g.restore();
  }
}
function dashboard(g, e) {
  const { w, h, u, P, unit } = e; backdrop(g, w, h, P); const T = theme(P);
  const kpis = parseRows(P.kpis).slice(0, 4); const bars = String(P.bars ?? '').split(/[,\s]+/).map(Number).filter(Number.isFinite);
  const pad = w * 0.06, gw = w - pad * 2; const inK = EASE.out(phase(u, 0, 0.2));
  g.save(); g.globalAlpha = inK; g.translate(0, (1 - inK) * 40 * unit);
  if (P.title) { font(g, 48 * unit, 800); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = T.text; g.fillText(P.title, pad, h * 0.1); }
  const cols = kpis.length > 2 ? 2 : Math.max(1, kpis.length); const kw = (gw - (cols - 1) * 20 * unit) / cols, kh = 170 * unit;
  kpis.forEach((k, i) => {
    const x = pad + (i % cols) * (kw + 20 * unit), y = h * 0.16 + Math.floor(i / cols) * (kh + 20 * unit); const a = EASE.out(phase(u, 0.1 + i * 0.06, 0.25 + i * 0.06)); const v = k.a * EASE.smooth(phase(u, 0.15 + i * 0.06, 0.6));
    g.save(); g.globalAlpha = a; shadowed(g, T.shadow, 30 * unit, 10 * unit, () => { rr(g, x, y, kw, kh, 26 * unit); g.fillStyle = T.card; g.fill(); });
    font(g, 26 * unit, 600); g.fillStyle = T.sub; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(k.label, x + 26 * unit, y + 26 * unit);
    font(g, 58 * unit, 800); g.fillStyle = T.text; g.fillText(fmtNumber(v, P), x + 26 * unit, y + 70 * unit); g.restore();
  });
  const cy = h * 0.16 + Math.ceil(kpis.length / cols) * (kh + 20 * unit) + 10 * unit, ch = h * 0.92 - cy;
  if (bars.length && ch > 100 * unit) {
    const a = EASE.out(phase(u, 0.3, 0.45)); g.save(); g.globalAlpha = a; shadowed(g, T.shadow, 30 * unit, 10 * unit, () => { rr(g, pad, cy, gw, ch, 26 * unit); g.fillStyle = T.card; g.fill(); });
    const mx = Math.max(...bars) || 1; const bw = (gw - 80 * unit) / bars.length;
    bars.forEach((b, i) => { const k = EASE.smooth(phase(u, 0.4 + i * 0.03, 0.7 + i * 0.03)); const bh = (b / mx) * (ch - 90 * unit) * k; rr(g, pad + 40 * unit + i * bw + bw * 0.18, cy + ch - 40 * unit - bh, bw * 0.64, bh, 8 * unit); g.fillStyle = i === bars.length - 1 ? P.accent : mixHex(P.accent, T.card, 0.55); g.fill(); });
    g.restore();
  }
  g.restore();
}
function aiChat(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); backdrop(g, w, h, P);
  const cw = w * 0.88, x = (w - cw) / 2; const prompt = String(P.prompt ?? ''), reply = String(P.reply ?? '');
  const typed = prompt.slice(0, Math.round(prompt.length * phase(u, 0.04, 0.3)));
  const sent = u > 0.32; const thinking = phase(u, 0.34, 0.46); const words = reply.split(/(\s+)/); const shown = words.slice(0, Math.round(words.length * EASE.linear(phase(u, 0.46, 0.9)))).join('');
  g.save(); shadowed(g, T.shadow, 60 * unit, 24 * unit, () => { rr(g, x, h * 0.08, cw, h * 0.84, 34 * unit); g.fillStyle = T.card; g.fill(); }); g.restore();
  let y = h * 0.14;
  if (sent) { font(g, 32 * unit, 500); const lines = textLines(g, prompt, cw * 0.62); const bw = Math.min(cw * 0.7, Math.max(...lines.map((l) => g.measureText(l).width)) + 50 * unit), bh = lines.length * 44 * unit + 34 * unit;
    rr(g, x + cw - bw - 30 * unit, y, bw, bh, 28 * unit); g.fillStyle = mixHex(T.card, P.accent, 0.1); g.fill(); g.fillStyle = T.text; g.textAlign = 'left'; g.textBaseline = 'top'; lines.forEach((l, i) => g.fillText(l, x + cw - bw - 5 * unit, y + 18 * unit + i * 44 * unit)); y += bh + 40 * unit; }
  if (sent && thinking < 1 && !shown) { for (let i = 0; i < 3; i++) { const a = 0.35 + 0.65 * Math.max(0, Math.sin((u * 18 - i * 0.7))); dot(g, x + 50 * unit + i * 26 * unit, y + 20 * unit, 7 * unit * a, T.sub); } }
  if (shown) { font(g, 32 * unit, 450); g.fillStyle = T.text; g.textAlign = 'left'; g.textBaseline = 'top'; textLines(g, shown, cw - 80 * unit).slice(0, 14).forEach((l, i) => g.fillText(l, x + 40 * unit, y + i * 46 * unit)); }
  /* the composer, where the prompt is typed */
  const by = h * 0.8; rr(g, x + 24 * unit, by, cw - 48 * unit, 90 * unit, 45 * unit); g.fillStyle = mixHex(T.card, T.text, 0.04); g.fill(); g.strokeStyle = T.line; g.lineWidth = 2; g.stroke();
  font(g, 30 * unit, 500); g.fillStyle = sent ? T.sub : T.text; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(sent ? (P.placeholder || 'Ask anything') : `${typed}${Math.floor(u * 30) % 2 ? '|' : ''}`, x + 60 * unit, by + 45 * unit);
  if (P.illustrative !== false) { font(g, 18 * unit, 500); g.fillStyle = T.sub; g.textAlign = 'center'; g.fillText('Illustrative conversation', w / 2, h * 0.95); }
}
function pricing(g, e) {
  const { w, h, u, P, unit } = e; const T = theme(P); backdrop(g, w, h, P);
  const plans = String(P.plans ?? '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [name, price, ...feat] = l.split('|').map((s) => s.trim()); return { name, price, feat }; });
  if (!plans.length) return; const n = plans.length; const gap = 24 * unit; const pw = Math.min(w * 0.8, (w * 0.9 - gap * (n - 1)) / n); const total = pw * n + gap * (n - 1);
  const featured = clamp(Math.round((P.featuredPlan ?? 2) - 1), 0, n - 1);
  plans.forEach((p, i) => {
    const a = EASE.out(phase(u, 0.05 + i * 0.08, 0.3 + i * 0.08)); const x = (w - total) / 2 + i * (pw + gap); const ph = h * 0.62 * (i === featured ? 1.06 : 1); const y = h / 2 - ph / 2 + (1 - a) * 60 * unit;
    g.save(); g.globalAlpha = a; shadowed(g, T.shadow, 50 * unit, 18 * unit, () => { rr(g, x, y, pw, ph, 30 * unit); g.fillStyle = i === featured ? P.accent : T.card; g.fill(); });
    const fg = i === featured ? '#ffffff' : T.text, sub = i === featured ? 'rgba(255,255,255,0.8)' : T.sub;
    font(g, 30 * unit, 700); g.fillStyle = sub; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(p.name || '', x + 30 * unit, y + 34 * unit);
    font(g, 64 * unit, 850); g.fillStyle = fg; g.fillText(p.price || '', x + 30 * unit, y + 80 * unit);
    font(g, 26 * unit, 500); p.feat.forEach((f, j) => { const fa = EASE.out(phase(u, 0.3 + i * 0.08 + j * 0.04, 0.4 + i * 0.08 + j * 0.04)); g.globalAlpha = a * fa; g.fillStyle = fg; g.fillText(`✓  ${f}`, x + 30 * unit, y + 190 * unit + j * 46 * unit); });
    g.restore();
  });
}
function endCard(g, e) {
  const { w, h, u, P, unit, media: M } = e; backdrop(g, w, h, P); const T = theme(P); const logo = M('logo');
  const a = EASE.out(phase(u, 0.05, 0.3)); const s = lerp(0.85, 1, EASE.out(phase(u, 0.05, 0.4)));
  g.save(); g.globalAlpha = a; g.translate(w / 2, h * 0.42); g.scale(s, s);
  const lw = Math.min(w, h) * 0.26; if (logo) drawMedia(g, logo, -lw / 2, -lw / 2, lw, lw, lw * 0.22, 'contain'); else { rr(g, -lw / 2, -lw / 2, lw, lw, lw * 0.26); g.fillStyle = P.accent; g.fill(); font(g, lw * 0.5, 850); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(String(P.name || 'A').slice(0, 1), 0, 4 * unit); }
  g.restore();
  const b = EASE.out(phase(u, 0.25, 0.45)); g.save(); g.globalAlpha = b; g.textAlign = 'center'; g.textBaseline = 'middle';
  font(g, 76 * unit, 850); g.fillStyle = T.text; g.fillText(P.name || '', w / 2, h * 0.62 + (1 - b) * 16 * unit);
  font(g, 34 * unit, 550); g.fillStyle = T.sub; g.fillText(P.tagline || '', w / 2, h * 0.68 + (1 - b) * 16 * unit);
  const c = EASE.out(phase(u, 0.45, 0.6)); if (P.cta) { g.globalAlpha = c; font(g, 34 * unit, 700); const tw = g.measureText(P.cta).width + 80 * unit; rr(g, w / 2 - tw / 2, h * 0.75, tw, 84 * unit, 42 * unit); g.fillStyle = P.accent; g.fill(); g.fillStyle = '#fff'; g.fillText(P.cta, w / 2, h * 0.75 + 42 * unit); }
  g.restore();
}
function locationLabel(g, e) {
  const { w, h, u, P, unit, world } = e; const p = P.place && Number.isFinite(P.place.lat) ? P.place : null; const style = MAP_STYLES[P.mapStyle] ?? MAP_STYLES.minimal;
  if (!p) { g.fillStyle = style.sea; g.fillRect(0, 0, w, h); label(g, 'Choose a place', w / 2, h / 2, 34 * unit, style.label, style.halo, 'center'); return; }
  const k = EASE.inOut(phase(u, 0, 0.55)); const far = { lon: p.lon, my: mercY(p.lat), dpp: 140 / w }, near = { lon: p.lon, my: mercY(p.lat), dpp: (P.zoomSpan ?? 12) / w };
  const hl = P.highlightCountry && p.country ? Object.assign(new Set([p.country]), { color: mixHex(style.land, P.accent, 0.3) }) : null;
  const m = drawFlatWorld(g, world, lerpCam(far, near, k), w, h, style, hl);
  const a = EASE.out(phase(u, 0.45, 0.62)); const x = m.x(p.lon), y = m.y(p.lat);
  pin(g, x, y, unit * 2, P.accent, a);
  if (a > 0) { g.save(); g.globalAlpha = a; label(g, p.label || p.name, x, y - 70 * unit, 46 * unit, style.label, style.halo, 'center', 800); if (p.country) label(g, p.country, x, y - 30 * unit, 26 * unit, style.label, style.halo, 'center', 550); g.restore(); }
  attribution(g, w, h, unit, style.label);
}
function connections(g, e) {
  const { w, h, u, P, unit, world } = e; const pts = Array.isArray(P.points) ? P.points.filter((p) => Number.isFinite(p?.lat)) : []; const style = MAP_STYLES[P.mapStyle] ?? MAP_STYLES.dark;
  const cam = { lon: P.centerLon ?? 10, my: mercY(20), dpp: 360 / (w * 1.02) }; const m = drawFlatWorld(g, world, cam, w, h, style);
  const hub = pts[0]; if (!hub) return;
  pts.slice(1).forEach((p, i) => {
    const path = greatCircle([hub, p], 48); const k = EASE.inOut(phase(u, 0.06 + i * 0.06, 0.4 + i * 0.06)); if (k <= 0) return;
    g.beginPath(); const nn = Math.max(2, Math.round(path.length * k)); for (let j = 0; j < nn; j++) { const [la, lo] = path[j]; const x = m.x(lo), y = m.y(la); if (j) g.lineTo(x, y); else g.moveTo(x, y); }
    g.strokeStyle = rgba(P.accent, 0.85); g.lineWidth = 3 * unit; g.shadowColor = rgba(P.accent, 0.7); g.shadowBlur = 10 * unit; g.stroke(); g.shadowBlur = 0;
    if (k > 0.98) dot(g, m.x(p.lon), m.y(p.lat), 6 * unit, P.accent, phase(u, 0.5, 1));
  });
  dot(g, m.x(hub.lon), m.y(hub.lat), 9 * unit, P.accent, (u * 2) % 1);
  if (P.illustrative !== false) { font(g, 18 * unit, 500); g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillStyle = rgba(style.label, 0.5); g.fillText('Illustrative connections', 14 * unit, h - 10 * unit); }
  attribution(g, w, h, unit, style.label);
}

export const MG_CATEGORIES = ['Featured', 'Travel & Maps', 'Data', 'Text', 'Explainer', 'SaaS'];
const sample = (lat, lon, name, country) => ({ name, lat, lon, country, label: name });
export const GRAPHICS = [
  F({ id: 'mg.flight', name: 'Travel Route', category: 'Travel & Maps', featured: true, duration: 6, sfx: 'whoosh', draw: flightJourney, map: true,
    about: 'A plane flies — or a car drives — between real places on a colourful map: pins drop in, the route draws as it goes, and a badge counts the real distance.',
    params: [place('from', 'From'), places('stops', 'Stops'), place('to', 'To'), select('vehicle', 'Vehicle', ['airplane', 'car', 'jet', 'paper', 'smallplane', 'train', 'ship', 'walker']),
      select('route', 'Route', ['curved', 'great', 'straight', 'road']), num('curve', 'Curve', -0.6, 0.6, 0.01), select('pattern', 'Line', ['dashed', 'solid', 'dotted']), select('trail', 'Trail', ['none', 'fade', 'glow']),
      select('mapStyle', 'Map', Object.keys(MAP_STYLES)), select('camera', 'Camera', ['static', 'follow', 'cinematic']), select('markerStyle', 'Markers', ['pin', 'dot']), bool('labels', 'Labels'), bool('showCountry', 'Show country'),
      bool('showDistance', 'Distance badge'), bool('contrail', 'Contrail'), bool('highlight', 'Highlight countries'), num('lineWidth', 'Line width', 2, 14, 0.5), num('vehicleSize', 'Vehicle size', 0.8, 3, 0.05), num('pinSize', 'Pin size', 0.8, 3, 0.05),
      color('accent2', 'Route end colour'), color('vehicleColor', 'Vehicle colour'), num('takeoff', 'Start delay', 0.04, 0.4, 0.01), num('arrival', 'Arrival hold', 0.04, 0.4, 0.01), text('title', 'Title'), ...BRAND],
    defaults: { from: sample(51.5072, -0.1276, 'London', 'United Kingdom'), to: sample(48.8566, 2.3522, 'Paris', 'France'), stops: [], vehicle: 'airplane', route: 'curved', curve: 0.25, pattern: 'dashed', trail: 'none', mapStyle: 'minimal',
      camera: 'static', markerStyle: 'pin', labels: true, showCountry: true, showDistance: true, contrail: true, highlight: true, lineWidth: 6, vehicleSize: 1.6, pinSize: 1.6, accent2: '#397aa9', vehicleColor: '', takeoff: 0.16, arrival: 0.16, title: '', accent: '#4568ee', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.earth', name: 'Earth Zoom', category: 'Travel & Maps', featured: true, duration: 4, sfx: 'rise', draw: earthZoom, map: true,
    about: 'An illustrated globe (Natural Earth outlines) turns to a destination and zooms down to it — or pulls back to space, or travels from one place to another — and can hand off into your own footage.',
    params: [select('mode', 'Direction', ['in', 'out', 'between']), place('from', 'From (between)'), place('to', 'Destination'), media('destination', 'End on footage'), num('depth', 'Zoom depth', 6, 120, 1), num('spin', 'Globe turn', 0, 180, 1),
      num('atmosphere', 'Atmosphere', 0, 1, 0.01), num('clouds', 'Clouds', 0, 1, 0.01), num('night', 'Night side', 0, 1, 0.01), num('sunAngle', 'Light direction', -180, 180, 1), num('hold', 'Destination hold', 0, 0.5, 0.01),
      color('land', 'Land'), color('sea', 'Ocean'), bool('labels', 'Labels'), ...BRAND],
    defaults: { mode: 'in', from: sample(51.5072, -0.1276, 'London', 'United Kingdom'), to: sample(-33.8688, 151.2093, 'Sydney', 'Australia'), destination: null, depth: 45, spin: 70, atmosphere: 0.8, clouds: 0.5, night: 0.35, sunAngle: -30, hold: 0.15,
      land: '#8fb174', sea: '#0f3b6f', labels: true, accent: '#ff4d4f', theme: 'dark', speed: 'Smooth' } }),
  F({ id: 'mg.location', name: 'Location Reveal', category: 'Travel & Maps', duration: 3.5, draw: locationLabel, map: true, about: 'The map zooms to a place and pins it, with its name and country.',
    params: [place('place', 'Place'), num('zoomSpan', 'Final view (°)', 2, 60, 1), bool('highlightCountry', 'Highlight its country'), select('mapStyle', 'Map', Object.keys(MAP_STYLES)), ...BRAND],
    defaults: { place: sample(48.8566, 2.3522, 'Paris', 'France'), zoomSpan: 12, highlightCountry: true, mapStyle: 'minimal', accent: '#e11d48', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.connections', name: 'World Connections', category: 'Travel & Maps', duration: 4, draw: connections, map: true, about: 'Glowing great-circle lines from a hub to other places. Marked as illustrative unless they show real activity.',
    params: [places('points', 'Places (first is the hub)'), select('mapStyle', 'Map', Object.keys(MAP_STYLES)), num('centerLon', 'Map centre', -180, 180, 1), bool('illustrative', 'Label as illustrative'), ...BRAND],
    defaults: { points: [sample(37.7749, -122.4194, 'San Francisco', 'United States'), sample(51.5072, -0.1276, 'London', 'United Kingdom'), sample(35.6895, 139.6917, 'Tokyo', 'Japan'), sample(-23.5505, -46.6333, 'São Paulo', 'Brazil'), sample(19.076, 72.8777, 'Mumbai', 'India')],
      mapStyle: 'dark', centerLon: 10, illustrative: true, accent: '#38bdf8', theme: 'dark', speed: 'Smooth' } }),

  F({ id: 'mg.counter', name: 'Number Counter', category: 'Data', featured: true, duration: 3, draw: counter, about: 'A number counts from one value to another, formatted as you like.',
    params: [num('from', 'From', -1e9, 1e12, 1), num('to', 'To', -1e9, 1e12, 1), text('prefix', 'Prefix'), text('suffix', 'Suffix'), num('decimals', 'Decimals', 0, 4, 1), bool('separator', 'Thousands separator'), text('caption', 'Caption'), num('size', 'Size', 60, 320, 1),
      select('background', 'Background', ['theme', 'accent', 'none']), ...BRAND],
    defaults: { from: 0, to: 1250000, prefix: '', suffix: '', decimals: 0, separator: true, caption: 'downloads this year', size: 170, background: 'theme', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.bars', name: 'Bar Chart Race', category: 'Data', duration: 5, draw: barChart, about: 'Bars grow in, then change to new values and re-rank smoothly. One row per line: label, start value, end value.',
    params: [text('title', 'Title'), list('data', 'Data', 'Label, value, new value'), bool('race', 'Re-rank as values change'), text('prefix', 'Prefix'), text('suffix', 'Suffix'), num('decimals', 'Decimals', 0, 3, 1), ...BRAND],
    defaults: { title: 'Most used languages', data: 'Python, 42, 48\nJavaScript, 55, 51\nTypeScript, 28, 39\nGo, 18, 21\nRust, 12, 24', race: true, prefix: '', suffix: '%', decimals: 0, accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.line', name: 'Line Graph', category: 'Data', duration: 4, draw: lineGraph, about: 'A line traces through your values; each point and its label appear as it passes.',
    params: [text('title', 'Title'), text('values', 'Values (comma separated)'), bool('showValues', 'Show values'), text('prefix', 'Prefix'), text('suffix', 'Suffix'), ...BRAND],
    defaults: { title: 'Monthly revenue', values: '12, 18, 16, 24, 31, 29, 42', showValues: true, prefix: '$', suffix: 'k', accent: '#16a34a', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.donut', name: 'Donut Chart', category: 'Data', duration: 4, draw: donut, about: 'Segments sweep in one after another, with a legend.',
    params: [text('title', 'Centre text'), list('data', 'Segments', 'Label, value'), num('thickness', 'Thickness', 0.1, 0.6, 0.01), ...BRAND],
    defaults: { title: 'Traffic', data: 'Search, 46\nSocial, 28\nDirect, 18\nOther, 8', thickness: 0.32, accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.ring', name: 'Progress Ring', category: 'Data', duration: 3, draw: progressRing, params: [num('percent', 'Percent', 0, 100, 1), text('caption', 'Caption'), ...BRAND],
    defaults: { percent: 82, caption: 'of goal reached', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.change', name: 'Percentage Change', category: 'Data', duration: 3, draw: percentChange, params: [num('value', 'Change (%)', -1000, 1000, 0.1), num('decimals', 'Decimals', 0, 2, 1), text('caption', 'Caption'), color('upColor', 'Up colour'), color('downColor', 'Down colour'), ...BRAND],
    defaults: { value: 38, decimals: 0, caption: 'more sign-ups than last month', upColor: '#16a34a', downColor: '#dc2626', accent: '#16a34a', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.ranking', name: 'Ranking List', category: 'Data', duration: 5, draw: rankingList, params: [text('title', 'Title'), list('items', 'Items', 'One per line, first is #1'), bool('countdown', 'Reveal from the bottom'), ...BRAND],
    defaults: { title: 'Top 5 cities to visit', items: 'Kyoto\nLisbon\nCape Town\nVancouver\nBuenos Aires', countdown: true, accent: '#f59e0b', theme: 'light', speed: 'Smooth' } }),

  F({ id: 'mg.lower', name: 'Lower Third', category: 'Text', featured: true, duration: 4, draw: lowerThird, transparent: true, params: [text('title', 'Name'), text('subtitle', 'Role'), select('position', 'Position', ['bottom', 'top']), bool('exit', 'Animate out'), ...BRAND],
    defaults: { title: 'Alex Morgan', subtitle: 'Product designer', position: 'bottom', exit: true, accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.chapter', name: 'Chapter Title', category: 'Text', duration: 3, draw: chapterTitle, params: [text('kicker', 'Chapter'), text('title', 'Title'), num('size', 'Size', 40, 180, 1), select('background', 'Background', ['theme', 'transparent']), ...BRAND],
    defaults: { kicker: 'Chapter 2', title: 'How it really works', size: 96, background: 'theme', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.kinetic', name: 'Kinetic Text', category: 'Text', duration: 3.5, draw: kineticText, params: [text('text', 'Text'), text('emphasis', 'Highlight word'), select('style', 'Style', ['rise', 'pop']), num('size', 'Size', 40, 200, 1), select('background', 'Background', ['theme', 'transparent']), ...BRAND],
    defaults: { text: 'Most people never notice this', emphasis: 'never', style: 'rise', size: 110, background: 'theme', accent: '#e11d48', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.quote', name: 'Quote Card', category: 'Text', duration: 5, draw: quoteCard, params: [text('quote', 'Quote'), text('author', 'Author'), ...BRAND],
    defaults: { quote: 'The best way to predict the future is to invent it.', author: 'Alan Kay', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),

  F({ id: 'mg.folder', name: 'Open Folder', category: 'Explainer', featured: true, duration: 4, sfx: 'pop', draw: openFolder,
    about: 'A folder enters, opens, and your photos rise out and fan; one of them grows to fill the frame (or stays a floating card).',
    params: [num('count', 'Items', 1, 6, 1), media('item1', 'Item 1'), media('item2', 'Item 2'), media('item3', 'Item 3'), media('item4', 'Item 4'), media('item5', 'Item 5'), media('item6', 'Item 6'),
      select('folderStyle', 'Folder', Object.keys(FOLDERS)), color('folderColor', 'Folder colour'), text('label', 'Label'), select('arrange', 'Arrangement', ['fan', 'stack', 'grid']), num('spacing', 'Spacing', 0.4, 1.6, 0.01),
      num('focus', 'Expand item', 1, 6, 1), select('final', 'End as', ['fullscreen', 'card']), num('angle', 'Opening angle', 0.2, 0.9, 0.01), num('size', 'Folder size', 0.4, 0.9, 0.01), bool('reverse', 'Reverse (close)'), select('background', 'Background', ['theme', 'transparent']), ...BRAND],
    defaults: { count: 3, item1: null, item2: null, item3: null, item4: null, item5: null, item6: null, folderStyle: 'desktop', folderColor: '', label: 'Memories', arrange: 'fan', spacing: 1, focus: 2, final: 'fullscreen', angle: 0.55, size: 0.62, reverse: false, background: 'theme', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.highlight', name: 'Highlight & Arrow', category: 'Explainer', duration: 3, draw: highlight, transparent: true, about: 'Draws a box, circle or arrow onto a point of your picture, with an optional note.',
    params: [select('shape', 'Shape', ['box', 'circle', 'arrow']), num('x', 'X', 0, 1, 0.005), num('y', 'Y', 0, 1, 0.005), num('width', 'Width', 0.05, 1, 0.005), num('height', 'Height', 0.03, 1, 0.005), num('stroke', 'Stroke', 2, 20, 0.5), num('dim', 'Dim the rest', 0, 0.8, 0.01), text('note', 'Note'), media('background', 'Picture (optional)'), ...BRAND],
    defaults: { shape: 'box', x: 0.5, y: 0.45, width: 0.5, height: 0.12, stroke: 8, dim: 0.35, note: 'Look here', background: null, accent: '#facc15', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.steps', name: 'Step by Step', category: 'Explainer', duration: 5, draw: stepsProcess, params: [list('steps', 'Steps', 'One per line'), ...BRAND],
    defaults: { steps: 'Pick a topic\nWrite the hook\nRecord the voice\nAdd motion graphics', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.timeline', name: 'Timeline of Events', category: 'Explainer', duration: 5, draw: eventsTimeline, params: [list('events', 'Events', 'When — what'), ...BRAND],
    defaults: { events: '1969 — First Moon landing\n1990 — Hubble launched\n2021 — Webb telescope launched\n2030 — Next crewed landing planned', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.checklist', name: 'Checklist', category: 'Explainer', duration: 4, draw: checklist, params: [text('title', 'Title'), list('items', 'Items', 'One per line'), ...BRAND],
    defaults: { title: 'Before you post', items: 'Strong first second\nCaptions on\nOne clear idea\nA reason to watch to the end', accent: '#16a34a', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.countdown', name: 'Countdown', category: 'Explainer', duration: 5, draw: countdown, params: [num('from', 'From (s)', 1, 600, 1), select('format', 'Format', ['seconds', 'clock']), text('caption', 'Caption'), ...BRAND],
    defaults: { from: 5, format: 'seconds', caption: 'Starting soon', accent: '#e11d48', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.beforeafter', name: 'Before / After', category: 'Explainer', duration: 4, draw: beforeAfter, params: [media('before', 'Before'), media('after', 'After'), text('beforeLabel', 'Before label'), text('afterLabel', 'After label'), ...BRAND],
    defaults: { before: null, after: null, beforeLabel: 'Before', afterLabel: 'After', accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.polaroids', name: 'Polaroid Stack', category: 'Explainer', duration: 4, draw: polaroids, params: [num('count', 'Photos', 1, 6, 1), media('photo1', 'Photo 1'), media('photo2', 'Photo 2'), media('photo3', 'Photo 3'), media('photo4', 'Photo 4'), list('captions', 'Captions', 'One per photo'), num('scatter', 'Scatter', 0, 2, 0.01), ...BRAND],
    defaults: { count: 4, photo1: null, photo2: null, photo3: null, photo4: null, captions: 'Day one\nThe view\nBest meal\nHome', scatter: 1, accent: '#2563eb', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.notification', name: 'Notification', category: 'Explainer', duration: 3, sfx: 'pop', draw: notification, transparent: true, params: [text('app', 'App'), text('message', 'Message'), text('when', 'Time'), media('icon', 'Icon'), ...BRAND],
    defaults: { app: 'Messages', message: 'You won’t believe what just happened…', when: 'now', icon: null, accent: '#22c55e', theme: 'light', speed: 'Smooth' } }),

  F({ id: 'mg.appwindow', name: 'App Window Reveal', category: 'SaaS', featured: true, duration: 3, draw: appWindow, about: 'Your screenshot or screen recording in a window that rises in perspective and settles.',
    params: [media('screen', 'Screen'), text('title', 'Window title'), num('width', 'Width', 0.5, 0.98, 0.01), select('aspect', 'Shape', ['wide', 'tall']), num('radius', 'Corners', 0, 40, 1), num('perspective', 'Perspective', 0, 1, 0.01), select('fit', 'Fit', ['cover', 'contain']), bool('exit', 'Animate out'), ...BRAND],
    defaults: { screen: null, title: 'Dashboard', width: 0.88, aspect: 'wide', radius: 22, perspective: 0.5, fit: 'cover', exit: false, accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.floating', name: 'Floating UI Showcase', category: 'SaaS', featured: true, duration: 5, draw: floatingUI, about: 'Interface cards enter one by one in layered depth while the camera drifts slowly across them.',
    params: [num('count', 'Cards', 1, 6, 1), media('card1', 'Card 1'), media('card2', 'Card 2'), media('card3', 'Card 3'), media('card4', 'Card 4'), media('card5', 'Card 5'), media('card6', 'Card 6'), text('headline', 'Headline'),
      num('spacing', 'Spacing', 0.5, 1.4, 0.01), num('cardScale', 'Card size', 0.6, 1.4, 0.01), num('stagger', 'Stagger', 0.02, 0.15, 0.005), num('camera', 'Camera drift', 0, 2, 0.01), num('depthBlur', 'Depth blur', 0, 1, 0.01), ...BRAND],
    defaults: { count: 4, card1: null, card2: null, card3: null, card4: null, card5: null, card6: null, headline: 'Everything in one place', spacing: 1, cardScale: 1, stagger: 0.06, camera: 1, depthBlur: 0.5, accent: '#6366f1', theme: 'dark', speed: 'Smooth' } }),
  F({ id: 'mg.callout', name: 'Feature Callout', category: 'SaaS', duration: 4, draw: featureCallout, about: 'The camera pushes into one part of your screenshot, outlines it and slides in a note.',
    params: [media('screen', 'Screenshot'), num('x', 'Target X', 0, 1, 0.005), num('y', 'Target Y', 0, 1, 0.005), num('boxW', 'Box width', 0.05, 1, 0.005), num('boxH', 'Box height', 0.02, 1, 0.005), num('zoom', 'Zoom', 1, 3, 0.01), text('note', 'Note'), select('noteAt', 'Note position', ['bottom', 'top']), ...BRAND],
    defaults: { screen: null, x: 0.5, y: 0.35, boxW: 0.5, boxH: 0.08, zoom: 1.6, note: 'Export in one click', noteAt: 'bottom', accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.cursor', name: 'Cursor Demo', category: 'SaaS', duration: 5, sfx: 'click', draw: cursorDemo, about: 'A cursor glides between points on your screen and clicks where you mark it (x y click per line, 0–1). It shows motion, not a real interaction.',
    params: [media('screen', 'Screen'), list('path', 'Path', 'x y click (1 = click)'), num('cursorSize', 'Cursor size', 0.6, 3, 0.05), ...BRAND],
    defaults: { screen: null, path: '0.2 0.8 0\n0.62 0.32 1\n0.4 0.55 0\n0.78 0.7 1', cursorSize: 1.4, accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.workflow', name: 'Workflow Diagram', category: 'SaaS', duration: 5, draw: workflow, params: [list('nodes', 'Steps', 'One per line'), select('direction', 'Direction', ['vertical', 'horizontal']), ...BRAND],
    defaults: { nodes: 'User input\nAI processing\nAutomated actions\nFinal result', direction: 'vertical', accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.dashboard', name: 'Dashboard Reveal', category: 'SaaS', duration: 5, draw: dashboard, params: [text('title', 'Title'), list('kpis', 'Metrics', 'Label, value'), text('bars', 'Chart values'), text('prefix', 'Prefix'), text('suffix', 'Suffix'), ...BRAND],
    defaults: { title: 'This week', kpis: 'Active users, 18420\nRevenue, 92300\nConversion, 4.8\nNPS, 61', bars: '32, 41, 38, 52, 49, 61, 74', prefix: '', suffix: '', accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.aichat', name: 'AI Chat Demo', category: 'SaaS', duration: 6, draw: aiChat, about: 'A prompt is typed, the assistant thinks, and a reply streams in. Every word is yours to write; it is labelled as illustrative.',
    params: [text('prompt', 'Prompt'), text('reply', 'Reply'), text('placeholder', 'Composer hint'), bool('illustrative', 'Label as illustrative'), ...BRAND],
    defaults: { prompt: 'Summarise this week’s sales in one line', reply: 'Sales rose 12% week over week, led by the new annual plan.', placeholder: 'Ask anything', illustrative: true, accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.pricing', name: 'Pricing Cards', category: 'SaaS', duration: 4, draw: pricing, params: [list('plans', 'Plans', 'Name | price | feature | feature'), num('featuredPlan', 'Featured plan', 1, 4, 1), ...BRAND],
    defaults: { plans: 'Starter | $0 | 3 projects | Community support\nPro | $19 | Unlimited projects | Brand kits | Priority export\nTeam | $49 | Everything in Pro | Shared library', featuredPlan: 2, accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
  F({ id: 'mg.endcard', name: 'Brand End Card', category: 'SaaS', duration: 3.5, draw: endCard, params: [media('logo', 'Logo'), text('name', 'Name'), text('tagline', 'Tagline'), text('cta', 'Button'), ...BRAND],
    defaults: { logo: null, name: 'Your brand', tagline: 'Make something people love', cta: 'Try it free', accent: '#6366f1', theme: 'light', speed: 'Smooth' } }),
];
export const graphicById = (id) => GRAPHICS.find((x) => x.id === id);
export const MEDIA_KEYS = (def) => def.params.filter((p) => p.type === 'media').map((p) => p.key);

/** Brand kits: one look applied to every graphic's colours and motion, each graphic still overridable. */
export const BRAND_KITS = {
  'Premium Light': { accent: '#2563eb', theme: 'light', speed: 'Smooth' },
  'Dark Technology': { accent: '#6366f1', theme: 'dark', speed: 'Smooth' },
  Editorial: { accent: '#e11d48', theme: 'light', speed: 'Gentle' },
  Documentary: { accent: '#b45309', theme: 'light', speed: 'Gentle', mapStyle: 'atlas' },
  'Modern SaaS': { accent: '#7c3aed', theme: 'light', speed: 'Smooth' },
  Cinematic: { accent: '#f59e0b', theme: 'dark', speed: 'Gentle' },
  'Playful Creator': { accent: '#ec4899', theme: 'light', speed: 'Snappy' },
  'Minimal Monochrome': { accent: '#111111', theme: 'light', speed: 'Smooth', mapStyle: 'mono' },
};

/**
 * Paints frame t of graphic `layer` (its `graphic` id and `params`) into context g of w × h.
 * media(key) returns the loaded <img>/<video> for a media param (or null); world is decodeWorld(data) or null.
 * @param {CanvasRenderingContext2D} g @param {number} w @param {number} h @param {{ graphic: string, duration?: number, params?: object }} layer
 * @param {number} t @param {(key: string) => (CanvasImageSource | null)} [media] @param {any} [world]
 */
export function renderGraphic(g, w, h, layer, t, media = () => null, world = null) {
  const def = graphicById(layer.graphic); if (!def) return;
  const duration = Math.max(0.1, layer.duration || def.duration);
  const P = { ...def.defaults, ...(layer.params || {}) };
  const u = clamp(t / duration);
  g.save(); g.clearRect(0, 0, w, h);
  def.draw(g, { w, h, u, t, duration, P, world, unit: Math.min(w, h) / 1080, media });
  g.restore();
}
