import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, apply, inv3, transformAt, homography, ransac } from '../track-core.js';

/* a textured picture (smooth random blobs) and the same picture seen through a homography */
const W = 320, H = 180;
function texture(seed = 3) {
  let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const blobs = Array.from({ length: 260 }, () => [rnd() * W * 1.6 - W * 0.3, rnd() * H * 1.6 - H * 0.3, 3 + rnd() * 9, rnd() * 200 + 30]);
  return (x, y) => { let v = 60; for (const [bx, by, r, c] of blobs) { const d = (x - bx) ** 2 + (y - by) ** 2; if (d < r * r * 4) v += c * Math.exp(-d / (r * r)); } return Math.min(255, v); };
}
const tex = texture();
function render(Hm) { const Hi = inv3(Hm); const g = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [u, v] = apply(Hi, [x, y]); g[y * W + x] = tex(u, v); } return g; }
const truth = (k) => { const a = k * 0.01, s = 1 + k * 0.006; return [s * Math.cos(a), -s * Math.sin(a), 2.0 * k, s * Math.sin(a), s * Math.cos(a), 1.2 * k, 0.00004 * k, 0.00002 * k, 1]; };

test('homography from exact correspondences', () => {
  const Ht = truth(10); const src = [[10, 10], [300, 20], [280, 170], [20, 160], [150, 90], [60, 120]]; const dst = src.map((p) => apply(Ht, p));
  const Hf = homography(src, dst); for (const p of src) { const a = apply(Hf, p), b = apply(Ht, p); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6); }
});

test('RANSAC ignores a moving object (30% outliers)', () => {
  const Ht = truth(8); const src = []; const dst = [];
  for (let i = 0; i < 100; i++) { const p = [(i * 37) % W, (i * 53) % H]; src.push(p); dst.push(i % 10 < 3 ? [p[0] + 25, p[1] - 14] : apply(Ht, p)); }
  const r = ransac(src, dst); assert.ok(r); assert.ok(r.inliers.length >= 68 && r.inliers.length <= 72, `inliers ${r.inliers.length}`); assert.ok(r.err < 1e-3);
});

test('tracks a plane through 24 frames of perspective motion: corners within 1 px of the truth', () => {
  const tr = createTracker({ w: W, h: H, mode: 'camera' });
  for (let k = 0; k <= 24; k++) tr.push(render(truth(k)), k / 24);
  const res = tr.result();
  assert.equal(res.cuts.length, 0);
  let worst = 0;
  for (let k = 1; k <= 24; k++) {
    const Hf = transformAt(res, k / 24); const Ht = truth(k); const H0 = inv3(truth(0));
    for (const p of [[40, 30], [280, 30], [280, 150], [40, 150]]) { const a = apply(Hf, p), b = apply(Ht, apply(H0, p)); worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  }
  assert.ok(worst < 1.0, `worst corner error ${worst.toFixed(3)} px`);
  assert.equal(res.quality, 'Good');
});

test('a hard cut starts a new stretch instead of tracking across it', () => {
  const tr = createTracker({ w: W, h: H, mode: 'camera' });
  for (let k = 0; k < 4; k++) tr.push(render(truth(k)), k / 10);
  const other = new Uint8Array(W * H).map((_, i) => (i * 7919) % 255);
  tr.push(other, 0.4); tr.push(other, 0.5);
  assert.deepEqual(tr.result().cuts, [0.4]);
});

test('a reacquired surface never invents motion through its lost interval',()=>{
  const I=[1,0,0,0,1,0,0,0,1],moved=[1,0,80,0,1,12,0,0,1];
  const result={frames:[{t:0,H:I},{t:.1,H:I,lost:true},{t:.8,H:moved},{t:1,H:moved}]};
  assert.deepEqual(transformAt(result,.5),I);
  assert.deepEqual(transformAt(result,.8),moved);
});

test('blank and fully occluded surfaces are lost rather than fitted to background motion',()=>{
  for(const blocked of [false,true]){
    const tracker=createTracker({w:W,h:H,mode:'planar',region:[10,10,W-10,H-10],plane:[[10,10],[W-10,10],[W-10,H-10],[10,H-10]],maxPoints:40});
    tracker.push(blocked?render(truth(0)):new Uint8Array(W*H).fill(100),0,blocked?()=>true:null);
    tracker.push(blocked?render(truth(4)):new Uint8Array(W*H).fill(100),.1,blocked?()=>true:null);
    const result=tracker.result();assert.equal(result.frames[1].lost,true);assert.equal(result.quality,'Poor');
  }
});

test('a planar selection seeds anchors inside its actual quadrilateral',()=>{
  const plane=[[40,30],[210,55],[180,150],[80,130]],tracker=createTracker({w:W,h:H,mode:'planar',region:[40,30,210,150],plane,maxPoints:40});
  tracker.push(render(truth(0)),0);
  for(const p of tracker.points()){
    const signs=plane.map((a,i)=>{const b=plane[(i+1)%4];return(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);});
    assert.ok(signs.every(s=>s>=0)||signs.every(s=>s<=0));
  }
  assert.ok(tracker.points().length>6);
});

test('fast alternating camera shake preserves verified planar geometry',()=>{
  const tracker=createTracker({w:W,h:H,mode:'camera',maxPoints:100,lkWindow:3,lkIters:6,adaptive:true}),motions=[0,8,-5,11,-7,4,0];
  motions.forEach((dx,i)=>tracker.push(render([1,0,dx,0,1,dx*.35,0,0,1]),i/30));
  const result=tracker.result();assert.equal(result.cuts.length,0,'shake is not a scene cut');
  let observed=0,worst=0;
  result.frames.forEach((f,i)=>{if(!i||f.lost)return;observed++;for(const p of [[60,40],[W-60,40],[W-60,H-40],[60,H-40]]){const actual=apply(f.H,p),expected=[p[0]+motions[i],p[1]+motions[i]*.35];worst=Math.max(worst,Math.hypot(actual[0]-expected[0],actual[1]-expected[1]));}});
  assert.ok(observed>=5,`${observed} verified frames`);assert.ok(worst<1.5,`verified error ${worst}px`);
});

test('a degenerate solve at the anchor holds the last verified transform instead of removing the element',async()=>{
  const {transformAtAnchored,transformAt}=await import('../track-core.js');
  const good=[1,0,0,0,1,0,0,0,1],bad=[1,0,0,0,1,0,-.2,0,1];
  const result={frames:[{t:0,H:good},{t:1,H:[2,0,0,0,2,0,0,0,1]},{t:2,H:bad}],cuts:[]};
  assert.deepEqual(transformAtAnchored(result,2,[10,10]),[2,0,0,0,2,0,0,0,1]);
  assert.deepEqual(transformAtAnchored(result,.5,[10,10]),transformAt(result,.5));
});
