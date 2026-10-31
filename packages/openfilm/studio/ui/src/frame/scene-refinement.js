import {convexPolygon} from './scene-geometry.js';

/** Separate a visible foreground wall return from a receding corridor wall. Vision supplies the topology;
 * sustained native image edges verify the corner. A blank/ambiguous image never creates another plane. */
export function refineScenePlanes(scene,gray,w,h){
  if(!scene||!/(hallway|corridor)/i.test(scene.summary))return scene;
  const front=scene.planes.find(p=>/end|far.*door/i.test(p.name));if(!front)return scene;
  const out=[];
  for(const p of scene.planes){
    const right=/right/i.test(p.name),left=/left/i.test(p.name),q=p.quad;
    if(p.kind!=='wall'||(!right&&!left)||/end|door/i.test(p.name)){out.push(p);continue;}
    const backTop=right?q[0]:q[1],backBottom=right?q[3]:q[2],outerTop=right?q[1]:q[0],outerBottom=right?q[2]:q[3];
    if(Math.abs(outerTop[0]-outerBottom[0])>.09||Math.abs(backTop[0]-outerTop[0])<.16||outerTop[1]>backTop[1]-.05||outerBottom[1]<backBottom[1]+.12){out.push(p);continue;}
    const lo=Math.min(backTop[0],outerTop[0])+.045,hi=Math.max(backTop[0],outerTop[0])-.045;
    const y0=Math.max(.02,outerTop[1]),y1=Math.min(.96,outerBottom[1]),rows=96;
    const contrast=(x,y)=>{const X=Math.round(x*w),Y=Math.round(y*h);if(X<3||X>w-4||Y<1||Y>=h-1)return 0;let score=0;for(let dx=-1;dx<=1;dx++)score=Math.max(score,Math.abs(gray[Y*w+X+dx+2]-gray[Y*w+X+dx-2]));return score;};
    let best=null;
    for(let cx=lo;cx<=hi;cx+=1/w)for(const slope of [-.045,-.0225,0,.0225,.045]){
      const hits=[];let score=0;
      for(let i=0;i<rows;i++){const y=y0+(y1-y0)*i/(rows-1),v=contrast(cx+slope*(y-.5),y);hits.push(v);score+=Math.min(35,v);}
      const supported=hits.filter(v=>v>=8).length/rows;
      if(supported>=.63&&(!best||score>best.score))best={cx,slope,hits,score};
    }
    if(!best){out.push(p);continue;}
    let begin=0,lastHit=0,gaps=0,longest=[0,0];
    for(let i=0;i<=rows+2;i++){if(i<rows&&best.hits[i]>=8){if(gaps>2)begin=i;lastHit=i;gaps=0;}else gaps++;if(gaps>2&&lastHit-begin>longest[1]-longest[0])longest=[begin,lastHit];}
    let [first,last]=longest;const middle=best.hits.slice(Math.max(first,8),64).sort((a,b)=>a-b),baseline=middle[middle.length>>1]??16;
    for(let i=Math.max(first+48,Math.floor(rows*.6));i<last-4;i++){const window=best.hits.slice(i,i+5).sort((a,b)=>a-b);if(window[2]<Math.max(8,baseline*.6)){last=i;break;}}
    if(last-first<rows*.5){out.push(p);continue;}
    const topY=y0+(y1-y0)*first/(rows-1),bottomY=y0+(y1-y0)*last/(rows-1),top=[best.cx+best.slope*(topY-.5),topY],bottom=[best.cx+best.slope*(bottomY-.5),bottomY];
    if(topY>backTop[1]-.035||bottomY<backBottom[1]+.09){out.push(p);continue;}
    const inner=right?[backTop,top,bottom,backBottom]:[top,backTop,backBottom,bottom];
    const roll=(front.quad[1][1]-front.quad[0][1])/(front.quad[1][0]-front.quad[0][0]||1);
    const outer=right?[top,[outerTop[0],topY+roll*(outerTop[0]-top[0])],[outerBottom[0],bottomY+roll*(outerBottom[0]-bottom[0])],bottom]:[[outerTop[0],topY+roll*(outerTop[0]-top[0])],top,bottom,[outerBottom[0],bottomY+roll*(outerBottom[0]-bottom[0])]];
    if(!convexPolygon(inner)||!convexPolygon(outer)||outer.flat().some(n=>n<0||n>1)){out.push(p);continue;}
    out.push({...p,name:`${right?'right':'left'} inner wall`,quad:inner,edgeVerified:true},{...p,name:`${right?'right':'left'} foreground wall face`,quad:outer,edgeVerified:true});
  }
  const floor=out.find(p=>p.kind==='floor'),points=floor?[...floor.quad,...front.quad].map(p=>[...p]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]):[];
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),lower=[],upper=[];
  for(const p of points){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of [...points].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  const interior=[...lower.slice(0,-1),...upper.slice(0,-1)];
  return {...scene,planes:out.slice(0,6),...(convexPolygon(interior)?{safePolygon:interior}:{})};
}
