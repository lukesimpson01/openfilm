/** Native work is requested only when a scan needs parallax. Cached matrices are all playback/export reads. */
export async function reconstructSpatial(projectId:string,src:string,from:number,to:number,signal:AbortSignal|undefined,progress:(share:number,message:string)=>void,content?:{x:number;y:number;w:number;h:number}){
 const base=`/api/projects/${projectId}/spatial`,status=await fetch(base+'/status',{signal}).then(r=>r.ok?r.json():null);if(!status?.native)return null;
 const response=await fetch(base+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({src,from,to,fps:6,maxFrames:120,content}),signal});const initial=await response.json();if(!response.ok)throw Error(initial.error||'Spatial reconstruction could not start.');
 const cancel=()=>{void fetch(base+'/jobs/'+initial.id,{method:'DELETE'}).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{let job=initial;for(;;){signal?.throwIfAborted();progress(job.share??0,job.stage??'Reconstructing the camera');if(job.state==='done')return job.path as string;if(['error','cancelled'].includes(job.state))throw Error(job.error||'Spatial reconstruction cancelled.');await new Promise<void>((ok,fail)=>{const done=()=>{signal?.removeEventListener('abort',abort);ok();},timer=setTimeout(done,650),abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);fail(new DOMException('Cancelled','AbortError'));};signal?.addEventListener('abort',abort,{once:true});});job=await fetch(base+'/jobs/'+initial.id,{signal}).then(r=>r.json());}}
 finally{signal?.removeEventListener('abort',cancel);}
}

export async function reconstructOcclusion(projectId:string,src:string,from:number,to:number,solution:string,instances:{box:number[]}[],signal:AbortSignal|undefined,progress:(share:number,message:string)=>void){
 const base=`/api/projects/${projectId}/spatial`,r=await fetch(base+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'occlusion',src,from,to,solution,instances,fps:8,maxFrames:240}),signal}),initial=await r.json();if(!r.ok)throw Error(initial.error||'Enhanced occlusion unavailable.');
 const cancel=()=>{void fetch(base+'/jobs/'+initial.id,{method:'DELETE'}).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});try{let job=initial;while(job.state!=='done'){signal?.throwIfAborted();if(['error','cancelled'].includes(job.state))throw Error(job.error||'Enhanced occlusion cancelled.');progress(job.share,job.stage);await new Promise(ok=>setTimeout(ok,700));job=await fetch(base+'/jobs/'+initial.id,{signal}).then(r=>r.json());}return job.path as string;}finally{signal?.removeEventListener('abort',cancel);}
}

/** A local native planar solve. Its output keeps the normal tracker contract and exact source timestamps. */
export async function reconstructPlanar(projectId:string,src:string,from:number,to:number,quad:number[][],signal?:AbortSignal,progress:(s:number,m:string)=>void=()=>{}){
 const base=`/api/projects/${projectId}/spatial`,status=await fetch(base+'/status',{signal}).then(r=>r.json());if(!status.native)throw Error(status.setup||'Native surface tracking is not installed.');
 const r=await fetch(base+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'planar',src,from,to,quad,fps:10,maxFrames:240}),signal}),initial=await r.json();if(!r.ok)throw Error(initial.error||'Surface tracking could not start.');const cancel=()=>{void fetch(base+'/jobs/'+initial.id,{method:'DELETE'}).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{let job=initial;for(;;){signal?.throwIfAborted();progress(job.share,job.stage);if(job.state==='done')return job.path as string;if(['error','cancelled'].includes(job.state))throw Error(job.error||'Surface tracking cancelled.');await new Promise(ok=>setTimeout(ok,500));job=await fetch(base+'/jobs/'+initial.id,{signal}).then(r=>r.json());}}finally{signal?.removeEventListener('abort',cancel);}
}

/** Explicit brush edits reuse the solved camera and existing instance masks. */
export async function correctSpatialMasks(projectId:string,src:string,from:number,to:number,baseOcclusion:string,corrections:unknown[],signal:AbortSignal,progress:(s:number,m:string)=>void){
 const base=`/api/projects/${projectId}/spatial`,response=await fetch(base+'/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'mask-correction',src,from,to,baseOcclusion,corrections}),signal}),initial=await response.json();if(!response.ok)throw Error(initial.error||'Mask correction could not start.');
 const cancel=()=>{void fetch(base+'/jobs/'+initial.id,{method:'DELETE'}).catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});try{let job=initial;for(;;){signal.throwIfAborted();progress(job.share??0,job.stage??'Applying mask corrections');if(job.state==='done')return job.path as string;if(['error','cancelled'].includes(job.state))throw Error(job.error||'Mask correction failed.');await new Promise(ok=>setTimeout(ok,400));job=await fetch(base+'/jobs/'+initial.id,{signal}).then(r=>r.json());}}finally{signal.removeEventListener('abort',cancel);}
}
