import engineSrc from './lib/animationEngine.js?raw';
import runtimeSrc from './runtime.js?raw';
import chatRuntime from './chat-runtime.js?raw';
import chatCss from './chat.css?raw';
import redditRuntime from './reddit-runtime.js?raw';
import redditCss from './reddit.css?raw';
import subtitleRuntime from './subtitle-runtime.js?raw';
import subtitleStyles from './subtitle-styles.js?raw';
import wyrRuntime from './wyr-runtime.js?raw';
import transitionRuntime from './transition-runtime.js?raw';
import transitionGl from './transition-gl.js?raw';
import rippleEnvSrc from './ripple-env.js?raw';
import transitionCatalog from './transitions-catalog.js?raw';
import mgRuntime from './mg-runtime.js?raw';
import mgLib from './motion-graphics.js?raw';
import motion3dSrc from './motion3d.js?raw';
import scene3dSrc from './scene3d-runtime.js?raw';
import cameraSrc from './camera-runtime.js?raw';
import universalMotionSrc from './universal-motion.js?raw';
import universalCoreSrc from './universal-core.js?raw';
import trackRuntimeSrc from './track-runtime.js?raw';
import trackCoreSrc from './track-core.js?raw';
import trackSpaceSrc from './track-space.js?raw';
import motionSequenceSrc from './motion-sequence.js?raw';
import sceneGeometrySrc from './scene-geometry.js?raw';
import spatialOcclusionSrc from './spatial-occlusion.js?raw';
import spatialThreeSrc from './spatial-three.js?raw';
import spatialSceneSrc from './spatial-scene.js?raw';
import spatialGeometrySrc from './spatial-geometry.js?raw';
import fontLibrarySrc from './font-library.js?raw';
import fontRuntimeSrc from './font-runtime.js?raw';
import modelRuntimeSrc from './model-runtime.js?raw';
import { fontChoice } from './font-library.js';
import customRuntimeSrc from './custom-runtime.js?raw';
import worldGeo from './geo/world.json?raw';
import { applyPreset, presetById } from './lib/animationPresets.js';
import * as Engine from './lib/animationEngine.js';
import type { Clip, Film, Op } from '@/api';

/* A FRAME layer is one OpenFilm page: frame/<id>.html holding the layer's JSON and the shared runtime that draws it. */
export type Keyframe = { id: string; time: number; value: number | string; ease?: string | { type: string; points: number[] }; preset?: { id: string; phase: string } };
export type FrameLayer = {
  id: string; kind: 'shape' | 'text' | 'image' | 'group' | 'chat' | 'reddit' | 'subtitle' | 'wyr' | 'transition' | 'effect' | 'mg' | 'scene3d' | 'camera' | 'track' | 'custom'; name: string; duration: number; start?: number;
  shapeType?: string; text?: string; src?: string; font?: string; weight?: number; bold?: boolean; align?: string; textCase?: string;
  gradient?: boolean; dash?: number; sides?: number; shadow?: number; shadowColor?: string; glowColor?: string; flipH?: boolean; flipV?: boolean; fit?: string;
  keyframes: Record<string, Keyframe[]>; procedural?: Record<string, unknown>; expressions?: Record<string, string>; keyframeLoop?: Record<string, unknown>;
  appliedPresets?: Record<string, unknown>;
} & Record<string, any>;

/* the engine is plain JS, shared with the pages' runtime: typed loosely here */
const { keyframeId, sampleProperty, PROPERTY_DEFS, upsertKeyframe, removeKeyframeById } = Engine as unknown as {
  keyframeId: () => string; sampleProperty: (l: unknown, k: string, t: number, c?: unknown) => number | string | undefined;
  PROPERTY_DEFS: Record<string, { default: number | string; min?: number; max?: number; step?: number; unit?: string; label: string; group: string; type: string }>;
  upsertKeyframe: (f: Keyframe[], k: { time: number; value: number | string; ease?: string }, fps?: number) => Keyframe[];
  removeKeyframeById: (f: Keyframe[], id: string) => Keyframe[];
};
export { PROPERTY_DEFS };
export const FRAME_DIR = 'frame';
export const isFrameSrc = (src?: string) => !!src && src.startsWith(`${FRAME_DIR}/layer-`) && src.split('#')[0].endsWith('.html');
export const framePath = (id: string) => `${FRAME_DIR}/${id}.html`;
export const layerIdOf = (src: string) => src.split('#')[0].slice(FRAME_DIR.length + 1, -'.html'.length);
export const FPS = 30;

const escapeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
export const pageHtml = (layer: FrameLayer) =>
  `<!doctype html>\n<meta charset="utf-8">\n<title>${String(layer.name || 'Layer').replace(/[<&]/g, '')}</title>\n<script type="application/json" id="layer">${escapeJson(layer)}</script>\n<script type="module" src="runtime.js"></script>\n`;

const projectUrl = (projectId: string) => `/api/projects/${projectId}`;
async function put(projectId: string, path: string, text: string) {
  const r = await fetch(`${projectUrl(projectId)}/files?path=${encodeURIComponent(path)}&overwrite=1`, { method: 'PUT', body: text });
  if (!r.ok) throw new Error(`could not write ${path}: ${r.status}`);
}
const runtimeReady = new Map<string,Promise<void>>();
const fontFiles=new Map<string,Promise<void>>();
const projectFontPaths=new Map<string,Promise<Set<string>>>();
async function ensureFontFile(projectId:string,name:string){
  const font=fontChoice(name);if(!font)return;const key=`${projectId}:${font.id}`;
  if(!fontFiles.has(key))fontFiles.set(key,(async()=>{
    if(!projectFontPaths.has(projectId))projectFontPaths.set(projectId,fetch(`${projectUrl(projectId)}/files`).then(async r=>{if(!r.ok)throw new Error('Could not read project fonts.');const listing=await r.json();return new Set<string>(listing.files.map((f:{path:string})=>f.path));}).catch(e=>{projectFontPaths.delete(projectId);throw e;}));
    const paths=await projectFontPaths.get(projectId)!,path=`frame/fonts/${font.id}.ttf`;if(paths.has(path))return;
    const source=await fetch(`/assets/fonts/${font.id}.ttf`);if(!source.ok)throw new Error(`Font ${name} is unavailable.`);
    const r=await fetch(`${projectUrl(projectId)}/files?path=${encodeURIComponent(path)}`,{method:'PUT',body:await source.blob()});if(!r.ok)throw new Error(`Could not save font ${name}.`);paths.add(path);
  })().catch(e=>{fontFiles.delete(key);throw e;}));return fontFiles.get(key);
}
/** Writes a project file that is not a page (an analysis, a mask atlas); returns where it landed (a name in use gets another). */
/** opts.overwrite: replace a file that is already there (otherwise the server keeps the existing one and refuses). */
export async function putFile(projectId: string, path: string, body: string | Blob, opts: { overwrite?: boolean } = {}): Promise<string> {
  const r = await fetch(`${projectUrl(projectId)}/files?path=${encodeURIComponent(path)}${opts.overwrite ? '&overwrite=1' : ''}`, { method: 'PUT', body });
  if (!r.ok) throw new Error(`could not write ${path}: ${r.status}`);
  return ((await r.json().catch(() => ({}))) as { path?: string }).path ?? path;
}
const RUNTIME: [string, string][] = [
  ['universal-motion.js',universalMotionSrc],
  ['universal-core.js',universalCoreSrc],
  ['track-space.js', trackSpaceSrc],
  ['motion-sequence.js', motionSequenceSrc],
  ['scene-geometry.js', sceneGeometrySrc],
  ['font-library.js',fontLibrarySrc],['font-runtime.js',fontRuntimeSrc],
  ['model-runtime.js',modelRuntimeSrc],['spatial-geometry.js',spatialGeometrySrc],['spatial-scene.js',spatialSceneSrc],['spatial-three.js',spatialThreeSrc],['spatial-occlusion.js',spatialOcclusionSrc],
  ['engine.js', engineSrc], ['runtime.js', runtimeSrc], ['chat-runtime.js', chatRuntime], ['chat.css', chatCss],
  ['reddit-runtime.js', redditRuntime], ['reddit.css', redditCss], ['subtitle-runtime.js', subtitleRuntime],
  ['subtitle-styles.js', subtitleStyles], ['wyr-runtime.js', wyrRuntime],
  ['transition-runtime.js', transitionRuntime], ['transition-gl.js', transitionGl], ['ripple-env.js', rippleEnvSrc], ['transitions-catalog.js', transitionCatalog],
  ['mg-runtime.js', mgRuntime], ['motion-graphics.js', mgLib], ['world.json', worldGeo],
  ['motion3d.js', motion3dSrc], ['scene3d-runtime.js', scene3dSrc], ['camera-runtime.js', cameraSrc], ['track-runtime.js', trackRuntimeSrc], ['track-core.js', trackCoreSrc], ['custom-runtime.js', customRuntimeSrc],
];
/* Three.js (MIT), for the 3D pages: served by the editor (public/assets/vendor/three) and copied next to them, its addons
   pointed at the copy (no import map needed). Fetched once per session, not bundled into the editor. */
const VENDOR: [string, string][] = [['three.module.min.js', '/assets/vendor/three/three.module.min.js'], ['three.core.min.js', '/assets/vendor/three/three.core.min.js'],
  ['three-rounded-box.js', '/assets/vendor/three/addons/RoundedBoxGeometry.js'], ['three-room-environment.js', '/assets/vendor/three/addons/RoomEnvironment.js'],
  ['three-gltf-loader.js', '/assets/vendor/three/addons/GLTFLoader.js'], ['three-buffer-utils.js', '/assets/vendor/three/addons/BufferGeometryUtils.js'], ['three-skeleton-utils.js', '/assets/vendor/three/addons/SkeletonUtils.js'],
  ['three-orbit-controls.js', '/assets/vendor/three/addons/OrbitControls.js'], ['three-transform-controls.js', '/assets/vendor/three/addons/TransformControls.js'],
  ['three-fbx-loader.js','/assets/vendor/three/addons/FBXLoader.js'],['three-fflate.js','/assets/vendor/three/addons/fflate.module.js'],['three-nurbs-curve.js','/assets/vendor/three/addons/NURBSCurve.js'],['three-nurbs-utils.js','/assets/vendor/three/addons/NURBSUtils.js']];
let vendorText: Promise<[string, string][]> | null = null;
const vendor = () => (vendorText ??= Promise.all(VENDOR.map(async ([name, url]) => {
  const text = await fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); });
  if (/^\s*<!doctype/i.test(text)) throw new Error(`${url}: the editor served a page, not the file (rebuild the editor)`);
  const local = name.startsWith('three-') ? text.replace(/from\s*['"]three['"]/g, "from './three.module.min.js'").replace(/from\s*['"]\.\.\/utils\/BufferGeometryUtils\.js['"]/g, "from './three-buffer-utils.js'").replace(/from\s*['"]\.\.\/utils\/SkeletonUtils\.js['"]/g, "from './three-skeleton-utils.js'") : text;
  return [name,local.replaceAll('../libs/fflate.module.js','./three-fflate.js').replaceAll('../curves/NURBSCurve.js','./three-nurbs-curve.js').replaceAll('../curves/NURBSUtils.js','./three-nurbs-utils.js')] as [string,string];
})));
/**
 * The layer runtime in the project's frame/ folder, as this editor has it. With `folder` (the project's own address)
 * a file is written only when it differs: rewriting an unchanged one makes the preview reload every page.
 */
export async function ensureRuntime(projectId: string, folder?: string) {
  if (runtimeReady.has(projectId)) return runtimeReady.get(projectId)!;
  const pending=(async()=>{
    await Promise.all([...RUNTIME, ...(await vendor())].map(async ([name, text]) => {
      if (folder) {
        const have = await fetch(`${folder}${FRAME_DIR}/${name}`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
        if (have === text) return;
      }
      await put(projectId, `${FRAME_DIR}/${name}`, text);
    }));
    await Promise.all(['Inter','Sora'].map(name=>ensureFontFile(projectId,name)));
  })().catch(e=>{runtimeReady.delete(projectId);throw e;});
  runtimeReady.set(projectId,pending);return pending;
}
/**
 * Shows a changed layer in the preview at once: the preview's pages are on the film's own origin, but a window may
 * still post to them (runtime.js picks up the message for its layer). The file is written separately, for good.
 */
export function livePreview(layer: FrameLayer) {
  window.dispatchEvent(new CustomEvent('frame-layer-live', { detail: layer }));
  const msg = { type: 'shorts-layer', layer };
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('[data-viewer-pane] iframe')) {
    const w = frame.contentWindow;
    if (!w) continue;
    try { for (let i = 0; i < w.length; i++) w[i].postMessage(msg, '*'); } catch { /* a frame gone mid-loop */ }
  }
}
/** `quiet`: the inspector's own writes, which it already shows (others tell it to read the layer again). */
export async function writeLayer(projectId: string, layer: FrameLayer, quiet = false) {
  await ensureRuntime(projectId);
  const names=new Set<string>(['Inter','Sora',layer.font,...(layer.items??[]).map((i:any)=>i.font??'Sora'),...(layer.layers??[]).map((i:any)=>i.font),...(layer.objects??[]).map((i:any)=>i.font),layer.style?.font].filter(Boolean));
  await Promise.all([...names].map(name=>ensureFontFile(projectId,name)));
  await put(projectId, framePath(layer.id), pageHtml(layer));
  if (!quiet) window.dispatchEvent(new CustomEvent('frame-layer', { detail: layer.id }));
}
/** The layer behind a clip: its page, read from the project's folder URL (`ProjectFilm.folder`). */
export async function readLayer(folder: string, id: string): Promise<FrameLayer | null> {
  const text = await fetch(`${folder}${framePath(id)}`, { cache: 'no-store' }).then((x) => (x.ok ? x.text() : '')).catch(() => '');
  const data = new DOMParser().parseFromString(text, 'text/html').querySelector('script#layer[type="application/json"]')?.textContent;
  if (!data) return null;
  try { return JSON.parse(data); } catch { return null; }
}

let counter = 0;
export const newLayerId = () => `layer-${Date.now().toString(36)}${(counter++).toString(36)}`;

export function makeLayer(kind: FrameLayer['kind'], over: Partial<FrameLayer> = {}): FrameLayer {
  const id = over.id ?? newLayerId();
  const base: FrameLayer = { id, kind, name: kind === 'text' ? 'Text' : kind === 'shape' ? 'Shape' : 'Image', duration: 4, keyframes: {}, x: 50, y: 50, scale: 100, rotation: 0, opacity: 100 };
  if (kind === 'shape') Object.assign(base, { shapeType: 'rect', color: '#4568ee', width: 40, height: 22, cornerRadius: 12 });
  if (kind === 'text') Object.assign(base, { text: 'Your text', fontSize: 90, color: '#ffffff', weight: 800, strokeColor: '#000000', strokeWidth: 0, width: 80, height: 20 });
  if (kind === 'image') Object.assign(base, { width: 50, height: 28, cornerRadius: 0 });
  return { ...base, ...over, id };
}

/** Where a new layer goes: a new track on top (the first track is the top of the stack), at the playhead. */
export function addLayerOps(_film: Film | null, layer: FrameLayer, at: number): Op[] {
  const clip: Partial<Clip> & { src: string } = { src: framePath(layer.id), id: layer.id, time: [0, round(layer.duration)] };
  return [{ op: 'insert', clip, at: round(at), newTrack: 0 } as Op];
}
export const round = (n: number) => Math.round(n * 1000) / 1000;

/* ---- keyframes on a layer (times relative to the layer, seconds) ---- */
export const valueNow = (layer: FrameLayer, key: string, t: number) => sampleProperty({ ...layer, start: 0 }, key, t, {}) ?? PROPERTY_DEFS[key]?.default;
export const isAnimated = (layer: FrameLayer, key: string) => (layer.keyframes?.[key]?.length ?? 0) > 0;
export const hasKeyAt = (layer: FrameLayer, key: string, t: number) => !!layer.keyframes?.[key]?.some((f) => Math.abs(f.time - t) < 0.5 / FPS);

/** Stopwatch: turn animation on (a key at t with the current value) or off (the value stays as it is at t). */
export function toggleStopwatch(layer: FrameLayer, key: string, t: number): FrameLayer {
  const next: FrameLayer = { ...layer, keyframes: { ...layer.keyframes } };
  if (isAnimated(layer, key)) { next[key] = valueNow(layer, key, t); delete next.keyframes[key]; return next; }
  next.keyframes[key] = upsertKeyframe([], { time: t, value: valueNow(layer, key, t) }, FPS);
  return next;
}
/** ◆: add or remove a key at t on one property. */
export function toggleKey(layer: FrameLayer, key: string, t: number): FrameLayer {
  const frames = layer.keyframes?.[key] ?? [];
  const hit = frames.find((f) => Math.abs(f.time - t) < 0.5 / FPS);
  const out = hit ? removeKeyframeById(frames, hit.id) : upsertKeyframe(frames, { time: t, value: valueNow(layer, key, t) }, FPS);
  const keyframes = { ...layer.keyframes };
  if (out.length) keyframes[key] = out; else delete keyframes[key];
  return { ...layer, keyframes };
}
/** "Keyframe all": a key at t on every property that is already animated. */
export function keyframeAll(layer: FrameLayer, t: number, keys?: string[]): FrameLayer {
  const keyframes = { ...layer.keyframes };
  for (const key of keys ?? Object.keys(layer.keyframes ?? {})) if (!hasKeyAt(layer, key, t)) keyframes[key] = upsertKeyframe(keyframes[key] ?? [], { time: t, value: valueNow(layer, key, t) }, FPS);
  return { ...layer, keyframes };
}
/** Edit a value: on an animated property it writes a key at t, otherwise it sets the layer's own value. */
export function setValue(layer: FrameLayer, key: string, value: number | string, t: number): FrameLayer {
  if (!isAnimated(layer, key)) return { ...layer, [key]: value };
  const keyframes = { ...layer.keyframes, [key]: upsertKeyframe(layer.keyframes[key], { time: t, value }, FPS) };
  return { ...layer, keyframes };
}
export const setEase = (layer: FrameLayer, key: string, id: string, ease: string): FrameLayer =>
  ({ ...layer, keyframes: { ...layer.keyframes, [key]: layer.keyframes[key].map((f) => (f.id === id ? { ...f, ease } : f)) } });

export function withPreset(layer: FrameLayer, presetId: string, opts: Record<string, unknown> = {}): FrameLayer {
  const p = presetById(presetId);
  /* a layer inside a story keeps its place; its keyframes are relative to its own start */
  return p ? ({ ...(applyPreset({ ...layer, start: 0 } as never, p, opts) as FrameLayer), start: layer.start }) : layer;
}
export { keyframeId };
