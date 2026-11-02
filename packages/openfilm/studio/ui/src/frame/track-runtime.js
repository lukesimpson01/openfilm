/* Tracked page: objects placed in real footage, and the subject effects. It reads the footage's tracking (assets/track/
   <id>.json: how the reference frame maps onto each frame) and its subject matte (an atlas of mask frames), plays the
   footage seeked to the film's own time (as a zoom does), and draws, at t:
     - objects "on a surface" (flat on a tracked wall, floor or screen): mapped through the frame's homography, exact
       perspective computed per pixel;
     - objects "standing" in the scene (3D text): at a tracked point, scaled with the scene, tilted, with real depth;
     - the subject in front: the footage's own pixels where the matte says "person/object", over what is behind them.
   Which objects go behind the subject is chosen per moment: 'behind' / 'front' ranges the person sets, or 'auto' (an
   object whose ground point is further up the frame than the subject's feet is further away, so it goes behind).
   Effects (mode): textBehind (default), cutout, outline, focus, parallax, maskReveal, freezePop, echo.
   Everything is a function of t. Footage below this page shows through where nothing is drawn. */
import * as THREE from './three.module.min.js';
import { transformAt,transformAtAnchored, apply, inv3,pinVisibilityAt,validPlaneProjection,homography } from './track-core.js';
import { motionAt } from './motion3d.js';
import { depthFactor, placedPoint,surfaceDepthMatrix } from './track-space.js';
import { planeTextMetrics,projectionVisibility } from './scene-geometry.js';
import {spatialPoseAt,anchorQuad,anchorCameraPlane,anchorFrame,objectAnchorAt}from'./spatial-geometry.js';

import{setSpatialCamera}from'./spatial-three.js';
import{SPATIAL_OCCLUSION_GLSL,occlusionUniforms,bindOcclusion}from'./spatial-occlusion.js';
import{sceneAnchor}from'./spatial-scene.js';
import {createModel}from'./model-runtime.js';
/* "over" for colour AND coverage: with the default blend a half-covered edge also halves the canvas's own alpha, so the
   page's dark background showed through as a thin line along every subject and letter edge */
const over = (m) => Object.assign(m, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor });
const RAD = Math.PI / 180;
const BASE = '../';
const STILL = /\.(png|jpe?g|webp|gif|avif)$/i;
function video(src) {
  /* a photo: one picture, never sought */
  if (STILL.test(String(src).split('#')[0])) { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = BASE + String(src).split('#')[0]; return { v: img, still: true, ready: img.decode().catch(() => {}) }; }
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = BASE + String(src).split('#')[0];
  const ready = new Promise((done) => { if (v.readyState >= 2) done(); else { v.addEventListener('loadeddata', () => done(), { once: true }); v.addEventListener('error', () => done(), { once: true }); } });
  return { v, ready };
}
function seek(v, x) {
  if (!(v instanceof HTMLVideoElement)) return Promise.resolve();
  if (Math.abs(v.currentTime - x) < 0.0005 && !v.seeking && v.readyState >= 2) return Promise.resolve();
  return new Promise((done) => { const fin = () => done(); v.addEventListener('seeked', fin, { once: true }); v.currentTime = Math.max(0, x); setTimeout(fin, 5000); });
}
const loadJson = (p) => (p ? fetch(BASE + p).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null));
const loadImage = (p,base=BASE) => new Promise((done) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => done(i); i.onerror = () => done(null); i.src = base + p; });

/* the item's picture: text (any font, colour or gradient, outline, glow) or an image, on a canvas */
export function itemCanvas(it, px = 220,base=BASE) {
  /* a picture (an upload or a sticker, SVG included): drawn at least as tall as it will be seen, so it stays sharp */
  if (it.image) return loadImage(it.image,base).then((img) => { const nw = img?.naturalWidth || 2, nh = img?.naturalHeight || 2; const h = Math.max(nh, Math.round(px * 1.35)), w = Math.round((nw / nh) * h); const c = document.createElement('canvas'); c.width = w; c.height = h; if (img) c.getContext('2d').drawImage(img, 0, 0, w, h); return c; });
  if (it.card === 'location') return Promise.resolve(locationCard(it, px));
  const c = document.createElement('canvas'); const g = c.getContext('2d'); const font = `${it.italic ? 'italic ' : ''}${it.weight ?? 900} ${px}px ${it.font ?? 'Sora, Inter, Arial, sans-serif'}`;
  g.font = font; const text = String(it.text ?? 'TEXT'); const tw = g.measureText(text).width; const pad = Math.round(60 * (px / 220));
  c.width = Math.ceil(tw + pad * 2); c.height = Math.ceil(px * 1.35 + pad); g.font = font; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  const x = c.width / 2, y = c.height - pad * 0.6 - px * 0.12;
  if(it.shadow&&it.place==='surface'){g.shadowColor='rgba(0,0,0,.32)';g.shadowBlur=px*.055;g.shadowOffsetY=px*.025;}
  if (it.glow) { g.shadowColor = it.glowColor ?? it.color ?? '#fff'; g.shadowBlur = 40 * it.glow * (px / 220); }
  if (it.strokeWidth) { g.lineWidth = it.strokeWidth * (px / 220); g.strokeStyle = it.strokeColor ?? '#000'; g.lineJoin = 'round'; g.strokeText(text, x, y); }
  if (it.gradient) { const gr = g.createLinearGradient(0, y - px, 0, y); gr.addColorStop(0, it.color ?? '#fff'); gr.addColorStop(1, it.color2 ?? '#7aa8ff'); g.fillStyle = gr; } else g.fillStyle = it.color ?? '#ffffff';
  g.fillText(text, x, y);
  return Promise.resolve(c);
}
/* A location title, as the newer stealth games show a place: a thin accent bar, the name in wide-tracked capitals, a
   hairline, and a small line under it (region, time, coordinates) in a mono face. Height ≈ px·1.35 like a text card. */
function locationCard(it, px) {
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const title = String(it.text ?? 'LOCATION').toUpperCase(), sub = String(it.sub ?? '').toUpperCase(), sub2 = String(it.sub2 ?? '').toUpperCase();
  const T = Math.round(px * 0.62), S = Math.round(px * 0.2), track = T * 0.16, pad = Math.round(px * 0.22), bar = Math.max(3, Math.round(px * 0.05));
  const tf = `${it.weight ?? 600} ${T}px ${it.font ?? 'Inter, Sora, Arial, sans-serif'}`, sf = `500 ${S}px ui-monospace, "SF Mono", Menlo, monospace`;
  g.font = tf; const tw = [...title].reduce((w, ch) => w + g.measureText(ch).width + track, -track);
  g.font = sf; const sw = Math.max(g.measureText(sub).width, g.measureText(sub2).width) + S;
  c.width = Math.ceil(Math.max(tw, sw) + pad * 3 + bar); c.height = Math.ceil(px * 1.35);
  const x0 = pad + bar + pad * 0.6, base = pad + T;
  if(it.shadow){g.shadowColor='rgba(0,0,0,0.45)';g.shadowBlur=px*.08;g.shadowOffsetY=px*.015;}
  g.fillStyle = it.color2 ?? '#ffcf7a'; g.fillRect(pad, pad + T * 0.08, bar, T * 0.92 + S * 1.9);
  g.fillStyle = it.color ?? '#ffffff'; g.font = tf; let x = x0; for (const ch of title) { g.fillText(ch, x, base); x += g.measureText(ch).width + track; }
  g.globalAlpha = 0.55; g.fillRect(x0, base + T * 0.18, Math.max(tw, sw) * 0.9, Math.max(1, px * 0.008)); g.globalAlpha = 1;
  g.font = sf; g.fillStyle = it.subColor ?? 'rgba(255,255,255,0.82)'; if (sub) g.fillText(sub, x0, base + T * 0.18 + S * 1.25); if (sub2) { g.fillStyle = it.color2 ?? '#ffcf7a'; g.fillText(sub2, x0, base + T * 0.18 + S * 2.45); }
  return c;
}
/* one letter each, for walk-through text: each its own canvas and its place in the word (0…1 across) */
function letterCanvases(it, px = 220) {
  const text = String(it.text ?? 'TEXT'); const font = `${it.weight ?? 900} ${px}px ${it.font ?? 'Sora, Inter, Arial, sans-serif'}`;
  const m = document.createElement('canvas').getContext('2d'); m.font = font; const total = m.measureText(text).width; let x = 0;
  const canvasH = Math.ceil(px * 1.35 + Math.round(60 * (px / 220)));
  /* each letter's centre from the word's centre, in text heights (the letter canvases are all canvasH tall) */
  return Promise.all([...text].map((ch) => { const w = m.measureText(ch).width; const off = (x + w / 2 - total / 2) / canvasH; x += w; return itemCanvas({ ...it, text: ch }, px).then((c) => ({ c, off })); }));
}

const FLAT_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
/* stage uv (y down) → where in the source picture (0…1), → proxy px; then the frame's inverse homography → reference px */
const MAP = `
uniform vec4 uRect; uniform vec2 uProxy; uniform mat3 uHinv;
vec2 toSource(vec2 st){ return (st - uRect.xy) / uRect.zw; }
vec2 toRef(vec2 st){ vec2 s = toSource(st) * uProxy; vec3 r = uHinv * vec3(s, 1.0); return r.xy / r.z; }`;
const FLAT_FS = `precision highp float; varying vec2 vUv; ${MAP}
uniform sampler2D uTex; uniform vec2 uAnchor; uniform vec2 uSize; uniform float uRot; uniform float uOpacity; uniform float uWipe;
uniform float uUsePlane; uniform mat3 uPlaneInverse;
uniform float uSpatial;uniform vec4 uK;uniform float uLens;uniform vec2 uSpatialSize;uniform vec3 uPlaneOrigin;uniform vec3 uPlaneRight;uniform vec3 uPlaneDown;
${SPATIAL_OCCLUSION_GLSL}
void main(){ vec2 st = vec2(vUv.x, 1.0 - vUv.y); vec2 ref = toRef(st); if(uUsePlane>.5){vec3 p=uPlaneInverse*vec3(ref,1.);ref=p.xy/p.z;if(ref.x<0.||ref.x>1.||ref.y<0.||ref.y>1.)discard;} vec2 r = ref - uAnchor; float c = cos(-uRot), s = sin(-uRot);
  vec2 l = vec2(c * r.x - s * r.y, s * r.x + c * r.y) / uSize + vec2(0.5, 0.5);
  float opticalDepth=0.;if(uSpatial>.5){vec2 d=(toSource(st)*uSpatialSize-uK.zw)/uK.xy;vec2 original=d;for(int i=0;i<8;i++)d=original/(1.+uLens*dot(d,d));vec3 ray=vec3(d,1.),n=cross(uPlaneRight,uPlaneDown);float denominator=dot(n,ray);if(abs(denominator)<.000001)discard;opticalDepth=dot(n,uPlaneOrigin)/denominator;if(opticalDepth<.001||opticalDepth>10000.)discard;vec3 q=ray*opticalDepth-uPlaneOrigin;float rr=dot(uPlaneRight,uPlaneRight),dd=dot(uPlaneDown,uPlaneDown),rd=dot(uPlaneRight,uPlaneDown),qr=dot(q,uPlaneRight),qd=dot(q,uPlaneDown),det=rr*dd-rd*rd;if(abs(det)<.00000001)discard;l=vec2((qr*dd-qd*rd)/det,(qd*rr-qr*rd)/det);}
  if (l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0) discard; float w = 1.0 - smoothstep(uWipe - 0.02, uWipe, l.x); if (w <= 0.0) discard; vec4 col = texture2D(uTex, vec2(l.x, 1.0 - l.y)); float visibility=uSpatial>.5?spatialVisibility(toSource(st),opticalDepth):1.;float alpha=col.a*uOpacity*w*visibility;if(alpha<.001)discard;gl_FragDepth=uSpatial>.5?10000./9999.999-10./(9999.999*opticalDepth):gl_FragCoord.z;gl_FragColor=vec4(col.rgb,alpha); }`;
/* the subject over everything: the footage where the matte is, its edge feathered / shifted; options for the effects */
const FG_FS = `precision highp float; varying vec2 vUv; uniform vec4 uRect; uniform sampler2D uVideo; uniform sampler2D uMatte; uniform vec4 uMatteRect;
uniform float uFeather; uniform float uShift; uniform float uOpacity; uniform float uScale; uniform vec2 uCenter; uniform float uOutline; uniform vec3 uOutlineColor; uniform float uInvert; uniform float uBlur; uniform float uTrace;
uniform float uGround; uniform int uSubjectsN; uniform vec4 uSubjects[16]; uniform vec2 uMatteSize; uniform int uExcludeN; uniform vec2 uExclude[32];
/* a printed figure on the text's own surface (a poster): it is part of the surface, so it does not cover the text */
bool inQuad(vec2 p, int q){ float sgn = 0.0; for (int i = 0; i < 4; i++) { vec2 a = uExclude[q * 4 + i], b = uExclude[q * 4 + (i == 3 ? 0 : i + 1)]; float c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (sgn == 0.0) sgn = sign(c); else if (sign(c) != sgn && c != 0.0) return false; } return true; }
float matteAt(vec2 s){ if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) return 0.0; return texture2D(uMatte, uMatteRect.xy + vec2(s.x, s.y) * uMatteRect.zw).r; }
/* edge-aware upsampling: the mask is analysed small, the footage is full size. Each mask sample counts only as much as
   its footage colour matches this pixel's, so the cut follows the real edge of hair, arms and clothes instead of a soft
   blur of the small mask (joint bilateral upsampling). Away from edges it is the plain mask. */
float guidedMatte(vec2 s){
  if (uMatteSize.x < 1.0) return matteAt(s);
  vec3 c0 = texture2D(uVideo, vec2(s.x, 1.0 - s.y)).rgb; float acc = 0.0, sum = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    vec2 q = s + vec2(float(i), float(j)) / uMatteSize; vec3 d = texture2D(uVideo, vec2(q.x, 1.0 - q.y)).rgb - c0;
    float w = exp(-dot(d, d) * 40.0) * (i == 0 && j == 0 ? 1.5 : 1.0); acc += matteAt(q) * w; sum += w; }
  return acc / max(sum, 1e-4);
}
float alphaAt(vec2 s){ float m = guidedMatte(s); return smoothstep(0.5 - uFeather + uShift, 0.5 + uFeather + uShift, m); }
void main(){ vec2 st = vec2(vUv.x, 1.0 - vUv.y); st = uCenter + (st - uCenter) / uScale; vec2 s = (st - uRect.xy) / uRect.zw;
  float a = alphaAt(s); if (uInvert > 0.5) a = 1.0 - a; if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) a = 0.0;
  for (int q = 0; q < 8; q++) { if (q >= uExcludeN) break; if (inQuad(s, q)) a = 0.0; }
  if(uGround >= 0.0) { float front = 0.0; for(int i=0;i<16;i++){ if(i>=uSubjectsN) break; vec4 b=uSubjects[i]; if(s.x>=b.x && s.x<=b.z && s.y>=b.y && s.y<=b.w && b.w>=uGround) front=1.0; } a*=front; }
  vec3 col = texture2D(uVideo, vec2(s.x, 1.0 - s.y)).rgb;
  if (uBlur > 0.0) { vec3 acc = vec3(0.0); float n = 0.0; for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) { vec2 o = vec2(float(i), float(j)) * uBlur * 0.0025; acc += texture2D(uVideo, vec2(s.x + o.x, 1.0 - s.y - o.y)).rgb; n += 1.0; } col = acc / n; }
  if (uOutline > 0.0) { float ring = 0.0; for (int k = 0; k < 12; k++) { float an = float(k) / 12.0 * 6.2831853; ring = max(ring, alphaAt(s + vec2(cos(an), sin(an)) * uOutline * 0.004)); }
    float edge = clamp(ring - a, 0.0, 1.0); if (uTrace < 1.0) { vec2 d = s - vec2(0.5, 0.5); float an = (atan(d.y, d.x) + 3.14159265) / 6.2831853; edge *= step(an, uTrace); }
    gl_FragColor = vec4(mix(col, uOutlineColor, edge) , max(a, edge) * uOpacity); return; }
  gl_FragColor = vec4(col, a * uOpacity); }`;

export function createTracked(layer, root, options = {}) {
  let disposed=false;
  const viewport=()=>options.viewport?.()??{w:innerWidth,h:innerHeight};
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; root.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1)); renderer.setSize(viewport().w, viewport().h, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false; renderer.localClippingEnabled = true;
  const scene = new THREE.Scene();const modelLights=[new THREE.HemisphereLight(0xffffff,0x777f90,2),new THREE.DirectionalLight(0xffffff,2)];modelLights[1].position.set(1,2,3);
  const modelUniforms={...occlusionUniforms(THREE),uModelLens:{value:0},uPrincipal:{value:new THREE.Vector2()},uOutput:{value:new THREE.Vector2()},uSourceRect:{value:new THREE.Vector4()},uModelMask:{value:null},uModelDepth:{value:null},uModelOrdering:{value:0},uModelRange:{value:100},uModelOpacity:{value:1}}; const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const persp = new THREE.PerspectiveCamera(30, viewport().w / viewport().h, 0.1, 100); persp.position.set(0, 0, 10); persp.lookAt(0, 0, 0);
  const duration = Math.max(0.1, layer.duration || 4);
  const src = layer.source ?? {},onlySpatial=(layer.items??[]).length>0&&(layer.items??[]).every(it=>it.spatialAnchor),needsMain=!onlySpatial||layer.mode!=='textBehind'||layer.ownBackground!==false||layer.defaultDepth==='behind'&&!layer.analysis?.occlusion; const main = src.src&&needsMain ? video(src.src) : null;
  const other = layer.revealSrc ? video(layer.revealSrc) : null;
  const echoes = layer.mode === 'echo' ? Array.from({ length: layer.echoCount ?? 3 }, () => video(src.src)) : [];
  const frozen = layer.mode === 'freezePop' ? video(src.src) : null;
  let track = null, seg = null,spatial=null,nativeOcclusion=null,nativeFrame=null;const nativeTextures=new Map(); const atlases = [],planeTracks=new Map();
  const mkTex = (el) => { const t = el instanceof HTMLVideoElement ? new THREE.VideoTexture(el) : new THREE.Texture(el); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  const items = [],itemVideos=[];const modelCamera=new THREE.Camera(),geometryCamera=new THREE.Camera(),geometryScene=new THREE.Scene(),geometryMeshes=new Map();let geometryTarget=null,geometryDepth=null;
  const ready = (async () => {
    [track, seg,spatial,nativeOcclusion] = await Promise.all([loadJson(layer.track), loadJson(layer.matte?.meta),layer.spatialData?Promise.resolve(layer.spatialData):loadJson(layer.analysis?.spatial),loadJson(layer.analysis?.occlusion)]);
    if(spatial)for(const shot of spatial.shots){if(!shot.mesh?.triangles?.length)continue;const positions=new Float32Array(shot.mesh.triangles.flatMap(tri=>tri.flatMap(i=>shot.mesh.vertices[i]))),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));const material=new THREE.ShaderMaterial({side:THREE.DoubleSide,vertexShader:'varying float z;uniform float lens;uniform vec2 principal;void main(){vec4 p=modelViewMatrix*vec4(position,1.);z=-p.z;gl_Position=projectionMatrix*p;vec2 v=p.xy/p.z;gl_Position.xy=principal*gl_Position.w+(gl_Position.xy-principal*gl_Position.w)*(1.+lens*dot(v,v));}',fragmentShader:'precision highp float;varying float z;uniform float range;void main(){if(z<=0.||z>=range)discard;float packed=floor(z/range*65535.+.5);gl_FragColor=vec4(floor(packed/256.)/255.,mod(packed,256.)/255.,.9,1.);}',uniforms:{principal:{value:new THREE.Vector2()},lens:{value:0},range:{value:100}}}),mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;geometryMeshes.set(shot.id,mesh);}
    await Promise.all([...new Set((layer.items??[]).map(it=>it.track).filter(Boolean))].map(async path=>planeTracks.set(path,await loadJson(path))));
    if (seg) for (let i = 0; i < seg.atlases.length; i++) atlases.push(await loadImage(seg.atlases[i]).then((img) => { const t = img ? new THREE.Texture(img) : null; if (t) { t.needsUpdate = true; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = false; } return t; }));
    await Promise.all([main?.ready, other?.ready, frozen?.ready, ...echoes.map((e) => e.ready)]);
    for (const [sourceIndex,it] of (layer.items ?? []).entries()) {if(disposed)return;
      if(it.model){const mesh=await createModel({model:it.model,height:1,animations:it.animations??[]},BASE);mesh.traverse(node=>{if(!node.material)return;for(const m of Array.isArray(node.material)?node.material:[node.material]){m.transparent=true;m.depthWrite=true;m.onBeforeCompile=shader=>{Object.assign(shader.uniforms,modelUniforms);shader.vertexShader='varying float vSpatialDepth;uniform float uModelLens;uniform vec2 uPrincipal;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvSpatialDepth=-mvPosition.z;float radial=1.+uModelLens*dot(mvPosition.xy/mvPosition.z,mvPosition.xy/mvPosition.z);gl_Position.xy=uPrincipal*gl_Position.w+(gl_Position.xy-uPrincipal*gl_Position.w)*radial;');shader.fragmentShader=SPATIAL_OCCLUSION_GLSL+'\nvarying float vSpatialDepth;uniform vec2 uOutput;uniform vec4 uSourceRect;uniform sampler2D uModelMask;uniform sampler2D uModelDepth;uniform float uModelOrdering;uniform float uModelRange;uniform float uModelOpacity;\n'+shader.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\nvec2 st=vec2(gl_FragCoord.x/uOutput.x,1.-gl_FragCoord.y/uOutput.y),uv=(st-uSourceRect.xy)/uSourceRect.zw;float visibility=spatialVisibility(uv,vSpatialDepth);gl_FragColor.a*=visibility*uModelOpacity;if(gl_FragColor.a<.001)discard;');};}});items.push({it,mesh,kind:'model',sourceIndex});continue;}
      if(it.video){const media=video(it.video);await media.ready;itemVideos.push({it,media});const o=makeItem(it,media.v);o.aspect=media.v.videoWidth/media.v.videoHeight;o.mesh.material.uniforms.uTex.value.needsUpdate=true;items.push({...o,sourceIndex});continue;}
      const px = pxFor(it);
      if (it.letters) { for (const [n, L] of (await letterCanvases(it, px)).entries()) items.push({...makeItem({ ...it, letters: false, letterOff: L.off, letterIdx: n, text: String(it.text ?? '')[n] }, L.c),sourceIndex}); }
      else items.push({...makeItem(it, await itemCanvas(it, px)),sourceIndex});
    }
  })();
  const proxy = () => [track?.w ?? seg?.w ?? 480, track?.h ?? seg?.h ?? 270];
  /* the font size to draw an item's text at: its height on the stage at export size (1920 tall at most), with room for
     growing (a scale move, a near point) */
  const pxFor = (it) => { const [, ph] = proxy(); const R = rect(); const stagePx = ((it.size ?? ph * 0.25) / ph) * R.w * Math.max(viewport().h, layer.stageH ?? 1920); const grow = Math.max(1, ...((it.motion?.keys ?? []).map((k) => k.s ?? 1))); return Math.round(Math.min(1400, Math.max(200, stagePx * 0.75 * grow))); };
  /* where the footage sits on the stage (as the Video line shows it: contain unless cover) */
  const rect = () => {if(options.sourceRect)return new THREE.Vector4(options.sourceRect.x,options.sourceRect.y,options.sourceRect.w,options.sourceRect.h);
    const vw = main?.v.videoWidth || main?.v.naturalWidth || layer.analysis?.w || 16, vh = main?.v.videoHeight || main?.v.naturalHeight || layer.analysis?.h || 9; const W = viewport().w, H = viewport().h; const fit = layer.fit ?? 'contain';
    const k = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh); const w = vw * k, h = vh * k;
    return new THREE.Vector4((W - w) / 2 / W, (H - h) / 2 / H, w / W, h / H);
  };
  /* item pictures stay sharp: drawn at the size they will be seen at (see pxFor), mipmapped and anisotropic so a
     tilted or shrinking word stays clean instead of shimmering */
  const sharp = (t) => { t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
  function makeItem(it, c) {
    const tex=c instanceof HTMLVideoElement?new THREE.VideoTexture(c):sharp(new THREE.CanvasTexture(c));
    if (it.spatialAnchor||(it.place ?? 'surface') === 'surface') {
      const mat = new THREE.ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: FLAT_FS, transparent: true, depthTest:!!it.spatialAnchor,depthWrite:!!it.spatialAnchor,
        uniforms: { uRect: { value: new THREE.Vector4() }, uProxy: { value: new THREE.Vector2() }, uHinv: { value: new THREE.Matrix3() }, uTex: { value: tex }, uAnchor: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2() }, uRot: { value: 0 }, uOpacity: { value: 1 }, uWipe: { value: 2 },uUsePlane:{value:0},uPlaneInverse:{value:new THREE.Matrix3()},...occlusionUniforms(THREE),uSpatial:{value:0},uK:{value:new THREE.Vector4()},uLens:{value:0},uSpatialSize:{value:new THREE.Vector2()},uPlaneOrigin:{value:new THREE.Vector3()},uPlaneRight:{value:new THREE.Vector3()},uPlaneDown:{value:new THREE.Vector3()}, } }); over(mat);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false;
      return { it, mesh, aspect:(c.videoWidth||c.width)/(c.videoHeight||c.height), kind: 'surface' };
    }
    /* standing: a 3D card of the text with depth (slices), placed in a perspective view each frame */
    const g = new THREE.Group(); const depth = it.depth ?? 0.15; const n = Math.min(8, Math.max(1, Math.round(depth / 0.025)));
    const side = document.createElement('canvas'); side.width = c.width; side.height = c.height; const sg = side.getContext('2d'); sg.drawImage(c, 0, 0); sg.globalCompositeOperation = 'source-in'; sg.fillStyle = it.sideColor ?? '#444a55'; sg.fillRect(0, 0, side.width, side.height);
    const sideTex = sharp(new THREE.CanvasTexture(side));
    const ar = c.width / c.height;
    const clip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6);
    for (let i = n; i >= 1; i--) { const m = new THREE.Mesh(new THREE.PlaneGeometry(ar, 1), new THREE.MeshBasicMaterial({ map: sideTex, transparent: true, alphaTest: 0.4, depthWrite: false, clippingPlanes: [clip] })); m.position.z = -depth * (i / n); m.position.y = 0.5; g.add(m); }
    const front = new THREE.Mesh(new THREE.PlaneGeometry(ar, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, depthWrite: false, clippingPlanes: [clip] })); front.position.y = 0.5; g.add(front);
    if (it.shadow) { const sh = new THREE.Mesh(new THREE.PlaneGeometry(ar * 1.1, 0.35), new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, opacity: it.shadowOpacity ?? 0.45, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.002, 0.05); g.add(sh); }
    return { it, mesh: g, aspect: ar, kind: 'standing', clip };
  }
  let shadowCache = null;
  function shadowTex() { if (shadowCache) return shadowCache; const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 32, 4, 128, 32, 120); gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 64); shadowCache = new THREE.CanvasTexture(c); return shadowCache; }

  /* the foreground pass(es) */
  const fgMat = () => over(new THREE.ShaderMaterial({ vertexShader: FLAT_VS, fragmentShader: FG_FS, transparent: true, depthTest: false,
    uniforms: { uRect: { value: new THREE.Vector4() }, uVideo: { value: null }, uMatte: { value: null }, uMatteRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uFeather: { value: 0.12 }, uShift: { value: 0 }, uOpacity: { value: 1 }, uScale: { value: 1 }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uOutline: { value: 0 }, uOutlineColor: { value: new THREE.Color('#ffffff') }, uInvert: { value: 0 }, uBlur: { value: 0 }, uTrace: { value: 1 }, uMatteSize: { value: new THREE.Vector2(0, 0) }, uExcludeN: { value: 0 }, uExclude: { value: Array.from({ length: 32 }, () => new THREE.Vector2()) } } }));
  const quad = (mat) => { Object.assign(mat.uniforms, { uGround: { value: -1 }, uSubjectsN: { value: 0 }, uSubjects: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) } }); const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; return m; };
  const fg = quad(fgMat()); const bgPass = quad(fgMat()); const extra = quad(fgMat());
  const echoQuads = echoes.map(() => quad(fgMat()));
  const vtex = new Map(); const texOf = (el) => { if (!vtex.has(el)) vtex.set(el, mkTex(el)); return vtex.get(el); };

  /* the matte frame for a source second, as a sub-rect of its atlas */
  const matteAt = (x) => {
    if (!seg || !atlases.length) return null;
    /* the mask frame nearest this source second (frames were caught at their own times) */
    let i;
    if (Array.isArray(seg.times) && seg.times.length) { const T = seg.times; let lo = 0, hi = T.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= x) lo = mid; else hi = mid; } i = Math.abs(T[hi] - x) < Math.abs(T[lo] - x) ? hi : lo; i = Math.min(i, seg.count - 1); }
    else i = Math.max(0, Math.min(seg.count - 1, Math.round((x - (seg.start ?? 0)) * seg.fps)));
    const per = seg.cols * seg.rows; const a = Math.floor(i / per), j = i % per;
    const tex = atlases[a]; if (!tex) return null;
    return { tex, rect: new THREE.Vector4((j % seg.cols) / seg.cols, Math.floor(j / seg.cols) / seg.rows, 1 / seg.cols, 1 / seg.rows), info: seg.frames?.[i] ?? null };
  };
  /* Only the tracked layer nearest the footage paints the footage (higher ones would cover what it drew): another
     tracked page on a lower line, on at this moment, means this one draws only its objects and the subject. Read from
     the film around this page each frame, so moving or deleting layers keeps it right. */
  const lowest = (t) => {
    let spans = null; try { spans = window.parent !== window ? window.parent.__filmSpans?.() : null; } catch { spans = null; }
    if (!spans) return true;
    const me = spans.find((c) => String(c.src).includes(layer.id)); if (!me) return true;
    const T = me.at + t;
    return !spans.some((c) => c !== me && /layer-trk-/.test(String(c.src)) && c.track > me.track && T >= c.at && T < c.end);
  };
  async function nativeTexture(path){
    if(!path)return null;let entry=nativeTextures.get(path);if(!entry){entry=loadImage(path).then(image=>{if(!image)return null;const texture=new THREE.Texture(image);texture.needsUpdate=true;texture.colorSpace=THREE.NoColorSpace;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.flipY=false;return texture;});nativeTextures.set(path,entry);while(nativeTextures.size>8){const key=nativeTextures.keys().next().value,pending=nativeTextures.get(key);nativeTextures.delete(key);void pending.then(texture=>texture?.dispose());}}else{nativeTextures.delete(path);nativeTextures.set(path,entry);}return entry;
  }
  async function prepareNative(time,layerTime){
    if(!nativeOcclusion?.frames?.length)return null;const us=Math.round(time*1e6),frames=nativeOcclusion.frames;let at=0;while(at<frames.length-1&&Math.abs(frames[at+1].sourceTimeUs-us)<Math.abs(frames[at].sourceTimeUs-us))at++;
    const frame=frames[at];if(Math.abs(frame.sourceTimeUs-us)>80000||frame.confidence!=null&&frame.confidence<.55)return null;const base=layer.analysis.occlusion.slice(0,layer.analysis.occlusion.lastIndexOf('/')+1),settings=depthSettings(layerTime),instance=settings.target&&settings.target!=='all'?frame.instances?.find(p=>p.id===Number(settings.target)):null;
    const [union,mask,depth]=await Promise.all([nativeTexture(frame.mask?base+frame.mask:null),nativeTexture(instance?base+instance.path:settings.target&&settings.target!=='all'?null:frame.mask?base+frame.mask:null),nativeTexture(frame.depth?base+frame.depth:null)]);
    return {...frame,targetSpecific:settings.target&&settings.target!=='all',unionTexture:union,maskTexture:mask,depthTexture:depth};
  }

  /* The scan's own foreground matte, used for text placed in the scene when no precise masks were made. The matte lives in
     an atlas of small tiles; the tile for this moment is copied out so the occlusion shader can sample it as one mask. */
  let tileCanvas=null,tileTexture=null;
  function lightFrame(m){
    const img=m.tex.image,tw=Math.max(1,Math.round(img.width*m.rect.z)),th=Math.max(1,Math.round(img.height*m.rect.w));
    if(!tileCanvas||tileCanvas.width!==tw||tileCanvas.height!==th){tileCanvas=document.createElement('canvas');tileCanvas.width=tw;tileCanvas.height=th;tileTexture?.dispose();tileTexture=new THREE.CanvasTexture(tileCanvas);tileTexture.minFilter=THREE.LinearFilter;tileTexture.magFilter=THREE.LinearFilter;tileTexture.generateMipmaps=false;tileTexture.colorSpace=THREE.NoColorSpace;tileTexture.flipY=false;}
    tileCanvas.getContext('2d').drawImage(img,Math.round(img.width*m.rect.x),Math.round(img.height*m.rect.y),tw,th,0,0,tw,th);tileTexture.needsUpdate=true;
    return {light:true,targetSpecific:false,unionTexture:tileTexture,maskTexture:tileTexture,depthTexture:null};
  }
  /* "Auto" needs a depth for the subject. Without one, text on a wall goes behind whoever stands in the picture: a person or car
     in the shot is almost always nearer the camera than the wall behind them. The person can still choose "in front". */
  const occlusionSettings=(t,anchor)=>{const s=depthSettings(t);return nativeFrame?.light&&s.mode==='auto'&&anchor?.type==='surface'?{...s,mode:'behind'}:s;};
  function setCalibratedCamera(camera,pose,Rv){return setSpatialCamera(camera,spatial,pose,[Rv.x,Rv.y,Rv.z,Rv.w]);}
  function prepareGeometryDepth(time){geometryDepth=null;const pose=spatialPoseAt(spatial,Math.round(time*1e6)),mesh=pose&&geometryMeshes.get(pose.shotId);if(!mesh)return;const k=Math.min(1,720/Math.max(spatial.width,spatial.height));geometryTarget??=new THREE.WebGLRenderTarget(Math.round(spatial.width*k),Math.round(spatial.height*k),{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true});geometryScene.clear();geometryScene.add(mesh);mesh.material.uniforms.lens.value=pose.distortion?.[0]??0;mesh.material.uniforms.principal.value.set(2*pose.intrinsics[0][2]/spatial.width-1,1-2*pose.intrinsics[1][2]/spatial.height);setCalibratedCamera(geometryCamera,pose,new THREE.Vector4(0,0,1,1));renderer.setRenderTarget(geometryTarget);renderer.clear();renderer.render(geometryScene,geometryCamera);renderer.setRenderTarget(null);geometryDepth=geometryTarget.texture;}
  const srcTime = (t) => (main?.still ? 0 : (src.at ?? 0) + t * (src.speed ?? 1));
  const depthSettings=t=>{for(const r of layer.occlusion??[])if(t>=r.from&&t<r.to)return {mode:r.mode,target:r.target??layer.occlusionTarget??'all',manualDepth:r.manualDepth??layer.manualDepth??3};return {mode:layer.defaultDepth??'behind',target:layer.occlusionTarget??'all',manualDepth:layer.manualDepth??3};};
  const depthMode=t=>depthSettings(t).mode;

  const size = () => { const w = viewport().w, h = viewport().h; const cur = renderer.getSize(new THREE.Vector2()); if (cur.x !== w || cur.y !== h) { renderer.setSize(w, h, false); persp.aspect = w / h; persp.updateProjectionMatrix(); } };
  let frameEpoch=0;
  const api = {
    duration,
    dispose(){if(disposed)return;disposed=true;frameEpoch++;geometryTarget?.dispose();for(const mesh of geometryMeshes.values()){mesh.geometry.dispose();mesh.material.dispose();}for(const pending of nativeTextures.values())void pending.then(texture=>texture?.dispose());nativeTextures.clear();const textures=new Set([...atlases,...vtex.values(),shadowCache].filter(Boolean));for(const object of [fg,bgPass,extra,...items.map(o=>o.mesh)])object.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])if(material){for(const value of Object.values(material))if(value?.isTexture)textures.add(value);for(const uniform of Object.values(material.uniforms??{}))if(uniform.value?.isTexture)textures.add(uniform.value);material.dispose();}});textures.forEach(t=>t.dispose());for(const media of [main,other,frozen,...echoes,...itemVideos.map(o=>o.media)])if(media?.v instanceof HTMLVideoElement){media.v.pause();media.v.removeAttribute('src');media.v.load();}renderer.dispose();renderer.forceContextLoss();canvas.remove();},
    /* one draw while loading: the first render of new textures and shaders is not yet the real picture (it came out
       opaque), so every frame the host asks for, the first included, is the settled one */
    ready: ready.then(() => api.frame(0)).then(() => {}),
    async frame(t) {
      if(disposed)return;const epoch=++frameEpoch;size();
      const tt = Math.min(Math.max(t, 0), duration); const x = srcTime(tt);
      if(!main?.still&&layer.analysis&&(x<layer.analysis.from||x>=layer.analysis.to)){renderer.clear();return;}
      const matte = matteAt(x);
      const needsFootage = layer.mode !== 'textBehind' || layer.ownBackground !== false || !!matte?.info;
      const nativeJob=prepareNative(x,tt);const jobs = [...itemVideos.map(({it,media})=>seek(media.v,Math.max(0,tt-(it.videoAt??0))*(it.videoSpeed??1)+(it.videoFrom??0))),main && needsFootage && seek(main.v, x),nativeJob];
      if (other) jobs.push(seek(other.v, (layer.revealAt ?? 0) + tt));
      if (frozen) jobs.push(seek(frozen.v, srcTime(Math.min(tt, layer.freezeAt ?? 0.5))));
      echoes.forEach((e, k) => jobs.push(seek(e.v, srcTime(Math.max(0, tt - (k + 1) * (layer.echoGap ?? 0.08))))));
      await Promise.all(jobs);if(disposed||epoch!==frameEpoch)return;nativeFrame=await nativeJob;if(!nativeFrame&&spatial&&matte?.tex?.image)nativeFrame=lightFrame(matte);
      const R = rect(); const [pw, ph] = proxy();prepareGeometryDepth(x);
      const H = track ? transformAt(track, x) : [1, 0, 0, 0, 1, 0, 0, 0, 1]; const Hinv = inv3(H) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const m = matte;
      const subject = m?.info ?? null; /* { box:[x0,y0,x1,y1] proxy px, foot: y proxy px } */
      const subjects = (subject?.subjects ?? (subject ? [subject] : [])).slice(0, 16);
      fg.material.uniforms.uSubjectsN.value = subjects.length;
      subjects.forEach((s, i) => fg.material.uniforms.uSubjects.value[i].set(s.box[0]/pw,s.box[1]/ph,s.box[2]/pw,s.foot/ph));
      fg.material.uniforms.uGround.value = -1;
      renderer.clear();
      const setFg = (q, el, opts = {}) => { const u = q.material.uniforms; u.uRect.value.copy(R); u.uVideo.value = texOf(el); if (el instanceof HTMLVideoElement || !u.uVideo.value.__up) { u.uVideo.value.needsUpdate = true; u.uVideo.value.__up = true; } u.uMatte.value = (opts.matte ?? m)?.tex ?? null; if ((opts.matte ?? m)) u.uMatteRect.value.copy((opts.matte ?? m).rect); if (u.uMatteSize) u.uMatteSize.value.set(u.uMatte.value && !opts.blur ? seg?.w ?? 0 : 0, u.uMatte.value && !opts.blur ? seg?.h ?? 0 : 0); u.uFeather.value = layer.feather ?? 0.05; u.uShift.value = layer.edgeShift ?? -0.06; /* a hair wider than the analysed mask: a thin miss along an arm or coat edge must not let text through a body */ u.uOpacity.value = opts.opacity ?? 1; u.uScale.value = opts.scale ?? 1; u.uCenter.value.set(opts.center?.[0] ?? 0.5, opts.center?.[1] ?? 0.5); u.uOutline.value = opts.outline ?? 0; u.uOutlineColor.value.set(opts.outlineColor ?? '#ffffff'); u.uInvert.value = opts.invert ? 1 : 0; u.uBlur.value = opts.blur ?? 0; u.uTrace.value = opts.trace ?? 1; };
      const draw = (obj) => {const content=spatial?.content??layer.analysis?.content,scissor=obj.userData.spatialModel&&content;if(scissor){renderer.setScissor(Math.round((R.x+content.x*R.z)*viewport().w),Math.round((1-R.y-(content.y+content.h)*R.w)*viewport().h),Math.round(content.w*R.z*viewport().w),Math.round(content.h*R.w*viewport().h));renderer.setScissorTest(true);}scene.clear(); scene.add(obj);if(obj.userData.spatialModel)scene.add(...modelLights); renderer.render(scene,obj.userData.spatialModel?modelCamera: obj.isMesh && obj.material?.isShaderMaterial ? ortho : persp);if(scissor)renderer.setScissorTest(false); };
      const mode = layer.mode ?? 'textBehind';
      const prog = (a, b) => Math.min(1, Math.max(0, (tt - a) / Math.max(1e-6, b - a)));
      const subjectCenter = subject?.box ? [((subject.box[0] + subject.box[2]) / 2 / pw) * R.z + R.x, ((subject.box[1] + subject.box[3]) / 2 / ph) * R.w + R.y] : [0.5, 0.5];

      /* effects drawn under the objects */
      if (mode === 'focus' && main && m) { const k = prog(layer.focusFrom ?? 0, layer.focusTo ?? duration); setFg(bgPass, main.v, { invert: true, blur: 6 * (1 - k) + 0.01, opacity: 1 }); draw(bgPass); setFg(bgPass, main.v, { blur: 6 * k + 0.01 }); draw(bgPass); return; }
      if (mode === 'parallax' && main && m) { const k = (tt / duration) * 2 - 1; setFg(bgPass, main.v, { invert: true, scale: 1.08, center: [0.5 + k * 0.02, 0.5], matte: null }); bgPass.material.uniforms.uMatte.value = null; bgPass.material.uniforms.uInvert.value = 0; bgPass.material.uniforms.uFeather.value = 10; draw(bgPass); setFg(fg, main.v, { scale: 1.04, center: [0.5 - k * 0.035, 0.5] }); draw(fg); return; }
      if (mode === 'maskReveal' && other && m) { setFg(extra, other.v, {}); draw(extra); return; }
      if (mode === 'freezePop' && frozen) {
        const F = layer.freezeAt ?? 0.5, D = layer.freezeHold ?? 1.2;
        if (tt >= F && tt < F + D) { const mf = matteAt(srcTime(F)); setFg(bgPass, frozen.v, { invert: false, matte: null }); bgPass.material.uniforms.uFeather.value = 10; bgPass.material.uniforms.uShift.value = -0.6; draw(bgPass); const k = Math.min(1, (tt - F) / 0.25); setFg(fg, frozen.v, { matte: mf, scale: 1 + 0.07 * k, center: subjectCenter, outline: 2.5 * k, outlineColor: layer.outlineColor ?? '#ffffff' }); draw(fg); }
        return;
      }
      if (mode === 'echo' && m) { echoes.forEach((e, k) => { const me = matteAt(srcTime(Math.max(0, tt - (k + 1) * (layer.echoGap ?? 0.08)))); setFg(echoQuads[k], e.v, { matte: me, opacity: (layer.echoOpacity ?? 0.45) * (1 - k / echoes.length) }); draw(echoQuads[k]); }); setFg(fg, main.v, {}); draw(fg); return; }
      if (mode === 'cutout' && main && m) { const k = prog(layer.popFrom ?? 0, (layer.popFrom ?? 0) + 0.3); setFg(fg, main.v, { scale: 1 + (layer.popScale ?? 0.06) * k, center: subjectCenter, outline: (layer.outline ?? 3) * k, outlineColor: layer.outlineColor ?? '#ffffff' }); draw(fg); return; }
      if (mode === 'outline' && main && m) { setFg(fg, main.v, { outline: layer.outline ?? 3, outlineColor: layer.outlineColor ?? '#ffffff', trace: prog(layer.traceFrom ?? 0, layer.traceTo ?? Math.min(duration, 1.2)), opacity: 1 }); fg.material.uniforms.uInvert.value = 0; draw(fg); return; }

      /* objects, each behind or in front of the subject */
      const depth = depthMode(tt);
      const placed = items.map((o) => {
        const it = o.it; const st = it.motion ? motionAt(it.motion, tt, duration) : null;
        const measured=planeTracks.get(it.track)??track,rawH=measured?transformAtAnchored(measured,x,it.anchor):H,itemH=it.place==='surface'?surfaceDepthMatrix(rawH,it.planeQuad,it.sceneDepth??.5):rawH;
        let anchor = [...(it.anchor ?? [pw / 2, ph * 0.7])];
        const sizeH = (it.size ?? ph * 0.25) * (st?.s ?? 1);
        if (o.it.letterOff != null) anchor = [anchor[0] + o.it.letterOff * sizeH * (it.spacing ?? 1), anchor[1]];
        const ground = it.place === 'surface' ? apply(itemH, anchor) : placedPoint(itemH, anchor, it.sceneDepth ?? .5);
        const front = depth === 'front' || (depth === 'auto' && subject && !(ground[1] < subject.foot && ground[0] > subject.box[0] - pw * 0.05 && ground[0] < subject.box[2] + pw * 0.05));
        return { o, st, anchor, sizeH, ground, front,H:itemH,measured };
      }).sort((a, b) => (b.o.it.sceneDepth ?? .5) - (a.o.it.sceneDepth ?? .5));
      const drawItem = ({ o, st, anchor, sizeH, ground,H,measured }) => {
        const Hinv=inv3(H)??[1,0,0,0,1,0,0,0,1];
        const it = o.it; const A = animState(it, tt, duration);if(it.video&&tt<(it.videoAt??0))return;
        let liveAnchor=it.spatialAnchor;if(liveAnchor){try{liveAnchor=sceneAnchor(layer.items,o.sourceIndex,tt,spatialPoseAt(spatial,Math.round(x*1e6)),item=>{const measured=planeTracks.get(item.track);if(!measured||pinVisibilityAt(measured,x)<.99)return null;return objectAnchorAt(item.spatialAnchor,spatialPoseAt(spatial,Math.round(x*1e6)),transformAt(measured,x),item.spatialAnchor.referencePixels,[pw,ph,spatial.width,spatial.height],homography);});}catch{return;}if(!liveAnchor)return;}
        if(liveAnchor&&o.kind==='model'){
          const pose=spatialPoseAt(spatial,Math.round(x*1e6));if(!pose||pose.shotId!==liveAnchor.shotId)return;const frame=anchorFrame(liveAnchor,st,pose),height=it.worldHeight??1,K=pose.intrinsics;setCalibratedCamera(modelCamera,pose,R);
          const matrix=new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.right),new THREE.Vector3(...frame.down).negate(),new THREE.Vector3(...frame.normal));matrix.scale(new THREE.Vector3(...frame.scale.map(v=>v*height*A.s)));matrix.setPosition(...frame.position);o.mesh.matrixAutoUpdate=false;o.mesh.matrix.copy(matrix);o.mesh.userData.animate(tt,it);o.mesh.userData.spatialModel=true;modelUniforms.uModelLens.value=pose.distortion?.[0]??0;modelUniforms.uPrincipal.value.set(2*(R.x+K[0][2]/spatial.width*R.z)-1,1-2*(R.y+K[1][2]/spatial.height*R.w));modelUniforms.uOutput.value.set(canvas.width,canvas.height);modelUniforms.uSourceRect.value.copy(R);modelUniforms.uModelMask.value=nativeFrame?.maskTexture??null;modelUniforms.uModelDepth.value=nativeFrame?.depthTexture??null;modelUniforms.uModelOrdering.value=depthMode(tt)==='front'?0:depthMode(tt)==='behind'&&nativeFrame?.maskTexture?2:nativeFrame?.depthTexture?1:0;modelUniforms.uModelRange.value=nativeOcclusion?.depthRange??100;modelUniforms.uModelOpacity.value=(st?.o??1)*A.o;bindOcclusion(modelUniforms,{geometry:geometryDepth,frame:nativeFrame,settings:depthSettings(tt),range:nativeOcclusion?.depthRange??100,content:spatial.content??layer.analysis?.content});draw(o.mesh);return;
        }
        if(liveAnchor){
          const pose=spatialPoseAt(spatial,Math.round(x*1e6)),height=(it.worldHeight??.25)*A.s;
          const base=liveAnchor,spatialAnchor={...base,offset:[(base.offset?.[0]??0)+((it.letterOff??0)*(it.spacing??1)+A.dx)*height,(base.offset?.[1]??0)-A.dy*height,(base.offset?.[2]??0)],rotation:[...(base.rotation??[0,0,0])]};spatialAnchor.rotation[2]+=A.rz;
          const cameraPlane=anchorCameraPlane(spatialAnchor,height*o.aspect,height,pose,st);if(!cameraPlane)return;
          const u=o.mesh.material.uniforms;if(it.video)u.uTex.value.needsUpdate=true;u.uSpatial.value=1;u.uK.value.set(pose.intrinsics[0][0],pose.intrinsics[1][1],pose.intrinsics[0][2],pose.intrinsics[1][2]);u.uLens.value=pose.distortion?.[0]??0;u.uSpatialSize.value.set(spatial.width,spatial.height);u.uPlaneOrigin.value.set(...cameraPlane.origin);u.uPlaneRight.value.set(...cameraPlane.right);u.uPlaneDown.value.set(...cameraPlane.down);u.uRect.value.copy(R);u.uProxy.value.set(pw,ph);u.uHinv.value.identity();u.uUsePlane.value=0;u.uPlaneInverse.value.identity();u.uAnchor.value.set(.5,.5);u.uSize.value.set(1,1);u.uRot.value=0;bindOcclusion(u,{geometry:geometryDepth,frame:nativeFrame,settings:occlusionSettings(tt,liveAnchor),range:nativeOcclusion?.depthRange??100,content:spatial.content??layer.analysis?.content});u.uOpacity.value=(it.opacity??1)*(st?.o??1)*A.o;u.uWipe.value=A.wipe;draw(o.mesh);return;
        }
        const opacity = (it.opacity ?? 1) * (st?.o ?? 1) * A.o*pinVisibilityAt(measured,x)*projectionVisibility(H,anchor);
        if (opacity <= 0.001||it.planeQuad&&!validPlaneProjection(H,it.planeQuad)) return;
        if (o.kind === 'surface') {
          const u = o.mesh.material.uniforms;u.uSpatial.value=0; u.uRect.value.copy(R); u.uProxy.value.set(pw, ph); u.uHinv.value.set(...Hinv); u.uAnchor.value.set(anchor[0] + A.dx * sizeH, anchor[1] - A.dy * sizeH);
          const height=sizeH*A.s*depthFactor(it.sceneDepth??.5)/depthFactor(.5);u.uSize.value.set(height * o.aspect,height);const plane=planeTextMetrics(it.planeQuad,anchor,height,o.aspect);u.uUsePlane.value=plane?1:0;if(plane){u.uPlaneInverse.value.set(...plane.inverse);u.uAnchor.value.set(...plane.anchor);u.uSize.value.set(...plane.size);}u.uRot.value = ((it.rotation ?? 0) + (st?.r?.[2] ?? 0) + A.rz) * RAD; u.uOpacity.value = opacity; u.uWipe.value = A.wipe; draw(o.mesh); return;
        }
        /* standing: the scale of the scene at its ground point (how much a small step there grows in this frame) */
        const d = 2; const a = apply(H, [anchor[0] - d, anchor[1]]), b = apply(H, [anchor[0] + d, anchor[1]]); const k = Math.hypot(b[0] - a[0], b[1] - a[1]) / (2 * d);
        const sx = R.x + (ground[0] / pw) * R.z, sy = R.y + (ground[1] / ph) * R.w; /* stage 0…1 */
        const viewH = 2 * persp.position.z * Math.tan((persp.fov * RAD) / 2), viewW = viewH * persp.aspect;
        const z = ((.5 - (it.sceneDepth ?? .5)) * 4), perspective = (10 - z) / 10;
        const hWorld = (sizeH * k / ph) * R.w * viewH * depthFactor(it.sceneDepth ?? .5) * perspective;
        o.mesh.position.set((sx - 0.5) * viewW * perspective + A.dx * hWorld, (0.5 - sy) * viewH * perspective + (A.dy + (it.elevation ?? 0)) * hWorld, z);
        o.mesh.scale.setScalar(hWorld * A.s);
        o.mesh.rotation.set(((it.tiltX ?? 0) + (st?.r?.[0] ?? 0) + A.rx) * RAD, ((it.rotationY ?? 0) + (st?.r?.[1] ?? 0) + A.ry) * RAD, ((it.rotation ?? 0) + (st?.r?.[2] ?? 0) + A.rz) * RAD, 'YXZ');
        /* a wipe or typing reveal: a clip plane across the card, in its own left-to-right */
        o.mesh.updateMatrixWorld(true); const left = new THREE.Vector3(-o.aspect / 2, 0.5, 0).applyMatrix4(o.mesh.matrixWorld), right = new THREE.Vector3(o.aspect / 2, 0.5, 0).applyMatrix4(o.mesh.matrixWorld);
        const dir = right.clone().sub(left); const len = dir.length() || 1; dir.divideScalar(len);
        if (A.wipe >= 1) o.clip.set(new THREE.Vector3(-1, 0, 0), 1e6); else o.clip.setFromNormalAndCoplanarPoint(dir.clone().negate(), left.clone().add(dir.clone().multiplyScalar(len * A.wipe)));
        const polygon=(it.sceneClip??[]).map(p=>apply(H,p)).filter(p=>p.every(Number.isFinite));
        const boundaries=[];
        if(polygon.length>=3){const rays=polygon.map(p=>new THREE.Vector3((R.x+p[0]/pw*R.z)*2-1,1-(R.y+p[1]/ph*R.w)*2,0).unproject(persp)),center=rays.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(rays.length);for(let i=0;i<rays.length;i++){const plane=new THREE.Plane().setFromCoplanarPoints(persp.position,rays[i],rays[(i+1)%rays.length]);if(plane.distanceToPoint(center)<0)plane.negate();boundaries.push(plane);}}
        o.mesh.traverse((q) => { if (q.material) {q.material.opacity = (q.material.map === shadowCache ? (it.shadowOpacity ?? 0.45) : 1) * opacity;q.material.clippingPlanes=[o.clip,...boundaries];} });
        draw(o.mesh);
      };
      /* the footage itself, from the same decoded frame as the subject and the objects' tracking, so nothing can drift
         from the picture behind it (the Video line below plays on its own clock) */
      if (main && layer.ownBackground !== false && mode === 'textBehind' && lowest(tt)) { setFg(bgPass, main.v, { matte: null }); const u = bgPass.material.uniforms; u.uMatte.value = null; u.uInvert.value = 1; u.uFeather.value = 0.5; u.uShift.value = 0.5; draw(bgPass); }
      /* figures printed on an item's own surface (a poster, a screen) stay under the text there: one found when it was
         placed, and any detected "person" that lies wholly inside the surface without reaching its lower edge (people in
         front of a hung poster stand on the ground below it; a figure in the print does not) */
      { const u = fg.material.uniforms; let n = 0; const add = (pts) => { if (n >= 8) return; pts.forEach((c, i) => u.uExclude.value[n * 4 + i].set(c[0] / pw, c[1] / ph)); n++; };
        const within = (c, q) => { let sg = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], k = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (!k) continue; if (sg && Math.sign(k) !== sg) return false; sg = Math.sign(k); } return true; };
        for (const p of placed) { const it = p.o.it; if (!it.planeQuad) continue; const q = it.planeQuad.map((c) => apply(p.H, c)), bottom = Math.max(...q.map((c) => c[1])), top = Math.min(...q.map((c) => c[1]));
          const b0 = it.printedBox; if (b0) add([[b0[0], b0[1]], [b0[2], b0[1]], [b0[2], b0[3]], [b0[0], b0[3]]].map((c) => apply(p.H, c)));
          for (const sub of m?.info?.subjects ?? []) { const b = sub.box, c4 = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; if (c4.every((c) => within(c, q)) && b[3] < bottom - 0.08 * (bottom - top)) add(c4); } }
        u.uExcludeN.value = n; }
      /* precise people masks (SAM 2), where they were made for this stretch, replace the fast ones for the subject pass */
      const preciseTex = nativeFrame?.unionTexture ?? null, precise = preciseTex ? { tex: preciseTex, rect: new THREE.Vector4(0, 0, 1, 1) } : null;
      const subjectPass = () => { setFg(fg, main.v, precise ? { matte: precise } : {}); if (precise?.tex.image) fg.material.uniforms.uMatteSize.value.set(precise.tex.image.width, precise.tex.image.height); };
      if (depth === 'auto') {
        for (const p of placed) {
          if(p.o.it.spatialAnchor)continue;
          drawItem(p);
          if (main && (m?.info || precise)) { subjectPass(); fg.material.uniforms.uGround.value = p.ground[1] / ph + (.5 - (p.o.it.sceneDepth ?? .5)) * .22; draw(fg); }
        }
        fg.material.uniforms.uGround.value = -1;
        for(const p of placed)if(p.o.it.spatialAnchor)drawItem(p);
        return;
      }
      for (const p of placed) if (!p.front) drawItem(p);
      if (main && (m?.info || precise) && mode === 'textBehind') { subjectPass(); draw(fg); }
      for (const p of placed) if (p.front) drawItem(p);
    },
  };
  return api;
}
/* An item's entrance and exit: it.anim / it.animOut (a style, see ANIMS) over it.in / it.out seconds; letters of a
   split word start one after another (it.stagger s each). Returns what to apply: opacity, offset (in item heights),
   scale, turns (degrees) and how much of it is revealed left to right. Pure function of t. */
export const ANIMS = ['fade', 'rise', 'drop', 'pop', 'zoom', 'slideLeft', 'slideRight', 'wipe', 'type', 'flicker', 'flip', 'swing', 'spin', 'focus'];
function animState(it, t, dur) {
  const lag = (it.letterIdx ?? 0) * (it.stagger ?? (it.anim === 'type' ? 0.06 : 0.035));
  const a = it.in ? Math.min(1, Math.max(0, (t - lag) / it.in)) : 1, b = it.out ? Math.min(1, Math.max(0, (dur - t) / it.out)) : 1;
  const S = { o: 1, dx: 0, dy: 0, s: 1, rx: 0, ry: 0, rz: 0, wipe: 2 };
  const apply = (style, k, out) => {
    const sm = k * k * (3 - 2 * k), outE = 1 - Math.pow(1 - k, 3), back = 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2);
    switch (style ?? 'fade') {
      case 'rise': S.o *= sm; S.dy += (1 - outE) * (out ? 0.25 : -0.35); break;
      case 'drop': S.o *= sm; S.dy += (1 - outE) * 0.4; break;
      case 'pop': S.o *= Math.min(1, k * 2.5); S.s *= k <= 0 ? 0.001 : Math.max(0.001, back); break;
      case 'zoom': S.o *= sm; S.s *= 1 + (1 - outE) * (out ? 0.25 : 0.6); break;
      case 'slideLeft': S.o *= sm; S.dx += (1 - outE) * 1.2; break;
      case 'slideRight': S.o *= sm; S.dx -= (1 - outE) * 1.2; break;
      case 'wipe': S.wipe = Math.min(S.wipe, out ? 1 - (1 - k) : outE); if (k <= 0) S.o = 0; break;
      case 'type': { const n = Math.max(1, String(it.text ?? '').length + String(it.sub ?? '').length * 0.5); S.wipe = Math.min(S.wipe, Math.floor(k * n + 0.999) / n); if (k <= 0) S.o = 0; break; }
      case 'flicker': { const f = k >= 1 ? 1 : (Math.sin(k * 61) > 0.1 - k ? 1 : 0.15) * sm; S.o *= f; break; }
      case 'flip': S.o *= Math.min(1, k * 3); S.rx += (1 - outE) * -90; break;
      case 'swing': S.o *= Math.min(1, k * 3); S.ry += (1 - back) * 80; break;
      case 'spin': S.o *= sm; S.rz += (1 - outE) * 180; S.s *= 0.4 + 0.6 * outE; break;
      case 'focus': S.o *= sm; S.s *= 1 + (1 - outE) * 0.12; break;
      default: S.o *= sm;
    }
  };
  if (a < 1) apply(it.anim, a, false);
  if (b < 1) apply(it.animOut ?? it.anim, b, true);
  return S;
}
