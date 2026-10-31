import React from 'react';
import { curveAt } from './transition-gl.js';

/* The speed graph of one placed transition or zoom: progress (up) over its time (across), like a volume line on a sound
   clip. Drag a point to retime the move; double-click the line to add a point, double-click a point to remove it.
   A flat stretch holds the motion still, a steep one runs it fast. It is saved on that one clip only. */
export type Curve = [number, number][];
export const LINEAR: Curve = [[0, 0], [1, 1]];
export const CURVE_PRESETS: { name: string; curve: Curve }[] = [
  { name: 'Even', curve: LINEAR },
  { name: 'Ease', curve: [[0, 0], [0.25, 0.08], [0.75, 0.92], [1, 1]] },
  { name: 'Fast start', curve: [[0, 0], [0.25, 0.6], [1, 1]] },
  { name: 'Fast end', curve: [[0, 0], [0.75, 0.4], [1, 1]] },
  { name: 'Slow middle', curve: [[0, 0], [0.3, 0.42], [0.7, 0.58], [1, 1]] },
  { name: 'Hold middle', curve: [[0, 0], [0.35, 0.5], [0.65, 0.5], [1, 1]] },
];
const W = 280, H = 120, PAD = 10;

export function SpeedGraph({ value, onChange }: { value: Curve | null | undefined; onChange: (c: Curve | null) => void }) {
  const pts: Curve = value && value.length > 1 ? value : LINEAR;
  const ref = React.useRef<SVGSVGElement>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const toXY = ([x, y]: [number, number]) => [PAD + x * (W - 2 * PAD), H - PAD - y * (H - 2 * PAD)] as const;
  const fromEvent = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width * W - PAD) / (W - 2 * PAD), y = (H - PAD - (e.clientY - r.top) / r.height * H) / (H - 2 * PAD);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const path = React.useMemo(() => {
    let d = '';
    for (let i = 0; i <= 80; i++) { const x = i / 80; const [px, py] = toXY([x, curveAt(pts, x)]); d += `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`; }
    return d;
  }, [pts]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (e: React.PointerEvent) => {
    if (drag == null) return;
    const [x, y] = fromEvent(e);
    const next = pts.map((p) => [...p] as [number, number]);
    const last = next.length - 1;
    /* the ends stay at the start and the end of the time; inner points stay between their neighbours */
    next[drag] = drag === 0 ? [0, y] : drag === last ? [1, y] : [Math.min(next[drag + 1][0] - 0.02, Math.max(next[drag - 1][0] + 0.02, x)), y];
    onChange(next);
  };
  const addAt = (e: React.MouseEvent) => {
    const [x] = fromEvent(e);
    if (x <= 0.02 || x >= 0.98) return;
    const next = [...pts, [x, curveAt(pts, x)] as [number, number]].sort((a, b) => a[0] - b[0]);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none rounded-lg border border-[var(--border)] bg-[var(--bg)]"
        onPointerMove={move} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)} onDoubleClick={addAt} aria-label="Speed graph">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={PAD + g * (W - 2 * PAD)} x2={PAD + g * (W - 2 * PAD)} y1={PAD} y2={H - PAD} stroke="var(--border-soft)" strokeWidth={1} />)}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="var(--border)" strokeDasharray="3 4" strokeWidth={1} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
        {pts.map((p, i) => {
          const [cx, cy] = toXY(p);
          return (
            <circle key={i} cx={cx} cy={cy} r={drag === i ? 6 : 5} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} className="cursor-grab"
              onPointerDown={(e) => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); }}
              onDoubleClick={(e) => { e.stopPropagation(); if (i > 0 && i < pts.length - 1) onChange(pts.filter((_, j) => j !== i)); }} />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-1">
        {CURVE_PRESETS.map((c) => (
          <button key={c.name} type="button" onClick={() => onChange(c.name === 'Even' ? null : c.curve)}
            className="h-6 rounded-full border border-[var(--border)] px-2 text-[10.5px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">{c.name}</button>
        ))}
      </div>
      <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">Drag a point to slow down, speed up or hold the move. Double-click the line to add a point. Only this clip changes.</p>
    </div>
  );
}
