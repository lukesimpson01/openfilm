import { T, seg, segWrap } from './ui';

/* The ripple's settings, the same for the transition between clips and the one-clip effect (one shader, effect 51).
   The main row is what most edits need; the rest stays under Advanced. Every control is a uniform the shader reads. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
function Slide({ label, value, min = 0, max = 1, step = 0.01, onChange, fmt }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className={row}>
      <span className="w-[96px] shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" aria-label={label} />
      <span className="w-9 shrink-0 text-right tabular-nums text-[11px] text-[var(--text-muted)]">{fmt ? fmt(value) : Math.round(value * 100)}</span>
    </label>
  );
}
function Choice<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: [V, string][]; onChange: (v: V) => void }) {
  return (
    <div className={row}>
      <span className="w-[96px] shrink-0">{label}</span>
      <div className={`${segWrap} flex-1`}>{options.map(([v, name]) => <button key={v} type="button" className={seg(value === v)} onClick={() => onChange(v)}>{name}</button>)}</div>
    </div>
  );
}

export function RippleControls({ params, saved, set }: { params: Record<string, any>; saved: Record<string, any>; set: (patch: Record<string, unknown>) => void }) {
  /* a ripple saved before the NameDrop style existed draws the classic wave until a style is chosen */
  const style = saved.rippleStyle ?? ('intensity' in saved ? 'classic' : params.rippleStyle ?? 'namedrop');
  const scanned = !!params.scene;
  return (
    <div className="flex flex-col gap-2.5">
      <Choice label="Style" value={style} options={[['namedrop', 'NameDrop'], ['classic', 'Classic']]} onChange={(v) => set({ rippleStyle: v })} />
      <Slide label="Strength" value={params.intensity ?? 0.7} onChange={(v) => set({ intensity: v })} />
      {style === 'namedrop' ? (
        <>
          <Slide label="Waves" value={params.waves ?? 5} min={1} max={8} step={1} onChange={(v) => set({ waves: v })} fmt={(v) => String(v)} />
          <Slide label="Thickness" value={params.thickness ?? 0.045} min={0.01} max={0.12} step={0.005} onChange={(v) => set({ thickness: v })} fmt={(v) => String(Math.round(v * 1000))} />
          <Choice label="Environment" value={params.geometry ?? 'auto'} options={[['auto', 'Auto'], ['scene', 'Scene'], ['surface', 'Surface'], ['corridor', 'Corridor'], ['screen', 'Off']]} onChange={(v) => set({ geometry: v })} />
          <Choice label="Placement" value={params.placement ?? 'scene'} options={[['scene', 'Behind people'], ['foreground', 'Over all'], ['screen', 'Screen']]} onChange={(v) => set({ placement: v })} />
          <p className={T.hint}>
            {scanned
              ? params.geometry === 'surface' && !params.surfaceQuad
                ? 'No surface was chosen for this ripple, so it follows the scene. Place it from 3D → Track on a surface to fit a wall.'
                : 'Uses this clip’s 3D scan: the waves stay in the scene as the camera moves, and pass behind people.'
              : 'Screen-space: scan this clip in 3D → Track and add the ripple there to make the waves follow the scene.'}
          </p>
          <details className="group">
            <summary className="cursor-pointer select-none text-[12px] font-medium text-[var(--text-muted)]">Advanced</summary>
            <div className="mt-2 flex flex-col gap-2.5">
              <Slide label="Reach" value={params.reach ?? 0.9} min={0.2} max={1.6} onChange={(v) => set({ reach: v })} />
              <Slide label="Refraction" value={params.refraction ?? 0.6} onChange={(v) => set({ refraction: v })} />
              <Slide label="Build-up" value={params.buildUp ?? 0.18} min={0.03} max={0.45} onChange={(v) => set({ buildUp: v })} />
              <Slide label="Dissipation" value={params.dissipate ?? 0.25} min={0.05} max={0.6} onChange={(v) => set({ dissipate: v })} />
              <Slide label="Impact" value={params.impact ?? 0.7} onChange={(v) => set({ impact: v })} />
              <Slide label="Interference" value={params.interference ?? 0.5} onChange={(v) => set({ interference: v })} />
              <Slide label="Crest softness" value={params.softness ?? 0.5} onChange={(v) => set({ softness: v })} />
              <Slide label="Highlight" value={params.highlight ?? 0.5} onChange={(v) => set({ highlight: v })} />
              <Slide label="Colour split" value={params.glow ?? 0.25} onChange={(v) => set({ glow: v })} />
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
