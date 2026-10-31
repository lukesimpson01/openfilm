import type { Film, Op } from '@/api';
import { makeLayer, framePath, round, writeLayer, putFile, type FrameLayer } from './layers';
import { footageAt, footageFor } from './zoom';
import type { AnalysisResult } from './analysis';
import { clipFit } from './track-space.js';
import { trackedRange } from './footage-timing.js';

/* Tracked layers: things placed into real footage (3D text in the scene, text behind a person, a logo on a wall) and
   the subject effects. One layer is one editable effect: it plays the footage's own pixels where it needs them (the
   subject in front), so nothing is duplicated on the timeline. It sits on a line right above the footage it belongs to,
   and plays that footage's frames for the same film seconds (as a zoom does). */
export type TrackItem = {
  text?: string; image?: string; font?: string; weight?: number; color?: string; color2?: string; gradient?: boolean; strokeWidth?: number; strokeColor?: string; glow?: number;
  place: 'surface' | 'standing'; anchor: [number, number]; size: number; rotation?: number; tiltX?: number; rotationY?: number; depth?: number; sideColor?: string; shadow?: boolean;
  letters?: boolean; opacity?: number; in?: number; out?: number;
  sceneDepth?: number; elevation?: number; spacing?: number;
  motion?:Record<string,any>;animations?:any[];videoAt?:number;videoFrom?:number;videoSpeed?:number;id?:string;video?:string;model?:string;spatialAnchor?:Record<string,any>;worldHeight?:number;spatialWarning?:string;
  planeQuad?:[number,number][];sceneClip?:[number,number][];surfaceName?:string;autoSurface?:boolean;track?:string;
  /** entrance / exit style (ANIM_NAMES) over `in` / `out` seconds; letters of a split word start `stagger` s apart */
  anim?: AnimName; animOut?: AnimName; stagger?: number;
  /** a designed card instead of plain text: 'location' (place name, `sub` and `sub2` lines under it) */
  card?: 'location'; sub?: string; sub2?: string; subColor?: string; italic?: boolean;
};
export const ANIM_NAMES = {
  fade: 'Fade', rise: 'Rise up', drop: 'Drop in', pop: 'Pop', zoom: 'Zoom in', slideLeft: 'Slide from right', slideRight: 'Slide from left', wipe: 'Wipe', type: 'Typewriter', flicker: 'Flicker on', flip: 'Flip up', swing: 'Swing', spin: 'Spin in', focus: 'Soft focus',
} as const;
export type AnimName = keyof typeof ANIM_NAMES;
/** stickers drawn for Shorts (public/assets/stickers, original art): copied into the project when used */
export const STICKERS = [
  ['map-pin', 'Map pin'], ['pin-blue', 'Blue pin'], ['location-dot', 'You are here'], ['arrow-curved', 'Curved arrow'], ['arrow-red', 'Red arrow'], ['circle-scribble', 'Circle it'],
  ['underline', 'Underline'], ['star-burst', 'NEW burst'], ['check-badge', 'Check'], ['x-badge', 'Cross'], ['speech-bubble', 'Speech bubble'], ['price-tag', 'Price tag'],
  ['play-button', 'Play button'], ['heart', 'Heart'], ['thumbs-up', 'Thumbs up'], ['bracket-frame', 'Target frame'],
] as const;
/** a sticker's file in the project (copied from Studio's assets the first time) */
export async function stickerPath(projectId: string, id: string) {
  const path = `assets/stickers/${id}.svg`;
  const text = await fetch(`/assets/stickers/${id}.svg`).then((r) => r.text());
  await putFile(projectId, path, new Blob([text], { type: 'image/svg+xml' }));
  return path;
}
/** an uploaded picture, saved into the project's assets */
export async function uploadPicture(projectId: string, file: File) {
  const safe = file.name.replace(/[^\w.-]+/g, '-').toLowerCase();
  return putFile(projectId, `assets/uploads/${Date.now().toString(36)}-${safe}`, file);
}
export type DepthRange = { from: number; to: number; mode: 'behind' | 'front' | 'auto' | 'manual';target?:number|'all';manualDepth?:number };
export const EFFECT_MODES = {
  textBehind: 'Objects in the scene', cutout: 'Subject Cutout Pop', outline: 'Outline Trace', focus: 'Cinematic Focus Pull', parallax: '3D Photo Parallax', maskReveal: 'Mask Reveal', freezePop: 'Freeze Frame Pop', echo: 'Motion Echo',
} as const;
export type EffectMode = keyof typeof EFFECT_MODES;

/** A default item for a template, placed where the person clicked (proxy px of the reference frame). */
export function itemFor(template: string, text: string, anchor: [number, number], proxyH: number): TrackItem {
  switch (template) {
    case 'location': return { text: text || 'LOCATION', font:'Rajdhani',sub: '', sub2: '', card: 'location', place: 'surface', anchor, size: proxyH * 0.16, weight: 600, color: '#ffffff', color2: '#ffcf7a', anim: 'type', in: 0.9, animOut: 'fade', out: 0.4 };
    case 'sticker': return { image: text, place: 'standing', anchor, size: proxyH * 0.16, depth: 0.02, shadow: true, anim: 'pop', in: 0.35, animOut: 'fade', out: 0.25 };
    case 'image': return { image: text, place: 'surface', anchor, size: proxyH * 0.3, anim: 'fade', in: 0.3 };
    case 'walkThrough': return { text, place: 'standing', anchor, size: proxyH * 0.26, letters: true, spacing: 1.16, sceneDepth: .5, rotationY: -12, depth: 0.18, weight: 900, color: '#ffffff', sideColor: '#68768e', shadow: true };
    case 'giant': return { text, place: 'standing', anchor, size: proxyH * 0.5, letters: true, depth: 0.3, weight: 900, color: '#ffffff', sideColor: '#6b7385', shadow: true };
    case 'surface': return { text, place: 'surface', anchor, size: proxyH * 0.07, weight: 800, color: '#ffffff', strokeWidth: 6, strokeColor: 'rgba(0,0,0,0.35)' };
    case 'floating': return { text, place: 'standing', anchor: [anchor[0], anchor[1] - proxyH * 0.05], size: proxyH * 0.18, depth: 0.12, weight: 900, color: '#ffffff', sideColor: '#9aa3b5', shadow: true };
    case 'behind': default: return { text, place: 'standing', anchor, size: proxyH * 0.28, depth: 0.15, weight: 900, color: '#ffffff', sideColor: '#9aa3b5', shadow: true };
  }
}

export async function addTracked(projectId: string, film: Film | null, clipId: string, at: number, o: { name: string; analysis: AnalysisResult; mode?: EffectMode; items?: TrackItem[]; defaultDepth?: DepthRange['mode']; length?: number; extra?: Record<string, unknown> }) {
  const f = footageAt(film, at, clipId);
  if (!f) throw new Error('Select the video the effect belongs to.');
  const range = trackedRange(f, o.analysis, at, o.length);
  const from = range.from, length = round(range.length);
  const foot = footageFor(f, from);
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-trk-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'track' as never, name: o.name, duration: length,
    source: { src: foot.aSrc, at: foot.aAt, speed: foot.aSpeed }, clipId: f.clip.id,
    track: o.analysis.track, matte: o.analysis.matte ? { meta: o.analysis.matte } : null, analysis: o.analysis,
    mode: o.mode ?? 'textBehind', items: o.items ?? [], defaultDepth: o.defaultDepth ?? 'auto', occlusion: [], feather: 0.05, edgeShift: 0, fit: clipFit(f.clip), sourceBox: f.clip.box, ownBackground: false, ...(o.extra ?? {}),
  } as never);
  await writeLayer(projectId, layer);
  const op = { op: 'insert', clip: { src: framePath(layer.id), id: layer.id, time: [0, length], ...(f.clip.box ? { box: { ...f.clip.box } } : {}) }, at: round(from), newTrack: f.track } as Op;
  return { op, layer };
}
