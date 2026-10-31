import type { Film, Op } from '@/api';
import { spans } from './lines';

export const DEVICE_ACTION_NAMES:Record<string,string>={turn:'Turn',move:'Move',hold:'Hold',screenOn:'Screen on',screenOff:'Screen off',openLid:'Open lid',closeLid:'Close lid',exitLeft:'Exit left',exitRight:'Exit right',flyAway:'Fly away',fadeOut:'Fade out',reveal:'Fade in'};

/** One shared scene, source-time slices on one track. Both the inspector and AI use this operation plan. */
export function deviceActionClips(film:Film,clipId:string,from:number,to:number,label:string){
  const track=film.tracks.findIndex(tr=>tr.clips.some(c=>c.id===clipId));
  if(track<0)throw new Error('Select the device on its timeline first.');
  const tr=film.tracks[track],selected=tr.clips.find(c=>c.id===clipId)!,src=selected.src.split('#')[0],positions=spans(tr.clips);
  const related=tr.clips.map((c,i)=>({c,pos:positions[i]})).filter(({c})=>c.src.split('#')[0]===src).sort((a,b)=>(a.c.time?.[1]??0)-(b.c.time?.[1]??0));
  const last=related.at(-1);if(last?.pos.end==null)throw new Error('The device sequence has no known end.');
  const sourceOut=last.c.time?.[1]??from,speed=last.c.speed??1,at=last.pos.end+(from-sourceOut)/speed;
  const ops:Op[]=[];
  if(sourceOut>from+.001)ops.push({op:'set',clip:last.c.id,field:'time',value:[last.c.time?.[0]??0,from]});
  const id=`${clipId.split('-action-')[0]}-action-${Date.now().toString(36)}`;
  ops.push({op:'insert',clip:{src,id,time:[from,to],attrs:{'data-frame-action':label},...(last.c.box?{box:{...last.c.box}}:{})},at,track});
  return {ops,id,at};
}
