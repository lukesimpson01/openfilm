import{surfaceCandidates}from'./scene-geometry.js';
import{surfaceAnchor,spatialPoseAt,projectWorld,anchorQuad,anchorFromGeometry,fitPlane}from'./spatial-geometry.js';
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

/* ---- surfaces read straight from the reconstruction ----
   No scene description is needed: the solved landmarks are grouped into planes (walls, floor, facades) by repeated robust
   plane fits, and each group becomes one placement spot whose translucent square is drawn at the plane's true tilt for the
   current camera. The planes live in world space, so they stay on their surfaces as the video plays. */
const planes=new WeakMap();
const dot3=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len3=a=>Math.hypot(a[0],a[1],a[2]);
export function reconstructedPlanes(solution,max=8){
 if(!solution)return [];const hit=planes.get(solution);if(hit)return hit;
 const shot=solution.shots?.find(s=>s.poses?.length&&s.points?.length>=30);if(!shot){planes.set(solution,[]);return [];}
 const reference=shot.poses[Math.floor(shot.poses.length/2)],pose=spatialPoseAt(solution,reference.sourceTimeUs);if(!pose){planes.set(solution,[]);return [];}
 let rest=shot.points.map(p=>p.xyz).filter(xyz=>{const q=projectWorld(xyz,pose);return q&&q.depth>0;});const depths=rest.map(xyz=>projectWorld(xyz,pose).depth).sort((a,b)=>a-b),threshold=Math.max(1e-4,(depths[depths.length>>1]??1)*.012);
 let seed=11;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};const out=[];
 for(let k=0;k<max&&rest.length>=24;k++){
  let best=null;for(let i=0;i<260;i++){const a=rest[Math.floor(random()*rest.length)],b=rest[Math.floor(random()*rest.length)],c=rest[Math.floor(random()*rest.length)],n=cross3(sub3(b,a),sub3(c,a)),l=len3(n);if(l<1e-9)continue;const normal=[n[0]/l,n[1]/l,n[2]/l],inliers=rest.filter(p=>Math.abs(dot3(sub3(p,a),normal))<threshold);if(!best||inliers.length>best.inliers.length)best={inliers,normal};}
  if(!best||best.inliers.length<Math.max(16,shot.points.length*.02))break;
  const fit=fitPlane(best.inliers);if(!fit)break;const centre=fit.point,inliers=rest.filter(p=>Math.abs(dot3(sub3(p,centre),fit.normal))<threshold);
  /* the spot sits on the landmark nearest the group's middle, so it is a place the footage really shows */
  const mid=inliers.reduce((a,p)=>[a[0]+p[0]/inliers.length,a[1]+p[1]/inliers.length,a[2]+p[2]/inliers.length],[0,0,0]);let spot=inliers[0],near=Infinity;for(const p of inliers){const d=len3(sub3(p,mid));if(d<near){near=d;spot=p;}}
  /* a second fit of the same wall (a ridge of points slightly off it) is not a new surface */
  if(out.some(o=>Math.abs(dot3(o.anchor.normal,fit.normal))>.985&&Math.abs(dot3(sub3(spot,o.anchor.position),o.anchor.normal))<threshold*4)){rest=rest.filter(p=>!inliers.includes(p));continue;}
  let anchor;try{anchor=anchorFromGeometry(solution,reference.sourceTimeUs,spot,fit.normal);}catch{rest=rest.filter(p=>!inliers.includes(p));continue;}
  out.push({id:`plane-${k}`,anchor,support:inliers.length,error:fit.error,referenceUs:reference.sourceTimeUs,size:.2*(depths[depths.length>>1]??1)});
  rest=rest.filter(p=>!inliers.includes(p));
 }
 planes.set(solution,out);return out;
}
export function reconstructedSurfaceMarkers(solution,time,w,h){
 const pose=spatialPoseAt(solution,Math.round(time*1e6));if(!pose)return [];
 return reconstructedPlanes(solution).flatMap(pin=>{
  const point=projectWorld(pin.anchor.position,pose);if(!point||point.x<solution.width*.03||point.y<solution.height*.03||point.x>solution.width*.97||point.y>solution.height*.97)return [];
  const quad=anchorQuad(pin.anchor,pin.size*1.5,pin.size,pose);if(!quad)return [];
  const sx=w/solution.width,sy=h/solution.height;
  const cx=point.x*sx,cy=point.y*sy,r=w*.018;
  return [{id:pin.id,title:'Text lies flat on this surface',point:[cx,cy],quad:[[cx,cy-r],[cx+r,cy],[cx,cy+r],[cx-r,cy]],plane:quad.map(p=>[p.x*sx,p.y*sy])}];
 });
}
