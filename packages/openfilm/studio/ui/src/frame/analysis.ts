/* Footage analysis for the 3D tools: tracking (how the scene moves) and subject masks (who or what is in front), as a
   job that runs while the person keeps editing, can be cancelled, and is cached: the same footage, range and settings
   are never analysed twice (results are files in the project: assets/track/<id>.json, assets/mattes/<id>/…).

   Frames: the video is stepped frame by frame by playing it and catching each frame as it is presented (no seeking,
   which is slow on long-GOP footage), at its own frame rate, so a shaking camera is followed on every frame.
   Tracking (track-core.js, in a worker) runs on a small proxy; masks are made at a larger size.

   Masks use Google MediaPipe (Apache-2.0, models Apache-2.0), loaded only when asked for:
   - a clicked subject: the interactive segmenter ("magic touch") at a point that follows the subject frame to frame,
     joined with DeepLab's person class near it, so arms and legs stay in;
   - everyone / an object class: DeepLab v3 (and the selfie segmenter near people) on crops around where subjects were
     the frame before, with a full search every few frames for new ones — each subject seen at high resolution;
   - close-ups: the multiclass selfie model (hair kept).
   Then every mask is cleaned the same way: small holes filled and cracks closed (no pieces missing inside a body),
   edges snapped to the picture (guided filter) and made crisp, and steadied over time only where nothing moved (no
   ghosting). Photos are analysed as one frame. */
import { putFile, round } from './layers';
import { proxySize, contentRect } from './track-space.js';
import { understandScene, type SceneUnderstanding,type ScenePlane } from './scene-understanding';
import { choosePlane } from './scene-geometry.js';
import { refineScenePlanes } from './scene-refinement.js';
import{planSpatialAnalysis,trackMotionExtent,trackTranslation}from'./analysis-plan.js';
import { reconstructSpatial } from './spatial-analysis';

export type Quality = 'fast' | 'balanced' | 'high';
export type TrackMode = 'auto' | 'planar' | 'camera' | 'motion' | 'point';
export type SegmentKind = 'auto' | 'person' | 'closeup' | 'object' | null;
export type AnalyseOpts = {
  projectId: string; folder: string; src: string; from: number; to: number;
  quality?: Quality; mode?: TrackMode; region?: [number, number, number, number] | null; point?: [number, number] | null;
  segment?: SegmentKind; pick?: { x: number; y: number } | null; /* 0…1 of the frame, at `from` */
  surface?:'auto'|'wall';engine?:'auto'|'surface'|'spatial'|'advanced';
  corrections?: { x: number; y: number; r: number; add: boolean; from: number; to: number }[];
  /** progress: share 0…1 (−1: a live update only), a message, and what the scan sees now (for the preview's animation) */
  onProgress?: (share: number, message: string, points?: number[][], seen?: Seen) => void; signal?: AbortSignal;
};
/** what the scan sees on the current frame, in 0…1 of the frame: tracked points, subject boxes, the frame's time */
export type Seen = { t: number; points: [number, number][]; boxes: [number, number, number, number][]; frame: number; of: number };
export type FrameInfo = { box: [number, number, number, number]; foot: number; area: number } | null;
export type AnalysisResult = {
  id: string; w: number; h: number; fps: number; from: number; to: number;
  track: string | null; matte: string | null; quality: string; medianError: number | null; inlierShare: number | null; cuts: number[];
  maskConfidence: number | null; mode: TrackMode; segment: SegmentKind; notes: string[]; image?: boolean;
  content?: { x: number; y: number; w: number; h: number }; elapsedMs?: number; frames?: number;
  scene?:SceneUnderstanding|null;surface?:'auto'|'wall';
  spatial?:string|null;occlusion?:string|null;strategy?:any;
  planes?:{name:string;track:string;quality:string;lostShare:number}[];
  /** the camera travels (walking footage) / people or objects were seen: where the slower native path helps */
  walking?:boolean;subjectsSeen?:boolean;
};

/* quality: tracking proxy width, mask width, and the most frames a second analysed (the footage's own rate when lower) */
const PRESET: Record<Quality, { track: number; mask: number; fps: number; rescan: number }> = {
  fast: { track: 256, mask: 320, fps: 12, rescan: 12 }, balanced: { track: 320, mask: 512, fps: 18, rescan: 8 }, high: { track: 512, mask: 768, fps: 30, rescan: 4 },
};
const DEEPLAB = ['background', 'aeroplane', 'bicycle', 'bird', 'boat', 'bottle', 'bus', 'car', 'cat', 'chair', 'cow', 'table', 'dog', 'horse', 'motorbike', 'person', 'plant', 'sheep', 'sofa', 'train', 'tv'];
export const OBJECT_CLASSES = DEEPLAB.slice(1);
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

async function hash(s: string) { const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)); return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(''); }
const abortable = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Analysis cancelled', 'AbortError'); };

/* ---- MediaPipe, loaded once and only when needed ---- */
type Mask = { getAsFloat32Array: () => Float32Array; getAsUint8Array: () => Uint8Array; width: number; height: number };
type SegResult = { confidenceMasks?: Mask[]; categoryMask?: Mask; close: () => void };
type Seg = { segment: (img: HTMLCanvasElement, opts?: unknown) => SegResult };
const VENDOR = '/assets/vendor';
let mpPromise: Promise<{ files: unknown; mp: Record<string, { createFromOptions: (f: unknown, o: unknown) => Promise<Seg> }> }> | null = null;
const mediapipe = () => (mpPromise ??= (async () => {
  const url = `${VENDOR}/mediapipe/vision_bundle.mjs`;
  const mp = await import(/* @vite-ignore */ url) as Record<string, any>;
  const files = await mp.FilesetResolver.forVisionTasks(`${VENDOR}/mediapipe/wasm`);
  return { files, mp };
})());
const models = new Map<string, Promise<Seg>>();
function model(name: 'deeplab' | 'selfie' | 'selfieMC' | 'magic'): Promise<Seg> {
  if (!models.has(name)) models.set(name, (async () => {
    const { files, mp } = await mediapipe();
    const path = { deeplab: 'deeplab_v3.tflite', selfie: 'selfie_segmenter_landscape.tflite', selfieMC: 'selfie_multiclass_256x256.tflite', magic: 'magic_touch.tflite' }[name];
    const cls = name === 'magic' ? mp.InteractiveSegmenter : mp.ImageSegmenter;
    const make = (delegate: 'GPU' | 'CPU') => cls.createFromOptions(files, { baseOptions: { modelAssetPath: `${VENDOR}/models/${path}`, delegate }, runningMode: 'IMAGE', outputCategoryMask: name === 'deeplab', outputConfidenceMasks: true });
    try { return await make('GPU'); } catch { return make('CPU'); }
  })().catch((e) => { models.delete(name); throw e; }));
  return models.get(name)!;
}

import { resample, type CleanIn, type CleanOut } from './mask-clean';

/** square crops [x, y, size] that overlap (or nearly) become one covering both, so a crowd costs a few model runs, not one
    per person; at most 6 remain (the closest pair is merged until then) and none is bigger than the frame's long side */
function mergeCrops(crops: [number, number, number][], max: number) {
  const box = (c: [number, number, number]) => [c[0], c[1], c[0] + c[2], c[1] + c[2]];
  const join = (a: [number, number, number], b: [number, number, number]): [number, number, number] => { const A = box(a), B = box(b); const x0 = Math.min(A[0], B[0]), y0 = Math.min(A[1], B[1]), x1 = Math.max(A[2], B[2]), y1 = Math.max(A[3], B[3]); const s = Math.min(max, Math.max(x1 - x0, y1 - y0)); return [(x0 + x1) / 2 - s / 2, (y0 + y1) / 2 - s / 2, s]; };
  const cost = (a: [number, number, number], b: [number, number, number]) => { const j = join(a, b); return j[2] * j[2] - a[2] * a[2] - b[2] * b[2]; };
  const out = crops.slice();
  for (;;) {
    let bi = -1, bj = -1, best = Infinity;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) { const c = cost(out[i], out[j]); if (c < best) { best = c; bi = i; bj = j; } }
    if (bi < 0) break;
    /* two crops become one only when that costs little detail (neighbours, overlaps), or when there are too many */
    const j2 = join(out[bi], out[bj]); if (out.length <= 6 && j2[2] > 1.3 * Math.max(out[bi][2], out[bj][2])) break;
    out[bi] = join(out[bi], out[bj]); out.splice(bj, 1);
  }
  return out;
}

/* ---- frames: played and caught as presented (no seeking), or one photo ---- */
type FrameSource = { w: number; h: number; duration: number; image: boolean; next: () => Promise<{ t: number; el: CanvasImageSource } | null>; close: () => void };
async function openSource(url: string, from: number, to: number, step: number, signal?: AbortSignal): Promise<FrameSource> {
  abortable(signal);
  if (IMAGE.test(url)) {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url; await img.decode(); abortable(signal);
    let done = false;
    return { w: img.naturalWidth, h: img.naturalHeight, duration: 0, image: true, next: async () => (done ? null : ((done = true), { t: 0, el: img })), close: () => {} };
  }
  // Decode forwards once and retain actual presentation times. Repeated long-GOP seeks were the dominant cost
  // on phone footage. The shared precision decoder is loaded only when a scan starts.
  try{
    const {openTrackingSource}=await import('./universal-analysis');
    const source=await openTrackingSource(url,signal),iterator=source.sink.samples(from,Math.min(to,source.duration))[Symbol.asyncIterator]();
    const canvas=document.createElement('canvas'),dims=proxySize(source.w,source.h,960);canvas.width=dims.w;canvas.height=dims.h;
    const ctx=canvas.getContext('2d')!;let nextTime=from,closed=false;
    return {w:source.w,h:source.h,duration:source.duration,image:false,next:async()=>{
      while(!closed){abortable(signal);const entry=await iterator.next();if(entry.done)return null;const sample=entry.value;try{if(sample.timestamp+.000001<nextTime)continue;sample.draw(ctx,0,0,canvas.width,canvas.height);nextTime+=step;return {t:sample.timestamp,el:canvas};}finally{sample.close();}}return null;
    },close:()=>{closed=true;void iterator.return?.();source.dispose();}};
  }catch(error){abortable(signal);/* Native media remains the fallback for codecs WebCodecs cannot decode. */}
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
  const close = () => { v.pause(); v.removeAttribute('src'); v.load(); };
  const wait = (event: string, action?: () => void) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); v.removeEventListener(event, ok); v.removeEventListener('error', fail); signal?.removeEventListener('abort', cancel); };
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('The footage could not be decoded. Try a browser-compatible MP4.')); };
    const cancel = () => { cleanup(); reject(new DOMException('Analysis cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('The video decoder took too long. Try a smaller proxy.')); }, 15000);
    v.addEventListener(event, ok, { once: true }); v.addEventListener('error', fail, { once: true }); signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel(); else action?.();
  });
  try {
    await wait('loadeddata', () => { v.src = url; });
    if (!(from >= 0 && from < v.duration && to > from)) throw new Error('The scan range is outside this video.');
    const end = Math.min(to, v.duration - .02);
    const seek = async (t: number) => { abortable(signal); if (Math.abs(v.currentTime - t) > .0005 || v.readyState < 2) await wait('seeked', () => { v.currentTime = t; }); return v.currentTime; };
    const { w: cw, h: ch } = proxySize(v.videoWidth, v.videoHeight, 960);
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch; const copy = canvas.getContext('2d', { willReadFrequently: true })!;
    let i = 0, pending: Promise<number> | null = null;
    return { w: v.videoWidth, h: v.videoHeight, duration: v.duration, image: false,
      next: async () => {
        const want = from + i * step; if (want > end + .001) return null;
        const t = await (pending ?? seek(Math.min(end, want + .001))); i++; pending = null;
        copy.drawImage(v, 0, 0, cw, ch);
        const after = from + i * step;
        if (after <= end + .001) { pending = seek(Math.min(end, after + .001)); void pending.catch(() => {}); }
        return { t, el: canvas };
      }, close };
  } catch (e) { close(); throw e; }
}

async function analysisId(o: AnalyseOpts, sourceHash: string | number) {
  const q = PRESET[o.quality ?? 'balanced'];
  return hash(JSON.stringify(['v25-spatial-v3',sourceHash, o.src, round(o.from), round(o.to), q, o.mode ?? 'auto', o.region ?? null, o.point ?? null, o.segment ?? 'auto', o.pick ?? null, o.corrections ?? [],o.surface??'auto',o.engine??'auto']));
}
async function sourceIdentity(o: AnalyseOpts) {
  const identity=await fetch(`/api/projects/${o.projectId}/spatial/source?src=${encodeURIComponent(o.src.split('#')[0])}`,{signal:o.signal}).then(r=>r.ok?r.json():null).catch(()=>null);abortable(o.signal);return identity;
}
async function cachedAnalysis(o: AnalyseOpts, id: string) {
  return await fetch(`${o.folder}assets/track/${id}.result.json`, { cache: 'no-store', signal: o.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as AnalysisResult | null;
}
/** Check the persistent cache without starting analysis. A missing fingerprint must never reuse a stale scan. */
export async function findCachedAnalysis(o: AnalyseOpts): Promise<AnalysisResult | null> {
  const identity=await sourceIdentity(o);if(!identity?.hash)return null;
  const id=await analysisId(o,identity.hash),result=await cachedAnalysis(o,id);abortable(o.signal);
  if(!result||result.id!==id)return null;
  const required=result.spatial??result.track;
  if(required){const exists=await fetch(`${o.folder}${required}`,{method:'HEAD',cache:'no-store',signal:o.signal}).then(r=>r.ok).catch(()=>false);abortable(o.signal);if(!exists)return null;}
  return result;
}

/** Analyse a stretch of footage (or a photo). Returns where the results were written; cached by footage, range, settings. */
/* ---- the scan's frames, kept for surface finding at a click (small grayscale proxies: ~6 MB for a 6 s shot) ---- */
export type ScanFrames = { w: number; h: number; times: number[]; grays: Uint8Array[] };
const scanFrames = new Map<string, ScanFrames>();
export function rememberScan(id: string, frames: ScanFrames) { scanFrames.delete(id); scanFrames.set(id, frames); while (scanFrames.size > 3) scanFrames.delete(scanFrames.keys().next().value!); }
/** The frames of a finished scan: from memory, or read again from the footage in the scan's own size and order. */
export async function readScanFrames(o: { folder: string; src: string; result: AnalysisResult; signal?: AbortSignal; onProgress?: (share: number) => void }): Promise<ScanFrames> {
  const kept = scanFrames.get(o.result.id); if (kept) return kept;
  const { result } = o, src = await openSource(`${o.folder}${o.src.split('#')[0]}`, result.from, result.to, 1 / result.fps, o.signal);
  try {
    const { w: fw, h: fh } = proxySize(src.w, src.h, 960), fcv = document.createElement('canvas'); fcv.width = fw; fcv.height = fh; const fgx = fcv.getContext('2d', { willReadFrequently: true })!;
    const tcv = document.createElement('canvas'); tcv.width = result.w; tcv.height = result.h; const tgx = tcv.getContext('2d', { willReadFrequently: true })!;
    const span = src.image ? 0 : Math.min(result.to, src.duration) - result.from, count = src.image ? 1 : Math.max(1, Math.round(span * Math.min(result.fps, 60)) + 1);
    const grays: Uint8Array[] = [], times: number[] = [];
    for (let i = 0; i < count; i++) {
      abortable(o.signal); const fr = await src.next(); if (!fr) break;
      fgx.drawImage(fr.el, 0, 0, fw, fh); tgx.drawImage(fcv, 0, 0, result.w, result.h);
      const px = tgx.getImageData(0, 0, result.w, result.h).data, gray = new Uint8Array(result.w * result.h);
      for (let j = 0; j < gray.length; j++) gray[j] = 0.299 * px[j * 4] + 0.587 * px[j * 4 + 1] + 0.114 * px[j * 4 + 2];
      grays.push(gray); times.push(round(src.image ? 0 : fr.t)); o.onProgress?.((i + 1) / count);
    }
    const frames = { w: result.w, h: result.h, times, grays }; rememberScan(result.id, frames); return frames;
  } finally { src.close(); }
}

export async function analyseFootage(o: AnalyseOpts): Promise<AnalysisResult> {
  abortable(o.signal);
  const started = performance.now();
  const q = PRESET[o.quality ?? 'balanced'];
  const identity=await sourceIdentity(o),id=await analysisId(o,identity?.hash??Date.now());
  const trackPath = `assets/track/${id}.json`, mattePath = `assets/mattes/${id}/matte.json`, resultPath = `assets/track/${id}.result.json`;
  const cached = await cachedAnalysis(o,id);abortable(o.signal);
  if (cached) { o.onProgress?.(1, 'Using the earlier analysis of this footage'); return cached; }
  const notes: string[] = [];
  let scene:SceneUnderstanding|null=null;
  if(!IMAGE.test(o.src)){
    o.onProgress?.(0,'Reading scene geometry with DeepSeek vision');
    try{scene=await understandScene(o.projectId,o.folder,o.src.split('#')[0],o.from,o.to,o.signal??new AbortController().signal);}
    catch(e){abortable(o.signal);notes.push(`Scene vision unavailable: ${e instanceof Error?e.message:String(e)}. Placement needs a manual check.`);}
  }
  const plane:ScenePlane|null=o.surface==='wall'?choosePlane(scene,true)??null:null;
  const region=o.region??(plane?[Math.min(...plane.quad.map(p=>p[0])),Math.min(...plane.quad.map(p=>p[1])),Math.max(...plane.quad.map(p=>p[0])),Math.max(...plane.quad.map(p=>p[1]))] as [number,number,number,number]:null);
  o.onProgress?.(0, 'Opening the footage');
  const src = await openSource(`${o.folder}${o.src.split('#')[0]}`, o.from, o.to, 1 / q.fps, o.signal);
  const { w: tw, h: th } = proxySize(src.w, src.h, scene?.planes.length?Math.max(512,q.track):q.track);
  const { w: mw, h: mh } = proxySize(src.w, src.h, q.mask);
  const tcv = document.createElement('canvas'); tcv.width = tw; tcv.height = th; const tgx = tcv.getContext('2d', { willReadFrequently: true })!;
  const mcv = document.createElement('canvas'); mcv.width = mw; mcv.height = mh; const mgx = mcv.getContext('2d', { willReadFrequently: true })!;
  const crop = document.createElement('canvas'); crop.width = crop.height = 512; const cg = crop.getContext('2d', { willReadFrequently: true })!;
  /* the frame, copied out of the video once per frame (each draw of a video is a copy from the GPU); everything else is drawn from it */
  const { w: fw, h: fh } = proxySize(src.w, src.h, 960);
  const fcv = document.createElement('canvas'); fcv.width = fw; fcv.height = fh; const fgx = fcv.getContext('2d', { willReadFrequently: true })!;
  const keptGrays: Uint8Array[] = [];
  const span = src.image ? 0 : Math.min(o.to, src.duration) - o.from; const count = src.image ? 1 : Math.max(1, Math.round(span * Math.min(q.fps, 60)) + 1);
  const segKind = o.segment === undefined ? 'auto' : o.segment;
  let detector: Worker | null = null;
  let detect: ((bitmap: ImageBitmap) => Promise<{w:number;h:number;mask:Float32Array}>) | null = null;
  if(segKind==='auto'&&typeof OffscreenCanvas!=='undefined'){
    detector=new Worker(new URL('./scene-worker.ts',import.meta.url));
    const request=(msg:unknown,transfer:Transferable[]=[])=>new Promise<any>((ok,fail)=>{
      const cancel=()=>finish(new DOMException('Analysis cancelled','AbortError'));
      const timer=setTimeout(()=>finish(new Error('Scene detection timed out.')),30000);
      const finish=(error?:Error,data?:unknown)=>{clearTimeout(timer);o.signal?.removeEventListener('abort',cancel);error?fail(error):ok(data);};
      detector!.onmessage=e=>e.data.type==='error'?finish(new Error(e.data.message)):finish(undefined,e.data);
      detector!.onerror=e=>finish(new Error(e.message));o.signal?.addEventListener('abort',cancel,{once:true});
      if(o.signal?.aborted)cancel();else detector!.postMessage(msg,transfer);
    });
    try{await request({type:'init'});detect=bitmap=>request({type:'frame',bitmap},[bitmap]);}
    catch(e){detector.terminate();detector=null;if(o.signal?.aborted){src.close();throw e;}notes.push(`Background detector unavailable: ${e instanceof Error?e.message:String(e)}. Using the compatibility detector.`);}
  }
  o.onProgress?.(0.01, 'Loading scene detection');
  const [deeplab, selfie, magic, selfieMC] = await Promise.all([
    (segKind === 'auto' && !detect) || segKind === 'person' || segKind === 'object' ? model('deeplab') : null,
    segKind === 'person' ? model('selfie').catch(() => null) : null,
    segKind && segKind !== 'closeup' && o.pick ? model('magic').catch(() => null) : null,
    segKind === 'closeup' ? model('selfieMC') : null,
  ].map((p) => (p ? (p as Promise<Seg>).catch((e) => { notes.push(`A mask model could not load: ${e?.message ?? e}`); return null; }) : Promise.resolve(null))));
  const segmenting = !!(detect || deeplab || magic || selfieMC);
  let objectClass = 15;
  /* atlas of mask frames, as many per image as fit 4096 px */
  const cols = Math.max(1, Math.floor(2048 / mw)), rows = Math.max(1, Math.floor(2048 / mh)), per = cols * rows; const atlases: HTMLCanvasElement[] = []; const frames: FrameInfo[] = []; const times: number[] = []; const names: string[] = [];
  const saveAtlas = async (i: number) => { const a = atlases[i]; const blob = await new Promise<Blob>((ok, fail) => a.toBlob(b => b ? ok(b) : fail(new Error('Could not save the subject mask.')), 'image/png')); abortable(o.signal); names[i] = await putFile(o.projectId, `assets/mattes/${id}/atlas-${i}.png`, blob); a.width = a.height = 1; };
  const mode: TrackMode = plane?'planar':o.mode === 'auto' || !o.mode ? (region ? 'planar' : o.point ? 'point' : 'camera') : o.mode;
  const worker = new Worker(new URL('./track-worker.js', import.meta.url), { type: 'module' });
  let livePoints: number[][] = [];
  let ack: (() => void) | null = null, ackFail: ((e: Error) => void) | null = null;
  let planeResults:{name:string;result:any}[]=[];
  const done = new Promise<Record<string, unknown>>((resolve, reject) => { worker.onmessage = (e) => { if (e.data.type === 'points') livePoints = e.data.points; if (e.data.type === 'progress') ack?.(); if (e.data.type === 'done'){planeResults=e.data.planes??[];resolve(e.data.result);} }; worker.onerror = e => { const err = new Error(e.message || 'Tracking stopped.'); ackFail?.(err); reject(err); }; });
  void done.catch(() => {});
  const regionPx = region ? region.map((v2, i) => v2 * (i % 2 ? th : tw)) : null;
  worker.postMessage({ type: 'start', opts: { w: tw, h: th, mode, region: regionPx,plane:plane?.quad.map(p=>[p[0]*tw,p[1]*th]),planes:scene?.planes.slice(0,6).map(p=>({name:p.name,quad:p.quad.map(q=>[q[0]*tw,q[1]*th])})), point: o.point ? [o.point[0] * tw, o.point[1] * th] : null, smooth: 0, maxPoints:o.quality==='high'?180:64, lkWindow:o.quality==='high'?6:3, lkIters:o.quality==='high'?10:6 } });
  let conf = 0, confN = 0;
  /* the cleanup runs in its own worker, one frame at a time */
  const cleaner = new Worker(new URL('./mask-worker.ts', import.meta.url), { type: 'module' });
  const clean = (input: CleanIn) => new Promise<CleanOut>((ok, fail) => { cleaner.onmessage = (e) => ok(e.data); cleaner.onerror = (e) => fail(new Error(e.message || 'The mask cleanup stopped.')); cleaner.postMessage(input, [input.m.buffer, input.lum.buffer]); });
  /* the followed subject (a click): its point and box in mask px */
  let follow: { x: number; y: number; box: [number, number, number, number] } | null = o.pick ? { x: o.pick.x * mw, y: o.pick.y * mh, box: [o.pick.x * mw - mw * 0.15, o.pick.y * mh - mh * 0.3, o.pick.x * mw + mw * 0.15, o.pick.y * mh + mh * 0.3] } : null;
  let lastBoxes: [number, number, number, number][] = [];
  let content = { x: 0, y: 0, w: 1, h: 1 }; let closeModel: Seg | null = null;
  let rawMask:Float32Array|null=null, previousGray:Uint8Array|null=null,emptyPasses=0,lastDetection=-100,detectionCount=0;
  const maskStride=o.quality==='high'?2:3;
  /** run models on one square crop of the frame (mask px, drawn once) and merge each mask (its channel, times k) into m */
  type Run = { s: Seg; take: (r: SegResult) => Mask | undefined; k?: number; opts?: (x0: number, y0: number, size: number) => unknown };
  const runCrop = (x0: number, y0: number, size: number, runs: Run[], into: Float32Array) => {
    const sx = (x0 / mw) * fw, sy = (y0 / mh) * fh, ss = (size / mw) * fw;
    cg.clearRect(0, 0, 512, 512); cg.drawImage(fcv, sx, sy, ss, ss, 0, 0, 512, 512);
    const S = Math.round(size);
    for (const run of runs) {
      const o2 = run.opts?.(x0, y0, size); if (run.opts && !o2) continue;
      const r = run.s.segment(crop, o2); const mk = run.take(r); const k = run.k ?? 1;
      if (mk) { const part = resample(mk.getAsFloat32Array(), mk.width, mk.height, S, S);
        for (let y = 0; y < S; y++) { const Y = Math.round(y0) + y; if (Y < 0 || Y >= mh) continue; for (let x = 0; x < S; x++) { const X = Math.round(x0) + x; if (X < 0 || X >= mw) continue; const v = part[y * S + x] * k; const j = Y * mw + X; if (v > into[j]) into[j] = v; } } }
      r.close();
    }
  };
  try {
    for (let i = 0; i < count; i++) {
      abortable(o.signal);
      const fr = await src.next(); if (!fr) break; const t = src.image ? 0 : fr.t; times.push(round(t));
      fgx.drawImage(fr.el, 0, 0, fw, fh);
      tgx.drawImage(fcv, 0, 0, tw, th);
      const tp = tgx.getImageData(0, 0, tw, th).data; const gray = new Uint8Array(tw * th);
      for (let j = 0; j < tw * th; j++) gray[j] = 0.299 * tp[j * 4] + 0.587 * tp[j * 4 + 1] + 0.114 * tp[j * 4 + 2];
      if(i===0&&scene){const refined=refineScenePlanes(scene,gray,tw,th);if(refined!==scene){scene=refined;worker.postMessage({type:'start',opts:{w:tw,h:th,mode,region:regionPx,plane:plane?.quad.map(p=>[p[0]*tw,p[1]*th]),planes:refined.planes.map((p:ScenePlane)=>({name:p.name,quad:p.quad.map(q=>[q[0]*tw,q[1]*th])})),point:o.point?[o.point[0]*tw,o.point[1]*th]:null,smooth:0,maxPoints:o.quality==='high'?180:64,lkWindow:o.quality==='high'?6:3,lkIters:o.quality==='high'?10:6}});}}
      let change=0;if(previousGray)for(let j=0;j<gray.length;j+=31)change+=Math.abs(gray[j]-previousGray[j]);change/=Math.max(1,Math.ceil(gray.length/31));previousGray=gray.slice();keptGrays.push(previousGray);
      if (i === 0) content = contentRect(gray, tw, th);
      let subjectSmall: Uint8Array | null = null;
      if (segmenting) {
        mgx.drawImage(fcv, 0, 0, mw, mh);
        const mp = mgx.getImageData(0, 0, mw, mh).data; const lum = new Float32Array(mw * mh); for (let j = 0; j < mw * mh; j++) lum[j] = (0.299 * mp[j * 4] + 0.587 * mp[j * 4 + 1] + 0.114 * mp[j * 4 + 2]) / 255;
        let m: Float32Array = new Float32Array(mw * mh);
        const side = Math.min(mw, mh);
        if (detect) {
          const stride=emptyPasses>=2?maskStride*2:maskStride;
          if(!rawMask||i-lastDetection>=stride||change>12){const detected=await detect(await createImageBitmap(mcv));rawMask=resample(detected.mask,detected.w,detected.h,mw,mh);lastDetection=i;detectionCount++;let foreground=0;for(let p=0;p<rawMask.length;p+=4)if(rawMask[p]>.55)foreground++;emptyPasses=foreground/(rawMask.length/4)<.001?emptyPasses+1:0;}
          m=rawMask.slice();
          for(let y=0;y<mh;y++)for(let x=0;x<mw;x++)if(x<content.x*mw||x>(content.x+content.w)*mw||y<content.y*mh||y>(content.y+content.h)*mh)m[y*mw+x]=0;
        } else if (segKind === 'auto' && deeplab) {
          // One semantic pass finds people AND recognised objects. No choice of subject type, no tile cascade.
          const r = deeplab.segment(mcv); const masks = r.confidenceMasks;
          if (masks?.length) {
            const size = masks[0].width * masks[0].height, union = new Float32Array(size);
            for (let c = 1; c < masks.length; c++) { const values = masks[c].getAsFloat32Array(); for (let j = 0; j < size; j++) union[j] = Math.max(union[j], values[j]); }
            m = resample(union, masks[0].width, masks[0].height, mw, mh);
            const person = masks[15];
            if (person && i % q.rescan === 0) {
              const p = person.getAsFloat32Array(); let area = 0; for (const v of p) if (v > .6) area++;
              // Refine hair/close-ups only when a person really fills the picture; load this model lazily.
              if (area / p.length > .24 && !closeModel) closeModel = await model('selfieMC').catch(() => null);
            }
          }
          r.close();
          if (closeModel && lastBoxes.some(b => b[3] - b[1] > mh * .72)) {
            const near = closeModel.segment(mcv), bg = near.confidenceMasks?.[0];
            if (bg) { const p = resample(bg.getAsFloat32Array(), bg.width, bg.height, mw, mh); for (let j = 0; j < m.length; j++) m[j] = Math.max(m[j], 1 - p[j]); } near.close();
          }
          for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) if (x < content.x * mw || x > (content.x + content.w) * mw || y < content.y * mh || y > (content.y + content.h) * mh) m[y * mw + x] = 0;
        } else if (selfieMC) {
          const r = selfieMC.segment(mcv); const bg = r.confidenceMasks?.[0]; if (bg) { const b = resample(bg.getAsFloat32Array(), bg.width, bg.height, mw, mh); for (let j = 0; j < mw * mh; j++) m[j] = 1 - b[j]; } r.close();
        } else {
          if (i === 0 && segKind === 'object' && o.pick && deeplab) { const r = deeplab.segment(mcv); const cm = r.categoryMask; if (cm) { const cat = resample(cm.getAsUint8Array(), cm.width, cm.height, mw, mh, true); const c = cat[Math.round(o.pick.y * (mh - 1)) * mw + Math.round(o.pick.x * (mw - 1))]; if (c) objectClass = c; else notes.push('The object model did not recognise what was clicked; the click alone picks it.'); } r.close(); }
          const cls = segKind === 'person' ? 15 : objectClass;
          /* where to look: around the followed subject, around last frame's subjects, or (every few frames) everywhere */
          /* where to look: wide tiles (every few frames, to find who is there) and a close crop round each subject found
             last frame (or the clicked one). A close crop sees a person at several times the tiles' detail, so inside it
             its answer is the one kept; the tiles only fill in where no close crop looked. */
          const tiles: [number, number, number][] = [], close: [number, number, number][] = [];
          const sq = (b: [number, number, number, number], pad: number) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; const s = Math.min(Math.max(mw, mh), Math.max(b[2] - b[0], b[3] - b[1]) * (1 + pad) + side * 0.08); return [cx - s / 2, cy - s / 2, s] as [number, number, number]; };
          if (follow) close.push(sq(follow.box, 0.5));
          else {
            if (i % q.rescan === 0 || !lastBoxes.length) { const n = Math.max(1, Math.ceil((Math.max(mw, mh) / side) * 1.5)); for (let k = 0; k < n; k++) { const off = n === 1 ? 0 : (k / (n - 1)) * (Math.max(mw, mh) - side); tiles.push(mw >= mh ? [off, 0, side] : [0, off, side]); } }
            for (const b of lastBoxes) close.push(sq(b, 0.6));
          }
          const deep: Run | null = deeplab ? { s: deeplab, take: (r) => r.confidenceMasks?.[cls] } : null;
          /* the selfie model is made for one person near the camera: on a crowd or a far person it makes one blob that
             swallows the street, so it only helps a subject that fills most of the frame's height (a close-up) */
          const self: Run | null = selfie && segKind === 'person' ? { s: selfie, take: (r) => r.confidenceMasks?.[0], k: 0.92 } : null;
          const touch: Run | null = magic && follow ? (() => { const f = follow; return { s: magic, take: (r: SegResult) => r.confidenceMasks?.[r.confidenceMasks.length - 1], opts: (x0: number, y0: number, size: number) => { const kx = (f.x - x0) / size, ky = (f.y - y0) / size; return kx > 0 && ky > 0 && kx < 1 && ky < 1 ? { keypoint: { x: kx, y: ky } } : null; } }; })() : null;
          /* the page gets a turn between model runs too */
          const turn = () => new Promise((r) => setTimeout(r, 0));
          for (const [x0, y0, s] of tiles) { runCrop(x0, y0, s, [deep].filter(Boolean) as Run[], m); await turn(); }
          if (close.length) {
            const fine = new Float32Array(mw * mh), cov = new Uint8Array(mw * mh);
            for (const [x0, y0, s] of mergeCrops(close, Math.max(mw, mh))) {
              runCrop(x0, y0, s, [deep, s > side * 0.9 ? self : null, touch].filter(Boolean) as Run[], fine); await turn();
              /* the crop's inner part counts as looked at (its rim is where a cut-off person gets unsure) */
              const e = s * 0.06; for (let y = Math.max(0, Math.round(y0 + e)); y < Math.min(mh, Math.round(y0 + s - e)); y++) for (let x = Math.max(0, Math.round(x0 + e)); x < Math.min(mw, Math.round(x0 + s - e)); x++) cov[y * mw + x] = 1;
            }
            for (let j = 0; j < mw * mh; j++) if (cov[j]) m[j] = fine[j]; else if (fine[j] > m[j]) m[j] = fine[j];
          }
          /* a model's soft "probably" becomes solid round its even-odds line; well below it, nothing */
          for (let j = 0; j < mw * mh; j++) m[j] = Math.min(1, Math.max(0, (m[j] - 0.3) / 0.4));
        }
        const cleaned = await clean({ m, lum, mw, mh, tw, th, t, corrections: o.corrections ?? [], follow });
        follow = cleaned.follow; lastBoxes = cleaned.boxes; conf += cleaned.conf; confN++; frames.push(cleaned.frame);
        const ai = Math.floor(i / per), k = i % per;
        if (!atlases[ai]) { const a = document.createElement('canvas'); a.width = mw * cols; a.height = mh * rows; atlases[ai] = a; }
        atlases[ai].getContext('2d')!.putImageData(new ImageData(cleaned.tile as Uint8ClampedArray<ArrayBuffer>, mw, mh), (k % cols) * mw, Math.floor(k / cols) * mh);
        if (k === per - 1) await saveAtlas(ai);
        /* the tracker leaves subjects out of the scene's motion */
        subjectSmall = cleaned.small;
      }
      await new Promise<void>((ok, fail) => { ack = ok; ackFail = fail; worker.postMessage({ type: 'frame', gray, t, mask: subjectSmall }, subjectSmall ? [gray.buffer, subjectSmall.buffer] : [gray.buffer]); });
      const seen: Seen = { t, frame: i, of: count, points: livePoints.map((p) => [p[0] / tw, p[1] / th] as [number, number]), boxes: lastBoxes.map((b) => [b[0] / mw, b[1] / mh, b[2] / mw, b[3] / mh] as [number, number, number, number]) };
      o.onProgress?.(((i + 1) / count) * 0.92, segmenting ? `Scanning frame ${i + 1} of ${count}` : `Tracking frame ${i + 1} of ${count}`, livePoints, seen);
      /* the page gets a turn after every frame (and the close crops), so editing goes on smoothly while it scans */
      await new Promise((r) => setTimeout(r, 0));
    }
    worker.postMessage({ type: 'end' });
    const track = await done as { quality: string; medianError: number; inlierShare: number; cuts: number[]; frames: { t: number }[] };
    if (src.image) { track.quality = 'Good'; notes.push('A photo: one frame, nothing moves; objects stay where you put them.'); }
    o.onProgress?.(0.94, 'Saving the analysis');
    const trackAt = await putFile(o.projectId, trackPath, JSON.stringify(track));
    const planes=await Promise.all(planeResults.map(async(p,i)=>({name:p.name,track:await putFile(o.projectId,`assets/track/${id}-plane-${i}.json`,JSON.stringify(p.result)),quality:p.result.quality,lostShare:p.result.lostShare})));
    let matte: string | null = null;
    if (segmenting && atlases.length) {
      for (let i = 0; i < atlases.length; i++) if (!names[i]) await saveAtlas(i);
      matte = await putFile(o.projectId, mattePath, JSON.stringify({ w: mw, h: mh, trackW: tw, trackH: th, fps: q.fps, start: round(o.from), times, count: frames.length, cols, rows, atlases: names, frames, segment: segKind, objectClass: DEEPLAB[objectClass] }));
    }
    if (track.quality === 'Poor') notes.push('Tracking is weak here (little texture, heavy blur or few still surfaces): check it before relying on it.');
    if (track.cuts?.length) notes.push(`Cut${track.cuts.length > 1 ? 's' : ''} found at ${track.cuts.map((c) => `${round(c)}s`).join(', ')}: each stretch is tracked on its own.`);
    if (mode === 'camera' && !src.image) notes.push('Planar solve: objects stay on the dominant surface (every frame, shake included). Near and far things moving differently are not rebuilt in 3D.');
    if (segKind === 'auto') notes.push('Automatic semantic foreground: recognised people and objects; relative depth is estimated from their ground contact, not measured 3D geometry.');
    if(detect)notes.push(`${detectionCount} semantic passes for ${times.length} frames; empty scenes use a lower inference cadence, with immediate refresh on image changes.`);
    const result: AnalysisResult = { id, w: tw, h: th, fps: q.fps, from: round(o.from), to: round(src.image ? o.from : Math.min(o.to, src.duration)), track: trackAt, matte, quality: track.quality, medianError: round(track.medianError), inlierShare: round(track.inlierShare), cuts: track.cuts ?? [], maskConfidence: confN ? round(conf / confN) : null, mode, segment: segKind ?? null, notes, image: src.image, content, scene,surface:o.surface??'auto',elapsedMs: Math.round(performance.now() - started), frames: times.length };
    result.planes=planes;
    const capabilities:any=await fetch(`/api/projects/${o.projectId}/spatial/status`,{signal:o.signal}).then(r=>r.ok?r.json():{}).catch(()=>({}));
    /* the native path (COLMAP + SAM 2) takes minutes; it is offered, not forced: these say when it would help */
    result.walking=trackTranslation(track,tw,th)>.08;result.subjectsSeen=frames.some((f:any)=>f?.subjects?.length||f?.box);
    const strategy=planSpatialAnalysis({requested:o.engine??'auto',error:track.medianError??0,inlierShare:track.inlierShare??0,lostShare:(track as any).lostShare??0,motionExtent:trackMotionExtent(track,tw,th),sceneMotion:scene?.motion??'',native:!!capabilities.native,advanced:!!capabilities.advanced,availableBytes:capabilities.availableBytes??Infinity});result.strategy=strategy;if(strategy.limited)notes.push(strategy.limited);
    if(!src.image&&strategy.geometry==='spatial'){
      try{result.spatial=await reconstructSpatial(o.projectId,o.src.split('#')[0],result.from,result.to,o.signal,(share,message)=>o.onProgress?.(.94+share*.05,message),content);if(result.spatial){const index=notes.findIndex(n=>n.startsWith('Planar solve:'));if(index>=0)notes.splice(index,1);notes.push('Calibrated COLMAP camera and sparse world geometry available. World pins require verified local geometry.');}}
      catch(error){abortable(o.signal);notes.push(`World reconstruction unavailable: ${error instanceof Error?error.message:String(error)}. Planar surface tracking remains available.`);}
    }
    if(strategy.foreground==='detailed'&&result.spatial){
      const first=frames.findIndex((f:any)=>f?.subjects?.length||f?.box);const info:any=frames[first];const subjects=info?.subjects??(info?.box?[info]:[]);
      if(subjects.length){try{const {reconstructOcclusion}=await import('./spatial-analysis');result.occlusion=await reconstructOcclusion(o.projectId,o.src.split('#')[0],times[first]??o.from,result.to,result.spatial,subjects.map((s:any)=>({box:[s.box[0]/tw,s.box[1]/th,s.box[2]/tw,s.box[3]/th]})),o.signal,(share,message)=>o.onProgress?.(.98+share*.019,message));}catch(error){abortable(o.signal);notes.push(`Enhanced occlusion unavailable: ${error instanceof Error?error.message:String(error)}`);}}
      else notes.push('No foreground instance was observed; SAM 2 was not loaded.');
    }
    if (keptGrays.length === times.length) rememberScan(id, { w: tw, h: th, times: [...times], grays: keptGrays });
    result.elapsedMs=Math.round(performance.now()-started);
    await putFile(o.projectId, resultPath, JSON.stringify(result));
    o.onProgress?.(1, 'Analysis complete');
    return result;
  } finally { detector?.terminate(); worker.terminate(); cleaner.terminate(); src.close(); }
}
