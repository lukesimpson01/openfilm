import React from 'react';
import { Crosshair } from 'lucide-react';
import { round, type FrameLayer } from './layers';
import { EFFECTS } from './transitions-catalog.js';
import { SpeedGraph, type Curve } from './SpeedGraph';
import { StageOverlay } from './StageOverlay';
import { T, seg, segWrap } from './ui';
import { RippleControls } from './RippleControls';

/* A one-clip Creator effect's settings (Velocity Edit, Beat Shake, Flash Impact, Glitch Snap, Light Leak, Camera Roll,
   Split-Frame Freeze): its own controls only, the beat point as a time, a point picked on the picture, and — for the
   velocity edit — its speed graph. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
function Slide({ label, value, min = 0, max = 1, step = 0.01, onChange, fmt }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return <label className={row}><span className="w-[84px] shrink-0">{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" aria-label={label} /><span className="w-11 text-right tabular-nums text-[var(--text)]">{fmt ? fmt(value) : round(value)}</span></label>;
}

export function EffectInspector({ layer, commit }: { layer: FrameLayer; commit: (l: FrameLayer, delay?: number) => void }) {
  const def = (EFFECTS as { id: string; name: string; about: string; params: string[]; directions: string[] | null; defaults: Record<string, unknown> }[]).find((x) => x.id === layer.effect);
  const [picking, setPicking] = React.useState(false);
  if (!def) return <p className={T.hint}>Unknown effect.</p>;
  const p = { ...def.defaults, ...(layer.params ?? {}) } as Record<string, any>;
  const has = (k: string) => def.params.includes(k);
  const set = (patch: Record<string, unknown>) => commit({ ...layer, params: { ...(layer.params ?? {}), ...patch } }, 80);
  const L = layer.duration;
  return (
    <div className="flex flex-col gap-2.5 pt-2">
      <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{def.about}</p>
      {has('split') ? <Slide label="Beat at" value={p.split ?? 0.2} max={0.95} onChange={(v) => set({ split: v })} fmt={(v) => `${round(v * L)}s`} /> : null}
      {layer.effect === 'fx.ripple' ? <RippleControls params={p} saved={layer.params ?? {}} set={set} /> : null}
      {has('intensity') && layer.effect !== 'fx.ripple' ? <Slide label={layer.effect === 'fx.velocity' ? 'Speed swing' : 'Intensity'} value={p.intensity ?? 0.7} max={layer.effect === 'fx.velocity' ? 0.95 : 1} onChange={(v) => set({ intensity: v })} /> : null}
      {has('glow') && layer.effect !== 'fx.ripple' ? <Slide label="Colour split" value={p.glow ?? 0.3} onChange={(v) => set({ glow: v })} /> : null}
      {has('angle') ? <Slide label="Turn" value={p.angle ?? 12} min={0} max={90} step={1} onChange={(v) => set({ angle: v })} fmt={(v) => `${v}°`} /> : null}
      {has('zoomIn') ? <Slide label="Turn in" value={p.zoomIn ?? 0.4} onChange={(v) => set({ zoomIn: v })} fmt={(v) => `${round(v * L)}s`} /> : null}
      {has('zoomOut') ? <Slide label="Turn back" value={p.zoomOut ?? 0.4} onChange={(v) => set({ zoomOut: v })} fmt={(v) => (v < 0.01 ? 'stays' : `${round(v * L)}s`)} /> : null}
      {has('strips') ? <Slide label="Panels" value={p.strips ?? 4} min={2} max={8} step={1} onChange={(v) => set({ strips: v })} /> : null}
      {has('amount') ? <Slide label="Slide apart" value={p.amount ?? 0.6} onChange={(v) => set({ amount: v })} /> : null}
      {has('color') ? <label className={`${row} justify-between`}>Gap colour <input type="color" value={p.color ?? '#000000'} onChange={(e) => set({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" /></label> : null}
      {has('direction') && def.directions ? <div className={row}><span className="w-[84px] shrink-0">Direction</span><div className={`${segWrap} flex-1`}>{def.directions.map((d) => <button key={d} type="button" className={seg(p.direction === d)} onClick={() => set({ direction: d })}>{d}</button>)}</div></div> : null}
      {has('center') ? (
        <>
          <button type="button" className={T.secondary} onClick={() => setPicking((v) => !v)}><Crosshair size={13} />{picking ? 'Click the point on the picture…' : `Point: ${round(p.center?.[0] ?? 0.5)}, ${round(p.center?.[1] ?? 0.5)} — click to change`}</button>
          <StageOverlay pick={picking} hint="Click the point" onPick={(x, y) => { setPicking(false); set({ center: [round(x), round(y)] }); }} target={picking ? null : { x: p.center?.[0] ?? 0.5, y: p.center?.[1] ?? 0.5, zoom: 4 }} />
        </>
      ) : null}
      {layer.effect === 'fx.velocity' ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-[var(--text-muted)]">Speed graph (optional: replaces the swing)</span>
          <SpeedGraph value={p.curve as Curve | null} onChange={(c) => set({ curve: c })} />
          <p className={T.hint}>Slow parts repeat source frames (no frames are invented). The clip continues exactly where it would have at the end.</p>
        </div>
      ) : null}
    </div>
  );
}
