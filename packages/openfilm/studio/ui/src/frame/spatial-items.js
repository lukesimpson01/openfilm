import {planeTextMetrics,planeMap}from'./scene-geometry.js';
import {apply}from'./track-core.js';
import {surfaceAnchor,worldAnchor,spatialPoseAt,projectWorld}from'./spatial-geometry.js';
/** A failed geometric placement remains a surface track with an explicit reason, never a fabricated world point. */
export function spatialItem(item,solution,time,w,h,currentPixel){
 if(!solution)return item;
 const pixel=currentPixel??[item.anchor[0]/w*solution.width,item.anchor[1]/h*solution.height],region=currentPixel?null:item.planeQuad?.map(p=>[p[0]/w*solution.width,p[1]/h*solution.height]);
 try{
  const surface=surfaceAnchor(solution,Math.round(time*1e6),pixel,region),pose=spatialPoseAt(solution,Math.round(time*1e6)),depth=projectWorld(surface.position,pose).depth;
  const anchor=item.place==='surface'?surface:{...worldAnchor(solution,Math.round(time*1e6),pixel,Math.hypot(...surface.position.map((v,i)=>v))),position:surface.position};
  let height=item.size??h*.15;if(item.planeQuad){const aspect=Math.max(1,[...String(item.text??'')].length*.55),metrics=planeTextMetrics(item.planeQuad,item.anchor,height,aspect),map=planeMap(item.planeQuad);if(metrics&&map){const p=apply(map,[metrics.anchor[0],metrics.anchor[1]-metrics.size[1]/2]),q=apply(map,[metrics.anchor[0],metrics.anchor[1]+metrics.size[1]/2]);height=Math.min(height,Math.hypot(p[0]-q[0],p[1]-q[1]));}}
  return {...item,spatialAnchor:anchor,worldHeight:height/h*solution.height/pose.intrinsics[1][1]*depth,spatialWarning:undefined};
 }catch(error){return {...item,spatialWarning:error.message};}
}
