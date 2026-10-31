import type { Film, Op } from '@/api';
import { graphicById, BRAND_KITS } from './motion-graphics.js';
import worldData from './geo/world.json';
import { decodeWorld } from './motion-graphics.js';
import { makeLayer, round, writeLayer, framePath, type FrameLayer } from './layers';
import { placeClip } from './lines';

/* Motion graphics on the timeline: each is a page clip (frame/layer-mg-….html) on a Motion graphics line, holding the
   graphic's id and its params; its page draws it with the shared renderer (motion-graphics.js). */
export const world = () => decodeWorld(worldData);

const store = (key: string) => ({
  get: <T,>(fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; } },
  set: (v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private window */ } },
});
export const recentStore = store('shorts.mg.recent');
export const favStore = store('shorts.mg.favourites');
export const presetStore = store('shorts.mg.presets');
export const brandStore = store('shorts.mg.brand');
export type SavedPreset = { id: string; name: string; graphic: string; params: Record<string, unknown>; duration: number };

export function brandParams(): Record<string, unknown> {
  const kit = brandStore.get<string | null>(null);
  return kit && (BRAND_KITS as Record<string, Record<string, unknown>>)[kit] ? { ...(BRAND_KITS as Record<string, Record<string, unknown>>)[kit] } : {};
}

/** Writes the graphic's page and returns the insert that puts it at `at` (and the line it opened, if any). */
export async function addGraphic(projectId: string, film: Film | null, graphic: string, at: number, over: { params?: Record<string, unknown>; duration?: number; name?: string } = {}) {
  const def = graphicById(graphic);
  if (!def) throw new Error(`No motion graphic ${graphic}`);
  const duration = round(over.duration ?? def.duration);
  const layer: FrameLayer = makeLayer('shape', {
    id: `layer-mg-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind: 'mg' as never, name: over.name ?? def.name,
    graphic, duration, params: { ...def.defaults, ...brandParams(), ...(over.params ?? {}) },
  } as never);
  await writeLayer(projectId, layer);
  const placed = placeClip(film, { src: framePath(layer.id), id: layer.id, time: [0, duration] }, at, duration, 'graphics');
  const recent = recentStore.get<string[]>([]).filter((x) => x !== graphic);
  recentStore.set([graphic, ...recent].slice(0, 8));
  return { op: placed.op as Op, opened: placed.opened, layer };
}
