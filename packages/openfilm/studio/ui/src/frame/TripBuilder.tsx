import React from 'react';
import { ArrowUpDown, Car, Plane, Plus, RotateCcw } from 'lucide-react';
import { graphicById, renderGraphic, MAP_STYLES } from './motion-graphics.js';
import { world } from './mg';
import { PlaceField } from './MotionGraphicInspector';
import { T,seg,segWrap } from './ui';
import type { Place } from './places';

type Mode = 'airplane' | 'car';
const PW=400,PH=360;
const COLOURS=[['Blue','#4568ee','#397aa9'],['Graphite','#374151','#77818e'],['Teal','#167d8d','#3a9caa'],['Forest','#327c5c','#6c9b78']];
export function TripBuilder({busy,onAdd}:{busy:boolean;onAdd:(params:Record<string,unknown>)=>void}){
  const def=graphicById('mg.flight') as {duration:number;defaults:Record<string,any>};
  const [mode,setMode]=React.useState<Mode>('airplane'),[from,setFrom]=React.useState<Place|null>(def.defaults.from),[to,setTo]=React.useState<Place|null>(def.defaults.to);
  const [mapStyle,setMapStyle]=React.useState('minimal'),[pal,setPal]=React.useState(0);
  const params=React.useMemo(()=>({from,to,vehicle:mode,route:mode==='car'?'road':'curved',mapStyle,accent:COLOURS[pal][1],accent2:COLOURS[pal][2],trail:'none',pattern:'solid',camera:'cinematic'}),[from,to,mode,mapStyle,pal]);
  const ref=React.useRef<HTMLCanvasElement>(null),raf=React.useRef(0);
  const play=React.useCallback(()=>{
    cancelAnimationFrame(raf.current);const start=performance.now(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick=(now:number)=>{const canvas=ref.current,g=canvas?.getContext('2d');if(!canvas||!g)return;const t=reduced?def.duration:Math.min(def.duration,(now-start)/1000);renderGraphic(g,PW,PH,{graphic:'mg.flight',duration:def.duration,params:{...def.defaults,...params}},t,()=>null,world());if(t<def.duration&&!document.hidden)raf.current=requestAnimationFrame(tick);};
    raf.current=requestAnimationFrame(tick);
  },[def,params]);
  React.useEffect(()=>{play();return()=>cancelAnimationFrame(raf.current);},[play]);
  return <section data-trip-builder="" className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border)] p-2.5">
    <div className="flex items-center justify-between gap-2"><h3 className="text-[12px] font-semibold text-[var(--text)]">Travel route</h3><button type="button" onClick={play} className={T.icon} aria-label="Replay route preview"><RotateCcw size={13}/></button></div>
    <canvas ref={ref} width={PW} height={PH} aria-label="Animated route preview" className="block aspect-[10/9] w-full rounded-md border border-[var(--border)]"/>
    <div className={segWrap}>{([['airplane','Plane',Plane],['car','Car',Car]] as const).map(([id,label,Icon])=><button key={id} type="button" aria-pressed={mode===id} onClick={()=>setMode(id)} className={seg(mode===id)}><Icon size={13}/>{label}</button>)}</div>
    <label className="flex min-w-0 flex-col gap-1"><span className={T.hint}>From</span><PlaceField value={from} onChange={setFrom}/></label>
    <div className="flex items-center justify-between"><span className={T.hint}>To</span><button type="button" className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)]" onClick={()=>{setFrom(to);setTo(from);}}><ArrowUpDown size={11}/>Swap</button></div>
    <PlaceField value={to} onChange={setTo}/>
    <div className="grid min-w-0 grid-cols-2 gap-2"><label className="flex min-w-0 flex-col gap-1"><span className={T.hint}>Map</span><select aria-label="Route map style" value={mapStyle} onChange={e=>setMapStyle(e.target.value)} className={T.small}>{Object.keys(MAP_STYLES).filter(id=>id!=='sunset').map(id=><option key={id} value={id}>{id[0].toUpperCase()+id.slice(1)}</option>)}</select></label><label className="flex min-w-0 flex-col gap-1"><span className={T.hint}>Route colour</span><select aria-label="Route colour" value={pal} onChange={e=>setPal(Number(e.target.value))} className={T.small}>{COLOURS.map(([name],i)=><option key={name} value={i}>{name}</option>)}</select></label></div>
    <button type="button" disabled={busy||!from||!to} onClick={()=>onAdd(params)} className={T.primary}><Plus size={13}/>{busy?'Adding…':`Add ${mode==='car'?'road trip':'flight'}`}</button>
  </section>;
}
