import React from 'react';
import { Blend } from 'lucide-react';
import type { Film } from '@/api';
import type { TimelineTrack } from '@/lib/timeline-layout';
import { lineOf, spans } from './lines';

/* Where a transition is, said on the Video line itself: a small chip along the top of the clips it joins (or the clip
   it fades in or out), over the span it plays. Clicking the chip selects the transition. */
type Mark = { id: string; startMs: number; endMs: number };

/** Each Video line's transitions, by film track index (a transition's line sits just above its Video line). */
export function transitionMarks(film: Film | null): Map<number, Mark[]> {
  const out = new Map<number, Mark[]>();
  const tracks = film?.tracks ?? [];
  tracks.forEach((tr, ti) => {
    if (!tr.clips.length || !tr.clips.every((c) => lineOf(c.src) === 'transition')) return;
    const below = tracks.findIndex((t, i) => i > ti && t.clips.some((c) => lineOf(c.src) === 'media'));
    if (below < 0) return;
    spans(tr.clips).forEach(({ start, end }, i) => {
      if (end == null) return;
      const list = out.get(below) ?? [];
      list.push({ id: tr.clips[i].id!, startMs: start * 1000, endMs: end * 1000 });
      out.set(below, list);
    });
  });
  return out;
}

export function transitionOverlay(marks: Map<number, Mark[]>, names: Record<string, string>, onSelect: (id: string) => void) {
  return (track: TimelineTrack, pxPerMs: number): React.ReactNode => {
    const list = track.docIndex != null && track.index === 1 ? marks.get(track.docIndex) : undefined;
    if (!list?.length) return null;
    return list.map((m) => {
      const left = Math.round(m.startMs * pxPerMs), width = Math.max(18, Math.round((m.endMs - m.startMs) * pxPerMs));
      const name = names[m.id] ?? 'Transition';
      /* the join between two clips: a capsule over the cut, the length the transition plays; its name on hover */
      return (
        <button key={m.id} type="button" data-transition-mark="" aria-label={`${name} transition — click to edit`}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onSelect(m.id); }}
          className="group/tr absolute top-1/2 z-[11] flex h-[22px] -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-white text-[var(--tl-accent)] shadow-[0_2px_8px_rgba(15,23,42,0.28)] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:scale-[1.08] hover:shadow-[0_4px_14px_rgba(15,23,42,0.32)]"
          style={{ left, width }}>
          <Blend size={12} strokeWidth={2.2} />
          <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-[#111827] px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-[opacity,transform] duration-150 group-hover/tr:translate-y-0 group-hover/tr:opacity-100">{name}</span>
        </button>
      );
    });
  };
}
