import type { Film, Op } from '@/api';
import { makeLayer, framePath, round, writeLayer, type FrameLayer } from './layers';
import { lineOf, spans } from './lines';
import { cameraPreset, camera3dPreset, cameraView, CAMERA_PRESETS, CAMERA3D_PRESETS } from './motion3d.js';
import { continueCameraMotion } from './motion-sequence.js';
import { readLayer, isFrameSrc, layerIdOf } from './layers';

/* Camera clips. A camera is its own clip on its own line (a page that draws nothing, see camera-runtime.js); the film's
   timeline shows every line below it through the camera while the camera is on. It goes right above the Video line, so
   the footage is seen through it and text or graphics above it stay where they are (drag its line higher to include
   them). The highest camera on at a moment is the one used. */
export { CAMERA_PRESETS, CAMERA3D_PRESETS };
export type CamOpts = { target?: [number, number]; targets?: [number, number][]; zoom?: number; start?: number; stop?: number; smoothStart?: boolean; smoothStop?: boolean; returnBack?: boolean; returnDuration?: number; returnAt?: number; smoothReturn?: boolean; shake?: number;
  /* 3D */ distance?: number; orbit?: number; fov?: number; target3d?: [number, number, number]; continuePrevious?: boolean };
export type CameraSpec = { mode: '2d' | '3d'; preset: string; opts: CamOpts; motion: unknown; custom?: boolean; shots?: { t: number; view: string }[]; bounds: 'constrain' | 'fill' | 'allow'; background?: string; holdAfter: boolean; stageW: number; stageH: number; media?: { x: number; y: number; w: number; h: number } | null };

export function buildCamera(mode: '2d' | '3d', preset: string, opts: CamOpts, length: number, stage: { w: number; h: number }): unknown {
  if (mode === '3d') return camera3dPreset(preset, length, { ...opts, target: opts.target3d });
  const m = cameraPreset(preset, stage, length, opts) as Record<string, unknown>;
  /* a return lands at the clip's end by default, starting no earlier than the move has arrived */
  const arrived = Math.max(0, ...((m.keys as { t: number }[] | undefined) ?? []).map((k) => k.t));
  if (m.returnBack) m.returnAt = opts.returnAt ?? Math.max(arrived, length - Number(m.returnDuration ?? opts.returnDuration ?? 0.8));
  return m;
}
/** Where the camera shows past the footage (zoomed out or rolled with "allow"): sampled through the clip. */
export function framingWarning(cam: CameraSpec, length: number) {
  if (cam.mode !== '2d' || cam.bounds === 'constrain') return null;
  for (let i = 0; i <= 24; i++) { const v = cameraView(cam.motion, (i / 24) * length, length, { w: cam.stageW, h: cam.stageH }, 'allow', cam.media ?? null); if (v.outside) return `At ${round((i / 24) * length)}s the view shows past the edge of the picture.`; }
  return null;
}

/** Where the footage under `at` sits on the stage (contain, or its box): what "keep inside" keeps the view within. */
export async function mediaRect(folder: string, film: Film | null, at: number) {
  const stage = film?.stage ?? { w: 1080, h: 1920 };
  for (const tr of film?.tracks ?? []) {
    const sp = spans(tr.clips);
    for (const [i, c] of tr.clips.entries()) {
      const path = c.src.split('#')[0]; if (lineOf(c.src) !== 'media' || path.startsWith('frame/')) continue;
      const end = sp[i].end ?? Infinity; if (at < sp[i].start - 1e-3 || at >= end) continue;
      if (c.box?.w && c.box?.h) return { x: c.box.x, y: c.box.y, w: c.box.w, h: c.box.h };
      const size = await new Promise<{ w: number; h: number } | null>((done) => {
        if (/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) { const im = new Image(); im.onload = () => done({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => done(null); im.src = `${folder}${path}`; return; }
        const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => done({ w: v.videoWidth, h: v.videoHeight }); v.onerror = () => done(null); v.src = `${folder}${path}`; setTimeout(() => done(null), 5000);
      });
      if (!size) return null; const k = Math.min(stage.w / size.w, stage.h / size.h);
      return { x: round((stage.w - size.w * k) / 2), y: round((stage.h - size.h * k) / 2), w: round(size.w * k), h: round(size.h * k) };
    }
  }
  return null;
}

export async function addCamera(projectId: string, film: Film | null, at: number, mode: '2d' | '3d', preset: string, length = 3, opts: CamOpts = {}, folder = '') {
  const stage = film?.stage ?? { w: 1080, h: 1920 };
  const media = mode === '2d' && folder ? await mediaRect(folder, film, at) : null;
  const o: CamOpts = mode === '2d' ? { zoom: 1.75, start: 0, stop: Math.min(length, 1.2), smoothStart: true, smoothStop: true, ...opts } : { distance: 4.5, orbit: 65, fov: 35, start: 0, stop: length, smoothStart: true, smoothStop: true, ...opts };
  const camera: CameraSpec = { mode, preset, opts: o, motion: buildCamera(mode, preset, o, length, stage), bounds: 'constrain', holdAfter: false, stageW: stage.w, stageH: stage.h, media };
  if(mode==='3d'&&opts.continuePrevious&&folder){
    let previous:{motion:unknown;time:number;length:number;at:number}|null=null;
    for(const tr of film?.tracks??[]){const sp=spans(tr.clips);for(const [i,c]of tr.clips.entries()){
      if(!isFrameSrc(c.src)||sp[i].start>at)continue;
      const l=await readLayer(folder,layerIdOf(c.src));const m=l?.kind==='camera'&&l.camera?.mode==='3d'?l.camera.motion:l?.kind==='scene3d'?l.cameraMotion:null;
      if(m&&(!previous||sp[i].start>=previous.at))previous={motion:m,time:Math.min(l!.duration,Math.max(0,at-sp[i].start)),length:l!.duration,at:sp[i].start};
    }}
    if(previous)camera.motion=continueCameraMotion(camera.motion,previous.motion,previous.time,previous.length);
  }
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-cam-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'camera' as never,
    name: mode === '2d' ? `2D Camera · ${CAMERA_PRESETS[preset as keyof typeof CAMERA_PRESETS] ?? preset}` : `3D Camera · ${CAMERA3D_PRESETS[preset as keyof typeof CAMERA3D_PRESETS] ?? preset}`,
    duration: round(length), camera,
  } as never);
  await writeLayer(projectId, layer);
  /* 2D: right above the Video line (the first line with footage), so titles above it stay put. 3D: the top line, since
     only 3D scenes look through it and a scene may sit on any line. A new line of its own either way. */
  const tracks = film?.tracks ?? [];
  const videoLine = tracks.findIndex((t) => t.clips.some((c) => lineOf(c.src) === 'media'));
  const op = { op: 'insert', clip: { src: framePath(layer.id), id: layer.id, time: [0, layer.duration] }, at: round(at), newTrack: mode === '3d' ? 0 : videoLine >= 0 ? videoLine : 0 } as Op;
  return { op, layer };
}
