import { homography, inv3, apply, transformAt,validPlaneProjection,pinVisibilityAt } from './track-core.js';
/** Plane coordinates are shared by tracking, preview placement, and export. */
export function convexPolygon(points){if(!Array.isArray(points)||points.length<3)return false;let sign=0,area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];if(!a?.every(Number.isFinite)||!b?.every(Number.isFinite))return false;const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(Math.abs(cross)<1e-8)return false;if(sign&&Math.sign(cross)!==sign)return false;sign=Math.sign(cross);area+=a[0]*b[1]-b[0]*a[1];}return Math.abs(area)>1e-6;}
export function planeMap(quad){return quad?.length===4&&convexPolygon(quad)?homography([[0,0],[1,0],[1,1],[0,1]],quad):null;}
/** @param {any} scene @param {boolean|'auto'} [wall] @param {number[]} [point] */
export function choosePlane(scene,wall=false,point){
  const planes=(scene?.planes??[]).filter(p=>p.confidence>=.35&&convexPolygon(p.quad)&&(wall===true?p.kind==='wall':wall===false?p.kind==='floor':true));
  const area=p=>Math.abs(p.quad.reduce((s,a,i)=>{const b=p.quad[(i+1)%4];return s+a[0]*b[1]-b[0]*a[1];},0));
  // The clicked surface is authoritative. A large side wall must never steal a click on the smaller end wall.
  const containing=point?planes.filter(p=>pointInside(point,p.quad)):[];
  if(containing.length)return containing.sort((a,b)=>area(a)-area(b)||b.confidence-a.confidence)[0];
  if(wall==='auto'&&point)return null;
  return planes.sort((a,b)=>b.confidence*area(b)-a.confidence*area(a))[0];
}
export function pointInside(p,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function constrainPoint(p,polygon){
  if(!polygon?.length||pointInside(p,polygon))return [...p];let best=[...p],distance=Infinity;
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],dx=b[0]-a[0],dy=b[1]-a[1],k=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1))),q=[a[0]+dx*k,a[1]+dy*k],d=Math.hypot(p[0]-q[0],p[1]-q[1]);if(d<distance){best=q;distance=d;}}
  const center=polygon.reduce((s,q)=>[s[0]+q[0]/polygon.length,s[1]+q[1]/polygon.length],[0,0]);return best.map((n,i)=>n*.995+center[i]*.005);
}
/** @param {any} item @param {any} scene @param {number} w @param {number} h @param {boolean|'auto'} [wall] @param {any[]} [tracks] */
export function sceneItem(item,scene,w,h,wall=false,tracks=[]){
  if(!scene)return item;const chosen=choosePlane(scene,wall,[item.anchor[0]/w,item.anchor[1]/h]);
  const pinned=chosen&&chosen.kind!=='floor';
  const quad=chosen?.quad.map(p=>[p[0]*w,p[1]*h]);
  const safe=(pinned?chosen.quad:scene.safePolygon)?.map(p=>[p[0]*w,p[1]*h]);
  const anchor=quad?constrainPoint(item.anchor,quad):[...item.anchor];
  let size=item.size;
  if(!pinned&&quad&&item.text){const edges=quad.flatMap((p,i)=>{const b=quad[(i+1)%4];return (p[1]<=anchor[1]&&b[1]>anchor[1]||b[1]<=anchor[1]&&p[1]>anchor[1])?[p[0]+(b[0]-p[0])*(anchor[1]-p[1])/(b[1]-p[1])]:[];}).sort((a,b)=>a-b);if(edges.length>=2){const room=2*Math.min(anchor[0]-edges[0],edges.at(-1)-anchor[0]);size=Math.min(size,Math.max(h*.025,room*.9/Math.max(2,[...item.text].length*.5)));}}
  return {...item,size,anchor,place:pinned?'surface':'standing',planeQuad:pinned?quad:undefined,rotation:0,tiltX:0,rotationY:0,sceneDepth:item.sceneDepth??.5,sceneClip:safe,surfaceName:chosen?.name??'Scene point',autoSurface:true,track:tracks.find(p=>p.name===chosen?.name)?.track};
}
/** A small, bounded set of real plane samples. Their quads follow the actual surface perspective.
 * @returns {{id:string,title:string,point:[number,number],quad:[number,number][]}[]} */
export function surfaceCandidates(scene,w,h){
  return (scene?.planes??[]).filter(p=>p.confidence>=.45).flatMap((p,pi)=>{
    const map=planeMap(p.quad.map(q=>[q[0]*w,q[1]*h]));if(!map)return [];
    return [[.25,.3],[.5,.5],[.75,.7]].map(([u,v],i)=>({id:`surface-${pi}-${i}`,title:p.name??p.kind,point:apply(map,[u,v]),quad:[[-.055,-.04],[.055,-.04],[.055,.04],[-.055,.04]].map(([x,y])=>apply(map,[u+x,v+y]))}));
  }).slice(0,24);
}
export function referenceInScene(scene,planes,tracks,time,point,w,h,fallback){
  const options=(scene?.planes??[]).flatMap(p=>{const path=planes?.find(t=>t.name===p.name)?.track,H=path&&tracks[path]?transformAt(tracks[path],time):fallback;
    const quad=p.quad.map(q=>apply(H,[q[0]*w,q[1]*h]));if(!pointInside(point,quad))return [];
    const area=Math.abs(quad.reduce((s,a,i)=>{const b=quad[(i+1)%4];return s+a[0]*b[1]-b[0]*a[1];},0));return [{H,area}];}).sort((a,b)=>a.area-b.area);
  const inverse=inv3(options[0]?.H??fallback);return inverse?apply(inverse,point):point;
}
/** Shared by both placement panels. Unverified/behind-camera planes never become selectable guides. */
export function visibleSurfaceMarkers(scene,planes,tracks,time,w,h,fallback){
  return surfaceCandidates(scene,w,h).flatMap(s=>{
    const plane=scene.planes.find(p=>p.name===s.title),quad=plane.quad.map(p=>[p[0]*w,p[1]*h]);
    const path=planes?.find(p=>p.name===s.title)?.track,measured=path&&tracks[path],H=measured?transformAt(measured,time):fallback;
    if(path&&!measured||!validPlaneProjection(H,quad)||pinVisibilityAt(measured,time)<.95)return [];
    const point=apply(H,s.point);if(point[0]<0||point[1]<0||point[0]>w||point[1]>h)return [];
    return [{...s,point,quad:s.quad.map(p=>apply(H,p))}];
  });
}
export function projectionVisibility(H,anchor){
  const z=H[6]*anchor[0]+H[7]*anchor[1]+H[8];if(!Number.isFinite(z)||z<.03)return 0;
  const p=apply(H,anchor),x=apply(H,[anchor[0]+1,anchor[1]]),y=apply(H,[anchor[0],anchor[1]+1]);
  const scale=Math.max(Math.hypot(x[0]-p[0],x[1]-p[1]),Math.hypot(y[0]-p[0],y[1]-p[1]));
  return Math.max(0,Math.min(1,(60-scale)/20)); /* walking into a wall is a legitimate 10-30x zoom; only a near-singular projection fades */
}
export function planeTextMetrics(quad,anchor,height,aspect){
  const map=planeMap(quad),inverse=map&&inv3(map);if(!map||!inverse)return null;
  const uv=apply(inverse,anchor),x=apply(map,[uv[0]+.01,uv[1]]),y=apply(map,[uv[0],uv[1]+.01]);
  const sx=Math.hypot(x[0]-anchor[0],x[1]-anchor[1])*100,sy=Math.hypot(y[0]-anchor[0],y[1]-anchor[1])*100;
  const size=[height*aspect/Math.max(1,sx),height/Math.max(1,sy)],fit=Math.max(.01,Math.min(1,1.8*Math.min(uv[0],1-uv[0])/size[0],1.8*Math.min(uv[1],1-uv[1])/size[1]));
  return {inverse,anchor:uv,size:size.map(n=>n*fit)};
}
