import React from 'react';
import { Route, Plus, Trash2, Upload, Play } from 'lucide-react';
import type { Film } from '@/api';
import { round, type FrameLayer } from './layers';
import { lineOf } from './lines';
import { GRAPHICS } from './motion-graphics.js';
import { motionAt, pathKeys, PATH_PRESETS } from './motion3d.js';
import { quickMotion, DEFAULT_QUICK, START_FROM, FINISH_AT, ROTATIONS, EXITS, DEVICE_PRESETS, type Quick, type DeviceObject, type Key, type Motion } from './devices';
import { StageOverlay } from './StageOverlay';
import { SceneView } from './SceneView';
import { T, seg, segWrap } from './ui';
import { appendDeviceAction,replaceDeviceIntro } from './motion-sequence.js';
import { ModelActions } from './ModelActions';

/* A 3D scene's settings: the simple controls first (what is on the screen, where it comes from, where it ends, how
   long, how it turns, smooth / hold / return / exit), then "Customise path" (its keys as points on the picture you drag,
   with their time, depth and turn), then the look (finish, lid, motion blur). One object at a time when there are
   several. Every change shows in the preview at once. */
const row = 'flex items-center gap-2 text-[12px] text-[var(--text-dim)]';
const LABEL: Record<string, string> = { bottomLeft: 'Bottom left', bottomRight: 'Bottom right', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom', topLeft: 'Top left', topRight: 'Top right', behind: 'Far behind', front: 'In front', centre: 'Centre', low: 'Low centre',
  cinematic: 'Cinematic', subtle: 'Subtle', none: 'None', spin: 'Spin', backToFront: 'Back to front', sideToFront: 'Side to front', tilt: 'Tilt', flyAway: 'Fly away', reverse: 'Reverse entrance', shrink: 'Shrink back', rotateAway: 'Rotate away', fade: 'Fade out',action:'At Screen on action',start:'From the start',time:'At a chosen time' };
const lab = (k: string) => LABEL[k] ?? k;
function Sel({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return <label className={row}><span className="w-[88px] shrink-0">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className={`${T.small} flex-1`}>{options.map((o) => <option key={o} value={o}>{lab(o)}</option>)}</select></label>;
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (<label className={`${row} justify-between`}><span>{label}</span><button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition ${on ? 'bg-[var(--accent)]' : 'bg-[var(--fill-tsp)] ring-1 ring-[var(--border)]'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} /></button></label>);
}
function Num({ label, value, step = 0.05, min, max, onChange, unit = '' }: { label: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void; unit?: string }) {
  return <label className={row}><span className="w-[88px] shrink-0">{label}</span><input type="number" step={step} min={min} max={max} value={round(value)} onChange={(e) => onChange(Number(e.target.value))} className={`${T.small} w-20`} /><span className="text-[11px] text-[var(--text-faint)]">{unit}</span></label>;
}

export function Scene3DInspector({ layer, t, film, folder = '', projectId, commit, appendAction, seek, timeMs = 0, clipStart = 0 }: { layer: FrameLayer; t: number; film: Film | null; folder?: string; projectId: string; timeMs?: number; clipStart?: number; commit: (l: FrameLayer, delay?: number) => void; appendAction?:(layer:FrameLayer,from:number,label:string)=>Promise<void>; seek: (layerTime: number) => void }) {
  const objects = (layer.objects ?? []) as DeviceObject[];
  const [sel, setSel] = React.useState(0);
  const [pathOpen, setPathOpen] = React.useState(false);
  const [activeKey, setActiveKey] = React.useState<number | null>(null);
  const [action,setAction]=React.useState('turn'); const [actionDuration,setActionDuration]=React.useState(1.2);
  const [actionPosition,setActionPosition]=React.useState<[number,number,number]>([.4,0,0]);
  const [placingAction,setPlacingAction]=React.useState(false),[addingAction,setAddingAction]=React.useState(false);
  const obj = objects[Math.min(sel, objects.length - 1)];
  const L = layer.duration;
  const files = React.useMemo(() => [...new Set((film?.tracks ?? []).flatMap((tr) => tr.clips).map((c) => c.src.split('#')[0]).filter((s) => lineOf(s) === 'media' && !s.startsWith('frame/')))], [film]);
  const input = React.useRef<HTMLInputElement>(null);
  const [uploading,setUploading]=React.useState(false),[uploadError,setUploadError]=React.useState('');
  const latestLayer=React.useRef(layer);latestLayer.current=layer;
  if (!obj) return <p className={T.hint}>This 3D scene has no objects.</p>;
  const quick: Quick = { ...DEFAULT_QUICK, device: obj.type === 'laptop' ? 'laptop' : 'phone', ...((obj as { quick?: Partial<Quick> }).quick ?? {}), length: L };
  const setObj = (patch: Partial<DeviceObject>, delay = 120) => commit({ ...layer, objects: objects.map((o, i) => (i === sel ? { ...o, ...patch } : o)) }, delay);
  const setQuick = (p: Partial<Quick>) => { const q = { ...quick, ...p,length:obj.actions?.[0]?.at??L },next=replaceDeviceIntro(obj,quickMotion(q),q.length);setObj({...next,quick:q} as Partial<DeviceObject>); };
  const setMotion = (m: Partial<Motion>) => {const continued=obj.motion as Motion&{introMotion?:Motion;continueFrom?:number};setObj({ motion: { ...obj.motion, ...m,...(m.keys&&continued.introMotion?{introMotion:{...continued.introMotion,keys:m.keys.filter(k=>k.t<=(continued.continueFrom??0))}}:{}) } });};
  const keys = obj.motion.keys;
  /* frame units (−1…1, y up) ↔ stage (0…1, y down) */
  const toStage = (p: [number, number, number]) => ({ x: (p[0] + 1) / 2, y: (1 - p[1]) / 2 });
  const fromStage = (x: number, y: number) => [round(x * 2 - 1), round(1 - y * 2)];
  type St = { p: [number, number, number]; r: [number, number, number]; s: number };
  const at3 = (x: number) => motionAt(obj.motion, x, L) as unknown as St;
  const now = at3(t);
  const upload = async (f: File) => {
    setUploading(true);setUploadError('');
    try{
      const path = `assets/${f.name.replace(/[^\w.-]+/g, '-')}`;
      const r = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body: f });
      const body=await r.json();if(!r.ok)throw new Error(body.error||'The screen video could not be imported.');
      const current=latestLayer.current;
      if(current.id===layer.id)commit({...current,objects:(current.objects??[]).map((o:DeviceObject,i:number)=>i===sel?{...o,screen:{...o.screen,startMode:o.screen?.startMode??'action',src:body.path??path,graphic:undefined}}:o)},0);
    }catch(e){setUploadError(e instanceof Error?e.message:String(e));}finally{setUploading(false);}
  };
  const screenKind = obj.screen?.graphic ? 'graphic' : 'media';
  return (
    <div className="flex flex-col gap-3 pt-2">
      {objects.length > 1 ? (
        <div className={segWrap}>{objects.map((o, i) => <button key={i} type="button" aria-label={`Select object ${i+1}`} className={seg(i === sel)} onClick={() => setSel(i)}><span className="truncate">{o.name??(o.type === 'laptop' ? 'Laptop' : o.type === 'card' ? 'Card' : o.type === 'text' ? 'Text' : o.type==='model'?'Model':'Phone')} {i + 1}</span></button>)}</div>
      ) : null}
      <section className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-2.5">
        <span className="text-[12px] font-semibold">Continue this {obj.type === 'laptop' ? 'MacBook' : obj.type==='model'?'model':'device'}</span>
        <Toggle label="Animate movement" on={obj.motion.enabled!==false} onChange={enabled=>setMotion({enabled,holdPose:enabled?undefined:motionAt(obj.motion,t,L)})}/>
        <p className={T.hint}>Each action follows the last one as a new block on this timeline line.</p>
        <select aria-label="Next device action" value={action} onChange={e=>{setAction(e.target.value);setPlacingAction(false);if(e.target.value==='move')setActionPosition([...at3(L).p]);}} className={T.small}><option value="turn">Turn 45°</option><option value="move">Move to position</option><option value="hold">Hold position</option>{obj.type!=='model'&&<><option value="screenOn">Turn on & play screen video</option><option value="screenOff">Turn screen off</option></>}{obj.type==='laptop'&&<><option value="openLid">Open lid</option><option value="closeLid">Close lid</option></>}<option value="exitLeft">Exit left</option><option value="exitRight">Exit right</option><option value="flyAway">Fly away</option><option value="fadeOut">Fade out</option><option value="reveal">Fade back in</option></select>
        <Num label="Action length" value={actionDuration} min={.2} max={20} step={.1} unit="s" onChange={setActionDuration}/>
        {action==='move'&&(['X','Y','Depth'] as const).map((n,i)=><Num key={n} label={n} value={actionPosition[i]} min={-10} max={10} step={.1} onChange={v=>setActionPosition(actionPosition.map((x,j)=>i===j?v:x) as [number,number,number])}/>)}
        {action==='move'&&<button type="button" className={T.secondary} onClick={()=>setPlacingAction(v=>!v)}><Route size={13}/>{placingAction?'Finish destination':'Place destination visually'}</button>}
        {placingAction&&<SceneView folder={folder} film={film} timeMs={timeMs} mode="object" clipStart={clipStart} objectIndex={Math.min(sel,objects.length-1)} layer={{...layer,objects:objects.map((o,i)=>i===sel?{...o,motion:{keys:[{t:0,...at3(L),p:actionPosition}]}}:o)}} onMotion={m=>{const p=m.keys.at(-1)?.p;if(p)setActionPosition(p as [number,number,number]);}}/>}
        <button type="button" disabled={uploading||addingAction||(action==='screenOn'&&!obj.screen?.src&&!obj.screen?.graphic)} className={T.primary} onClick={()=>{void(async()=>{setAddingAction(true);setUploadError('');try{const next=appendDeviceAction(obj,action,actionDuration,L,{position:actionPosition}) as DeviceObject;const duration=next.sequenceEnd??L;const updated={...layer,duration,objects:objects.map((o,i)=>i===sel?next:o)};const from=next.actions!.at(-1)!.at;const label=({screenOn:'Screen on',screenOff:'Screen off',openLid:'Open lid',closeLid:'Close lid',turn:'Turn',move:'Move',hold:'Hold',exitLeft:'Exit left',exitRight:'Exit right',flyAway:'Fly away',fadeOut:'Fade out',reveal:'Fade in'} as Record<string,string>)[action]??action;if(appendAction)await appendAction(updated,from,label);else{commit(updated,0);seek(from);}setPlacingAction(false);}catch(e){setUploadError(e instanceof Error?e.message:String(e));}finally{setAddingAction(false);}})();}}><Plus size={13}/>{uploading?'Importing screen video…':addingAction?'Adding action…':'Add next action'}</button>
        {action==='screenOn'&&!obj.screen?.src&&!obj.screen?.graphic&&<p className={T.hint}>Choose or import screen media below first.</p>}
        {uploadError&&<p role="alert" className="text-[11px] text-[var(--err)]">{uploadError}</p>}
        {obj.actions?.length?<ol className="flex flex-col gap-1">{obj.actions.map((a,i)=><li key={i} className="flex justify-between text-[11px] text-[var(--text-muted)]"><span>{({screenOn:'Screen on',screenOff:'Screen off',openLid:'Open lid',closeLid:'Close lid',turn:'Turn',move:'Move',hold:'Hold'} as Record<string,string>)[a.type]??a.type}</span><span>{round(a.at)}–{round(a.at+a.duration)}s</span></li>)}</ol>:null}
      </section>
      {obj.type==='model'&&<ModelActions object={obj} index={Math.min(sel,objects.length-1)} layer={layer} folder={folder} projectId={projectId} commit={commit} setObject={setObj}/>}
      {obj.type !== 'text'&&obj.type!=='model' ? (
        <section className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2.5">
          <span className="text-[11px] font-semibold text-[var(--text)]">Screen</span>
          <div className={segWrap}><button type="button" className={seg(screenKind === 'media')} onClick={() => setObj({ screen: { ...(obj.screen ?? {}), graphic: undefined } })}>Video or photo</button><button type="button" className={seg(screenKind === 'graphic')} onClick={() => setObj({ screen: { ...(obj.screen ?? {}), graphic: 'mg.dashboard', src: undefined } })}>Motion graphic</button></div>
          {screenKind === 'media' ? (
            <div className="flex items-center gap-1.5">
              <select value={obj.screen?.src ?? ''} onChange={(e) => setObj({ screen: { ...(obj.screen ?? {}),startMode:obj.screen?.startMode??'action', src: e.target.value || undefined } }, 0)} className={`${T.small} min-w-0 flex-1`} aria-label="Screen video">
                <option value="">{files.length ? 'Choose from this video…' : 'Upload a video or photo'}</option>
                {files.map((f) => <option key={f} value={f}>{f.split('/').pop()}</option>)}
                {obj.screen?.src && !files.includes(obj.screen.src) ? <option value={obj.screen.src}>{obj.screen.src.split('/').pop()}</option> : null}
              </select>
              <button type="button" aria-label="Upload" title="Upload" onClick={() => input.current?.click()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--accent)]"><Upload size={13} /></button>
              <input ref={input} type="file" accept="image/*,video/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            </div>
          ) : (
            <select value={obj.screen?.graphic ?? ''} onChange={(e) => setObj({ screen: { ...(obj.screen ?? {}), graphic: e.target.value } }, 0)} className={T.small} aria-label="Screen motion graphic">
              {(GRAPHICS as { id: string; name: string; category: string }[]).filter((g) => g.category === 'SaaS' || g.category === 'Data' || g.category === 'Text').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <div className="flex flex-col gap-1.5">
            <Sel label="Fit" value={obj.screen?.fit ?? 'cover'} options={['cover', 'contain']} onChange={(v) => setObj({ screen: { ...(obj.screen ?? {}), fit: v as 'cover' | 'contain' } }, 0)} />
            <Num label="Start at" value={obj.screen?.offset ?? 0} step={0.1} min={0} unit="s" onChange={(v) => setObj({ screen: { ...(obj.screen ?? {}), offset: v } })} />
            <Sel label="Screen starts" value={obj.screen?.startMode??(obj.screen?.events?.length?'action':'start')} options={['action','start','time']} onChange={v=>setObj({screen:{...obj.screen,startMode:v as 'action'|'start'|'time',...(v==='time'?{events:undefined}:{}),...(v==='start'?{playAt:0,onAt:0}: {})}})}/>
            {obj.screen?.startMode==='time'&&<Num label="Screen on at" value={obj.screen?.onAt ?? 0} step={.1} min={0} max={L} unit="s" onChange={v=>setObj({screen:{...obj.screen,onAt:v,playAt:v}})}/>}
            {(obj.screen?.startMode==='action'||obj.screen?.events?.length)&&<p className={T.hint}>Media remains off until a Screen on action. Playback begins at that action.</p>}
            <Num label="Speed" value={obj.screen?.speed ?? 1} step={0.05} min={0.25} max={4} unit="×" onChange={(v) => setObj({ screen: { ...(obj.screen ?? {}), speed: v } })} />
            <Num label="Brightness" value={obj.screen?.brightness ?? 1} step={0.05} min={0.3} max={1.6} onChange={(v) => setObj({ screen: { ...(obj.screen ?? {}), brightness: v } })} />
          </div>
          <Toggle label="Loop the screen video" on={obj.screen?.loop !== false} onChange={(v) => setObj({ screen: { ...(obj.screen ?? {}), loop: v } }, 0)} />
        </section>
      ) : null}

      <details className="flex flex-col gap-1.5"><summary className="cursor-pointer text-[12px] font-medium text-[var(--text-muted)]">Edit the intro animation</summary><section className="mt-2 flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-[var(--text)]">Movement</span>
        <Sel label="Entrance" value={quick.entrance} options={['float', 'slide', 'fly', 'rise', 'none']} onChange={(v) => setQuick({ entrance: v as Quick['entrance'] })} />
        <Sel label="Start from" value={quick.startFrom} options={Object.keys(START_FROM)} onChange={(v) => setQuick({ startFrom: v })} />
        <Sel label="Finish at" value={quick.finishAt} options={Object.keys(FINISH_AT)} onChange={(v) => setQuick({ finishAt: v })} />
        <Num label="Duration" value={quick.duration} step={0.1} min={0.2} max={L} unit="s" onChange={(v) => setQuick({ duration: v })} />
        <Sel label="Rotation" value={quick.rotation} options={Object.keys(ROTATIONS)} onChange={(v) => setQuick({ rotation: v })} />
        <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--border)] p-2.5">
          <Toggle label="Smooth motion" on={quick.smooth} onChange={(v) => setQuick({ smooth: v })} />
          <Toggle label="Hold at end" on={quick.holdAtEnd} onChange={(v) => setQuick({ holdAtEnd: v })} />
          <Toggle label="Return motion" on={quick.returnMotion} onChange={(v) => setQuick({ returnMotion: v })} />
          {!quick.returnMotion ? <Sel label="Exit" value={quick.exit} options={[...EXITS]} onChange={(v) => setQuick({ exit: v as Quick['exit'] })} /> : null}
          {quick.returnMotion || quick.exit !== 'none' ? <Num label={quick.returnMotion ? 'Return time' : 'Exit time'} value={quick.exitDuration} step={0.1} min={0.1} max={L} unit="s" onChange={(v) => setQuick({ exitDuration: v })} /> : null}
        </div>
        <div className="flex gap-1.5">
          <button type="button" className={`${T.secondary} ${pathOpen ? 'border-[var(--accent)] text-[var(--accent)]' : ''}`} onClick={() => setPathOpen((v) => !v)}><Route size={13} />{pathOpen ? 'Done editing path' : 'Customise path'}</button>
          <button type="button" className={T.secondary} onClick={() => seek(0)}><Play size={13} />Preview</button>
        </div>
      </section></details>

      {pathOpen ? <SceneView folder={folder} film={film} timeMs={timeMs} mode="object" layer={layer} clipStart={clipStart} objectIndex={Math.min(sel, objects.length - 1)} onMotion={(m) => setMotion(m as unknown as Motion)} /> : null}
      {pathOpen ? (
        <section className="flex flex-col gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/[0.03] p-2.5">
          <StageOverlay nodes={keys.map((k, i) => ({ id: String(i), ...toStage(k.p as [number, number, number]), label: String(i + 1), active: i === activeKey }))}
            path={Array.from({ length: 41 }, (_, i) => { const s = at3((i / 40) * Math.max(...keys.map((k) => k.t))); return [toStage(s.p).x, toStage(s.p).y] as [number, number]; })}
            onDrop={(id, x, y) => { const i = Number(id); setActiveKey(i); const [px, py] = fromStage(x, y); setMotion({ keys: keys.map((k, j) => (j === i ? { ...k, p: [px, py, k.p[2]] } : k)) as Key[] }); }} />
          <p className={T.hint}>Drag the numbered points on the picture. Time between points sets the speed. Now at {round(t)}s: x {round(now.p[0])}, y {round(now.p[1])}, depth {round(now.p[2])}.</p>
          <div className="flex gap-1.5">
            <button type="button" className={T.secondary} onClick={() => { const nk: Key = { t: round(t), p: now.p, r: now.r, s: now.s }; setMotion({ keys: [...keys, nk].sort((a, b) => a.t - b.t) }); }}><Plus size={13} />Point at playhead</button>
            <select aria-label="Path shape" className={`${T.small} flex-1`} value="" onChange={(e) => { const a = keys[0], b = keys[keys.length - 1]; const ks = pathKeys(e.target.value, a.p, b.p, a.t, b.t) as Key[]; const rs = (i: number, n: number) => a.r && b.r ? a.r.map((v, j) => v + ((b.r![j] - v) * i) / Math.max(1, n - 1)) as [number, number, number] : undefined; setMotion({ keys: ks.map((k, i) => ({ ...k, r: rs(i, ks.length), s: 1, ...(a.lid != null ? { lid: b.lid } : {}) })) }); }}>
              <option value="">Path shape…</option>{PATH_PRESETS.map((p) => <option key={p} value={p}>{({ straight: 'Straight', arcLeft: 'Arc left', arcRight: 'Arc right', sCurve: 'S-curve', spiral: 'Spiral', orbit: 'Orbit', approach: 'Smooth approach', flyby: 'Flyby', pullback: 'Pullback' } as Record<string, string>)[p]}</option>)}
            </select>
          </div>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {keys.map((k, i) => (
              <div key={i} className={`grid grid-cols-[18px_1fr_1fr_1fr_1fr_20px] items-center gap-1 rounded-md px-1 py-0.5 text-[11px] ${i === activeKey ? 'bg-[var(--accent)]/10' : ''}`} onClick={() => setActiveKey(i)}>
                <span className="font-semibold text-[var(--accent)]">{i + 1}</span>
                <input aria-label="Time" title="Time (s)" type="number" step={0.05} value={k.t} onChange={(e) => setMotion({ keys: keys.map((q, j) => (j === i ? { ...q, t: Number(e.target.value) } : q)).sort((a, b) => a.t - b.t) })} className={`${T.small} w-full`} />
                <input aria-label="Depth" title="Depth (toward you)" type="number" step={0.1} value={k.p[2]} onChange={(e) => setMotion({ keys: keys.map((q, j) => (j === i ? { ...q, p: [q.p[0], q.p[1], Number(e.target.value)] } : q)) })} className={`${T.small} w-full`} />
                <input aria-label="Turn" title="Turn (°)" type="number" step={5} value={k.r?.[1] ?? 0} onChange={(e) => setMotion({ keys: keys.map((q, j) => (j === i ? { ...q, r: [q.r?.[0] ?? 0, Number(e.target.value), q.r?.[2] ?? 0] } : q)) })} className={`${T.small} w-full`} />
                <input aria-label="Tilt" title="Tilt (°)" type="number" step={5} value={k.r?.[0] ?? 0} onChange={(e) => setMotion({ keys: keys.map((q, j) => (j === i ? { ...q, r: [Number(e.target.value), q.r?.[1] ?? 0, q.r?.[2] ?? 0] } : q)) })} className={`${T.small} w-full`} />
                <button type="button" aria-label="Remove point" disabled={keys.length <= 2} onClick={() => setMotion({ keys: keys.filter((_, j) => j !== i) })} className="text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-30"><Trash2 size={12} /></button>
              </div>
            ))}
            <div className="grid grid-cols-[18px_1fr_1fr_1fr_1fr_20px] gap-1 px-1 text-[10px] text-[var(--text-faint)]"><span /><span>time</span><span>depth</span><span>turn</span><span>tilt</span><span /></div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Toggle label="Smooth start" on={obj.motion.smoothStart !== false} onChange={(v) => setMotion({ smoothStart: v })} />
            <Toggle label="Smooth stop" on={obj.motion.smoothStop !== false} onChange={(v) => setMotion({ smoothStop: v })} />
            <Toggle label="Curved path" on={obj.motion.curved !== false} onChange={(v) => setMotion({ curved: v })} />
            <Toggle label="Even speed" on={obj.motion.arcLength !== false} onChange={(v) => setMotion({ arcLength: v })} />
            <Toggle label="Face camera at end" on={!!obj.motion.faceCamera} onChange={(v) => setMotion({ faceCamera: v })} />
            <Toggle label="Reverse" on={!!obj.motion.reverse} onChange={(v) => setMotion({ reverse: v })} />
          </div>
          <Sel label="Repeat" value={obj.motion.loop ?? 'none'} options={['none', 'loop', 'pingpong']} onChange={(v) => setMotion({ loop: v })} />
          <Num label="Bank in turns" value={obj.motion.bank ?? 0} step={0.1} min={0} max={1} onChange={(v) => setMotion({ bank: v })} />
          <Num label="Turn along path" value={obj.motion.alongPath ?? 0} step={0.1} min={0} max={1} onChange={(v) => setMotion({ alongPath: v })} />
        </section>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-[var(--text)]">Look</span>
        {obj.type === 'phone' ? <Sel label="Finish" value={obj.finish ?? 'titanium'} options={['titanium', 'black', 'silver', 'gold', 'blue', 'white']} onChange={(v) => setObj({ finish: v }, 0)} /> : null}
        {obj.type === 'laptop' ? <>
          <Sel label="Finish" value={obj.finish ?? 'silver'} options={['silver', 'space', 'midnight', 'gold']} onChange={(v) => setObj({ finish: v }, 0)} />
          <Num label="Lid angle" value={obj.lid ?? 110} step={1} min={0} max={135} unit="°" onChange={(v) => setObj({ lid: v, motion: { ...obj.motion, keys: obj.motion.keys.map((k) => ({ ...k, lid: undefined })) } })} />
          <Toggle label="Camera notch" on={!!obj.notch} onChange={(v) => setObj({ notch: v }, 0)} />
          <Toggle label="Keyboard backlight" on={!!obj.backlight} onChange={(v) => setObj({ backlight: v }, 0)} />
        </> : null}
        <Num label="Size" value={obj.scale ?? 1} step={0.05} min={0.2} max={3} unit="×" onChange={(v) => setObj({ scale: v })} />
        <Num label="Motion blur" value={layer.motionBlur ?? 0} step={0.1} min={0} max={1} onChange={(v) => commit({ ...layer, motionBlur: v }, 120)} />
        <Toggle label="Soft shadow" on={layer.softShadow !== false} onChange={(v) => commit({ ...layer, softShadow: v }, 0)} />
      </section>
      <p className={T.hint}>{DEVICE_PRESETS.find((p) => p.id === layer.preset)?.about ?? ''} Motion blur renders a few moments per frame: leave it off while editing, turn it on for the export.</p>
    </div>
  );
}
