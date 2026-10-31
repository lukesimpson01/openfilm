/* Camera page: a camera clip on the timeline. It draws nothing; the film's timeline asks it for the view at its t
   (film.camera) and shows the tracks below it through that view (2D), or hands the 3D camera to the 3D pages below.
   layer.camera: { mode: '2d'|'3d', motion (motion3d.js keys), bounds: 'constrain'|'fill'|'allow', background,
   holdAfter: keep the last view after the clip ends, until another camera starts }. */
import { cameraView, cameraCss, camera3dAt, camera3dCss } from './motion3d.js';
import {pathAt,trackingSpan} from './universal-motion.js';

export function createCamera(layer) {
  const duration = Math.max(0.1, layer.duration || 3);
  const cam = layer.camera ?? {};
  let lastVerifiedView=null;
  const trackingPath=(cam.tracking?.path??[]).map(p=>{if(p.visible){lastVerifiedView=p;return p;}return lastVerifiedView?{...p,x:lastVerifiedView.x,y:lastVerifiedView.y,zoom:lastVerifiedView.zoom,holding:true}:p;});
  const stage = { w: cam.stageW ?? 1080, h: cam.stageH ?? 1920 };
  return {
    duration,
    ready: Promise.resolve(),
    frame() {},
    camera(t, filmTime) {
      const tt = Math.min(Math.max(t, 0), duration);
      /* while its framing is being edited on the picture, the preview shows the whole stage (the editor draws the frame) */
      if (cam.bypass) return { kind: cam.mode === '3d' ? '3d' : '2d', css: '', camera: null, holdAfter: false };
      if (cam.mode === '3d') { const camera = camera3dAt(cam.motion, tt, duration); return { kind: '3d', camera, css: camera3dCss(camera, stage, cam.bounds ?? 'constrain'), holdAfter: !!cam.holdAfter }; }
      if(cam.tracking){const found=trackingSpan(window.parent,cam.tracking,filmTime??t),p=found&&pathAt(trackingPath,found.timeUs);if(!p||!p.visible&&!p.holding)return {kind:'2d',css:'',targetClips:[],holdAfter:false};return {kind:'2d',css:cameraCss({cx:p.x,cy:p.y,zoom:p.zoom,roll:0},stage),targetClips:[found.clip.id],trackingStatus:p.visible?'observed':'holding',holdAfter:false};}
      const v = cameraView(cam.motion, tt, duration, stage, cam.bounds ?? 'constrain', cam.media ?? null);
      return { kind: '2d', css: cameraCss(v, stage), view: v, background: cam.bounds === 'fill' ? (cam.background ?? '#000') : '', holdAfter: !!cam.holdAfter };
    },
  };
}
