/** One native reconstruction at a time. Source bytes and solver version identify the persistent cache. */
import{totalmem,freemem}from'node:os';
import{execFileSync}from'node:child_process';
/* macOS counts file cache and inactive pages as used, so freemem() reads far lower than what can really be had; vm_stat's
   free, inactive, speculative and purgeable pages are what the system hands out on demand. */
const availableMemory=()=>{if(process.platform!=='darwin')return freemem();try{const out=execFileSync('vm_stat',{encoding:'utf8',timeout:1000}),page=Number(/page size of (\d+)/.exec(out)?.[1]??4096),pages=name=>Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(out)?.[1]??0);return (pages('free')+pages('inactive')+pages('speculative')+pages('purgeable'))*page;}catch{return freemem();}};
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,stat}from'node:fs/promises';
import {existsSync,createReadStream,readFileSync as requireRead}from'node:fs';
import {createHash}from'node:crypto';
import {resolve,join,dirname}from'node:path';
import {fileURLToPath}from'node:url';
import {readable}from'./files.mjs';
const here=dirname(fileURLToPath(import.meta.url)),workspace=resolve(here,'../../../../../../..');
const runtimeHome=()=>process.env.CLYRA_SPATIAL_HOME||workspace;
const python=()=>process.env.CLYRA_SPATIAL_PYTHON||join(runtimeHome(),'.venv-spatial',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const jobs=new Map();let queue=Promise.resolve();
export const spatialStatus=()=>{
  let manifest=null;try{manifest=JSON.parse(requireRead(join(runtimeHome(),'.cache/clyra-spatial/installed.json')));}catch{}
  const native=existsSync(python())&&manifest?.native===true,advanced=native&&manifest?.advanced===true&&['sam2.1_hiera_tiny.pt','video_depth_anything_vits.pth'].every(file=>existsSync(join(runtimeHome(),'.cache/clyra-spatial/models',file)));
  return {native,advanced,matching:manifest?.matching===true,totalBytes:totalmem(),availableBytes:availableMemory(),engine:'COLMAP / OpenCV',versions:manifest?.versions,setup:'Run python3 tools/setup-shorts-spatial.py once. Add --advanced for optional foreground and depth analysis.'};
};
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const fingerprints=new Map();
export async function sourceFingerprint(root,src){const file=readable(resolve(root),String(src)),info=await stat(file),key=[file,info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');let hash=fingerprints.get(key);if(!hash){hash=await digest(file);fingerprints.set(key,hash);while(fingerprints.size>128)fingerprints.delete(fingerprints.keys().next().value);}return {hash,size:info.size,modified:info.mtimeMs};}
function validResult(root,path,kind){try{const data=JSON.parse(requireRead(join(root,path),'utf8'));return kind==='camera'?data.shots?.some(shot=>shot.poses?.length):Array.isArray(data.frames)&&data.frames.length>0;}catch{return false;}}

export async function startSpatialJob(root,request){
  root=resolve(root);if(!spatialStatus().native)throw new Error('Native spatial analysis is not installed. Run tools/setup-shorts-spatial.py.');
  const source=readable(root,String(request.src)),from=Number(request.from),to=Number(request.to);
  if(!/\.(mov|mp4|m4v|webm|mkv)$/i.test(source)||!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to-from>600)throw new Error('Select a video range between 0 and 10 minutes.');
  const kind=['occlusion','planar','mask-correction','refine-track','faces'].includes(request.kind)?request.kind:'camera';
  if(kind==='occlusion'&&!spatialStatus().advanced)throw new Error('Detailed foreground analysis is not installed. Run tools/setup-shorts-spatial.py --advanced.');
  const instances=kind==='occlusion'?(Array.isArray(request.instances)?request.instances:[]).slice(0,6).map((p,i)=>({id:i+1,box:Array.isArray(p.box)?p.box.map(v=>Math.max(0,Math.min(1,Number(v)))):[]})):[];
  if(kind==='occlusion'&&(!instances.length||instances.some(p=>p.box.length!==4||!p.box.every(Number.isFinite)||p.box[2]<=p.box[0]||p.box[3]<=p.box[1])))throw new Error('Enhanced occlusion needs verified instance selections.');
  const baseOcclusion=kind==='mask-correction'?readable(root,String(request.baseOcclusion)):null,corrections=kind==='mask-correction'?request.corrections:undefined;if(baseOcclusion&&(!String(request.baseOcclusion).startsWith('assets/')||!Array.isArray(corrections)||corrections.length>200||corrections.some(c=>!['x','y','r','from','to'].every(k=>Number.isFinite(c[k]))||c.x<0||c.x>1||c.y<0||c.y>1||c.r<=0||c.r>.5||c.to<c.from)))throw new Error('Invalid mask correction.');
  const solution=kind==='occlusion'&&typeof request.solution==='string'?readable(root,request.solution):null;
  if(solution&&!request.solution.startsWith('assets/spatial/'))throw new Error('Select a reconstruction from this project.');
  const quad=kind==='planar'||kind==='refine-track'?(request.quad??[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]):undefined;if(quad&&(!Array.isArray(quad)||quad.length!==4||quad.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v)||v<0||v>1))))throw new Error('Choose four valid corners on the source image.');
  const content=request.content;if(content&&(!['x','y','w','h'].every(k=>Number.isFinite(content[k]))||content.x<0||content.y<0||content.w<=0||content.h<=0||content.x+content.w>1.001||content.y+content.h>1.001))throw new Error('Invalid source content bounds.');
  const refine=kind==='refine-track'?{trackW:Number(request.trackW),trackH:Number(request.trackH),times:request.times,H:request.H,lost:request.lost,refIndex:Number(request.refIndex)||0}:null;
  if(refine&&(!(refine.trackW>0&&refine.trackH>0)||!Array.isArray(refine.times)||refine.times.length<2||refine.times.length>1500||!Array.isArray(refine.H)||refine.H.length!==refine.times.length||refine.H.some(h=>!Array.isArray(h)||h.length!==9||h.some(v=>!Number.isFinite(v)))||refine.times.some(t=>!Number.isFinite(t))||!(refine.refIndex>=0&&refine.refIndex<refine.times.length)))throw new Error('A track to refine needs matching times and matrices.');
  const sourceHash=(await sourceFingerprint(root,request.src)).hash,params={from,to,...(baseOcclusion?{baseOcclusionHash:await digest(baseOcclusion),corrections}:{}),...(content?{content}:{}),fps:Math.max(2,Math.min(10,Number(request.fps)||6)),...(quad?{quad}:{}),...(refine?refine:{}),maxFrames:Math.max(12,Math.min(240,Number(request.maxFrames)||120)),longest:960,...(kind==='occlusion'?{instances,nativeResolution:request.nativeResolution===true,solution:request.solution,solutionHash:solution?await digest(solution):null}:{} )};
  const id=createHash('sha256').update(JSON.stringify(['spatial-v7',spatialStatus().versions,kind,sourceHash,params])).digest('hex').slice(0,24),key=root+':'+id,path=`assets/spatial/${id}/${kind==='occlusion'||kind==='mask-correction'?'occlusion':kind==='planar'||kind==='refine-track'?'track':kind==='faces'?'faces':'solution'}.json`,output=join(root,'assets','spatial',id);
  if(validResult(root,path,kind))return {id,state:'done',share:1,path,cached:true};
  if(jobs.has(key)&&!['cancelled','error'].includes(jobs.get(key).state))return snapshot(jobs.get(key));
  for(const [old,job] of jobs)if(job.finishedAt&&Date.now()-job.finishedAt>3600000)jobs.delete(old);
  if(jobs.size>256)for(const [old,job] of jobs)if(['done','cancelled','error'].includes(job.state))jobs.delete(old);
  await mkdir(output,{recursive:true});const config=join(output,'request.json');await writeFile(config,JSON.stringify({...params,source,sourceHash,output,workspace:runtimeHome(),solution,baseOcclusion,corrections,memoryBudgetBytes:Math.min(3*1024**3,totalmem()*.35)}));
  const job={id,root,path,state:'queued',share:0,stage:'Waiting for native analysis',cancelled:false};jobs.set(key,job);
  const run=queue.catch(()=>{}).then(async()=>{if(job.cancelled)return;job.state='running';await new Promise(done=>{
    const child=spawn(python(),['-u',join(here,'spatial',kind==='mask-correction'?'mask_corrections.py':kind==='occlusion'?'occlusion.py':kind==='planar'?'planar.py':kind==='refine-track'?'refine_track.py':kind==='faces'?'faces.py':'engine.py'),'--config',config],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,OMP_NUM_THREADS:'2',OPENBLAS_NUM_THREADS:'2'}});job.child=child;let pending='',diagnostics='';
    const timer=setTimeout(()=>{job.error='Native reconstruction exceeded its 15 minute budget.';child.kill();},900000);
    child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){try{const message=JSON.parse(line);if(message.type==='progress'){job.stage=message.stage;job.share=message.share;}if(message.type==='error')job.error=message.message;}catch{}}});
    child.stderr.on('data',chunk=>diagnostics=(diagnostics+chunk).slice(-4000));
    child.once('error',error=>{job.error=error.message;job.state='error';clearTimeout(timer);done();});
    child.once('exit',code=>{clearTimeout(timer);job.child=null;if(job.cancelled){job.state='cancelled';}else if(code===0&&validResult(root,path,kind)){job.state='done';job.share=1;job.stage=kind==='faces'?'Faces found':kind==='occlusion'?'Foreground analysis ready':kind==='mask-correction'?'Mask corrections ready':'Camera reconstruction ready';}else{job.state='error';job.error=job.error||'The camera could not be reconstructed reliably.';}job.finishedAt=Date.now();done();});
  });});queue=run;run.catch(e=>{job.state='error';job.error=e.message;});return snapshot(job);
}
function snapshot(job){return {id:job.id,state:job.state,share:job.share,stage:job.stage,path:job.state==='done'?job.path:undefined,error:job.error};}
export function spatialJob(root,id,cancel=false){
  if(!/^[a-f0-9]{24}$/.test(id))throw new Error('Invalid spatial job.');
  const job=jobs.get(resolve(root)+':'+id);if(!job){for(const file of ['solution.json','occlusion.json','track.json','faces.json']){const path=`assets/spatial/${id}/${file}`;if(validResult(root,path,file==='solution.json'?'camera':file==='track.json'?'planar':'occlusion'))return {id,state:'done',share:1,path,cached:true};}throw new Error('Spatial job not found.');}
  if(cancel){job.cancelled=true;job.child?.kill();if(job.state==='queued')job.state='cancelled';}
  return snapshot(job);
}
