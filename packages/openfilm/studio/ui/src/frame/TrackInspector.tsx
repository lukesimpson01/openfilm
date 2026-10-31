import {spatialSurfaceMarkers}from'./spatial-guides.js';
import React from 'react';
import { Crosshair, Eye, EyeOff, Trash2, Brush, Eraser, RefreshCw, Type, MapPin, Sticker, ImagePlus } from 'lucide-react';
import type { Film } from '@/api';
import { round,putFile, type FrameLayer } from './layers';
import { transformAt, apply, inv3,homography } from './track-core.js';
import { analyseFootage, type AnalysisResult } from './analysis';
import { EFFECT_MODES, itemFor, ANIM_NAMES, STICKERS, stickerPath, uploadPicture, type TrackItem, type DepthRange, type EffectMode, type AnimName } from './tracked';
import { StageOverlay, ScanOverlay } from './StageOverlay';
import { ForegroundOutline } from './ForegroundOutline';
import { T, seg, segWrap } from './ui';
import { FontPicker } from './FontPicker';
import { sceneItem, constrainPoint, visibleSurfaceMarkers,referenceInScene } from './scene-geometry.js';
import{sceneAnchor,relativeAnchor}from'./spatial-scene.js';
import{ModelActions}from'./ModelActions';
import{inspectModel}from'./models';
import type{DeviceObject}from'./devices';
import{SpatialPreview}from'./SpatialPreview';
import{SpatialControls}from'./SpatialControls';
import{editSpatialPose}from'./spatial-motion.js';
import{motionAt}from'./motion3d.js';
import{reconstructPlanar,reconstructOcclusion,correctSpatialMasks}from'./spatial-analysis';
import{anchorQuad}from'./spatial-geometry.js';
import{anchorFrame}from'./spatial-geometry.js';
import {SpatialGizmo}from'./SpatialGizmo';
import {spatialItem}from'./spatial-items.js';
import {spatialPoseAt,projectWorld,cameraRay,rayPlane,objectAnchorAt,worldAnchor,manualPlaneAnchor,anchorFromGeometry}from'./spatial-geometry.js';
import { useSceneTracks } from './useSceneTracks';
import { footageRect, placedPoint, referencePoint, fitItem, clamp,surfaceDepthMatrix } from './track-space.js';

/* A tracked layer's settings: how good the tracking is (honestly), the objects in the scene (placed by clicking the
   picture, moved by dragging), when they are behind or in front of the person (a bar you drag), the subject mask's
   edge and corrections, and the effect's own settings. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return <label className={row}><span className="w-[84px] shrink-0">{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" aria-label={label} /><span className="w-11 text-right tabular-nums text-[var(--text)]">{fmt ? fmt(value) : round(value)}</span></label>;
}
const badge = (q: string) => (q === 'Good' ? 'bg-emerald-500/15 text-emerald-600' : q === 'Fair' ? 'bg-amber-500/15 text-amber-600' : 'bg-rose-500/15 text-rose-600');

export function TrackInspector({ layer, t, film, folder, projectId, commit, segment }: { layer: FrameLayer; t: number; film: Film | null; folder: string; projectId: string; commit: (l: FrameLayer, delay?: number) => void;segment?:[number,number] }) {
  const a = layer.analysis as AnalysisResult | null; const items = (layer.items ?? []) as TrackItem[]; const mode = (layer.mode ?? 'textBehind') as EffectMode;
  const qualities=items.map(it=>a?.planes?.find(p=>p.track===it.track)?.quality).filter(Boolean),surfaceQuality=qualities.includes('Poor')?'Poor':qualities.includes('Fair')?'Fair':qualities.length?'Good':a?.quality;
  const [track, setTrack] = React.useState<{ frames: { t: number; H: number[] }[]; refPoints: number[][] } | null>(null);
  const [gizmo,setGizmo]=React.useState<number|null>(null),[gizmoMode,setGizmoMode]=React.useState<'move'|'rotate'|'scale'>('move'),[orientation,setOrientation]=React.useState<'local'|'world'>('local');
  const [record,setRecord]=React.useState(false);
  const [showPoints, setShowPoints] = React.useState(false);
  const [showForeground, setShowForeground] = React.useState(true);
  /* what the next click on the picture places: an item's new spot (its index) or a new item (a template and its text or picture) */
  const [placing, setPlacing] = React.useState<number | { tpl: string; value: string; info?:any } | null>(null);
  const [manualPlane,setManualPlane]=React.useState<number|null>(null),[manualDistance,setManualDistance]=React.useState(3);
  const [planeEditing,setPlaneEditing]=React.useState<number|null>(null);
  const [stickersOpen, setStickersOpen] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [brush, setBrush] = React.useState<'add' | 'remove' | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [scanError,setScanError]=React.useState('');const scanAbort=React.useRef<AbortController|null>(null);
  React.useEffect(()=>()=>scanAbort.current?.abort(),[layer.id,projectId]);
  React.useEffect(() => { let live = true; if (!layer.track) return; fetch(`${folder}${layer.track}`, { cache: 'no-store' }).then((r) => r.json()).then((d) => { if (live) setTrack(d); }).catch(() => {}); return () => { live = false; }; }, [folder, layer.track]);
  const W = film?.stage?.w ?? 1080, H = film?.stage?.h ?? 1920; const pw = a?.w ?? 480, ph = a?.h ?? 270;
  /* where the footage sits on the stage (contain), in 0…1 of the stage */
  const hostClip = film?.tracks.flatMap(tr => tr.clips).find(c => c.id === layer.id);
  const R = footageRect(W, H, pw, ph, hostClip?.box, layer.fit ?? 'contain');
  const src = layer.source ?? { at: 0, speed: 1 }; const x = (src.at ?? 0) + t * (src.speed ?? 1);
  const Hm = track ? transformAt(track as never, x) : [1, 0, 0, 0, 1, 0, 0, 0, 1]; const Hi = inv3(Hm) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const sceneTracks=useSceneTracks(folder,[a?.occlusion,a?.spatial,layer.track,...(a?.planes??[]).map(p=>p.track),...items.map(it=>it.track)]);
  const solution=a?.spatial?sceneTracks[a.spatial]:null,pose=spatialPoseAt(solution,Math.round(x*1e6));
  const itemH=(it?:TrackItem)=>{const H=it?.track&&sceneTracks[it.track]?transformAt(sceneTracks[it.track],x):Hm;return it?.place==='surface'?surfaceDepthMatrix(H,it.planeQuad,it.sceneDepth??.5):H;};
  const proxyToStage = (p: number[]) => ({ x: R.x + (p[0] / pw) * R.w, y: R.y + (p[1] / ph) * R.h });
  const stageToRef = (sx: number, sy: number, item?: TrackItem): [number, number] => { const p = [clamp((sx - R.x) / R.w) * pw, clamp((sy - R.y) / R.h) * ph],H=itemH(item),inverse=inv3(H)??Hi; let r = item?.place === 'standing' ? referencePoint(H, p, item.sceneDepth ?? .5) : apply(inverse, p as [number, number]);if(item?.sceneClip?.length)r=constrainPoint(r,item.sceneClip); return [round(r[0]), round(r[1])]; };
  const pickReference=(sx:number,sy:number)=>referenceInScene(a?.scene,a?.planes,sceneTracks,x,[clamp((sx-R.x)/R.w)*pw,clamp((sy-R.y)/R.h)*ph],pw,ph,Hm) as [number,number];
  const footageVisible=!a||x>=a.from&&x<a.to;
  const markers=footageVisible?(solution?spatialSurfaceMarkers(solution,a?.scene,x,pw,ph):visibleSurfaceMarkers(a?.scene,a?.planes,sceneTracks,x,pw,ph,Hm)).map((s:{id:string;title:string;point:number[];quad:number[][]})=>({id:s.id,title:s.title,...proxyToStage(s.point),quad:s.quad.map((q:number[])=>{const p=proxyToStage(q);return [p.x,p.y] as [number,number];})})):[];

  const baseAnchor=(it:TrackItem)=>it.spatialAnchor?.type==='object'&&pose&&solution?objectAnchorAt(it.spatialAnchor,pose,itemH(it),it.spatialAnchor.referencePixels,[pw,ph,solution.width,solution.height],homography):it.spatialAnchor;
  const resolvedBase=(it:TrackItem)=>{try{return sceneAnchor(items,items.indexOf(it),t,pose,baseAnchor);}catch{return null;}};
  const liveAnchor=(it:TrackItem)=>{const base=resolvedBase(it);return base?anchorFrame(base,motionAt(it.motion,t),pose):null;};
  const setItems = (next: TrackItem[], delay = 120) => commit({ ...layer, items: next }, delay);
  const setItem = (i: number, patch: Partial<TrackItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const ranges = (layer.occlusion ?? []) as DepthRange[];
  const setRanges = (next: DepthRange[]) => commit({ ...layer, occlusion: next.sort((p, q) => p.from - q.from) }, 60);
  const depthHere=ranges.find(r=>t>=r.from&&t<r.to)??{mode:layer.defaultDepth??'auto',target:layer.occlusionTarget??'all',manualDepth:layer.manualDepth??3};
  const patchDepth=(patch:Partial<DepthRange>)=>{const [from,to]=segment??[0,layer.duration],kept=ranges.flatMap(r=>r.to<=from||r.from>=to?[r]:[...(r.from<from?[{...r,to:from}]:[]),...(r.to>to?[{...r,from:to}]:[])]);setRanges([...kept,{...depthHere,from,to,...patch}]);};
  const occlusionData=a?.occlusion?sceneTracks[a.occlusion]:null,occlusionFrame=occlusionData?.frames?.reduce((best:any,f:any)=>!best||Math.abs(f.sourceTimeUs-x*1e6)<Math.abs(best.sourceTimeUs-x*1e6)?f:best,null);

  const corrections = (layer.corrections ?? []) as { x: number; y: number; r: number; add: boolean; from: number; to: number; instanceId?:number }[];
  const recalc = async (wallItem?:number) => {
    if (!a) return; const ctl=new AbortController();scanAbort.current=ctl;setScanError('');setBusy('Recalculating the mask…');
    try {
      const res = await analyseFootage({ projectId, folder, src: src.src, from: a.from, to: a.to, quality: a.fps >= 30 ? 'high' : a.fps <= 12 ? 'fast' : 'balanced', mode: a.mode, surface:wallItem!=null?'wall':a.surface, segment: 'auto', corrections, signal:ctl.signal, onProgress: (s, m) => { if (s >= 0) setBusy(`${m} (${Math.round(s * 100)}%)`); } });
      if(wallItem!=null&&!res.scene?.planes.some(p=>p.kind==='wall'))throw new Error('No reliable wall was found. Adjust a surface manually or choose footage with a visible wall.');
      const rebuilt=res.spatial?await fetch(folder+res.spatial).then(r=>r.json()):null;
      const updated=items.map(it=>{const sx=res.w/pw,sy=res.h/ph,scaled={...it,spatialAnchor:undefined,worldHeight:undefined,anchor:[it.anchor[0]*sx,it.anchor[1]*sy] as [number,number],size:it.size*sy};return spatialItem(sceneItem(scaled,res.scene,res.w,res.h,'auto',res.planes),rebuilt,res.from,res.w,res.h);});
      commit({ ...layer, analysis: res, track: res.track, matte: res.matte ? { meta: res.matte } : null,items:updated }, 0);
    } catch (e) { if(!ctl.signal.aborted)setScanError(e instanceof Error ? e.message : String(e)); }
    finally{setBusy(null);scanAbort.current=null;}
  };
  const applyMaskCorrections=async()=>{if(!a?.occlusion||!corrections.length)return;const ctl=new AbortController();scanAbort.current=ctl;setScanError('');setBusy('Applying mask corrections');try{const path=await correctSpatialMasks(projectId,src.src,a.from,a.to,a.occlusion,corrections,ctl.signal,(share,message)=>setBusy(`${message} (${Math.round(share*100)}%)`));commit({...layer,corrections:[],analysis:{...a,occlusion:path}},0);}catch(e){if(!ctl.signal.aborted)setScanError((e as Error).message);}finally{setBusy(null);scanAbort.current=null;}};
  const refineForeground=async()=>{if(!a?.spatial)return;const ctl=new AbortController();scanAbort.current=ctl;setScanError('');setBusy('Preparing foreground refinement');try{const meta=layer.matte?.meta?await fetch(folder+layer.matte.meta).then(r=>r.json()):null,index=meta?.frames?.findIndex((f:any)=>f?.subjects?.length||f?.box)??-1;if(index<0)throw Error('No foreground instance was observed. Select or correct a foreground region before requesting detailed masks.');const info=meta.frames[index],subjects=info.subjects??[info],from=meta.times?.[index]??a.from+index/meta.fps,instances=subjects.map((s:any)=>({box:[s.box[0]/(meta.trackW??meta.w),s.box[1]/(meta.trackH??meta.h),s.box[2]/(meta.trackW??meta.w),s.box[3]/(meta.trackH??meta.h)]}));const path=await reconstructOcclusion(projectId,src.src,from,a.to,a.spatial,instances,ctl.signal,(share,message)=>setBusy(`${message} (${Math.round(share*100)}%)`));commit({...layer,analysis:{...a,occlusion:path}},0);}catch(e){if(!ctl.signal.aborted)setScanError((e as Error).message);}finally{setBusy(null);scanAbort.current=null;}};
  const objectTrack=async(i:number)=>{const it=items[i];if(!a||!solution||!pose||!it.spatialAnchor)return;if(!it.planeQuad){const [cx,cy]=it.anchor,r=Math.max(20,it.size);setItem(i,{planeQuad:[[cx-r,cy-r],[cx+r,cy-r],[cx+r,cy+r],[cx-r,cy+r]]});}setPlaneEditing(i);setScanError('Adjust the four surface corners, then press Track object surface.');};
  const finishObjectTrack=async(i:number)=>{if(!a||!solution)return;const ctl=new AbortController();scanAbort.current=ctl;setBusy('Tracking the selected object surface');setScanError('');try{const it=items[i],quad=it.planeQuad;if(!quad)throw Error('Set four corners around a rigid, textured object surface first.');const path=await reconstructPlanar(projectId,src.src,a.from,a.to,quad.map(p=>[p[0]/pw,p[1]/ph]),ctl.signal,(s,m)=>setBusy(`${m} (${Math.round(s*100)}%)`)),native=await fetch(folder+path).then(r=>r.json()),sx=pw/native.w,sy=ph/native.h,convert=(H:number[])=>[H[0],H[1]*sx/sy,H[2]*sx,H[3]*sy/sx,H[4],H[5]*sy,H[6]/sx,H[7]/sy,H[8]],track={...native,w:pw,h:ph,plane:quad,refPoints:native.refPoints.map((p:number[])=>[p[0]*sx,p[1]*sy]),frames:native.frames.map((f:any)=>({...f,H:convert(f.H)}))},trackPath=await putFile(projectId,path.replace('track.json','object-track.json'),JSON.stringify(track)),basePose=spatialPoseAt(solution,a.from*1e6),base=it.spatialAnchor,reference=anchorQuad({...base,rotation:[0,0,0],scale:[1,1,1],offset:[0,0,0],depthOffset:0,pivot:[.5,.5,0]},1,1,basePose);if(!reference)throw Error('The initial object plane has no verified camera pose.');setItem(i,{track:trackPath,spatialAnchor:{...base,type:'object',referencePixels:reference.map(p=>[p!.x/solution.width*pw,p!.y/solution.height*ph])}});setPlaneEditing(null);}catch(e){if(!ctl.signal.aborted)setScanError((e as Error).message);}finally{setBusy(null);scanAbort.current=null;}};
  const beginManualPlane=(i:number)=>{const it=items[i];if(!it.planeQuad){const [cx,cy]=it.anchor,r=Math.max(20,it.size);setItem(i,{planeQuad:[[cx-r,cy-r],[cx+r,cy-r],[cx+r,cy+r],[cx-r,cy+r]]});}setManualPlane(i);setPlaneEditing(i);setScanError('');};
  const manualFloat=(i:number)=>{try{if(!solution||!pose)throw Error('Choose a verified camera frame.');const it=items[i],p=apply(itemH(it),it.anchor),pixel=[p[0]/pw*solution.width,p[1]/ph*solution.height],anchor=worldAnchor(solution,Math.round(x*1e6),pixel,manualDistance),depth=projectWorld(anchor.position,pose)!.depth;setItem(i,{spatialAnchor:{...anchor,manual:true,depthSource:'user'},sceneDepth:.5,worldHeight:it.size/ph*solution.height/pose.intrinsics[1][1]*depth,spatialWarning:undefined});setScanError('');}catch(e){setScanError((e as Error).message);}};
  const confirmManualPlane=(i:number)=>{try{const it=items[i],pixels=it.planeQuad!.map(p=>{const q=apply(itemH(it),p);return [q[0]/pw*solution.width,q[1]/ph*solution.height];}),anchor=manualPlaneAnchor(solution,Math.round(x*1e6),pixels,manualDistance,homography),depth=projectWorld(anchor.position,pose)!.depth;setItem(i,{spatialAnchor:anchor,worldHeight:it.worldHeight??it.size/ph*solution.height/pose.intrinsics[1][1]*depth,spatialWarning:undefined});setManualPlane(null);setPlaneEditing(null);setScanError('');}catch(e){setScanError((e as Error).message);}};
  const L = layer.duration;
  return (
    <div className="flex flex-col gap-3 pt-2">
      {a ? (
        <details className="rounded-lg border border-[var(--border)] p-2.5"><summary className="cursor-pointer text-[12px] font-medium">{solution?'3D camera':'Surface tracking'} · {solution?.shots?.[0]?.quality??surfaceQuality}</summary><section className="mt-2 flex flex-col gap-1">
          <div className="flex items-center justify-between"><span className="text-[11px] font-semibold text-[var(--text)]">Selected surfaces</span><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${badge(surfaceQuality??'Poor')}`}>{surfaceQuality}</span></div>
          <p className="text-[11px] text-[var(--text-muted)]">Camera solve error {solution?.shots?.[0]?.reprojectionError?.toFixed(2)??a.medianError ?? '–'} px · {Math.round((a.inlierShare ?? 0) * 100)}% of camera points agree · {a.fps} fps analysis</p>
          {solution&&!pose&&<p className="text-[11px] text-[var(--warn)]">Camera pose is uncertain here. World layers are hidden until verified geometry returns.</p>}{a.notes.map((n, i) => <p key={i} className="text-[11px] leading-snug text-[var(--text-faint)]">{n}</p>)}
          <button type="button" className={T.secondary} onClick={() => setShowPoints((v) => !v)}>{showPoints ? <EyeOff size={13} /> : <Eye size={13} />}{showPoints ? 'Hide track points' : 'Show track points'}</button>
          {showPoints && track ? <StageOverlay points={(track.refPoints ?? []).map((p) => { const s = proxyToStage(apply(Hm, p as [number, number])); return [s.x, s.y] as [number, number]; })} /> : null}
        </section></details>
      ) : null}

      {solution&&<details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Inspect the scene</summary><div className="mt-2"><SpatialPreview projectId={projectId} folder={folder} solution={solution} time={x} sourceRect={R} items={items} tracks={sceneTracks} localTime={t} onMode={mode=>{if(mode==='inspect')setPlacing(null);}} onPoint={(sx,sy)=>{const index=gizmo??0,it=items[index];if(!it)return;const next=spatialItem({...it,spatialAnchor:undefined},solution,x,pw,ph,[clamp((sx-R.x)/R.w)*solution.width,clamp((sy-R.y)/R.h)*solution.height]);if(!next.spatialAnchor){setScanError('No reliable surface at this point. Choose another point or define a plane.');return;}setScanError('');setItem(index,next);}} onWorldPoint={(position,normal)=>{try{setItem(gizmo??0,{spatialAnchor:anchorFromGeometry(solution,Math.round(x*1e6),position,normal),spatialWarning:undefined});}catch(e){setScanError((e as Error).message);}}}/></div></details>}
      <details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Other effects{mode!=='textBehind'?` · ${EFFECT_MODES[mode]}`:''}</summary><label className={`${row} mt-2`}><span className="w-[84px] shrink-0">Effect</span>
        <select value={mode} onChange={(e) => commit({ ...layer, mode: e.target.value }, 0)} className={`${T.small} flex-1`}>{Object.entries(EFFECT_MODES).map(([id, n]) => <option key={id} value={id} disabled={id !== 'textBehind' && !layer.matte}>{n}{id !== 'textBehind' && !layer.matte ? ' (needs a subject mask)' : ''}</option>)}</select></label></details>

      {mode === 'textBehind' ? (
        <section className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold text-[var(--text)]">In the scene</span>
          <div className="grid grid-cols-2 gap-1.5"><button type="button" onClick={()=>setPlacing({tpl:'surface',value:'TEXT'})} className={`${T.tile} h-10 gap-1.5`}><Type size={14}/>Text</button><button type="button" onClick={()=>fileRef.current?.click()} className={`${T.tile} h-10 gap-1.5`}><ImagePlus size={14}/>Import asset</button></div>
          <details><summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">More elements</summary><div className="mt-2 grid grid-cols-2 gap-1.5"><button type="button" onClick={()=>setPlacing({tpl:'location',value:'LOCATION'})} className={T.secondary}><MapPin size={13}/>Location</button><button type="button" onClick={()=>setStickersOpen(v=>!v)} className={T.secondary}><Sticker size={13}/>Sticker</button></div></details>
          <input ref={fileRef} type="file" accept="image/*,video/*,.glb,.fbx" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy('Adding the picture…'); try { const path = await uploadPicture(projectId, f); const model=/\.(glb|fbx)$/i.test(path),info=model?await inspectModel(projectId,folder,path):null;if(model&&!info?.meshes)throw Error('Choose a character or prop containing a mesh. Add animation-only files to an existing model.');setPlacing({ tpl: model?'model':f.type.startsWith('video/')?'video':'image', value: path,info }); setBusy(null); } catch (err) { setScanError(err instanceof Error ? err.message : String(err));setBusy(null); } }} />
          {stickersOpen ? (
            <div className="grid grid-cols-4 gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1.5" style={{ animation: 'mg-in .18s cubic-bezier(.22,1,.36,1) both' }}>
              {STICKERS.map(([id, n]) => (
                <button key={id} type="button" title={n} aria-label={n} className="flex h-12 items-center justify-center rounded-md bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:10px_10px] transition hover:bg-[var(--fill-tsp)]"
                  onClick={async () => { setStickersOpen(false); const path = await stickerPath(projectId, id); setPlacing({ tpl: 'sticker', value: path }); }}>
                  <img src={`/assets/stickers/${id}.svg`} alt="" className="max-h-9 max-w-[42px]" />
                </button>))}
            </div>) : null}
          {(layer.matte||a?.occlusion)&&footageVisible&&showForeground&&<ForegroundOutline folder={folder} occlusionPath={a?.occlusion} mattePath={layer.matte?.meta} time={x} sourceRect={R}/>}
          <StageOverlay pick={placing != null&&footageVisible} pickBounds={R} hint={typeof placing === 'number' ? 'Click its new place' : placing?.tpl === 'location' ? 'Click the wall or ground the title sits on' : 'Click where it goes (its base)'} onPick={(sx, sy) => {
            const anchor = pickReference(sx,sy);
            const wantsSurface=typeof placing==='number'?items[placing]?.place==='surface':!!placing&&['surface','location','image','video','model'].includes(placing.tpl);
            const attach=(it:TrackItem)=>spatialItem(wantsSurface?{...it,place:'surface'}:it,solution,x,pw,ph,solution?[clamp((sx-R.x)/R.w)*solution.width,clamp((sy-R.y)/R.h)*solution.height]:undefined);
            if (placing && typeof placing === 'object'){const item=attach(sceneItem({...fitItem(itemFor(['model','video'].includes(placing.tpl)?'image':placing.tpl, placing.value, anchor, ph),a?.content,pw,ph),anchor},a?.scene,pw,ph,'auto',a?.planes));if(solution&&!item.spatialAnchor){setScanError('No reliable surface at this point. Choose another point or define a plane.');return;}if(item.spatialAnchor?.type==='surface')item.place='surface';if(['model','video'].includes(placing.tpl)){if(!item.spatialAnchor){setScanError('This asset needs a verified world position. Choose a supported surface.');return;}delete item.image;item[placing.tpl==='model'?'model':'video']=placing.value;if(placing.tpl==='model'){Object.assign(item,{clips:placing.info?.clips??[],animations:placing.info?.clips?.length?[{src:placing.value,clip:0,at:0,duration:Math.min(L,placing.info.clips[0].duration),loop:false,inPlace:true,fade:.15}]:[]});}}setItems([...items,item],0);} else if (typeof placing === 'number'){const item=attach(sceneItem({...items[placing],anchor,spatialAnchor:undefined},a?.scene,pw,ph,'auto',a?.planes));if(solution&&!item.spatialAnchor){setScanError('No reliable surface at this point. Choose another point or define a plane.');return;}if(item.spatialAnchor?.type==='surface')item.place='surface';setItem(placing,item);}setScanError('');
            setPlacing(null);
          }} surfaces={markers} path={planeEditing==null?[]:undefined} nodes={!footageVisible?[]:planeEditing!=null?(items[planeEditing]?.planeQuad??[]).map((p,i)=>({id:`corner-${i}`,...proxyToStage(apply(itemH(items[planeEditing]),p)),label:String(i+1)})):items.flatMap((it, i) => {const world=liveAnchor(it)&&pose?projectWorld(liveAnchor(it)!.position,pose):null;if(it.spatialAnchor&&!world)return [];return [{id:String(i),...proxyToStage(world?[world.x/solution.width*pw,world.y/solution.height*ph]:it.place==='standing'?placedPoint(itemH(it),it.anchor,it.sceneDepth??.5):apply(itemH(it),it.anchor)),label:String(i+1)}];})} onDrop={(id, sx, sy) => {if(id.startsWith('corner-')&&planeEditing!=null){const it=items[planeEditing],quad=it.planeQuad!.map((p,i)=>i===Number(id.slice(7))?stageToRef(sx,sy,it):p);setItem(planeEditing,{planeQuad:quad,sceneClip:quad});}else {const it=items[Number(id)];if(it.spatialAnchor&&pose&&solution){const ray=cameraRay([clamp((sx-R.x)/R.w)*solution.width,clamp((sy-R.y)/R.h)*solution.height],pose),position=rayPlane(ray,it.spatialAnchor.position,it.spatialAnchor.normal);if(position)setItem(Number(id),{spatialAnchor:{...it.spatialAnchor,position}});}else setItem(Number(id), { anchor: stageToRef(sx, sy, it) });}}} />
          {items.map((it, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2">
              <div className="flex items-center gap-1.5"><span className="text-[11px] font-bold text-[var(--accent)]">{i + 1}</span>
                {it.image||it.video||it.model ? <span className="flex min-w-0 flex-1 items-center gap-1.5">{it.image&&<img src={`${folder}${it.image}`} alt="" className="h-6 w-8 rounded object-contain bg-[var(--fill-tsp)]" />}<span className="truncate text-[11px] text-[var(--text-dim)]">{(it.image??it.video??it.model)!.split('/').pop()}</span></span>
                  : <input value={it.text ?? ''} onChange={(e) => setItem(i, { text: e.target.value })} className={`${T.small} min-w-0 flex-1`} aria-label={it.card === 'location' ? 'Place name' : 'Text'} />}
                <button type="button" aria-label="Place on the picture" title="Place on the picture" onClick={() => setPlacing(i)} className={T.icon}><Crosshair size={13} /></button>
                <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i), 0)} className={T.icon}><Trash2 size={13} /></button></div>
              {it.card === 'location' ? <div className="grid grid-cols-2 gap-1.5">
                <input value={it.sub ?? ''} onChange={(e) => setItem(i, { sub: e.target.value })} placeholder="District · City" className={T.small} aria-label="Second line" />
                <input value={it.sub2 ?? ''} onChange={(e) => setItem(i, { sub2: e.target.value })} placeholder="Time or coordinates" className={T.small} aria-label="Third line" />
              </div> : null}
              {it.model&&<ModelActions object={{...it,type:'model'} as unknown as DeviceObject} index={i} layer={layer} folder={folder} projectId={projectId} commit={commit} setObject={patch=>setItem(i,patch as Partial<TrackItem>)}/>}
              {!it.model&&!it.video&&<FontPicker value={it.font??'Sora'} onChange={font=>setItem(i,{font})}/>}
              <div className="flex items-center justify-between gap-1.5">
                <label className={row}><input aria-label={it.place==='surface'?'Text shadow':'Ground shadow'} type="checkbox" checked={!!it.shadow} onChange={e=>setItem(i,{shadow:e.target.checked})}/>{it.place==='surface'?'Text shadow':'Ground shadow'}</label>
                <label className={`${row} justify-end`}>Colour <input type="color" value={it.color ?? '#ffffff'} onChange={(e) => setItem(i, { color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" /></label>
              </div>
              <Slider label="Size" value={it.size} min={ph * 0.03} max={ph * 1.2} step={1} onChange={(v) => setItem(i, { size: v,...(it.worldHeight?{worldHeight:it.worldHeight*v/it.size}:{}) })} fmt={(v) => `${Math.round((v / ph) * 100)}%`} />
              <Slider label={it.spatialAnchor?'Depth':'Distance'} value={it.spatialAnchor?clamp(.5-(it.spatialAnchor.depthOffset??0)/2):it.sceneDepth??.5} min={0} max={1} step={.01} onChange={v=>setItem(i,{sceneDepth:v,...(it.spatialAnchor?{spatialAnchor:{...it.spatialAnchor,depthOffset:(.5-v)*2}}:{})})} fmt={v=>`${Math.round(v*100)}%`}/>
              {it.spatialAnchor&&<div className={segWrap}>{(['move','rotate','scale'] as const).map(mode=><button type="button" key={mode} className={seg(gizmo===i&&gizmoMode===mode)} onClick={()=>{setGizmo(i);setGizmoMode(mode);}}>{mode[0].toUpperCase()+mode.slice(1)}</button>)}<button type="button" className={seg(false)} onClick={()=>setOrientation(v=>v==='local'?'world':'local')}>{orientation==='local'?'Local':'World'}</button></div>}
              {it.spatialAnchor&&gizmo===i&&pose&&solution&&<SpatialGizmo anchor={liveAnchor(it)??anchorFrame(it.spatialAnchor,null,pose)} pose={pose} solution={solution} sourceRect={R} mode={gizmoMode} orientation={orientation} onChange={frame=>{const resolved={...it,spatialAnchor:resolvedBase(it)},edited=editSpatialPose(resolved,frame,t,record||it.spatialAnchor?.type==='object',pose);if(it.spatialAnchor?.type==='object')setItem(i,{motion:edited.motion});else if(it.spatialAnchor?.parentId!=null){const parent=items.find((p,j)=>String(p.id??j)===String(it.spatialAnchor!.parentId)),parentFrame=parent&&liveAnchor(parent);setItem(i,record?{motion:edited.motion}:parentFrame?{spatialAnchor:relativeAnchor(edited.spatialAnchor,parentFrame)}:{});}else setItem(i,edited);}}/>}
              {planeEditing===i&&it.spatialAnchor&&<button type="button" className={T.primary} disabled={!!busy} onClick={()=>void finishObjectTrack(i)}>Track object surface</button>}
              {it.spatialAnchor&&<p className={T.hint}>Reconstructed world anchor · {it.spatialAnchor.support??'free'} surface observations</p>}
              {solution&&!it.spatialAnchor&&<div className="flex flex-col gap-1.5"><p className={T.hint}>Surface depth is uncertain. Choose a relative depth or define a plane.</p><label className={row}>Relative depth<input aria-label="Manual relative depth" type="number" step={.1} min={.1} value={manualDistance} onChange={e=>setManualDistance(Math.max(.1,Number(e.target.value)))} className={`${T.small} w-20`}/></label><div className="flex gap-1"><button type="button" className={T.secondary} onClick={()=>manualFloat(i)}>Float at this depth</button><button type="button" className={T.secondary} onClick={()=>beginManualPlane(i)}>Define four corners</button></div></div>}
              {manualPlane===i&&<div className="flex flex-col gap-1.5"><p className={T.hint}>Drag the four corners around one rectangular surface. Depth is a relative distance you choose.</p><label className={row}>Relative depth<input type="number" aria-label="Manual plane depth" min={.1} step={.1} value={manualDistance} onChange={e=>setManualDistance(Math.max(.1,Number(e.target.value)))} className={`${T.small} w-20`}/></label><button type="button" className={T.primary} onClick={()=>confirmManualPlane(i)}>Use this plane</button><button type="button" className={T.secondary} onClick={()=>{setManualPlane(null);setPlaneEditing(null);}}>Cancel plane correction</button></div>}
              {it.spatialWarning&&<p className="text-[11px] text-[var(--warn)]">{it.spatialWarning}</p>}
              {it.spatialAnchor&&<SpatialControls items={items} index={i} pose={pose} item={it} t={t} sourceTime={x} solution={solution} record={record} onRecord={setRecord} onPlane={()=>beginManualPlane(i)} onObject={()=>void objectTrack(i)} onChange={patch=>setItem(i,patch)}/>}
              <p className={T.hint}>{it.surfaceName??'Scene point'} · {it.planeQuad?'Perspective follows this surface':'Standing in the scene'} · relative depth</p>
              {!it.spatialAnchor&&a?.planes?.find(p=>p.track===it.track)?.quality==='Poor'&&<p className="text-[11px] leading-snug text-[var(--warn)]">Some moments on this surface are uncertain. The title fades during those moments.</p>}
              <details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Placement and 3D look</summary><div className="mt-2 flex flex-col gap-1.5">
              <button type="button" className={T.secondary} onClick={()=>{const next=sceneItem(it,a?.scene,pw,ph,'auto',a?.planes),p=apply(itemH(it),it.anchor);setItem(i,spatialItem(next,solution,x,pw,ph,solution?[p[0]/pw*solution.width,p[1]/ph*solution.height]:undefined));}}>Match the surface at this point</button>
              {it.planeQuad&&<button type="button" className={T.secondary} onClick={()=>setPlaneEditing(planeEditing===i?null:i)}>{planeEditing===i?'Finish wall corners':'Adjust wall corners'}</button>}
              {!it.spatialAnchor&&<>
              <Slider label="Horizontal" value={it.anchor[0] / pw * 100} min={0} max={100} step={.5} onChange={v => setItem(i, { anchor: [pw * v / 100, it.anchor[1]] })} fmt={v => `${Math.round(v)}%`} />
              <Slider label="Ground line" value={it.anchor[1] / ph * 100} min={0} max={100} step={.5} onChange={v => setItem(i, { anchor: [it.anchor[0], ph * v / 100] })} fmt={v => `${Math.round(v)}%`} />
              {it.place === 'standing' ? <>
                <Slider label="Height" value={it.elevation ?? 0} min={0} max={2} step={.02} onChange={v => setItem(i, { elevation: v })} />
                <Slider label="Thickness" value={it.depth ?? 0.15} min={0} max={0.6} step={0.01} onChange={(v) => setItem(i, { depth: v })} />
                <Slider label="Tilt" value={it.tiltX ?? 0} min={-80} max={80} step={1} onChange={(v) => setItem(i, { tiltX: v })} fmt={(v) => `${v}°`} />
                <Slider label="Turn" value={it.rotationY ?? 0} min={-80} max={80} step={1} onChange={(v) => setItem(i, { rotationY: v })} fmt={(v) => `${v}°`} />
                <label className={`${row} justify-between`}><span>Separate letters</span><input type="checkbox" checked={!!it.letters} onChange={(e) => setItem(i, { letters: e.target.checked })} /></label>
                {it.letters ? <Slider label="Spacing" value={it.spacing ?? 1} min={.8} max={2} step={.02} onChange={v => setItem(i, { spacing: v })} /> : null}
              </> : <Slider label="Rotation" value={it.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => setItem(i, { rotation: v })} fmt={(v) => `${v}°`} />}
              </>}
              </div></details>
              <details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Entrance and exit animation</summary><div className="mt-2 flex flex-col gap-1.5">
              <AnimRow label="In" style={it.anim} dur={it.in ?? 0} onChange={(anim, d) => setItem(i, { anim, in: d })} />
              <AnimRow label="Out" style={it.animOut ?? it.anim} dur={it.out ?? 0} onChange={(animOut, d) => setItem(i, { animOut, out: d })} />
              {it.letters ? <Slider label="Letter delay" value={it.stagger ?? 0.035} min={0} max={0.2} step={0.005} onChange={(v) => setItem(i, { stagger: v })} fmt={(v) => `${Math.round(v * 1000)}ms`} /> : null}
              </div></details>
            </div>
          ))}
          {layer.matte||a?.occlusion ? (
            <div className="flex flex-col gap-1.5"><div className="flex items-center justify-between"><span className="text-[11.5px] font-medium text-[var(--text)]">Detected foreground</span><button type="button" aria-pressed={showForeground} onClick={()=>setShowForeground(v=>!v)} className="text-[11px] text-[var(--accent)]">{showForeground?'Hide outlines':'Show outlines'}</button></div>
              <div className={segWrap} role="group" aria-label="Foreground order">{(['auto','front','behind'] as const).map(m=><button key={m} type="button" aria-pressed={depthHere.mode===m} className={seg(depthHere.mode===m)} onClick={()=>patchDepth({mode:m})}>{m==='front'?'In front':m==='behind'?'Behind':'Auto'}</button>)}</div>
              {solution&&(!a?.occlusion||sceneTracks[a.occlusion]?.relativeDepthOnly)&&<p className="text-[11px] text-[var(--warn)]">Measured foreground depth is unavailable. Choose Behind or In front for explicit ordering.</p>}
              <details><summary className="cursor-pointer text-[11.5px] font-medium text-[var(--text-muted)]">Foreground adjustments</summary><div className="mt-2 flex flex-col gap-1.5">
              <p className={T.hint}>Depth for this timeline section</p>{solution&&<button type="button" className={T.secondary} disabled={!!busy} onClick={()=>void refineForeground()}><RefreshCw size={12}/>Refine foreground only</button>}
              {occlusionData&&<><label className={row}>Foreground<select aria-label="Occlusion target" className={`${T.small} min-w-0 flex-1`} value={depthHere.target??'all'} onChange={e=>patchDepth({target:e.target.value==='all'?'all':Number(e.target.value)})}><option value="all">All tracked instances</option>{(occlusionFrame?.instances??[]).map((person:any)=><option key={person.id} value={person.id}>Instance {person.id}</option>)}</select></label><div className="flex gap-1.5 overflow-x-auto">{(occlusionFrame?.instances??[]).map((instance:any)=><button type="button" key={instance.id} aria-label={`Use foreground instance ${instance.id}`} aria-pressed={depthHere.target===instance.id} onClick={()=>patchDepth({target:instance.id})} className={`shrink-0 rounded-md border p-1 ${depthHere.target===instance.id?'border-[var(--accent)]':'border-[var(--border)]'}`}><img alt={`Mask of instance ${instance.id}`} src={folder+a!.occlusion!.slice(0,a!.occlusion!.lastIndexOf('/')+1)+instance.path} className="h-12 w-20 object-contain"/><span className={T.hint}>Instance {instance.id}</span></button>)}</div><details><summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">Manual foreground depth</summary><label className={`${row} mt-2`}><input type="checkbox" checked={depthHere.mode==='manual'} onChange={e=>patchDepth({mode:e.target.checked?'manual':'auto'})}/>Use a chosen relative depth</label><input aria-label="Manual foreground depth" type="number" min={.01} step={.05} className={`${T.small} mt-1 w-full`} value={depthHere.manualDepth??3} onChange={e=>patchDepth({mode:'manual',manualDepth:Math.max(.01,Number(e.target.value))})}/></details></>}

              <DepthLane length={L} t={t} ranges={ranges} onChange={setRanges} />
              <p className={T.hint}>Default above; drag ranges on the bar for moments that differ (click a range to switch it, double-click to remove). Auto uses calibrated depth when available. If scene depth is uncertain, choose an explicit order and check the preview.</p>
            </div></details></div>
          ) : <p className={T.hint}>Foreground detection was unavailable. Scan the footage again to place objects behind subjects.</p>}
        </section>
      ) : <ModeSettings layer={layer} commit={commit} film={film} />}

      {layer.matte ? (
        <details className="rounded-lg border border-[var(--border)] p-2.5"><summary className="cursor-pointer text-[11.5px] font-medium">Subject mask corrections</summary><section className="mt-2 flex flex-col gap-1.5">
          <Slider label="Feather" value={layer.feather ?? 0.05} min={0.005} max={0.45} step={0.01} onChange={(v) => commit({ ...layer, feather: v }, 60)} />
          <Slider label="Edge shift" value={layer.edgeShift ?? 0} min={-0.3} max={0.3} step={0.01} onChange={(v) => commit({ ...layer, edgeShift: v }, 60)} fmt={(v) => (v > 0 ? `in ${round(v)}` : v < 0 ? `out ${round(-v)}` : '0')} />
          <div className="flex gap-1.5">
            <button type="button" className={`${T.secondary} ${brush === 'add' ? 'border-[var(--accent)]' : ''}`} onClick={() => setBrush(brush === 'add' ? null : 'add')}><Brush size={13} />Add to mask</button>
            <button type="button" className={`${T.secondary} ${brush === 'remove' ? 'border-[var(--accent)]' : ''}`} onClick={() => setBrush(brush === 'remove' ? null : 'remove')}><Eraser size={13} />Remove</button>
          </div>
          <StageOverlay pick={!!brush} hint={brush === 'add' ? 'Click a part the mask missed' : 'Click a part that should not be masked'} onPick={(sx, sy) => {
            const px = ((sx - R.x) / R.w), py = ((sy - R.y) / R.h); if(px<0||py<0||px>1||py>1)return;setBrush(null);
            commit({ ...layer, corrections: [...corrections, { x: round(px), y: round(py), r: 0.05, ...(depthHere.target&&depthHere.target!=='all'?{instanceId:Number(depthHere.target)}:{}), add: brush === 'add', from: a?.spatial&&occlusionFrame?occlusionFrame.sourceTimeUs/1e6:round(x-.5), to:a?.spatial&&occlusionFrame?occlusionFrame.sourceTimeUs/1e6:round(x+.5) }] }, 0);
          }} />
          {corrections.length ? <p className="text-[11px] text-[var(--text-muted)]">{corrections.length} correction{corrections.length === 1 ? '' : 's'} ({a?.spatial?'at its source frame':'each over a second around where it was made'}). <button type="button" className="text-[var(--accent)]" onClick={() => commit({ ...layer, corrections: [] }, 0)}>Clear</button></p> : null}
          <button type="button" disabled={!!busy} className={T.secondary} onClick={() => void (a?.spatial?(a.occlusion&&corrections.length?applyMaskCorrections():refineForeground()):recalc())}><RefreshCw size={13} className={busy ? 'animate-spin' : ''} />{busy ?? 'Recalculate mask with corrections'}</button>
        </section></details>
      ) : null}
      {busy&&<><ScanOverlay clipId={layer.clipId} rect={R} seen={null} projectId={projectId} sourcePath={src.src} source={src.src?`${folder}${src.src}`:undefined} from={a?.from} to={a?.to}/><p role="status" className={T.hint}>{busy}</p><button type="button" className={T.secondary} onClick={()=>scanAbort.current?.abort()}>Cancel scan</button></>}
      {scanError&&<p role="alert" className="text-[11px] text-[var(--err)]">{scanError}</p>}
    </div>
  );
}

/** an entrance or exit: its style (none = appears / goes at once) and how long it takes */
function AnimRow({ label, style, dur, onChange }: { label: string; style?: AnimName; dur: number; onChange: (s: AnimName, d: number) => void }) {
  const on = dur > 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[26px] shrink-0 text-[11px] text-[var(--text-dim)]">{label}</span>
      <select value={on ? style ?? 'fade' : 'none'} onChange={(e) => { const v = e.target.value; if (v === 'none') onChange((style ?? 'fade') as AnimName, 0); else onChange(v as AnimName, on ? dur : 0.45); }} className={`${T.small} min-w-0 flex-1`} aria-label={`Animate ${label.toLowerCase()}`}>
        <option value="none">None</option>{Object.entries(ANIM_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      <input type="range" min={0.1} max={2} step={0.05} value={on ? dur : 0.45} disabled={!on} onChange={(e) => onChange((style ?? 'fade') as AnimName, Number(e.target.value))} className="w-16 accent-[var(--accent)] disabled:opacity-40" aria-label={`${label} duration`} />
      <span className="w-8 text-right text-[11px] tabular-nums text-[var(--text)]">{on ? `${round(dur)}s` : ''}</span>
    </div>
  );
}

function DepthLane({ length, t, ranges, onChange }: { length: number; t: number; ranges: DepthRange[]; onChange: (r: DepthRange[]) => void }) {
  const ref = React.useRef<HTMLDivElement>(null); const [drag, setDrag] = React.useState<{ i: number; edge: 'from' | 'to' } | null>(null);
  const at = (cx: number) => { const r = ref.current!.getBoundingClientRect(); return round(Math.min(1, Math.max(0, (cx - r.left) / r.width)) * length); };
  const pct = (v: number) => `${(Math.min(length, Math.max(0, v)) / length) * 100}%`;
  const color = { behind: 'bg-[#4568ee]/75', front: 'bg-[#f59e0b]/80', auto: 'bg-[#10b981]/75',manual:'bg-[#64748b]/80' };
  return (
    <div className="flex flex-col gap-1">
      <div ref={ref} className="relative h-8 select-none rounded-md bg-[var(--fill-tsp)]" onPointerMove={(e) => { if (!drag) return; const v = at(e.clientX); onChange(ranges.map((r, j) => (j === drag.i ? (drag.edge === 'from' ? { ...r, from: Math.min(v, r.to - 0.05) } : { ...r, to: Math.max(v, r.from + 0.05) }) : r))); }} onPointerUp={() => setDrag(null)}>
        {ranges.map((r, i) => (
          <div key={i} className={`absolute inset-y-1 rounded ${color[r.mode]} cursor-pointer text-center text-[10px] font-semibold leading-6 text-white`} style={{ left: pct(r.from), width: `calc(${pct(r.to)} - ${pct(r.from)})` }}
            onClick={() => onChange(ranges.map((q, j) => (j === i ? { ...q, mode: q.mode === 'behind' ? 'front' : q.mode === 'front' ? 'auto' : 'behind' } : q)))} onDoubleClick={() => onChange(ranges.filter((_, j) => j !== i))}>
            {r.mode === 'behind' ? 'Behind' : r.mode === 'front' ? 'Front' : r.mode==='manual'?'Depth':'Auto'}
            {(['from', 'to'] as const).map((edge) => <span key={edge} className={`absolute inset-y-0 w-2 cursor-ew-resize ${edge === 'from' ? 'left-0' : 'right-0'}`} onPointerDown={(e) => { e.stopPropagation(); (ref.current as HTMLElement).setPointerCapture(e.pointerId); setDrag({ i, edge }); }} />)}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,.4)]" style={{ left: pct(t) }} />
      </div>
      <button type="button" className="self-start text-[11px] text-[var(--accent)]" onClick={() => onChange([...ranges, { from: round(t), to: round(Math.min(length, t + 1)), mode: 'front' }])}>+ Range at the playhead</button>
    </div>
  );
}

function ModeSettings({ layer, commit, film }: { layer: FrameLayer; commit: (l: FrameLayer, d?: number) => void; film: Film | null }) {
  const m = layer.mode as EffectMode; const L = layer.duration; const set = (p: Record<string, unknown>) => commit({ ...layer, ...p }, 80);
  const clips = (film?.tracks ?? []).flatMap((tr) => tr.clips).filter((c) => /\.(mp4|mov|webm|m4v)$/i.test(c.src.split('#')[0]));
  return (
    <section className="flex flex-col gap-1.5">
      {m === 'cutout' ? <><Slider label="Starts at" value={layer.popFrom ?? 0} min={0} max={L} step={0.05} onChange={(v) => set({ popFrom: v })} fmt={(v) => `${round(v)}s`} /><Slider label="Lift" value={layer.popScale ?? 0.06} min={0} max={0.25} step={0.01} onChange={(v) => set({ popScale: v })} /><Slider label="Outline" value={layer.outline ?? 3} min={0} max={10} step={0.5} onChange={(v) => set({ outline: v })} /></> : null}
      {m === 'outline' ? <><Slider label="Outline" value={layer.outline ?? 3} min={0.5} max={10} step={0.5} onChange={(v) => set({ outline: v })} /><Slider label="Trace from" value={layer.traceFrom ?? 0} min={0} max={L} step={0.05} onChange={(v) => set({ traceFrom: v })} fmt={(v) => `${round(v)}s`} /><Slider label="Trace to" value={layer.traceTo ?? Math.min(L, 1.2)} min={0} max={L} step={0.05} onChange={(v) => set({ traceTo: v })} fmt={(v) => `${round(v)}s`} /></> : null}
      {m === 'cutout' || m === 'outline' || m === 'freezePop' ? <label className={`${row} justify-between`}>Outline colour <input type="color" value={layer.outlineColor ?? '#ffffff'} onChange={(e) => set({ outlineColor: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" /></label> : null}
      {m === 'focus' ? <><Slider label="Focus from" value={layer.focusFrom ?? 0} min={0} max={L} step={0.05} onChange={(v) => set({ focusFrom: v })} fmt={(v) => `${round(v)}s`} /><Slider label="Focus to" value={layer.focusTo ?? L} min={0} max={L} step={0.05} onChange={(v) => set({ focusTo: v })} fmt={(v) => `${round(v)}s`} /><p className={T.hint}>Shifts sharpness from the background to the person (a layered approximation from the mask: there is no depth map).</p></> : null}
      {m === 'parallax' ? <p className={T.hint}>The person and the background drift at different speeds. Edges behind the person are filled from a slightly enlarged background (an approximation; nothing is invented).</p> : null}
      {m === 'maskReveal' ? <label className={row}><span className="w-[84px] shrink-0">Reveal clip</span><select value={layer.revealSrc ?? ''} onChange={(e) => set({ revealSrc: e.target.value || null })} className={`${T.small} flex-1`}><option value="">Choose a video…</option>{clips.map((c) => <option key={c.id} value={c.src.split('#')[0]}>{c.src.split('#')[0].split('/').pop()}</option>)}</select></label> : null}
      {m === 'freezePop' ? <><Slider label="Freeze at" value={layer.freezeAt ?? 0.5} min={0} max={L} step={0.05} onChange={(v) => set({ freezeAt: v })} fmt={(v) => `${round(v)}s`} /><Slider label="Hold" value={layer.freezeHold ?? 1.2} min={0.2} max={L} step={0.05} onChange={(v) => set({ freezeHold: v })} fmt={(v) => `${round(v)}s`} /></> : null}
      {m === 'echo' ? <><Slider label="Echoes" value={layer.echoCount ?? 3} min={1} max={5} step={1} onChange={(v) => set({ echoCount: v })} /><Slider label="Spacing" value={layer.echoGap ?? 0.08} min={0.02} max={0.3} step={0.01} onChange={(v) => set({ echoGap: v })} fmt={(v) => `${round(v)}s`} /><Slider label="Opacity" value={layer.echoOpacity ?? 0.45} min={0.1} max={0.9} step={0.05} onChange={(v) => set({ echoOpacity: v })} /></> : null}
    </section>
  );
}
