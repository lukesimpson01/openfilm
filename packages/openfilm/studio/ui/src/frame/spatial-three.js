/** One COLMAP/OpenCV -> Three camera conversion for overlays, model rendering and geometry depth. */
export function setSpatialCamera(camera,solution,pose,rect=[0,0,1,1]){
 const [x,y,w,h]=rect,Rt=pose.worldToCamera,K=pose.intrinsics,near=.001,far=10000;
 camera.matrixAutoUpdate=false;camera.matrixWorldInverse.set(...Rt[0],...Rt[1].map(v=>-v),...Rt[2].map(v=>-v),0,0,0,1);camera.matrixWorld.copy(camera.matrixWorldInverse).invert();
 camera.projectionMatrix.set(2*K[0][0]/solution.width*w,0,1-2*(x+K[0][2]/solution.width*w),0,0,2*K[1][1]/solution.height*h,2*(y+K[1][2]/solution.height*h)-1,0,0,0,-(far+near)/(far-near),-2*far*near/(far-near),0,0,-1,0);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
 return {lens:pose.distortion?.[0]??0,principal:[2*(x+K[0][2]/solution.width*w)-1,1-2*(y+K[1][2]/solution.height*h)]};
}
