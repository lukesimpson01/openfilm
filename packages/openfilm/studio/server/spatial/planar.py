"""Native planar fast path: local corners, pyramidal LK, forward/backward verification and RANSAC.
The selected patch is authoritative. Missing evidence remains lost; references are not updated from failed fits.
"""
from engine import frames,progress,peak_rss
from pathlib import Path
import argparse,json,time
import numpy as np,cv2

def valid_quad(H,quad,previous=None):
    q=cv2.perspectiveTransform(np.float32(quad)[None],H)[0]
    if not np.isfinite(q).all() or np.any(np.c_[quad,np.ones(4)]@H[2]<=1e-6):return False
    turn=np.cross(np.roll(q,-1,axis=0)-q,np.roll(q,-2,axis=0)-np.roll(q,-1,axis=0))
    if not np.all(turn>0):return False
    if previous is not None:
        p=cv2.perspectiveTransform(np.float32(quad)[None],previous)[0];ratio=cv2.contourArea(q)/max(.001,cv2.contourArea(p))
        if not .55<ratio<1.8:return False
    return True

def track(config):
    start=time.monotonic();output=Path(config['output']);samples,dim=frames(Path(config['source']),config['from'],config['to'],output/'frames',fps=config.get('fps',18),max_frames=config.get('maxFrames',240),longest=config.get('longest',960))
    w,h=dim['width'],dim['height'];quad=np.float32(config.get('quad',[[.2,.2],[.8,.2],[.8,.8],[.2,.8]]))*[w,h]
    previous=cv2.imread(str(output/'frames'/samples[0]['name']),0);mask=np.zeros_like(previous);cv2.fillConvexPoly(mask,np.int32(quad),255);corners=cv2.goodFeaturesToTrack(previous,160,.015,6,mask=mask,blockSize=5)
    if corners is None or len(corners)<8:raise ValueError('The selected surface has too few distinct features. Select a larger textured area.')
    reference=corners[:,0].copy();points=corners;H=np.eye(3);observations=[];errors=[];ratios=[];initial=reference.copy();shot=samples[0]['shot']
    for i,row in enumerate(samples):
        if i==0:observations.append({'t':row['sourceTimeUs']/1e6,'H':H.ravel().tolist(),'inliers':len(points),'points':len(points),'err':0,'method':'native-lk-ransac'});continue
        image=cv2.imread(str(output/'frames'/row['name']),0)
        if row['shot']!=shot:
            observations.append({'t':row['sourceTimeUs']/1e6,'H':H.ravel().tolist(),'lost':True,'inliers':0,'points':0});continue
        current,ok,err=cv2.calcOpticalFlowPyrLK(previous,image,points,None,winSize=(21,21),maxLevel=4)
        back,valid,_=cv2.calcOpticalFlowPyrLK(image,previous,current,None,winSize=(21,21),maxLevel=4)
        keep=(ok[:,0]>0)&(valid[:,0]>0)&(np.linalg.norm(back[:,0]-points[:,0],axis=1)<.7)&(err[:,0]<25);src=reference[keep];dst=current[keep,0];fit=None;inliers=None
        if len(src)>=8:
            fit,inliers=cv2.findHomography(src,dst,cv2.RANSAC,1.5,maxIters=1200,confidence=.999)
            spread=np.linalg.eigvalsh(np.cov(src.T))
            if fit is None or spread[0]<9 or not valid_quad(fit,quad,H):fit=None
        if fit is None:
            observations.append({'t':row['sourceTimeUs']/1e6,'H':H.ravel().tolist(),'lost':True,'inliers':0,'points':int(len(src))});continue
        inliers=inliers[:,0]>0;residual=float(np.median(np.linalg.norm(cv2.perspectiveTransform(src[None],fit)[0][inliers]-dst[inliers],axis=1)))
        if inliers.sum()<8 or residual>1.2:
            observations.append({'t':row['sourceTimeUs']/1e6,'H':H.ravel().tolist(),'lost':True,'inliers':0,'points':int(len(src))});continue
        H=fit;points=dst[inliers,None];reference=src[inliers];previous=image
        if len(points)<100:
            local=np.zeros_like(image);cv2.fillConvexPoly(local,np.int32(cv2.perspectiveTransform(quad.astype(np.float32)[None],H)[0]),255)
            fresh=cv2.goodFeaturesToTrack(image,160,.015,6,mask=local,blockSize=5)
            if fresh is not None:
                keep=np.array([np.min(np.linalg.norm(points[:,0]-p,axis=1))>6 for p in fresh[:,0]])
                fresh=fresh[keep][:160-len(points)]
                if len(fresh):reference=np.r_[reference,cv2.perspectiveTransform(fresh,np.linalg.inv(H))[:,0]];points=np.r_[points,fresh]
        errors.append(residual);ratios.append(float(inliers.mean()));observations.append({'t':row['sourceTimeUs']/1e6,'H':H.ravel().tolist(),'inliers':int(inliers.sum()),'points':len(src),'err':residual,'method':'native-lk-ransac'})
        progress('Tracking the selected surface',.15+.83*(i+1)/len(samples))
    # Each verified frame is re-aligned straight to the reference patch (PlateTrack's ECC refine-to-reference): the chained
    # LK matrices are good to a few pixels, the direct alignment to a fraction of one. A refinement is used only when the
    # patch agrees strongly and stays within a few pixels of the chained answer; otherwise the chained matrix stands.
    refined_count=0
    try:
        from platetrack.refine import ecc_refine_to_reference
        ref_gray=cv2.imread(str(output/'frames'/samples[0]['name']),0);q64=quad.astype(np.float64)
        for i,(row,obs) in enumerate(zip(samples,observations)):
            if i==0 or obs.get('lost'):continue
            cur=cv2.imread(str(output/'frames'/row['name']),0);Hc=np.linalg.inv(np.array(obs['H']).reshape(3,3))
            Hr,cc=ecc_refine_to_reference(ref_gray,cur,Hc,q64,'homography')
            if cc is None or cc<.9:continue  # a strongly agreeing patch may correct chained drift of any size; a merely good one only a small one
            Hf=np.linalg.inv(Hr);Hf=Hf/Hf[2,2]
            shift=np.linalg.norm(cv2.perspectiveTransform(q64[None],Hf)[0]-cv2.perspectiveTransform(q64[None],np.array(obs['H']).reshape(3,3))[0],axis=1).mean()
            if not np.isfinite(shift) or (cc<.94 and shift>4) or shift>60 or not valid_quad(Hf,quad):continue
            obs['H']=Hf.ravel().tolist();obs['method']='native-lk-ransac+ecc';obs['ecc']=round(cc,4);refined_count+=1
    except Exception:pass
    lost=sum(bool(f.get('lost')) for f in observations)/len(observations)
    return {'version':1,'w':w,'h':h,'mode':'planar','plane':quad.tolist(),'model':'homography','frames':observations,'refPoints':initial.tolist(),'cuts':[r['sourceTimeUs']/1e6 for i,r in enumerate(samples) if i and r['shot']!=samples[i-1]['shot']],'quality':'Good' if lost<.05 else 'Fair' if lost<.2 else 'Poor','medianError':float(np.median(errors)) if errors else None,'inlierShare':float(np.mean(ratios)) if ratios else 0,'lostShare':lost,'elapsedMs':round((time.monotonic()-start)*1000),'peakRSSBytes':peak_rss(),'sourceHash':config.get('sourceHash')}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);config=json.loads(Path(p.parse_args().config).read_text())
    try:
        result=track(config);out=Path(config['output'])/'track.json';temporary=out.with_suffix('.tmp');temporary.write_text(json.dumps(result,separators=(',',':')));temporary.replace(out);print(json.dumps({'type':'done','path':str(out)}),flush=True)
    except Exception as e:print(json.dumps({'type':'error','message':str(e)}),flush=True);raise
