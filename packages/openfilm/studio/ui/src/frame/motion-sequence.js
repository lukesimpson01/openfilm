import { motionAt, camera3dAt } from './motion3d.js';

/** Continue from the evaluated last pose, keeping all earlier keys intact. */
export function appendDeviceAction(object, action, duration = 1.2, length = 5, options = {}) {
  const keys = object.motion?.keys ?? [], start = Math.max(0, ...keys.map(k => k.t),object.sequenceEnd??0);
  // Continuing a device always appends to its sequence. The editor playhead is unrelated to this boundary.
  const at = Math.max(start,length);
  const end = at + Math.max(.2, Math.min(20, duration));
  const st = motionAt(object.motion, at, Math.max(length, at));
  const first = { t: at, p:[...st.p], r:[...st.r], s:st.s??1, o:st.o??1, lid:st.lid??object.lid??110 };
  const last = { ...first,t:end,p:[...first.p],r:[...first.r] };
  const screen = { ...(object.screen ?? {}) };
  if(action==='move') last.p = options.position ? [...options.position] : [first.p[0]+.45,first.p[1],first.p[2]];
  if(action==='turn') last.r = [first.r[0], first.r[1]+(options.turn??45), first.r[2]];
  if(action==='openLid') last.lid = 110;
  if(action==='closeLid') last.lid = 0;
  if(action==='exitLeft')last.p=[-2.5,first.p[1],first.p[2]];
  if(action==='exitRight')last.p=[2.5,first.p[1],first.p[2]];
  if(action==='flyAway'){last.p=[first.p[0],first.p[1]+.3,first.p[2]-8];last.s=.15;last.o=0;}
  if(action==='fadeOut')last.o=0;
  if(action==='reveal'){first.o=0;last.o=1;}
  if(action==='screenOn'||action==='screenOff'){
    const events=screen.events??[{t:0,on:action==='screenOff'}];
    screen.events=[...events.filter(e=>e.t<at),{t:at,on:action==='screenOn'}];
    if(action==='screenOn'){screen.startMode='action';screen.onAt=at;screen.playAt=at;if(options.src)screen.src=options.src;}
    else screen.offAt=at;
  }
  return { ...object,screen,motion:{...object.motion,introMotion:object.motion?.introMotion??object.motion,introLength:object.motion?.introLength??length,continueFrom:object.motion?.continueFrom??at,segmentEase:true,enabled:true,faceCamera:false,returnBack:false,reverse:false,loop:'none',keys:[...keys.filter(k=>k.t<at-.0001),first,last]},actions:[...(object.actions??[]),{type:action,at,duration:end-at}],sequenceEnd:end };
}

/** Evaluate the screen timeline independently of device movement, including repeated power actions. */
export function screenStateAt(screen={},time=0){
  if(!screen.events?.length)return {on:screen.startMode!=='action'&&time>=(screen.onAt??0)&&(screen.offAt==null||time<screen.offAt),playAt:screen.playAt??screen.onAt??0};
  if(screen.startMode==='start')return {on:screen.offAt==null||time<screen.offAt,playAt:0};
  let on=false,playAt=0;
  for(const event of screen.events){if(event.t>time)break;on=event.on;if(on)playAt=event.t;}
  return {on,playAt};
}

/** Intro edits keep the authored action sequence instead of silently replacing the whole device path. */
export function replaceDeviceIntro(object,motion,length){
  let next={...object,motion,actions:[],sequenceEnd:undefined};
  for(const action of object.actions??[]){
    const before=motionAt(object.motion,action.at),after=motionAt(object.motion,action.at+action.duration);
    next=appendDeviceAction(next,action.type,action.duration,Math.max(length,next.sequenceEnd??0,action.at),{position:after.p,turn:(after.r?.[1]??0)-(before.r?.[1]??0)});
  }
  if(object.screen?.startMode)next.screen={...next.screen,startMode:object.screen.startMode};
  return next;
}

export function continueCameraMotion(motion, previous, previousTime, previousLength) {
  const state=camera3dAt(previous,previousTime,previousLength),keys=motion.keys??[];
  if(!keys.length)return motion;
  const first=keys[0],p0=first.p??[0,0,5],look0=first.look??[0,0,0];
  return {...motion,keys:keys.map(k=>({...k,p:(k.p??p0).map((v,i)=>state.position[i]+v-p0[i]),look:(k.look??look0).map((v,i)=>state.target[i]+v-look0[i]),fov:state.fov+(k.fov??first.fov??35)-(first.fov??35)}))};
}
