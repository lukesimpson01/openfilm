import{quaternionFromEuler,quaternionProduct}from'./motion3d.js';
/** Calibrated world projection shared by placement, preview and export. COLMAP camera axes: right/down/forward. */
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,k)=>a.map(v=>v*k);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.sqrt(dot(a,a)),unit=a=>mul(a,1/(norm(a)||1));
const mv=(R,p)=>R.map(row=>dot(row,p)),transpose=R=>R[0].map((_,i)=>R.map(row=>row[i]));
function quaternion(R){const t=R[0][0]+R[1][1]+R[2][2];let q;if(t>0){const s=Math.sqrt(t+1)*2;q=[(R[2][1]-R[1][2])/s,(R[0][2]-R[2][0])/s,(R[1][0]-R[0][1])/s,s/4];}else{let i=0;if(R[1][1]>R[i][i])i=1;if(R[2][2]>R[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+R[i][i]-R[j][j]-R[k][k])*2;q=[0,0,0,(R[k][j]-R[j][k])/s];q[i]=s/4;q[j]=(R[j][i]+R[i][j])/s;q[k]=(R[k][i]+R[i][k])/s;}return unit(q);}
function rotation(q){const[x,y,z,w]=q;return [[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];}
const split=pose=>{const R=pose.worldToCamera.map(row=>row.slice(0,3)),t=pose.worldToCamera.map(row=>row[3]);return {R,center:mul(mv(transpose(R),t),-1)};};
export function spatialPoseAt(solution,timeUs){
  const shot=solution?.shots?.find(s=>s.poses?.length&&timeUs>=s.fromUs-1000&&timeUs<=s.toUs+1000);if(!shot)return null;
  const poses=shot.poses;if(timeUs<poses[0].sourceTimeUs-1000||timeUs>poses[poses.length-1].sourceTimeUs+1000)return null;let hi=poses.findIndex(p=>p.sourceTimeUs>=timeUs);if(hi<0)hi=poses.length-1;const b=poses[hi],a=poses[Math.max(0,hi-1)];
  if(Math.abs(timeUs-b.sourceTimeUs)<1000)return {...b,shotId:shot.id};
  const gap=b.sourceTimeUs-a.sourceTimeUs;if(gap<=0||gap>400000)return null;
  const t=Math.max(0,Math.min(1,(timeUs-a.sourceTimeUs)/gap)),A=split(a),B=split(b),qa=quaternion(A.R),qb=quaternion(B.R),sign=dot(qa,qb)<0?-1:1;
  const cosine=Math.max(-1,Math.min(1,dot(qa,mul(qb,sign)))),angle=Math.acos(cosine),sine=Math.sin(angle),q=angle<.001?unit(add(mul(qa,1-t),mul(qb,t*sign))):add(mul(qa,Math.sin((1-t)*angle)/sine),mul(qb,sign*Math.sin(t*angle)/sine));
  const R=rotation(q),C=add(mul(A.center,1-t),mul(B.center,t)),T=mul(mv(R,C),-1);
  const intrinsics=a.intrinsics.map((row,i)=>row.map((v,j)=>v+(b.intrinsics[i][j]-v)*t)),distortion=(a.distortion??[0]).map((v,i)=>v+((b.distortion?.[i]??0)-v)*t);
  return {...a,shotId:shot.id,sourceTimeUs:timeUs,status:'interpolated',intrinsics,distortion,worldToCamera:R.map((r,i)=>[...r,T[i]])};
}
export function projectWorld(point,pose){
  if(!pose)return null;const q=pose.worldToCamera.map(row=>dot(row.slice(0,3),point)+row[3]);if(q[2]<=.00001)return null;
  const x=q[0]/q[2],y=q[1]/q[2],k=pose.distortion?.[0]??0,f=1+k*(x*x+y*y),K=pose.intrinsics;
  return {x:K[0][0]*x*f+K[0][2],y:K[1][1]*y*f+K[1][2],depth:q[2]};
}
export function cameraRay(pixel,pose){
  const K=pose.intrinsics,k=pose.distortion?.[0]??0,xd=(pixel[0]-K[0][2])/K[0][0],yd=(pixel[1]-K[1][2])/K[1][1];let x=xd,y=yd;
  for(let i=0;i<8;i++){const f=1+k*(x*x+y*y);x=xd/f;y=yd/f;}
  const {R,center}=split(pose);return {origin:center,direction:unit(mv(transpose(R),[x,y,1]))};
}
export function rayPlane(ray,point,normal){const denominator=dot(ray.direction,normal);if(Math.abs(denominator)<1e-7)return null;const d=dot(sub(point,ray.origin),normal)/denominator;return d>0?add(ray.origin,mul(ray.direction,d)):null;}
function inside(p,polygon){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function hull(points){const sorted=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]),turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),half=ps=>{const h=[];for(const p of ps){while(h.length>1&&turn(h[h.length-2],h[h.length-1],p)<=0)h.pop();h.push(p);}return h;};return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];}
function supportedAt(pixel,inliers){const polygon=hull(inliers.map(p=>[p.p.x,p.p.y]));return polygon.length>=3&&inside(pixel,polygon);}
/** Least-squares plane normal from the smallest covariance eigenvector (Jacobi, 3x3 only). */
export function fitPlane(points){
 if(points.length<3)return null;const center=points.reduce((a,p)=>add(a,mul(p,1/points.length)),[0,0,0]),A=Array.from({length:3},()=>[0,0,0]),V=[[1,0,0],[0,1,0],[0,0,1]];
 for(const p of points){const d=sub(p,center);for(let i=0;i<3;i++)for(let j=0;j<3;j++)A[i][j]+=d[i]*d[j];}
 for(let it=0;it<24;it++){let p=0,q=1;for(const [i,j]of[[0,2],[1,2]])if(Math.abs(A[i][j])>Math.abs(A[p][q])){p=i;q=j;}if(Math.abs(A[p][q])<1e-10)break;const angle=.5*Math.atan2(2*A[p][q],A[q][q]-A[p][p]),c=Math.cos(angle),s=Math.sin(angle);
  for(let i=0;i<3;i++){const a=A[i][p],b=A[i][q];A[i][p]=c*a-s*b;A[i][q]=s*a+c*b;const x=V[i][p],y=V[i][q];V[i][p]=c*x-s*y;V[i][q]=s*x+c*y;}
  for(let j=0;j<3;j++){const a=A[p][j],b=A[q][j];A[p][j]=c*a-s*b;A[q][j]=s*a+c*b;}
 }
 const values=[A[0][0],A[1][1],A[2][2]],indices=[0,1,2].sort((a,b)=>values[a]-values[b]);if(values[indices[1]]<1e-8)return null;return {point:center,normal:unit(V.map(row=>row[indices[0]])),error:Math.sqrt(Math.max(0,values[indices[0]])/points.length)};
}
export function surfaceAnchor(solution,timeUs,pixel,region){
  const pose=spatialPoseAt(solution,timeUs);if(!pose)throw Error('No verified camera pose at this frame. Choose a nearby solved frame.');
  const shot=solution.shots.find(s=>s.id===pose.shotId),radius=Math.max(solution.width,solution.height)*.22;
  const candidates=shot.points.flatMap(point=>{const p=projectWorld(point.xyz,pose);return p&&Math.hypot(p.x-pixel[0],p.y-pixel[1])<radius&&(!region||inside([p.x,p.y],region))?[{...point,p,distance:Math.hypot(p.x-pixel[0],p.y-pixel[1])}]:[];}).sort((a,b)=>a.distance-b.distance).slice(0,64);
  if(candidates.length<8)throw Error('This area has too little reconstructed geometry. Select a textured surface or define a plane manually.');
  const ray=cameraRay(pixel,pose),depths=candidates.map(p=>p.p.depth).sort((a,b)=>a-b),threshold=depths[depths.length>>1]*.018;let best=null,state=7;
  const random=()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296;};
  for(let i=0;i<180;i++){const a=candidates[Math.floor(random()*candidates.length)].xyz,b=candidates[Math.floor(random()*candidates.length)].xyz,c=candidates[Math.floor(random()*candidates.length)].xyz,n=cross(sub(b,a),sub(c,a));if(norm(n)<1e-7)continue;const normal=unit(n),inliers=candidates.filter(p=>Math.abs(dot(sub(p.xyz,a),normal))<threshold),point=rayPlane(ray,a,normal);if(!point||inliers.length<8||!supportedAt(pixel,inliers))continue;
    const projected=projectWorld(point,pose),weighted=inliers.reduce((sum,p)=>sum+Math.exp(-p.distance*p.distance/(2*Math.pow(Math.max(18,radius*.2),2))),0),score=weighted-Math.abs(projected.depth-depths[depths.length>>1])/Math.max(.001,threshold)*.015;if(!best||score>best.score)best={point,normal,inliers,score};}
  if(!best||best.inliers.length<8||best.inliers.length/candidates.length<.25)throw Error('The reconstructed points do not establish one reliable surface. Refine the selected area.');
  const refined=fitPlane(best.inliers.map(p=>p.xyz));if(refined){const point=rayPlane(ray,refined.point,refined.normal);if(point){best.point=point;best.normal=refined.normal;}}
  let normal=best.normal;if(dot(normal,ray.direction)>0)normal=mul(normal,-1);
  const {R}=split(pose),gravity=shot.gravity?.direction??split(shot.poses[0]).R[1],projectedDown=sub(gravity,mul(normal,dot(gravity,normal))),down=unit(norm(projectedDown)>.15?projectedDown:sub(R[2],mul(normal,dot(R[2],normal))));
  // Keep a consistent front-facing basis. A camera-axis dot product alone can
  // reverse text on a side wall: perspective also depends on its depth.
  const localDown=dot(down,R[1])<0?mul(down,-1):down,right=unit(cross(normal,localDown));
  return {type:'surface',shotId:shot.id,position:best.point,normal,right,down:localDown,rotation:[0,0,0],scale:[1,1,1],offset:[0,0,0],depthOffset:0,referenceTimeUs:timeUs,support:best.inliers.length,planeError:best.inliers.reduce((s,p)=>s+Math.abs(dot(sub(p.xyz,best.point),normal)),0)/best.inliers.length};
}
export function worldAnchor(solution,timeUs,pixel,depth){const pose=spatialPoseAt(solution,timeUs);if(!pose)throw Error('No verified camera pose at this frame.');const ray=cameraRay(pixel,pose),{R}=split(pose);return {type:'world',shotId:pose.shotId,position:add(ray.origin,mul(ray.direction,depth)),right:R[0],down:R[1],normal:mul(R[2],-1),rotation:[0,0,0],scale:[1,1,1],offset:[0,0,0],depthOffset:0,referenceTimeUs:timeUs};}
/** Evaluated world transform. Position keys use a declared coordinate space; they never change the measured camera. */
export function anchorFrame(anchor,motion,pose){
 const p=motion?.p??[0,0,0],offset=anchor.offset??[0,0,0],local=add(offset,anchor.motionSpace==='world'?[0,0,0]:p);
 let position=add(anchor.position,add(mul(anchor.right,local[0]),add(mul(anchor.down,local[1]),mul(anchor.normal,local[2]+(anchor.depthOffset??0)))));
 if(anchor.motionSpace==='world')position=add(position,p);
 const q=quaternionProduct(quaternionFromEuler(anchor.rotation??[0,0,0]),motion?.q??quaternionFromEuler(motion?.r??[0,0,0])),matrix=rotation(q),rotate=p=>mv(matrix,p);
 let basis=[anchor.right,anchor.down,anchor.normal];if(anchor.faceCamera&&anchor.type!=='surface'&&pose){const {R}=split(pose);basis=[R[0],R[1],mul(R[2],-1)];}
 const vector=p=>{const v=rotate(p);return add(mul(basis[0],v[0]),add(mul(basis[1],v[1]),mul(basis[2],v[2])));};
 return {...anchor,position,right:vector([1,0,0]),down:vector([0,1,0]),normal:vector([0,0,1]),rotation:[0,0,0],offset:[0,0,0],depthOffset:0,scale:(anchor.scale??[1,1,1]).map((v,i)=>v*(motion?.scale3?.[i]??1)*(motion?.s??1))};
}
export function anchorWorldQuad(anchor,width,height,pose,motion){
 if(!pose||pose.shotId!==anchor.shotId)return null;
 const frame=anchorFrame(anchor,motion,pose),pivot=anchor.pivot??[.5,.5,0],view=cameraRay([pose.intrinsics[0][2],pose.intrinsics[1][2]],pose).origin;
 if((anchor.sidedness??(anchor.type==='surface'&&!anchor.doubleSided?'decal':'double'))==='decal'&&dot(frame.normal,sub(view,frame.position))<=0)return null;
 return [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>add(frame.position,add(mul(frame.right,(x-pivot[0])*width*frame.scale[0]),mul(frame.down,(y-pivot[1])*height*frame.scale[1]))));
}
export function anchorQuad(anchor,width,height,pose,motion){const world=anchorWorldQuad(anchor,width,height,pose,motion);if(!world)return null;const quad=world.map(p=>projectWorld(p,pose));return quad.every(Boolean)?quad:null;}
/** The renderer receives a camera-space plane and intersects exact undistorted pixel rays with it. */
export function anchorCameraPlane(anchor,width,height,pose,motion){const world=anchorWorldQuad(anchor,width,height,pose,motion);if(!world)return null;const camera=p=>pose.worldToCamera.map(row=>dot(row.slice(0,3),p)+row[3]),q=world.map(camera);return {origin:q[0],right:sub(q[1],q[0]),down:sub(q[3],q[0])};}
/** Calibrated pose of a rigid planar object from its independently tracked plane.
 * Homography columns are metric camera-space axes, not animated screen positions.
 * A distorted/non-rigid fit is refused instead of snapping an asset to another object. */
export function objectAnchorAt(anchor,pose,trackH,referencePixels,trackSize,solveHomography){
 if(!pose||!trackH||!referencePixels)return null;
 const normalized=referencePixels.map(p=>{const r=trackH[6]*p[0]+trackH[7]*p[1]+trackH[8];if(r<=1e-7)return null;const pixel=[(trackH[0]*p[0]+trackH[1]*p[1]+trackH[2])/r/trackSize[0],(trackH[3]*p[0]+trackH[4]*p[1]+trackH[5])/r/trackSize[1]],ray=cameraRay([pixel[0]*trackSize[2],pixel[1]*trackSize[3]],pose),{R}=split(pose),d=mv(R,ray.direction);return {xy:[d[0]/d[2],d[1]/d[2]],pixel};});
 if(normalized.some(p=>!p))return null;const H=solveHomography([[0,0],[1,0],[1,1],[0,1]],normalized.map(p=>p.xy));if(!H)return null;
 const c0=[H[0],H[3],H[6]],c1=[H[1],H[4],H[7]],c2=[H[2],H[5],H[8]],factor=2/(norm(c0)+norm(c1)),right=unit(c0),down=unit(sub(c1,mul(right,dot(c1,right)))),normal=mul(unit(cross(right,down)),-1),origin=mul(c2,factor),center=add(origin,mul(add(right,down),.5)),{R,center:C}=split(pose),Rt=transpose(R),position=add(C,mv(Rt,center));
 const out={...anchor,position,right:mv(Rt,right),down:mv(Rt,down),normal:mv(Rt,normal),rotation:anchor.rotation??[0,0,0]};
 const check=anchorQuad({...out,type:'world',scale:[1,1,1],offset:[0,0,0],rotation:[0,0,0],depthOffset:0},1,1,pose);if(!check||check.some((p,i)=>Math.hypot(p.x-normalized[i].pixel[0]*trackSize[2],p.y-normalized[i].pixel[1]*trackSize[3])>2.5))return null;
 return out;
}

/** A deliberately selected mesh face or manual plane shares the same persistent surface basis as an automatic pin. */
export function anchorFromGeometry(solution,timeUs,position,normal){
 const pose=spatialPoseAt(solution,timeUs);if(!pose)throw Error('Choose a verified source frame before placing an anchor.');const {R,center}=split(pose),shot=solution.shots.find(s=>s.id===pose.shotId);normal=unit(normal);if(dot(normal,sub(center,position))<0)normal=mul(normal,-1);const gravity=shot.gravity?.direction??split(shot.poses[0]).R[1],v=sub(gravity,mul(normal,dot(gravity,normal))),down=unit(norm(v)>.15?v:sub(R[2],mul(normal,dot(R[2],normal)))),localDown=dot(down,R[1])<0?mul(down,-1):down,right=unit(cross(normal,localDown));return {type:'surface',shotId:pose.shotId,position:[...position],normal,right,down:localDown,rotation:[0,0,0],scale:[1,1,1],offset:[0,0,0],depthOffset:0,referenceTimeUs:timeUs};
}
/** Four corners are an explicit rectangular-plane constraint. Depth is a user choice, not a measured distance. */
export function manualPlaneAnchor(solution,timeUs,pixels,distance,solveHomography){
 const pose=spatialPoseAt(solution,timeUs);if(!pose)throw Error('This frame has no reliable camera pose.');if(pixels.length!==4||!Number.isFinite(distance)||distance<=.01)throw Error('Select four ordered corners and a positive relative depth.');const {R}=split(pose),rays=pixels.map(pixel=>{const ray=cameraRay(pixel,pose),q=mv(R,ray.direction);return [q[0]/q[2],q[1]/q[2]];}),H=solveHomography([[0,0],[1,0],[1,1],[0,1]],rays);if(!H)throw Error('The four corners do not establish a valid plane.');const right=unit([H[0],H[3],H[6]]),candidate=unit([H[1],H[4],H[7]]),orthogonality=Math.abs(dot(right,candidate));if(orthogonality>.22)throw Error('These corners do not fit a rectangular surface with the solved lens. Refine them or adjust the normal manually.');const down=unit(sub(candidate,mul(right,dot(candidate,right)))),normal=mv(transpose(R),mul(unit(cross(right,down)),-1)),pixel=pixels.reduce((sum,p)=>add(sum,mul(p,.25)),[0,0]),ray=cameraRay(pixel,pose),point=add(ray.origin,mul(ray.direction,distance));return {...anchorFromGeometry(solution,timeUs,point,normal),manual:true,support:4,depthSource:'user',planeConstraintError:orthogonality};
}
export function alignAnchorNormal(anchor,normal){if(norm(normal)<1e-6)throw Error('A normal needs a direction.');normal=unit(normal);let right=sub(anchor.right,mul(normal,dot(anchor.right,normal)));if(norm(right)<1e-5)right=cross(normal,anchor.down);right=unit(right);let down=unit(cross(right,normal));if(dot(down,anchor.down)<0){right=mul(right,-1);down=mul(down,-1);}return {...anchor,normal,right,down,rotation:[0,0,0],manualNormal:true};}
