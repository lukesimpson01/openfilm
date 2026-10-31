/** Escalate analysis from measured difficulty. Heavy foreground work waits for an actual insertion overlap. */
/* translation: how much the footage itself shows the camera travelling (trackTranslation), so walking footage is
   recognised without a scene description. subjects: people or objects were seen, so occlusion needs real masks. */
export function planSpatialAnalysis({requested='auto',error=0,inlierShare=1,lostShare=0,motionExtent=0,sceneMotion='',translation=0,subjects=false,overlap=false,maskConfidence=1,native=true,advanced=false,availableBytes=Infinity}){
 const explicit=requested==='spatial'||requested==='advanced',translated=/walk|forward|toward|approach|translation|parallax/i.test(sceneMotion)||translation>.08,unreliable=error>1.2||inlierShare<.65||lostShare>.08;
 const spatial=requested!=='surface'&&native&&(explicit||motionExtent>.025&&(translated||unreliable));
 const memoryReady=availableBytes>=2.5*1024**3,detailed=spatial&&advanced&&memoryReady&&(requested==='advanced'||subjects||overlap&&maskConfidence<.85);
 return {geometry:spatial?'spatial':'planar',foreground:detailed?'detailed':'light',matching:unreliable&&spatial?'recover-if-textured':'native',reason:requested==='surface'?'Explicit fast surface path':explicit?'Requested calibrated geometry':spatial?'Observed motion and geometric consistency require parallax':'The measured surface fit is sufficient',limited:!memoryReady&&requested==='advanced'?'Detailed masks exceed the available memory budget':null};
}
export function trackMotionExtent(track,w,h){const center=[w/2,h/2],frames=track?.frames??[];let extent=0;for(const f of frames){if(f.lost||!f.H)continue;const H=f.H,d=H[6]*center[0]+H[7]*center[1]+H[8];if(d<=1e-6)continue;const x=(H[0]*center[0]+H[1]*center[1]+H[2])/d,y=(H[3]*center[0]+H[4]*center[1]+H[5])/d,scale=Math.sqrt(Math.abs(H[0]*H[4]-H[1]*H[3]));extent=Math.max(extent,Math.hypot((x-center[0])/w,(y-center[1])/h),Math.abs(scale-1));}return extent;}

/** How far the camera travels, read from the whole-frame track: walking toward or along things scales and skews the
 * picture (a turn on the spot mostly shifts it). The largest change of scale or perspective across the shot. */
export function trackTranslation(track,w,h){const values=[];for(const f of track?.frames??[]){if(f.lost||!f.H)continue;const H=f.H.map(v=>v/(f.H[8]||1)),scale=Math.sqrt(Math.abs(H[0]*H[4]-H[1]*H[3])),keystone=Math.abs(H[6])*w+Math.abs(H[7])*h;if(!Number.isFinite(scale)||scale<=0)continue;values.push(Math.max(Math.abs(Math.log(scale)),keystone));}
 /* the 70th percentile: a few degenerate frames (a blurred close-up) must not decide it */
 values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length*.7)]:0;}
