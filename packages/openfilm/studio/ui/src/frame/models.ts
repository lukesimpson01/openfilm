import { ensureRuntime, readLayer, writeLayer, type FrameLayer } from './layers';
import type { DeviceObject } from './devices';
const imp=(url:string)=>import(/* @vite-ignore */url);
export async function importModelFiles(projectId:string,files:File[]){
  const directory=`assets/models/${Date.now().toString(36)}`,models:string[]=[];
  for(const file of files){const relative=file.webkitRelativePath||file.name;if(relative.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('The model folder contains an invalid path.');
    const path=`${directory}/${relative}`,r=await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`,{method:'PUT',body:file});const value=await r.json();if(!r.ok)throw new Error(value.error||'Model import failed.');if(/\.(fbx|glb|gltf)$/i.test(file.name))models.push(value.path??path);
  }
  if(!models.length)throw new Error('Choose a GLB, glTF or FBX file. Include the glTF textures and binary files in the same import.');return models;
}
export async function inspectModel(projectId:string,folder:string,path:string){
  await ensureRuntime(projectId,folder);const [runtime,THREE]=await Promise.all([imp(`${folder}frame/model-runtime.js`),imp(`${folder}frame/three.module.min.js`)]);
  const asset=await runtime.loadModelAsset(path,folder);asset.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(asset.root),size=box.getSize(new THREE.Vector3());
  let meshes=0,bones=0;asset.root.traverse((o:any)=>{if(o.isMesh)meshes++;if(o.isBone)bones++;});
  const result={clips:asset.clips.map((c:any,index:number)=>({name:c.name,index,duration:c.duration})).filter((c:any)=>c.duration>.001),aspect:Number.isFinite(size.x/size.y)?size.x/size.y:.5,meshes,bones};runtime.disposeModel(asset.root);return result;
}
export async function appendModelAnimation(projectId:string,folder:string,layerId:string,index:number,action:Record<string,any>){
  const layer=await readLayer(folder,layerId);if(!layer||!['scene3d','track'].includes(layer.kind))throw new Error('Select the existing 3D scene.');const object=layer.kind==='track'?layer.items?.[index]:layer.objects?.[index];if(!object?.model)throw new Error('Select an imported model.');
  const at=Number.isFinite(action.at)?Math.max(0,action.at):Math.max(0,...(object.animations??[]).map((a:any)=>a.at+a.duration));
  const duration=Math.max(.1,Math.min(600,Number(action.duration)||3));
  const next={...object,animations:[...(object.animations??[]),{src:action.src??object.model,clip:action.clip??0,at,duration,speed:Math.max(.1,Math.min(4,Number(action.speed)||1)),loop:action.loop!==false,inPlace:action.inPlace!==false,fade:Math.max(0,Math.min(.6,Number(action.fade)||.15))}]};
  if(layer.kind==='track'&&at>=layer.duration)throw new Error('This video has ended. Shorten an earlier action or extend the tracked footage before adding another action.');
  const changed:FrameLayer=layer.kind==='track'?{...layer,items:layer.items.map((o:any,i:number)=>i===index?{...next,animations:next.animations.map((a:any)=>({...a,duration:Math.min(a.duration,layer.duration-a.at)}))}:o)}:{...layer,duration:Math.max(layer.duration,at+duration),objects:layer.objects.map((o:DeviceObject,i:number)=>i===index?next:o)};await writeLayer(projectId,changed);return changed;
}
