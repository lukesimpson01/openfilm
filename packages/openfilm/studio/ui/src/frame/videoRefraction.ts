/** GPU fallback for the already available video source; no DOM screenshots or backdrop sampling. */
export type SubjectBoxes = (sourceTime: number) => [number, number, number, number][];
/** subjects: where the scan found people and objects at a moment of the video (0…1 boxes); the waves flow around them. */
export function createVideoRefraction(video: HTMLVideoElement, amplitudePx = 12,elapsedMs=0,subjects?:SubjectBoxes) {
  const canvas=document.createElement('canvas');canvas.style.cssText=video.style.cssText;canvas.style.zIndex='6';canvas.dataset.videoRefraction='';canvas.dataset.scanWaves='3';video.after(canvas);
  const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
  if(!gl){canvas.remove();return ()=>{};}
  const shader=(type:number,src:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)||'Shader failed');return s;};
  const vs=shader(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 uv;void main(){uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}');
  const fs=shader(gl.FRAGMENT_SHADER,`precision mediump float;varying vec2 uv;uniform sampler2D image;uniform vec2 size;uniform float time;uniform float strength;uniform vec4 boxes[8];uniform int boxCount;
  void main(){vec2 st=vec2(uv.x,1.-uv.y);vec2 bend=vec2(0.);float tint=0.,shine=0.;float nx=st.x*2.-1.;
    /* subjects: an oval inside each box; the water parts around it and lights its outline as a crest passes */
    float body=0.,rim=0.;vec2 push=vec2(0.);
    for(int b=0;b<8;b++){if(b>=boxCount)break;vec4 r=boxes[b];vec2 c=(r.xy+r.zw)*.5,h=max((r.zw-r.xy)*.5,vec2(.01));vec2 e=(st-c)/h;float f=length(e);body=max(body,1.-smoothstep(.82,1.04,f));float ring=exp(-pow((f-1.)/.09,2.));rim=max(rim,ring);push+=normalize(e+1e-5)*ring;}
    for(int i=0;i<3;i++){float index=float(i),phase=6.2831853*mod(time/7.6+index/3.,1.);float progress=.5-.5*cos(phase);float clearance=170.;float crest=-clearance+(size.y+2.*clearance)*progress+(20.+index*4.)*(1.-nx*nx);float d=(st.y*size.y-crest)/(32.+index*5.);float env=exp(-.5*d*d);float weight=1.-index*.2;float wake=.2*exp(-.5*pow((d-1.65)/.8,2.))*sin((d-1.65)/.6);bend+=weight*(vec2(strength*.2*nx*env,strength*(env*sin(d/.7)+wake))*(1.-body)+push*strength*.8*env);tint+=weight*env*(1.-body*.7);shine+=weight*(exp(-pow((d+.12)/.15,2.))*(1.-body)+rim*env*1.2);}
    vec2 q=clamp(st+clamp(bend,vec2(-16.),vec2(16.))/size,vec2(0.),vec2(1.));vec3 color=texture2D(image,vec2(q.x,1.-q.y)).rgb;color=mix(color,vec3(.15,.48,1.),min(.2,tint*.12));color+=vec3(.5,.75,1.)*min(.18,shine*.14);gl_FragColor=vec4(color,1.);}`);

  const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.useProgram(program);
  const buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const p=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  const size=gl.getUniformLocation(program,'size'),clock=gl.getUniformLocation(program,'time'),boxesAt=gl.getUniformLocation(program,'boxes'),boxCount=gl.getUniformLocation(program,'boxCount');
  const packed=new Float32Array(32);
  gl.uniform1f(gl.getUniformLocation(program,'strength'),Math.max(0,Math.min(14,amplitudePx)));
  const upload=document.createElement('canvas'),uploadContext=upload.getContext('2d',{alpha:false});
  const preference=matchMedia('(prefers-reduced-motion: reduce)');let raf=0,disposed=false,lastVideo=-1,elapsed=elapsedMs,previous=0;
  let quality=Math.min(1,720/Math.max(1,video.clientWidth,video.clientHeight)),samples=0,late=0,videoFrame=0,textureDirty=true;
  const decoded=()=>{textureDirty=true;if(!disposed&&video.requestVideoFrameCallback)videoFrame=video.requestVideoFrameCallback(decoded);};if(video.requestVideoFrameCallback)videoFrame=video.requestVideoFrameCallback(decoded);
  const resize=()=>{canvas.width=Math.max(1,Math.round(video.clientWidth*quality));canvas.height=Math.max(1,Math.round(video.clientHeight*quality));gl.viewport(0,0,canvas.width,canvas.height);gl.uniform2f(size,video.clientWidth,video.clientHeight);};
  const ro=new ResizeObserver(resize);ro.observe(video);resize();
  function draw(t:number){
    if(disposed)return;raf=requestAnimationFrame(draw);
    // A stable 30 FPS is still below this effect's 60 FPS goal. Count missed
    // refreshes, rather than waiting for much larger stalls before adapting.
    if(previous){const dt=Math.max(0,t-previous);elapsed+=dt;samples++;if(dt>25)late++;}
    previous=t;
    /* late frames while a scan works the main thread: draw smaller, never stop (a frozen or vanished ripple reads as a
       hang); the smallest size is cheap, and the lateness is the scan's, not this pass's */
    if(samples>=60){if(late/samples>.2&&quality>.35){quality=Math.max(.35,quality*.75);video.dataset.scanEffect=quality<=.35?'reduced':'';resize();}samples=late=0;}
    /* a video still buffering keeps its last picture under moving water rather than freezing it */
    const stamp=video.readyState<2?lastVideo:video.getVideoPlaybackQuality?.().totalVideoFrames??Math.floor(video.currentTime*30);if(video.readyState>=2&&(textureDirty||!video.requestVideoFrameCallback&&lastVideo!==stamp)){try{const k=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));const w=Math.max(2,Math.round(video.videoWidth*k)),h=Math.max(2,Math.round(video.videoHeight*k));if(upload.width!==w||upload.height!==h){upload.width=w;upload.height=h;}if(uploadContext){uploadContext.drawImage(video,0,0,w,h);gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,upload);}else gl!.texImage2D(gl!.TEXTURE_2D,0,gl!.RGBA,gl!.RGBA,gl!.UNSIGNED_BYTE,video);lastVideo=stamp;textureDirty=false;}catch{canvas.style.display='none';return;}}
    const found=subjects?.(video.currentTime)??[];const n=Math.min(8,found.length);for(let i=0;i<n;i++)packed.set(found[i],i*4);gl!.uniform4fv(boxesAt,packed);gl!.uniform1i(boxCount,n);
    gl!.uniform1f(clock,elapsed/1000);gl!.drawArrays(gl!.TRIANGLE_STRIP,0,4);
  }
  function running(){cancelAnimationFrame(raf);previous=0;const off=document.hidden||preference.matches||quality===0;canvas.style.display=off?'none':'';if(!disposed&&!off)raf=requestAnimationFrame(draw);}
  document.addEventListener('visibilitychange',running);preference.addEventListener('change',running);running();
  return()=>{disposed=true;cancelAnimationFrame(raf);if(videoFrame&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(videoFrame);document.removeEventListener('visibilitychange',running);preference.removeEventListener('change',running);ro.disconnect();gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext();canvas.remove();};
}
