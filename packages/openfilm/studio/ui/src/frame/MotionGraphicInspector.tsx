import React from 'react';
import { Play, Trash2, Save, Upload, X, MapPin, Volume2 } from 'lucide-react';
import type { Film, Op } from '@/api';
import { graphicById, BRAND_KITS } from './motion-graphics.js';
import { presetStore, type SavedPreset } from './mg';
import { addSfxNear } from './sfx-cues';
import { spans, lineOf } from './lines';
import { round, type FrameLayer } from './layers';
import { T } from './ui';
import { searchPlaces, type Place } from './places';

/* A motion graphic's settings, generated from what that graphic has (only its own controls): its text, numbers,
   places, colours and media, its length (the animation keeps its proportions), its brand kit, a sound, and saving it
   as a preset. Changes show on the video at once. */
type Param = { key: string; label: string; type: string; min?: number; max?: number; step?: number; options?: string[]; hint?: string };
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
const field = 'h-7 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] outline-none focus:border-[var(--accent)]';

export function PlaceField({ value, onChange, onRemove }: { value: Place | null; onChange: (p: Place | null) => void; onRemove?: () => void }) {
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<Place[] | null>(null);
  const [coords, setCoords] = React.useState(false);
  React.useEffect(() => { let live = true; if (q.trim().length < 2) { setHits(null); return; } void searchPlaces(q).then((r) => { if (live) setHits(r); }); return () => { live = false; }; }, [q]);
  return (
    <div className="flex flex-col gap-1">
      {value ? (
        <div className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[12px]">
          <MapPin size={12} className="shrink-0 text-[var(--accent)]" />
          <input value={value.label ?? value.name} onChange={(e) => onChange({ ...value, label: e.target.value })} className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Label shown" />
          <span className="shrink-0 text-[10.5px] text-[var(--text-faint)]">{value.country} · {value.lat.toFixed(2)}, {value.lon.toFixed(2)}</span>
          <button type="button" aria-label="Clear place" onClick={() => (onRemove ? onRemove() : onChange(null))} className="text-[var(--text-faint)] hover:text-[var(--text)]"><X size={12} /></button>
        </div>
      ) : null}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? 'Change place…' : 'Search a city or place (e.g. Paris, France)'} className={field} aria-label="Search places" />
      {hits ? (
        hits.length ? (
          <div className="flex flex-col rounded-md border border-[var(--border)] bg-[var(--bg)] py-0.5">
            {hits.map((h) => (
              <button key={`${h.name}${h.lat}${h.lon}`} type="button" onClick={() => { onChange(h); setQ(''); setHits(null); }} className="flex items-center justify-between px-2 py-1 text-left text-[12px] hover:bg-[var(--bg-hover)]">
                <span>{h.name}<span className="text-[var(--text-faint)]">{h.region ? `, ${h.region}` : ''}</span></span><span className="text-[10.5px] text-[var(--text-faint)]">{h.country}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-[11px] text-[var(--text-muted)]">No place called “{q}” in the gazetteer. Enter its coordinates instead.</p>
      ) : null}
      <button type="button" onClick={() => setCoords((v) => !v)} className="self-start text-[11px] text-[var(--text-faint)] hover:text-[var(--text)]">{coords ? 'Hide coordinates' : 'Enter latitude / longitude'}</button>
      {coords ? <Coords value={value} onChange={onChange} /> : null}
    </div>
  );
}
function Coords({ value, onChange }: { value: Place | null; onChange: (p: Place) => void }) {
  const [lat, setLat] = React.useState(String(value?.lat ?? '')); const [lon, setLon] = React.useState(String(value?.lon ?? '')); const [name, setName] = React.useState(value?.label ?? '');
  const ok = Number.isFinite(+lat) && Number.isFinite(+lon) && lat !== '' && lon !== '' && Math.abs(+lat) <= 90 && Math.abs(+lon) <= 180 && name.trim();
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-1">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${field} col-span-2`} />
      <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Latitude" className={field} />
      <input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Longitude" className={field} />
      <button type="button" disabled={!ok} onClick={() => onChange({ name: name.trim(), label: name.trim(), lat: +lat, lon: +lon })} className={`${T.secondary} col-span-2 disabled:opacity-40`}>Use this point</button>
    </div>
  );
}

function MediaField({ value, projectId, folder, film, onChange }: { value: string | null; projectId: string; folder: string; film: Film | null; onChange: (path: string | null) => void }) {
  const files = React.useMemo(() => [...new Set((film?.tracks ?? []).flatMap((t) => t.clips).map((c) => c.src.split('#')[0]).filter((s) => lineOf(s) === 'media' && !s.startsWith('frame/')))], [film]);
  const input = React.useRef<HTMLInputElement>(null);
  const upload = async (f: File) => {
    const path = `assets/${f.name.replace(/[^\w.-]+/g, '-')}`;
    const r = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body: f });
    if (r.ok) onChange(((await r.json()) as { path: string }).path ?? path);
  };
  return (
    <div className="flex items-center gap-1.5">
      {value ? <img src={/\.(mp4|mov|webm|m4v|mkv)$/i.test(value) ? undefined : `${folder}${value}`} alt="" className="h-9 w-9 shrink-0 rounded-md bg-[var(--fill-tsp)] object-cover" /> : <span className="h-9 w-9 shrink-0 rounded-md border border-dashed border-[var(--border)]" />}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className={field}>
        <option value="">{files.length ? 'Choose from this video…' : 'Upload a photo or clip'}</option>
        {files.map((f) => <option key={f} value={f}>{f.split('/').pop()}</option>)}
        {value && !files.includes(value) ? <option value={value}>{value.split('/').pop()}</option> : null}
      </select>
      <button type="button" aria-label="Upload" onClick={() => input.current?.click()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)]"><Upload size={13} /></button>
      <input ref={input} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
    </div>
  );
}

export function MotionGraphicInspector({ layer, clipId, projectId, folder, film, commit, edit, notify }: {
  layer: FrameLayer; clipId?: string; projectId: string; folder: string; film: Film | null;
  commit: (l: FrameLayer, delay?: number) => void; edit: (ops: Op[], label: string) => Promise<string | null>; notify?: (m: string) => void;
}) {
  const def = graphicById(layer.graphic) as { id: string; name: string; about?: string; sfx?: string | null; params: Param[]; defaults: Record<string, any>; duration: number } | undefined;
  const start = React.useMemo(() => { for (const tr of film?.tracks ?? []) { const i = tr.clips.findIndex((c) => c.id === clipId); if (i >= 0) return spans(tr.clips)[i].start; } return 0; }, [film, clipId]);
  if (!def) return <p className="pt-3 text-[12px] text-[var(--text-muted)]">This graphic is not in this version of the editor.</p>;
  const P = { ...def.defaults, ...(layer.params ?? {}) } as Record<string, any>;
  const set = (patch: Record<string, unknown>) => commit({ ...layer, params: { ...P, ...patch } }, 150);
  const setLength = (d: number) => { if (!clipId) return; commit({ ...layer, duration: round(d) }, 100); void edit([{ op: 'set', clip: clipId, field: 'time', value: [0, round(d)] } as Op], 'Graphic length'); };
  const brandKeys = new Set(['accent', 'theme', 'speed']);
  const content = def.params.filter((p) => !brandKeys.has(p.key));
  const look = def.params.filter((p) => brandKeys.has(p.key));
  const control = (p: Param) => {
    const v = P[p.key];
    switch (p.type) {
      case 'text': return <label key={p.key} className={row}><span className="w-[84px] shrink-0">{p.label}</span><input value={v ?? ''} onChange={(e) => set({ [p.key]: e.target.value })} className={field} /></label>;
      case 'list': return <label key={p.key} className="flex flex-col gap-1 text-[12px] text-[var(--text-dim)]"><span>{p.label}{p.hint ? <span className="text-[var(--text-faint)]"> · {p.hint}</span> : null}</span>
        <textarea value={v ?? ''} rows={Math.min(7, Math.max(3, String(v ?? '').split('\n').length))} onChange={(e) => set({ [p.key]: e.target.value })} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] leading-relaxed outline-none focus:border-[var(--accent)]" /></label>;
      case 'number': return <label key={p.key} className={row}><span className="w-[84px] shrink-0">{p.label}</span>
        {(p.max ?? 0) - (p.min ?? 0) <= 1000 ? <input type="range" min={p.min} max={p.max} step={p.step} value={Number(v ?? 0)} onChange={(e) => set({ [p.key]: Number(e.target.value) })} className="h-1 flex-1 cursor-pointer accent-[var(--accent)]" /> : null}
        <input type="number" min={p.min} max={p.max} step={p.step} value={Number(v ?? 0)} onChange={(e) => set({ [p.key]: Number(e.target.value) })} className="h-7 w-[86px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 text-[12px] tabular-nums outline-none focus:border-[var(--accent)]" /></label>;
      case 'color': return <label key={p.key} className={row}><span className="w-[84px] shrink-0">{p.label}</span><input type="color" value={v || P.accent || '#2563eb'} onChange={(e) => set({ [p.key]: e.target.value })} className="h-6 w-10 cursor-pointer rounded border-0 bg-transparent p-0" />
        {v && p.key !== 'accent' ? <button type="button" onClick={() => set({ [p.key]: '' })} className="text-[10.5px] text-[var(--text-faint)] hover:text-[var(--text)]">use accent</button> : null}</label>;
      case 'select': return <label key={p.key} className={row}><span className="w-[84px] shrink-0">{p.label}</span><select value={v ?? ''} onChange={(e) => set({ [p.key]: e.target.value })} className={field}>{(p.options ?? []).map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}</select></label>;
      case 'bool': return <label key={p.key} className={row}><span className="flex-1">{p.label}</span><input type="checkbox" checked={!!v} onChange={(e) => set({ [p.key]: e.target.checked })} className="accent-[var(--accent)]" /></label>;
      case 'media': {
        /* item slots past the graphic's count are hidden */
        const m = /^(item|photo|card)(\d)$/.exec(p.key); if (m && P.count && Number(m[2]) > P.count) return null;
        return <div key={p.key} className="flex flex-col gap-1 text-[12px] text-[var(--text-dim)]"><span>{p.label}</span><MediaField value={v ?? null} projectId={projectId} folder={folder} film={film} onChange={(path) => set({ [p.key]: path })} /></div>;
      }
      case 'place': return <div key={p.key} className="flex flex-col gap-1 text-[12px] text-[var(--text-dim)]"><span>{p.label}</span><PlaceField value={v ?? null} onChange={(pl) => set({ [p.key]: pl })} /></div>;
      case 'places': {
        const listV: Place[] = Array.isArray(v) ? v : [];
        return (
          <div key={p.key} className="flex flex-col gap-1.5 text-[12px] text-[var(--text-dim)]"><span>{p.label}</span>
            {listV.map((pl, i) => <PlaceField key={i} value={pl} onChange={(np) => set({ [p.key]: np ? listV.map((x, j) => (j === i ? np : x)) : listV.filter((_, j) => j !== i) })} onRemove={() => set({ [p.key]: listV.filter((_, j) => j !== i) })} />)}
            <AddPlace onAdd={(np) => set({ [p.key]: [...listV, np] })} />
          </div>
        );
      }
      default: return null;
    }
  };
  const savePreset = () => {
    const name = window.prompt('Name this preset', `${def.name} — custom`); if (!name) return;
    const list = presetStore.get<SavedPreset[]>([]); presetStore.set([{ id: `p${Date.now().toString(36)}`, name, graphic: def.id, params: { ...P }, duration: layer.duration }, ...list]);
    notify?.('Saved — find it under Motion Graphics → My presets.');
  };
  const addSound = async () => { if (!def.sfx) return; const fail = await addSfxNear(projectId, film, def.sfx, start, edit); notify?.(fail ?? 'Sound added under the graphic.'); };

  return (
    <div className="flex flex-col gap-3 pt-2">
      {def.about ? <p className="-mt-1 text-[11px] leading-snug text-[var(--text-muted)]">{def.about}</p> : null}
      <label className={row}><span className="w-[84px] shrink-0">Length</span>
        <input type="range" min={0.5} max={Math.max(12, def.duration * 3)} step={0.1} value={layer.duration} onChange={(e) => setLength(Number(e.target.value))} className="h-1 flex-1 cursor-pointer accent-[var(--accent)]" />
        <span className="w-10 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{layer.duration.toFixed(1)}s</span></label>
      <div className="flex flex-col gap-2.5">{content.map(control)}</div>
      <details className="rounded-lg border border-[var(--border-soft)] px-2 py-1.5" open>
        <summary className="cursor-pointer text-[12px] font-medium text-[var(--text)]">Look</summary>
        <div className="flex flex-col gap-2.5 pt-2">
          <label className={row}><span className="w-[84px] shrink-0">Brand kit</span>
            <select value="" onChange={(e) => { const kit = (BRAND_KITS as Record<string, Record<string, unknown>>)[e.target.value]; if (kit) set(Object.fromEntries(Object.entries(kit).filter(([k]) => def.params.some((p) => p.key === k)))); }} className={field}>
              <option value="">Apply a kit…</option>{Object.keys(BRAND_KITS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select></label>
          {look.map(control)}
        </div>
      </details>
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" className={T.secondary} onClick={() => window.dispatchEvent(new CustomEvent('frame-play-from', { detail: Math.max(0, (start - 0.3) * 1000) }))}><Play size={13} />Preview</button>
        <button type="button" className={T.secondary} onClick={savePreset}><Save size={13} />Save as preset</button>
        {def.sfx ? <button type="button" className={T.secondary} onClick={() => void addSound()}><Volume2 size={13} />Add sound</button> : null}
        <button type="button" className={T.secondary} onClick={() => { if (clipId) void edit([{ op: 'remove', clip: clipId } as Op], 'Remove graphic'); }}><Trash2 size={13} />Remove</button>
      </div>
    </div>
  );
}
function AddPlace({ onAdd }: { onAdd: (p: Place) => void }) {
  const [open, setOpen] = React.useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="self-start text-[11.5px] font-medium text-[var(--accent)]">+ Add a place</button>;
  return <PlaceField value={null} onChange={(p) => { if (p) { onAdd(p); setOpen(false); } }} />;
}
