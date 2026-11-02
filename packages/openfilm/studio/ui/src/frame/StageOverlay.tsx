import React from 'react';
import { createPortal } from 'react-dom';
import { createNameDropRipple } from './nameDropRipple';
import { createVideoRefraction } from './videoRefraction';

/* Editing guides drawn over the preview itself (the 3D tools): a camera target crosshair, a motion path with draggable
   points, tracking points, a click to pick a point or a subject. Coordinates are 0…1 of the stage (x right, y down),
   so they follow any zoom or resize of the preview. Nothing here is in the video: it is only shown while editing. */
export type OverlayNode = { id: string; x: number; y: number; label?: string; active?: boolean };
/** a diamond on a surface: its point, and (plane) the surface around it as the camera sees it, 0…1 of the stage */
export type SurfaceMarker={id:string;x:number;y:number;quad:[number,number][];title:string;plane?:[number,number][]};
/** the unit square onto a quad (TL TR BR BL), as a homography: grid lines and the gem drawn in the surface's own tilt */
function squareTo(q:[number,number][]){const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=q,dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3,den=dx1*dy2-dx2*dy1||1e-9,g=(sx*dy2-dx2*sy)/den,h=(dx1*sy-sx*dy1)/den;
  const a=x1-x0+g*x1,b=x3-x0+h*x3,d=y1-y0+g*y1,e=y3-y0+h*y3;return (u:number,v:number):[number,number]=>{const z=g*u+h*v+1;return [(a*u+b*v+x0)/z,(d*u+e*v+y0)/z];};}
/** a surface drawn as a see-through plane with a light grid (the scene's wireframe) and a faceted gem standing on it */
function PlaneMarker({quad,focus=false}:{quad:[number,number][];focus?:boolean}){
  const M=squareTo(quad),pt=(u:number,v:number)=>M(u,v).join(','),line=(a:[number,number],b:[number,number],k:string)=><line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/>;
  const grid=[1,2,3].flatMap(i=>[line(M(i/4,0),M(i/4,1),`u${i}`),line(M(0,i/4),M(1,i/4),`v${i}`)]);
  const c=M(.5,.5),d=.16,top=M(.5,.5-d*1.25),right=M(.5+d,.5),bottom=M(.5,.5+d*1.25),left=M(.5-d,.5),peak:[number,number]=[c[0],c[1]-Math.max(2,Math.hypot(top[0]-c[0],top[1]-c[1])*.35)];
  const tri=(a:[number,number],b:[number,number],fill:string,k:string)=><polygon key={k} points={[a,b,peak].map(p=>p.join(',')).join(' ')} fill={fill}/>;
  const tone=focus?['#ffe08a','#f8c537','#d99a0b','#eab308']:['#c7d4ff','#7d97f7','#3f5bd6','#5a76ea'];
  return <g style={{filter:'drop-shadow(0 1px 2px rgba(0,0,0,.45))'}}>
    <polygon points={[pt(0,0),pt(1,0),pt(1,1),pt(0,1)].join(' ')} fill={focus?'rgba(250,204,21,.22)':'rgba(69,104,238,.20)'} stroke={focus?'#facc15':'rgba(150,175,255,.95)'} strokeWidth={focus?1.6:1}/>
    <g stroke={focus?'rgba(250,204,21,.45)':'rgba(160,185,255,.35)'} strokeWidth={.8}>{grid}</g>
    {tri(top,right,tone[0],'a')}{tri(right,bottom,tone[1],'b')}{tri(bottom,left,tone[2],'c')}{tri(left,top,tone[3],'d')}
    <polygon points={[top,right,bottom,left].map(p=>p.join(',')).join(' ')} fill="none" stroke="white" strokeWidth={1.1} strokeLinejoin="round"/>
  </g>;
}
export type StageRect=DOMRect&{clip:{left:number;top:number;width:number;height:number}};
export function stageClipStyle(rect:StageRect){const c=rect.clip;return{clipPath:`inset(${Math.max(0,c.top-rect.top)}px ${Math.max(0,rect.right-c.left-c.width)}px ${Math.max(0,rect.bottom-c.top-c.height)}px ${Math.max(0,c.left-rect.left)}px)`};}
export function useStageRect() {
  const [rect, setRect] = React.useState<StageRect | null>(null);
  React.useEffect(() => {
    const tick = () => { const el=document.querySelector('[data-viewer-pane] .stage'),pane=el?.closest('[data-viewer-pane]'),r=el?.getBoundingClientRect(),p=pane?.getBoundingClientRect();if(!r||!p){setRect(null);return;}let left=Math.max(0,r.left,p.left),top=Math.max(0,r.top,p.top),right=Math.min(innerWidth,r.right,p.right),bottom=Math.min(innerHeight,r.bottom,p.bottom);for(const panel of document.querySelectorAll<HTMLElement>('[data-inspector-panel],[data-frame-pane]')){if(getComputedStyle(panel).visibility==='hidden')continue;const b=panel.getBoundingClientRect();/* a tool panel open over the picture: guides stop at its edge */if(b.bottom<=top||b.top>=bottom||b.right<=left||b.left>=right)continue;if(b.top<=top&&b.bottom>=bottom){if(b.left>left)right=Math.min(right,b.left);else left=Math.max(left,b.right);}}if(right-left<64)right=left;const clip={left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};setRect(o=>o&&o.x===r.x&&o.y===r.y&&o.width===r.width&&o.height===r.height&&JSON.stringify(o.clip)===JSON.stringify(clip)?o:Object.assign(r,{clip})); };
    tick(); const timer = window.setInterval(tick, 120);
    window.addEventListener('resize', tick); window.addEventListener('scroll', tick, true);
    return () => { clearInterval(timer); window.removeEventListener('resize', tick); window.removeEventListener('scroll', tick, true); };
  }, []);
  return rect;
}

const diamondStyle = typeof document !== 'undefined' && !document.getElementById('scene-track-diamond-style') ? (() => { const el = document.createElement('style'); el.id = 'scene-track-diamond-style'; el.textContent = '@keyframes scene-diamond-in{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}.scene-track-diamond{animation:scene-diamond-in 260ms cubic-bezier(.22,1,.36,1) both}.scene-track-target{animation:scene-diamond-in 140ms ease-out both}@media(prefers-reduced-motion:reduce){.scene-track-diamond,.scene-track-target{animation:none}}'; document.head.appendChild(el); return el; })() : null;
void diamondStyle;
export function StageOverlay({ nodes = [], surfaces=[], trackPoints=[], hoverTarget=null, onHover, showSurfaces=false, focus=null, path, target, points, pick, pickBounds, onPick, onCancel, onMove, onDrop, hint, box }: {
  /** the diamonds stay on the picture outside pick mode too (a click on one picks it); focus: the chosen spot's plane */
  showSurfaces?: boolean; focus?: [number, number][] | null;
  nodes?: OverlayNode[]; path?: [number, number][]; target?: { x: number; y: number; zoom?: number } | null; points?: [number, number][];
  surfaces?:SurfaceMarker[];
  /** the camera solve's own landmarks (After Effects style): small targets on the picture; a hovered triangle of them shows the plane they lie on */
  trackPoints?:{id:string;x:number;y:number;selected?:boolean}[]; hoverTarget?:{tri:[number,number][];plane:[number,number][]|null;ring?:[number,number][]|null;ids:string[]}|null; onHover?:(x:number,y:number)=>void;
  /** pick mode: the next click on the picture is a point (crosshair cursor) */
  pick?: boolean; pickBounds?: { x: number; y: number; w: number; h: number }; onPick?: (x: number, y: number, shift?: boolean) => void; onCancel?: () => void;
  onMove?: (id: string, x: number, y: number) => void; onDrop?: (id: string, x: number, y: number) => void; hint?: string;
  box?: [number, number, number, number] | null;
}) {
  const rect = useStageRect();
  const clipId=React.useId().replace(/:/g,'');
  const [drag, setDrag] = React.useState<{ id: string; x: number; y: number } | null>(null);
  if (!rect || !rect.width) return null;
  const P = (x: number, y: number) => [rect.left + x * rect.width, rect.top + y * rect.height] as const;
  const toStage = (cx: number, cy: number) => [Math.min(1, Math.max(0, (cx - rect.left) / rect.width)), Math.min(1, Math.max(0, (cy - rect.top) / rect.height))] as const;
  const inside=(n:{x:number;y:number})=>{const [x,y]=P(n.x,n.y),c=rect.clip;return Number.isFinite(x)&&Number.isFinite(y)&&x>=c.left&&x<=c.left+c.width&&y>=c.top&&y<=c.top+c.height;};
  const bounds=pickBounds ? {left:Math.max(rect.clip.left,rect.left+pickBounds.x*rect.width),top:Math.max(rect.clip.top,rect.top+pickBounds.y*rect.height),right:Math.min(rect.clip.left+rect.clip.width,rect.left+(pickBounds.x+pickBounds.w)*rect.width),bottom:Math.min(rect.clip.top+rect.clip.height,rect.top+(pickBounds.y+pickBounds.h)*rect.height)} : {left:rect.clip.left,top:rect.clip.top,right:rect.clip.left+rect.clip.width,bottom:rect.clip.top+rect.clip.height};
  const shown = nodes.map((n) => (drag?.id === n.id ? { ...n, x: drag.x, y: drag.y } : n)).filter(inside);
  const visibleSurfaces=surfaces.filter(s=>{const [x,y]=P(s.x,s.y);return inside(s)&&x>=bounds.left&&x<=bounds.right&&y>=bounds.top&&y<=bounds.bottom&&s.quad.every(p=>p.every(Number.isFinite));});
  const line = (path ?? shown.map((n) => [n.x, n.y] as [number, number])).map(([x, y]) => P(x, y).join(',')).join(' ');
  /* data-film-select: the picture's own selection leaves clicks here alone (picking a point keeps the clip selected) */
  return createPortal(
    <div data-film-select="" data-stage-overlay="">
      <svg aria-hidden className="pointer-events-none fixed z-40" style={{ left: 0, top: 0, width: '100vw', height: '100vh' }}>
        <defs><clipPath id={clipId}><rect x={rect.clip.left} y={rect.clip.top} width={rect.clip.width} height={rect.clip.height}/></clipPath><clipPath id={`${clipId}-pick`}><rect x={bounds.left} y={bounds.top} width={Math.max(0,bounds.right-bounds.left)} height={Math.max(0,bounds.bottom-bounds.top)}/></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
        {line && (path || shown.length > 1) ? <polyline points={line} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} strokeDasharray="5 4" style={{ filter: 'drop-shadow(0 0 2px rgba(0,0,0,.8))' }} /> : null}
        {(points ?? []).map(([x, y], i) => { const [a, b] = P(x, y); return <circle key={i} cx={a} cy={b} r={2.2} fill="#4ade80" stroke="rgba(0,0,0,.6)" strokeWidth={0.8} />; })}
        {(pick||showSurfaces)&&<g clipPath={`url(#${clipId}-pick)`}>{visibleSurfaces.map((s,i)=><g key={s.id} className="scene-surface-marker" style={{animationDelay:`${i*22}ms`,opacity:pick?1:.85}}><PlaneMarker quad={(s.plane??s.quad).map(p=>[...P(...p)] as [number,number])}/></g>)}
          {focus&&focus.every(p=>p.every(Number.isFinite))?<PlaneMarker focus quad={focus.map(p=>[...P(...p)] as [number,number])}/>:null}
          {pick&&trackPoints.map((tp,i)=>{const [a,b]=P(tp.x,tp.y),r=tp.selected?6:4.2;return <g key={tp.id} className="scene-track-diamond" style={{transformOrigin:`${a}px ${b}px`,animationDelay:`${i*38}ms`}}><polygon points={`${a},${b-r} ${a+r},${b} ${a},${b+r} ${a-r},${b}`} fill={tp.selected?'#fbbf24':'rgba(255,255,255,.95)'} stroke={tp.selected?'#92400e':'rgba(37,99,235,.95)'} strokeWidth={1.3}/></g>;})}
          {pick&&hoverTarget?(()=>{const t=hoverTarget.tri.map(p=>P(...p));const ring=hoverTarget.ring?.map(p=>P(...p));const plane=hoverTarget.plane?.map(p=>P(...p));const c=ring?[ring.reduce((a,p)=>a+p[0],0)/ring.length,ring.reduce((a,p)=>a+p[1],0)/ring.length]:[(t[0][0]+t[1][0]+t[2][0])/3,(t[0][1]+t[1][1]+t[2][1])/3];return <g className="scene-track-target">
            {plane?<polygon points={plane.map(p=>p.join(',')).join(' ')} fill="rgba(37,99,235,.07)" stroke="rgba(37,99,235,.35)" strokeWidth={1} strokeDasharray="3 3"/>:null}
            {ring?<polygon points={ring.map(p=>p.join(',')).join(' ')} fill="rgba(239,68,68,.20)" stroke="#ef4444" strokeWidth={1.6}/>:<polygon points={t.map(p=>p.join(',')).join(' ')} fill="rgba(239,68,68,.16)" stroke="#ef4444" strokeWidth={1.4}/>}
            {t.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r={2.4} fill="#fff" stroke="#ef4444" strokeWidth={1}/>)}
            <circle cx={c[0]} cy={c[1]} r={2.6} fill="#ef4444"/></g>;})():null}
          </g>}
        {box ? (() => { const [a, b] = P(box[0], box[1]); const [c, d] = P(box[2], box[3]); return <rect x={a} y={b} width={c - a} height={d - b} fill="rgba(69,104,238,.12)" stroke="#4568ee" strokeWidth={1.5} strokeDasharray="4 3" />; })() : null}
        {target ? (() => { const [a, b] = P(target.x, target.y); const z = target.zoom ?? 1; const w = rect.width / z, h = rect.height / z; return (
          <g><rect x={a - w / 2} y={b - h / 2} width={w} height={h} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 4" /><line x1={a - 10} y1={b} x2={a + 10} y2={b} stroke="#fbbf24" strokeWidth={2} /><line x1={a} y1={b - 10} x2={a} y2={b + 10} stroke="#fbbf24" strokeWidth={2} /></g>); })() : null}
        </g>
      </svg>
      {pick && bounds.right > bounds.left && bounds.bottom > bounds.top ? (
        <div className="fixed z-40 cursor-crosshair rounded-[4px] ring-1 ring-[var(--accent)]/70" style={{ left: bounds.left, top: bounds.top, width: bounds.right-bounds.left, height: bounds.bottom-bounds.top }}
          onPointerDown={(e) => { const [x, y] = toStage(e.clientX, e.clientY); onPick?.(x, y, e.shiftKey); }} onPointerMove={(e) => { if (onHover) { const [x, y] = toStage(e.clientX, e.clientY); onHover(x, y); } }}>
          {hint ? <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white shadow">{hint}</span> : null}
        </div>
      ) : null}
      {pick && onCancel && bounds.right > bounds.left && bounds.bottom > bounds.top && <button type="button" onClick={onCancel} className="fixed z-[41] rounded-md bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" style={{left:bounds.left+8,top:bounds.bottom-36}}>Cancel</button>}
      {(pick||showSurfaces)&&visibleSurfaces.map(s=>{const [x,y]=P(s.x,s.y),clip=`inset(${Math.max(0,bounds.top-y+14)}px ${Math.max(0,x+14-bounds.right)}px ${Math.max(0,y+14-bounds.bottom)}px ${Math.max(0,bounds.left-x+14)}px)`;return <button key={s.id} type="button" aria-label={`Place on ${s.title}`} title={s.title} className="fixed z-40 h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-md outline-none hover:ring-1 hover:ring-white focus-visible:ring-2 focus-visible:ring-white" style={{left:x,top:y,clipPath:clip}} onClick={()=>onPick?.(s.x,s.y)}/>;})}
      {shown.map((n) => { const [a, b] = P(n.x, n.y); return (
        <button key={n.id} type="button" aria-label={n.label ? `Point ${n.label}` : 'Path point'} title={n.label}
          className={`fixed z-40 flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full border-2 border-white px-1 text-[9px] font-bold text-white shadow-[0_2px_6px_rgba(0,0,0,.4)] ${n.active ? 'bg-[#fbbf24]' : 'bg-[var(--accent)]'}`}
          style={{ left: a, top: b }}
          onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const [x, y] = toStage(e.clientX, e.clientY); setDrag({ id: n.id, x, y }); }}
          onPointerMove={(e) => { if (drag?.id !== n.id) return; const [x, y] = toStage(e.clientX, e.clientY); setDrag({ id: n.id, x, y }); onMove?.(n.id, x, y); }}
          onPointerUp={() => { if (drag?.id === n.id) onDrop?.(n.id, drag.x, drag.y); setDrag(null); }}>{n.label}</button>); })}
    </div>,
    document.body,
  );
}

/** Live optical refraction during analysis. A native video keeps playing independently of worker scans.
 * Full-DOM displacement falls back to the available video texture when measured rendering cost is too high. */
export function ScanOverlay({ clipId, rect, seen, source, projectId,sourcePath,from = 0, to, effect = 'auto', strength = 12 }: { clipId?:string; rect: { x: number; y: number; w: number; h: number }; seen: { points: [number, number][]; boxes: [number, number, number, number][] } | null; source?: string; projectId?:string;sourcePath?:string;from?: number; to?:number; effect?: 'auto'|'video'|'off'; strength?:number }) {
  /* where the scan found subjects, by source second: the preview loop asks for the moment it is showing */
  const found = React.useRef<{ t: number; boxes: [number, number, number, number][] }[]>([]);
  React.useEffect(() => { const t = (seen as { t?: number } | null)?.t; if (seen && Number.isFinite(t)) { const list = found.current; if (!list.length || list[list.length - 1].t < t!) list.push({ t: t!, boxes: seen.boxes }); } }, [seen]);
  React.useEffect(() => {
    found.current = [];
    const surface = document.getElementById('root');
    if (!surface) return;
    // A native video clock shows the clip smoothly while separate proxy frames are analysed in workers.
    const stage=document.querySelector<HTMLElement>('[data-viewer-pane] .stage');
    const v=source&&stage?document.createElement('video'):null;
    let gpu:(()=>void)|null=null,loopReady=false,loopAt=0,closed=false;
    const ctl=new AbortController(),preference=matchMedia('(prefers-reduced-motion: reduce)');
    const destroy=effect==='auto'&&!v?createNameDropRipple(stage??surface, { cycleMs: 7600, amplitudePx: strength, bandPx: 34, curvaturePx: 20,sheen:true, onOverload:elapsed=>{if(v&&!gpu)gpu=createVideoRefraction(v,strength,elapsed);} }):()=>{};
    if(v&&stage){v.muted=true;v.playsInline=true;v.loop=true;v.crossOrigin='anonymous';v.src=source!;v.setAttribute('aria-hidden','true');v.dataset.scanPlayback='forward';v.style.cssText=`position:absolute;left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.w*100}%;height:${rect.h*100}%;object-fit:fill;pointer-events:none;z-index:5`;v.onloadedmetadata=()=>{v.currentTime=loopReady?Math.min(loopAt,v.duration-.01):Math.min(from,Math.max(0,v.duration-.1));if(!document.hidden&&!preference.matches)void v.play().catch(()=>{});};stage.append(v);
      if(projectId&&sourcePath&&to!=null)void fetch(`/api/projects/${projectId}/scan-preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({src:sourcePath,from,to}),signal:ctl.signal}).then(async r=>{if(!r.ok)throw new Error('Preview loop unavailable');return r.json();}).then(({url})=>{if(!closed){loopAt=Math.max(0,v.currentTime-from);loopReady=true;v.dataset.scanPlayback='forward-reverse';v.src=url;}}).catch(()=>{/* Forward native playback remains available while analysis continues. */});
    }
    if(v&&to!=null)v.ontimeupdate=()=>{if(!loopReady&&(v.currentTime>=to||v.currentTime<from))v.currentTime=from;};
    const span=Math.max(.01,(to??from+1)-from);
    const subjects=(ct:number)=>{const list=found.current;if(!list.length)return [];const src=v?.dataset.scanPlayback==='forward-reverse'?from+(ct<=span?ct:Math.max(0,2*span-ct)):ct;let best=list[0];for(const e of list)if(Math.abs(e.t-src)<Math.abs(best.t-src))best=e;return Math.abs(best.t-src)<.35?best.boxes:[];};
    if(effect!=='off'&&v)gpu=createVideoRefraction(v,strength,0,subjects);
    const marked=new Set<HTMLElement>();
    const mark=()=>{if(!clipId)return;document.querySelectorAll<HTMLElement>(`[data-source-clip-id="${CSS.escape(clipId)}"]`).forEach(el=>{el.dataset.sceneScanning='';marked.add(el);});};mark();
    const timelineObserver=new MutationObserver(mark);timelineObserver.observe(document.body,{childList:true,subtree:true});
    const running=()=>{if(!v)return;if(document.hidden||preference.matches)v.pause();else if(v.readyState>=2)void v.play().catch(()=>{});};document.addEventListener('visibilitychange',running);preference.addEventListener('change',running);
    return ()=>{closed=true;ctl.abort();timelineObserver.disconnect();marked.forEach(el=>delete el.dataset.sceneScanning);document.removeEventListener('visibilitychange',running);preference.removeEventListener('change',running);destroy();gpu?.();if(v){v.pause();v.removeAttribute('src');v.load();v.remove();}};
  }, [clipId, source, projectId,sourcePath,from, to, effect, strength]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** The scan's progress, in the panel (not over the picture): the step it is on, a fine progress line with a moving
 *  sheen, the share done, what it has found so far and roughly how long is left. */
export function ScanProgress({ share, msg, seen, onCancel }: { share: number; msg: string; seen: { boxes: unknown[]; points: unknown[]; frame?: number; of?: number } | null; onCancel: () => void }) {
  const start = React.useRef({ at: performance.now(), share }); const [, tick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(id); }, []);
  /* the native stage (COLMAP camera solve, SAM 2 masks, depth) reports its own words and cannot promise a time */
  const native = /reconstruct|camera|depth|mask|segment|match|occlusion|solv|colmap|feature/i.test(msg) && !/^Finding motion/i.test(msg);
  const stage = /^Opening|Loading/i.test(msg) ? 0 : /^Saving|complete/i.test(msg) ? 3 : native ? 2 : 1;
  const steps = ['Reading the footage', 'Finding motion and foreground', 'Building the 3D scene', 'Saving the scene'];
  const el = (performance.now() - start.current.at) / 1000, done = share - start.current.share;
  const left = !native && done > 0.03 && share < 0.94 ? Math.max(1, Math.round((el / done) * (1 - share))) : null;
  const pct = Math.round(share * 100);
  return (
    <div className="flex flex-col gap-2.5">
      <style>{`@keyframes scan-sheen{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}@keyframes scan-in{from{opacity:0}to{opacity:1}} @media(prefers-reduced-motion:reduce){[data-scan-progress] *{animation:none!important;transition:none!important}}`}</style>
      <div className="flex items-end gap-2">
        <span className="text-[26px] font-semibold leading-none tabular-nums tracking-tight text-[var(--text)]">{pct}<span className="ml-0.5 text-[13px] font-medium text-[var(--text-faint)]">%</span></span>
        <span className="mb-0.5 min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-dim)]">{native ? msg : steps[stage]}{!native && seen?.of ? ` · frame ${(seen.frame ?? 0) + 1} of ${seen.of}` : ''}</span>
        <button type="button" className="mb-0.5 flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-dim)] hover:bg-[var(--fill-tsp)] hover:text-[var(--text)]" onClick={onCancel}>Cancel</button>
      </div>
      <div data-scan-progress="" role="progressbar" aria-label={msg} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="relative h-[3px] overflow-hidden rounded-full bg-[var(--fill-tsp)]">
        <div className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-[var(--accent)] transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, pct)}%` }}>
          <div className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent" style={{ animation: 'scan-sheen 1.4s ease-in-out infinite' }} />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {steps.map((n, i) => <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i < stage ? 'bg-[var(--accent)]' : i === stage ? 'bg-[var(--accent)]/45' : 'bg-[var(--fill-tsp)]'}`} />)}
      </div>
      <p className="text-[11px] text-[var(--text-muted)]">{seen ? `${seen.boxes.length} subject${seen.boxes.length === 1 ? '' : 's'} · ${seen.points.length} track points` : 'Starting'}{native ? ' · this takes a few minutes for walking footage' : left ? ` · about ${left < 60 ? `${left}s` : `${Math.round(left / 60)} min`} left` : ''} · you can keep editing</p>
    </div>
  );
}
