import * as THREE from './three.module.min.js';
export async function loadModelAsset(path,base='../'){
  const url=base+path;
  if(/\.fbx$/i.test(path)){const {FBXLoader}=await import('./three-fbx-loader.js');const root=await new FBXLoader().loadAsync(url);return {root,clips:root.animations??[]};}
  if(/\.glb$|\.gltf$/i.test(path)){const {GLTFLoader}=await import('./three-gltf-loader.js');const gltf=await new GLTFLoader().loadAsync(url);return {root:gltf.scene,clips:gltf.animations??[]};}
  throw new Error('Import a GLB, glTF or FBX model.');
}
const boneName=name=>String(name).replace(/^.*\|/,'').replace(/^mixamorig[:_]?/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
function retarget(clip,root,inPlace){
  const nodes=new Map();root.traverse(node=>{const name=boneName(node.name);if(!nodes.has(name))nodes.set(name,[]);nodes.get(name).push(node);nodes.set(node.uuid,[node]);});
  const tracks=[];
  for(const source of clip.tracks){const at=source.name.lastIndexOf('.'),property=source.name.slice(at+1),raw=source.name.slice(0,at).replace(/^.*\[([^\]]+)\]$/,'$1').split('/').at(-1),targets=nodes.get(boneName(raw))??nodes.get(raw);if(!targets)continue;
    // FBX clothing meshes can each own a same-named copy of the skeleton.
    for(const node of targets){
    const track=source.clone();track.name=`${node.uuid}.${property}`;
    if(property==='position'&&track.values.length>=3){const initial=Array.from(track.values.slice(0,3)),target=[node.position.x,node.position.y,node.position.z],hips=/hips|pelvis/i.test(raw),ratio=hips&&Math.abs(initial[1])>.001?Math.abs(target[1]/initial[1]):1;for(let i=0;i<track.values.length;i++){const axis=i%3;track.values[i]=hips&&inPlace&&axis!==1?target[axis]:target[axis]+(track.values[i]-initial[axis])*ratio;}}
    tracks.push(track);
    }
  }
  if(!tracks.length)throw new Error(`Animation “${clip.name}” has no matching bones in this model.`);
  return new THREE.AnimationClip(clip.name,clip.duration,tracks);
}
export async function createModel(spec,base='../'){
  const asset=await loadModelAsset(spec.model,base),root=asset.root,group=new THREE.Group();group.add(root);
  root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=(spec.height??1.8)/Math.max(.001,size.y);
  root.scale.multiplyScalar(scale);root.position.sub(center.multiplyScalar(scale));
  const sources=new Map([[spec.model,asset]]);for(const action of spec.animations??[])if(action.src&&!sources.has(action.src))sources.set(action.src,await loadModelAsset(action.src,base));
  const mixer=new THREE.AnimationMixer(root),prepared=[];
  for(const schedule of spec.animations??[]){const source=sources.get(schedule.src??spec.model),clip=typeof schedule.clip==='number'?source.clips[schedule.clip]:source.clips.find(c=>c.name===schedule.clip)??source.clips[0];if(!clip)throw new Error('The animation file contains no playable clips.');const fitted=retarget(clip,root,schedule.inPlace!==false),action=mixer.clipAction(fitted);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.paused=true;prepared.push({schedule,clip:fitted,action});}
  for(const [path,source] of sources)if(path!==spec.model)disposeModel(source.root);
  group.userData={size:[size.x*scale,size.y*scale],modelRoot:root,mixer,prepared,clips:asset.clips.map((c,index)=>({index,name:c.name,duration:c.duration})),animate(time,liveSpec=spec){
    for(const item of prepared){item.action.enabled=false;item.action.setEffectiveWeight(0);}
    const schedules=liveSpec.animations??[];let active=0;
    for(let i=0;i<prepared.length;i++){const item=prepared[i],s=schedules[i]??item.schedule,fade=Math.max(0,Math.min(.6,s.fade??.15)),end=s.at+s.duration,next=schedules[i+1],last=i===prepared.length-1;
      if(time<s.at||!last&&time>end+fade)continue;const local=Math.max(0,Math.min(s.duration,time-s.at))*(s.speed??1),duration=item.clip.duration,phase=s.loop===false?Math.min(duration-.00001,local):local%Math.max(.001,duration);
      const incoming=i===0||fade===0?1:Math.min(1,(time-s.at)/fade),outgoing=next&&time>=end?Math.max(0,1-(time-end)/Math.max(.001,fade)):1;
      item.action.enabled=true;item.action.time=phase;item.action.setEffectiveWeight(incoming*outgoing);active++;}
    if(!active){const item=[...prepared].reverse().find(p=>p.schedule.at<=time);if(item){item.action.enabled=true;item.action.time=Math.min(item.clip.duration-.00001,item.schedule.duration*(item.schedule.speed??1));item.action.setEffectiveWeight(1);}}
    mixer.update(0);root.updateMatrixWorld(true);
  }};
  return group;
}
export function disposeModel(root){root?.traverse(o=>{o.geometry?.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])if(material){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}});}
