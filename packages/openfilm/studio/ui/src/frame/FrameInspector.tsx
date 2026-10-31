import React from 'react';
import { createPortal } from 'react-dom';
import { Diamond, ChevronLeft, ChevronRight, ChevronDown, Timer, X, Captions, Move } from 'lucide-react';
import type { Film, Op } from '@/api';
import { ZoomInspector } from './ZoomInspector';
import { MotionGraphicInspector } from './MotionGraphicInspector';
import { Scene3DInspector } from './Scene3DInspector';
import { EffectInspector } from './EffectInspector';
import { CameraInspector } from './CameraInspector';
import { TrackInspector } from './TrackInspector';
import { FontPicker } from './FontPicker';
import { TransitionInspector } from './TransitionInspector';
import { storyLength } from './StoryFields';
import { PANE_BAR, PANE_TITLE, PANE_BTN, PANE_ICON } from '@/components/dock-pane-bar';
import * as Engine from './lib/animationEngine.js';
import { FPS, PROPERTY_DEFS, hasKeyAt, isAnimated, keyframeAll, layerIdOf, readLayer, setEase, setValue, toggleKey, toggleStopwatch, valueNow, writeLayer, livePreview, type FrameLayer, type Keyframe } from './layers';
import { T } from './ui';
import { deviceActionClips } from './device-actions';

const { EASING_OPTIONS, EASING_LABELS } = Engine as unknown as { EASING_OPTIONS: string[]; EASING_LABELS: Record<string, string> };

export interface FrameInspectorProps {
  projectId: string; folder: string; src: string; clipId?: string; startMs: number; endMs: number; timeMs: number; width: number; onClose: () => void;
  film?: Film | null; notify?: (m: string) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>;
}

const GROUPS: { title: string; keys: (l: FrameLayer) => string[]; open?: boolean }[] = [
  { title: 'Transform', open: true, keys: (l) => ['x', 'y', 'scale', 'rotation', ...(l.kind === 'text' ? [] : ['width', 'height']), 'anchorX', 'anchorY', 'skewX'] },
  { title: 'Appearance', open: true, keys: (l) => ['opacity', ...(l.kind === 'image' ? [] : ['color']), 'cornerRadius', 'strokeColor', 'strokeWidth'].filter((k) => k !== 'cornerRadius' || l.kind !== 'text') },
  { title: 'Text', open: true, keys: (l) => (l.kind === 'text' ? ['fontSize', 'letterSpacing'] : []) },
  { title: 'Effects', keys: () => ['reveal', 'blur', 'glow', 'shadowBlur', 'brightness', 'contrast', 'saturation', 'hue'] },
];
const MOTION_KEYS = ['x', 'y', 'rotation', 'scale'];
const MOTIONS = ['none', 'wiggle', 'shake', 'oscillate'];
const seek = (seconds: number) => window.dispatchEvent(new CustomEvent('frame-seek', { detail: seconds }));
const numberBox = 'h-7 min-w-0 rounded-md border border-transparent bg-[var(--fill-tsp)] px-2 text-[11.5px] tabular-nums text-[var(--text)] outline-none transition hover:border-[var(--border)] focus:border-[var(--accent)] focus:bg-[var(--bg)]';

export function FrameInspector({ projectId, folder, src, clipId, startMs, endMs, timeMs, width, onClose, edit, film = null, notify }: FrameInspectorProps) {
  const id = layerIdOf(src);
  const [page, setPage] = React.useState<FrameLayer | null>(null);
  const [sel, setSel] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef<FrameLayer | null>(null);

  const flush = React.useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (latest.current) { const l = latest.current; latest.current = null; void writeLayer(projectId, l, true); }
  }, [projectId]);
  React.useEffect(() => {
    let live = true;
    setPage(null); setSel(0);
    const load = () => readLayer(folder, id).then((l) => { if (live && l && !latest.current) setPage(l); });
    void load();
    const onWritten = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setTimeout(load, 150); };
    window.addEventListener('frame-layer', onWritten);
    return () => { live = false; window.removeEventListener('frame-layer', onWritten); flush(); };
  }, [folder, id, flush]);

  const layer: FrameLayer | null = page ? (page.layers ? page.layers[Math.min(sel, page.layers.length - 1)] : page) : null;
  const commit = (input: FrameLayer, delay = 120) => {
    if (!page) return;
    /* Easy ease on: every key without its own easing eases in and out (slow start, slow stop), as F9 does in AE */
    const changed: FrameLayer = input.easyEase
      ? { ...input, keyframes: Object.fromEntries(Object.entries(input.keyframes ?? {}).map(([k, fr]) => [k, fr.map((f) => (f.ease ? f : { ...f, ease: 'Ease in-out' }))])) }
      : input;
    const next = page.layers ? { ...page, layers: page.layers.map((l: FrameLayer, i: number) => (i === Math.min(sel, page.layers.length - 1) ? changed : l)) } : changed;
    setPage(next); latest.current = next; livePreview(next);
    if (clipId && !page.layers && next.duration > page.duration + .001){
      const last=next.kind==='scene3d'?film?.tracks.flatMap(tr=>tr.clips).filter(c=>c.src.split('#')[0]===src.split('#')[0]).sort((a,b)=>(b.time?.[1]??0)-(a.time?.[1]??0))[0]:undefined;
      void edit([{op:'set',clip:last?.id??clipId,field:'time',value:[last?.time?.[0]??0,next.duration]}],'Extend action sequence');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  const origin = layer?.start || 0; /* a layer inside a group starts later than the page */
  /* a clip trimmed at its start shows its page from `#t=in`: the page's time is in + the time into the clip */
  const pageIn = React.useMemo(() => {
    for (const tr of film?.tracks ?? []) for (const c of tr.clips) if (c.id === clipId) return c.time?.[0] ?? 0;
    return 0;
  }, [film, clipId]);
  const clipLen = (endMs - startMs) / 1000;
  const t = Math.max(0, Math.round(((timeMs - startMs) / 1000 + pageIn - origin) * FPS) / FPS);
  /** the timeline time of a key at layer time `time` */
  const atFilm = (time: number) => startMs / 1000 + origin + time - pageIn;
  const appendAction = async (next:FrameLayer,from:number,label:string) => {
    if(!page||!film||!clipId)return;
    const {ops,at}=deviceActionClips(film,clipId,from,next.duration,label);
    if(timer.current){clearTimeout(timer.current);timer.current=null;}latest.current=null;
    await writeLayer(projectId,next,true);
    const error=await edit(ops,`Add ${label}`);
    if(error){await writeLayer(projectId,page,true);throw new Error(error);}
    setPage(next);livePreview(next);seek(at+.01);
  };

  /* D: a keyframe (diamond) at the playhead on every animated property, or on position when nothing is animated yet.
     E: easy ease on or off. */
  const hot = React.useRef({ layer, t, commit }); hot.current = { layer, t, commit };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const { layer: l, t: now, commit: save } = hot.current;
      if (!l || l.kind === 'subtitle' || l.kind === 'chat' || l.kind === 'reddit' || l.kind === 'wyr' || l.kind === 'transition' || l.kind === 'effect' || l.kind === 'mg' || l.kind === 'scene3d' || l.kind === 'camera' || l.kind === 'track') return;
      const key = e.key.toLowerCase();
      if (key === 'd') {
        e.preventDefault();
        const animated = Object.keys(l.keyframes ?? {}).filter((k) => l.keyframes[k]?.length);
        save(animated.length ? keyframeAll(l, now) : toggleStopwatch(toggleStopwatch(l, 'x', now), 'y', now));
      } else if (key === 'e') {
        e.preventDefault();
        const on = !l.easyEase;
        save({ ...l, easyEase: on, keyframes: Object.fromEntries(Object.entries(l.keyframes ?? {}).map(([k, fr]) => [k, fr.map((f) => ({ ...f, ease: on ? 'Ease in-out' : 'Linear' }))])) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!page || !layer) return <Shell width={width} onClose={onClose} title="Properties"><p className="px-1 pt-3 text-[12px] text-[var(--text-muted)]">Loading…</p></Shell>;

  const fit = (need: number) => (Math.abs(need - clipLen) > 0.15 && clipId ? (
    <button type="button" className={T.secondary} onClick={() => { flush(); void edit([{ op: 'set', clip: clipId, field: 'time', value: [0, Math.round(need * 1000) / 1000] } as Op], 'Fit length'); }}>
      Fit clip to content ({need.toFixed(1)} s)</button>
  ) : null);

  if (layer.kind === 'effect') {
    return (
      <Shell width={width} onClose={onClose} title={layer.effect === 'fx.zoom' || !layer.effect ? 'Zoom' : layer.name || 'Effect'}>
        {layer.effect === 'fx.zoom' || !layer.effect ? <ZoomInspector layer={layer} clipId={clipId} film={film} folder={folder} commit={commit} edit={edit} /> : <EffectInspector layer={layer} commit={commit} />}
      </Shell>
    );
  }
  if (layer.kind === 'scene3d') {
    return (
      <Shell width={width} onClose={onClose} title={layer.name || '3D'}>
        <Scene3DInspector layer={layer} t={t} film={film} folder={folder} projectId={projectId} commit={commit} appendAction={!page.layers?appendAction:undefined} seek={(x) => seek(atFilm(x))} timeMs={timeMs} clipStart={startMs / 1000-pageIn} />
      </Shell>
    );
  }
  if (layer.kind === 'camera') {
    return (
      <Shell width={width} onClose={onClose} title={(layer.camera as { mode?: string })?.mode === '3d' ? '3D Camera' : '2D Camera'}>
        <CameraInspector layer={layer} t={t} film={film} commit={commit} seek={(x) => seek(atFilm(x))} folder={folder} timeMs={timeMs} clipStart={startMs / 1000} />
      </Shell>
    );
  }
  if (layer.kind === 'track') {
    return (
      <Shell width={width} onClose={onClose} title={layer.name || 'Tracked'}>
        <TrackInspector layer={layer} t={t} film={film} folder={folder} projectId={projectId} commit={commit} segment={[Math.max(0,pageIn-origin),Math.max(0,pageIn-origin)+clipLen]} />
      </Shell>
    );
  }
  if (layer.kind === 'mg') {
    return (
      <Shell width={width} onClose={onClose} title="Motion graphic">
        <MotionGraphicInspector layer={layer} clipId={clipId} projectId={projectId} folder={folder} film={film} commit={commit} edit={edit} notify={notify} />
      </Shell>
    );
  }
  if (layer.kind === 'transition') {
    return (
      <Shell width={width} onClose={onClose} title="Transition">
        <TransitionInspector layer={layer} clipId={clipId} film={film} folder={folder} projectId={projectId} commit={commit} edit={edit} notify={notify} />
      </Shell>
    );
  }

  if (layer.kind === 'subtitle') {
    return (
      <Shell width={width} onClose={onClose} title="Subtitles">
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">Subtitles are edited in the Subtitles tool on the left: type into each line, and pick a style. Changes show on the video as you type.</p>
          <button type="button" className={T.primary} onClick={() => window.dispatchEvent(new CustomEvent('frame-open-tab', { detail: 'subtitles' }))}><Captions size={14} />Open subtitles</button>
        </div>
      </Shell>
    );
  }
  if (layer.kind === 'chat' || layer.kind === 'reddit' || layer.kind === 'wyr') {
    const name = layer.kind === 'chat' ? 'Fake text story' : layer.kind === 'reddit' ? 'Reddit story' : 'Would you rather';
    return (
      <Shell width={width} onClose={onClose} title={name}>
        <StoryOpener kind={layer.kind} />
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-[12px] leading-relaxed text-[var(--text-dim)]">This story is edited with its own tool, open in the sidebar on the left — the same menu as on the Shorts home page. Changes show on the video as you make them.</p>
          <button type="button" className={T.secondary} onClick={() => window.dispatchEvent(new CustomEvent('frame-open-tab', { detail: `stories:${layer.kind}` }))}>Open the {name.toLowerCase()} tool</button>
          {fit(storyLength(layer) ?? clipLen)}
        </div>
      </Shell>
    );
  }

  const animated = Object.keys(layer.keyframes ?? {}).filter((k) => layer.keyframes[k]?.length);
  const allTimes = [...new Set(animated.flatMap((k) => layer.keyframes[k].map((f) => Math.round(f.time * FPS) / FPS)))].sort((a, b) => a - b);
  const prevAll = allTimes.filter((x) => x < t - 0.5 / FPS).pop(), nextAll = allTimes.find((x) => x > t + 0.5 / FPS);
  const span = Math.max(0.5, layer.duration && page.layers ? layer.duration : clipLen || layer.duration || 4);

  const row = (key: string) => {
    const def = PROPERTY_DEFS[key];
    if (!def) return null;
    const on = isAnimated(layer, key), onKey = hasKeyAt(layer, key, t);
    const v = valueNow(layer, key, t);
    const hit = (layer.keyframes?.[key] ?? []).find((f) => Math.abs(f.time - t) < 0.5 / FPS);
    return (
      <div key={key} className="group flex h-8 items-center gap-1.5" data-prop={key}>
        <button type="button" aria-pressed={on} aria-label={`${on ? 'Stop animating' : 'Animate'} ${def.label}`} title={on ? 'Animated — click to remove its keyframes' : 'Animate this property'}
          onClick={() => commit(toggleStopwatch(layer, key, t))}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${on ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] opacity-60 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover:opacity-100'}`}><Timer size={14} /></button>
        <span className="w-[78px] shrink-0 truncate text-[12px] text-[var(--text-dim)]" title={def.label}>{def.label}</span>
        <span className="min-w-0 flex-1">
          {def.type === 'color'
            ? <label className={`${numberBox} flex w-full cursor-pointer items-center gap-2`}><input type="color" aria-label={def.label} value={String(v).length === 7 ? String(v) : '#ffffff'} onChange={(e) => commit(setValue(layer, key, e.target.value, t))} className="h-4 w-5 cursor-pointer rounded border-0 bg-transparent p-0" /><span className="uppercase text-[var(--text-muted)]">{String(v)}</span></label>
            : <NumberField value={Number(v)} step={def.step ?? 1} min={def.min} max={def.max} unit={def.unit} label={def.label} onChange={(n) => commit(setValue(layer, key, n, t))} />}
        </span>
        <button type="button" aria-pressed={onKey} aria-label={onKey ? `Remove ${def.label} keyframe` : `Add ${def.label} keyframe`} title={onKey ? 'Remove keyframe' : 'Add keyframe here'}
          onClick={() => commit(toggleKey(layer, key, t))}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${onKey ? 'text-[var(--accent)]' : on ? 'text-[var(--text-muted)] hover:text-[var(--text)]' : 'text-[var(--text-faint)] opacity-0 hover:text-[var(--text)] group-hover:opacity-100'}`}>
          <Diamond size={11} fill={onKey ? 'currentColor' : 'none'} /></button>
        {hit && typeof hit.ease !== 'object' ? (
          <select aria-label={`${def.label} easing`} title="Easing into this keyframe" value={hit.ease || 'Linear'} onChange={(e) => commit(setEase(layer, key, hit.id, e.target.value))} className="h-6 w-[64px] shrink-0 rounded-md bg-[var(--fill-tsp)] px-1 text-[10.5px] text-[var(--text-dim)] outline-none">
            {EASING_OPTIONS.map((o) => <option key={o} value={o}>{EASING_LABELS[o] ?? o}</option>)}
          </select>
        ) : null}
      </div>
    );
  };

  return (
    <Shell width={width} onClose={onClose} title={layer.name || 'Element'}>
      <StageDrag layer={layer} t={t} onMove={(x, y) => commit(setValue(setValue(layer, 'x', x, t), 'y', y, t), 60)} />
      {page.layers ? (
        <Group title="Layers" open>
          <div role="listbox" aria-label="Layers in this clip" className="flex max-h-40 flex-col overflow-y-auto">
            {page.layers.map((l: FrameLayer, i: number) => (
              <button key={l.id ?? i} role="option" aria-selected={i === sel} onClick={() => setSel(i)}
                className={`flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-[12px] transition ${i === sel ? 'bg-[var(--bg-hover)] text-[var(--accent)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)]'}`}>
                <span className="min-w-0 flex-1 truncate">{l.name}</span><span className="tabular-nums text-[10.5px] text-[var(--text-faint)]">{(l.start || 0).toFixed(1)}s</span>
              </button>
            ))}
          </div>
        </Group>
      ) : null}

      {layer.kind === 'text' ? (
        <Group title="Content" open>
          <textarea aria-label="Text" value={String(layer.text ?? '')} onChange={(e) => commit({ ...layer, text: e.target.value }, 250)} rows={2}
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-2 text-[12.5px] outline-none focus:border-[var(--accent)]" />
          <FontPicker value={layer.font??'Inter'} onChange={font=>commit({...layer,font},0)}/>
        </Group>
      ) : null}

      <Group title="Keyframes" open>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous keyframe" disabled={prevAll == null} onClick={() => prevAll != null && seek(atFilm(prevAll))} className={`${T.icon} disabled:opacity-30`}><ChevronLeft size={14} /></button>
          <span className="w-14 text-center text-[11.5px] tabular-nums text-[var(--text-muted)]" title="Time inside this element">{t.toFixed(2)}s</span>
          <button type="button" aria-label="Next keyframe" disabled={nextAll == null} onClick={() => nextAll != null && seek(atFilm(nextAll))} className={`${T.icon} disabled:opacity-30`}><ChevronRight size={14} /></button>
          <button type="button" disabled={!animated.length} onClick={() => commit(keyframeAll(layer, t))} title="Add a keyframe at the playhead on every animated property"
            className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[12px] font-medium text-[var(--text)] transition hover:border-[var(--border-strong)] disabled:opacity-40">
            <Diamond size={12} className="text-[var(--accent)]" fill="currentColor" />Keyframe all
          </button>
        </div>
        <label className="mt-1.5 flex cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)]" title="Keys ease in and out: motion, size and colour start slowly and stop slowly (E)">
          <span>Easy ease <span className="text-[10.5px] text-[var(--text-faint)]">· slow start, slow stop</span></span>
          <button type="button" role="switch" aria-checked={!!layer.easyEase} aria-label="Easy ease"
            onClick={() => { const on = !layer.easyEase; commit({ ...layer, easyEase: on, keyframes: Object.fromEntries(Object.entries(layer.keyframes ?? {}).map(([k, fr]) => [k, fr.map((f) => ({ ...f, ease: on ? 'Ease in-out' : 'Linear' }))])) }); }}
            className={`relative h-[18px] w-8 rounded-full transition-colors duration-200 ${layer.easyEase ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'}`}>
            <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${layer.easyEase ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
          </button>
        </label>
        <p className="px-1 text-[10.5px] text-[var(--text-faint)]">D adds a keyframe at the playhead · E toggles easy ease</p>
        {animated.length ? (
          <div className="mt-1 flex flex-col gap-0.5 rounded-lg border border-[var(--border-soft)] bg-[var(--bg)] p-1.5">
            {animated.map((k) => (
              <KeyTrack key={k} label={PROPERTY_DEFS[k]?.label ?? k} frames={layer.keyframes[k]} span={span} t={t}
                onSeek={(time) => seek(atFilm(time))}
                onMove={(kid, time) => commit({ ...layer, keyframes: { ...layer.keyframes, [k]: layer.keyframes[k].map((f) => (f.id === kid ? { ...f, time: Math.max(0, Math.round(time * FPS) / FPS) } : f)).sort((a, b) => a.time - b.time) } }, 200)} />
            ))}
          </div>
        ) : <p className={`${T.hint} pt-1`}>Press the stopwatch next to a property to animate it, move the playhead, then change the value.</p>}
      </Group>

      {GROUPS.map((g) => {
        const keys = g.keys(layer);
        return keys.length ? <Group key={g.title} title={g.title} open={g.open}>{keys.map(row)}</Group> : null;
      })}

      <Group title="Procedural motion">
        {MOTION_KEYS.map((key) => {
          const spec = (layer.procedural?.[key] ?? { type: 'none' }) as { type: string; amount?: number; frequency?: number };
          const set = (p: Partial<typeof spec>) => {
            const procedural = { ...(layer.procedural ?? {}) } as Record<string, unknown>;
            const merged = { ...spec, ...p };
            if (merged.type === 'none') delete procedural[key]; else procedural[key] = { amount: key === 'rotation' ? 8 : key === 'scale' ? 10 : 3, frequency: 2, ...merged };
            commit({ ...layer, procedural });
          };
          return (
            <div key={key} className="flex h-8 items-center gap-1.5">
              <span className="w-[78px] shrink-0 truncate pl-7 text-[12px] text-[var(--text-dim)]">{PROPERTY_DEFS[key].label}</span>
              <select aria-label={`${PROPERTY_DEFS[key].label} motion`} value={spec.type} onChange={(e) => set({ type: e.target.value })} className={`${numberBox} flex-1`}>{MOTIONS.map((m) => <option key={m} value={m}>{m === 'none' ? 'Off' : m[0].toUpperCase() + m.slice(1)}</option>)}</select>
              {spec.type !== 'none' ? <>
                <span className="w-12"><NumberField value={Number(spec.amount ?? 3)} step={0.5} label="Amount" onChange={(n) => set({ amount: n })} /></span>
                <span className="w-12"><NumberField value={Number(spec.frequency ?? 2)} step={0.5} label="Speed (Hz)" onChange={(n) => set({ frequency: n })} /></span>
              </> : null}
            </div>
          );
        })}
      </Group>
    </Shell>
  );
}

/* selecting a story opens its tool in the sidebar, once per selection */
function StoryOpener({ kind }: { kind: string }) {
  React.useEffect(() => { window.dispatchEvent(new CustomEvent('frame-open-tab', { detail: `stories:${kind}` })); }, [kind]);
  return null;
}

/* A property's keyframes on a strip as long as the element: click one to go there, drag it to retime it */
function KeyTrack({ label, frames, span, t, onSeek, onMove }: { label: string; frames: Keyframe[]; span: number; t: number; onSeek: (time: number) => void; onMove: (id: string, time: number) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<{ id: string; time: number } | null>(null);
  const timeAt = (clientX: number) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(span, ((clientX - r.left) / r.width) * span)); };
  return (
    <div className="flex h-6 items-center gap-2">
      <span className="w-[70px] shrink-0 truncate text-[10.5px] text-[var(--text-muted)]">{label}</span>
      <div ref={ref} className="relative h-5 flex-1 cursor-pointer rounded bg-[var(--fill-tsp)]" onPointerDown={(e) => { if (e.target === ref.current) onSeek(timeAt(e.clientX)); }}>
        <span aria-hidden className="absolute bottom-0 top-0 w-px bg-[var(--accent)]" style={{ left: `${Math.min(100, (t / span) * 100)}%` }} />
        {frames.map((f) => {
          const time = drag?.id === f.id ? drag.time : f.time, on = Math.abs(f.time - t) < 0.5 / FPS;
          return (
            <button key={f.id} type="button" aria-label={`${label} keyframe at ${f.time.toFixed(2)} s`} title={`${f.time.toFixed(2)} s · drag to move`}
              className={`absolute top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center active:cursor-grabbing ${on ? 'text-[var(--accent)]' : 'text-[var(--text-dim)] hover:text-[var(--accent)]'}`}
              style={{ left: `${Math.min(100, (time / span) * 100)}%` }}
              onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ id: f.id, time: f.time }); }}
              onPointerMove={(e) => { if (drag?.id === f.id) setDrag({ id: f.id, time: timeAt(e.clientX) }); }}
              onPointerUp={() => { if (!drag) return; if (Math.abs(drag.time - f.time) > 0.5 / FPS) onMove(f.id, drag.time); else onSeek(f.time); setDrag(null); }}>
              <Diamond size={10} fill="currentColor" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Drag the element on the picture: a handle over the preview at its position; dropping it sets X and Y (a keyframe
   when position is animated). The preview's stage is found on screen, so the handle follows any zoom or resize. */
function StageDrag({ layer, t, onMove }: { layer: FrameLayer; t: number; onMove: (x: number, y: number) => void }) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [drag, setDrag] = React.useState<{ x: number; y: number } | null>(null);
  React.useEffect(() => {
    let raf = 0;
    const tick = () => { const el = document.querySelector('[data-viewer-pane] .stage') as HTMLElement | null; const r = el?.getBoundingClientRect() ?? null; setRect((old) => (old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!rect || !rect.width || layer.kind === 'group') return null;
  const x = drag?.x ?? Number(valueNow(layer, 'x', t)), y = drag?.y ?? Number(valueNow(layer, 'y', t));
  const w = layer.kind === 'text' ? 0 : (Number(valueNow(layer, 'width', t)) / 100) * rect.width * (Number(valueNow(layer, 'scale', t)) / 100);
  const h = layer.kind === 'text' ? 0 : (Number(valueNow(layer, 'height', t)) / 100) * rect.height * (Number(valueNow(layer, 'scale', t)) / 100);
  const left = rect.left + (x / 100) * rect.width, top = rect.top + (y / 100) * rect.height;
  const toPct = (cx: number, cy: number) => ({ x: Math.round(((cx - rect.left) / rect.width) * 1000) / 10, y: Math.round(((cy - rect.top) / rect.height) * 1000) / 10 });
  return createPortal(
    <>
      {w > 0 ? <div aria-hidden className="pointer-events-none fixed z-40 rounded-[2px] border border-dashed border-[var(--accent)]" style={{ left: left - w / 2, top: top - h / 2, width: w, height: h }} /> : null}
      <button type="button" aria-label="Drag to move the element" title="Drag to move"
        className="fixed z-40 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border-2 border-white bg-[var(--accent)] text-white shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
        style={{ left, top }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(toPct(e.clientX, e.clientY)); }}
        onPointerMove={(e) => { if (drag) setDrag(toPct(e.clientX, e.clientY)); }}
        onPointerUp={() => { if (drag) onMove(drag.x, drag.y); setDrag(null); }}>
        <Move size={13} />
      </button>
    </>,
    document.body,
  );
}

function Group({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group/g border-t border-[var(--border-soft)] py-2 first:border-t-0">
      <summary className="flex cursor-pointer list-none items-center gap-1 py-0.5 text-[12px] font-semibold text-[var(--text)] [&::-webkit-details-marker]:hidden">
        <ChevronDown size={13} className="-rotate-90 text-[var(--text-faint)] transition group-open/g:rotate-0" />{title}
      </summary>
      <div className="pt-1.5">{children}</div>
    </details>
  );
}

function Shell({ title, width, onClose, children }: { title: string; width: number; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside aria-label="Element properties" data-inspector-panel data-film-inspector data-frame-inspector className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-[7px] bg-[var(--dock-pane)] text-[var(--text)]" style={{ width }}
      onKeyDown={(e) => { if ((e.target as Element).closest('input, select, textarea, button')) e.stopPropagation(); }}>
      <div className={PANE_BAR}>
        <span className={`${PANE_TITLE} flex-1 px-1.5 text-[13px] font-semibold text-[var(--text)]`}>{title}</span>
        <button type="button" aria-label="Hide inspector" onClick={onClose} className={PANE_BTN}><X size={PANE_ICON} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5">{children}</div>
    </aside>
  );
}

function NumberField({ value, step, min, max, unit, label, onChange }: { value: number; step: number; min?: number; max?: number; unit?: string; label: string; onChange: (n: number) => void }) {
  const [text, setText] = React.useState<string | null>(null);
  const shown = text ?? String(Math.round(value * 100) / 100);
  const apply = (raw: string) => { const n = Number(raw); if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))); };
  const drag = React.useRef<{ x: number; v: number } | null>(null);
  return (
    <span className="relative flex w-full items-center">
      <input aria-label={label} inputMode="decimal" value={shown} className={`${numberBox} w-full cursor-ew-resize pr-6 focus:cursor-text`}
        onFocus={() => setText(String(Math.round(value * 100) / 100))} onBlur={() => setText(null)}
        onChange={(e) => { setText(e.target.value); apply(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const n = value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1); apply(String(n)); setText(String(Math.round(n * 100) / 100)); } if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onPointerDown={(e) => { if (document.activeElement === e.currentTarget) return; drag.current = { x: e.clientX, v: value }; (e.currentTarget as HTMLInputElement).setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 2) apply(String(d.v + dx * step * (e.shiftKey ? 5 : 1))); }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && Math.abs(e.clientX - d.x) <= 2) (e.currentTarget as HTMLInputElement).focus(); }} />
      {unit ? <span className="pointer-events-none absolute right-2 text-[10px] text-[var(--text-faint)]">{unit}</span> : null}
    </span>
  );
}
