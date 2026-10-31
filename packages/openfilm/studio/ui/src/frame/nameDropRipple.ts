/** A live-DOM optical filter. Only the field's offset changes per frame; the modest band texture is reused. */
export type RippleOptions = { cycleMs?: number; amplitudePx?: number; bandPx?: number; curvaturePx?: number; adaptive?:boolean; sheen?:boolean;onOverload?:(elapsedMs?:number)=>void };
export function createNameDropRipple(surface: HTMLElement, options: RippleOptions = {}) {
  const config = { cycleMs: 7600, amplitudePx: 12, bandPx: 34, curvaturePx: 20, adaptive:true, ...options };
  const ns = 'http://www.w3.org/2000/svg', id = `refraction-${globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2)}`;
  const node = (tag: string, attrs: Record<string, string | number> = {}) => { const n = document.createElementNS(ns, tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,String(v)); return n; };
  // WebKit can suppress a referenced filter inside a zero-sized SVG viewport.
  const svg = node('svg', { width: 1, height: 1, 'aria-hidden':'true' });
  svg.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;pointer-events:none;overflow:visible';
  const defs=node('defs'), filter=node('filter',{id,filterUnits:'userSpaceOnUse',primitiveUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'});
  const image=node('feImage',{x:0,y:0,preserveAspectRatio:'none',result:'field'}), offset=node('feOffset',{in:'field',dx:0,dy:0,result:'wave'});
  const neutral=node('feFlood',{'flood-color':'rgb(50%,50%,50%)',result:'neutral'}), composite=node('feComposite',{in:'wave',in2:'neutral',operator:'over',result:'displacement'});
  const displace=node('feDisplacementMap',{in:'SourceGraphic',in2:'displacement',scale:64,xChannelSelector:'R',yChannelSelector:'G'});
  filter.append(image,offset,neutral,composite,displace); defs.append(filter); svg.append(defs); document.body.append(svg);
  const sheen=config.sheen?node('svg',{'aria-hidden':'true'}):null,band=node('path'),gradient=node('linearGradient',{id:`${id}-blue`,x1:0,y1:0,x2:0,y2:1,gradientUnits:'objectBoundingBox'});
  if(sheen){for(const [at,color,opacity] of [[0,'#2186ff',0],[.28,'#2186ff',.03],[.48,'#459eff',.12],[.51,'#d8eeff',.22],[.55,'#2186ff',.11],[1,'#2186ff',0]] as const)gradient.append(node('stop',{offset:at,'stop-color':color,'stop-opacity':opacity}));const d=node('defs');d.append(gradient);band.setAttribute('fill',`url(#${id}-blue)`);sheen.append(d,band);sheen.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:45;overflow:hidden';document.body.append(sheen);}
  const original=surface.style.filter, preference=matchMedia('(prefers-reduced-motion: reduce)');
  const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
  if(!ctx){svg.remove();sheen?.remove();return ()=>{};}
  let width=0,height=0,clearance=0,anchor=0,frame=0,elapsed=0,previous:number|null=null,disposed=false;
  let slow=0, samples=0, level=1;
  let mapReady=false,generation=0;
  function generate(){
    const w=Math.round(surface.clientWidth),h=Math.round(surface.clientHeight); if(!w||!h)return;
    if(w===width&&h===height)return; width=w;height=h;
    if(sheen){sheen.setAttribute('viewBox',`0 0 ${width} ${height}`);band.setAttribute('d',`M0 0 Q${width/2} 40 ${width} 0 L${width} 130 Q${width/2} 170 0 130Z`);}
    clearance=config.bandPx*4+Math.abs(config.curvaturePx)+config.amplitudePx; anchor=clearance;
    // Only a narrow band is stored; the rest of the filter field is exactly neutral.
    const bandHeight=Math.ceil(clearance*2),mw=Math.min(768,width),mh=Math.min(384,bandHeight);
    canvas.width=mw;canvas.height=mh; const pixels=ctx!.createImageData(mw,mh);
    for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
      const nx=(x+.5)/mw*2-1,dy=(y+.5)/mh*bandHeight-anchor-config.curvaturePx*(1-nx*nx),q=dy/config.bandPx;
      const env=Math.exp(-.5*q*q), bend=config.amplitudePx*env*Math.sin(q/.7),horizontal=config.amplitudePx*.18*nx*env,i=(y*mw+x)*4;
      pixels.data[i]=Math.round(127.5+horizontal/64*255);pixels.data[i+1]=Math.round(127.5+bend/64*255);pixels.data[i+2]=128;
      pixels.data[i+3]=Math.round(Math.min(1,env*8)*255);
    }
    ctx!.putImageData(pixels,0,0);const url=canvas.toDataURL('image/png'),stamp=++generation;
    image.setAttribute('width',String(width));image.setAttribute('height',String(bandHeight));
    // Decode before filtering live content: an unloaded feImage can blank the entire surface in WebKit.
    const preload=new Image();preload.onload=()=>{if(disposed||stamp!==generation)return;image.setAttribute('href',url);image.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',url);mapReady=true;running();};
    preload.onerror=()=>{if(disposed||stamp!==generation)return;level=0;surface.style.filter=original;config.onOverload?.();};preload.src=url;
    const pad=config.amplitudePx+2;filter.setAttribute('x',String(-pad));filter.setAttribute('y',String(-pad));filter.setAttribute('width',String(width+pad*2));filter.setAttribute('height',String(height+pad*2));
  }
  function render(time:number){
    if(disposed||document.hidden||preference.matches){frame=0;previous=null;return;}
    const dt=previous===null?0:Math.max(0,time-previous);previous=time;elapsed+=dt;
    if(dt>0){samples++;if(dt>26)slow++;}
    // Switch promptly when measured full-surface compositing cannot sustain smooth motion.
    if(samples>=6){if(config.adaptive&&slow/samples>.65) { level=0;surface.style.filter=original;config.onOverload?.(elapsed);if(sheen)sheen.style.display='none'; } samples=slow=0;displace.setAttribute('scale',String(64*level));}
    const p=.5-.5*Math.cos(Math.PI*2*(elapsed%config.cycleMs)/config.cycleMs);
    offset.setAttribute('dy',(-clearance+(height+clearance*2)*p-anchor).toFixed(2));
    band.setAttribute('transform',`translate(0 ${-clearance+(height+clearance*2)*p-65})`);
    if(level>0)frame=requestAnimationFrame(render);else{surface.style.filter=original;frame=0;}
  }
  function stop(){cancelAnimationFrame(frame);frame=0;previous=null;}
  function running(){stop();if(disposed)return;surface.style.filter=preference.matches||level<=0||!mapReady?original:[original,`url(#${id})`].filter(Boolean).join(' ');if(sheen)sheen.style.display=preference.matches||document.hidden||level<=0?'none':'';if(mapReady&&!preference.matches&&!document.hidden&&level>0)frame=requestAnimationFrame(render);}
  const observer=new ResizeObserver(generate);observer.observe(surface);document.addEventListener('visibilitychange',running);preference.addEventListener('change',running);generate();running();
  return ()=>{if(disposed)return;disposed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',running);preference.removeEventListener('change',running);surface.style.filter=original;svg.remove();sheen?.remove();};
}
