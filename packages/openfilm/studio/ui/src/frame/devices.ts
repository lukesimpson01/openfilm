import type { Film, Op } from '@/api';
import { makeLayer, framePath, round, writeLayer, type FrameLayer } from './layers';
import { placeClip } from './lines';

/* 3D devices and cards: what the 3D tab's simple controls turn into. A device's movement is a motion (motion3d.js) with
   keys; the quick controls (start from, finish at, how it turns, smooth, hold, return, exit) write those keys, and
   "Customise path" edits the same keys directly. Positions: x, y in frame units (−1…1 = the picture's edges at depth
   0), z toward the viewer. */
export type Vec3 = [number, number, number];
export type Key = { t: number; p: Vec3; r?: Vec3; s?: number; o?: number; lid?: number; extra?: number; look?: Vec3; fov?: number; zoom?: number };
export type Motion = { keys: Key[]; enabled?:boolean;holdPose?:Record<string,any>;curved?: boolean; arcLength?: boolean; smoothStart?: boolean; smoothStop?: boolean; returnBack?: boolean; returnAt?: number; returnDuration?: number; smoothReturn?: boolean; returnTo?: string; loop?: string; reverse?: boolean; faceCamera?: boolean; faceShare?: number; alongPath?: number; bank?: number; shake?: { amount: number; speed?: number } };
export type ScreenSpec = { src?: string; graphic?: string; params?: Record<string, unknown>; fit?: 'cover' | 'contain'; offset?: number; speed?: number; loop?: boolean; trimEnd?: number; brightness?: number; onAt?: number; offAt?: number; playAt?: number; startMode?:'action'|'start'|'time'; events?: {t:number;on:boolean}[] };
export type ModelAnimation={src:string;clip:string|number;at:number;duration:number;speed?:number;loop?:boolean;inPlace?:boolean;fade?:number};
export type ModelClip={name:string;index:number;duration:number};
export type DeviceObject = { type: 'phone' | 'laptop' | 'card' | 'text'|'model'; model?:string;name?:string;height?:number;width?:number;clips?:ModelClip[];animations?:ModelAnimation[];animationLibrary?:{src:string;clips:ModelClip[]}[];finish?: string; screen?: ScreenSpec; motion: Motion; scale?: number; lid?: number; notch?: boolean; backlight?: boolean; island?: boolean; text?: string; color?: string; depth?: number; aspect?: number; actions?: {type:string;at:number;duration:number}[]; sequenceEnd?: number };

export const START_FROM: Record<string, Vec3> = {
  bottomLeft: [-1.5, -1.45, -1.6], bottomRight: [1.5, -1.45, -1.6], left: [-1.8, 0, -1.2], right: [1.8, 0, -1.2], top: [0, 1.7, -1.4], bottom: [0, -1.8, -1.4],
  topLeft: [-1.5, 1.45, -1.6], topRight: [1.5, 1.45, -1.6], behind: [0, 0.2, -9], front: [0, -0.2, 3.2],
};
export const FINISH_AT: Record<string, Vec3> = { centre: [0, 0, 0], left: [-0.42, 0, 0.1], right: [0.42, 0, 0.1], top: [0, 0.38, 0.1], bottom: [0, -0.38, 0.1], low: [0, -0.15, 0.6] };
export const ROTATIONS: Record<string, Vec3> = { cinematic: [-16, 52, -12], subtle: [-6, 18, -4], none: [0, 0, 0], spin: [0, 320, 8], backToFront: [4, 180, 0], sideToFront: [0, 88, 0], tilt: [-28, 0, 0] };
export const EXITS = ['none', 'flyAway', 'reverse', 'shrink', 'rotateAway', 'fade'] as const;
export type Quick = {
  device: 'phone' | 'laptop'; entrance: 'float' | 'slide' | 'fly' | 'rise' | 'none'; startFrom: keyof typeof START_FROM | string; finishAt: keyof typeof FINISH_AT | string;
  duration: number; rotation: keyof typeof ROTATIONS | string; smooth: boolean; holdAtEnd: boolean; returnMotion: boolean; exit: typeof EXITS[number]; exitDuration: number; length: number; delay?: number;
};
export const DEFAULT_QUICK: Quick = { device: 'phone', entrance: 'float', startFrom: 'bottomLeft', finishAt: 'centre', duration: 2.5, rotation: 'cinematic', smooth: true, holdAtEnd: true, returnMotion: false, exit: 'none', exitDuration: 0.8, length: 5 };

const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const mix = (a: Vec3, b: Vec3, k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
/** The motion the quick controls describe: entrance → float (a gentle arc, turning toward the viewer) → settle, hold, exit. */
export function quickMotion(q: Quick): Motion {
  const t0 = q.delay ?? 0, t1 = Math.min(q.length - 0.05, t0 + q.duration);
  const end = FINISH_AT[q.finishAt] ?? FINISH_AT.centre;
  const start = q.entrance === 'none' ? end : START_FROM[q.startFrom] ?? START_FROM.bottomLeft;
  const rot = ROTATIONS[q.rotation] ?? ROTATIONS.cinematic;
  /* the float: a curve that bows up and comes forward, turning most of the way to face the viewer by 70% of the move */
  const bow: Vec3 = q.entrance === 'float' ? [0, 0.22, 0.4] : q.entrance === 'rise' ? [0, -0.1, 0.2] : [0, 0, 0];
  const mid = add(mix(start, end, q.entrance === 'fly' ? 0.75 : 0.62), bow);
  const keys: Key[] = q.entrance === 'none' ? [{ t: t0, p: end, r: [0, 0, 0] }, { t: t1, p: end, r: [0, 0, 0] }] : [
    { t: t0, p: start, r: rot, s: q.entrance === 'fly' ? 0.7 : 1 },
    { t: t0 + (t1 - t0) * 0.58, p: mid, r: [rot[0] * 0.3, rot[1] * 0.22, rot[2] * 0.25], s: 1 },
    { t: t1, p: end, r: q.device === 'laptop' ? [12, 0, 0] : [0, 0, 0], s: 1, ...(q.device === 'laptop' ? { lid: 110 } : {}) },
  ];
  if (q.device === 'laptop') keys.forEach((k) => { k.lid ??= 110; });
  const m: Motion = { keys, curved: true, arcLength: true, smoothStart: q.smooth, smoothStop: q.smooth, faceCamera: true, faceShare: 0.35 };
  if (q.returnMotion || q.exit === 'reverse') { m.returnBack = true; m.returnDuration = q.exitDuration; m.returnAt = q.length - q.exitDuration; m.smoothReturn = q.smooth; }
  else if (q.exit !== 'none') {
    const at = q.length - q.exitDuration; const last = keys[keys.length - 1];
    if (at > last.t + 0.01) keys.push({ ...last, t: at });
    const out: Key = q.exit === 'flyAway' ? { t: q.length, p: [end[0] + 0.3, end[1] + 1.8, end[2] - 3], r: [-20, -30, 10], s: 0.9 }
      : q.exit === 'shrink' ? { t: q.length, p: [end[0], end[1], end[2] - 6], r: [0, 0, 0], s: 0.3 }
        : q.exit === 'rotateAway' ? { t: q.length, p: [end[0] + 1.9, end[1], end[2] - 1], r: [0, -90, 0] }
          : { t: q.length, p: end, r: [0, 0, 0], o: 0 };
    if (q.exit === 'fade') keys[keys.length - 1].o = 1;
    keys.push(out); m.faceCamera = false;
  } else if (!q.holdAtEnd) { keys.push({ ...keys[keys.length - 1], t: q.length, o: 0 }); keys[keys.length - 2].o = 1; }
  return m;
}

export const DEVICE_PRESETS: { id: string; name: string; about: string; length: number }[] = [
  { id: 'floatingReveal', name: 'Floating Reveal', about: 'Floats in on a curve, turns to face you and settles centre.', length: 5 },
  { id: 'slowOrbit', name: 'Slow Orbit', about: 'The camera circles the device slowly; its screen keeps playing.', length: 6 },
  { id: 'sideToFront', name: 'Side-to-Front', about: 'Starts edge-on and turns to show its screen.', length: 4 },
  { id: 'backToFront', name: 'Back-to-Front', about: 'Shows its back and cameras, then turns to its lit screen.', length: 4 },
  { id: 'flyToward', name: 'Fly Toward Camera', about: 'Comes from far away straight at you and stops close.', length: 4 },
  { id: 'floatSettle', name: 'Float & Settle', about: 'Drifts up gently and comes to rest, with a slow idle float.', length: 5 },
  { id: 'hero', name: 'Cinematic Product Hero', about: 'A low angle hero move with the camera sweeping round.', length: 6 },
  { id: 'dual', name: 'Dual Device Showcase', about: 'Two phones float in from both sides, side by side.', length: 5 },
  { id: 'pair', name: 'Phone and Laptop Pair', about: 'A laptop opens centre while a phone floats in beside it.', length: 6 },
  { id: 'phoneToMac', name: 'Phone-to-MacBook Transformation', about: 'The phone moves into the laptop screen as the laptop opens.', length: 6 },
  { id: 'carousel', name: 'Device Carousel', about: 'Three phones turn around you like a carousel.', length: 6 },
  { id: 'exploded', name: 'Exploded Product Reveal', about: 'The phone separates into its layers, then comes back together.', length: 5 },
  { id: 'lidOpening', name: 'Laptop Lid Opening', about: 'A closed laptop opens and the camera moves to face its screen.', length: 5 },
  { id: 'stack', name: 'Device Stack', about: 'Three phones fan out from a stack.', length: 5 },
  { id: 'comparison', name: 'Rotating Product Comparison', about: 'Two devices turn slowly to show every side.', length: 6 },
  { id: 'saas', name: 'Floating SaaS Dashboard', about: 'A laptop floats tilted with your dashboard on screen.', length: 6 },
  { id: 'screenToReality', name: 'Screen-to-Reality', about: 'Zooms into the phone screen until its video fills the frame.', length: 4 },
  { id: 'screenPullout', name: 'Screen Pullout', about: 'Fullscreen video shrinks back into a phone screen.', length: 4 },
  { id: 'photoCards', name: 'Floating Photo Cards', about: 'Your photos float in 3D and settle into a fan.', length: 5 },
];

/** The scene a preset makes (objects with their motions, an optional camera move, extras), for `screen` media. */
export function presetScene(id: string, screen: ScreenSpec | null, length: number, quick: Partial<Quick> = {}, images: string[] = []) {
  const Q = (o: Partial<Quick>) => quickMotion({ ...DEFAULT_QUICK, length, ...quick, ...o });
  const sc = screen ?? undefined; const objects: DeviceObject[] = []; let cameraMotion: Motion | undefined; const extra: Record<string, unknown> = {};
  const phone = (motion: Motion, o: Partial<DeviceObject> = {}): DeviceObject => ({ type: 'phone', finish: 'titanium', screen: sc, motion, ...o });
  const laptop = (motion: Motion, o: Partial<DeviceObject> = {}): DeviceObject => ({ type: 'laptop', finish: 'silver', screen: sc, motion, notch: true, ...o });
  const still = (p: Vec3, r: Vec3 = [0, 0, 0], extraKey: Partial<Key> = {}): Motion => ({ keys: [{ t: 0, p, r, ...extraKey }, { t: length, p, r, ...extraKey }], smoothStart: true, smoothStop: true });
  switch (id) {
    case 'slowOrbit': objects.push(phone(still([0, 0, 0]))); cameraMotion = orbitCam(length, 4.6, 70); break;
    case 'sideToFront': objects.push(phone(Q({ rotation: 'sideToFront', startFrom: 'right' }))); break;
    case 'backToFront': objects.push(phone(Q({ rotation: 'backToFront', startFrom: 'bottom' }))); break;
    case 'flyToward': objects.push(phone(Q({ entrance: 'fly', startFrom: 'behind', rotation: 'subtle' }))); break;
    case 'floatSettle': { const m = Q({ entrance: 'rise', startFrom: 'bottom', rotation: 'subtle' }); m.shake = { amount: 0.012, speed: 1.4 }; objects.push(phone(m)); break; }
    case 'hero': objects.push(laptop(still([0, -0.1, 0], [8, 0, 0], { lid: 108 }))); cameraMotion = { keys: [{ t: 0, p: [-3.6, -0.4, 3.4], look: [0, 0.2, 0], fov: 32 }, { t: length * 0.7, p: [0.6, 0.6, 5.2], look: [0, 0.3, 0], fov: 32 }, { t: length, p: [0, 0.7, 5.4], look: [0, 0.3, 0], fov: 32 }], smoothStart: true, smoothStop: true, curved: true }; break;
    case 'dual': objects.push(phone(Q({ startFrom: 'bottomLeft', finishAt: 'left' }), { scale: 0.85 }), phone(Q({ startFrom: 'bottomRight', finishAt: 'right', delay: 0.25 }), { scale: 0.85, finish: 'black' })); break;
    case 'pair': objects.push(laptop({ ...Q({ startFrom: 'bottom', finishAt: 'centre', rotation: 'tilt' }), keys: Q({ startFrom: 'bottom', finishAt: 'centre', rotation: 'tilt' }).keys.map((k, i) => ({ ...k, lid: i === 0 ? 0 : 110 })) }), phone(Q({ startFrom: 'right', finishAt: 'right', delay: 0.8 }), { scale: 0.45 })); break;
    case 'phoneToMac': {
      const laptopKeys: Key[] = [{ t: 0, p: [0, -0.05, -0.4], r: [10, 0, 0], lid: 0, o: 0 }, { t: length * 0.25, p: [0, -0.05, -0.4], r: [10, 0, 0], lid: 0, o: 1 }, { t: length * 0.75, p: [0, -0.05, 0], r: [0, 0, 0], lid: 110 }];
      objects.push(laptop({ keys: laptopKeys, smoothStart: true, smoothStop: true }));
      objects.push(phone({ keys: [{ t: 0, p: [0, 0, 0.6], r: [0, 0, 0], s: 1, o: 1 }, { t: length * 0.45, p: [0, 0.06, 0.2], r: [0, 0, -90], s: 0.62, o: 1 }, { t: length * 0.7, p: [0, 0.05, 0.05], r: [0, 0, -90], s: 0.55, o: 0 }], smoothStart: true, smoothStop: true }));
      break;
    }
    case 'carousel': for (let i = 0; i < 3; i++) { const a0 = (i / 3) * 360; objects.push(phone({ keys: Array.from({ length: 7 }, (_, k) => { const a = (a0 + k * 20) * Math.PI / 180; return { t: (k / 6) * length, p: [Math.sin(a) * 0.55, 0, Math.cos(a) * 1.1 - 0.6] as Vec3, r: [0, (a0 + k * 20), 0] as Vec3 }; }), curved: true, smoothStart: true, smoothStop: true }, { scale: 0.7 })); } break;
    case 'exploded': objects.push(phone({ keys: [{ t: 0, p: [0, 0, 0], r: [-14, 38, -6], extra: 0 }, { t: length * 0.45, p: [0, 0, 0], r: [-18, 52, -8], extra: 1 }, { t: length * 0.85, p: [0, 0, 0.2], r: [0, 0, 0], extra: 0 }], smoothStart: true, smoothStop: true, curved: true })); break;
    case 'lidOpening': objects.push(laptop({ keys: [{ t: 0, p: [0, -0.1, 0], r: [12, 0, 0], lid: 0 }, { t: length * 0.7, p: [0, -0.1, 0], r: [4, 0, 0], lid: 112 }], smoothStart: true, smoothStop: true })); cameraMotion = { keys: [{ t: 0, p: [0, 2.6, 3.4], look: [0, 0, 0], fov: 32 }, { t: length * 0.85, p: [0, 0.7, 5.2], look: [0, 0.45, 0], fov: 32 }], smoothStart: true, smoothStop: true }; break;
    case 'stack': for (let i = 0; i < 3; i++) objects.push(phone({ keys: [{ t: 0, p: [0, 0, -i * 0.05], r: [-10, 25, 0] }, { t: length * 0.6, p: [(i - 1) * 0.55, 0, -i * 0.35], r: [-6, 15 - i * 15, (1 - i) * 4] }], smoothStart: true, smoothStop: true }, { scale: 0.7, finish: ['titanium', 'black', 'blue'][i] })); break;
    case 'comparison': objects.push(phone({ keys: [{ t: 0, p: [-0.45, 0, 0], r: [0, -30, 0] }, { t: length, p: [-0.45, 0, 0], r: [0, 330, 0] }], smoothStart: true, smoothStop: true }, { scale: 0.8 }), phone({ keys: [{ t: 0, p: [0.45, 0, 0], r: [0, 30, 0] }, { t: length, p: [0.45, 0, 0], r: [0, -330, 0] }], smoothStart: true, smoothStop: true }, { scale: 0.8, finish: 'gold' })); break;
    case 'saas': { const m: Motion = { keys: [{ t: 0, p: [0.2, -1.6, -1.5], r: [30, -25, 6], lid: 110 }, { t: length * 0.55, p: [0, 0.02, 0.1], r: [14, -12, 2], lid: 110 }, { t: length, p: [0, 0, 0.15], r: [10, -8, 1], lid: 110 }], smoothStart: true, smoothStop: true, curved: true, shake: { amount: 0.01, speed: 1.2 } }; objects.push(laptop(m)); break; }
    case 'screenToReality': objects.push(phone(still([0, 0, 0]))); cameraMotion = { keys: [{ t: 0, p: [0.8, 0.3, 6.2], look: [0, 0, 0], fov: 30 }, { t: length * 0.8, p: [0, 0, 1.45], look: [0, 0, 0], fov: 30 }], smoothStart: true, smoothStop: false }; extra.fullscreen = { from: length * 0.62, to: length * 0.8 }; break;
    case 'screenPullout': objects.push(phone(still([0, 0, 0]))); cameraMotion = { keys: [{ t: 0, p: [0, 0, 1.45], look: [0, 0, 0], fov: 30 }, { t: length * 0.8, p: [-0.6, 0.2, 6.2], look: [0, 0, 0], fov: 30 }], smoothStart: false, smoothStop: true }; extra.fullscreen = { from: 0, to: length * 0.2, reverse: true }; break;
    case 'photoCards': {
      const pics = images.length ? images : screen?.src ? [screen.src] : [];
      const n = Math.max(1, Math.min(6, pics.length || 3));
      for (let i = 0; i < n; i++) { const k = n === 1 ? 0 : i / (n - 1) - 0.5; const end: Vec3 = [k * 1.1, -Math.abs(k) * 0.15, i * 0.02]; objects.push({ type: 'card', screen: pics[i % Math.max(1, pics.length)] ? { src: pics[i % pics.length] } : undefined, motion: { keys: [{ t: i * 0.15, p: [k * 3, -1.6 - i * 0.2, -2], r: [-25, 40 * k, 30 * k] }, { t: i * 0.15 + length * 0.4, p: [k * 1.5, 0.15, -0.6], r: [-8, 15 * k, 12 * k] }, { t: i * 0.15 + length * 0.7, p: end, r: [0, 0, k * 14] }], smoothStart: true, smoothStop: true, curved: true }, scale: 0.75 }); }
      break;
    }
    case 'floatingReveal': default: objects.push(id === 'floatingReveal' && quick.device === 'laptop' ? laptop(Q({})) : phone(Q({}))); break;
  }
  return { objects, cameraMotion, extra };
}
/** a camera circling the scene's centre */
export function orbitCam(length: number, distance: number, degrees: number): Motion {
  const n = 6; return { keys: Array.from({ length: n + 1 }, (_, i) => { const a = ((-degrees / 2) + (degrees * i) / n) * Math.PI / 180; return { t: (i / n) * length, p: [Math.sin(a) * distance, distance * 0.12, Math.cos(a) * distance] as Vec3, look: [0, 0, 0] as Vec3, fov: 30 }; }), smoothStart: true, smoothStop: true, curved: true };
}

/** Puts a 3D scene on the timeline (a Motion graphics line) and returns its layer. */
export async function addScene3d(projectId: string, film: Film | null, at: number, name: string, scene: { objects: DeviceObject[]; cameraMotion?: Motion; extra?: Record<string, unknown> }, length: number, presetId: string) {
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-3d-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'scene3d' as never, name, duration: round(length),
    objects: scene.objects, cameraMotion: scene.cameraMotion, preset: presetId, motionBlur: 0, softShadow: true, ...(scene.extra ?? {}),
  } as never);
  await writeLayer(projectId, layer);
  const placed = placeClip(film, { src: framePath(layer.id), id: layer.id, time: [0, layer.duration] }, at, layer.duration, 'graphics');
  return { op: placed.op as Op, opened: placed.opened, layer };
}
