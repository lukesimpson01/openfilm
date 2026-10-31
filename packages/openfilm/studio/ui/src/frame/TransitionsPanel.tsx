import React from 'react';
import { Diamond, MousePointerClick } from 'lucide-react';
import type { Film, Op } from '@/api';
import { TRANSITIONS, TRANSITION_GROUPS, EFFECTS, isLocked } from './transitions-catalog.js';
import { addTransition, cutFor, transitionOn, isFootage } from './transitions';
import { spans } from './lines';
import { addZoom, addEffect } from './zoom';
import { readLayer, writeLayer, layerIdOf, type FrameLayer } from './layers';
import { T, seg, segWrap } from './ui';
import { resolveMediaTiming } from './media-timing';

/* Transitions → Classic: a grid of tiles. Each is the transition itself, drawn by the renderer the video uses, over two
   real gameplay clips: it plays while the pointer is on it and rests on its source poster otherwise (no controls, no
   timecode). A transition goes on the video or photo selected on the timeline, at its start or its end. */
type Entry = { id: string; name: string; group: string; premium: boolean };
const ALL = TRANSITIONS as Entry[];
const W = 72, H = 128;
const SAMPLE = ['gta-01', 'subway-01'];

let stills: Promise<HTMLImageElement[]> | null = null;
let clips: { a: HTMLVideoElement; b: HTMLVideoElement } | null = null;
let previewWorker:Worker|null=null,sequence=0;
const waiting=new Map<number,HTMLCanvasElement>(),pending=new WeakSet<HTMLCanvasElement>();
async function drawPreview(canvas:HTMLCanvasElement,a:CanvasImageSource,b:CanvasImageSource,p:number,effect:string){
  if(pending.has(canvas)||waiting.size>0)return;pending.add(canvas);canvas.dataset.transitionPreview='loading';
  if(canvas.dataset.hasPreview!=='1'){const context=canvas.getContext('2d');if(context){context.drawImage(a,0,0,canvas.width,canvas.height);canvas.dataset.hasPreview='1';}}
  try{previewWorker??=new Worker(new URL('./transition-preview-worker.ts',import.meta.url),{type:'module'});previewWorker.onerror=()=>{for(const target of waiting.values()){pending.delete(target);target.dataset.transitionPreview='poster';}waiting.clear();previewWorker?.terminate();previewWorker=null;};previewWorker.onmessage=e=>{const target=waiting.get(e.data.id);waiting.delete(e.data.id);if(target){pending.delete(target);target.dataset.transitionPreview=e.data.error?'error':'ready';if(e.data.error)target.dataset.previewError=e.data.error;if(e.data.bitmap){target.dataset.renderedFrames=String(Number(target.dataset.renderedFrames||0)+1);target.getContext('2d')?.drawImage(e.data.bitmap,0,0);e.data.bitmap.close();}}};
    const images=await Promise.all([createImageBitmap(a),createImageBitmap(b)]),id=++sequence;waiting.set(id,canvas);previewWorker.postMessage({id,a:images[0],b:images[1],p,effect},images);
  }catch{pending.delete(canvas);}
}
function sampleStills() {
  stills ??= Promise.all(SAMPLE.map((n) => new Promise<HTMLImageElement>((done) => { const i = new Image(); i.onload = () => done(i); i.onerror = () => done(i); i.src = `/assets/media/fake-text-gameplay/${n}.jpg`; })));
  return stills;
}
/** The two moving clips the tiles play over (one pair for every tile: only the hovered one plays). */
function sampleClips() {
  if (!clips) {
    const make = (n: string) => { const v = document.createElement('video'); v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.src = `/assets/media/fake-text-gameplay/${n}.mp4`; return v; };
    clips = { a: make(SAMPLE[0]), b: make(SAMPLE[1]) };
  }
  return clips;
}
const ready = (v: HTMLVideoElement) => v.readyState >= 2;

function Tile({ entry, onApply }: { entry: Entry; onApply: () => void }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const raf = React.useRef(0);
  const [playing, setPlaying] = React.useState(false);
  const visible=React.useRef(false);
  const draw = React.useCallback((a: CanvasImageSource, b: CanvasImageSource, p: number) => {
    const canvas=ref.current;if(canvas&&visible.current)void drawPreview(canvas,a,b,p,entry.id);
  }, [entry.id]);
  const rest = React.useCallback(async () => { const [a] = await sampleStills(),canvas=ref.current;if(canvas&&visible.current&&a.complete&&a.naturalWidth){canvas.getContext('2d')?.drawImage(a,0,0,canvas.width,canvas.height);canvas.dataset.hasPreview='1';canvas.dataset.transitionPreview='poster';} }, []);
  React.useEffect(() => {const observer=new IntersectionObserver(entries=>{visible.current=entries[0].isIntersecting;if(visible.current)void rest();});if(ref.current)observer.observe(ref.current);return()=>{observer.disconnect();cancelAnimationFrame(raf.current);};}, [rest]);
  const play = () => {
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const { a, b } = sampleClips();
    void a.play().catch(() => {}); void b.play().catch(() => {});
    setPlaying(true);
    const t0 = performance.now(), cycle = 1900;
    /* hold A, transition, hold B: the loop reads as a cut being made */
    const tick = (now: number) => {
      const k = ((now - t0) % cycle) / cycle;
      const p = Math.min(1, Math.max(0, (k - 0.2) / 0.55));
      if (ready(a) && ready(b)) draw(a, b, p);
      raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const stop = () => { cancelAnimationFrame(raf.current); setPlaying(false); const { a, b } = sampleClips(); a.pause(); b.pause(); void rest(); };
  return (
    <button type="button" onClick={onApply} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} disabled={isLocked(entry.id)}
      className="group flex flex-col gap-1 rounded-lg p-1 text-left transition duration-200 hover:bg-[var(--bg-hover)]" title={entry.name}>
      <span className={`relative block overflow-hidden rounded-md transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${playing ? 'scale-[1.03] shadow-[0_6px_16px_rgba(0,0,0,0.18)]' : 'shadow-[0_1px_2px_rgba(0,0,0,0.12)]'}`}>
        <canvas ref={ref} width={W * 2} height={H * 2} className="block aspect-[9/16] w-full" />
        {entry.premium ? <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"><Diamond size={9} fill="currentColor" /></span> : null}
      </span>
      <span className="truncate px-0.5 text-[11px] text-[var(--text-dim)] group-hover:text-[var(--text)]">{entry.name}</span>
    </button>
  );
}

export function TransitionsPanel({ projectId, folder, film, edit, notify, selected, remembered, timeMs, onSelectClip, onNameLine }: {
  projectId: string; folder: string; film: Film | null; notify: (m: string) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>; onSelectClip: (id: string) => void; onNameLine?: (clipId: string, label: string) => void;
  selected: { clipId?: string; src?: string } | null;
  /** the video or photo picked last on the timeline (kept by the tools panel while other tools were open) */
  remembered?: string | null;
  timeMs?: number;
}) {
  const [group, setGroup] = React.useState<string>('All');
  const [side, setSide] = React.useState<'start' | 'end'>('end');
  const [timed, setTimed] = React.useState<{film:Film|null; source:Film|null}>({film:null,source:null});
  const [timingError,setTimingError] = React.useState('');
  const [busy,setBusy] = React.useState(false);
  React.useEffect(()=>{let live=true;setTimingError('');void resolveMediaTiming(film,folder).then(value=>{if(live)setTimed({film:value,source:film});}).catch(e=>{if(live)setTimingError(String(e.message??e));});return()=>{live=false;};},[film,folder]);
  const readyFilm=timed.source===film?timed.film:null;
  /* the clip picked on the timeline; a click in this panel clears the timeline's selection, so it is remembered until
     another clip is picked (or it leaves the film) */
  const [picked, setPicked] = React.useState<string | null>(remembered ?? null);
  React.useEffect(() => { if (selected?.clipId && isFootage(selected.src)) setPicked(selected.clipId); else if(remembered)setPicked(remembered); }, [selected?.clipId, selected?.src,remembered]);
  const inFilm = (id: string | null) => !!id && !!film?.tracks.some((tr) => tr.clips.some((c) => c.id === id));
  /* nothing picked: the video or photo under the playhead on the Video line */
  const underPlayhead = React.useMemo(() => {
    const t = (timeMs ?? 0) / 1000;
    for (const tr of readyFilm?.tracks ?? []) {
      const sp = spans(tr.clips);
      for (let i = 0; i < tr.clips.length; i++) {
        const c = tr.clips[i], s = sp[i];
        if (isFootage(c.src) && s.end != null && t >= s.start - 1e-3 && t < s.end) return c.id ?? null;
      }
    }
    return null;
  }, [readyFilm, timeMs]);
  const target = inFilm(picked) ? picked : inFilm(underPlayhead) ? underPlayhead : null;
  const cut = target ? cutFor(readyFilm, target, side) : null;
  const where = !cut ? '' : cut.edge === 'cut' ? (side === 'end' ? 'into the next clip' : 'from the clip before') : cut.edge === 'in' ? 'in from black' : 'out to black';
  const apply = async (id: string) => {
    if(busy)return;
    if (!target || !cut) { notify('Select a video or photo on the timeline first: the transition goes on its start or its end.'); return; }
    setBusy(true);
    try {
    const existing = transitionOn(film, cut);
    if (existing) {
      const layer = await readLayer(folder, layerIdOf(existing.src));
      if (layer) { await writeLayer(projectId, { ...layer, effect: id, name: ALL.find((t) => t.id === id)?.name ?? layer.name } as FrameLayer); onSelectClip(existing.id); return; }
    }
    const { op, layer, opened } = await addTransition(projectId, readyFilm, cut, id, {}, { clipId: target, side });
    const fail = await edit([op], 'Add transition');
    if (fail) { notify(fail); return; }
    if (opened) onNameLine?.(layer.id, 'Transitions');
    onSelectClip(layer.id);
    } catch(error){notify(error instanceof Error?error.message:String(error));}finally{setBusy(false);}
  };
  const shown = group === 'All' ? ALL : ALL.filter((t) => t.group === group || ((t as unknown as { also?: string[] }).also ?? []).includes(group));
  const addZoomHere = async (effectId = 'fx.zoom') => {
    const r = effectId === 'fx.zoom' ? await addZoom(projectId, film, (timeMs ?? 0) / 1000, target) : await addEffect(projectId, film, (timeMs ?? 0) / 1000, effectId, target);
    if ('error' in r) { notify(r.error as string); return; }
    const fail = await edit([r.op], `Add ${r.layer.name}`);
    if (fail) { notify(fail); return; }
    onNameLine?.(r.layer.id, 'Effects');
    onSelectClip(r.layer.id);
  };
  return (
    <div className="flex flex-col gap-3 pt-1">
      {timingError&&<p role="alert" className={T.hint}>{timingError}</p>}
      {target&&!cut&&!timingError&&<p role="status" className={T.hint}>Reading the selected clip…</p>}
      {target ? (
        <div className="flex flex-col gap-1.5">
          <div className={segWrap}>
            {(['start', 'end'] as const).map((s) => <button key={s} type="button" className={seg(side === s)} onClick={() => setSide(s)}>{s === 'start' ? 'At start' : 'At end'}</button>)}
          </div>
          <p className="px-0.5 text-[11px] text-[var(--text-muted)]">Click a transition: it plays at the clip’s {side}, {where}.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-[11.5px] leading-snug text-[var(--text-dim)]">
          <MousePointerClick size={16} className="shrink-0 text-[var(--text-muted)]" />
          <span>Select a video or photo on the timeline, then pick a transition for its start or end.</span>
        </div>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className={T.heading}>Effects</h3>
        <div className="grid grid-cols-3 gap-1">
          {(EFFECTS as unknown as Entry[]).map((x) => <Tile key={x.id} entry={{ ...x, name: x.id === 'fx.zoom' ? 'Zoom' : x.name }} onApply={() => void addZoomHere(x.id)} />)}
        </div>
        <p className="px-0.5 text-[11px] text-[var(--text-muted)]">Effects go over the clip at the playhead (Velocity Edit, Beat Shake, Flash Impact, Glitch Snap, Light Leak, Camera Roll, Split-Frame Freeze, Zoom): tune them in the inspector.</p>
      </section>
      <div className="-mx-0.5 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {['All', ...TRANSITION_GROUPS].map((g) => (
          <button key={g} type="button" onClick={() => setGroup(g)} className={`h-7 shrink-0 rounded-full px-3 text-[11.5px] transition ${group === g ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>{g}</button>
        ))}
      </div>
      <div className={`grid grid-cols-3 gap-1 transition-opacity duration-200 ${target ? '' : 'opacity-80'}`}>
        {shown.map((t) => <Tile key={t.id} entry={t} onApply={() => void apply(t.id)} />)}
      </div>
      <p className={T.hint}>Hover a transition to see it. ◆ marks premium ones (motion blur, bloom or 3D lighting); the preview and the export draw them the same way.</p>
    </div>
  );
}
