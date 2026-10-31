"""Optional ALIKED (BSD-3-Clause) + LightGlue (Apache-2.0) recovery.
Only a permitted runtime subset is provisioned; SuperPoint and its restricted weights are excluded.
"""
from pathlib import Path
import os,sys,time
import numpy as np,cv2

def recover(solution_points,samples,poses,image_path,workspace,progress,max_queries=6):
    home=Path(workspace)/'.cache/clyra-spatial';models=home/'torch/hub/checkpoints';runtime=home/'sources/lightglue-runtime'
    if not runtime.exists() or not all((models/name).exists() for name in ['aliked-n16.pth','aliked_lightglue_v0-1_arxiv.pth']):return poses
    try:
        import psutil
        if psutil.virtual_memory().available<2.5*1024**3:return poses
    except ImportError:pass
    known={p['name'] for p in poses};queries=[]
    for row in samples:
        if row['name'] in known:continue
        image=cv2.imread(str(image_path/row['name']),0)
        if image is not None and image.std()>8 and (cv2.Canny(image,35,90)>0).mean()>.01:queries.append(row)
    if not queries:return poses
    # Nothing neural is imported before actual unresolved, textured frames justify this tier.
    os.environ['TORCH_HOME']=str(home/'torch');sys.path.insert(0,str(runtime));import torch
    from lightglue import ALIKED,LightGlue
    torch.set_num_threads(2);device='cuda' if torch.cuda.is_available() else 'cpu';extractor=ALIKED(max_num_keypoints=768).eval().to(device);matcher=LightGlue(features='aliked',flash=device=='cuda',mp=device=='cuda').eval().to(device)
    landmarks={str(p['id']):np.array(p['xyz']) for p in solution_points};references={};initial=list(poses)
    def features(name):
        image=cv2.cvtColor(cv2.imread(str(image_path/name)),cv2.COLOR_BGR2RGB);tensor=torch.from_numpy(image).permute(2,0,1).float().to(device)/255
        with torch.inference_mode():return extractor.extract(tensor)
    for index,row in enumerate(queries[:max_queries]):
        progress('Recovering difficult frames with LightGlue',.7+.1*(index+1)/min(max_queries,len(queries)))
        query=features(row['name']);pixels=query['keypoints'][0].detach().cpu().numpy();best=None
        for reference in sorted(initial,key=lambda p:abs(p['sourceTimeUs']-row['sourceTimeUs']))[:3]:
            if reference['name'] not in references:
                f=features(reference['name']);observations=[p for p in reference.get('features',[]) if str(p['pointId']) in landmarks]
                if len(observations)<16:continue
                xy=np.array([p['xy'] for p in observations]);kp=f['keypoints'][0].detach().cpu().numpy();distance=np.linalg.norm(kp[:,None,:]-xy[None,:,:],axis=2);nearest=distance.argmin(axis=1);ids=[str(observations[i]['pointId']) if distance[j,i]<3 else None for j,i in enumerate(nearest)];references[reference['name']]=(f,ids)
                while len(references)>4:references.pop(next(iter(references)))
            f,ids=references[reference['name']]
            with torch.inference_mode():matches=matcher({'image0':f,'image1':query})['matches'][0].detach().cpu().numpy()
            pairs={}
            for i,j in matches:
                if ids[i] is not None:pairs.setdefault(ids[i],int(j))
            if len(pairs)<16:continue
            objects=np.float64([landmarks[p] for p in pairs]);target=np.float64([pixels[j] for j in pairs.values()]);K=np.array(reference['intrinsics']);dist=np.array([*(reference.get('distortion') or [0]),0,0,0],float)[:4]
            ok,r,t,ii=cv2.solvePnPRansac(objects,target,K,dist,iterationsCount=500,reprojectionError=2.5,confidence=.999,flags=cv2.SOLVEPNP_EPNP)
            if not ok or ii is None or len(ii)<16 or len(ii)/len(objects)<.4:continue
            ii=ii[:,0];r,t=cv2.solvePnPRefineLM(objects[ii],target[ii],K,dist,r,t);projected,_=cv2.projectPoints(objects[ii],r,t,K,dist);error=float(np.median(np.linalg.norm(projected[:,0]-target[ii],axis=1)));spread=np.linalg.eigvalsh(np.cov(target[ii].T));R,_=cv2.Rodrigues(r)
            if error>1.5 or spread[0]<25 or np.mean((objects[ii]@R.T+t[:,0])[:,2]>0)<.98:continue
            result={**reference,**row,'worldToCamera':np.column_stack([R,t[:,0]]).tolist(),'observations':len(ii),'reprojectionError':error,'status':'observed','method':'aliked-lightglue-pnp','features':[{'xy':target[i].tolist(),'pointId':list(pairs)[i]} for i in ii]}
            if best is None or result['observations']>best['observations']:best=result
        if best is not None:poses.append(best)
    del extractor,matcher,references
    if device=='cuda':torch.cuda.empty_cache()
    return poses
