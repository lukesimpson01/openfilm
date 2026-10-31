import{surfaceCandidates}from'./scene-geometry.js';
import{surfaceAnchor,spatialPoseAt,projectWorld,anchorQuad}from'./spatial-geometry.js';
const cache=new WeakMap();
/** Guide normals come from reconstructed neighbours, rather than extrapolated screen rectangles. */
export function spatialSurfaceMarkers(solution,scene,time,w,h){
 if(!solution||!scene)return [];let stored=cache.get(solution);if(!stored||stored.scene!==scene){
  const reference=Math.round((scene.referenceTime??solution.from)*1e6),pose=spatialPoseAt(solution,reference);const pins=[];
  if(pose)for(const sample of surfaceCandidates(scene,solution.width,solution.height)){try{const plane=scene.planes.find(p=>p.name===sample.title),region=plane.quad.map(p=>[p[0]*solution.width,p[1]*solution.height]),anchor=surfaceAnchor(solution,reference,sample.point,region),depth=projectWorld(anchor.position,pose).depth;pins.push({...sample,anchor,height:16/pose.intrinsics[1][1]*depth});}catch{/* Unsupported surfaces stay unmarked. Manual selection remains available. */}}
  stored={scene,pins};cache.set(solution,stored);
 }
 const pose=spatialPoseAt(solution,Math.round(time*1e6));if(!pose)return [];
 return stored.pins.flatMap(pin=>{const point=projectWorld(pin.anchor.position,pose),quad=anchorQuad(pin.anchor,pin.height*1.3,pin.height,pose);if(!point||!quad||point.x<0||point.y<0||point.x>solution.width||point.y>solution.height)return [];return [{id:pin.id,title:pin.title,point:[point.x/solution.width*w,point.y/solution.height*h],quad:quad.map(p=>[p.x/solution.width*w,p.y/solution.height*h])}];});
}
