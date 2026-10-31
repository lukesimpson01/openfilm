import React from 'react';
import type { Film } from '@/api';
import type { TimelineTrack } from '@/lib/timeline-layout';
import { isFrameSrc, layerIdOf, livePreview, readLayer, writeLayer, type FrameLayer } from './layers';
import { spatialTimes, retimeSpatial } from './spatial-keys.js';

/* Keyframes on the timeline: each element's keys as a line of diamonds along the bottom of its clip, kept up to date
   as the inspector edits them (the 'frame-layer-live' event) and as pages are written ('frame-layer'). */
type Cue = { start: number; duration: number; text: string };

const timesOf = (l: FrameLayer | null): number[] => {
  if (!l) return [];
  const items = l.layers ? (l.layers as FrameLayer[]) : [l];
  const out = new Set<number>();
  for (const it of items) for (const frames of Object.values(it.keyframes ?? {})) for (const f of frames) out.add(Math.round(((it.start || 0) + f.time) * 1000));
  for(const it of items)for(const ms of spatialTimes(it))out.add(ms+Math.round((it.start||0)*1000));
  return [...out].sort((a, b) => a - b);
};

export function useKeyframeTimes(film: Film | null, folder: string) {
  const [map, setMap] = React.useState<Record<string, number[]>>({});
  const [names, setNames] = React.useState<Record<string, string>>({});
  const [cues, setCues] = React.useState<Record<string, Cue[]>>({});
  /* each layer clip's in-point (`#t=in`): its page shows from there, so its keys sit that much earlier on the clip */
  const offsets = React.useMemo(() => {
    const out: Record<string, number> = {};
    for (const tr of film?.tracks ?? []) for (const c of tr.clips) if (isFrameSrc(c.src)) out[c.id] = Math.round((c.time?.[0] ?? 0) * 1000);
    return out;
  }, [film]);
  const ids = React.useMemo(() => [...new Set((film?.tracks ?? []).flatMap((t) => t.clips).filter((c) => isFrameSrc(c.src)).map((c) => layerIdOf(c.src)))], [film]);
  const key = ids.join(',');
  const take = React.useCallback((id: string, l: FrameLayer | null) => {
    if (!l) return;
    setMap((m) => ({ ...m, [id]: /^layer-story-/.test(id) ? [] : timesOf(l) }));
    if (l.name) setNames((n) => (n[id] === l.name ? n : { ...n, [id]: l.name }));
    if (l.kind === 'subtitle') setCues((m) => ({ ...m, [id]: ((l.cues ?? []) as Cue[]).map((c) => ({ start: c.start, duration: c.duration, text: c.text })) }));
  }, []);
  React.useEffect(() => {
    let live = true;
    void Promise.all(ids.map(async (id) => [id, await readLayer(folder, id)] as const)).then((pairs) => { if (live) pairs.forEach(([id, l]) => take(id, l)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, folder]);
  React.useEffect(() => {
    const onLive = (e: Event) => { const l = (e as CustomEvent<FrameLayer>).detail; if (l?.id) take(l.id, l); };
    const onWritten = (e: Event) => { const id = (e as CustomEvent<string>).detail; void readLayer(folder, id).then((l) => take(id, l)); };
    window.addEventListener('frame-layer-live', onLive); window.addEventListener('frame-layer', onWritten);
    return () => { window.removeEventListener('frame-layer-live', onLive); window.removeEventListener('frame-layer', onWritten); };
  }, [folder, take]);
  return { map, names, cues, offsets };
}

/* the diamond picked on the timeline (one at a time): Delete removes its keys, Escape lets go */
let picked: { layer: string; ms: number } | null = null;
const pickers = new Set<() => void>();
const setPicked = (v: typeof picked) => { picked = v; pickers.forEach((f) => f()); };
const usePicked = () => React.useSyncExternalStore((f) => { pickers.add(f); return () => { pickers.delete(f); }; }, () => picked);

/** Every key of the layer at `fromMs` (ms into the clip) moved to `toMs`, or removed (`toMs` null). */
export async function editKeys(projectId: string, folder: string, id: string, fromMs: number, toMs: number | null) {
  const l = await readLayer(folder, id);
  if (!l) return;
  const items = l.layers ? (l.layers as FrameLayer[]) : [l];
  for (const it of items) {
    const start = it.start || 0;
    const next: Record<string, FrameLayer['keyframes'][string]> = {};
    for (const [prop, frames] of Object.entries(it.keyframes ?? {})) {
      const at = (f: { time: number }) => Math.round((start + f.time) * 1000);
      const moving = frames.filter((f) => Math.abs(at(f) - fromMs) <= 1);
      if (!moving.length) { next[prop] = frames; continue; }
      const rest = frames.filter((f) => Math.abs(at(f) - fromMs) > 1);
      if (toMs == null) { if (rest.length) next[prop] = rest; continue; }
      const time = Math.max(0, Math.min(it.duration || 5, toMs / 1000 - start));
      /* a key already where it lands is replaced, as After Effects does */
      next[prop] = [...rest.filter((f) => Math.abs(f.time - time) > 0.0005), ...moving.map((f) => ({ ...f, time }))].sort((a, b) => a.time - b.time);
    }
    it.keyframes = next;
    Object.assign(it,retimeSpatial(it,fromMs/1000-start,toMs==null?null:toMs/1000-start));
  }
  livePreview(l);
  await writeLayer(projectId, l);
}

/** Delete / Backspace removes the picked diamond's keys (before the timeline would delete the clip). */
export function useKeyLaneKeys(projectId: string, folder: string) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!picked) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === 'Escape') { setPicked(null); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      e.preventDefault(); e.stopPropagation();
      const { layer, ms } = picked; setPicked(null);
      void editKeys(projectId, folder, layer, ms, null);
    };
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-key-diamond]')) setPicked(null); };
    window.addEventListener('keydown', onKey, true); window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [projectId, folder]);
}

function Diamond({ layer, ms, offset=0,pxPerMs, width, onSeek, onMove }: { layer: string; ms: number;offset?:number; pxPerMs: number; width: number; onSeek: () => void; onMove: (toMs: number) => void }) {
  const sel = usePicked();
  const on = sel?.layer === layer && sel.ms === ms+offset;
  const [drag, setDrag] = React.useState<number | null>(null);
  const shown = drag ?? ms;
  const left = Math.min(width - 5, Math.max(5, Math.round(shown * pxPerMs)));
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation(); e.preventDefault();
    const x0 = e.clientX, el = e.currentTarget; el.setPointerCapture(e.pointerId);
    let moved = false, to = ms;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      /* frames of 1/30 s, inside the clip */
      to = Math.max(0, Math.min(width / pxPerMs, Math.round((ms + dx / pxPerMs) / (1000 / 30)) * (1000 / 30)));
      setDrag(Math.round(to));
    };
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      if (moved && Math.round(to) !== ms) { onMove(Math.round(to)); setPicked({ layer, ms: Math.round(to)+offset }); setTimeout(() => setDrag(null), 400); }
      else { setDrag(null); setPicked({ layer, ms:ms+offset }); onSeek(); }
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  return (
    <button type="button" data-key-diamond="" aria-label={`Keyframe at ${(shown / 1000).toFixed(2)} s`} title={`${(shown / 1000).toFixed(2)} s · drag to move · Delete removes`}
      onPointerDown={down} onClick={(e) => e.stopPropagation()}
      className={`pointer-events-auto absolute top-1/2 h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize rounded-[1.5px] transition-[transform,box-shadow,background] duration-150 hover:scale-[1.3] ${on ? 'scale-[1.3] bg-white shadow-[0_0_0_1.5px_var(--accent),0_0_0_4px_color-mix(in_srgb,var(--accent)_30%,transparent)]' : 'bg-[var(--accent)] shadow-[0_0_0_1px_var(--bg)]'}`}
      style={{ left }}>
      {drag != null ? <span className="pointer-events-none absolute -top-[22px] left-1/2 -translate-x-1/2 -rotate-45 whitespace-nowrap rounded bg-black/80 px-1 py-[1px] text-[9px] tabular-nums text-white">{(drag / 1000).toFixed(2)}s</span> : null}
    </button>
  );
}

/** The timeline's per-row overlay: a keyframe line inside each animated element's clip. A diamond seeks when clicked
    (and is picked: Delete removes it), and drags along the clip to retime its keys. */
export function keyframeOverlay(map: Record<string, number[]>, onSeek: (ms: number) => void, onMove: (layer: string, fromMs: number, toMs: number) => void, offsets: Record<string, number> = {}) {
  return (track: TimelineTrack, pxPerMs: number): React.ReactNode => {
    const rows = track.blocks.filter((b) => b.src && isFrameSrc(b.src) && map[layerIdOf(b.src)]?.length);
    if (!rows.length) return null;
    return rows.map((b) => {
      const id = layerIdOf(b.src!), times = map[id], off = offsets[b.clipId??b.id] ?? 0, left = Math.round(b.startMs * pxPerMs), width = Math.max(4, Math.round((b.endMs - b.startMs) * pxPerMs));
      return (
        <div key={b.id} data-key-lane="" className="pointer-events-none absolute bottom-[2px] z-[11] h-[12px] rounded-b-[3px]" style={{ left, width, background: 'color-mix(in srgb, var(--bg) 70%, transparent)' }}>
          {times.map((ms) => ms - off).filter((ms) => ms >= -1 && ms <= b.endMs - b.startMs + 1).map((ms) => (
            <Diamond key={ms} layer={id} ms={ms} offset={off} pxPerMs={pxPerMs} width={width} onSeek={() => onSeek(b.startMs + ms)} onMove={(to) => onMove(id, ms + off, to + off)} />
          ))}
        </div>
      );
    });
  };
}

/** A subtitle clip says its lines along it, each where it is spoken (as a video clip shows its frames). */
export function subtitleOverlay(cues: Record<string, Cue[]>) {
  return (track: TimelineTrack, pxPerMs: number): React.ReactNode => {
    const rows = track.blocks.filter((b) => b.src && /^frame\/layer-sub-/.test(b.src) && cues[layerIdOf(b.src)]?.length);
    if (!rows.length) return null;
    return rows.map((b) => {
      const list = cues[layerIdOf(b.src!)], left = Math.round(b.startMs * pxPerMs), width = Math.max(4, Math.round((b.endMs - b.startMs) * pxPerMs));
      return (
        <div key={b.id} data-sub-lane="" className="pointer-events-none absolute bottom-[1px] z-[3] overflow-hidden rounded-b-[4px]" style={{ left: left + 1, width: width - 2, top: 15, background: 'var(--tl-scene)' }}>
          {list.map((c, i) => {
            const x = Math.round(c.start * 1000 * pxPerMs), w = Math.max(2, Math.round(c.duration * 1000 * pxPerMs) - 2);
            return (
              <span key={i} className="absolute inset-y-[2px] flex items-center overflow-hidden rounded-[3px] bg-white/[0.16] px-1.5 text-[10.5px] font-medium leading-tight text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" style={{ left: x, width: w }}>
                <span className="truncate">{c.text}</span>
              </span>
            );
          })}
        </div>
      );
    });
  };
}
