import React from 'react';
import { Move, Crosshair, Maximize2, Minimize2, Video } from 'lucide-react';
import type { Film } from '@/api';
import { readLayer, isFrameSrc, layerIdOf, round, type FrameLayer } from './layers';
import { spans } from './lines';
import { motionAt, camera3dAt } from './motion3d.js';
import { T, seg, segWrap } from './ui';
import { createPortal } from 'react-dom';
import { createFlightControls } from './flight-controls';
import type { DeviceObject } from './devices';

/* The scene view: a game-editor look at a 3D layer, drawn with the project's own scene code (scene3d-runtime.js, the
   same Three.js copy as the video), so what is shown is what renders. Drag to orbit, right-drag to pan, scroll to
   zoom. In camera mode the film's 3D camera is drawn as a frustum with its path; drag it (or the point it looks at)
   with the move handles and a key is written at the playhead; the inset shows exactly what it sees. In object mode an
   object's flight path is drawn with its keys; drag the key at (or nearest) the playhead to move it. */
type Key = { t: number; p: number[]; look?: number[]; fov?: number; [k: string]: unknown };
type Motion = { keys: Key[]; [k: string]: unknown };
const imp = (url: string) => import(/* @vite-ignore */ url);

export function SceneView({ folder, film, timeMs, mode, layer, clipStart, onMotion, objectIndex = 0 }: {
  folder: string; film: Film | null; timeMs: number; mode: 'camera' | 'object'; layer: FrameLayer; clipStart: number;
  /** a changed motion: the camera's (camera mode) or the object's (object mode) */
  onMotion: (m: Motion) => void; objectIndex?: number;
}) {
  const host = React.useRef<HTMLDivElement>(null);
  const [big, setBig] = React.useState(false);
  const [handle, setHandle] = React.useState<'camera' | 'target'>('camera');
  const [status, setStatus] = React.useState('Loading the scene…');
  const [flying,setFlying]=React.useState(false),[captureTime,setCaptureTime]=React.useState(0);
  const live = React.useRef({ timeMs, layer, mode, handle, onMotion, clipStart, objectIndex,flying }); live.current = { timeMs, layer, mode, handle, onMotion, clipStart, objectIndex,flying };
  const api = React.useRef<{ redraw: () => void; dispose: () => void;setFlight:(on:boolean)=>void;capture:()=>void } | null>(null);

  /* the 3D layer the view shows: the layer itself (object mode) or the 3D scene under the camera now (camera mode) */
  const [sceneLayer, setSceneLayer] = React.useState<{ layer: FrameLayer; start: number } | null>(null);
  const resourceSignature=JSON.stringify((layer.objects??[]).map((o:DeviceObject)=>[o.type,o.model,o.screen?.src,o.screen?.graphic,o.animations]));
  React.useEffect(() => {
    let live2 = true;
    (async () => {
      if (mode === 'object') { setSceneLayer({ layer, start: clipStart }); return; }
      const t = timeMs / 1000; let best: { layer: FrameLayer; start: number } | null = null;
      for (const tr of film?.tracks ?? []) { const sp = spans(tr.clips); for (const [i, c] of tr.clips.entries()) { if (!isFrameSrc(c.src) || !/layer-3d-/.test(c.src)) continue; const end = sp[i].end ?? Infinity; const l = await readLayer(folder, layerIdOf(c.src)); if (!l) continue; const inside = t >= sp[i].start && t < end; if (!best || inside) best = { layer: l, start: sp[i].start-(c.time?.[0]??0) }; if (inside) break; } }
      if (live2) { setSceneLayer(old => old?.layer.id === best?.layer.id && old?.start === best?.start&&JSON.stringify(old?.layer.objects)===JSON.stringify(best?.layer.objects) ? old : best); if (!best) setStatus('This camera moves 3D scenes. For the video itself, choose a 2D camera.'); }
    })();
    return () => { live2 = false; };
  }, [film, folder, mode, layer.id,resourceSignature, Math.round(timeMs / 500)]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!sceneLayer || !host.current) return;
    let disposed = false; let raf = 0;
    (async () => {
      const base = `${folder}frame/`;
      const [THREE, runtime, orbit, gizmo] = await Promise.all([imp(`${base}three.module.min.js`), imp(`${base}scene3d-runtime.js`), imp(`${base}three-orbit-controls.js`), imp(`${base}three-transform-controls.js`)]);
      if (disposed) return;
      const el = host.current!; const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:100%;height:100%;border-radius:10px'; el.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
      const stageAspect = (film?.stage?.w ?? 1080) / (film?.stage?.h ?? 1920);
      const built = runtime.buildScene(sceneLayer.layer, renderer, folder, stageAspect);
      await built.ready;
      if(disposed){built.dispose();renderer.dispose();canvas.remove();return;}
      const { scene, objects, pose, halfW, halfH, K, dist } = built;
      scene.background = new THREE.Color('#1b1d22');
      const grid = new THREE.GridHelper(dist * 3, 30, 0x4a4f5a, 0x2c3038); grid.position.y = -halfH * 1.05; scene.add(grid);
      /* the editor's own camera */
      const view = new THREE.PerspectiveCamera(45, 1, 0.05, 500); view.position.set(dist * 0.9, dist * 0.55, dist * 1.25); view.lookAt(0, 0, 0);
      const orbitC = new orbit.OrbitControls(view, canvas); orbitC.enableDamping = true; orbitC.target.set(0, 0, 0);
      /* the film camera (camera mode) */
      const filmCam = new THREE.PerspectiveCamera(30, stageAspect, 0.05, 200); scene.add(filmCam);
      const helper = new THREE.CameraHelper(filmCam); scene.add(helper);
      const camProxy = new THREE.Object3D(); const targetBall = new THREE.Mesh(new THREE.SphereGeometry(dist * 0.02, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfbbf24 })); scene.add(camProxy); scene.add(targetBall);
      const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x8ab4ff, dashSize: dist * 0.03, gapSize: dist * 0.02 })); scene.add(pathLine);
      const keyDots = new THREE.Group(); scene.add(keyDots);
      const tc = new gizmo.TransformControls(view, canvas); tc.setSize(0.8); scene.add(tc.getHelper ? tc.getHelper() : tc);
      tc.addEventListener('dragging-changed', (e: { value: boolean }) => { orbitC.enabled = !e.value; if (!e.value) writeKey(); });
      const localT = () => { const L = live.current; return Math.max(0, L.timeMs / 1000 - (L.mode === 'camera' ? L.clipStart : sceneLayer.start)); };
      const motionOf = (): Motion => { const L = live.current; return L.mode === 'camera' ? ((L.layer.camera as { motion: Motion }).motion) : ((L.layer.objects as { motion: Motion }[])[L.objectIndex]?.motion ?? { keys: [] }); };
      const toScene = (p: number[]) => (live.current.mode === 'camera' ? new THREE.Vector3(p[0] * K, p[1] * K, p[2] * K) : new THREE.Vector3(p[0] * halfW, p[1] * halfH, p[2]));
      const fromScene = (v: { x: number; y: number; z: number }) => (live.current.mode === 'camera' ? [round(v.x / K), round(v.y / K), round(v.z / K)] : [round(v.x / halfW), round(v.y / halfH), round(v.z)]);
      let keyAt=localT();
      const captureFlight=()=>{if(!live.current.flying)return;const L=live.current,m=motionOf(),direction=view.getWorldDirection(new THREE.Vector3()),look=view.position.clone().addScaledVector(direction,dist);const keys=[...(m.keys??[]).filter(k=>Math.abs(k.t-keyAt)>.02),{t:round(keyAt),p:fromScene(view.position),look:fromScene(look),fov:view.fov}].sort((a,b)=>a.t-b.t);L.onMotion({...m,enabled:true,holdPose:undefined,keys});keyAt=round(keyAt+1);setCaptureTime(keyAt);};
      const flight=createFlightControls(THREE,canvas,view,dist*.65,captureFlight,()=>setFlying(false));
      const setFlight=(on:boolean)=>{orbitC.enabled=!on;tc.enabled=!on;if(on){view.position.copy(filmCam.position);view.quaternion.copy(filmCam.quaternion);view.fov=filmCam.fov;view.updateProjectionMatrix();keyAt=localT();setCaptureTime(keyAt);}else orbitC.target.copy(targetBall.position);flight.setEnabled(on);};
      /* the key at the playhead (or a new one there), moved to where the handle was dropped */
      function writeKey() {
        const L = live.current; const m = motionOf(); const t = round(localT()); const keys = [...(m.keys ?? [])];
        let i = keys.findIndex((k) => Math.abs(k.t - t) < 1 / 30);
        const now = L.mode === 'camera' ? camera3dAt(m, t, L.layer.duration) : motionAt(m, t, L.layer.duration);
        if (i < 0) { keys.push(L.mode === 'camera' ? { t, p: [...(now as { position: number[] }).position], look: [...(now as { target: number[] }).target], fov: (now as { fov: number }).fov } : { t, p: [...(now as { p: number[] }).p], r: [...((now as { r: number[] }).r ?? [0, 0, 0])], s: (now as { s?: number }).s ?? 1 }); keys.sort((a, b) => a.t - b.t); i = keys.findIndex((k) => Math.abs(k.t - t) < 1 / 30); }
        const k = { ...keys[i] };
        if (L.mode === 'camera' && L.handle === 'target') k.look = fromScene(targetBall.position); else k.p = fromScene(camProxy.position);
        keys[i] = k; L.onMotion({ ...m, keys });
      }
      const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); view.aspect = w / h; view.updateProjectionMatrix(); };
      const ro = new ResizeObserver(resize); ro.observe(el); resize();
      setStatus('');
      let lastT = -1,lastTick=performance.now();
      const tick = () => {
        if (disposed) return; raf = requestAnimationFrame(tick);const now=performance.now();flight.tick((now-lastTick)/1000);lastTick=now;if(!live.current.flying)orbitC.update();
        const L = live.current; const t = localT(); const sceneT = Math.max(0, L.timeMs / 1000 - sceneLayer.start);
        if (Math.abs(t - lastT) > 1e-4 || tc.dragging) {
          lastT = t; objects.forEach((o: { spec: unknown },i:number) => { if(L.mode==='object') o.spec=L.layer.objects[i]; pose(o, Math.min(sceneT, L.mode==='object'?L.layer.duration:sceneLayer.layer.duration)); });
          const m = motionOf(); const ks = m.keys ?? [];
          if (L.mode === 'camera') {
            const c = camera3dAt(m, t, L.layer.duration);
            if (!tc.dragging) { camProxy.position.copy(toScene(c.position)); targetBall.position.copy(toScene(c.target)); }
            filmCam.position.copy(camProxy.position); filmCam.lookAt(targetBall.position); filmCam.fov = c.fov; filmCam.updateProjectionMatrix(); helper.update();
          } else {
            const st = motionAt(m, t, L.layer.duration) as unknown as { p: number[] };
            if (!tc.dragging) camProxy.position.copy(toScene(st.p));
          }
          helper.visible = L.mode === 'camera'; targetBall.visible = L.mode === 'camera';
          const pts = Array.from({ length: 64 }, (_, i) => { const tt = ks.length ? ks[0].t + ((ks[ks.length - 1].t - ks[0].t) * i) / 63 : 0; const s = L.mode === 'camera' ? camera3dAt(m, tt, L.layer.duration).position : (motionAt(m, tt, L.layer.duration) as unknown as { p: number[] }).p; return toScene(s); });
          pathLine.geometry.setFromPoints(pts); pathLine.computeLineDistances();
          keyDots.traverse((o:any)=>{o.geometry?.dispose();o.material?.dispose();}); keyDots.clear(); for (const k of ks) { const d = new THREE.Mesh(new THREE.SphereGeometry(dist * 0.014, 12, 8), new THREE.MeshBasicMaterial({ color: Math.abs(k.t - t) < 1 / 30 ? 0xfbbf24 : 0x8ab4ff })); d.position.copy(toScene(k.p)); keyDots.add(d); }
          tc.attach(L.mode === 'camera' && L.handle === 'target' ? targetBall : camProxy);
        }
        if (L.mode === 'camera' && tc.dragging) { filmCam.position.copy(camProxy.position); filmCam.lookAt(targetBall.position); helper.update(); }
        const w = el.clientWidth, h = el.clientHeight;
        helper.visible=L.mode==='camera'&&!L.flying;targetBall.visible=L.mode==='camera'&&!L.flying;pathLine.visible=!L.flying;keyDots.visible=!L.flying;const handleHelper=tc.getHelper?tc.getHelper():tc;handleHelper.visible=!L.flying;
        renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.render(scene, view);
        if (L.mode === 'camera'&&!L.flying) {
          /* the inset: what the film camera sees, at the stage's shape */
          const ih = Math.round(h * 0.42), iw = Math.round(ih * stageAspect); const ix = w - iw - 8, iy = h - ih - 8;
          helper.visible = false; grid.visible = false; tc.getHelper ? (tc.getHelper().visible = false) : (tc.visible = false); pathLine.visible = false; keyDots.visible = false; targetBall.visible = false;
          renderer.setScissorTest(true); renderer.setScissor(ix, iy, iw, ih); renderer.setViewport(ix, iy, iw, ih); renderer.render(scene, filmCam);
          helper.visible = true; grid.visible = true; tc.getHelper ? (tc.getHelper().visible = true) : (tc.visible = true); pathLine.visible = true; keyDots.visible = true; targetBall.visible = true;
        }
      };
      tick();
      api.current = { redraw: () => { lastT = -1; },setFlight,capture:captureFlight, dispose: () => { flight.dispose();ro.disconnect(); tc.dispose(); orbitC.dispose();built.dispose(); renderer.dispose();renderer.forceContextLoss(); canvas.remove(); } };
      if(live.current.flying)setFlight(true);
    })().catch((e) => setStatus(`The scene view could not load: ${e instanceof Error ? e.message : String(e)}`));
    return () => { disposed = true; cancelAnimationFrame(raf); api.current?.dispose(); api.current = null; };
  }, [sceneLayer, folder, big]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { api.current?.redraw(); }, [layer, handle]);
  React.useEffect(()=>{api.current?.setFlight(flying);},[flying]);

  const box = (
    <div className={`relative overflow-hidden rounded-[10px] bg-[#1b1d22] ${big ? 'h-full' : 'h-[260px]'}`}>
      <div ref={host} className="absolute inset-0" />
      {status ? <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-[11.5px] text-white/70">{status}</div> : null}
      <div className="absolute left-2 top-2 flex items-center gap-1">
        {mode === 'camera' ? (
          <div className={`${segWrap} bg-black/40 backdrop-blur`}>
            <button type="button" className={`${seg(handle === 'camera')} text-white`} onClick={() => setHandle('camera')}><Move size={12} />Camera</button>
            <button type="button" className={`${seg(handle === 'target')} text-white`} onClick={() => setHandle('target')}><Crosshair size={12} />Look at</button>
          </div>
        ) : <span className="rounded-md bg-black/40 px-2 py-1 text-[11px] text-white/80 backdrop-blur">Drag the handle to move the key at the playhead</span>}
      </div>
      <button type="button" aria-label={big ? 'Smaller' : 'Bigger'} onClick={() => setBig((v) => !v)} className="absolute bottom-2 left-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/80 backdrop-blur hover:text-white">{big ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
      {mode==='camera'&&<div className="absolute bottom-2 right-2 flex items-center gap-1"><button type="button" disabled={!!status} aria-pressed={flying} onClick={()=>setFlying(v=>!v)} className="rounded-md bg-black/65 px-2 py-1.5 text-[11px] text-white disabled:opacity-40">{flying?'Exit flight':'Fly with keyboard'}</button>{flying&&<button type="button" onClick={()=>api.current?.capture()} className="rounded-md bg-[var(--accent)] px-2 py-1.5 text-[11px] text-white">Space · key at {captureTime.toFixed(1)}s</button>}</div>}
      {flying&&<p className="pointer-events-none absolute left-2 top-11 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white/85">WASD move · Q down / E up · drag to look · Shift faster · Space adds a key · Esc exits</p>}
      {mode === 'camera' ? <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white/80"><Video size={10} />Camera view</span> : null}
    </div>
  );
  React.useEffect(()=>{if(!big)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setBig(false);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[big]);
  return big ? createPortal(<div role="dialog" aria-modal="true" aria-label="3D flight path editor" className="fixed inset-2 z-[10010] rounded-xl bg-[#111215] p-2 shadow-2xl sm:inset-6">{box}</div>,document.body) : <div className="flex flex-col gap-1">{box}<p className={T.hint}>Drag to orbit · right-drag to pan · scroll to zoom. Moving the handle writes a key at the playhead.</p></div>;
}
