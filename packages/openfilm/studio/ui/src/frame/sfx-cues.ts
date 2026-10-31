import type { Film, Op } from '@/api';
import { searchSfx } from './lib/sfxLibrary.js';
import { durationOf, importSound, type Sound } from './audio';
import { placeClip } from './lines';

/* Sounds for transitions and motion graphics, from the Sound FX library (all made by Shorts): asked for, never placed
   on their own. Each lands as an ordinary sound clip on an Audio line, so it is trimmed, moved or removed like any. */
const CUE: Record<string, string> = { whoosh: 'whoosh', swoosh: 'swoosh', pop: 'pop', click: 'mouse-click', impact: 'impact-hit', rise: 'riser', shutter: 'camera-shutter', sweep: 'transition-sweep' };

export function cueSound(cue: string): Sound | null {
  const id = CUE[cue] ?? cue;
  const hit = (searchSfx(id, { limit: 5 }) as Sound[]).find((s) => s.id === id) ?? (searchSfx(cue, { limit: 1 }) as Sound[])[0];
  return hit ?? null;
}

/** Puts the cue's sound at `at` seconds; returns an error message, or null when it was added. */
export async function addSfxNear(projectId: string, film: Film | null, cue: string, at: number, edit: (ops: Op[], label: string) => Promise<string | null>) {
  const s = cueSound(cue);
  if (!s) return `No ${cue} sound in the library.`;
  const path = await importSound(projectId, s);
  const len = Math.max(0.1, durationOf(s));
  const placed = placeClip(film, { src: path, id: `snd-${Date.now().toString(36)}`, time: [0, Math.round(len * 1000) / 1000] }, Math.max(0, at), len, 'audio');
  return edit([placed.op], `Add ${s.name}`);
}
