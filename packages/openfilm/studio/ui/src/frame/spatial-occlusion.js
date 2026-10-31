/** Shared visibility for flat assets and imported models. Native depth is meaningful only on its calibrated scale. */
export const SPATIAL_OCCLUSION_GLSL=`
uniform sampler2D uGeometryDepth;uniform sampler2D uSceneDepth;uniform sampler2D uForegroundMask;uniform sampler2D uInstanceMask;
uniform float uHasGeometry;uniform float uHasSceneDepth;uniform float uHasForeground;uniform float uHasTarget;
uniform float uOrdering;uniform float uManualDepth;uniform float uDepthRange;uniform vec4 uContent;
float spatialDepthVisibility(vec3 packed,float elementZ,float range){
 float z=(packed.r*65280.+packed.g*255.)/65535.*range,margin=max(.006,abs(elementZ)*.005);
 return mix(1.,1.-smoothstep(z+margin,z+2.*margin,elementZ),smoothstep(.5,.8,packed.b));
}
float spatialVisibility(vec2 source,float elementZ){
 if(source.x<uContent.x||source.y<uContent.y||source.x>uContent.x+uContent.z||source.y>uContent.y+uContent.w)return 0.;
 float geometry=1.;if(uHasGeometry>.5)geometry=spatialDepthVisibility(texture2D(uGeometryDepth,vec2(source.x,1.-source.y)).rgb,elementZ,100.);
 float foreground=uHasForeground>.5?texture2D(uForegroundMask,source).r:0.,target=uHasTarget>.5?texture2D(uInstanceMask,source).r:foreground;
 float visibility=1.;if(uHasSceneDepth>.5)visibility=mix(1.,spatialDepthVisibility(texture2D(uSceneDepth,source).rgb,elementZ,uDepthRange),foreground);
 if(uOrdering>.5&&uOrdering<1.5)visibility=mix(visibility,1.,target);
 else if(uOrdering>1.5&&uOrdering<2.5)visibility=mix(visibility,0.,target);
 else if(uOrdering>2.5){float margin=max(.006,uManualDepth*.005),manual=1.-smoothstep(uManualDepth+margin,uManualDepth+2.*margin,elementZ);visibility=mix(visibility,manual,target);}
 return geometry*visibility;
}`;
export function occlusionUniforms(THREE){return {uGeometryDepth:{value:null},uSceneDepth:{value:null},uForegroundMask:{value:null},uInstanceMask:{value:null},uHasGeometry:{value:0},uHasSceneDepth:{value:0},uHasForeground:{value:0},uHasTarget:{value:0},uOrdering:{value:0},uManualDepth:{value:3},uDepthRange:{value:100},uContent:{value:new THREE.Vector4(0,0,1,1)}};}
export function bindOcclusion(u,{geometry,frame,settings,range=100,content}){
 u.uGeometryDepth.value=geometry??null;u.uSceneDepth.value=frame?.depthTexture??null;u.uForegroundMask.value=frame?.unionTexture??frame?.maskTexture??null;u.uInstanceMask.value=frame?.maskTexture??null;
 u.uHasGeometry.value=geometry?1:0;u.uHasSceneDepth.value=frame?.depthTexture?1:0;u.uHasForeground.value=frame?.unionTexture||frame?.maskTexture?1:0;u.uHasTarget.value=frame?.targetSpecific||frame?.maskTexture?1:0;
 u.uOrdering.value={auto:0,front:1,behind:2,manual:3}[settings.mode]??0;u.uManualDepth.value=Math.max(.001,settings.manualDepth??3);u.uDepthRange.value=range;u.uContent.value.set(content?.x??0,content?.y??0,content?.w??1,content?.h??1);
}
