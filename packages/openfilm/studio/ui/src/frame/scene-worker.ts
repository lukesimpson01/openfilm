/* Scene inference stays off the UI thread. One semantic pass covers all recognised foreground classes. */
export {};
let segmenter:any=null, near:any=null, mp:any=null, files:any=null;
self.onmessage=async(e:MessageEvent)=>{
  const m=e.data;
  try{
    if(m.type==='init'){
      const url=`${self.location.origin}/assets/vendor/mediapipe/vision_bundle.mjs`;
      mp=await import(/* @vite-ignore */ url);files=await mp.FilesetResolver.forVisionTasks(`${self.location.origin}/assets/vendor/mediapipe/wasm`);
      segmenter=await mp.ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:`${self.location.origin}/assets/vendor/models/deeplab_v3.tflite`,delegate:'CPU'},runningMode:'IMAGE',outputCategoryMask:false,outputConfidenceMasks:true});
      self.postMessage({type:'ready'});return;
    }
    if(m.type==='frame'){
      const bitmap=m.bitmap as ImageBitmap,c=new OffscreenCanvas(bitmap.width,bitmap.height);c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();
      const r=segmenter.segment(c), masks=r.confidenceMasks??[];
      if(!masks.length)throw new Error('The scene detector returned no masks.');
      const w=masks[0].width,h=masks[0].height,union=new Float32Array(w*h);let personShare=0;
      for(let cls=1;cls<masks.length;cls++){const p=masks[cls].getAsFloat32Array();for(let i=0;i<union.length;i++){union[i]=Math.max(union[i],p[i]);if(cls===15&&p[i]>.6)personShare++;}}
      r.close();
      if(personShare/union.length>.24){
        if(!near)near=await mp.ImageSegmenter.createFromOptions(files,{baseOptions:{modelAssetPath:`${self.location.origin}/assets/vendor/models/selfie_multiclass_256x256.tflite`,delegate:'CPU'},runningMode:'IMAGE',outputConfidenceMasks:true});
        const nr=near.segment(c),bg=nr.confidenceMasks?.[0];if(bg){const p=bg.getAsFloat32Array();for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(bg.width-1,Math.floor((x+.5)*bg.width/w)),sy=Math.min(bg.height-1,Math.floor((y+.5)*bg.height/h)),i=y*w+x;union[i]=Math.max(union[i],1-p[sy*bg.width+sx]);}}nr.close();
      }
      (self as unknown as {postMessage:(m:unknown,t:Transferable[])=>void}).postMessage({type:'mask',w,h,mask:union},[union.buffer]);
    }
  }catch(e){self.postMessage({type:'error',message:e instanceof Error?e.message:String(e)});}
};
