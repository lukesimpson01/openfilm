import test from 'node:test';import assert from 'node:assert/strict';
import{projectWorld,anchorFrame,anchorCameraPlane,anchorQuad}from'../spatial-geometry.js';
const K=[[500,0,320],[0,500,240],[0,0,1]],pose=(x=0,z=0,yaw=0)=>{const c=Math.cos(yaw),s=Math.sin(yaw),R=[[c,0,s],[0,1,0],[-s,0,c]],t=[-(R[0][0]*x+R[0][2]*z),0,-(R[2][0]*x+R[2][2]*z)];return{shotId:0,sourceTimeUs:0,worldToCamera:R.map((r,i)=>[...r,t[i]]),intrinsics:K,distortion:[0],status:'observed'};};
/* a wall 4 units ahead; its normal faces the camera (−z), as surfaceAnchor orients it */
const wall={type:'surface',shotId:0,position:[0,0,4],normal:[0,0,-1],right:[1,0,0],down:[0,1,0],scale:[1,1,1],offset:[0,0,0],depthOffset:0};

test('depth moves text along the wall normal: positive toward the camera, negative into the scene',()=>{
  const on=anchorFrame(wall,null,pose()),front=anchorFrame({...wall,depthOffset:1},null,pose()),behind=anchorFrame({...wall,depthOffset:-1},null,pose());
  assert.ok(Math.abs(on.position[2]-4)<1e-9);assert.ok(Math.abs(front.position[2]-3)<1e-9,'in front of the wall is nearer the camera');assert.ok(Math.abs(behind.position[2]-5)<1e-9);
  assert.ok(projectWorld(front.position,pose()).depth<projectWorld(on.position,pose()).depth);
});
test('a depth offset stays fixed in the world while the camera moves: no screen-space drift',()=>{
  const a={...wall,depthOffset:1.2},world=anchorFrame(a,null,pose()).position;
  for(const p of[pose(.5,.3,.1),pose(-.8,1,-.2),pose(2,2,.4)])assert.deepEqual(anchorFrame(a,null,p).position,world);
});
test('depth leaves the surface orientation unchanged, and reset (offset 0) restores the original position exactly',()=>{
  const on=anchorFrame(wall,null,pose()),moved=anchorFrame({...wall,depthOffset:.7},null,pose()),reset=anchorFrame({...wall,depthOffset:0},null,pose());
  assert.deepEqual(moved.normal,on.normal);assert.deepEqual(moved.right,on.right);assert.deepEqual(reset.position,on.position);
});
test('walking past a wall: with part of the text beside or behind the camera, the plane is still rendered so the visible part draws',()=>{
  /* camera stands 0.2 in front of the wall plane (z=3.8) looking along +x: the part of the line of text at x<0 is behind it */
  const a={...wall,position:[0.5,0,4]},side=pose(0,3.8,Math.PI/2),plane=anchorCameraPlane(a,4,.4,side,null);
  assert.equal(anchorQuad(a,4,.4,side),null,'a whole-quad test would drop the word as soon as one corner is behind the camera');
  assert.ok(plane,'the camera-plane path keeps it');
  const nearEdge=plane.origin[2]+plane.right[2]*.9,farEdge=plane.origin[2]+plane.right[2]*0;assert.ok(nearEdge>0||farEdge>0,'some of the text is in front of the camera');
});
