import type { Clip, Film, Op } from '@/api';
import { transitionById } from './transitions-catalog.js';
import { lineOf, spans } from './lines';
import { makeLayer, round, writeLayer, type FrameLayer } from './layers';

/* Transitions on a clip of the Video line, at its start or its end. Where it touches another clip that is a cut: the
   transition is centered on it (half its length each side). At a free edge it fades the clip in from black or out to
   black, inside the clip. A transition is a page clip on the Transitions line just above; no other clip moves. */
export type Edge = 'cut' | 'in' | 'out';
export interface Cut { at: number; track: number; a: Clip | null; b: Clip | null; aLen: number; bLen: number; edge: Edge }

const footageClip = (c: Clip) => !c.src.startsWith('frame/') && lineOf(c.src) === 'media';
/** A clip transitions can go on: a video or a photo (not a sound, a title or a story). */
export const isFootage = (src?: string) => !!src && footageClip({ src } as Clip);

function lineSpans(film: Film | null, track: number) {
  const tr = film?.tracks[track];
  if (!tr) return [];
  const out = spans(tr.clips).map((s, i) => ({ ...s, clip: tr.clips[i] })).sort((x, y) => x.start - y.start);
  /* a whole video (no #t= range) does not say its length: on the Video line it lasts until the next clip starts */
  out.forEach((s, i) => { if (s.end == null && out[i + 1] && out[i + 1].start > s.start) s.end = out[i + 1].start; });
  return out;
}

export function findCuts(film: Film | null): Cut[] {
  const out: Cut[] = [];
  (film?.tracks ?? []).forEach((tr, track) => {
    if (!tr.clips.length || !tr.clips.every((c) => lineOf(c.src) === 'media')) return;
    const sp = lineSpans(film, track);
    for (let i = 0; i + 1 < sp.length; i++) {
      const a = sp[i], b = sp[i + 1];
      if (a.end == null || Math.abs(a.end - b.start) > 0.04 || !footageClip(a.clip) || !footageClip(b.clip)) continue;
      out.push({ at: b.start, track, a: a.clip, b: b.clip, aLen: a.end - a.start, bLen: b.end != null ? b.end - b.start : 5, edge: 'cut' });
    }
  });
  return out;
}

/** The cut (or free edge) at the start or the end of clip `clipId`. */
export function cutFor(film: Film | null, clipId: string, side: 'start' | 'end'): Cut | null {
  const track = (film?.tracks ?? []).findIndex((tr) => tr.clips.some((c) => c.id === clipId));
  if (track < 0) return null;
  const sp = lineSpans(film, track);
  const i = sp.findIndex((s) => s.clip.id === clipId);
  const me = sp[i];
  if (!me || me.end == null || !footageClip(me.clip)) return null;
  const len = me.end - me.start;
  if (side === 'end') {
    const next = sp[i + 1];
    if (next && Math.abs(next.start - me.end) <= 0.04 && footageClip(next.clip)) return { at: next.start, track, a: me.clip, b: next.clip, aLen: len, bLen: next.end != null ? next.end - next.start : 5, edge: 'cut' };
    return { at: me.end, track, a: me.clip, b: null, aLen: len, bLen: 0, edge: 'out' };
  }
  const prev = sp[i - 1];
  if (prev && prev.end != null && Math.abs(prev.end - me.start) <= 0.04 && footageClip(prev.clip)) return { at: me.start, track, a: prev.clip, b: me.clip, aLen: prev.end - prev.start, bLen: len, edge: 'cut' };
  return { at: me.start, track, a: null, b: me.clip, aLen: 0, bLen: len, edge: 'in' };
}

export const maxDuration = (cut: Cut) => Math.max(0.1, Math.min(5, cut.edge === 'in' ? cut.bLen : cut.edge === 'out' ? cut.aLen : Math.min(cut.aLen, cut.bLen)));
/** Where the transition clip starts for a length of `d` on this cut. */
export const startOf = (cut: Pick<Cut, 'at' | 'edge'>, d: number) => (cut.edge === 'in' ? cut.at : cut.edge === 'out' ? cut.at - d : cut.at - d / 2);

const srcOf = (c: Clip) => c.src.split('#')[0];
/** Where each clip's footage plays during a transition of `d` seconds (a free side is black). */
export function footage(cut: Cut, d: number) {
  const lead = cut.edge === 'in' ? 0 : cut.edge === 'out' ? d : d / 2;
  const a = cut.a, b = cut.b;
  const aSpeed = a?.speed || 1, bSpeed = b?.speed || 1;
  const aOut = a ? (a.time && a.time.length === 2 ? a.time[1] : cut.aLen * aSpeed) : 0;
  const bIn = b?.time ? b.time[0] ?? 0 : 0;
  return { aSrc: a ? srcOf(a) : null, aSpeed, aAt: aOut - lead * aSpeed, bSrc: b ? srcOf(b) : null, bSpeed, bAt: bIn - lead * bSpeed, edge: cut.edge };
}

/** The transition clip already on this cut, if any. */
export function transitionOn(film: Film | null, cut: Cut): Clip | null {
  for (const tr of film?.tracks ?? []) for (const c of tr.clips) {
    if (lineOf(c.src) !== 'transition' || !c.time || c.time.length !== 2) continue;
    const s = c.at ?? 0, len = c.time[1] - c.time[0];
    const hit = cut.edge === 'in' ? Math.abs(s - cut.at) < 0.06 : cut.edge === 'out' ? Math.abs(s + len - cut.at) < 0.06 : Math.abs(s + len / 2 - cut.at) < 0.06;
    if (hit) return c;
  }
  return null;
}

/** The cut a transition layer sits on now (its clip may have moved since). */
export function cutOfLayer(film: Film | null, layer: FrameLayer): Cut | null {
  if (layer.clipId && layer.side) { const c = cutFor(film, layer.clipId, layer.side); if (c) return c; }
  return findCuts(film).find((c) => Math.abs(c.at - (layer.cutAt ?? -1)) < 0.06) ?? null;
}

/** Ops that put transition `id` on `cut` (a new clip on the Transitions line), with its layer written first. */
export async function addTransition(projectId: string, film: Film | null, cut: Cut, id: string, params: Record<string, unknown> = {}, anchor?: { clipId: string; side: 'start' | 'end' }) {
  const def = transitionById(id)!;
  const d = round(Math.min(def.defaultDuration, maxDuration(cut)));
  const layer = makeLayer('shape', {
    id: `layer-tr-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'transition', name: def.name,
    effect: id, duration: d, cutAt: cut.at, ...(anchor ?? {}), params: { easing: 'smooth', ...def.defaults, ...params }, seed: Math.floor(Math.random() * 1e6), fps: 40, ...footage(cut, d),
  } as never);
  await writeLayer(projectId, layer);
  const clip = { src: `frame/${layer.id}.html`, id: layer.id, time: [0, d] as [number, number] };
  const from = startOf(cut, d);
  /* the Transitions line right above this Video line, else a new one there */
  const tracks = film?.tracks ?? [];
  const lineIdx = tracks.findIndex((tr, i) => i < cut.track && tr.clips.length > 0 && tr.clips.every((c) => lineOf(c.src) === 'transition')
    && spans(tr.clips).every(({ start, end }) => end != null && (from + d <= start + 1e-3 || from >= end - 1e-3)));
  const op: Op = lineIdx >= 0 ? { op: 'insert', clip, at: round(from), track: lineIdx } as Op : { op: 'insert', clip, at: round(from), newTrack: cut.track } as Op;
  return { op, layer, opened: lineIdx < 0 };
}

/** Ops and layer for a transition whose length changed (it keeps its place on the cut or edge). */
export function resized(layer: FrameLayer, clipId: string, cut: Cut | null, d: number): { layer: FrameLayer; ops: Op[] } {
  const len = round(cut ? Math.min(Math.max(0.1, d), maxDuration(cut)) : Math.max(0.1, d));
  const next: FrameLayer = { ...layer, duration: len, ...(cut ? footage(cut, len) : {}) };
  const at = round(startOf({ at: cut?.at ?? layer.cutAt ?? 0, edge: cut?.edge ?? layer.edge ?? 'cut' }, len));
  return { layer: next, ops: [{ op: 'set', clip: clipId, field: 'time', value: [0, len] } as Op, { op: 'set', clip: clipId, field: 'at', value: at } as Op] };
}
