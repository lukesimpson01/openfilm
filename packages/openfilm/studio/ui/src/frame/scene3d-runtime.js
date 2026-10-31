/* 3D page: devices (a phone, a laptop), photo/video cards and 3D text, drawn with Three.js at the host's t. Each object
   moves by its motion (motion3d.js); its screen shows a project video or photo (or a motion graphic), seeked to the
   film's own time, so the preview and the export show the same frame. The scene is seen through the active 3D camera
   (window.__filmCamera3d, set by the film's timeline) or, without one, the layer's own camera.

   Positions: x and y in frame units (−1…1 = the edges of the picture at depth 0), z in scene units toward the viewer.
   Rotations in degrees (Y then X then Z). Geometry is generic and original (no brand models). */
import * as THREE from './three.module.min.js';
import { screenStateAt } from './motion-sequence.js';
import { createModel,disposeModel } from './model-runtime.js';
export { loadModelAsset, disposeModel } from './model-runtime.js';
import { RoundedBoxGeometry } from './three-rounded-box.js';
import { RoomEnvironment } from './three-room-environment.js';
import { motionAt, camera3dAt } from './motion3d.js';
import { renderGraphic, graphicById } from './motion-graphics.js';

const RAD = Math.PI / 180;
const VIDEO = /\.(mp4|mov|webm|m4v|mkv)$/i;
const FINISH = {
  titanium: { color: '#8f8b85', metal: 0.95, rough: 0.32 }, black: { color: '#2b2c30', metal: 0.85, rough: 0.35 }, silver: { color: '#d8d9dd', metal: 0.95, rough: 0.28 },
  gold: { color: '#e4cfae', metal: 0.95, rough: 0.3 }, blue: { color: '#3d4b66', metal: 0.85, rough: 0.33 }, white: { color: '#ececea', metal: 0.1, rough: 0.55 },
  space: { color: '#55575d', metal: 0.9, rough: 0.34 }, midnight: { color: '#2c3242', metal: 0.85, rough: 0.36 },
};
function roundedRect(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
}
/** a flat rounded rectangle whose UVs run 0…1 across its box (so a picture maps onto it without stretching its corners) */
function screenGeometry(w, h, r) {
  const g = new THREE.ShapeGeometry(roundedRect(w, h, r), 12);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true; return g;
}

/* ---- media on a screen ---- */
function mediaSource(spec, base) {
  if (!spec) return null;
  if (spec.graphic) {
    const def = graphicById(spec.graphic); const c = document.createElement('canvas'); c.width = 540; c.height = Math.round(540 * (spec.aspect ?? 16 / 9));
    return { kind: 'mg', el: c, w: c.width, h: c.height, ready: Promise.resolve(), draw: (t) => renderGraphic(c.getContext('2d'), c.width, c.height, { graphic: spec.graphic, duration: def?.duration ?? 4, params: { ...(def?.defaults ?? {}), ...(spec.params ?? {}) } }, t, () => null, null) };
  }
  const url = `${base}${String(spec.src ?? spec).split('#')[0]}`;
  if (VIDEO.test(url)) {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = url;
    const ready = new Promise((done) => { if (v.readyState >= 2) done(); else { v.addEventListener('loadeddata', () => done(), { once: true }); v.addEventListener('error', () => done(), { once: true }); } });
    return { kind: 'video', el: v, get w() { return v.videoWidth || 16; }, get h() { return v.videoHeight || 9; }, ready };
  }
  const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'sync'; img.src = url;
  return { kind: 'image', el: img, get w() { return img.naturalWidth || 16; }, get h() { return img.naturalHeight || 9; }, ready: img.decode().catch(() => {}) };
}
/** the media second shown at the layer's second t: start offset, speed, loop (or hold the last frame) */
function mediaTime(src, spec, t) {
  const d = src.el.duration; const speed = spec.speed ?? 1; let x = (spec.offset ?? 0) + Math.max(0, t - (spec.startAt ?? 0)) * speed;
  if (spec.trimEnd && x > spec.trimEnd) x = spec.loop !== false ? (spec.offset ?? 0) + ((x - (spec.offset ?? 0)) % Math.max(0.1, spec.trimEnd - (spec.offset ?? 0))) : spec.trimEnd;
  if (Number.isFinite(d) && d > 0.1) x = spec.loop !== false ? x % Math.max(0.1, d - 0.05) : Math.min(x, d - 0.05);
  return x;
}
function seek(v, x) {
  if (Math.abs(v.currentTime - x) < 0.0005 && v.readyState >= 2) return Promise.resolve();
  return new Promise((done) => { const fin = () => done(); v.addEventListener('seeked', fin, { once: true }); v.currentTime = x; setTimeout(fin, 5000); });
}
/** a screen material showing `src` fitted (cover/contain) into a w×h screen */
function screenMaterial(src, w, h, fit, brightness = 1) {
  if (!src) return new THREE.MeshBasicMaterial({ color: '#05070b' });
  const tex = src.kind === 'video' ? new THREE.VideoTexture(src.el) : new THREE.Texture(src.el);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(brightness, brightness, brightness) });
  m.userData.fit = () => {
    const ma = src.w / src.h, sa = w / h; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    if ((fit ?? 'cover') === 'cover') { if (ma > sa) { tex.repeat.set(sa / ma, 1); tex.offset.set((1 - sa / ma) / 2, 0); } else { tex.repeat.set(1, ma / sa); tex.offset.set(0, (1 - ma / sa) / 2); } }
    else { tex.repeat.set(1, 1); tex.offset.set(0, 0); }
  };
  m.userData.tex = tex; return m;
}

/* ---- the objects ---- */
function metal(finish, o = {}) { const f = FINISH[finish] ?? FINISH.titanium; return new THREE.MeshPhysicalMaterial({ color: f.color, metalness: f.metal, roughness: f.rough, clearcoat: 0.35, clearcoatRoughness: 0.3, anisotropy: f.metal > 0.5 ? 0.55 : 0, ...o }); }
const glass = () => new THREE.MeshPhysicalMaterial({ color: '#050608', metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 0.6 });
/** a rounded-rect slab with a softly bevelled edge (flat faces and sides), centred, its thickness along z */
function slab(w, h, d, r, bevel) {
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * bevel, h - 2 * bevel, Math.max(0.001, r - bevel)), { depth: Math.max(0.0005, d - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
  g.translate(0, 0, -(d - 2 * bevel) / 2); g.computeVertexNormals(); return g;
}
/* a small texture of dots, for speaker grilles */
let grilleTex = null;
function grille() { if (grilleTex) return grilleTex; const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#c9cbd0'; g.fillRect(0, 0, 64, 512); g.fillStyle = '#2a2c31'; for (let y = 6; y < 512; y += 9) for (let x = 6 + ((y / 9) % 2) * 4; x < 64; x += 9) { g.beginPath(); g.arc(x, y, 2.1, 0, Math.PI * 2); g.fill(); } grilleTex = new THREE.CanvasTexture(c); grilleTex.colorSpace = THREE.SRGBColorSpace; return grilleTex; }

function buildPhone(spec, screen) {
  /* proportions of a current 6.1" phone: 71.5 × 147 × 8.25 mm (×0.0105 → scene units), 9 mm corner radius */
  const g = new THREE.Group(); const W = 0.75, H = 1.545, D = 0.087, R = 0.118;
  const fin = FINISH[spec.finish] ?? FINISH.titanium;
  const frame = new THREE.Mesh(slab(W, H, D, R, 0.012), metal(spec.finish)); g.add(frame);
  /* antenna bands on the frame */
  const band = new THREE.MeshStandardMaterial({ color: '#3a3b3f', roughness: 0.5 });
  for (const [x, y, w, h] of [[-W / 2 + 0.002, H / 2 - 0.16, 0.006, 0.012], [W / 2 - 0.002, H / 2 - 0.16, 0.006, 0.012], [-W / 2 + 0.002, -H / 2 + 0.2, 0.006, 0.012], [W / 2 - 0.002, -H / 2 + 0.2, 0.006, 0.012], [0.12, -H / 2 + 0.002, 0.012, 0.006]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, D * 0.82), band); b.position.set(x, y, 0); g.add(b); }
  /* front: black glass, the display under it with its thin black border, the island */
  const front = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.016, H - 0.016, R - 0.008), 24), glass()); front.position.z = D / 2 + 0.0006; g.add(front);
  const sw = W - 0.046, sh = H - 0.046; const scr = new THREE.Mesh(screenGeometry(sw, sh, R - 0.03), screenMaterial(screen.src, sw, sh, screen.fit, screen.brightness)); scr.position.z = D / 2 + 0.0012; g.add(scr);
  const island = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.19, 0.056, 0.028), 16), new THREE.MeshBasicMaterial({ color: '#000' })); island.position.set(0, sh / 2 - 0.05, D / 2 + 0.0018); if (spec.island !== false) g.add(island);
  /* back: frosted glass in the finish's tone */
  const back = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.016, H - 0.016, R - 0.008), 24), new THREE.MeshPhysicalMaterial({ color: fin.color, metalness: 0.15, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.5 }));
  back.rotation.y = Math.PI; back.position.z = -D / 2 - 0.0006; g.add(back);
  /* the camera plateau: a raised glass square, three lens assemblies (ring, glass, inner element), flash, LiDAR */
  const P = 0.33, cx = -W / 2 + 0.205, cy = H / 2 - 0.205;
  const plateau = new THREE.Mesh(slab(P, P, 0.022, 0.085, 0.006), new THREE.MeshPhysicalMaterial({ color: fin.color, metalness: 0.2, roughness: 0.18, clearcoat: 1 })); plateau.position.set(cx, cy, -D / 2 - 0.011); g.add(plateau);
  const ring = metal(spec.finish, { roughness: 0.22 }); const lensGlass = new THREE.MeshPhysicalMaterial({ color: '#06080d', metalness: 0.3, roughness: 0.03, clearcoat: 1, iridescence: 0.4 });
  const inner = new THREE.MeshPhysicalMaterial({ color: '#1a2236', metalness: 0.6, roughness: 0.15 });
  for (const [lx, ly] of [[-0.075, 0.075], [-0.075, -0.075], [0.08, 0]]) {
    const z0 = -D / 2 - 0.022;
    const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.064, 0.026, 48), ring); r1.rotation.x = Math.PI / 2; r1.position.set(cx + lx, cy + ly, z0 - 0.012); g.add(r1);
    const lg = new THREE.Mesh(new THREE.CircleGeometry(0.05, 48), lensGlass); lg.rotation.y = Math.PI; lg.position.set(cx + lx, cy + ly, z0 - 0.0255); g.add(lg);
    const el = new THREE.Mesh(new THREE.RingGeometry(0.014, 0.03, 40), inner); el.rotation.y = Math.PI; el.position.set(cx + lx, cy + ly, z0 - 0.026); g.add(el);
  }
  const flash = new THREE.Mesh(new THREE.CircleGeometry(0.019, 24), new THREE.MeshStandardMaterial({ color: '#f6ecd2', emissive: '#2a2416', roughness: 0.3 })); flash.rotation.y = Math.PI; flash.position.set(cx + 0.085, cy + 0.11, -D / 2 - 0.0225); g.add(flash);
  const lidar = new THREE.Mesh(new THREE.CircleGeometry(0.016, 24), new THREE.MeshStandardMaterial({ color: '#111216', roughness: 0.2 })); lidar.rotation.y = Math.PI; lidar.position.set(cx + 0.085, cy - 0.11, -D / 2 - 0.0225); g.add(lidar);
  /* buttons: action, volume up/down (left), side (right) */
  const btn = metal(spec.finish);
  for (const [y, h, side] of [[0.4, 0.07, -1], [0.27, 0.115, -1], [0.13, 0.115, -1], [0.25, 0.19, 1]]) { const b = new THREE.Mesh(slab(0.014, h, 0.03, 0.006, 0.003), btn); b.rotation.y = Math.PI / 2; b.position.set(side * (W / 2 + 0.003), y, 0); g.add(b); }
  g.userData = { screen: scr, size: [W, H], explode: [[front, 0.25], [scr, 0.45], [island, 0.5], [back, -0.3], [plateau, -0.45]] };
  return g;
}

function buildLaptop(spec, screen) {
  /* proportions of a 14" laptop: 312 × 221 mm, 15.5 mm closed; display 16:10 */
  const g = new THREE.Group(); const W = 3.0, DEP = 2.12, T = 0.072, LT = 0.042, LH = 1.98;
  const alu = metal(spec.finish ?? 'silver', { anisotropy: 0.4, roughness: 0.36 });
  const base = new THREE.Mesh(slab(W, DEP, T, 0.09, 0.016), alu); base.rotation.x = -Math.PI / 2; base.position.y = T / 2; g.add(base);
  /* keyboard well and keys (a function row of half-height keys, five full rows), speaker grilles beside it */
  const well = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W * 0.72, DEP * 0.43, 0.03), 8), new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.85 })); well.rotation.x = -Math.PI / 2; well.position.set(0, T + 0.0006, -DEP * 0.19); g.add(well);
  const keyMat = new THREE.MeshPhysicalMaterial({ color: '#0d0e10', roughness: 0.55, clearcoat: 0.2, emissive: new THREE.Color(spec.backlight ? '#d8e6ff' : '#000'), emissiveIntensity: spec.backlight ? 0.25 : 0 });
  const cols = 14, kw = (W * 0.7) / cols, kd = (DEP * 0.41) / 6;
  const keyGeo = slab(kw * 0.86, kd * 0.82, 0.014, 0.012, 0.004); keyGeo.rotateX(-Math.PI / 2);
  const keys = new THREE.InstancedMesh(keyGeo, keyMat, cols * 6); const mtx = new THREE.Matrix4(); let n = 0;
  for (let r = 0; r < 6; r++) for (let c = 0; c < cols; c++) { const fnRow = r === 0; mtx.makeScale(1, 1, fnRow ? 0.55 : 1).setPosition(-W * 0.35 + kw * (c + 0.5), T + 0.008, -DEP * 0.19 - DEP * 0.205 + kd * (r + 0.5) + (fnRow ? kd * 0.2 : 0)); keys.setMatrixAt(n++, mtx); }
  g.add(keys);
  for (const sx of [-1, 1]) { const gr = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.06, DEP * 0.4), new THREE.MeshStandardMaterial({ map: grille(), roughness: 0.5, metalness: 0.6 })); gr.rotation.x = -Math.PI / 2; gr.position.set(sx * W * 0.415, T + 0.0007, -DEP * 0.19); g.add(gr); }
  const pad = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W * 0.42, DEP * 0.31, 0.05), 12), new THREE.MeshPhysicalMaterial({ color: (FINISH[spec.finish ?? 'silver'] ?? FINISH.silver).color, metalness: 0.5, roughness: 0.16, clearcoat: 0.8 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, T + 0.0007, DEP * 0.255); g.add(pad);
  /* hinge barrel; the lid on it (angle 0 closed, 90 upright, 110 as usually open) */
  const hingeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, W * 0.86, 24), new THREE.MeshStandardMaterial({ color: '#1b1c20', roughness: 0.6, metalness: 0.4 })); hingeBar.rotation.z = Math.PI / 2; hingeBar.position.set(0, T, -DEP / 2 + 0.03); g.add(hingeBar);
  const hinge = new THREE.Group(); hinge.position.set(0, T, -DEP / 2 + 0.03); g.add(hinge);
  const lid = new THREE.Group(); hinge.add(lid);
  const shell = new THREE.Mesh(slab(W, LH, LT, 0.09, 0.012), alu); shell.position.set(0, LH / 2, -LT / 2); lid.add(shell);
  const panel = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.022, LH - 0.022, 0.08), 16), glass()); panel.position.set(0, LH / 2, 0.0008); lid.add(panel);
  const sw = W - 0.1, sh = sw / 1.54; const scr = new THREE.Mesh(screenGeometry(sw, sh, 0.035), screenMaterial(screen.src, sw, sh, screen.fit, screen.brightness)); scr.position.set(0, LH / 2 + (LH - 0.06 - sh) / 2 - 0.02, 0.0015); lid.add(scr);
  if (spec.notch !== false) { const notch = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.24, 0.07, 0.025), 10), new THREE.MeshBasicMaterial({ color: '#000' })); notch.position.set(0, scr.position.y + sh / 2 - 0.025, 0.0022); lid.add(notch); const cam = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshPhysicalMaterial({ color: '#0d1a2b', roughness: 0.1, clearcoat: 1 })); cam.position.set(0, notch.position.y + 0.004, 0.0028); lid.add(cam); }
  g.userData = { screen: scr, hinge, size: [W, 2.3], center: [0, 0.82, -0.3], explode: [[keys, 0.25], [pad, 0.2]] };
  return g;
}

/* a licensed model the person brings (GLB / glTF): its mesh named "screen" (or the largest flat mesh named like it)
   gets the screen media; scaled to a phone's height */
async function buildModel(spec, screen,base) {
  const g=await createModel(spec,base),root=g.userData.modelRoot;
  let scr = null; root.traverse((m) => { if (m.isMesh && /screen|display/i.test(m.name) && !scr) scr = m; });
  if (scr && screen.src) { const bb = new THREE.Box3().setFromObject(scr); const ss = new THREE.Vector3(); bb.getSize(ss); scr.material = screenMaterial(screen.src, Math.max(ss.x, 1e-3), Math.max(ss.y, 1e-3), screen.fit, screen.brightness); }
  g.userData.screen=scr;
  return g;
}

function buildCard(spec, screen) {
  const g = new THREE.Group(); const a = spec.aspect ?? (screen.src ? screen.src.w / screen.src.h : 4 / 5); const H = spec.height ?? 1.3, W = H * a, D = spec.depth ?? 0.03, R = spec.radius ?? 0.06;
  const slab = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, Math.min(R, D / 2)), new THREE.MeshStandardMaterial({ color: spec.color ?? '#ffffff', roughness: 0.6 })); g.add(slab);
  const pic = new THREE.Mesh(screenGeometry(W - 0.04, H - 0.04, Math.max(0.005, R - 0.02)), screenMaterial(screen.src, W - 0.04, H - 0.04, 'cover', screen.brightness)); pic.position.z = D / 2 + 0.001; g.add(pic);
  g.userData = { screen: pic, size: [W, H] };
  return g;
}

/** 3D text: the words drawn on a plane, with real depth from stacked slices behind it (any font the page can use) */
function buildText(spec) {
  const g = new THREE.Group(); const text = String(spec.text ?? 'TEXT'); const font = `${spec.weight ?? 900} 200px ${spec.font ?? 'Sora, Inter, Arial, sans-serif'}`;
  const c = document.createElement('canvas'); const g2 = c.getContext('2d'); g2.font = font; const tw = Math.max(10, g2.measureText(text).width);
  c.width = Math.ceil(tw + 80); c.height = 280; g2.font = font; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  const face = (fill) => { g2.clearRect(0, 0, c.width, c.height); if (spec.gradient) { const gr = g2.createLinearGradient(0, 40, 0, 240); gr.addColorStop(0, spec.color ?? '#ffffff'); gr.addColorStop(1, spec.color2 ?? '#9ab7ff'); g2.fillStyle = gr; } else g2.fillStyle = fill; g2.fillText(text, c.width / 2, c.height / 2 + 8); return new THREE.CanvasTexture(c); };
  const H = spec.size ?? 0.6, W = H * (c.width / c.height);
  const frontTex = face(spec.color ?? '#ffffff'); frontTex.colorSpace = THREE.SRGBColorSpace;
  const sideCanvas = document.createElement('canvas'); sideCanvas.width = c.width; sideCanvas.height = c.height; const sg = sideCanvas.getContext('2d'); sg.font = font; sg.textAlign = 'center'; sg.textBaseline = 'middle'; sg.fillStyle = spec.sideColor ?? shade(spec.color ?? '#ffffff', 0.55); sg.fillText(text, c.width / 2, c.height / 2 + 8);
  const sideTex = new THREE.CanvasTexture(sideCanvas); sideTex.colorSpace = THREE.SRGBColorSpace;
  const depth = spec.depth ?? 0.12; const slices = Math.max(1, Math.round(depth / 0.006));
  for (let i = slices; i >= 1; i--) { const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: sideTex, transparent: true, alphaTest: 0.5, toneMapped: false })); m.position.z = -depth * (i / slices); g.add(m); }
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, alphaTest: 0.02, toneMapped: false })); g.add(front);
  g.userData = { size: [W, H] };
  return g;
}
function shade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return `#${c.getHexString()}`; }

/**
 * The scene of a 3D layer (its objects, lights and reflections) and how to pose it at a time: shared by this page and
 * the editor's scene view, so both show the same objects in the same places. `base`: where project files are.
 */
export function buildScene(layer, renderer, base = '../', aspect = 9 / 16) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04,.1,100,{size:128}).texture;room.dispose();
  const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(2.5, 3.5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#dfe8ff', 1.1); rim.position.set(-3, 1.5, -2.5); scene.add(rim);
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3f4a', 0.45)); scene.environmentIntensity = layer.reflections ?? 1.1;
  const fov = layer.camera?.fov ?? 30;
  /* one media element per source and timing: several screens showing the same video share it (one seek a frame) */
  const shared = new Map();
  const mediaFor = (sp) => { if (!sp) return null; const k = JSON.stringify([sp.src, sp.graphic, sp.params, sp.offset ?? 0, sp.speed ?? 1, sp.loop, sp.trimEnd,sp.startMode,sp.onAt,sp.playAt,sp.events]); if (!shared.has(k)) shared.set(k, mediaSource(sp, base)); return shared.get(k); };
  const objects = (layer.objects ?? []).map((spec) => {
    const screen = { src: mediaFor(spec.screen), fit: spec.screen?.fit, brightness: spec.screen?.brightness ?? 1 };
    const obj = spec.type === 'laptop' ? buildLaptop(spec, screen) : spec.type === 'card' ? buildCard(spec, screen) : spec.type === 'text' ? buildText(spec) : spec.type === 'model' ? new THREE.Group() : buildPhone(spec, screen);
    if(spec.type==='model')obj.userData.size=[spec.width??.9,spec.height??1.8];
    const holder = new THREE.Group(); holder.add(obj); scene.add(holder);
    if (obj.userData.center) obj.position.set(-obj.userData.center[0], -obj.userData.center[1], -obj.userData.center[2]);
    return { spec, obj, holder, screen };
  });
  /* the frame at depth 0: how far the default camera stands so the biggest object fits */
  const tan = Math.tan((fov * RAD) / 2);
  const need = Math.max(1.0, ...objects.map((o) => { const [w, h] = o.obj.userData.size ?? [1, 1],p=o.spec.motion?.keys?.at(-1)?.p??[0,0,0]; return Math.max(h / (.74*Math.max(.2,1-Math.abs(p[1]))), w / (.84 * aspect*Math.max(.2,1-Math.abs(p[0])))); }));
  const dist = layer.camera?.distance ?? need / (2 * tan);
  const halfH = dist * tan, halfW = halfH * aspect;
  /* imported models load before the first frame; they replace their placeholder */
  const models = Promise.all(objects.map(async (o) => { if (o.spec.type !== 'model') return;const m = await buildModel(o.spec, o.screen,base); o.holder.remove(o.obj); o.obj = m; o.holder.add(m); }));
  const ready = Promise.all([models, ...objects.map((o) => o.screen.src?.ready)]).then(() => objects.forEach((o) => o.obj.userData.screen?.material.userData.fit?.()));
  const duration = Math.max(0.1, layer.duration || 4);

  const pose = (o, t) => {
    o.obj.userData.animate?.(t,o.spec);
    const st = motionAt(o.spec.motion, t, duration);
    o.holder.position.set(st.p[0] * halfW, st.p[1] * halfH, st.p[2]);
    o.holder.rotation.set(st.r[0] * RAD, st.r[1] * RAD, st.r[2] * RAD, 'YXZ');
    o.holder.scale.setScalar((st.s ?? 1) * (o.spec.scale ?? 1));
    const ex = st.extra ?? o.spec.explode ?? 0;
    for (const [m, dz] of o.obj.userData.explode ?? []) { m.userData.z0 ??= m.position.z; m.position.z = m.userData.z0 + dz * ex; }
    if (o.obj.userData.hinge) o.obj.userData.hinge.rotation.x = (90 - (st.lid ?? o.spec.lid ?? 110)) * RAD;
    o.holder.visible = (st.o ?? 1) > 0.001;
    o.holder.traverse((m) => { if (m.material && 'opacity' in m.material) { m.material.transparent = m.material.transparent || (st.o ?? 1) < 1; m.material.opacity = st.o ?? 1; } });
    const scr=o.obj.userData.screen;
    if(scr) scr.material.visible=screenStateAt(o.spec.screen,t).on;
  };
  const dispose=()=>{for(const o of objects){o.obj.userData.mixer?.stopAllAction();o.obj.userData.mixer?.uncacheRoot(o.obj.userData.modelRoot);}disposeModel(scene);scene.environment?.dispose();pmrem.dispose();for(const s of shared.values())if(s?.kind==='video'){s.el.pause();s.el.removeAttribute('src');s.el.load();}};
  return { scene, objects, pose, dist, halfW, halfH, K: dist / 5, fov, ready, duration,dispose };
}

export function createScene3d(layer, root) {
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  if (layer.softShadow !== false) canvas.style.filter = `drop-shadow(0 ${Math.round(innerHeight * 0.02)}px ${Math.round(innerHeight * 0.03)}px rgba(0,0,0,${layer.shadowOpacity ?? 0.35}))`;
  root.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = layer.exposure ?? 1; renderer.outputColorSpace = THREE.SRGBColorSpace;
  const aspect = innerWidth / innerHeight;
  const { scene, objects, pose, dist, fov, ready, duration,dispose } = buildScene(layer, renderer, '../', aspect);
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.05, 200);
  /* camera paths are written for a scene 5 units away; scaled to this scene's own fit, the same move frames a phone
     or a laptop alike */
  const K = dist / 5;
  const aim = (c) => { cam.position.set(c.position[0] * K, c.position[1] * K, c.position[2] * K); cam.up.set(0, 1, 0); cam.lookAt(c.target[0] * K, c.target[1] * K, c.target[2] * K); cam.rotateZ((c.roll ?? 0) * RAD); if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); } };
  const view = (t) => {
    const c3 = window.__filmCamera3d;
    if (c3) { aim(c3); return; }
    if (layer.cameraMotion?.keys?.length) { aim(camera3dAt(layer.cameraMotion, t, duration)); return; }
    cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0); if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  };
  /* motion blur: a few moments within the frame's shutter, averaged (only when asked: it costs a render each) */
  const out = layer.motionBlur > 0 ? document.createElement('canvas') : null;
  if (out) { out.style.cssText = canvas.style.cssText; canvas.style.visibility = 'hidden'; root.appendChild(out); }
  /* screen-to-reality: the first screen's picture takes the whole frame (cover), fading in over [from, to] (or out, reversed) */
  const fs = layer.fullscreen ? document.createElement('canvas') : null;
  if (fs) { fs.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'; root.appendChild(fs); }
  const fullscreen = (t) => {
    if (!fs) return; const src = objects[0]?.screen.src; const g = fs.getContext('2d'); fs.width = canvas.width; fs.height = canvas.height; g.clearRect(0, 0, fs.width, fs.height);
    if (!src||!screenStateAt(objects[0].spec.screen,t).on) return; const { from = 0, to = 1, reverse = false } = layer.fullscreen; let k = Math.min(1, Math.max(0, (t - from) / Math.max(1e-6, to - from))); if (reverse) k = 1 - k; k = k * k * (3 - 2 * k);
    if (k <= 0) return; const r = Math.max(fs.width / src.w, fs.height / src.h); const w = src.w * r, h = src.h * r; g.globalAlpha = k; g.drawImage(src.el, (fs.width - w) / 2, (fs.height - h) / 2, w, h); g.globalAlpha = 1;
  };
  const size = () => { const w = innerWidth, h = innerHeight; const cur = renderer.getSize(new THREE.Vector2()); if (cur.x !== w || cur.y !== h) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); } };
  const api = {
    duration,
    camera3d: true, /* it draws the 3D camera itself, so the timeline does not also tilt it with CSS */
    dispose(){dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();out?.remove();fs?.remove();},
    /* a first draw while loading (textures and shaders settle on their first use), so the first frame asked is real */
    ready: ready.then(() => api.frame(0)).then(() => {}),
    /* a still of the screen video at the object's time (and the motion graphic on a screen redrawn) */
    async frame(t) {
      size();
      const tt = Math.min(Math.max(t, 0), duration);
      const done = new Set();
      await Promise.all(objects.map(async (o) => {
        const s = o.screen.src; if (!s||!screenStateAt(o.spec.screen,tt).on) return;
        if (!done.has(s)) { done.add(s); const screenTime=Math.max(0,tt-screenStateAt(o.spec.screen,tt).playAt); if (s.kind === 'video') await seek(s.el, mediaTime(s, o.spec.screen, screenTime)); else if (s.kind === 'mg') s.draw(screenTime); }
        const tex = o.obj.userData.screen?.material.userData.tex; if (tex && s.kind !== 'image') tex.needsUpdate = true;
      }));
      if (!out) { objects.forEach((o) => pose(o, tt)); view(tt); renderer.render(scene, cam); fullscreen(tt); return; }
      const n = 5, shutter = (layer.motionBlur ?? 0.5) / 30; const g = out.getContext('2d'); out.width = canvas.width; out.height = canvas.height; g.clearRect(0, 0, out.width, out.height);
      for (let i = 0; i < n; i++) { const ti = Math.max(0, tt - shutter * (i / (n - 1))); objects.forEach((o) => pose(o, ti)); view(ti); renderer.render(scene, cam); g.globalAlpha = 1 / (i + 1); g.drawImage(canvas, 0, 0); }
      g.globalAlpha = 1; fullscreen(tt);
    },
  };
  return api;
}
