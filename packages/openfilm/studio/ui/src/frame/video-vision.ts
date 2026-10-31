/** Small timestamped samples, decoded locally. Images go only through Clyra's server-owned vision provider. */
export async function inspectVideo(url: string, from: number, to: number, endpoint: string, question: string, signal: AbortSignal) {
  const v=document.createElement('video');v.muted=true;v.playsInline=true;v.crossOrigin='anonymous';v.preload='auto';
  const wait=(event:string,action:()=>void)=>new Promise<void>((ok,fail)=>{
    const clean=()=>{clearTimeout(timer);v.removeEventListener(event,done);v.removeEventListener('error',bad);signal.removeEventListener('abort',cancel);};
    const done=()=>{clean();ok();},bad=()=>{clean();fail(new Error('Could not decode the video for vision.'));},cancel=()=>{clean();fail(new DOMException('Cancelled','AbortError'));};
    const timer=setTimeout(()=>{clean();fail(new Error('Video frame decoding timed out.'));},15000);
    v.addEventListener(event,done,{once:true});v.addEventListener('error',bad,{once:true});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();else action();
  });
  try{
    await wait('loadeddata',()=>{v.src=url;});
    if(!Number.isFinite(v.duration)||v.duration<=0)throw new Error('The video has no readable duration.');
    // Some hardware decoders expose a black bootstrap frame at exactly zero; seek into actual footage.
    const end=Math.max(0,Math.min(to,v.duration-.04)),start=Math.min(Math.max(.04,from),end);
    const k=Math.min(1,768/Math.max(v.videoWidth,v.videoHeight)),c=document.createElement('canvas');c.width=Math.round(v.videoWidth*k);c.height=Math.round(v.videoHeight*k);
    const frames=[];
    for(const share of [0,.45,.9]){signal.throwIfAborted();const t=start+(end-start)*share;if(Math.abs(v.currentTime-t)>.001)await wait('seeked',()=>{v.currentTime=t;});c.getContext('2d')!.drawImage(v,0,0,c.width,c.height);frames.push({time:t,image:c.toDataURL('image/jpeg',.78)});}
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({frames,question}),signal});
    const body=await r.json();if(!r.ok)throw new Error(body.error||'Video vision is unavailable.');return body;
  }finally{v.removeAttribute('src');v.load();}
}
