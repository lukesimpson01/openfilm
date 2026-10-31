import React from 'react';
import { Play, Trash2, Crosshair } from 'lucide-react';
import type { Film, Op } from '@/api';
import { EASINGS, EASING_NAMES } from './transitions-catalog.js';
import { SpeedGraph, type Curve } from './SpeedGraph';
import { footageAt, footageFor } from './zoom';
import { spans } from './lines';
import { round, type FrameLayer } from './layers';
import { T, seg, segWrap } from './ui';

/* A Zoom's settings: how close (its size), where to (click the frame), how long it takes to go in and to come back
   out (or stay), its easing or its own speed graph, and its motion blur. Changes show on the video at once. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
const slider = 'h-1 flex-1 cursor-pointer accent-[var(--accent)]';

export function ZoomInspector({ layer, clipId, film, folder, commit, edit }: {
  layer: FrameLayer; clipId?: string; film: Film | null; folder: string;
  commit: (l: FrameLayer, delay?: number) => void; edit: (ops: Op[], label: string) => Promise<string | null>;
}) {
  const p = { ...(layer.params ?? {}) } as Record<string, any>;
  const set = (patch: Record<string, unknown>) => commit({ ...layer, params: { ...p, ...patch } }, 120);
  const d = layer.duration || 2.5;
  const center: [number, number] = p.center ?? [0.5, 0.5];
  const stay = (p.zoomOut ?? 0) <= 0.001;

  /* where this zoom sits now, and the clip under it: its footage follows the clip if either was moved */
  const span = React.useMemo(() => {
    for (const tr of film?.tracks ?? []) { const sp = spans(tr.clips); const i = tr.clips.findIndex((c) => c.id === clipId); if (i >= 0) return sp[i]; }
    return null;
  }, [film, clipId]);
  React.useEffect(() => {
    if (!span) return;
    const f = footageAt(film, span.start + 0.01, layer.clipId) ?? footageAt(film, span.start + 0.01);
    if (!f) return;
    const next = footageFor(f, span.start);
    if (next.aSrc !== layer.aSrc || Math.abs(next.aAt - (layer.aAt ?? 0)) > 0.002 || next.aSpeed !== layer.aSpeed) commit({ ...layer, ...next }, 50);
  }, [span?.start, film]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the frame the zoom starts on, to click the point it zooms into */
  const canvas = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const src = layer.aSrc ? `${folder}${String(layer.aSrc).split('#')[0]}` : null;
    const c = canvas.current; if (!src || !c) return;
    const g = c.getContext('2d')!;
    const draw = (el: HTMLVideoElement | HTMLImageElement, w: number, h: number) => {
      const r = Math.max(c.width / w, c.height / h); const dw = w * r, dh = h * r;
      g.clearRect(0, 0, c.width, c.height); g.drawImage(el, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    };
    if (/\.(mp4|mov|webm|m4v|mkv)$/i.test(src)) {
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
      v.addEventListener('loadeddata', () => { v.currentTime = Math.max(0, layer.aAt ?? 0); }, { once: true });
      v.addEventListener('seeked', () => draw(v, v.videoWidth, v.videoHeight), { once: true });
    } else { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => draw(i, i.naturalWidth, i.naturalHeight); i.src = src; }
  }, [layer.aSrc, layer.aAt, folder]);
  const pick = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set({ center: [round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))), round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)))] });
  };
  const setLength = (len: number) => { if (clipId) { commit({ ...layer, duration: round(len) }, 100); void edit([{ op: 'set', clip: clipId, field: 'time', value: [0, round(len)] } as Op], 'Zoom length'); } };
  /* the in and out times as seconds (stored as shares of the length, so a longer zoom keeps its shape) */
  const inS = (p.zoomIn ?? 0.3) * d, outS = (p.zoomOut ?? 0.3) * d;
  const aspect = 9 / 16;

  return (
    <div className="flex flex-col gap-3 pt-2">
      <p className="-mt-1 text-[11px] leading-snug text-[var(--text-muted)]">Zooms into one point of this clip. Click the frame to choose the point: it glides to the centre as the zoom grows.</p>
      <div className="relative mx-auto w-[150px] cursor-crosshair overflow-hidden rounded-lg border border-[var(--border)] bg-black" style={{ aspectRatio: String(aspect) }} onPointerDown={pick}>
        <canvas ref={canvas} width={300} height={534} className="block h-full w-full" />
        {/* the area that ends up on screen at full zoom */}
        <span className="pointer-events-none absolute rounded-[3px] border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={{ width: `${100 / (p.scale ?? 2)}%`, height: `${100 / (p.scale ?? 2)}%`,
            left: `${Math.min(1 - 0.5 / (p.scale ?? 2), Math.max(0.5 / (p.scale ?? 2), center[0])) * 100}%`, top: `${Math.min(1 - 0.5 / (p.scale ?? 2), Math.max(0.5 / (p.scale ?? 2), center[1])) * 100}%`, transform: 'translate(-50%, -50%)' }} />
        <Crosshair size={16} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" style={{ left: `${center[0] * 100}%`, top: `${center[1] * 100}%` }} />
      </div>

      <Slide label="Zoom" value={p.scale ?? 2} min={1.1} max={4} step={0.05} unit="×" onChange={(v) => set({ scale: v })} />
      <Slide label="Length" value={d} min={0.4} max={Math.max(0.5, span ? 30 : 10)} step={0.1} unit="s" onChange={setLength} />
      <Slide label="Zoom in" value={inS} min={0.05} max={Math.max(0.1, d - (stay ? 0 : outS) - 0.05)} step={0.05} unit="s" onChange={(v) => set({ zoomIn: Math.min(0.95, v / d) })} />
      <div className={row}><span className="w-[72px]">Then</span>
        <div className={`${segWrap} flex-1`}>
          <button type="button" className={seg(!stay)} onClick={() => set({ zoomOut: Math.min(0.4, Math.max(0.1, 1 - (p.zoomIn ?? 0.3) - 0.1)) })}>Zoom back out</button>
          <button type="button" className={seg(stay)} onClick={() => set({ zoomOut: 0 })}>Stay zoomed</button>
        </div>
      </div>
      {!stay ? <Slide label="Zoom out" value={outS} min={0.05} max={Math.max(0.1, d - inS - 0.05)} step={0.05} unit="s" onChange={(v) => set({ zoomOut: Math.min(0.95, v / d) })} /> : null}
      <label className={row}><span className="w-[72px]">Easing</span>
        <select value={Array.isArray(p.curve) ? 'graph' : p.easing ?? 'smooth'} onChange={(e) => set({ easing: e.target.value, curve: null })} className={`${T.small} flex-1`}>
          {Array.isArray(p.curve) ? <option value="graph">Custom speed graph</option> : null}
          {EASINGS.map((k: string) => <option key={k} value={k}>{(EASING_NAMES as Record<string, string>)[k]}</option>)}
        </select>
      </label>
      <Slide label="Motion blur" value={p.motionBlur ?? 0.4} min={0} max={1} step={0.01} onChange={(v) => set({ motionBlur: v })} />
      <details className="rounded-lg border border-[var(--border-soft)] px-2 py-1.5" open={Array.isArray(p.curve)}>
        <summary className="cursor-pointer text-[12px] font-medium text-[var(--text)]">Speed graph</summary>
        <div className="pt-2"><SpeedGraph value={p.curve as Curve | null} onChange={(c) => set({ curve: c })} /></div>
      </details>
      <div className="grid grid-cols-2 gap-1.5 pt-1">
        <button type="button" className={T.secondary} onClick={() => window.dispatchEvent(new CustomEvent('frame-play-from', { detail: Math.max(0, ((span?.start ?? 0) - 0.4) * 1000) }))}><Play size={13} />Preview</button>
        <button type="button" className={T.secondary} onClick={() => { if (clipId) void edit([{ op: 'remove', clip: clipId } as Op], 'Remove zoom'); }}><Trash2 size={13} />Remove</button>
      </div>
    </div>
  );
}

function Slide({ label, value, onChange, min = 0, max = 1, step = 0.01, unit = '' }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  return (
    <label className={row}><span className="w-[72px]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} className={slider} />
      <span className="w-11 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{Number(value ?? 0).toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2)}{unit}</span>
    </label>
  );
}
