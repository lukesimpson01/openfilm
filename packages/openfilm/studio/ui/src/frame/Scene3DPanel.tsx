import {spatialSurfaceMarkers}from'./spatial-guides.js';
import React from 'react';
import { Smartphone, Laptop, Video, Crosshair, ScanLine, Sparkles, Plus, ChevronDown, Snowflake, Image as ImageIcon, Box } from 'lucide-react';
import type { Film, Op } from '@/api';
import { DEVICE_PRESETS, presetScene, addScene3d, DEFAULT_QUICK, START_FROM, FINISH_AT, ROTATIONS, type Quick, type ScreenSpec } from './devices';
import { addCamera, CAMERA_PRESETS, CAMERA3D_PRESETS } from './camera';
import { analyseFootage, findCachedAnalysis, readScanFrames, type AnalysisResult, type Quality, type ScanFrames, type Seen } from './analysis';
import { suggestSpots } from './cling.js';
import { printedOnSurface, crossingPeople } from './printed-subjects.js';
import { orientedQuad, intrinsics } from './local-surface.js';
import { reconstructOcclusion } from './spatial-analysis';
import { findSurface, type FoundSurface } from './surface-client';
import { footageRect, clipFit, clamp, fitItem } from './track-space.js';
import { addTracked, itemFor, EFFECT_MODES, type EffectMode } from './tracked';
import { footageAt } from './zoom';
import { lineOf } from './lines';
import { round, putFile } from './layers';
import { freezeFrame } from './freeze';
import { StageOverlay, ScanOverlay, ScanProgress } from './StageOverlay';
import { ForegroundOutline } from './ForegroundOutline';
import { sceneItem, visibleSurfaceMarkers, referenceInScene, pointInside } from './scene-geometry.js';
import{SpatialPlacementPreview}from'./SpatialPlacementPreview';
import{SpatialPreview}from'./SpatialPreview';
import{anchorFrame,anchorFromGeometry,spatialPoseAt,projectWorld,worldAnchor,surfaceAnchor,cameraRay}from'./spatial-geometry.js';
import { spatialItem } from './spatial-items.js';
import { useSceneTracks } from './useSceneTracks';
import { apply,transformAt } from './track-core.js';
import { T, seg, segWrap } from './ui';
import { ModelsPanel } from './ModelsPanel';
import { requestUniversalTracking } from './universal-open';

/* The 3D tab: three tools behind one switch — Devices (an iPhone or a MacBook playing your video, and presets),
   Camera (2D and 3D cameras as clips, and freezing the video itself) and Track (text and effects inside real footage).
   One tool shows at a time, simple choices first; everything it makes is an ordinary clip you select to edit. */
const results = new Map<string, AnalysisResult>(); /* the last analysis of each clip, kept while the editor is open */
const LABEL: Record<string, string> = { bottomLeft: 'Bottom left', bottomRight: 'Bottom right', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom', topLeft: 'Top left', topRight: 'Top right', behind: 'Far behind', front: 'In front', centre: 'Centre', low: 'Low centre', cinematic: 'Cinematic', subtle: 'Subtle', none: 'None', spin: 'Spin', backToFront: 'Back to front', sideToFront: 'Side to front', tilt: 'Tilt' };
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
type Tool = 'devices' | 'camera' | 'track'|'models';
let lastTool: Tool = 'devices';
/** a surface orientation in a word (normals point into the surface; y is down): null is no tilt */
const facingName=(n:[number,number,number]|null)=>!n?'Flat':Math.abs(n[1])>.95?(n[1]>0?'Floor':'Ceiling'):Math.abs(n[0])>.85?'Side wall':'Wall';
/** how the text would sit for that orientation, drawn small: its quad at the click, fitted into a 30×20 box */
function FacingShape({ normal, click, w, h }: { normal: [number, number, number] | null; click: [number, number]; w: number; h: number }) {
  const q: number[][] = normal ? orientedQuad(click, normal, intrinsics(w, h), { width: 0.4 }) : [[0, 0], [5, 0], [5, 3], [0, 3]];
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), k = Math.min(26 / Math.max(1e-6, Math.max(...xs) - x0), 16 / Math.max(1e-6, Math.max(...ys) - y0));
  const pts = q.map((p) => `${(2 + (p[0] - x0) * k).toFixed(1)},${(2 + (p[1] - y0) * k).toFixed(1)}`).join(' ');
  return <svg aria-hidden width={30} height={20} viewBox="0 0 30 20" className="shrink-0"><polygon points={pts} fill="currentColor" fillOpacity={.18} stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" /></svg>;
}
/** The Elements panel can start the surface-placement flow without adding a regular title first. */
export function openSceneTracking() { lastTool = 'track'; window.dispatchEvent(new CustomEvent('frame-open-tab', { detail: 'scene3d' })); }
const MEDIA = /\.(mp4|mov|webm|m4v|mkv|png|jpe?g|webp|gif|avif)$/i;

const Sel = ({ label, value, options, onChange, names }: { label: string; value: string; options: string[]; onChange: (v: string) => void; names?: Record<string, string> }) => (
  <label className={row}><span className="w-[78px] shrink-0">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className={`${T.small} flex-1`}>{options.map((o) => <option key={o} value={o}>{names?.[o] ?? LABEL[o] ?? o}</option>)}</select></label>
);
const Toggle = ({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) => (
  <label className={`${row} justify-between`}><span>{label}</span><button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-[18px] w-8 rounded-full transition ${on ? 'bg-[var(--accent)]' : 'bg-[var(--fill-tsp)] ring-1 ring-[var(--border)]'}`}><span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-all duration-200 ${on ? 'left-[16px]' : 'left-[2px]'}`} /></button></label>
);
/** a quiet disclosure: closed by default */
function More({ title, children, open: initial = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = React.useState(initial);
  return (
    <div className="flex flex-col">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between rounded-md px-0.5 py-1 text-[11.5px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]">{title}<ChevronDown size={13} className={`transition duration-200 ${open ? 'rotate-180' : ''}`} /></button>
      {open ? <div className="flex flex-col gap-1.5 pt-1" style={{ animation: 'mg-in .2s cubic-bezier(.22,1,.36,1) both' }}>{children}</div> : null}
    </div>
  );
}
/** a large choice card: a picture (a render of the device) or an icon, a title, a line */
function Card({ img, icon, title, sub, on, onClick }: { img?: string; icon: React.ReactNode; title: string; sub: string; on: boolean; onClick: () => void }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`group flex flex-col overflow-hidden rounded-xl border text-left transition duration-200 ${on ? 'border-[var(--accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'border-[var(--border)] hover:border-[var(--border-strong)]'}`}>
      <span className="flex aspect-[4/3] items-center justify-center bg-[linear-gradient(180deg,#f6f7f9,#e9ebef)] dark:bg-[linear-gradient(180deg,#22252b,#16181c)]">
        {img && !broken ? <img src={img} alt="" onError={() => setBroken(true)} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.04]" /> : <span className="text-[var(--text-faint)]">{icon}</span>}
      </span>
      <span className="px-2.5 pb-2 pt-1.5"><span className="block text-[12px] font-semibold text-[var(--text)]">{title}</span><span className="block truncate text-[10.5px] text-[var(--text-muted)]">{sub}</span></span>
    </button>
  );
}

export function Scene3DPanel({ projectId, folder, film, timeMs, edit, notify, selected, remembered, onSelectClip, onNameLine }: {
  projectId: string; folder: string; film: Film | null; timeMs: number; notify: (m: string) => void; edit: (ops: Op[], label: string) => Promise<string | null>;
  selected: { clipId?: string; src?: string } | null; remembered: string | null; onSelectClip: (id: string) => void; onNameLine?: (clipId: string, label: string) => void;
}) {
  const [tool, setToolState] = React.useState<Tool>(lastTool);
  const setTool = (t: Tool) => { lastTool = t; setToolState(t); };
  const [busy, setBusy] = React.useState(false);
  const at = timeMs / 1000;
  const media = React.useMemo(() => [...new Set((film?.tracks ?? []).flatMap((t) => t.clips).map((c) => c.src.split('#')[0]).filter((s) => lineOf(s) === 'media' && !s.startsWith('frame/')))], [film]);
  const place = async (op: Op, id: string, label: string, line?: string) => { const fail = await edit([op], label); if (fail) throw new Error(fail); if (line) onNameLine?.(id, line); onSelectClip(id); };
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { notify(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };

  /* ---- devices ---- */
  const [device, setDevice] = React.useState<'phone' | 'laptop' | null>(null);
  const [quick, setQuick] = React.useState<Quick>({ ...DEFAULT_QUICK });
  const [screen, setScreen] = React.useState<string>('');
  const screenSpec = (): ScreenSpec | null => (screen ? { src: screen, fit: 'cover',startMode:'start' } : null);
  const addDevice = (presetId: string, len: number, q: Partial<Quick> = {}) => run(async () => {
    const def = DEVICE_PRESETS.find((p) => p.id === presetId); const length = q.length ?? len;
    const sc = presetScene(presetId==='manual'?'floatingReveal':presetId, screenSpec(), length, q, media.filter((m) => /\.(png|jpe?g|webp)$/i.test(m)));
    if(presetId==='manual'){sc.objects.forEach(o=>{o.motion={keys:[{t:0,p:[0,0,0],r:[0,0,0],s:1,lid:110}]};});sc.cameraMotion=undefined;}
    if (presetId === 'floatingReveal') sc.objects.forEach((o) => Object.assign(o, { quick: { ...DEFAULT_QUICK, ...q, length } }));
    const { op, opened, layer } = await addScene3d(projectId, film, at, q.device === 'laptop' && presetId === 'floatingReveal' ? '3D MacBook Showcase' : presetId === 'floatingReveal' ? '3D iPhone Showcase' : def?.name ?? '3D', sc, length, presetId);
    await place(op, layer.id, `Add ${layer.name}`, opened?.label);
    notify(`${layer.name} added — select it to change its screen, path and look.`);
  });

  /* ---- cameras ---- */
  const [freezeFor, setFreezeFor] = React.useState(1);
  const [cam2d, setCam2d] = React.useState('zoomTarget'); const [cam3d, setCam3d] = React.useState('slowOrbit');
  const addCam = (mode: '2d' | '3d') => run(async () => {
    const { op, layer } = await addCamera(projectId, film, at, mode, mode === '2d' ? cam2d : cam3d, mode === '2d' ? 4 : 3, mode === '3d' ? { continuePrevious: true, ...(f ? { orbit: 24 } : {}) } : {}, folder);
    await place(op, layer.id, `Add ${layer.name}`, mode === '2d' ? '2D Camera' : '3D Camera');
    notify(mode === '2d' ? 'Camera added. Drag its frame on the picture, or pick a target.' : '3D camera added. Select it to change the move; everything below it orbits, tilts and pushes in.');
  });

  /* ---- footage (a video or a photo) ---- */
  const [targetId, setTargetId] = React.useState('');
  const footageClips = (film?.tracks ?? []).flatMap((tr, ti) => tr.clips.filter(c => MEDIA.test(c.src.split('#')[0])).map(c => ({ ...c, line: ti + 1 })));
  const footageId = targetId || (selected?.clipId && MEDIA.test(selected.src?.split('#')[0] ?? '') ? selected.clipId : remembered);
  const f = footageAt(film, at, footageId ?? undefined);
  const isPhoto = !!f && /\.(png|jpe?g|webp|gif|avif)$/i.test(f.clip.src.split('#')[0]);
  const quality: Quality = 'balanced';
  const trackSurface='auto';const [trackEngine,setTrackEngine]=React.useState<'auto'|'advanced'>('auto');
  const scanEffect: 'auto'|'video'|'off' = 'auto',scanStrength=12;
  const [pick, setPick] = React.useState<{ x: number; y: number;currentX?:number;currentY?:number;time?:number;spatialAnchor?:any } | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [ambiguous,setAmbiguous]=React.useState(false),[floatDistance,setFloatDistance]=React.useState(3);
  const sceneDepth = .5;
  const [foreground, setForeground] = React.useState<'auto'|'front'|'behind'>('auto'),[onSubject,setOnSubject]=React.useState(false);
  const [progress, setProgress] = React.useState<{ share: number; msg: string } | null>(null);
  const [seen, setSeen] = React.useState<Seen | null>(null);
  const [text, setText] = React.useState('FUTURE');
  const abort = React.useRef<AbortController | null>(null);
  const prompted=React.useRef<AnalysisResult|null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number; duration?: number } | null>(null);
  React.useEffect(() => { abort.current?.abort(); prompted.current=null; setProgress(null); setSeen(null); setPick(null); setPicking(false); setTrackEngine('auto'); return () => abort.current?.abort(); }, [projectId, f?.clip.id]);
  React.useEffect(() => {
    setSize(null); let live = true;
    if (!f) return; const path = `${folder}${f.clip.src.split('#')[0]}`;
    if (/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) { const i = new Image(); i.onload = () => { if (live) setSize({ w: i.naturalWidth, h: i.naturalHeight }); }; i.src = path; return () => { live = false; i.onload = null; }; }
    const v = document.createElement('video'); v.preload = 'metadata'; v.src = path; v.onloadedmetadata = () => { if (live) setSize({ w: v.videoWidth, h: v.videoHeight, duration: v.duration }); };
    return () => { live = false; v.onloadedmetadata = null; v.removeAttribute('src'); v.load(); };
  }, [f?.clip.src, folder]); // eslint-disable-line react-hooks/exhaustive-deps
  const W = film?.stage?.w ?? 1080, H = film?.stage?.h ?? 1920;
  const rect = size ? footageRect(W, H, size.w, size.h, f?.clip.box, clipFit(f?.clip)) : { x: 0, y: 0, w: 1, h: 1 };
  const srcRange = () => { const sp = f!.clip.speed || 1; const inP = f!.clip.time?.[0] ?? 0; return { from: round(inP), to: round(Math.min(size?.duration ?? Infinity, inP + (f!.end - f!.start) * sp)) }; };
  const cacheKey = f ? JSON.stringify([projectId, f.clip.id, f.clip.src, srcRange(), quality,trackSurface,trackEngine]) : '';
  const result = results.get(cacheKey);
  const [,refreshCache]=React.useState(0),[checked,setChecked]=React.useState(''),autoTried=React.useRef('');
  React.useEffect(()=>{
    if(tool!=='track'||!f||!size||result||progress)return;
    const ctl=new AbortController(),range=srcRange();
    void findCachedAnalysis({projectId,folder,src:f.clip.src.split('#')[0],from:isPhoto?0:range.from,to:isPhoto?0:range.to,quality,engine:trackEngine,surface:trackSurface,mode:'camera',segment:'auto',signal:ctl.signal})
      .then(cached=>{if(cached&&!ctl.signal.aborted){results.set(cacheKey,cached);refreshCache(v=>v+1);}}).catch(()=>{}).finally(()=>{if(!ctl.signal.aborted)setChecked(cacheKey);});
    return()=>ctl.abort();
  },[tool,cacheKey,folder,!!size,!!result,!!progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const sceneTracks=useSceneTracks(folder,[result?.spatial,result?.track,...(result?.planes??[]).map(p=>p.track)]);
  const sceneTime=f?(f.clip.time?.[0]??0)+Math.max(0,at-f.start)*(f.clip.speed??1):0;
  const [stick,setStick]=React.useState(true);
  /* "Stick to surface" keeps the wall's tilt; "Float" turns the same point into an upright, camera-facing world anchor at its depth */
  const anchorFor=(p:any)=>{if(!p?.spatialAnchor||!result?.spatial||stick||p.spatialAnchor.type!=='surface')return p?.spatialAnchor;try{const sol=sceneTracks[result.spatial],t=p.time??sceneTime,pose=spatialPoseAt(sol,Math.round(t*1e6)),q=projectWorld(p.spatialAnchor.position,pose);return q?worldAnchor(sol,Math.round(t*1e6),[(p.currentX??.5)*sol.width,(p.currentY??.5)*sol.height],q.depth):p.spatialAnchor;}catch{return p.spatialAnchor;}};
  const sceneH=result?.track&&sceneTracks[result.track]?transformAt(sceneTracks[result.track],sceneTime):[1,0,0,0,1,0,0,0,1];
  /* the scan's frames feed two things: diamonds on trackable spots, and finding the surface under a click */
  const [scan,setScan]=React.useState<ScanFrames|null>(null);
  React.useEffect(()=>{setScan(null);if(tool!=='track'||!f||!result||isPhoto)return;const ctl=new AbortController();void readScanFrames({folder,src:f.clip.src,result,signal:ctl.signal}).then(v=>{if(!ctl.signal.aborted)setScan(v);}).catch(()=>{});return()=>ctl.abort();},[tool,result?.id,f?.clip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const spots=React.useMemo(()=>scan?suggestSpots(scan.grays[0],scan.w,scan.h,{content:result?.content}):[],[scan,result?.content]); // eslint-disable-line react-hooks/exhaustive-deps
  type Surf={for:unknown;state:'working'|'ready'|'none';data?:FoundSurface};
  const [surface,setSurface]=React.useState<Surf|null>(null);
  /* "which way does it face?": the orientation the person picked for this point (null: the one found), and the choices
     the first look offered, kept while they switch between them */
  const [facing,setFacing]=React.useState<[number,number,number]|null>(null),[choices,setChoices]=React.useState<{for:unknown;list:([number,number,number]|null)[]}|null>(null);
  React.useEffect(()=>{setFacing(null);setChoices(null);},[pick]);
  const globalTrack=result?.track?sceneTracks[result.track]:null;
  React.useEffect(()=>{
    /* a click on a person: the text belongs to the background behind (or in front of) them, which the scene's own camera track already holds; a patch there would follow the person */
    if(!pick||!result||!scan||result.spatial||pick.spatialAnchor||pick.currentX==null||pick.currentY==null||onSubject){setSurface(null);return;}
    if(result.scene?.planes?.some(pl=>pointInside([pick.x,pick.y],pl.quad))){setSurface(null);return;} /* a surface the scene reader found keeps its own plane */
    const k=Math.max(0,Math.min(scan.times.length-1,Math.round(((pick.time??sceneTime)-result.from)*result.fps))),click:[number,number]=[pick.currentX*result.w,pick.currentY*result.h];
    const ctl=new AbortController();setSurface({for:pick,state:'working'});
    findSurface(scan,k,click,globalTrack&&(globalTrack as any).frames?.length===scan.times.length?globalTrack:null,ctl.signal,facing).then(data=>{if(ctl.signal.aborted)return;setSurface({for:pick,state:'ready',data});
      if(!data.chosen)setChoices({for:pick,list:data.alternatives?.length?[data.tilted?data.normal:null,...data.alternatives]:[]});}).catch(()=>{if(!ctl.signal.aborted)setSurface({for:pick,state:'none'});});
    return()=>ctl.abort();
  },[pick,scan,result?.id,!!globalTrack,onSubject,facing]); // eslint-disable-line react-hooks/exhaustive-deps
  /* people who walk across the chosen spot: only they, and only then, get precise (SAM 2) masks, on request */
  const [matteMeta,setMatteMeta]=React.useState<any>(null);
  React.useEffect(()=>{setMatteMeta(null);if(!result?.matte)return;let live=true;void fetch(`${folder}${result.matte}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).then(v=>{if(live)setMatteMeta(v);}).catch(()=>{});return()=>{live=false;};},[folder,result?.matte]);
  /* people in the shot, from the masks themselves (a scan saved before specks were told apart says so from its own flag) */
  const peopleSeen=matteMeta?.frames?(matteMeta.frames as any[]).some(fr=>(fr?.subjects??[]).some((x:any)=>x?.box&&x.box[3]-x.box[1]>=.08*(matteMeta.trackH??result?.h??320))):!!result?.subjectsSeen;
  const crossing=React.useMemo(()=>{
    if(!matteMeta||!result||!pick)return null;
    if(surface?.state==='ready'&&surface.data)return crossingPeople(matteMeta,surface.data.result,surface.data.quad,{w:result.w,h:result.h});
    /* a click on a person: the background track carries the spot, a box around it is where people cross */
    if(onSubject&&globalTrack){const x=pick.x*result.w,y=pick.y*result.h,r=result.w*.12;return crossingPeople(matteMeta,globalTrack,[[x-r,y-r*.6],[x+r,y-r*.6],[x+r,y+r*.6],[x-r,y+r*.6]],{w:result.w,h:result.h});}
    return null;
  },[surface,matteMeta,result?.w,result?.h,pick,onSubject,!!globalTrack]); // eslint-disable-line react-hooks/exhaustive-deps
  const [precise,setPrecise]=React.useState<{share:number;msg:string}|null>(null),preciseAbort=React.useRef<AbortController|null>(null);
  const preciseCovers=(r:AnalysisResult|undefined,c:{from:number;to:number}|null)=>!!(r&&c&&(r as any).occlusionRange&&(r as any).occlusionRange[0]<=c.from+.05&&(r as any).occlusionRange[1]>=c.to-.05);
  /* measured on a 4-core 2019 MacBook Pro: 11.4 min for 4.2 s with two people (SAM 2 tiny, depth, edge refinement) */
  const preciseMinutes=(c:{from:number;to:number;instances:unknown[]})=>Math.max(1,Math.round((c.to-c.from)*(0.9+0.9*c.instances.length)));
  const makePrecise=()=>{if(!crossing||!result||!f||precise)return;const ctl=new AbortController();preciseAbort.current=ctl;setPrecise({share:0,msg:'Starting'});
    void reconstructOcclusion(projectId,f.clip.src.split('#')[0],crossing.from,crossing.to,result.spatial??null,crossing.instances,ctl.signal,(share,msg)=>{if(!ctl.signal.aborted)setPrecise({share,msg});},{fps:6,maxFrames:36})
      .then(async path=>{if(ctl.signal.aborted)return;const updated={...result,occlusion:path,occlusionRange:[crossing.from,crossing.to]} as AnalysisResult;results.set(cacheKey,updated);await putFile(projectId,`assets/track/${result.id}.result.json`,JSON.stringify(updated),{overwrite:true});setPrecise(null);refreshCache(v=>v+1);notify('Precise people masks are ready for this spot.');})
      .catch(e=>{setPrecise(null);if(!ctl.signal.aborted)notify(e instanceof Error?e.message:String(e));});};
  const footageVisible=!!f&&at>=f.start&&at<Math.min(f.end,f.start+((size?.duration??Infinity)-(f.clip.time?.[0]??0))/(f.clip.speed??1));
  React.useEffect(()=>{
    if(tool!=='track'||!f||!result||progress||prompted.current?.id===result.id)return; /* a scan improved in place (precise masks) keeps the chosen point */
    prompted.current=result;setPick(null);setAmbiguous(false);setPicking(true);
    if(!footageVisible)window.dispatchEvent(new CustomEvent('frame-seek',{detail:f.start+.03}));
  },[tool,f?.clip.id,result,progress,footageVisible]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(()=>{
    if(tool!=='track'||!picking||!footageVisible||result?.spatial&&!sceneTracks[result.spatial])return;
    document.body.dataset.sceneSelection='';
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setPicking(false);}};
    window.addEventListener('keydown',cancel);
    return()=>{delete document.body.dataset.sceneSelection;window.removeEventListener('keydown',cancel);};
  },[tool,picking,footageVisible,result?.spatial,sceneTracks]);
  const spotMarkers=footageVisible&&result?spots.flatMap((sp,i)=>{const z=sceneH[6]*sp.x+sceneH[7]*sp.y+sceneH[8];if(!(z>.05))return [];const q=apply(sceneH,[sp.x,sp.y]);if(q[0]<result.w*.03||q[1]<result.h*.03||q[0]>result.w*.97||q[1]>result.h*.97)return [];const x=rect.x+q[0]/result.w*rect.w,y=rect.y+q[1]/result.h*rect.h,r=rect.w*.018;return [{id:`spot-${i}`,title:'Follow this',x,y,quad:[[x,y-r],[x+r,y],[x,y+r],[x-r,y]] as [number,number][]}];}):[];
  const planeMarkers=footageVisible&&result?(result.spatial&&sceneTracks[result.spatial]?spatialSurfaceMarkers(sceneTracks[result.spatial],result.scene,sceneTime,result.w,result.h):visibleSurfaceMarkers(result.scene,result.planes,sceneTracks,sceneTime,result.w,result.h,sceneH)).map((s:{id:string;title:string;point:number[];quad:number[][]})=>({id:s.id,title:s.title,x:rect.x+s.point[0]/result.w*rect.w,y:rect.y+s.point[1]/result.h*rect.h,quad:s.quad.map((p:number[])=>[rect.x+p[0]/result.w*rect.w,rect.y+p[1]/result.h*rect.h] as [number,number])})):[];

  const surfaceMarkers=planeMarkers.length?planeMarkers:spotMarkers;
  const analyse = () => {
    if (!f || progress || !size) return; const ctl = new AbortController(); abort.current = ctl; const { from, to } = srcRange();
    setProgress({ share: 0, msg: 'Starting' }); setSeen(null);
    analyseFootage({ projectId, folder, src: f.clip.src.split('#')[0], from: isPhoto ? 0 : from, to: isPhoto ? 0 : to, quality, engine:trackEngine,surface:trackSurface, mode: 'camera', segment: 'auto', signal: ctl.signal,
      onProgress: (share, msg, _p, s) => { if (ctl.signal.aborted) return; if (share >= 0) setProgress({ share, msg }); if (s) setSeen(s); } })
      .then((r) => { if (ctl.signal.aborted) return; results.set(cacheKey, r); setProgress(null); setSeen(null); notify(`Scan done — tracking ${r.quality.toLowerCase()}${r.matte ? ', foreground ready' : ', foreground detection unavailable'}.`); })
      .catch((e) => { if (abort.current !== ctl) return; setProgress(null); setSeen(null); notify(e?.name === 'AbortError' ? 'Scan cancelled.' : e instanceof Error ? e.message : String(e)); });
  };
  React.useEffect(()=>{
    if(tool!=='track'||!f||!size||result||progress||checked!==cacheKey||autoTried.current===cacheKey)return;
    autoTried.current=cacheKey;analyse();
  },[tool,f?.clip.id,!!size,!!result,!!progress,checked,cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const addTrack = (template: string, mode: EffectMode = 'textBehind') => run(async () => {
    if (!f || !result) throw new Error('Scan the footage first.');
    /* a location title sits on a wall up to the left, as the games project it; the rest stand where the subject is */
    const S = surface?.state === 'ready' && surface.for === pick && pick && mode === 'textBehind' ? surface.data! : null;
    let sceneForItem = result.scene, planesForItem = result.planes;
    if (S && pick) {
      const name = 'Surface at click', path = await putFile(projectId, `assets/track/${result.id}-click-${Date.now().toString(36)}.json`, JSON.stringify(S.result));
      sceneForItem = { summary: result.scene?.summary ?? '', motion: result.scene?.motion ?? '', safePolygon: result.scene?.safePolygon ?? [], referenceTime: result.scene?.referenceTime ?? result.from, model: result.scene?.model ?? 'local', planes: [...(result.scene?.planes ?? []), { kind: 'surface', name, quad: S.quad.map(([x, y]) => [x / result.w, y / result.h] as [number, number]), confidence: .9 }] };
      planesForItem = [...(result.planes ?? []), { name, track: path, quality: S.result.quality, lostShare: S.result.lostShare }];
    }
    const C = result.content ?? { x: 0, y: 0, w: 1, h: 1 };
    const anchor: [number, number] = S && pick ? [pick.currentX! * result.w, pick.currentY! * result.h] : [result.w * (pick?.x ?? C.x + C.w * .5), result.h * (pick?.y ?? C.y + C.h * (template === 'location' ? .4 : .76))];
    const items = mode === 'textBehind' ? [spatialItem(sceneItem({...fitItem(itemFor(template, text, anchor, result.h), C, result.w, result.h),anchor,sceneDepth,anim:'rise',in:.45,animOut:'fade',out:.3},sceneForItem,result.w,result.h,'auto',planesForItem),result.spatial?sceneTracks[result.spatial]:null,pick?.time??sceneTime,result.w,result.h,pick?.currentX!=null&&result.spatial&&sceneTracks[result.spatial]?[pick.currentX*sceneTracks[result.spatial].width,pick.currentY!*sceneTracks[result.spatial].height]:undefined)] : [];
    /* white words on a white wall cannot be read: over a light patch of the picture the text goes dark, with a light edge */
    if(scan&&items[0]&&mode==='textBehind'&&/^#f{3,6}$/i.test(String(items[0].color??''))){const k=Math.max(0,Math.min(scan.grays.length-1,Math.round(((pick?.time??sceneTime)-result.from)*result.fps))),g=scan.grays[k],[ax,ay]=anchor,r=Math.max(4,Math.round(result.w*.05));let sum=0,n=0;for(let y=Math.max(0,Math.round(ay-r));y<Math.min(scan.h,ay+r);y++)for(let x=Math.max(0,Math.round(ax-r*2));x<Math.min(scan.w,ax+r*2);x++){sum+=g[y*scan.w+x];n++;}if(n&&sum/n>170)Object.assign(items[0],{color:'#15171c',strokeColor:'rgba(255,255,255,0.6)'});}
    if(pick?.spatialAnchor&&items[0]){const solution=sceneTracks[result.spatial!],a=anchorFor(pick),pose=spatialPoseAt(solution,Math.round((pick.time??sceneTime)*1e6)),p=projectWorld(a.position,pose);if(!p)throw Error('This point is behind the source camera. Choose a visible source frame.');Object.assign(items[0],{place:a.type==='surface'?'surface':'standing',spatialAnchor:{...a,depthOffset:(.5-sceneDepth)*2},worldHeight:(items[0].size/result.h)*solution.height/pose.intrinsics[1][1]*p.depth,spatialWarning:undefined});}
    if(result.spatial&&items[0]&&!items[0].spatialAnchor){setAmbiguous(true);throw Error('This point has no verified surface. Choose a floating depth or another surface.');}
    const name = mode !== 'textBehind' ? EFFECT_MODES[mode] : template === 'walkThrough' ? 'Walk Through Text' : template === 'giant' ? 'Walk Past Giant Title' : template === 'surface' ? 'Tracked text on surface' : template === 'floating' ? 'Text Above Ground' : template === 'location' ? 'Location Title' : '3D Text in Scene';
    /* a figure printed on the very surface the text goes on (a poster) must not cover it */
    if (S && result.matte && items[0]) { try { const meta = await fetch(`${folder}${result.matte}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null); const box = meta && printedOnSurface(meta, S.result, S.quad); if (box) Object.assign(items[0], { printedBox: box }); } catch { /* no mask meta: nothing excluded */ } }
    const { op, layer } = await addTracked(projectId, film, f.clip.id, at, { name, analysis: S ? { ...result, scene: sceneForItem, planes: planesForItem } : result, mode, items, defaultDepth: foreground, extra: { pick } });
    await place(op, layer.id, `Add ${name}`, '3D');setPick(null);setAmbiguous(false);setPicking(true);
    notify(`${name} added. Click the video to place another.`);
  });
  /* A click on something the scan found (a person, an object) is asked about once; a click near a diamond clings to it. */
  const subjectAt=(u:number,v:number)=>{const c=document.querySelector<HTMLCanvasElement>('[data-foreground-outline] canvas');if(!c||!c.width||!c.dataset.maskTimestamp)return false;try{const d=c.getContext('2d',{willReadFrequently:true})!.getImageData(Math.min(c.width-1,Math.floor(u*c.width)),Math.min(c.height-1,Math.floor(v*c.height)),1,1).data;return d[3]>0;}catch{return false;}};
  const snap=(sx:number,sy:number):[number,number]=>{let best:[number,number]|null=null,d=rect.w*.022;for(const m of surfaceMarkers){const k=Math.hypot(m.x-sx,m.y-sy);if(k<d){d=k;best=[m.x,m.y];}}return best??[sx,sy];};
  const toFootage = (sx: number, sy: number) => {const hit=subjectAt(clamp((sx-rect.x)/rect.w),clamp((sy-rect.y)/rect.h));setOnSubject(hit);setForeground(hit?'behind':'auto');const p=referenceInScene(result?.scene,result?.planes,sceneTracks,sceneTime,[clamp((sx-rect.x)/rect.w)*(result?.w??1),clamp((sy-rect.y)/rect.h)*(result?.h??1)],result?.w??1,result?.h??1,sceneH);let spatialAnchor;if(result?.spatial&&sceneTracks[result.spatial])try{{const sol=sceneTracks[result.spatial],us=Math.round(sceneTime*1e6),px:[number,number]=[clamp((sx-rect.x)/rect.w)*sol.width,clamp((sy-rect.y)/rect.h)*sol.height];spatialAnchor=surfaceAnchor(sol,us,px);
  /* sparse points behind glass or across a street can fit a surface the camera sees edge-on (text on it would vanish): such a fit is not trusted, the text stands at that depth facing the camera instead */
  const pose=spatialPoseAt(sol,us),n=spatialAnchor?.normal,ray=pose&&cameraRay(px,pose).direction,facing=n&&ray?Math.abs(n[0]*ray[0]+n[1]*ray[1]+n[2]*ray[2]):1;
  if(pose&&facing<.3){const q=projectWorld(spatialAnchor.position,pose);spatialAnchor=q?{...worldAnchor(sol,us,px,q.depth),edgeOnSurface:true}:spatialAnchor;}
  setAmbiguous(false);}}catch{try{const sol=sceneTracks[result.spatial],a=worldAnchor(sol,Math.round(sceneTime*1e6),[clamp((sx-rect.x)/rect.w)*sol.width,clamp((sy-rect.y)/rect.h)*sol.height],floatDistance);spatialAnchor={...a,manual:true,depthSource:'user'};}catch{}setAmbiguous(true);}return {spatialAnchor,x:clamp(p[0]/(result?.w??1)),y:clamp(p[1]/(result?.h??1)),currentX:clamp((sx-rect.x)/rect.w),currentY:clamp((sy-rect.y)/rect.h),time:sceneTime};};
  const fromFootage = (p: { x: number; y: number; spatialAnchor?:any }) => {
    if(p.spatialAnchor&&result?.spatial){const solution=sceneTracks[result.spatial],pose=spatialPoseAt(solution,Math.round(sceneTime*1e6));if(!pose)return null;const q=projectWorld(anchorFrame({...p.spatialAnchor,depthOffset:(.5-sceneDepth)*2},null,pose).position,pose);return q?{x:rect.x+q.x/solution.width*rect.w,y:rect.y+q.y/solution.height*rect.h}:null;}
    const item=sceneItem({anchor:[p.x*result!.w,p.y*result!.h]},result?.scene,result!.w,result!.h,'auto',result?.planes),H=item.track&&sceneTracks[item.track]?transformAt(sceneTracks[item.track],sceneTime):sceneH,q=apply(H,[p.x*result!.w,p.y*result!.h]);return { x: rect.x + q[0]/result!.w * rect.w, y: rect.y + q[1]/result!.h * rect.h };
  };

  const placementPreview=React.useMemo(()=>{if(!result?.spatial||!pick?.spatialAnchor)return null;const solution=sceneTracks[result.spatial],a=anchorFor(pick),pose=spatialPoseAt(solution,Math.round((pick.time??sceneTime)*1e6)),p=projectWorld(a.position,pose);return p?{text,font:'Sora',weight:900,color:'#ffffff',place:'surface',anchor:[0,0],size:80,worldHeight:.14*solution.height/pose.intrinsics[1][1]*p.depth,spatialAnchor:{...a,depthOffset:(.5-sceneDepth)*2}}:null;},[pick,stick,text,result?.spatial,sceneTracks,sceneTime,sceneDepth]);
  const selectedPoint=pick&&result?fromFootage(pick):null;

  return (
    <div className="flex flex-col gap-3 pt-1">
      <div className={segWrap} role="tablist">
        {([['devices', 'Devices', <Box key="d" size={13} />],['models','Models',<Box key="m" size={13}/>], ['camera', 'Camera', <Video key="c" size={13} />], ['track', 'Track', <ScanLine key="t" size={13} />]] as const).map(([id, n, ic]) => (
          <button key={id} type="button" role="tab" aria-selected={tool === id} className={seg(tool === id)} onClick={() => setTool(id)}>{ic}{n}</button>
        ))}
      </div>

      {tool === 'devices' ? (
        <div className="flex flex-col gap-3" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
          <div className="grid grid-cols-2 gap-2">
            <Card img="/assets/3d/phone.png" icon={<Smartphone size={26} />} title="iPhone" sub="Floats in, faces you" on={device === 'phone'} onClick={() => { setDevice(device === 'phone' ? null : 'phone'); setQuick({ ...DEFAULT_QUICK, device: 'phone' }); }} />
            <Card img="/assets/3d/laptop.png" icon={<Laptop size={26} />} title="MacBook" sub="Opens, screen playing" on={device === 'laptop'} onClick={() => { setDevice(device === 'laptop' ? null : 'laptop'); setQuick({ ...DEFAULT_QUICK, device: 'laptop' }); }} />
          </div>
          {device ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
              <label className={row}><span className="w-[78px] shrink-0">Screen</span><select value={screen} onChange={(e) => setScreen(e.target.value)} className={`${T.small} min-w-0 flex-1`}><option value="">No screen media · add later</option>{media.map((m) => <option key={m} value={m}>{m.split('/').pop()}</option>)}</select></label>
              <Sel label="Comes from" value={quick.startFrom} options={Object.keys(START_FROM)} onChange={(v) => setQuick({ ...quick, startFrom: v })} />
              <Sel label="Ends at" value={quick.finishAt} options={Object.keys(FINISH_AT)} onChange={(v) => setQuick({ ...quick, finishAt: v })} />
              <Sel label="Turn" value={quick.rotation} options={Object.keys(ROTATIONS)} onChange={(v) => setQuick({ ...quick, rotation: v })} />
              <label className={row}><span className="w-[78px] shrink-0">Timing</span><input type="number" step={0.1} min={0.3} max={20} value={quick.duration} onChange={(e) => setQuick({ ...quick, duration: Number(e.target.value) })} className={`${T.small} w-14`} /><span className="text-[11px]">s move in a</span><input type="number" step={0.5} min={1} max={60} value={quick.length} onChange={(e) => setQuick({ ...quick, length: Number(e.target.value) })} className={`${T.small} w-14`} /><span className="text-[11px]">s clip</span></label>
              <More title="Motion options">
                <Sel label="Entrance" value={quick.entrance} options={['float', 'slide', 'fly', 'rise', 'none']} names={{ float: 'Float in', slide: 'Slide in', fly: 'Fly in', rise: 'Rise up', none: 'None' }} onChange={(v) => setQuick({ ...quick, entrance: v as Quick['entrance'] })} />
                <Toggle label="Smooth motion" on={quick.smooth} onChange={(v) => setQuick({ ...quick, smooth: v })} />
                <Toggle label="Hold at end" on={quick.holdAtEnd} onChange={(v) => setQuick({ ...quick, holdAtEnd: v })} />
                <Toggle label="Return motion" on={quick.returnMotion} onChange={(v) => setQuick({ ...quick, returnMotion: v })} />
              </More>
              <button type="button" disabled={busy} onClick={() => void addDevice('floatingReveal', quick.length, quick)} className={`${T.primary} h-9`}><Plus size={14} />Add to timeline</button>
              <button type="button" disabled={busy} onClick={()=>void addDevice('manual',quick.length,quick)} className={T.secondary}>Add still · create my own path</button>
            </div>
          ) : null}
          <More title={`Presets (${DEVICE_PRESETS.length - 1})`}>
            {DEVICE_PRESETS.filter((p) => p.id !== 'floatingReveal').map((p) => (
              <button key={p.id} type="button" disabled={busy} onClick={() => void addDevice(p.id, p.length)} className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-[var(--bg-hover)]">
                <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-[var(--text)]">{p.name}</span><span className="block truncate text-[10.5px] text-[var(--text-faint)]">{p.about}</span></span>
                <Plus size={13} className="shrink-0 text-[var(--text-faint)] opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
          </More>
        </div>
      ) : null}

      {tool==='models'&&<ModelsPanel projectId={projectId} folder={folder} film={film} at={at} selected={selected} edit={edit} select={onSelectClip} notify={notify}/>}
      {tool === 'camera' ? (
        <div className="flex flex-col gap-3" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <span className="text-[12px] font-semibold text-[var(--text)]">3D camera</span>
            <p className={T.hint}>Orbit, tilt and push in on your video, photos, text or 3D scenes, like a real camera.</p>
            <Sel label="Move" value={cam3d} options={Object.keys(CAMERA3D_PRESETS)} names={CAMERA3D_PRESETS as Record<string, string>} onChange={setCam3d} />
            <button type="button" disabled={busy} onClick={() => void addCam('3d')} className={T.primary}><Plus size={13} />Add 3D camera</button>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <span className="text-[12px] font-semibold text-[var(--text)]">Zoom & pan camera</span>
            <button type="button" disabled={!f||isPhoto} onClick={()=>f&&requestUniversalTracking(f.clip.id)} className={T.secondary}><Crosshair size={13}/>Follow something in the video</button>
            <Sel label="Move" value={cam2d} options={Object.keys(CAMERA_PRESETS)} names={CAMERA_PRESETS as Record<string, string>} onChange={setCam2d} />
            <button type="button" disabled={busy} onClick={() => void addCam('2d')} className={T.secondary}><Plus size={13} />Add camera</button>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5">
            <Snowflake size={14} className="shrink-0 text-[var(--text-faint)]" />
            <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-dim)]">Freeze the video here for</span>
            <input type="number" min={0.2} max={10} step={0.1} value={freezeFor} onChange={(e) => setFreezeFor(Number(e.target.value))} className={`${T.small} w-12`} aria-label="Freeze for (seconds)" /><span className="text-[11px]">s</span>
            <button type="button" disabled={busy || !footageId} onClick={() => run(async () => { const fail = await freezeFrame(projectId, folder, film, footageId!, at, freezeFor, edit); if (fail) throw new Error(fail); notify(`Frozen for ${freezeFor}s — the clip continues after.`); })} className={`${T.tile} h-7 px-2.5`}>Freeze</button>
          </div>
        </div>
      ) : null}

      {tool === 'track' ? (
        <div className="flex flex-col gap-3" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
          {footageClips.length>1&&<label className={row}><span className="w-[68px] shrink-0">Video</span><select aria-label="Video to track" value={targetId} disabled={!!progress} onChange={e => { setTargetId(e.target.value); if (e.target.value) onSelectClip(e.target.value); }} className={`${T.small} min-w-0 flex-1`}><option value="">Selected clip / playhead</option>{footageClips.map(c => <option key={c.id} value={c.id}>{c.src.split('#')[0].split('/').pop()} · line {c.line} · {c.id}</option>)}</select></label>}
          {!f ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center">
              <ImageIcon size={20} className="text-[var(--text-faint)]" />
              <p className="text-[12px] text-[var(--text-muted)]">Select a video or a photo on the timeline (or move the playhead over one) to put text and effects inside it.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--fill-tsp)] text-[var(--text-dim)]">{isPhoto ? <ImageIcon size={13} /> : <Video size={13} />}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text)]">{f.clip.src.split('#')[0].split('/').pop()}</span><span className="text-[10.5px] text-[var(--text-faint)]">{isPhoto ? 'photo' : 'from the playhead'}</span></div>
                <p className={T.hint}>{progress?'Scanning camera motion, surfaces and people…':result?'Click a diamond to place text in the scene.':'Scanning starts automatically.'}</p>
                
                {progress ? <ScanProgress share={progress.share} msg={progress.msg} seen={seen} onCancel={() => abort.current?.abort()} />
                  : <button type="button" disabled={!size} onClick={analyse} className={`${result?T.secondary:T.primary} h-9`}><ScanLine size={14} />{result ? 'Scan again' : isPhoto ? 'Scan photo' : 'Scan footage'}</button>}
                {!progress && result ? <p className="text-[11px] text-[var(--text-muted)]">Camera motion <b className="font-semibold text-[var(--text)]">{result.quality}</b> · {result.medianError} px{result.occlusion ? ' · precise people masks' : result.matte ? ' · foreground ready' : ''}</p> : null}
                {!progress && result && !result.spatial && !isPhoto && !pick && (result.walking || peopleSeen) && <div className="flex flex-col gap-1.5 rounded-lg bg-[var(--fill-tsp)] p-2.5">
                  <p className="text-[11.5px] text-[var(--text-dim)]">{peopleSeen ? 'People cross this shot. Precise masks keep text cleanly behind them.' : 'The camera travels here. A 3D solve holds text to every surface.'}</p>
                  <button type="button" onClick={()=>setTrackEngine('advanced')} className={T.secondary}>Sharpen with 3D and precise masks</button>
                  <p className={T.hint}>Runs on this computer and can take several minutes. You can keep editing.</p>
                </div>}
                {result?.scene&&<More title="Scene observations"><p className={T.hint}>{result.scene.summary}</p></More>}
              </div>
              {progress ? <ScanOverlay clipId={f.clip.id} rect={rect} seen={seen} projectId={projectId} sourcePath={f?.clip.src.split('#')[0]} source={!isPhoto && f ? `${folder}${f.clip.src.split('#')[0]}` : undefined} from={f?srcRange().from:0} to={f?srcRange().to:undefined} effect={scanEffect} strength={scanStrength} /> : null}
              {result ? (
                <div className="flex flex-col gap-2" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
                  <p role="status" className="text-[12px] font-medium text-[var(--text)]">{result.spatial&&!sceneTracks[result.spatial]?'Preparing the scanned surfaces…':picking?'Click a diamond or a point on the video':pick?'Position selected':'Choose a position on the video'}</p>
                  {!picking&&<button type="button" onClick={() => {if(!footageVisible&&f)window.dispatchEvent(new CustomEvent('frame-seek',{detail:f.start+.03}));setPicking(true);}} className={T.secondary}><Crosshair size={13} />{pick?'Choose another point':'Place text on the video'}</button>}
                  {ambiguous&&result?.spatial&&sceneTracks[result.spatial]&&<div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2.5"><p className={T.hint}>No flat surface here, so the text floats in the scene. Drag to set how far.</p><input aria-label="Float distance" type="range" min={.25} max={20} step={.05} value={floatDistance} onChange={e=>{const d=Number(e.target.value);setFloatDistance(d);try{const sol=sceneTracks[result.spatial!],time=pick?.time??sceneTime,a=worldAnchor(sol,Math.round(time*1e6),[(pick?.currentX??.5)*sol.width,(pick?.currentY??.76)*sol.height],d);setPick(q=>q&&{...q,spatialAnchor:{...a,manual:true,depthSource:'user'}});}catch(err){notify((err as Error).message);}}} className="min-w-0 accent-[var(--accent)]"/></div>}
          {placementPreview&&result?.spatial&&sceneTracks[result.spatial]&&<SpatialPlacementPreview projectId={projectId} folder={folder} solution={sceneTracks[result.spatial]} item={placementPreview} time={sceneTime} sourceRect={rect}/>}
          {result?.spatial&&sceneTracks[result.spatial]&&<More title="Inspect the scene"><SpatialPreview projectId={projectId} folder={folder} solution={sceneTracks[result.spatial]} time={sceneTime} sourceRect={rect} onMode={mode=>{setPicking(mode!=='inspect'&&!pick);}} onPoint={(sx,sy)=>setPick(toFootage(sx,sy))} onWorldPoint={(point,normal)=>{try{const solution=sceneTracks[result.spatial!],anchor=anchorFromGeometry(solution,Math.round(sceneTime*1e6),point,normal);setPick({x:.5,y:.5,time:sceneTime,spatialAnchor:anchor});setAmbiguous(false);notify('Selected a reconstructed surface.');}catch(e){notify((e as Error).message);}}}/></More>}
          {(result.matte||result.occlusion)&&footageVisible&&<ForegroundOutline folder={folder} occlusionPath={result.occlusion} mattePath={result.matte} time={sceneTime} sourceRect={rect}/>}
          <StageOverlay pick={picking&&footageVisible&&(!result.spatial||!!sceneTracks[result.spatial])} pickBounds={rect} surfaces={surfaceMarkers} hint="Choose a diamond or click a surface" onCancel={()=>setPicking(false)} onPick={(x0, y0) => {const [sx,sy]=snap(x0,y0),next=toFootage(sx,sy);setPick(next);setPicking(false);}} nodes={selectedPoint&&!progress&&footageVisible ? [{ id: 'place', ...selectedPoint, label: '1', active: true }] : []} onDrop={(_, x0, y0) => {if(x0<rect.x||y0<rect.y||x0>rect.x+rect.w||y0>rect.y+rect.h)return;const [sx,sy]=snap(x0,y0),next=toFootage(sx,sy);setPick(next);setPicking(false);}} />
                  {pick&&<div className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3" style={{ animation: 'mg-in .22s cubic-bezier(.22,1,.36,1) both' }}>
                    <input aria-label="Text" placeholder="Your text" value={text} onChange={(e) => setText(e.target.value)} className={`${T.small} w-full`} />
                    {pick.spatialAnchor?.edgeOnSurface&&<p className={T.hint}>The surface here is seen almost edge-on, so the text stands at its depth facing the camera.</p>}
                    {pick.spatialAnchor?.type==='surface'&&<div className={segWrap} role="group" aria-label="How the text sits"><button type="button" aria-pressed={stick} className={seg(stick)} onClick={()=>setStick(true)}>Stick to surface</button><button type="button" aria-pressed={!stick} className={seg(!stick)} onClick={()=>setStick(false)}>Float, face me</button></div>}
                    {onSubject&&(result.matte||result.occlusion)&&<div className="flex flex-col gap-1"><p className="text-[12px] font-medium text-[var(--text)]">That's something the scan found. Where should the text go?</p><div className={segWrap} role="group" aria-label="Order with the detected subject">{(['behind','front'] as const).map(m=><button key={m} type="button" aria-pressed={foreground===m} className={seg(foreground===m)} onClick={()=>setForeground(m)}>{m==='front'?'In front of it':'Behind it'}</button>)}</div></div>}
                    {crossing&&!preciseCovers(result,crossing)&&<div className="flex flex-col gap-1.5 rounded-lg bg-[var(--fill-tsp)] p-2.5">
                      <p className="text-[11.5px] text-[var(--text-dim)]">{crossing.instances.length===1?'Someone walks':'People walk'} across this spot ({crossing.from.toFixed(1)}–{crossing.to.toFixed(1)}s).</p>
                      {precise?<ScanProgress share={precise.share} msg={precise.msg} seen={null} onCancel={()=>preciseAbort.current?.abort()}/>:<button type="button" onClick={makePrecise} className={T.secondary}>Make their edges precise</button>}
                      {!precise&&<p className={T.hint}>Follows {crossing.instances.length===1?'that person':'them'} with SAM 2 on this computer, about {preciseMinutes(crossing)} min on a laptop CPU (measured: 11 min for 4 s with two people). You can keep editing.</p>}
                    </div>}
                    {preciseCovers(result,crossing)&&<p className={T.hint}>Precise people masks are on for this spot.</p>}
                    {!result.spatial&&choices?.for===pick&&choices.list.length>1&&<div className="flex flex-col gap-1.5" data-surface-choice>
                      <p className={T.hint}>{facing?'Using your pick.':'Not sure which way this faces. Which is it?'}</p>
                      <div className={segWrap} role="group" aria-label="Which way the surface faces">{choices.list.map((n,i)=>{const on=facing?(!!n&&n.every((v,j)=>Math.abs(v-facing[j])<1e-6)):i===0;return <button key={i} type="button" aria-pressed={on} disabled={surface?.state==='working'} className={`${seg(on)} flex items-center justify-center gap-1.5`} onClick={()=>setFacing(i===0?null:n)}><FacingShape normal={n} click={[(pick.currentX??.5)*result.w,(pick.currentY??.5)*result.h]} w={result.w} h={result.h}/>{facingName(n)}</button>;})}</div>
                    </div>}
                    {!result.spatial&&surface&&<p className={T.hint} role="status">{surface.state==='working'?'Reading the surface…':surface.state==='ready'&&surface.data?.tilted?'The text will lie on this surface, tilted with it.':'The text will follow this surface.'}</p>}
                    <button type="button" disabled={busy||surface?.state==='working'||!!result.spatial&&!pick.spatialAnchor} onClick={()=>void addTrack('surface')} className={T.primary}><Plus size={13}/>{busy?'Adding text…':'Add text'}</button>
                  </div>}
                  {result.matte ? (
                    <More title="Subject effects">
                      <div className="grid grid-cols-2 gap-1.5">
                        {(Object.keys(EFFECT_MODES) as EffectMode[]).filter((m) => m !== 'textBehind').map((m) => <button key={m} type="button" disabled={busy} onClick={() => void addTrack('behind', m)} className={`${T.tile} h-9 text-[11px]`}><Sparkles size={12} />{EFFECT_MODES[m]}</button>)}
                      </div>
                    </More>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
