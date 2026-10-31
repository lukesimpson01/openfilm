import{anchorFrame}from'./spatial-geometry.js';import{motionAt}from'./motion3d.js';
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const basis=frame=>[frame.right,frame.down,frame.normal].map((v,i)=>mul(v,frame.scale?.[i]??1));
const transform=(B,p)=>B.reduce((sum,column,i)=>add(sum,mul(column,p[i])),[0,0,0]);
function inverse(B,p){const determinant=dot(B[0],cross(B[1],B[2]));if(Math.abs(determinant)<1e-9)throw Error('A parent anchor must have non-zero scale.');return [dot(p,cross(B[1],B[2])),dot(p,cross(B[2],B[0])),dot(p,cross(B[0],B[1]))].map(v=>v/determinant);}
export function parentedAnchor(anchor,parent){const B=basis(parent);return {...anchor,position:add(parent.position,transform(B,anchor.position)),right:transform(B,anchor.right),down:transform(B,anchor.down),normal:transform(B,anchor.normal)};}
export function relativeAnchor(anchor,parent){const B=basis(parent);return {...anchor,position:inverse(B,sub(anchor.position,parent.position)),right:inverse(B,anchor.right),down:inverse(B,anchor.down),normal:inverse(B,anchor.normal)};}
/** A parent may itself be a world/object anchor with motion. Cycles are invalid, not silently flattened. */
export function sceneAnchor(items,index,time,pose,objectPose,visiting=new Set()){
 const item=items[index];if(!item?.spatialAnchor)return null;if(visiting.has(index))throw Error('An anchor cannot be its own parent.');visiting.add(index);let anchor=item.spatialAnchor;
 if(anchor.type==='object'&&objectPose){anchor=objectPose(item);if(!anchor)return null;}
 if(anchor.parentId!=null){const parentIndex=items.findIndex((it,i)=>String(it.id??i)===String(anchor.parentId));if(parentIndex<0)return null;const parent=sceneAnchor(items,parentIndex,time,pose,objectPose,visiting);if(!parent)return null;anchor=parentedAnchor(anchor,anchorFrame(parent,motionAt(items[parentIndex].motion,time),pose));}
 visiting.delete(index);return anchor;
}
