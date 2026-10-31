import React from 'react';
import { createPortal } from 'react-dom';
const createPortalSafe = (n: React.ReactNode) => createPortal(n, document.body);
import { Crosshair, Play, Plus, Trash2, Clapperboard } from 'lucide-react';
import type { Film } from '@/api';
import { round, type FrameLayer } from './layers';
import { buildCamera, framingWarning, CAMERA_PRESETS, CAMERA3D_PRESETS, type CameraSpec, type CamOpts } from './camera';
import { cameraView, camera3dShots, SHOT_VIEWS } from './motion3d.js';
import { StageOverlay, useStageRect } from './StageOverlay';
import { SceneView } from './SceneView';
import { livePreview } from './layers';
import { T, seg, segWrap } from './ui';

/* A camera clip's settings, kept simple: what it does (a preset), where it goes (click the picture), how close, when it
   moves, stops, holds and comes back (a bar you drag), and how smooth each part is. Every change rebuilds the camera's
   keys, so the preview shows the real move at once. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
function Toggle({ label, on, onChange, hint }: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className={`${row} justify-between`} title={hint}><span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-[var(--accent)]' : 'bg-[var(--fill-tsp)] ring-1 ring-[var(--border)]'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </button></label>
  );
}
function Slider({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className={row}><span className="w-[84px] shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" aria-label={label} />
      <span className="w-12 text-right tabular-nums text-[var(--text)]">{unit === '%' ? `${Math.round(value * 100)}%` : `${round(value)}${unit}`}</span></label>
  );
}

/* A 3D camera's path as shots: at this moment, see it from here (front, left, top, close…). The camera flies between
   them on its own. The easy custom path — the scene view's handles are for exact moves. */
type Shot = { t: number; view: string };
const VIEW_NAMES: Record<string, string> = { front: 'Front', left45: '¾ left', left: 'Left', back: 'Back', right: 'Right', right45: '¾ right', top: 'Top', low: 'Low', close: 'Close', wide: 'Wide' };
function ShotList({ layer, t, commit, seek }: { layer: FrameLayer; t: number; commit: (l: FrameLayer, delay?: number) => void; seek: (x: number) => void }) {
  const cam = layer.camera as CameraSpec & { shots?: Shot[] }; const o = cam.opts ?? {}; const L = layer.duration; const shots = cam.shots ?? [];
  const write = (next: Shot[]) => commit({ ...layer, camera: { ...cam, shots: next, custom: next.length > 0, motion: next.length ? camera3dShots(next, L, { target: o.target3d, distance: o.distance, fov: o.fov }) : buildCamera('3d', cam.preset, o, L, { w: cam.stageW, h: cam.stageH }) } }, 60);
  const [view, setView] = React.useState('front');
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2">
      <div className="flex items-center gap-1.5"><Clapperboard size={13} className="text-[var(--text-faint)]" /><span className="flex-1 text-[11.5px] font-semibold text-[var(--text)]">Shots</span><span className="text-[10.5px] text-[var(--text-faint)]">{shots.length ? 'your path' : 'using the movement above'}</span></div>
      <div className="flex flex-wrap gap-1">{SHOT_VIEWS.map((v) => <button key={v} type="button" className={`rounded-full px-2 py-0.5 text-[11px] transition ${view === v ? 'bg-[var(--accent)] text-white' : 'bg-[var(--fill-tsp)] text-[var(--text-dim)] hover:text-[var(--text)]'}`} onClick={() => setView(v)}>{VIEW_NAMES[v]}</button>)}</div>
      <button type="button" className={T.secondary} onClick={() => write([...shots.filter((s) => Math.abs(s.t - t) > 0.05), { t: round(t), view }].sort((p, q) => p.t - q.t))}><Plus size={13} />Add “{VIEW_NAMES[view]}” shot at {round(t)}s</button>
      {shots.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11.5px]">
          <button type="button" className="w-12 rounded bg-[var(--fill-tsp)] py-0.5 tabular-nums text-[var(--text)]" onClick={() => seek(s.t)} title="Go to this shot">{round(s.t)}s</button>
          <select value={s.view} onChange={(e) => write(shots.map((x, j) => (j === i ? { ...x, view: e.target.value } : x)))} className={`${T.small} flex-1`} aria-label="View">{SHOT_VIEWS.map((v) => <option key={v} value={v}>{VIEW_NAMES[v]}</option>)}</select>
          <button type="button" aria-label="Remove shot" className={T.icon} onClick={() => write(shots.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
        </div>))}
      {shots.length === 1 ? <p className={T.hint}>Add a second shot to make the camera fly.</p> : null}
    </div>
  );
}

/** The movement as a bar: Move · Stop & hold · Return, with handles for when it starts, stops and returns. */
function Segments({ length, start, stop, returnBack, returnAt, returnDuration, t, onChange }: { length: number; start: number; stop: number; returnBack: boolean; returnAt: number; returnDuration: number; t: number; onChange: (p: { start?: number; stop?: number; returnAt?: number }) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<'start' | 'stop' | 'return' | null>(null);
  const pct = (x: number) => `${(Math.min(length, Math.max(0, x)) / length) * 100}%`;
  const at = (cx: number) => { const r = ref.current!.getBoundingClientRect(); return round(Math.min(1, Math.max(0, (cx - r.left) / r.width)) * length); };
  const move = (cx: number) => {
    if (!drag) return; const x = at(cx);
    if (drag === 'start') onChange({ start: Math.min(x, stop - 0.05) });
    if (drag === 'stop') onChange({ stop: Math.max(start + 0.05, Math.min(x, returnBack ? returnAt : length)) });
    if (drag === 'return') onChange({ returnAt: Math.max(stop, Math.min(x, length - 0.05)) });
  };
  const hEnd = returnBack ? returnAt : length;
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} className="relative h-9 select-none rounded-md bg-[var(--fill-tsp)]" onPointerMove={(e) => move(e.clientX)} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        <div className="absolute inset-y-1 rounded bg-[#4568ee]/80" style={{ left: pct(start), width: `calc(${pct(stop)} - ${pct(start)})` }} />
        <div className="absolute inset-y-1 rounded bg-[#a3b3f5]/70" style={{ left: pct(stop), width: `calc(${pct(hEnd)} - ${pct(stop)})` }} />
        {returnBack ? <div className="absolute inset-y-1 rounded bg-[#f59e0b]/80" style={{ left: pct(returnAt), width: `calc(${pct(returnAt + returnDuration)} - ${pct(returnAt)})` }} /> : null}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: pct(t) }} />
        {([['start', start], ['stop', stop], ...(returnBack ? [['return', returnAt]] : [])] as [typeof drag, number][]).map(([k, x]) => (
          <button key={k} type="button" aria-label={`Drag ${k}`} className="absolute top-0 h-9 w-3 -translate-x-1/2 cursor-ew-resize" style={{ left: pct(x) }}
            onPointerDown={(e) => { (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId); setDrag(k); }}><span className="mx-auto block h-full w-1 rounded bg-white shadow" /></button>
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] text-[var(--text-faint)]"><span>Move {round(start)}–{round(stop)}s</span><span>Hold {round(stop)}–{round(hEnd)}s</span>{returnBack ? <span>Return {round(returnAt)}–{round(Math.min(length, returnAt + returnDuration))}s</span> : <span>Stays</span>}</div>
    </div>
  );
}

export function CameraInspector({ layer, t, film, commit, seek, folder, timeMs, clipStart }: { layer: FrameLayer; t: number; film: Film | null; commit: (l: FrameLayer, delay?: number) => void; seek: (layerTime: number) => void; folder: string; timeMs: number; clipStart: number }) {
  const cam = layer.camera as CameraSpec; const o = cam.opts ?? {}; const L = layer.duration;
  const stage = { w: cam.stageW ?? film?.stage?.w ?? 1080, h: cam.stageH ?? film?.stage?.h ?? 1920 };
  const [picking, setPicking] = React.useState(false);
  const set = (patch: Partial<CamOpts>, more: Partial<CameraSpec> = {}) => {
    const opts = { ...o, ...patch }; const next: CameraSpec = { ...cam, ...more, opts };
    /* a path drawn by hand (in the scene view) stays until another movement is picked */
    if (!(cam as { custom?: boolean }).custom || more.preset) { next.motion = buildCamera(next.mode, next.preset, opts, L, stage); (next as { custom?: boolean }).custom = false; }
    commit({ ...layer, camera: next, name: `${next.mode === '2d' ? '2D' : '3D'} Camera · ${(next.mode === '2d' ? CAMERA_PRESETS : CAMERA3D_PRESETS)[next.preset as never] ?? next.preset}` }, 120);
  };
  const motion = cam.motion as { returnAt?: number };
  const retDur = o.returnDuration ?? 0.8; const retAt = motion?.returnAt ?? Math.max(o.stop ?? L, L - retDur);
  const view = cam.mode === '2d' ? cameraView(cam.motion, t, L, stage, cam.bounds, cam.media ?? null) : null;
  /* where it really lands (kept inside the footage), for the target box */
  const landed = cam.mode === '2d' ? cameraView(cam.motion, o.stop ?? Math.min(L, 1.2), L, stage, cam.bounds, cam.media ?? null) : null;
  const warn = framingWarning(cam, L);
  const target = o.target ?? [stage.w / 2, stage.h / 2];
  const presets = cam.mode === '2d' ? CAMERA_PRESETS : CAMERA3D_PRESETS;
  const needsTarget = cam.mode === '2d' && ['zoomTarget', 'zoomOut', 'punch', 'slowZoom', 'reveal', 'follow', 'focusText'].includes(cam.preset);
  const tracking=layer.camera?.tracking;
  if(tracking)return <div className="flex flex-col gap-3 pt-2"><p className="text-[12px] font-semibold">Follow target</p><p className={T.hint}>This camera uses the saved visual track. Edit its target, framing and smoothness on the source video.</p><button className={T.secondary} onClick={()=>window.dispatchEvent(new CustomEvent('frame-select-clip',{detail:tracking.clipId}))}><Crosshair size={13}/>Edit target tracking</button><p className={T.hint}>{tracking.path?.length??0} source samples · {tracking.settings?.style??'precise'} follow</p></div>;
  return (
    <div className="flex flex-col gap-3 pt-2">
      {cam.mode === '3d' ? (
        <SceneView folder={folder} film={film} timeMs={timeMs} mode="camera" layer={layer} clipStart={clipStart}
          onMotion={(m) => commit({ ...layer,duration:Math.max(layer.duration,...m.keys.map(k=>k.t+.3)), camera: { ...cam, motion: m, custom: true,shots:undefined } }, 60)} />
      ) : <FramingEditor layer={layer} t={t} stage={stage} commit={commit} />}
      <label className={row}><span className="w-[84px] shrink-0">Movement</span>
        <select value={cam.preset} onChange={(e) => set({}, { preset: e.target.value })} className={`${T.small} flex-1`}>
          {Object.entries(presets).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      {cam.mode === '3d' ? <ShotList layer={layer} t={t} commit={commit} seek={seek} /> : null}
      {needsTarget ? (
        <div className="flex flex-col gap-1.5">
          <button type="button" onClick={() => setPicking((v) => !v)} className={`${T.secondary} ${picking ? 'border-[#fbbf24] text-[var(--text)]' : ''}`}><Crosshair size={13} />{picking ? 'Click the target on the picture…' : `Target: ${Math.round(target[0])}, ${Math.round(target[1])} — click to change`}</button>
          <StageOverlay pick={picking} hint="Click where the camera should go" onPick={(x, y) => { setPicking(false); set({ target: [round(x * stage.w), round(y * stage.h)] }); }}
            target={landed ? { x: landed.cx / stage.w, y: landed.cy / stage.h, zoom: landed.zoom } : { x: target[0] / stage.w, y: target[1] / stage.h, zoom: o.zoom ?? 1.75 }} />
        </div>
      ) : null}
      {cam.preset === 'between' ? <p className={T.hint}>Move between targets: {(o.targets ?? []).length || 2} points. Click “Add point” and then the picture.</p> : null}
      {cam.preset === 'between' ? <BetweenTargets o={o} stage={stage} onChange={(targets) => set({ targets })} /> : null}
      {cam.mode === '2d' ? <Slider label="Zoom" value={o.zoom ?? 1.75} min={1} max={4} step={0.05} unit="%" onChange={(v) => set({ zoom: v })} /> : (
        <>
          <Slider label="Orbit" value={o.orbit ?? 65} min={0} max={360} step={1} unit="°" onChange={(v) => set({ orbit: v })} />
          <Slider label="Distance" value={o.distance ?? 4.5} min={1} max={12} step={0.1} onChange={(v) => set({ distance: v })} />
          <Slider label="Lens (FOV)" value={o.fov ?? 35} min={12} max={80} step={1} unit="°" onChange={(v) => set({ fov: v })} />
        </>
      )}
      {cam.preset === 'handheld' ? <Slider label="Shake" value={o.shake ?? 10} min={0} max={40} step={1} unit="px" onChange={(v) => set({ shake: v })} /> : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-[var(--text-muted)]">When it moves</span>
        <Segments length={L} start={o.start ?? 0} stop={o.stop ?? Math.min(L, 1.2)} returnBack={!!o.returnBack} returnAt={retAt} returnDuration={retDur} t={t}
          onChange={(p) => set({ ...(p.start != null ? { start: p.start } : {}), ...(p.stop != null ? { stop: p.stop } : {}), ...(p.returnAt != null ? { returnAt: p.returnAt } : {}) })} />
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-2.5">
        <Toggle label="Smooth start" on={o.smoothStart !== false} onChange={(v) => set({ smoothStart: v })} />
        <Toggle label="Smooth stop" on={o.smoothStop !== false} onChange={(v) => set({ smoothStop: v })} />
        <Toggle label="Return to start" on={!!o.returnBack} onChange={(v) => set({ returnBack: v })} />
        {o.returnBack ? <>
          <Slider label="Return time" value={retDur} min={0.1} max={Math.max(0.2, L - (o.stop ?? 1))} step={0.05} unit="s" onChange={(v) => set({ returnDuration: v })} />
          <Toggle label="Smooth return" on={o.smoothReturn !== false} onChange={(v) => set({ smoothReturn: v })} />
        </> : <Toggle label="Stay there after the clip" hint="Keeps this framing after the camera clip ends, until another camera starts" on={!!cam.holdAfter} onChange={(v) => set({}, { holdAfter: v })} />}
      </div>
      {cam.mode === '2d' ? (
        <label className={row}><span className="w-[84px] shrink-0">Frame edges</span>
          <div className={`${segWrap} flex-1`}>{(['constrain', 'fill', 'allow'] as const).map((b) => <button key={b} type="button" className={seg(cam.bounds === b)} onClick={() => set({}, { bounds: b })}>{b === 'constrain' ? (cam.media ? 'Keep inside footage' : 'Keep inside') : b === 'fill' ? 'Fill colour' : 'Allow'}</button>)}</div></label>
      ) : null}
      {warn ? <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600">{warn} Choose “Keep inside” to stay within the picture.</p> : null}
      {view ? <p className={T.hint}>Now: {view.phase === 'move' ? 'moving' : view.phase === 'return' ? 'returning' : view.phase === 'hold' ? 'stopped (the video keeps playing)' : view.phase === 'before' ? 'not moving yet' : 'back at the start'} · zoom {Math.round(view.zoom * 100)}%</p> : null}
      <button type="button" className={T.secondary} onClick={() => seek(Math.max(0, (o.start ?? 0) - 0.3))}><Play size={13} />Preview from the camera’s start</button>
      <p className={T.hint}>Stopping the camera does not stop the video. To hold the picture itself, use Freeze frame on the video clip.</p>
    </div>
  );
}

function BetweenTargets({ o, stage, onChange }: { o: CamOpts; stage: { w: number; h: number }; onChange: (t: [number, number][]) => void }) {
  const [adding, setAdding] = React.useState(false);
  const pts = o.targets ?? [];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1"><button type="button" className={T.secondary} onClick={() => setAdding((v) => !v)}>{adding ? 'Click the picture…' : 'Add point'}</button><button type="button" className={T.secondary} onClick={() => onChange([])}>Clear</button></div>
      <StageOverlay pick={adding} hint="Click the next point" onPick={(x, y) => { setAdding(false); onChange([...pts, [round(x * stage.w), round(y * stage.h)]]); }}
        nodes={pts.map((p, i) => ({ id: String(i), x: p[0] / stage.w, y: p[1] / stage.h, label: String(i + 1) }))}
        onDrop={(id, x, y) => onChange(pts.map((p, i) => (String(i) === id ? [round(x * stage.w), round(y * stage.h)] : p)))} />
    </div>
  );
}

/* Edit the 2D camera's framing on the picture itself: while on, the preview shows the whole stage (the camera stands
   aside), and the camera's frame at the playhead is a box to drag (move) or pull by its corner (zoom). Letting go
   moves the camera's target and zoom; its timing stays as it is. */
function FramingEditor({ layer, t, stage, commit }: { layer: FrameLayer; t: number; stage: { w: number; h: number }; commit: (l: FrameLayer, delay?: number) => void }) {
  const [on, setOn] = React.useState(false);
  const cam = layer.camera as CameraSpec;
  const rect = useStageRect();
  const [drag, setDrag] = React.useState<{ kind: 'move' | 'zoom'; x0: number; y0: number; cx: number; cy: number; z: number } | null>(null);
  const [live, setLive] = React.useState<{ cx: number; cy: number; z: number } | null>(null);
  React.useEffect(() => { if (on) livePreview({ ...layer, camera: { ...cam, bypass: true } }); else livePreview(layer); }, [on, layer]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => livePreview(layer), []); // eslint-disable-line react-hooks/exhaustive-deps
  const v = cameraView(cam.motion, t, layer.duration, stage, cam.bounds, cam.media ?? null);
  const cur = live ?? { cx: v.cx, cy: v.cy, z: v.zoom };
  const apply = (c: { cx: number; cy: number; z: number }) => {
    const opts = { ...cam.opts, target: [round(c.cx), round(c.cy)] as [number, number], zoom: round(Math.max(1, Math.min(4, c.z))) };
    commit({ ...layer, camera: { ...cam, opts, motion: buildCamera(cam.mode, cam.preset, opts, layer.duration, stage), custom: false } }, 0);
  };
  const button = <button type="button" className={`${T.secondary} ${on ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setOn((x) => !x)}>{on ? 'Done editing the frame' : 'Edit framing on the picture'}</button>;
  if (!on || !rect) return button;
  const k = rect.width / stage.w; const w = (stage.w / cur.z) * k, h = (stage.h / cur.z) * k;
  const left = rect.left + cur.cx * k - w / 2, top = rect.top + cur.cy * k - h / 2;
  const move = (e: React.PointerEvent) => {
    if (!drag) return; const dx = (e.clientX - drag.x0) / k, dy = (e.clientY - drag.y0) / k;
    if (drag.kind === 'move') setLive({ cx: drag.cx + dx, cy: drag.cy + dy, z: drag.z });
    else { const half = Math.max(40, (stage.w / drag.z) / 2 + dx); setLive({ cx: drag.cx, cy: drag.cy, z: Math.max(1, Math.min(4, stage.w / (2 * half))) }); }
  };
  return (
    <>
      {button}
      {createPortalSafe(
        <div data-film-select="" className="pointer-events-none fixed inset-0 z-40">
          <div className="pointer-events-none fixed rounded-[3px] bg-black/45" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${left - rect.left}px ${top - rect.top}px,${left - rect.left}px ${top - rect.top + h}px,${left - rect.left + w}px ${top - rect.top + h}px,${left - rect.left + w}px ${top - rect.top}px,${left - rect.left}px ${top - rect.top}px)` }} />
          <div className="pointer-events-auto fixed cursor-move rounded-[4px] border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left, top, width: w, height: h }}
            onPointerMove={move} onPointerUp={() => { if (drag && live) apply(live); setDrag(null); setLive(null); }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ kind: 'move', x0: e.clientX, y0: e.clientY, cx: cur.cx, cy: cur.cy, z: cur.z }); }}>
            <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">Camera · {Math.round(cur.z * 100)}%</span>
            <span className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-[var(--accent)]"
              onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); setDrag({ kind: 'zoom', x0: e.clientX, y0: e.clientY, cx: cur.cx, cy: cur.cy, z: cur.z }); }} />
          </div>
        </div>,
      )}
    </>
  );
}
