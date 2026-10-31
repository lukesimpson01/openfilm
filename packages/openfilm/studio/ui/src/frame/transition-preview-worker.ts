import {TransitionRenderer}from'./transition-gl.js';
let renderer:TransitionRenderer|null=null,canvas:OffscreenCanvas|null=null;
self.onmessage=(event:MessageEvent)=>{const {id,a,b,p,effect}=event.data;try{if(!renderer){canvas=new OffscreenCanvas(144,256);renderer=new TransitionRenderer(canvas);}renderer.render(a,b,p,{id:effect,seed:5,taps:4});const bitmap=canvas!.transferToImageBitmap();(self as unknown as {postMessage:(message:unknown,transfer:Transferable[])=>void}).postMessage({id,bitmap},[bitmap]);}catch(error){self.postMessage({id,error:String(error)});}finally{a.close();b.close();}};
