import type { Clip, Film, Op } from '@/api';
import { ZOOM_EFFECT, EFFECTS } from './transitions-catalog.js';
import { spans } from './lines';
import { isFootage } from './transitions';
import { makeLayer, round, writeLayer, type FrameLayer } from './layers';

/* Zoom: an effect over part of one video or photo. Its page (frame/layer-fx-….html) draws that clip's own footage,
   seeked to the same frames the clip shows, scaled into a chosen point that glides to the centre — so the picture is
   the clip's, the preview and the export draw it the same way, and nothing on the Video line moves. */
export type Footage = { clip: Clip; track: number; start: number; end: number };

/** The video or photo at `t` seconds (the picked clip first, else the one under the playhead on a Video line). */
export function footageAt(film: Film | null, t: number, clipId?: string | null): Footage | null {
  let found: Footage | null = null;
  (film?.tracks ?? []).forEach((tr, track) => {
    const sp = spans(tr.clips);
    tr.clips.forEach((c, i) => {
      /* a whole video (no #t= range) lasts until the next clip on its line, or (the last one) open-ended */
      const next = sp.filter((x) => x.start > sp[i].start).sort((a, b) => a.start - b.start)[0];
      const end = sp[i].end ?? next?.start ?? sp[i].start + 3600;
      if (!isFootage(c.src)) return;
      if (clipId ? c.id === clipId : t >= sp[i].start - 1e-3 && t < end) found ??= { clip: c, track, start: sp[i].start, end };
    });
  });
  return found;
}

/** Where the zoom's page plays the clip's footage from, for a zoom starting at `from` on the timeline. */
export function footageFor(f: Footage, from: number) {
  const speed = f.clip.speed || 1;
  const inPoint = f.clip.time?.[0] ?? 0;
  return { aSrc: f.clip.src.split('#')[0], aAt: round(inPoint + Math.max(0, from - f.start) * speed), aSpeed: speed, bSrc: null, clipId: f.clip.id };
}

export async function addZoom(projectId: string, film: Film | null, at: number, clipId?: string | null) {
  const f = footageAt(film, at, clipId);
  if (!f) return { error: 'Put the playhead over a video or photo (or select one), then add the zoom.' as const };
  const from = clipId ? Math.max(f.start, Math.min(at, f.end - 0.3)) : at;
  const d = round(Math.max(0.3, Math.min(ZOOM_EFFECT.defaultDuration, f.end - from)));
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-fx-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'effect' as never, name: 'Zoom',
    effect: 'fx.zoom', duration: d, params: { ...ZOOM_EFFECT.defaults }, seed: 7, fps: 40, ...footageFor(f, from),
  } as never);
  await writeLayer(projectId, layer);
  const clip = { src: `frame/${layer.id}.html`, id: layer.id, time: [0, d] as [number, number] };
  /* the effect sits on a line of its own right above the clip's line (a new one: the clip's line is under it) */
  const op = { op: 'insert', clip, at: round(from), newTrack: f.track } as Op;
  return { op, layer };
}

/** Any one-clip effect (Velocity Edit, Beat Shake, Flash Impact…) over the clip at `at`, as a zoom is placed. */
export async function addEffect(projectId: string, film: Film | null, at: number, effectId: string, clipId?: string | null) {
  const def = (EFFECTS as { id: string; name: string; defaultDuration: number; defaults: Record<string, unknown> }[]).find((x) => x.id === effectId);
  if (!def) return { error: `No effect ${effectId}.` as const };
  if (effectId === 'fx.zoom') return addZoom(projectId, film, at, clipId);
  const f = footageAt(film, at, clipId);
  if (!f) return { error: 'Put the playhead over a video or photo (or select one), then add the effect.' as const };
  const from = clipId ? Math.max(f.start, Math.min(at, f.end - 0.3)) : at;
  const d = round(Math.max(0.2, Math.min(def.defaultDuration, f.end - from)));
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-fx-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'effect' as never, name: def.name,
    effect: def.id, duration: d, params: { ...def.defaults }, seed: 7, fps: 40, ...footageFor(f, from),
  } as never);
  await writeLayer(projectId, layer);
  const op = { op: 'insert', clip: { src: `frame/${layer.id}.html`, id: layer.id, time: [0, d] as [number, number] }, at: round(from), newTrack: f.track } as Op;
  return { op, layer };
}
