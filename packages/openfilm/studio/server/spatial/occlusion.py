"""Optional SAM 2 instance propagation and Video Depth Anything Small, in a bounded native process.
No network calls, per-frame file persistence, explicit relative-depth calibration confidence.
"""
import os,sys,json,time,argparse,shutil
from pathlib import Path
import numpy as np,cv2,torch
from engine import frames,progress,peak_rss,watch_memory
# SAM 2 on a laptop CPU is bound by its image encoder: use the physical cores (capped), not two.
cv2.setNumThreads(2);torch.set_num_threads(max(2,min(6,(os.cpu_count() or 4)//2)))

def guided_alpha(mask,image):
    guide=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY).astype(np.float32)/255.;p=mask.astype(np.float32)
    mean=lambda x:cv2.boxFilter(x,-1,(5,5),normalize=True)
    I=mean(guide);P=mean(p);a=(mean(guide*p)-I*P)/(mean(guide*guide)-I*I+.0004);b=P-a*I
    return np.clip(mean(a)*guide+mean(b),0,1)

def calibrated_depth(prediction,solution,timestamp):
    if not solution:return None
    candidates=[p for s in solution['shots'] for p in s.get('poses',[]) if abs(p['sourceTimeUs']-timestamp)<160000]
    if not candidates:return None
    pose=min(candidates,key=lambda p:abs(p['sourceTimeUs']-timestamp));shot=next(s for s in solution['shots'] if pose in s.get('poses',[]));M=np.array(pose['worldToCamera']);K=np.array(pose['intrinsics']);values=[];targets=[]
    h,w=prediction.shape
    for point in shot['points']:
        q=M[:,:3]@np.array(point['xyz'])+M[:,3]
        if q[2]<=0:continue
        x,y=q[:2]/q[2];f=1+(pose.get('distortion') or [0])[0]*(x*x+y*y);px=(K[0,0]*x*f+K[0,2])/solution['width']*w;py=(K[1,1]*y*f+K[1,2])/solution['height']*h
        if 2<=px<w-2 and 2<=py<h-2:values.append(float(prediction[int(py),int(px)]));targets.append(1/q[2])
    if len(values)<24:return None
    A=np.column_stack([values,np.ones(len(values))]);b=np.array(targets);keep=np.ones(len(b),bool)
    for _ in range(4):
        fit=np.linalg.lstsq(A[keep],b[keep],rcond=None)[0];error=np.abs(A@fit-b);threshold=max(.0001,float(np.median(error[keep]))*2.5);keep=error<threshold
        if keep.sum()<20:return None
    a,offset=fit;relative=float(np.median(error[keep]/np.maximum(1e-6,b[keep])));spread=float(np.std(b[keep])/np.mean(b[keep]))
    if a<=0 or relative>.3 or spread<.08:return None
    return {'scale':float(a),'offset':float(offset),'relativeError':relative,'support':int(keep.sum()),'confidence':float(max(0,1-relative*2))}

def refine_frames(config,record,output):
    """Bidirectional, source-timestamped mask propagation between actual SAM observations.
    Flow is bounded to 640 pixels; alpha is refined against the full output image, independently for each instance.
    """
    keys=sorted(record);source=Path(config['source'])
    # Decode true presentation timestamps. Limit disk usage before native-resolution decode begins.
    probe=cv2.imread(str(output/'frames'/record[keys[0]]['name']));pixels=probe.shape[0]*probe.shape[1];del probe
    capacity=max(4,min(900,int(max(0,shutil.disk_usage(output).free-512*1024**2)/max(1,pixels*.8))))
    if capacity<8:raise ValueError('Not enough free space for foreground refinement. Free disk space or use a shorter interval.')
    rows,dim=frames(source,config['from'],config['to'],output/'render-frames',fps=None,max_frames=capacity,longest=4096 if config.get('nativeResolution') else 1280,progress_from=.98,progress_span=.01)
    dim['refinementLimitFrames']=capacity;dim['refinedThroughUs']=rows[-1]['sourceTimeUs'];dim['sourceCadence']=True
    # Include exact segmentation timestamps; VFR keys need not land on an arbitrary output cadence.
    by_time={r['sourceTimeUs']:r for r in rows}
    for t,entry in record.items():
        if t not in by_time:
            name='key-'+entry['name'];target=output/'render-frames'/name
            if not target.exists():os.link(output/'frames'/entry['name'],target)
            by_time[t]={**entry,'name':name}
    rows=sorted(by_time.values(),key=lambda r:r['sourceTimeUs']);result={};mask_dir=output/'masks';depth_dir=output/'depth';warps={}
    def image(row):return cv2.imread(str(output/'render-frames'/row['name']))
    def grey(frame):
        h,w=frame.shape[:2];return cv2.cvtColor(cv2.resize(frame,(round(w*min(1,640/max(h,w))),round(h*min(1,640/max(h,w))))),cv2.COLOR_BGR2GRAY)
    flow=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    def warp(mask,current,previous):
        a,b=grey(current),grey(previous);back=flow.calc(a,b,None);forward=flow.calc(b,a,None);h,w=a.shape;X,Y=np.meshgrid(np.arange(w,dtype=np.float32),np.arange(h,dtype=np.float32));mapx=X+back[:,:,0];mapy=Y+back[:,:,1];fb=cv2.remap(forward,mapx,mapy,cv2.INTER_LINEAR);reliable=np.linalg.norm(back+fb,axis=2)<1.25
        H,W=mask.shape[:2];field=cv2.resize(back,(W,H));field[:,:,0]*=W/w;field[:,:,1]*=H/h;XX,YY=np.meshgrid(np.arange(W,dtype=np.float32),np.arange(H,dtype=np.float32));value=cv2.remap(mask,XX+field[:,:,0],YY+field[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT);confidence=cv2.resize(reliable.astype(np.float32),(W,H));return value,confidence
    def alpha(entry):return {p['id']:cv2.imread(str(output/p['path']),0).astype(np.float32)/255 for p in entry['instances']}
    def depth(entry):
        if not entry.get('depth'):return None
        rgb=cv2.cvtColor(cv2.imread(str(output/entry['depth'])),cv2.COLOR_BGR2RGB);return (rgb[:,:,0].astype(np.uint16)*256+rgb[:,:,1]).astype(np.float32)/65535*100
    for ka,kb in zip(keys,keys[1:]):
        interval=[r for r in rows if ka<=r['sourceTimeUs']<=kb]
        if not interval or record[ka]['shot']!=record[kb]['shot']:continue
        # Persist one directional pass; only one frame and its instance maps are retained in RAM.
        scratch=output/'flow-scratch';scratch.mkdir(exist_ok=True)
        previous=image(interval[0]);masks=alpha(record[ka]);d=depth(record[ka])
        for row in interval:
            current=image(row);conf={}
            if row is not interval[0]:
                for identifier,value in masks.items():masks[identifier],conf[identifier]=warp(value,current,previous)
                if d is not None:d,_=warp(d,current,previous)
            arrays={}
            for identifier,value in masks.items():
                arrays['m'+str(identifier)]=value.astype(np.float16);arrays['c'+str(identifier)]=conf.get(identifier,np.ones_like(value)).astype(np.float16)
            if d is not None:arrays['d']=d.astype(np.float16)
            np.savez_compressed(scratch/str(row['sourceTimeUs']),**arrays);previous=current
        previous=image(interval[-1]);bm=alpha(record[kb]);bd=depth(record[kb])
        for row in reversed(interval):
            t=row['sourceTimeUs'];current=image(row);bc={}
            if row is not interval[-1]:
                for identifier,value in bm.items():bm[identifier],bc[identifier]=warp(value,current,previous)
                if bd is not None:bd,_=warp(bd,current,previous)
            previous=current;file=scratch/(str(t)+'.npz')
            if t in record:result[t]=record[t];file.unlink(missing_ok=True);continue
            u=(t-ka)/max(1,kb-ka);entries=[];union=np.zeros(current.shape[:2],np.float32);qualities=[]
            with np.load(file) as saved:
                for identifier in bm:
                    if 'm'+str(identifier) not in saved:continue
                    fm=saved['m'+str(identifier)].astype(np.float32);c0=saved['c'+str(identifier)].astype(np.float32);c1=bc.get(identifier,np.ones_like(bm[identifier]));weight0=(1-u)*c0;weight1=u*c1;denominator=weight0+weight1;mask=np.divide(fm*weight0+bm[identifier]*weight1,denominator,out=np.zeros_like(denominator),where=denominator>.01);mask=guided_alpha(mask,current);region=mask>.5;confidence=float(np.mean(np.maximum(c0,c1)[region])) if region.any() else 0;qualities.append(confidence);union=np.maximum(union,mask);name=f'{t}-{identifier}.png';cv2.imwrite(str(mask_dir/name),np.round(mask*255).astype(np.uint8));entries.append({'id':identifier,'path':'masks/'+name,'confidence':confidence,'area':float(region.mean())})
                name=f'{t}-union.png';cv2.imwrite(str(mask_dir/name),np.round(union*255).astype(np.uint8));entry={**row,'mask':'masks/'+name,'instances':entries,'status':'propagated','confidence':min(qualities) if qualities else 0}
                if 'd' in saved and bd is not None:
                    fd=saved['d'].astype(np.float32);combined=1/((1-u)/np.maximum(.001,fd)+u/np.maximum(.001,bd));valid=(fd>0)&(fd<100)&(bd>0)&(bd<100)&np.isfinite(combined);packed=np.round(np.clip(combined/100,0,1)*65535).astype(np.uint16);rgb=np.dstack([(packed>>8).astype(np.uint8),(packed&255).astype(np.uint8),(valid*round(min(qualities or [0])*230)).astype(np.uint8)]);name=str(t)+'.png';cv2.imwrite(str(depth_dir/name),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR));entry['depth']='depth/'+name
            result[t]=entry;file.unlink(missing_ok=True)
        scratch.rmdir()
    # A short final interval has no future SAM observation. Verify forward/backward flow before retaining its mask.
    previous=image(by_time[keys[-1]]);masks=alpha(record[keys[-1]]);d=depth(record[keys[-1]])
    for row in [r for r in rows if r['sourceTimeUs']>keys[-1]]:
        if row['shot']!=record[keys[-1]]['shot']:break
        current=image(row);union=np.zeros(current.shape[:2],np.float32);entries=[];qualities=[];t=row['sourceTimeUs']
        for identifier,value in masks.items():
            value,confidence=warp(value,current,previous);value=guided_alpha(value,current);region=value>.5;quality=float(confidence[region].mean()) if region.any() else 0;masks[identifier]=value;union=np.maximum(union,value);name=f'{t}-{identifier}.png';cv2.imwrite(str(mask_dir/name),np.round(value*255).astype(np.uint8));qualities.append(quality);entries.append({'id':identifier,'path':'masks/'+name,'confidence':quality,'area':float(region.mean())})
        name=f'{t}-union.png';cv2.imwrite(str(mask_dir/name),np.round(union*255).astype(np.uint8));result[t]={**row,'mask':'masks/'+name,'instances':entries,'status':'propagated','confidence':min(qualities) if qualities else 0};previous=current
    for t,entry in record.items():result[t]={**entry,'status':'observed'}
    return result,dim


def analyse(config):
    start=time.monotonic();output=Path(config['output']);output.mkdir(parents=True,exist_ok=True);workspace=Path(config['workspace']);models=workspace/'.cache/clyra-spatial/models'
    samples,dimensions=frames(Path(config['source']),config['from'],config['to'],output/'frames',fps=min(config.get('fps',8),config.get('maxFrames',240)/max(.001,config['to']-config['from'])),max_frames=config.get('maxFrames',240),longest=4096 if config.get('nativeResolution') else 1280)
    from sam2.build_sam import build_sam2_video_predictor
    device='cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
    predictor=build_sam2_video_predictor('configs/sam2.1/sam2.1_hiera_t.yaml',str(models/'sam2.1_hiera_tiny.pt'),device=device,apply_postprocessing=False)
    seeds=config.get('instances',[])
    if not seeds:raise ValueError('A real selected instance or verified detection is required to initialise SAM 2.')
    mask_dir=output/'masks';mask_dir.mkdir(exist_ok=True);last={};record={};window=4 if config.get('nativeResolution') else 12
    samples=[row for row in samples if row['shot']==samples[0]['shot']]
    for base in range(0,len(samples),window-1):
        rows=samples[base:base+window]
        if len(rows)<2 and base:break
        chunk=output/'window';chunk.mkdir(exist_ok=True)
        for old in chunk.glob('*.jpg'):old.unlink()
        for i,row in enumerate(rows):os.link(output/'frames'/row['name'],chunk/f'{i:06d}.jpg')
        state=predictor.init_state(str(chunk),offload_video_to_cpu=True,offload_state_to_cpu=True)
        for instance in seeds:
            identifier=int(instance['id'])
            if identifier in last:predictor.add_new_mask(state,frame_idx=0,obj_id=identifier,mask=last[identifier])
            else:
                box=np.array(instance['box'],dtype=np.float32)*np.array([dimensions['width'],dimensions['height']]*2)
                predictor.add_new_points_or_box(state,frame_idx=0,obj_id=identifier,box=box)
        for index,ids,logits in predictor.propagate_in_video(state):
            row=rows[index];image=cv2.imread(str(output/'frames'/row['name']));entries=[];union=np.zeros(image.shape[:2],dtype=np.float32)
            for n,identifier in enumerate(ids):
                score=logits[n,0].float().cpu().numpy();probability=1/(1+np.exp(-np.clip(score,-20,20)));alpha=guided_alpha(probability,image)
                last[int(identifier)]=alpha>.5;union=np.maximum(union,alpha)
                filename=f"{row['sourceTimeUs']}-{identifier}.png";cv2.imwrite(str(mask_dir/filename),np.round(alpha*255).astype(np.uint8));entries.append({'id':int(identifier),'path':'masks/'+filename,'area':float((alpha>.5).mean()),'confidence':float(np.mean(np.abs(probability-.5))*2)})
            union_file=f"{row['sourceTimeUs']}-union.png";cv2.imwrite(str(mask_dir/union_file),np.round(union*255).astype(np.uint8));record[row['sourceTimeUs']]={**row,'instances':entries,'mask':'masks/'+union_file};progress('Tracking foreground instances',.15+.45*(base+index+1)/len(samples),frame=base+index+1,of=len(samples))
        del state
        if device=='cuda':torch.cuda.empty_cache()
    del predictor
    sys.path.insert(0,str(workspace/'.cache/clyra-spatial/sources/video-depth-anything'))
    from video_depth_anything.video_depth_stream import VideoDepthAnything
    depth_model=VideoDepthAnything(encoder='vits',features=64,out_channels=[48,96,192,384]);depth_model.load_state_dict(torch.load(models/'video_depth_anything_vits.pth',map_location='cpu'),strict=True);depth_model=depth_model.to(device).eval()
    solution=json.loads(Path(config['solution']).read_text()) if config.get('solution') else None
    depth_dir=output/'depth';depth_dir.mkdir(exist_ok=True)
    for i,row in enumerate(samples):
        image=cv2.imread(str(output/'frames'/row['name']));h,w=image.shape[:2];image=cv2.resize(image,(round(w*min(1,512/max(w,h))),round(h*min(1,512/max(w,h)))))
        with torch.inference_mode():prediction=depth_model.infer_video_depth_one(cv2.cvtColor(image,cv2.COLOR_BGR2RGB),input_size=252,device=device,fp32=True)
        calibration=calibrated_depth(prediction,solution,row['sourceTimeUs']);name=str(row['sourceTimeUs'])+'.npz';np.savez_compressed(depth_dir/name,relative=prediction.astype(np.float16))
        entry=record.setdefault(row['sourceTimeUs'],row);entry['depthRelative']='depth/'+name;entry['calibration']=calibration
        if calibration:
            inv=prediction*calibration['scale']+calibration['offset'];depth=np.divide(1,inv,out=np.full_like(inv,100),where=inv>1e-6);packed=np.round(np.clip(depth/100,0,1)*65535).astype(np.uint16);rgb=np.dstack([(packed>>8).astype(np.uint8),(packed&255).astype(np.uint8),(((inv>1e-6)&np.isfinite(depth)&(depth>0)&(depth<100))*round(calibration['confidence']*255)).astype(np.uint8)])
            file=str(row['sourceTimeUs'])+'.png';cv2.imwrite(str(depth_dir/file),cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR));entry['depth']='depth/'+file
        progress('Refining consistent video depth',.6+.38*(i+1)/len(samples),frame=i+1,of=len(samples))
    del depth_model
    import gc
    gc.collect()
    record,dimensions=refine_frames(config,record,output)
    for directory in ['window','render-frames','frames']:shutil.rmtree(output/directory,ignore_errors=True)
    return {'version':1,'engine':'SAM2.1-tiny / Video-Depth-Anything-Small','modelLicenses':['Apache-2.0'],'relativeDepthOnly':not any(r.get('depth') for r in record.values()),'depthRange':100,'nativeResolution':bool(config.get('nativeResolution')),**dimensions,'from':config['from'],'to':config['to'],'frames':sorted(record.values(),key=lambda r:r['sourceTimeUs']),'elapsedMs':round((time.monotonic()-start)*1000),'peakRSSBytes':peak_rss(),'notes':['Foreground analysis ends at a shot cut; select new instances in the next shot.','Instance IDs persist through propagation windows.','Relative depth becomes world depth only when validated against reconstructed landmarks.','Uncalibrated frames require explicit front/behind ordering.']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args();config=json.loads(Path(args.config).read_text())
    try:
        watch_memory(config);result=analyse(config);out=Path(config['output'])/'occlusion.json';temporary=out.with_suffix('.tmp');temporary.write_text(json.dumps(result,separators=(',',':')));temporary.replace(out);print(json.dumps({'type':'done','path':str(out)}),flush=True)
    except Exception as error:print(json.dumps({'type':'error','message':str(error)}),flush=True);raise
