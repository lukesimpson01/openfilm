import test from 'node:test';import assert from 'node:assert/strict';
import {affine,apply,validPlaneProjection,planeFitSupported,transformAt} from '../track-core.js';
import {visibleSurfaceMarkers} from '../scene-geometry.js';
import {surfaceDepthMatrix} from '../track-space.js';
import {trackedRange} from '../footage-timing.js';
const I=[1,0,0,0,1,0,0,0,1],quad=[[0,0],[100,0],[100,200],[0,200]];
test('a six-second source never creates a one-hour tracked layer; an outside playhead uses the source start',()=>{
 const footage={start:5.5,end:3605.5,clip:{time:[0],speed:1}},analysis={from:0,to:6.2};
 assert.deepEqual(trackedRange(footage,analysis,12.86),{from:5.5,length:6.199999999999999});
 const selected=trackedRange(footage,analysis,7);assert.equal(selected.from,7);assert.ok(Math.abs(selected.length-4.7)<1e-9);
 assert.deepEqual(trackedRange({start:2,end:100,clip:{time:[3],speed:2}},{from:3,to:9},0),{from:2,length:3});
});
test('the depth slider cannot invent a second wall camera or move an observed wall pin',()=>{
 const H=[1.2,.02,15,-.03,1.1,-10,.0005,0,1];for(const d of [0,.35,.5,1])assert.deepEqual(surfaceDepthMatrix(H,quad,d),H);
});
test('a projective horizon, folded wall, reflected wall and sudden plane spin are rejected',()=>{
 assert.ok(validPlaneProjection(I,quad));assert.equal(validPlaneProjection([1,0,0,0,1,0,-.02,0,1],quad),false);
 assert.equal(validPlaneProjection([-1,0,100,0,1,0,0,0,1],quad),false);
 assert.equal(validPlaneProjection([0,-1,100,1,0,0,0,0,1],quad,I),false);
 assert.ok(validPlaneProjection([1.05,.02,8,-.02,1.05,5,0,0,1],quad,I));
});
test('a low-error cluster along one line does not justify perspective for an entire wall',()=>{
 const points=Array.from({length:12},(_,i)=>[i*5,i*5+.01*(i%2)]),fit={inliers:points.map((_,i)=>i),H:I};assert.equal(planeFitSupported(fit,points,quad),false);
 const spread=[[10,10],[90,10],[10,190],[90,190],[50,20],[50,180],[20,100],[80,100]];assert.ok(planeFitSupported({inliers:spread.map((_,i)=>i)},spread,quad));
});
test('the affine fallback reproduces an observed tilted surface with subpixel residual',()=>{
 const src=[[0,0],[100,0],[0,200],[100,200],[30,70],[60,160]],truth=[1.1,.2,12,-.1,.95,6,0,0,1],dst=src.map(p=>apply(truth,p)),H=affine(src,dst);
 for(let i=0;i<src.length;i++){const p=apply(H,src[i]);assert.ok(Math.hypot(p[0]-dst[i][0],p[1]-dst[i][1])<1e-6);}
});
test('guides only appear for visible and verified surface observations',()=>{
 const scene={planes:[{name:'wall',kind:'wall',confidence:.9,quad:[[0,0],[1,0],[1,1],[0,1]]}]},planes=[{name:'wall',track:'wall.json'}];
 const tracks={'wall.json':{frames:[{t:0,H:I},{t:1,H:I,lost:true}]}};
 assert.equal(visibleSurfaceMarkers(scene,planes,tracks,0,100,200,I).length,3);
 assert.equal(visibleSurfaceMarkers(scene,planes,tracks,2,100,200,I).length,0);
 const off={'wall.json':{frames:[{t:0,H:[1,0,500,0,1,0,0,0,1]}]}};assert.equal(visibleSurfaceMarkers(scene,planes,off,0,100,200,I).length,0);
});
test('intermediate plane projections remain finite and preserve both exact endpoints',()=>{
 const H=[1.2,.03,8,.01,1.1,3,.001,.0005,1],track={plane:quad,frames:[{t:0,H:I},{t:1,H}]};
 for(let t=0;t<=1;t+=.025)assert.ok(validPlaneProjection(transformAt(track,t),quad));assert.deepEqual(transformAt(track,1),H);
});
