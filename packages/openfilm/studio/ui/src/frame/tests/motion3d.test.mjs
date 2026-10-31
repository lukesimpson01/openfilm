import test from 'node:test';
import assert from 'node:assert/strict';
import { motionAt, cameraView, cameraPreset, pathKeys, camera3dPreset, camera3dAt } from '../motion3d.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);
const five = { keys: [{ t: 0, p: [0, 0, 0] }, { t: 1, p: [100, 0, 0] }, { t: 2, p: [100, 100, 0] }, { t: 3, p: [0, 100, 50] }, { t: 4, p: [50, 50, 0] }] };

test('every key is reached exactly at its time (curved, arc-length, smoothed ends)', () => {
  for (const k of five.keys) { const s = motionAt(five, k.t); k.p.forEach((v, i) => near(s.p[i], v, 1e-3)); }
});

test('the move does not stop at an inner key (continuous speed through it)', () => {
  const a = motionAt(five, 0.99).p, b = motionAt(five, 1.01).p;
  assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.5, 'moving through the middle key');
});

test('after the last key the state holds exactly: no drift, phase hold', () => {
  const end = motionAt(five, 4).p;
  for (const t of [4.001, 5, 9.5]) { const s = motionAt(five, t); assert.deepEqual(s.p.map((v) => +v.toFixed(9)), end.map((v) => +v.toFixed(9))); assert.equal(s.phase, 'hold'); assert.equal(s.moving, false); }
});

test('smooth start / stop: zero speed at the ends; off: linear', () => {
  const m = { keys: [{ t: 0, p: [0, 0, 0] }, { t: 1, p: [100, 0, 0] }] };
  near(motionAt(m, 0.01).p[0], 0.0298, 0.01); /* eased: barely moved */
  const lin = { ...m, smoothStart: false, smoothStop: false };
  near(motionAt(lin, 0.25).p[0], 25, 1e-6); near(motionAt(lin, 0.5).p[0], 50, 1e-6);
  const startOnly = { ...m, smoothStart: true, smoothStop: false };
  assert.ok(motionAt(startOnly, 0.9).p[0] < 95 && motionAt(startOnly, 0.9).p[0] > 85, 'still at speed near the end');
});

test('return to start happens at its own time and lands on the start', () => {
  const m = { keys: [{ t: 1, p: [0, 0, 0], zoom: 1 }, { t: 2, p: [500, 300, 0], zoom: 1.75 }], returnBack: true, returnAt: 3, returnDuration: 1 };
  near(motionAt(m, 2.5).p[0], 500); assert.equal(motionAt(m, 2.5).phase, 'hold');
  assert.equal(motionAt(m, 3.5).phase, 'return'); near(motionAt(m, 3.5).p[0], 250, 1);
  near(motionAt(m, 4).p[0], 0); near(motionAt(m, 6).zoom, 1); assert.equal(motionAt(m, 6).phase, 'after');
  /* the same t always gives the same state, however it was reached */
  assert.deepEqual(motionAt(m, 3.25), motionAt(m, 3.25));
});

test('2D camera: zoom to target 1→2s, hold to 3s, return 3→4s, constrained to the stage', () => {
  const stage = { w: 1080, h: 1920 };
  const m = cameraPreset('zoomTarget', stage, 5, { target: [800, 500], zoom: 1.75, start: 1, stop: 2, returnBack: true, returnDuration: 1 });
  m.returnAt = 3;
  const v0 = cameraView(m, 0.5, 5, stage); near(v0.zoom, 1); near(v0.cx, 540);
  const v2 = cameraView(m, 2.5, 5, stage); near(v2.zoom, 1.75);
  assert.ok(v2.cx <= 1080 - 1080 / 3.5 + 1e-6, 'kept inside the stage'); assert.equal(v2.outside, false);
  const v4 = cameraView(m, 4.2, 5, stage); near(v4.zoom, 1); near(v4.cx, 540);
});

test('path presets start and end where asked', () => {
  for (const p of ['straight', 'arcLeft', 'arcRight', 'sCurve', 'spiral', 'approach', 'flyby', 'pullback']) {
    const ks = pathKeys(p, [0, 0, 0], [10, 5, 0], 0, 2);
    near(ks[0].t, 0); near(ks[ks.length - 1].t, 2);
    near(ks[0].p[0], 0); near(ks[ks.length - 1].p[0], 10);
  }
});

test('3D camera orbit keeps looking at its target and ends at stop', () => {
  const m = camera3dPreset('orbit', 3, { target: [0, 0, 0], distance: 4.5, orbit: 65 });
  const a = camera3dAt(m, 0, 3), b = camera3dAt(m, 3, 3);
  assert.deepEqual(a.target, [0, 0, 0]); near(Math.hypot(b.position[0], b.position[2]), 4.5, 0.05);
  assert.notDeepEqual(a.position, b.position);
});

test('a turn in place (no movement) still turns through every key', () => {
  const m = { keys: [{ t: 0, p: [0, 0, 0], r: [0, 0, 0] }, { t: 2, p: [0, 0, 0], r: [0, 90, 0] }, { t: 4, p: [0, 0, 0], r: [0, 180, 0] }] };
  near(motionAt(m, 2).r[1], 90, 1e-6); near(motionAt(m, 4).r[1], 180, 1e-6); assert.ok(motionAt(m, 3).r[1] > 100 && motionAt(m, 3).r[1] < 170);
});

test('3D shots: each named view is reached at its time, looking at the target', async () => {
  const { camera3dShots, shotPosition } = await import('../motion3d.js');
  const m = camera3dShots([{ t: 0, view: 'front' }, { t: 1.5, view: 'close left' }, { t: 3, view: 'top' }], 3, { distance: 4 });
  for (const k of m.keys) { const s = camera3dAt(m, k.t, 3); k.p.forEach((v, i) => near(s.position[i], v, 1e-3)); assert.deepEqual(s.target, [0, 0, 0]); }
  near(shotPosition('left', { distance: 4 })[0], -4, 1e-9); assert.ok(shotPosition('top', { distance: 4 })[1] > 5);
});

test('3D camera on flat footage: the default pose is the identity, a tilt keeps the view covered',async()=>{
  const {camera3dMatrix,camera3dCss}=await import('../motion3d.js');
  const stage={w:1080,h:1920},front=camera3dMatrix({position:[0,0,4.5],target:[0,0,0],fov:35,roll:0},stage);
  assert.ok(Math.abs(front.m11/front.m44-1)<1e-9&&Math.abs(front.m22/front.m44-1)<1e-9&&Math.abs(front.m41)<1e-12);
  const yaw=a=>({position:[Math.sin(a)*4.5,0,Math.cos(a)*4.5],target:[0,0,0],fov:35,roll:0});
  const m=camera3dMatrix(yaw(.35),stage),c=n=>n;
  /* every stage corner must land on the plane (|x|<=W/2,|y|<=H/2) once the plane is enlarged */
  const A=[[m.m11,m.m12,m.m14],[m.m21,m.m22,m.m24],[m.m41,m.m42,m.m44]];
  const solve=(X,Y)=>{ // plane point p with A·[p,1] ∝ [X,Y,1]
    const a=[[A[0][0]-X*A[2][0],A[0][1]-X*A[2][1]],[A[1][0]-Y*A[2][0],A[1][1]-Y*A[2][1]]],b=[X*A[2][2]-A[0][2],Y*A[2][2]-A[1][2]],d=a[0][0]*a[1][1]-a[0][1]*a[1][0];
    return [(b[0]*a[1][1]-a[0][1]*b[1])/d,(a[0][0]*b[1]-b[0]*a[1][0])/d];
  };
  for(const [X,Y] of [[-540,-960],[540,-960],[540,960],[-540,960]]){const [x,y]=solve(X,Y);assert.ok(Math.abs(x)<=540+.5&&Math.abs(y)<=960+.5,`corner ${X},${Y} → ${x},${y}`);}
  assert.ok(m.m41!==0,'a yawed camera has perspective');
  assert.match(camera3dCss({position:[0,0,4.5],target:[0,0,0],fov:35},stage),/matrix3d\(/);
});
