import React from 'react';
import { Plus, Search, Star, ArrowLeft } from 'lucide-react';
import type { Film, Op } from '@/api';
import { GRAPHICS, MG_CATEGORIES, BRAND_KITS, renderGraphic, MEDIA_KEYS } from './motion-graphics.js';
import { addGraphic, brandStore, favStore, presetStore, recentStore, world, type SavedPreset } from './mg';
import { T } from './ui';
import { TripBuilder } from './TripBuilder';

/* Motion Graphics: a library of editable graphics. Each card is the graphic itself, drawn by the renderer the video
   uses: it rests on a representative frame and plays while the pointer is on it (one at a time). A card opens its
   description and Add to timeline; once added, the graphic is an ordinary clip whose settings are in the inspector. */
type Def = { id: string; name: string; category: string; featured: boolean; about: string; duration: number; map?: boolean; params: { key: string; type: string }[]; defaults: Record<string, any> };
const ALL = GRAPHICS as unknown as Def[];
const SAMPLES = ['gta-01', 'minecraft-01', 'subway-01', 'trackmania-01'].map((n) => `/assets/media/fake-text-gameplay/${n}.jpg`);
let images: HTMLImageElement[] | null = null;
function sampleImages() { images ??= SAMPLES.map((src) => { const i = new Image(); i.src = src; return i; }); return images; }
/* the cards' media: sample stills in every media slot, so each preview shows what the graphic does */
const sampleMedia = (def: Def) => { const keys = MEDIA_KEYS(def); const imgs = sampleImages(); return (k: string) => { const i = keys.indexOf(k); return i >= 0 && imgs[i % imgs.length].complete ? imgs[i % imgs.length] : null; }; };
const W = 216, H = 384;

function Card({ def, onOpen, fav, onFav }: { def: Def; onOpen: () => void; fav: boolean; onFav: () => void }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const raf = React.useRef(0);
  const draw = React.useCallback((t: number) => {
    const c = ref.current; const g = c?.getContext('2d'); if (!c || !g) return;
    renderGraphic(g, c.width, c.height, { graphic: def.id, duration: def.duration, params: def.defaults }, t, sampleMedia(def), def.map ? world() : null);
  }, [def]);
  const rest = React.useCallback(() => draw(def.duration * 0.62), [def.duration, draw]);
  React.useEffect(() => { const t = setTimeout(rest, 30); const imgs = sampleImages(); imgs.forEach((i) => i.addEventListener('load', rest)); return () => { clearTimeout(t); cancelAnimationFrame(raf.current); imgs.forEach((i) => i.removeEventListener('load', rest)); }; }, [rest]);
  const play = () => {
    const t0 = performance.now();
    const tick = (now: number) => { draw(((now - t0) / 1000) % (def.duration + 0.6)); raf.current = requestAnimationFrame(tick); };
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick);
  };
  const stop = () => { cancelAnimationFrame(raf.current); rest(); };
  return (
    <div className="group relative flex flex-col gap-1 rounded-lg p-1 transition hover:bg-[var(--bg-hover)]">
      <button type="button" onClick={onOpen} onMouseEnter={play} onMouseLeave={stop} onFocus={play} onBlur={stop} className="text-left" title={def.name}>
        <canvas ref={ref} width={W} height={H} className="block aspect-[9/16] w-full rounded-md bg-[var(--fill-tsp)] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] group-hover:scale-[1.02]" />
        <span className="mt-1 block truncate px-0.5 text-[11px] text-[var(--text-dim)] group-hover:text-[var(--text)]">{def.name}</span>
      </button>
      <button type="button" aria-label={fav ? `Remove ${def.name} from favourites` : `Add ${def.name} to favourites`} onClick={onFav}
        className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition ${fav ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <Star size={12} fill={fav ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}

function Detail({ def, onBack, onAdd, busy }: { def: Def; onBack: () => void; onAdd: () => void; busy: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = (now: number) => { const c = ref.current; const g = c?.getContext('2d'); if (c && g) renderGraphic(g, c.width, c.height, { graphic: def.id, duration: def.duration, params: def.defaults }, ((now - t0) / 1000) % (def.duration + 0.8), sampleMedia(def), def.map ? world() : null); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [def]);
  return (
    <div className="flex flex-col gap-3 pt-1" style={{ animation: 'mg-in .24s cubic-bezier(.22,1,.36,1) both' }}>
      <button type="button" onClick={onBack} className="flex items-center gap-1 self-start text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]"><ArrowLeft size={14} />All graphics</button>
      <canvas ref={ref} width={360} height={640} className="mx-auto block w-[180px] rounded-lg shadow-[0_6px_20px_rgba(0,0,0,0.16)]" />
      <div>
        <h3 className="text-[14px] font-semibold text-[var(--text)]">{def.name}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">{def.about || `${def.category} graphic. Every word, number, colour and image is editable after you add it.`}</p>
        <p className="mt-1 text-[11px] text-[var(--text-faint)]">{def.duration.toFixed(1)} s · change the length and it keeps its timing</p>
      </div>
      <button type="button" disabled={busy} onClick={onAdd} className={`${T.primary} h-9`}><Plus size={14} />Add to timeline</button>
    </div>
  );
}

export function MotionGraphicsPanel({ projectId, film, timeMs, edit, notify, onSelectClip, onNameLine }: {
  projectId: string; film: Film | null; timeMs: number; notify: (m: string) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>; onSelectClip: (id: string) => void; onNameLine?: (clipId: string, label: string) => void;
}) {
  const [cat, setCat] = React.useState<string>('All');
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<Def | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [favs, setFavs] = React.useState<string[]>(() => favStore.get<string[]>([]));
  const [brand, setBrand] = React.useState<string>(() => brandStore.get<string>(''));
  const presets = presetStore.get<SavedPreset[]>([]);
  const recent = recentStore.get<string[]>([]);
  const tabs = ['All', ...MG_CATEGORIES.filter(c=>c!=='Featured'), 'Recent', 'Favourites', 'My presets'];
  const shown = q.trim()
    ? ALL.filter((d) => `${d.name} ${d.category} ${d.about}`.toLowerCase().includes(q.toLowerCase()))
    : cat === 'All' ? ALL : cat === 'Recent' ? recent.map((id) => ALL.find((d) => d.id === id)).filter(Boolean) as Def[]
      : cat === 'Favourites' ? ALL.filter((d) => favs.includes(d.id)) : cat === 'My presets' ? [] : ALL.filter((d) => d.category === cat);
  const add = async (graphic: string, over: { params?: Record<string, unknown>; duration?: number; name?: string } = {}) => {
    setBusy(true);
    try {
      const { op, opened, layer } = await addGraphic(projectId, film, graphic, timeMs / 1000, over);
      const fail = await edit([op], `Add ${layer.name}`);
      if (fail) throw new Error(fail);
      if (opened) onNameLine?.(layer.id, opened.label);
      onSelectClip(layer.id);
      notify(`${layer.name} added — edit its text, numbers, places and media in the inspector.`);
      setOpen(null);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const toggleFav = (id: string) => { const next = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id]; setFavs(next); favStore.set(next); };

  if (open) return <Detail def={open} busy={busy} onBack={() => setOpen(null)} onAdd={() => void add(open.id)} />;
  return (
    <div className="flex flex-col gap-3 pt-1">
      <style>{`@keyframes mg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
      <label className="relative block"><Search size={14} className="pointer-events-none absolute left-2.5 top-[9px] text-[var(--text-faint)]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search motion graphics" aria-label="Search motion graphics" className={`${T.field} pl-8`} /></label>
      {!q ? (
        <div className="-mx-0.5 flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {tabs.map((c) => <button key={c} type="button" onClick={() => setCat(c)} className={`h-7 shrink-0 rounded-full px-3 text-[11.5px] transition ${cat === c ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>{c}</button>)}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-[11.5px] text-[var(--text-dim)]"><span className="shrink-0">Brand kit</span>
        <select value={brand} onChange={(e) => { setBrand(e.target.value); brandStore.set(e.target.value); }} className={`${T.small} flex-1`}>
          <option value="">Each graphic’s own look</option>
          {Object.keys(BRAND_KITS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      {!q && cat === 'Travel & Maps' ? (
        <TripBuilder busy={busy} onAdd={(params) => void add('mg.flight', { params, name: params.vehicle === 'car' ? 'Road Trip' : 'Flight' })} />
      ) : null}
      {cat === 'My presets' && !q ? (
        presets.length ? (
          <div className="flex flex-col gap-1">
            {presets.map((p) => <button key={p.id} type="button" disabled={busy} onClick={() => void add(p.graphic, { params: p.params, duration: p.duration, name: p.name })} className={`${T.tile} h-9 justify-between px-3`}><span>{p.name}</span><Plus size={13} /></button>)}
          </div>
        ) : <p className={T.hint}>Save a graphic you have customised (in its inspector, “Save as preset”) to reuse it here.</p>
      ) : (
        <div className="grid grid-cols-2 gap-1" style={{ animation: 'mg-in .24s cubic-bezier(.22,1,.36,1) both' }} key={`${cat}-${q}`}>
          {shown.map((d) => <Card key={d.id} def={d} fav={favs.includes(d.id)} onFav={() => toggleFav(d.id)} onOpen={() => setOpen(d)} />)}
        </div>
      )}
      {!shown.length && cat !== 'My presets' ? <p className={T.hint}>{q ? `No graphics match “${q}”.` : cat === 'Favourites' ? 'Star a graphic to keep it here.' : 'Nothing here yet.'}</p> : null}
      <p className={T.hint}>Hover a card to play it. Graphics are drawn from your settings each frame, so the preview and the export match. Maps use Natural Earth (public domain).</p>
    </div>
  );
}
