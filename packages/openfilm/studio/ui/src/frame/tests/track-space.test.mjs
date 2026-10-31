import test from 'node:test';
import assert from 'node:assert/strict';
import { proxySize, contentRect, footageRect, placedPoint, referencePoint, fitItem } from '../track-space.js';
import { appendDeviceAction, continueCameraMotion, screenStateAt } from '../motion-sequence.js';
import { motionAt, camera3dAt } from '../motion3d.js';
test('rotated 4K portraits stay within the same proxy budget as landscapes',()=>{
  assert.deepEqual(proxySize(2160,3840,384),{w:216,h:384});assert.deepEqual(proxySize(3840,2160,384),{w:384,h:216});
});
test('detects a portrait inside landscape, but does not crop an entirely dark scene',()=>{
  const w=320,h=180,p=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=110;x<210;x++)p[y*w+x]=100;
  const R=contentRect(p,w,h);assert.ok(Math.abs(R.w-.3125)<.02);assert.equal(R.h,1);assert.deepEqual(contentRect(new Uint8Array(w*h),w,h),{x:0,y:0,w:1,h:1});
});
test('boxed source footage maps to its own region and preserves portrait aspect ratio',()=>{
  const r=footageRect(1920,1080,2160,3840,{x:960,y:0,w:960,h:1080});assert.equal(r.h,1);assert.ok(r.x>.5);assert.ok(r.x+r.w<1);
});
test('drag placement inverts perspective and relative distance accurately',()=>{
  const H=[1.1,.02,12,-.03,1.08,9,.0002,-.0001,1],p=[120,240];for(const d of [0,.5,1]){const q=placedPoint(H,p,d),r=referencePoint(H,q,d);assert.ok(Math.hypot(r[0]-p[0],r[1]-p[1])<.01);}
});
test('default title is contained within a portrait inset',()=>{
  const it=fitItem({text:'WALK THROUGH',size:100,anchor:[160,150]},{x:.35,y:0,w:.3,h:1},320,180);assert.ok(it.size<20);assert.ok(it.anchor[0]>112&&it.anchor[0]<208);
});
test('a MacBook continues its intro, closes, opens and starts its screen without another device',()=>{
  const o={type:'laptop',motion:{keys:[{t:0,p:[0,-1,0],r:[0,30,0],lid:0},{t:2,p:[.2,0,0],r:[10,0,0],lid:110}]}};
  const closed=appendDeviceAction(o,'closeLid',1,5),opened=appendDeviceAction(closed,'openLid',1,5),screen=appendDeviceAction(opened,'screenOn',1,5,{src:'assets/demo.mp4'});
  assert.deepEqual(closed.motion.keys[0],o.motion.keys[0]);assert.equal(motionAt(closed.motion,6,6).lid,0);assert.equal(motionAt(opened.motion,7,7).lid,110);assert.equal(screen.screen.onAt,7);assert.equal(screen.screen.src,'assets/demo.mp4');assert.equal(screen.actions.length,3);
  for(const t of [0,.4,1,1.7,2,4.9])assert.deepEqual(motionAt(closed.motion,t,6),motionAt(o.motion,t,5));
  for(let t=5;t<=6;t+=.01)assert.ok(motionAt(closed.motion,t,6).lid>=0&&motionAt(closed.motion,t,6).lid<=110);
});
test('the next camera starts exactly at the preceding camera pose',()=>{
  const previous={keys:[{t:0,p:[0,0,5],look:[0,0,0],fov:35},{t:3,p:[2,1,4],look:[.2,0,0],fov:40}]};
  const next={keys:[{t:0,p:[0,0,5],look:[0,0,0],fov:35},{t:2,p:[-2,0,5],look:[0,0,0],fov:30}]};
  const joined=continueCameraMotion(next,previous,3,3);assert.deepEqual(camera3dAt(joined,0,2),camera3dAt(previous,3,3));
});
test('screen power actions preserve earlier off/on intervals and restart playback at each power-on',()=>{
  const o={motion:{keys:[{t:0,p:[0,0,0],r:[0,0,0]},{t:2,p:[0,0,0],r:[0,0,0]}]}};
  const first=appendDeviceAction(o,'screenOn',1,6),off=appendDeviceAction(first,'screenOff',1,6),again=appendDeviceAction(off,'screenOn',1,6);
  assert.equal(screenStateAt(again.screen,1).on,false);assert.deepEqual(screenStateAt(again.screen,6.5),{on:true,playAt:6});assert.equal(screenStateAt(again.screen,7.5).on,false);assert.deepEqual(screenStateAt(again.screen,8.5),{on:true,playAt:8});
});
test('late imported screen media stays off before its action, with explicit start/time overrides',()=>{
 assert.equal(screenStateAt({src:'video.mp4',startMode:'action'},3).on,false);
 assert.equal(screenStateAt({src:'video.mp4',startMode:'start'},0).on,true);
 assert.deepEqual(screenStateAt({src:'video.mp4',startMode:'time',onAt:2,playAt:2},2.5),{on:true,playAt:2});
 const o={motion:{keys:[{t:0,p:[0,0,0],r:[0,0,0]},{t:2,p:[.2,0,0],r:[0,0,0]}]}};
 const n=appendDeviceAction(o,'move',1,5,{at:0,position:[.8,.4,0]});assert.equal(n.actions[0].at,5);assert.deepEqual(motionAt(n.motion,5,6).p,[.2,0,0]);assert.deepEqual(motionAt(n.motion,6,6).p,[.8,.4,0]);
});
