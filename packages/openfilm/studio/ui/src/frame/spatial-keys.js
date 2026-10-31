/** Transform keys and action boundaries use the same timeline diamonds as ordinary properties. */
export function spatialTimes(layer){
  const times=new Set(),take=m=>{if(m?.enabled!==false)for(const k of m?.keys??[])times.add(Math.round(k.t*1000));};
  for(const item of layer.items??[]){take(item.motion);for(const action of item.animations??[]){times.add(Math.round(action.at*1000));times.add(Math.round((action.at+action.duration)*1000));}}
  take(layer.camera?.motion);for(const object of layer.objects??[]){take(object.motion);for(const a of [...(object.actions??[]),...(object.animations??[])]){times.add(Math.round(a.at*1000));times.add(Math.round((a.at+a.duration)*1000));}}
  return [...times].sort((a,b)=>a-b);
}
export function retimeSpatial(layer,from,to){
  const same=t=>Math.abs(t-from)<.0011;
  const motion=m=>{if(!m)return m;const moving=(m.keys??[]).filter(k=>same(k.t)),rest=(m.keys??[]).filter(k=>!same(k.t)&&!(to!=null&&Math.abs(k.t-to)<.0011));return {...m,...(m.introMotion?{introMotion:motion(m.introMotion),continueFrom:same(m.continueFrom)&&to!=null?to:m.continueFrom}:{}),keys:[...rest,...(to==null?[]:moving.map(k=>({...k,t:Math.max(0,to)})))].sort((a,b)=>a.t-b.t)};};
  const actions=list=>(list??[]).flatMap(a=>{const start=same(a.at)?to:a.at,end=same(a.at+a.duration)?to:a.at+a.duration;if(start==null||end==null||end-start<.001)return [];return [{...a,at:Math.max(0,start),duration:end-start}];});
  return {...layer,...(layer.items?{items:layer.items.map(item=>({...item,motion:motion(item.motion),...(item.animations?{animations:actions(item.animations)}:{})}))}:{}),...(layer.camera?{camera:{...layer.camera,motion:motion(layer.camera.motion),custom:true,shots:undefined}}:{}),...(layer.objects?{objects:layer.objects.map(o=>{
    const m=motion(o.motion),screen=o.screen?{...o.screen,events:o.screen.events?.flatMap(e=>same(e.t)?to==null?[]:[{...e,t:to}]:[e])}:o.screen;
    for(const key of ['onAt','offAt','playAt'])if(screen&&same(screen[key])){if(to==null)delete screen[key];else screen[key]=to;}
    return {...o,motion:m,screen,actions:actions(o.actions),animations:actions(o.animations),sequenceEnd:Math.max(0,...(m?.keys??[]).map(k=>k.t))};
  })}:{})};
}
