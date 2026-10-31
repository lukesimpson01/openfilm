import React from 'react';
import { createPortal } from 'react-dom';
import { createNameDropRipple } from './nameDropRipple';
import { createVideoRefraction } from './videoRefraction';

/* Editing guides drawn over the preview itself (the 3D tools): a camera target crosshair, a motion path with draggable
   points, tracking points, a click to pick a point or a subject. Coordinates are 0…1 of the stage (x right, y down),
   so they follow any zoom or resize of the preview. Nothing here is in the video: it is only shown while editing. */
export type OverlayNode = { id: string; x: number; y: number; label?: string; active?: boolean };
export type SurfaceMarker={id:string;x:number;y:number;quad:[number,number][];title:string};
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

export function StageOverlay({ nodes = [], surfaces=[], path, target, points, pick, pickBounds, onPick, onCancel, onMove, onDrop, hint, box }: {
  nodes?: OverlayNode[]; path?: [number, number][]; target?: { x: number; y: number; zoom?: number } | null; points?: [number, number][];
  surfaces?:SurfaceMarker[];
  /** pick mode: the next click on the picture is a point (crosshair cursor) */
  pick?: boolean; pickBounds?: { x: number; y: number; w: number; h: number }; onPick?: (x: number, y: number) => void; onCancel?: () => void;
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
        {pick&&<g clipPath={`url(#${clipId}-pick)`}>{visibleSurfaces.map((s,i)=>{const [x,y]=P(s.x,s.y);return <g key={s.id} className="scene-surface-marker" style={{animationDelay:`${i*22}ms`}}><polygon points={s.quad.map(p=>P(...p).join(',')).join(' ')} fill="rgba(69,104,238,.17)" stroke="#4568ee" strokeWidth="1.4"/><rect x={x-3.5} y={y-3.5} width="7" height="7" rx="1" transform={`rotate(45 ${x} ${y})`} fill="#4568ee" stroke="white" strokeWidth="1.2"/></g>;})}</g>}
        {box ? (() => { const [a, b] = P(box[0], box[1]); const [c, d] = P(box[2], box[3]); return <rect x={a} y={b} width={c - a} height={d - b} fill="rgba(69,104,238,.12)" stroke="#4568ee" strokeWidth={1.5} strokeDasharray="4 3" />; })() : null}
        {target ? (() => { const [a, b] = P(target.x, target.y); const z = target.zoom ?? 1; const w = rect.width / z, h = rect.height / z; return (
          <g><rect x={a - w / 2} y={b - h / 2} width={w} height={h} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="6 4" /><line x1={a - 10} y1={b} x2={a + 10} y2={b} stroke="#fbbf24" strokeWidth={2} /><line x1={a} y1={b - 10} x2={a} y2={b + 10} stroke="#fbbf24" strokeWidth={2} /></g>); })() : null}
        </g>
      </svg>
      {pick && bounds.right > bounds.left && bounds.bottom > bounds.top ? (
        <div className="fixed z-40 cursor-crosshair rounded-[4px] ring-1 ring-[var(--accent)]/70" style={{ left: bounds.left, top: bounds.top, width: bounds.right-bounds.left, height: bounds.bottom-bounds.top }}
          onPointerDown={(e) => { const [x, y] = toStage(e.clientX, e.clientY); onPick?.(x, y); }}>
          {hint ? <span className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white shadow">{hint}</span> : null}
        </div>
      ) : null}
      {pick && onCancel && bounds.right > bounds.left && bounds.bottom > bounds.top && <button type="button" onClick={onCancel} className="fixed z-[41] rounded-md bg-black/75 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" style={{left:bounds.left+8,top:bounds.bottom-36}}>Cancel</button>}
      {pick&&visibleSurfaces.map(s=>{const [x,y]=P(s.x,s.y),clip=`inset(${Math.max(0,bounds.top-y+14)}px ${Math.max(0,x+14-bounds.right)}px ${Math.max(0,y+14-bounds.bottom)}px ${Math.max(0,bounds.left-x+14)}px)`;return <button key={s.id} type="button" aria-label={`Place on ${s.title}`} title={s.title} className="fixed z-40 h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-md outline-none hover:ring-1 hover:ring-white focus-visible:ring-2 focus-visible:ring-white" style={{left:x,top:y,clipPath:clip}} onClick={()=>onPick?.(s.x,s.y)}/>;})}
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
