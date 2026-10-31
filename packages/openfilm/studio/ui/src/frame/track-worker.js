/* The tracker in a worker, so the editor stays usable while footage is analysed. Messages: { type:'start', opts },
   { type:'frame', gray, t, mask (Uint8Array, 1 = subject: not a background anchor) }, { type:'end' } → { type:'points' }
   every few frames (for the overlay), { type:'done', result }. */
import { createTracker, smoothTransforms, pyramid } from './track-core.js';

let tracker = null, opts = null, n = 0;
let planes=[];
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start') { opts = m.opts; tracker = createTracker({...opts,adaptive:true});planes=(opts.planes??[]).map(p=>({...p,tracker:createTracker({...opts,adaptive:true,mode:'planar',plane:p.quad,region:[Math.min(...p.quad.map(q=>q[0])),Math.min(...p.quad.map(q=>q[1])),Math.max(...p.quad.map(q=>q[0])),Math.max(...p.quad.map(q=>q[1]))],maxPoints:40,ransacIters:160})})); n = 0; return; }
  if (m.type === 'frame' && tracker) {
    const { w } = opts; const mask = m.mask ? (x, y) => m.mask[(y | 0) * w + (x | 0)] > 0 : null;
    const shared=pyramid(m.gray,opts.w,opts.h,3);
    tracker.push(m.gray, m.t, mask,shared);for(const p of planes)p.tracker.push(m.gray,m.t,mask,shared); n++;
    if (n % 3 === 1) self.postMessage({ type: 'points', t: m.t, points: tracker.points() });
    self.postMessage({ type: 'progress', n });
    return;
  }
  if (m.type === 'end' && tracker) {
    let result = tracker.result();
    if (opts.smooth) result = smoothTransforms(result, opts.smooth);
    self.postMessage({ type: 'done', result,planes:planes.map(({name,tracker})=>({name,result:tracker.result()})) });
  }
};
