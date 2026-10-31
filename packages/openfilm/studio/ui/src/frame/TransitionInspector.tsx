import React from 'react';

import { Play, Copy, Trash2, Diamond } from 'lucide-react';
import type { Film, Op } from '@/api';
import { TRANSITIONS, transitionById, EASINGS, EASING_NAMES, TRANSITION_STYLES } from './transitions-catalog.js';
import { SpeedGraph, type Curve } from './SpeedGraph';
import { addSfxNear } from './sfx-cues';
import { findCuts, maxDuration, resized, transitionOn, addTransition, cutOfLayer, startOf, type Cut } from './transitions';
import { readLayer, writeLayer, layerIdOf, type FrameLayer } from './layers';
import { T, seg, segWrap } from './ui';

/* A transition's settings: its length (centered on the cut, at most the shorter clip), easing, and only the controls
   this transition has. Changes show on the video at once (the page redraws with the new settings). */
type Def = { id: string; name: string; premium: boolean; params: string[]; directions: string[] | null; defaults: Record<string, any>; about?: string; sfx?: string | null; styles?: string[] | null };
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
const slider = 'h-1 flex-1 cursor-pointer accent-[var(--accent)]';

export function TransitionInspector({ layer, clipId, film, folder, projectId, commit, edit, notify }: {
  layer: FrameLayer; clipId?: string; film: Film | null; folder: string; projectId: string;
  commit: (l: FrameLayer, delay?: number) => void; edit: (ops: Op[], label: string) => Promise<string | null>; notify?: (m: string) => void;
}) {
  const def = (transitionById(layer.effect) ?? TRANSITIONS[0]) as Def;
  const params = { ...def.defaults, ...(layer.params ?? {}) } as Record<string, any>;
  const cut: Cut | null = cutOfLayer(film, layer);
  const max = cut ? maxDuration(cut) : 5;
  const set = (patch: Record<string, unknown>) => commit({ ...layer, params: { ...params, ...patch } }, 150);
  const setDuration = (d: number) => {
    if (!clipId) return;
    const { layer: next, ops } = resized(layer, clipId, cut, d);
    commit(next, 200);
    void edit(ops, 'Transition length');
  };
  const preview = () => window.dispatchEvent(new CustomEvent('frame-play-from', { detail: Math.max(0, (startOf({ at: cut?.at ?? layer.cutAt ?? 0, edge: cut?.edge ?? layer.edge ?? 'cut' }, layer.duration) - 0.5) * 1000) }));
  const applyAll = async () => {
    let added = 0;
    for (const c of findCuts(film)) {
      const on = transitionOn(film, c);
      if (on) {
        const l = await readLayer(folder, layerIdOf(on.src));
        if (l && on.id !== clipId) await writeLayer(projectId, { ...l, effect: layer.effect, name: def.name, params: { ...params } } as FrameLayer);
      } else {
        const { op } = await addTransition(projectId, film, c, layer.effect, params);
        const fail = await edit([op], 'Apply transition to all'); if (!fail) added++;
      }
    }
    notify?.(`${def.name} is on every cut${added ? ` (${added} added)` : ''}.`);
  };
  const remove = () => { if (clipId) void edit([{ op: 'remove', clip: clipId } as Op], 'Remove transition'); };
  const has = (p: string) => def.params.includes(p);
  const shutter = has('amount') && has('line');
  const pierce = has('pierce');
  const vertical = def.id === 'classic.portrait_close';
  /* linked: the opening mirrors the closing (half the time each, after the hold); unlinked: the closing share is free */
  const linked = params.linked !== false;
  const addSound = async () => {
    if (!def.sfx) return;
    const at = startOf({ at: cut?.at ?? layer.cutAt ?? 0, edge: cut?.edge ?? layer.edge ?? 'cut' }, layer.duration);
    const fail = await addSfxNear(projectId, film, def.sfx, at, edit);
    notify?.(fail ?? 'Sound added under the transition — it is its own clip, so trim or remove it there.');
  };

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center gap-2">
        <select aria-label="Transition" value={def.id} onChange={(e) => commit({ ...layer, effect: e.target.value, name: transitionById(e.target.value)?.name ?? layer.name, params: { ...transitionById(e.target.value)?.defaults, easing: params.easing } }, 100)}
          className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[12.5px] font-medium outline-none focus:border-[var(--accent)]">
          {TRANSITIONS.map((t: Def) => <option key={t.id} value={t.id}>{t.name}{t.premium ? ' ◆' : ''}</option>)}
        </select>
        {def.premium ? <span className="flex items-center gap-1 text-[10.5px] text-[var(--accent)]"><Diamond size={10} fill="currentColor" />Premium</span> : null}
      </div>

      <label className={row}><span className="w-[72px]">Duration</span>
        <input type="range" min={0.1} max={max} step={0.1} value={Math.min(layer.duration, max)} onChange={(e) => setDuration(Number(e.target.value))} className={slider} />
        <SecondsField value={layer.duration} max={max} onCommit={setDuration} />
        <span className="text-[10.5px] text-[var(--text-faint)]">s</span>
      </label>
      <p className="-mt-2 pl-[80px] text-[10.5px] text-[var(--text-faint)]">Up to {max.toFixed(1)} s ({cut?.edge === 'cut' ? 'the shorter clip' : 'the clip'})</p>

      {def.about ? <p className="-mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{def.about}</p> : null}

      <label className={row}><span className="w-[72px]">Style</span>
        <select value={params.style ?? ''} onChange={(e) => { const st = (TRANSITION_STYLES as Record<string, Record<string, unknown>>)[e.target.value]; set({ style: e.target.value, ...(st ?? {}) }); }} className={`${T.small} flex-1`}>
          <option value="">Default</option>
          {Object.keys(TRANSITION_STYLES).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>

      <label className={row}><span className="w-[72px]">Easing</span>
        <select value={Array.isArray(params.curve) ? 'graph' : params.easing ?? 'smooth'} onChange={(e) => set({ easing: e.target.value, curve: null })} className={`${T.small} flex-1`}>
          {Array.isArray(params.curve) ? <option value="graph">Custom speed graph</option> : null}
          {EASINGS.map((k: string) => <option key={k} value={k}>{(EASING_NAMES as Record<string, string>)[k]}</option>)}
        </select>
      </label>

      {shutter ? (
        <>
          <div className={row}><span className="w-[72px]">Mode</span>
            <div className={`${segWrap} flex-1`}>
              {[['Fully close', { amount: 1, match: 0, split: 0.5, linked: true }], ['Partial', { amount: params.amount >= 1 ? 0.7 : params.amount, match: 0.14 }], ['Close & stay', { split: 1, hold: 0, linked: false }]].map(([label, patch]) => {
                const on = label === 'Fully close' ? params.amount >= 1 && params.split < 1 : label === 'Partial' ? params.amount < 1 && params.split < 1 : params.split >= 1;
                return <button key={label as string} type="button" className={seg(on)} onClick={() => set(patch as Record<string, unknown>)}>{label as string}</button>;
              })}
            </div>
          </div>
          <Slide label="Close amount" value={params.amount} min={0.05} max={1} step={0.01} onChange={(v) => set({ amount: v })} />
          <p className="-mt-2 pl-[80px] text-[10.5px] text-[var(--text-faint)]">{Math.round((params.amount ?? 1) * 100)}% covered · {Math.round((1 - (params.amount ?? 1)) * 100)}% stays visible as a strip</p>
          <Slide label={vertical ? 'Meet at X' : 'Meet at Y'} value={(vertical ? params.center?.[0] : params.center?.[1]) ?? 0.5} min={0.05} max={0.95}
            onChange={(v) => set({ center: vertical ? [v, params.center?.[1] ?? 0.5] : [params.center?.[0] ?? 0.5, v] })} />
          <Slide label="Hold closed" value={params.hold} max={0.6} step={0.01} onChange={(v) => set({ hold: v })} />
          <label className={row}><span className="w-[72px]">Link</span>
            <span className="flex-1 text-[11px] text-[var(--text-muted)]">Opening mirrors closing</span>
            <input type="checkbox" checked={linked} onChange={(e) => set(e.target.checked ? { linked: true, split: 0.5 } : { linked: false })} className="accent-[var(--accent)]" />
          </label>
          {!linked && params.split < 1 ? <Slide label="Closing share" value={params.split} min={0.1} max={0.9} step={0.01} onChange={(v) => set({ split: v })} /> : null}
          <Slide label={vertical ? 'Left / right' : 'Top / bottom'} value={params.balance ?? 0} min={-1} max={1} step={0.02} onChange={(v) => set({ balance: v })} />
          <Slide label="Match fade" value={params.match ?? 0} max={0.5} step={0.01} onChange={(v) => set({ match: v })} />
          <label className={row}><span className="w-[72px]">Shutter</span>
            <input type="color" value={params.color} onChange={(e) => set({ color: e.target.value, ...(params.color2 === params.color ? { color2: e.target.value } : {}) })} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
            <span className="text-[10.5px] text-[var(--text-faint)]">edge</span>
            <input type="color" value={params.color2 ?? params.color} onChange={(e) => set({ color2: e.target.value })} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
          </label>
          <Slide label="Soft edge" value={params.feather ?? 0} max={0.2} step={0.005} onChange={(v) => set({ feather: v })} />
          <Slide label="Edge shadow" value={params.shadow ?? 0} onChange={(v) => set({ shadow: v })} />
          <Slide label="Edge glow" value={params.glow ?? 0} onChange={(v) => set({ glow: v })} />
        </>
      ) : null}
      {pierce ? (
        <>
          <div className={row}><span className="w-[72px]">Style</span>
            <select value={params.pierce ?? 'clean'} onChange={(e) => set({ pierce: e.target.value })} className={`${T.small} flex-1`}>{(def.styles ?? []).map((x: string) => <option key={x} value={x}>{({ clean: 'Clean piercing reveal', cinematic: 'Cinematic bullet impact', glass: 'Glass pierce', metal: 'Metal pierce', comic: 'Comic book impact', energy: 'Fast energy pierce' } as Record<string, string>)[x] ?? x}</option>)}</select></div>
          <Slide label="Impact at" value={params.split ?? 0.35} min={0.1} max={0.8} step={0.01} onChange={(v) => set({ split: v })} />
          <Slide label="Opening" value={params.amount ?? 0.35} min={0.05} max={1} step={0.01} onChange={(v) => set({ amount: v })} />
          <Slide label="From angle" value={params.angle ?? 200} min={0} max={360} step={1} onChange={(v) => set({ angle: v })} />
          <Slide label="Flash" value={params.intensity ?? 0.35} onChange={(v) => set({ intensity: v })} />
          <Slide label="Debris" value={params.glow ?? 0} onChange={(v) => set({ glow: v })} />
          <Slide label="Shake & bend" value={params.shadow ?? 0.3} onChange={(v) => set({ shadow: v })} />
          <Slide label="Streak" value={params.motionBlur ?? 0.6} onChange={(v) => set({ motionBlur: v })} />
          <label className={`${row} justify-between`}><span>Reverse (open back into A)</span><input type="checkbox" checked={!!params.reverse} onChange={(e) => set({ reverse: e.target.checked })} /></label>
        </>
      ) : null}
      {has('spin') ? (
        <div className={row}><span className="w-[72px]">Turn</span>
          <div className={`${segWrap} flex-1`}>{[90, 180, 360].map((a) => <button key={a} type="button" className={seg(params.angle === a)} onClick={() => set({ angle: a })}>{a}°</button>)}</div>
        </div>
      ) : null}

      {has('direction') && def.directions ? (
        <div className={row}><span className="w-[72px]">Direction</span>
          <div className={`${segWrap} flex-1`}>{def.directions.map((d) => <button key={d} type="button" className={seg(params.direction === d)} onClick={() => set({ direction: d })}>{d[0].toUpperCase() + d.slice(1)}</button>)}</div>
        </div>
      ) : null}
      {has('intensity') && !pierce ? <Slide label="Intensity" value={params.intensity} onChange={(v) => set({ intensity: v })} /> : null}
      {has('motionBlur') && !pierce ? <Slide label="Motion blur" value={params.motionBlur} onChange={(v) => set({ motionBlur: v })} /> : null}
      {has('feather') ? <Slide label="Feather" value={params.feather} max={0.2} step={0.005} onChange={(v) => set({ feather: v })} /> : null}
      {has('hold') ? <Slide label="Hold" value={params.hold} max={0.4} step={0.01} onChange={(v) => set({ hold: v })} /> : null}
      {has('strips') ? <Slide label="Strips" value={params.strips} min={2} max={24} step={1} onChange={(v) => set({ strips: v })} /> : null}
      {has('angle') && !pierce ? <Slide label="Angle" value={params.angle} min={0} max={180} step={1} onChange={(v) => set({ angle: v })} /> : null}
      {has('grain') ? <Slide label="Grain" value={params.grain} onChange={(v) => set({ grain: v })} /> : null}
      {has('color') && !shutter ? (
        <label className={row}><span className="w-[72px]">Colour</span><input type="color" value={params.color} onChange={(e) => set({ color: e.target.value })} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0" /></label>
      ) : null}
      {has('center') && !shutter ? <>
        <Slide label="Center X" value={params.center?.[0] ?? 0.5} onChange={(v) => set({ center: [v, params.center?.[1] ?? 0.5] })} />
        <Slide label="Center Y" value={params.center?.[1] ?? 0.5} onChange={(v) => set({ center: [params.center?.[0] ?? 0.5, v] })} />
      </> : null}

      <details className="rounded-lg border border-[var(--border-soft)] px-2 py-1.5" open={Array.isArray(params.curve)}>
        <summary className="cursor-pointer text-[12px] font-medium text-[var(--text)]">Speed graph</summary>
        <div className="pt-2"><SpeedGraph value={params.curve as Curve | null} onChange={(c) => set({ curve: c })} /></div>
      </details>
      {def.sfx ? <button type="button" className={`${T.secondary} w-full`} onClick={() => void addSound()}>Add a {def.sfx} sound</button> : null}

      <div className="grid grid-cols-3 gap-1.5 pt-1">
        <button type="button" className={T.secondary} onClick={preview}><Play size={13} />Preview</button>
        <button type="button" className={T.secondary} onClick={() => void applyAll()}><Copy size={13} />Apply to all</button>
        <button type="button" className={T.secondary} onClick={remove}><Trash2 size={13} />Remove</button>
      </div>
    </div>
  );
}

function Slide({ label, value, onChange, min = 0, max = 1, step = 0.01 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <label className={row}><span className="w-[72px]">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value ?? 0} onChange={(e) => onChange(Number(e.target.value))} className={slider} />
      <span className="w-9 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{step >= 1 ? Math.round(value) : Number(value ?? 0).toFixed(2)}</span>
    </label>
  );
}

/** a length typed in seconds: what is typed stays as typed until Enter or leaving the field (each keystroke committing
 *  would turn a cleared field into 0.1 s, and "2" typed after it into 0.12) */
function SecondsField({ value, max, onCommit }: { value: number; max: number; onCommit: (seconds: number) => void }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const done = () => { if (draft == null) return; const n = Number(draft.replace(',', '.')); setDraft(null); if (Number.isFinite(n) && n > 0) onCommit(Math.min(max, Math.max(0.1, n))); };
  return <input type="text" inputMode="decimal" aria-label="Duration in seconds" value={draft ?? String(Math.round(value * 10) / 10)}
    onFocus={(e) => { setDraft(String(Math.round(value * 10) / 10)); e.currentTarget.select(); }} onChange={(e) => setDraft(e.target.value)} onBlur={done}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
    className="h-7 w-14 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[12px] tabular-nums outline-none focus:border-[var(--accent)]" />;
}
