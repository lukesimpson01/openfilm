import { sampleProperty, PROPERTY_DEFS } from './engine.js';
import { loadLayerFonts } from './font-runtime.js';
import {trackingSpan,transformPoint} from './universal-motion.js';
import {observationAt} from './universal-core.js';

let data = JSON.parse(document.getElementById('layer').textContent);
/* a page is one layer, or a group of them (a story): each has its own `start` inside the page, in seconds */
const W = () => innerWidth, H = () => innerHeight;
const px = () => W() / 720; /* FRAME sizes are authored on a 720-wide stage */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const root = document.createElement('div');
root.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:transparent';
document.documentElement.style.background = 'transparent';
document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden';
document.body.appendChild(root);

const shapePoints = {
  triangle: () => '50,2 98,98 2,98',
  diamond: () => '50,2 98,50 50,98 2,50',
  star: () => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 22 : 48; return `${(50 + Math.cos(a) * r).toFixed(2)},${(50 + Math.sin(a) * r).toFixed(2)}`; }).join(' '),
  polygon: (n) => Array.from({ length: Math.max(3, n || 6) }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(3, n || 6); return `${(50 + Math.cos(a) * 48).toFixed(2)},${(50 + Math.sin(a) * 48).toFixed(2)}`; }).join(' '),
};

function makeItem(given) {
const layer = { ...given, start: 0 };
const startAt = given.start || 0;
const val = (key, t) => {
  const v = sampleProperty(layer, key, t, {});
  return v === undefined || v === null ? PROPERTY_DEFS[key]?.default : v;
};
const el = document.createElement('div');
el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform,opacity';
root.appendChild(el);
let inner;
function build() {
  if (layer.kind === 'shape') {
    const type = layer.shapeType || 'rect';
    if (type === 'rect' || type === 'ellipse') {
      inner = document.createElement('div');
      inner.style.cssText = 'position:absolute;inset:0;box-sizing:border-box';
    } else {
      inner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      inner.setAttribute('viewBox', '0 0 100 100');
      inner.setAttribute('preserveAspectRatio', 'none');
      inner.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      inner.appendChild(g);
      let shape;
      if (type === 'line' || type === 'arrow') {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', type === 'line' ? 'M2 50H98' : 'M2 50H92M76 30L98 50L76 70');
        shape.setAttribute('fill', 'none'); shape.setAttribute('stroke-linecap', 'round'); shape.setAttribute('stroke-linejoin', 'round');
      } else {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', (shapePoints[type] || shapePoints.polygon)(layer.sides));
        shape.setAttribute('stroke-linejoin', 'round');
      }
      shape.setAttribute('vector-effect', 'non-scaling-stroke');
      inner.appendChild(shape);
      inner._shape = shape;
    }
  } else if (layer.kind === 'image') {
    inner = document.createElement('img');
    inner.src = layer.src;
    inner.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    inner.decoding = 'sync';
  } else {
    inner = document.createElement('div');
    inner.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);white-space:pre-wrap;text-align:center;line-height:1.12;display:inline-block';
  }
  el.appendChild(inner);
}
build();

const ready = (async () => {
  const jobs = [];
  if (layer.kind === 'text') {
    const w = layer.weight || (layer.bold ? 700 : 400), f = layer.font || 'Inter, system-ui, sans-serif';
    jobs.push(document.fonts.load(`${w} 40px ${f}`).catch(() => {}));
  }
  if (layer.kind === 'image') jobs.push(inner.decode().catch(() => {}));
  await Promise.all(jobs);
})();

function frame(t) {
  const w = W(), h = H(), u = px();
  /* the clip's own length ends the layer (a trimmed or stretched clip), not the length it was made with */
  const visible = t >= 0;
  el.style.display = visible ? '' : 'none';
  if (!visible || layer.hidden) { el.style.display = 'none'; return; }
  let x = val('x', t), y = val('y', t); const scale = val('scale', t) / 100, rot = val('rotation', t), skew = val('skewX', t);
  const lw = (val('width', t) / 100) * w, lh = (val('height', t) / 100) * h;
  const isText = layer.kind === 'text';
  /* a text layer is as big as its text; a shape or image has the width/height it is given */
  el.style.width = isText ? '0px' : `${lw}px`;
  el.style.height = isText ? '0px' : `${lh}px`;
  const ax = val('anchorX', t), ay = val('anchorY', t);
  const base = `translate(${((x / 100) * w).toFixed(2)}px, ${((y / 100) * h).toFixed(2)}px) translate(${isText ? 0 : -lw / 2}px, ${isText ? 0 : -lh / 2}px)`;
  el.style.transform = `${base} rotate(${rot}deg) ${skew ? `skewX(${skew}deg)` : ''} scale(${scale * (layer.flipH ? -1 : 1)}, ${scale * (layer.flipV ? -1 : 1)}) translate(${-(ax / 100) * lw}px, ${-(ay / 100) * lh}px)`;
  el.style.opacity = String(clamp(val('opacity', t) / 100, 0, 1));
  const f = [];
  const blur = val('blur', t), br = val('brightness', t), co = val('contrast', t), sa = val('saturation', t), hu = val('hue', t), glow = val('glow', t), sh = val('shadowBlur', t);
  const color = val('color', t);
  if (blur > 0.05) f.push(`blur(${(blur * u).toFixed(2)}px)`);
  if (Math.abs(br - 100) > 0.5) f.push(`brightness(${br}%)`);
  if (Math.abs(co - 100) > 0.5) f.push(`contrast(${co}%)`);
  if (Math.abs(sa - 100) > 0.5) f.push(`saturate(${sa}%)`);
  if (Math.abs(hu) > 0.5) f.push(`hue-rotate(${hu}deg)`);
  if (glow > 0.5) f.push(`drop-shadow(0 0 ${(glow * u).toFixed(1)}px ${layer.glowColor || (layer.kind === 'shape' ? color : '#ffffff')})`);
  else if (sh > 0.5) f.push(`drop-shadow(0 ${(6 * u).toFixed(1)}px ${(sh * u).toFixed(1)}px ${layer.shadowColor || '#000000'})`);
  el.style.filter = f.join(' ');

  const reveal = clamp(val('reveal', t), 0, 100) / 100;
  const stroke = val('strokeWidth', t), strokeColor = val('strokeColor', t);

  if (layer.kind === 'shape') {
    const type = layer.shapeType || 'rect';
    const radius = (val('cornerRadius', t) / 100) * Math.min(lw, lh) / 2;
    const fill = layer.gradient ? `linear-gradient(135deg, ${color}, ${val('color2', t) || '#38bdf8'})` : color;
    if (inner._shape) {
      const lineLike = type === 'line' || type === 'arrow';
      inner._shape.setAttribute('fill', lineLike ? 'none' : color);
      inner._shape.setAttribute('stroke', lineLike ? color : (stroke > 0.2 ? strokeColor : 'none'));
      inner._shape.setAttribute('stroke-width', String(Math.max(lineLike ? 2 : 0, lineLike ? (stroke || 8) : stroke) * u));
      if (layer.dash > 0) inner._shape.setAttribute('stroke-dasharray', `${layer.dash * u * 2} ${layer.dash * u * 1.5}`);
    } else {
      inner.style.background = fill;
      inner.style.borderRadius = type === 'ellipse' ? '50%' : `${radius}px`;
      inner.style.border = stroke > 0.2 ? `${stroke * u}px ${layer.dash > 0 ? 'dashed' : 'solid'} ${strokeColor}` : 'none';
    }
    el.style.clipPath = reveal < 1 ? `inset(0 ${((1 - reveal) * 100).toFixed(2)}% 0 0)` : '';
  } else if (layer.kind === 'image') {
    inner.style.objectFit = layer.fit === 'contain' ? 'contain' : 'cover';
    inner.style.borderRadius = `${(val('cornerRadius', t) / 100) * Math.min(lw, lh) / 2}px`;
    el.style.clipPath = reveal < 1 ? `inset(0 ${((1 - reveal) * 100).toFixed(2)}% 0 0)` : '';
  } else {
    let text = String(layer.text ?? '');
    const counter = layer.keyframes?.counter?.length ? sampleProperty(layer, 'counter', t, {}) : null;
    if (counter != null) {
      const m = /^(\D*)([\d.,]+)(.*)$/s.exec(text);
      if (m) { const target = parseFloat(m[2].replace(/,/g, '')); const dec = (m[2].split('.')[1] || '').length; text = m[1] + (target * clamp(counter, 0, 100) / 100).toFixed(dec) + m[3]; }
    }
    if (reveal < 1) text = text.slice(0, Math.round(text.length * reveal));
    if (layer.textCase === 'upper') text = text.toUpperCase(); else if (layer.textCase === 'lower') text = text.toLowerCase();
    inner.textContent = text;
    const fs = (Number(val('fontSize', t)) || layer.fontSize || 90) * u;
    inner.style.font = `${layer.weight || (layer.bold ? 700 : 400)} ${fs}px ${layer.font || 'Inter, system-ui, sans-serif'}`;
    inner.style.letterSpacing = `${val('letterSpacing', t) * u}px`;
    inner.style.color = color;
    inner.style.maxWidth = `${Math.max(0.1, (layer.maxWidth ?? val('width', t)) / 100) * w}px`;
    inner.style.textAlign = layer.align || 'center';
    inner.style.webkitTextStroke = stroke > 0.2 ? `${stroke * u}px ${strokeColor}` : '';
    inner.style.paintOrder = 'stroke fill';
    inner.style.textShadow = layer.shadow ? `0 ${7 * u}px ${layer.shadow * u}px ${layer.shadowColor || '#000'}` : '';
    inner.style.background = layer.gradient ? `linear-gradient(90deg, ${color}, ${val('color2', t) || '#38bdf8'})` : '';
    if (layer.gradient) { inner.style.webkitBackgroundClip = 'text'; inner.style.color = 'transparent'; }
  }
}
return { ready, frame: (t) => { const local = t - startAt; if (data.layers && (local < 0 || local > (layer.duration || 5))) { el.style.display = 'none'; return; } frame(local); } };
}

/* the story kinds have a runtime of their own (a phone, a post card), each with its stylesheet */
const KINDS = {
  chat: ['./chat-runtime.js', 'chat.css', 'createChat'],
  wyr: ['./wyr-runtime.js', 'chat.css', 'createWyr'],
  reddit: ['./reddit-runtime.js', 'reddit.css', 'createReddit'],
  subtitle: ['./subtitle-runtime.js', null, 'createSubtitles'],
  transition: ['./transition-runtime.js', null, 'createTransition'],
  effect: ['./transition-runtime.js', null, 'createTransition'],
  mg: ['./mg-runtime.js', null, 'createMotionGraphic'],
  scene3d: ['./scene3d-runtime.js', null, 'createScene3d'],
  camera: ['./camera-runtime.js', null, 'createCamera'],
  track: ['./track-runtime.js', null, 'createTracked'],
  custom: ['./custom-runtime.js', null, 'createCustom'],
};
const sheets = new Map();
const sheet = (href) => {
  if (!sheets.has(href)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    sheets.set(href, new Promise((done) => { link.onload = link.onerror = done; }));
    document.head.appendChild(link);
  }
  return sheets.get(href);
};

/* a story's gameplay plays behind it inside the page (so the story is one clip on the Video line): a muted <video>
   seeked to t, looping over its own length (the host makes seeks exact) */
function backdrop(src) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = `../${String(src).split('#')[0]}`;
  v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover';
  const ready = new Promise((done) => { if (v.readyState >= 2) done(); else { v.addEventListener('loadeddata', () => done(), { once: true }); v.addEventListener('error', () => done(), { once: true }); } });
  const seek = (t) => {
    const d = Number.isFinite(v.duration) && v.duration > 0.1 ? v.duration : 0;
    const target = d ? t % Math.max(0.1, d - 0.05) : Math.max(0, t);
    if (Math.abs(v.currentTime - target) < 0.001 && v.readyState >= 2) return Promise.resolve();
    return new Promise((done) => { const fin = () => done(); v.addEventListener('seeked', fin, { once: true }); v.currentTime = target; setTimeout(fin, 1500); });
  };
  return { el: v, ready, seek };
}

/** Draws `data`: what the page shows now. Called again when the editor sends a changed layer (below). */
let current = { duration: data.duration || 5, frame: () => {} },generation=0;
async function mount() {
  const thisGeneration=++generation;
  current.dispose?.();
  root.innerHTML = '';
  await loadLayerFonts(data);
  if(thisGeneration!==generation)return;
  const kind = KINDS[data.kind];
  if (kind) {
    const [file, css, make] = kind;
    const bg = data.background ? backdrop(data.background) : null;
    let host = root;
    if (bg) {
      root.appendChild(bg.el);
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;inset:0';
      root.appendChild(host);
    }
    const [mod] = await Promise.all([import(file), css ? sheet(css) : null]);
    const story = mod[make](data, host);
    await Promise.all([story.ready, bg?.ready]);
    if(thisGeneration!==generation){story.dispose?.();return;}
    current = { duration: story.duration, camera: story.camera,dispose:()=>{story.dispose?.();if(bg){bg.el.pause();bg.el.removeAttribute('src');bg.el.load();}}, frame: bg ? async (t) => { await bg.seek(t); return story.frame(t); } : (t) => story.frame(t) };
  } else {
    const items = data.layers ? data.layers : [data];
    const built = items.map(makeItem);
    await Promise.all(built.map((b) => b.ready));
    current = { duration: data.duration || Math.max(...items.map((l) => (l.start || 0) + (l.duration || 5))), frame: (t) => built.forEach((b) => b.frame(t)) };
  }
}
let ready = mount().then(() => document.fonts.ready).then(() => {});
addEventListener('pagehide',()=>{generation++;current.dispose?.();});
let lastT = 0;
window.film = {
  get duration() { return current.duration; },
  get sourceClipId(){return data.targetTracking?.clipId??(data.kind==='track'?data.clipId:null);},
  frame: async (t) => {
    const pending = ready;
    await pending;
    if (pending !== ready) return window.film.frame(t);
    lastT=t;
    const a=data.targetTracking,host=window.parent;
    if(a&&host?.__filmSpans){const found=trackingSpan(host,a,host.__filmCurrentTime?.()),p=found&&observationAt(a.observations,found.timeUs);if(!p||!['observed','reacquired'].includes(p.status)){root.style.display='none';return;}const now=transformPoint(a.placement,p.x,p.y),ref=transformPoint(a.placement,...a.reference);root.style.display='';root.style.transform=`translate(${now[0]-ref[0]}px,${now[1]-ref[1]}px)`;}else{root.style.display='';root.style.transform='';}
    return current.frame(t);
  },
  get ready() { return ready; },
};
/* a camera clip answers the timeline's camera(t) (see camera-runtime.js); other pages have none */
if (data.kind === 'camera') window.film.camera = (t,filmTime) => current.camera?.(t,filmTime);

/* Live editing: the editor posts a changed layer straight to the preview's pages (the file is written too, for good),
   so what is typed shows on the next frame instead of after a reload. Only the page of that layer redraws. */
addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'shorts-layer' || !msg.layer || msg.layer.id !== data.id) return;
  data = msg.layer;
  ready = mount().then(() => document.fonts.ready).then(() => {});
  void ready.then(() => window.film.frame(lastT)).then(() => { if (data.kind === 'camera') try { parent.__filmRedraw?.(); } catch { /* not in a timeline */ } }).catch(error => console.error('Layer preview could not update', error));
});

if (!window.filmHost) {
  const t0 = performance.now();
  ready.then(() => {
    const loop = () => { window.film.frame(((performance.now() - t0) / 1000) % window.film.duration); requestAnimationFrame(loop); };
    loop();
  });
}
