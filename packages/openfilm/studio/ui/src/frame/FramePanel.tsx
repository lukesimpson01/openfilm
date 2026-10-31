import React from 'react';
import { Type, Square, Circle, Triangle, Star, Minus, ArrowRight, Hexagon, Diamond, Play, Pause, Plus, Search, X, Heading1, Subtitles as SubIcon, ImagePlus, ExternalLink } from 'lucide-react';
import type { Film, Op } from '@/api';
import { PANE_BAR, PANE_TITLE, PANE_BTN, PANE_ICON } from '@/components/dock-pane-bar';
import { ANIMATION_PRESETS, PRESET_CATEGORIES } from './lib/animationPresets.js';
import { searchSfx, SFX_COUNT, SFX_CATALOG } from './lib/sfxLibrary.js';
import { recordingIssue, soundRecordingSource } from '../../../../src/recording-identity.mjs';
import { MUSIC_SECTIONS, searchMusic } from './lib/musicLibrary.js';
import { placeClip, spans } from './lines';
import { framePath, round, makeLayer, readLayer, writeLayer, withPreset, isFrameSrc, layerIdOf, ensureRuntime, type FrameLayer } from './layers';
import { durationOf, importSound, onPreview, playPreview, previewing, stopPreview, type Sound } from './audio';
import { SubtitlesPanel } from './SubtitlesPanel';
import { StoryEmbed } from './StoryEmbed';
import { TransitionsPanel } from './TransitionsPanel';
import { MotionGraphicsPanel } from './MotionGraphicsPanel';
import { Scene3DPanel, openSceneTracking } from './Scene3DPanel';
import { isFootage } from './transitions';
import { FRAME_TABS, type FrameTab } from './FrameRail';
import { T, seg, segWrap, pick } from './ui';

export interface SelectedClip { clipId?: string; src?: string; startMs: number; endMs: number }
export interface FramePanelProps {
  projectId: string; folder: string; film: Film | null; timeMs: number; width: number; tab: FrameTab; story?: 'chat' | 'reddit' | 'wyr' | null;
  edit: (ops: Op[], label: string) => Promise<string | null>;
  selected: SelectedClip | null; onSelectClip: (clipId: string) => void; onClose: () => void; notify: (msg: string) => void;
  /** Label the line a clip opened (its track's name) */
  onNameLine?: (clipId: string, label: string) => void;
}

/** where the last picture (not a sound) on the timeline ends, in seconds */
const pictureEnd = (film: Film | null) => Math.max(0, ...(film?.tracks ?? []).flatMap((t) => spans(t.clips).filter((_, i) => !/\.(mp3|wav|m4a|aac|ogg|flac|opus)(?:[#?]|$)/i.test(t.clips[i].src)).map((x) => x.end ?? 0)));
export function FramePanel(p: FramePanelProps) {
  const at = p.timeMs / 1000;
  const [busy, setBusy] = React.useState(false);
  const run = async (what: () => Promise<void>) => { setBusy(true); try { await what(); } catch (e) { p.notify(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  /* a project made earlier gets this version of the layer runtime (fixes reach old stories too) */
  const hasLayers = !!p.film?.tracks.some((t) => t.clips.some((c) => isFrameSrc(c.src)));
  React.useEffect(() => { if (hasLayers) void ensureRuntime(p.projectId, p.folder).catch(() => {}); }, [hasLayers, p.projectId, p.folder]);

  const addLayer = (layer: FrameLayer) => run(async () => {
    await writeLayer(p.projectId, layer);
    const placed = placeClip(p.film, { src: framePath(layer.id), id: layer.id, time: [0, round(layer.duration)] }, at, layer.duration, 'overlay');
    const failed = await p.edit([placed.op], 'Add layer');
    if (failed) throw new Error(failed);
    if (placed.opened) p.onNameLine?.(layer.id, placed.opened.label);
    p.onSelectClip(layer.id);
  });
  const selectedLayerId = p.selected && isFrameSrc(p.selected.src) ? layerIdOf(p.selected.src!) : null;
  /* the last video or photo picked on the timeline, kept while other tools are open: opening Transitions clears the
     timeline's selection, and the transition still goes on the clip that was picked */
  const [lastFootage, setLastFootage] = React.useState<string | null>(null);
  React.useEffect(() => { if (p.selected?.clipId && isFootage(p.selected.src)) setLastFootage(p.selected.clipId); }, [p.selected?.clipId, p.selected?.src]);
  const addSound = (s: Sound) => run(async () => {
    const path = await importSound(p.projectId, s);
    /* music fits the picture: a song longer than the rest of the film ends with it, not minutes after the last shot */
    const full = Math.max(0.1, durationOf(s)), left = pictureEnd(p.film) - at;
    const len = p.tab === 'music' && left > 1 ? Math.min(full, left) : full, id = `snd-${Date.now().toString(36)}`;
    const placed = placeClip(p.film, { src: path, id, time: [0, round(len)] }, at, len, 'audio');
    const fail = await p.edit([placed.op], `Add ${s.name}`);
    if (fail) throw new Error(fail);
    if (placed.opened) p.onNameLine?.(id, placed.opened.label);
  });
  const title = p.tab === 'graphics' ? 'Motion Graphics' : p.tab === 'scene3d' ? '3D' : FRAME_TABS.find((t) => t.id === p.tab)?.label ?? '';

  return (
    <aside aria-label="Shorts tools" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--dock-pane)] text-[var(--text)]" style={{ width: '100%', maxWidth: p.width }}>
      {p.tab !== 'subtitles' ? (
        <div className={PANE_BAR}>
          <span className={`${PANE_TITLE} flex-1 px-1.5 text-[13px] font-semibold text-[var(--text)]`}>{title}</span>
          <button type="button" aria-label="Hide panel" className={PANE_BTN} onClick={p.onClose}><X size={PANE_ICON} /></button>
        </div>
      ) : null}
      {p.tab === 'stories' ? (
        <div className="min-h-0 flex-1">
          <StoryEmbed projectId={p.projectId} folder={p.folder} film={p.film} timeMs={p.timeMs} edit={p.edit} notify={p.notify} selected={p.selected} onSelectClip={p.onSelectClip} start={p.story} onNameLine={p.onNameLine} />
        </div>
      ) : null}
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${p.tab === 'stories' ? 'hidden' : ''}`}>
        {p.tab === 'subtitles' && <SubtitlesPanel projectId={p.projectId} folder={p.folder} film={p.film} timeMs={p.timeMs} edit={p.edit} notify={p.notify} onNameLine={p.onNameLine} />}
        <div className="px-2.5 pb-4">
          {p.tab === 'layers' && <LayersTab busy={busy} addLayer={addLayer} onSceneText={openSceneTracking} />}
          {p.tab === 'animate' && <AnimateTab projectId={p.projectId} folder={p.folder} layerId={selectedLayerId} duration={p.selected ? (p.selected.endMs - p.selected.startMs) / 1000 : 0} notify={p.notify} />}
          {p.tab === 'transitions' && <TransitionsPanel projectId={p.projectId} folder={p.folder} film={p.film} edit={p.edit} notify={p.notify} selected={p.selected} remembered={lastFootage} timeMs={p.timeMs} onSelectClip={p.onSelectClip} onNameLine={p.onNameLine} />}
          {p.tab === 'graphics' && <MotionGraphicsPanel projectId={p.projectId} film={p.film} timeMs={p.timeMs} edit={p.edit} notify={p.notify} onSelectClip={p.onSelectClip} onNameLine={p.onNameLine} />}
          {p.tab === 'scene3d' && <Scene3DPanel projectId={p.projectId} folder={p.folder} film={p.film} timeMs={p.timeMs} edit={p.edit} notify={p.notify} selected={p.selected} remembered={lastFootage} onSelectClip={p.onSelectClip} onNameLine={p.onNameLine} />}
          {p.tab === 'music' && <MusicTab addSound={addSound} busy={busy} />}
          {p.tab === 'sfx' && <SfxTab addSound={addSound} busy={busy} />}
        </div>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- Elements */
const SHAPES: { type: string; label: string; icon: React.ReactNode; extra?: Partial<FrameLayer> }[] = [
  { type: 'rect', label: 'Rectangle', icon: <Square size={18} strokeWidth={1.6} /> }, { type: 'ellipse', label: 'Circle', icon: <Circle size={18} strokeWidth={1.6} />, extra: { width: 22, height: 12.4 } },
  { type: 'triangle', label: 'Triangle', icon: <Triangle size={18} strokeWidth={1.6} /> }, { type: 'star', label: 'Star', icon: <Star size={18} strokeWidth={1.6} /> },
  { type: 'diamond', label: 'Diamond', icon: <Diamond size={18} strokeWidth={1.6} /> }, { type: 'polygon', label: 'Hexagon', icon: <Hexagon size={18} strokeWidth={1.6} />, extra: { sides: 6 } },
  { type: 'line', label: 'Line', icon: <Minus size={18} strokeWidth={1.6} />, extra: { height: 4, strokeWidth: 8 } }, { type: 'arrow', label: 'Arrow', icon: <ArrowRight size={18} strokeWidth={1.6} />, extra: { height: 8, strokeWidth: 8 } },
];
function LayersTab({ addLayer, busy, onSceneText }: { addLayer: (l: FrameLayer) => void; busy: boolean; onSceneText: () => void }) {
  return (
    <div className="flex flex-col gap-4 pt-1">
      <section className={T.section}>
        <h3 className={T.heading}>Text</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" disabled={busy} onClick={() => addLayer(makeLayer('text', { name: 'Text' }))} className={`${T.tile} min-h-12 gap-2`}><Type size={16} strokeWidth={1.6} /><span>Add text</span></button>
          <button type="button" onClick={onSceneText} className={`${T.tile} min-h-12 gap-2`}><Diamond size={16} strokeWidth={1.6} /><span>Place in scene</span></button>
        </div>
        <p className={T.hint}>Place in scene tracks a surface and matches its angle.</p>
        <details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Text styles</summary><div className="mt-2 grid grid-cols-2 gap-1.5">
          {[
            { label: 'Heading', icon: <Heading1 size={18} strokeWidth={1.6} />, over: { name: 'Heading', text: 'BIG TITLE', fontSize: 130, weight: 900, strokeWidth: 4 } },
            { label: 'Caption', icon: <SubIcon size={18} strokeWidth={1.6} />, over: { name: 'Caption', text: 'Caption', fontSize: 56, weight: 700, y: 82 } },
          ].map((x) => (
            <button key={x.label} type="button" disabled={busy} onClick={() => addLayer(makeLayer('text', x.over as Partial<FrameLayer>))} className={`${T.tile} h-[68px] flex-col`}>{x.icon}<span className="text-[11px]">{x.label}</span></button>
          ))}
        </div></details>
      </section>
      <section className={T.section}>
        <h3 className={T.heading}>Shapes</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {SHAPES.map((s) => (
            <button key={s.type} title={s.label} aria-label={s.label} disabled={busy} className={`${T.tile} aspect-square flex-col`}
              onClick={() => addLayer(makeLayer('shape', { name: s.label, shapeType: s.type, ...(['ellipse', 'star', 'diamond', 'polygon', 'triangle'].includes(s.type) ? { width: 24, height: 13.5 } : {}), ...s.extra }))}>{s.icon}</button>
          ))}
        </div>
      </section>
      <section className={T.section}>
        <h3 className={T.heading}>Media</h3>
        <button type="button" className={`${T.tile} h-10`} onClick={() => window.dispatchEvent(new CustomEvent('frame-open-media'))}><ImagePlus size={16} strokeWidth={1.6} />Add your own video or image</button>
      </section>
      <p className={T.hint}>Each element is its own clip. Select it to move, keyframe and style it in the inspector; drag it on the picture to place it.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Animate */
function AnimateTab({ projectId, folder, layerId, duration, notify }: { projectId: string; folder: string; layerId: string | null; duration: number; notify: (m: string) => void }) {
  const [cat, setCat] = React.useState(PRESET_CATEGORIES[0] as string);
  const list = (ANIMATION_PRESETS as { id: string; name: string; category: string }[]).filter((x) => x.category === cat);
  const apply = async (id: string) => {
    if (!layerId) { notify('Select an element on the timeline first.'); return; }
    const layer = await readLayer(folder, layerId);
    if (!layer) { notify('That element could not be read.'); return; }
    await writeLayer(projectId, withPreset({ ...layer, duration: duration || layer.duration }, id));
    notify('Animation added — its keyframes are in the inspector.');
  };
  return (
    <div className="flex flex-col gap-3 pt-1">
      <p className={T.hint}>{layerId ? 'Pick an animation: it becomes editable keyframes on the selected element.' : 'Select a text or shape element, then pick an animation.'}</p>
      <div className="flex flex-wrap gap-1">
        {PRESET_CATEGORIES.map((c: string) => <button key={c} onClick={() => setCat(c)} className={`h-7 rounded-full border px-3 text-[11.5px] ${pick(cat === c)}`}>{c}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {list.map((x) => <button key={x.id} disabled={!layerId} className={`${T.tile} h-9`} onClick={() => apply(x.id)}>{x.name}</button>)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Sounds */
function usePreviewing() { return React.useSyncExternalStore(onPreview, previewing); }
function SoundRow({ s, sub, addSound, busy, credit, unavailable, availabilityLabel='Unresolved recording', sourceUrl }: { s: Sound; sub: string; addSound: (s: Sound) => void; busy: boolean; credit?: string; unavailable?: string | null; availabilityLabel?:string; sourceUrl?: string }) {
  const playing = usePreviewing() === s.id;
  const [error,setError]=React.useState('');
  return (
    <div role="listitem" data-sound-id={s.id} className="group flex min-h-12 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-[var(--bg-hover)]">
      <button type="button" disabled={!!unavailable} title={unavailable??undefined} aria-label={playing ? `Stop ${s.name}` : `Play ${s.name}`} onClick={() => {setError('');void playPreview(s).catch(e=>setError(e.message));}}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-35 ${playing ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)]'}`}>
        {playing ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-px" />}
      </button>
      <span className="min-w-0 flex-1 leading-tight">
        <span data-sound-name className={`block break-words text-[12.5px] font-medium ${playing ? 'text-[var(--accent)]' : ''}`} title={credit}>{s.name}</span>
        <span title={error||unavailable||sub} role={error?'alert':undefined} className={`block truncate text-[11px] ${error?'text-[var(--err)]':unavailable?'text-[var(--warn)]':'text-[var(--text-faint)]'}`}>{error||(unavailable?availabilityLabel:sub)}</span>
      </span>
      {sourceUrl&&!unavailable?<a href={sourceUrl} target="_blank" rel="noreferrer" aria-label={`Source for ${s.name}`} title="Exact source recording" className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:text-[var(--accent)] focus-visible:outline-2"><ExternalLink size={12}/></a>:null}
      <button type="button" data-sound-add disabled={busy||!!unavailable} title={unavailable??undefined} aria-label={`Add ${s.name} to timeline`} onClick={() => addSound(s)}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11.5px] font-medium text-[var(--text-dim)] opacity-70 transition hover:bg-[var(--bg)] hover:text-[var(--accent)] group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"><Plus size={13} /><span data-sound-add-label>Add</span></button>
    </div>
  );
}
const dur = (s: Sound) => { const d = durationOf(s); return d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${d.toFixed(1)}s`; };
const SearchBox = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
  <label className="relative block"><Search size={14} className="pointer-events-none absolute left-2.5 top-[9px] text-[var(--text-faint)]" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${T.field} pl-8`} /></label>
);

function MusicTab({ addSound, busy }: { addSound: (s: Sound) => void; busy: boolean }) {
  const [q, setQ] = React.useState('');
  React.useEffect(() => () => stopPreview(), []);
  const found = searchMusic(q, 'All') as (Sound & { section: string; artist?: string; take?: boolean; attribution?: string; bundled?: boolean })[];
  return (
    <div className="flex flex-col gap-3 pt-1">
      <SearchBox value={q} onChange={setQ} placeholder="Search music" />
      {(MUSIC_SECTIONS as { id: string; title: string; sub: string }[]).map((sec) => {
        const items = found.filter((m) => m.section === sec.id);
        return items.length ? (
          <section key={sec.id} role="list" aria-label={sec.title} className={T.section}>
            <h3 className={T.heading}>{sec.title.replace(/FRAME/g, 'Shorts')}</h3>
            <div>{items.map((m) => <SoundRow key={m.id} s={m} busy={busy} addSound={addSound} credit={m.attribution}
              sub={`${m.artist ?? 'Shorts'}${m.take ? ' · original recording' : ` · ${dur(m)}`}${m.bundled ? ' · CC BY 4.0' : ''}`} />)}</div>
          </section>
        ) : null;
      })}
      {!found.length && <p className={T.hint}>No music matches “{q}”.</p>}
      <p className={T.hint}>Named songs use your local recordings. Kevin MacLeod tracks require the credit shown on hover.</p>
    </div>
  );
}

function SfxTab({ addSound, busy }: { addSound: (s: Sound) => void; busy: boolean }) {
  const [q, setQ] = React.useState('');
  const [group, setGroup] = React.useState<'normal' | 'brainrot'>('normal');
  const [library,setLibrary]=React.useState<Record<string,any>|null>(null),[libraryError,setLibraryError]=React.useState(''),[retry,setRetry]=React.useState(0);
  React.useEffect(()=>{const controller=new AbortController();setLibraryError('');void fetch('/api/editor-audio/library',{cache:'no-store',signal:controller.signal}).then(r=>{if(!r.ok)throw Error('Recording library is unavailable.');return r.json();}).then(r=>setLibrary(r.recordings??{})).catch(e=>{if(!controller.signal.aborted)setLibraryError(e.message);});return()=>controller.abort();},[retry]);
  React.useEffect(() => () => stopPreview(), []);
  const all = searchSfx(q, {}) as (Sound & { group?: string; category?: string })[];
  const items = all.filter((e) => (group === 'brainrot' ? e.group === 'brainrot' : e.group !== 'brainrot' && e.category !== 'My sounds'));
  return (
    <div className="flex flex-col gap-3 pt-1">
      <SearchBox value={q} onChange={setQ} placeholder="Search sounds" />
      <div className={segWrap}>
        <button type="button" className={seg(group === 'normal')} onClick={() => setGroup('normal')}>Normal</button>
        <button type="button" className={seg(group === 'brainrot')} onClick={() => setGroup('brainrot')}>Brainrot</button>
      </div>
      <div role="list" aria-label={group === 'normal' ? 'Normal sounds' : 'Brainrot sounds'}>
        {items.map((e) => {const source=soundRecordingSource(e.id),unresolved=source?.status!=='verified',issue=unresolved?`${e.name}: no exact named source is verified.`:!library?libraryError||'Checking recording…':recordingIssue(e.id,library[e.id],e.name);return <SoundRow key={e.id} s={e} busy={busy} addSound={addSound} unavailable={issue} availabilityLabel={unresolved?'Unresolved recording':!library&&!libraryError?'Checking recording…':'Recording unavailable'} sourceUrl={source?.pageUrl} sub="Exact source verified"/>;})}
      </div>
      {libraryError&&<p role="alert" className={T.hint}>{libraryError} <button type="button" className="text-[var(--accent)] underline" onClick={()=>setRetry(x=>x+1)}>Retry</button></p>}
      {!items.length && <p className={T.hint}>No sounds match “{q}”.</p>}
      <p className={T.hint}>{SFX_COUNT} named effects · {SFX_CATALOG.filter(e=>soundRecordingSource(e.id)?.status!=='verified').length} unresolved. Original labels are kept. Unresolved entries cannot play or import until their exact recording is verified.</p>
    </div>
  );
}
