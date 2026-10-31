"""Lazy, disk-backed native camera reconstruction. No inference runs during playback.
Camera coordinates follow OpenCV/COLMAP: x right, y down, z forward.
"""
import argparse, json, os, sys, time, hashlib, subprocess, sqlite3
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS','2')
os.environ.setdefault('OPENBLAS_NUM_THREADS','2')
import numpy as np
import cv2
import av
from av.codec.hwaccel import HWAccel,hwdevices_available
import pycolmap
cv2.setNumThreads(2)

def peak_rss():
    try:
        import resource
        value=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(value if sys.platform=='darwin' else value*1024)
    except ImportError:
        try:
            import psutil
            return int(psutil.Process().memory_info().peak_wset)
        except (ImportError,AttributeError):return None

def watch_memory(config):
    budget=config.get('memoryBudgetBytes')
    if not budget:return
    import threading
    def watch():
        try:
            import psutil
            process=psutil.Process()
            while True:
                if process.memory_info().rss>budget:
                    print(json.dumps({'type':'error','message':'Native analysis reached its configured memory budget. Use the lightweight surface path or a shorter analysis range.'}),flush=True);os._exit(137)
                time.sleep(1)
        except ImportError:pass
    threading.Thread(target=watch,daemon=True).start()

def progress(stage,share,**details):
    print(json.dumps({'type':'progress','stage':stage,'share':share,**details}),flush=True)

def metadata(path):
    result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate:stream_tags:stream_side_data','-of','json',str(path)],capture_output=True,text=True,check=True)
    return json.loads(result.stdout)['streams'][0]

def frames(path,start,end,output,fps=6,max_frames=180,longest=960,progress_from=.02,progress_span=.13):
    meta=metadata(path);rotation=next((s['rotation'] for s in meta.get('side_data_list',[]) if 'rotation' in s),0)
    output.mkdir(parents=True,exist_ok=True);samples=[];next_at=start;previous=None;shot=0
    available=hwdevices_available();device=next((name for name in ['videotoolbox','cuda','d3d11va','dxva2','vaapi'] if name in available),None)
    try:container=av.open(str(path),hwaccel=HWAccel(device,allow_software_fallback=True) if device else None)
    except Exception:container=av.open(str(path));device=None
    with container:
        stream=container.streams.video[0];stream.thread_type='AUTO';stream.codec_context.thread_count=2
        origin=float((stream.start_time or 0)*stream.time_base)
        if start>0:container.seek(int((start+origin)/stream.time_base),stream=stream,backward=True)
        for frame in container.decode(stream):
            if frame.pts is None:continue
            timestamp=float(frame.pts*frame.time_base)-origin
            if timestamp+1e-6<next_at:continue
            if timestamp>=end:break
            image=frame.to_ndarray(format='bgr24')
            if round(rotation)%360==270:image=cv2.rotate(image,cv2.ROTATE_90_CLOCKWISE)
            elif round(rotation)%360==90:image=cv2.rotate(image,cv2.ROTATE_90_COUNTERCLOCKWISE)
            elif round(rotation)%360==180:image=cv2.rotate(image,cv2.ROTATE_180)
            h,w=image.shape[:2];scale=min(1,longest/max(w,h));image=cv2.resize(image,(round(w*scale),round(h*scale)),interpolation=cv2.INTER_AREA)
            hist=cv2.calcHist([cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)],[0],None,[32],[0,256]);cv2.normalize(hist,hist)
            if previous is not None and cv2.compareHist(previous,hist,cv2.HISTCMP_BHATTACHARYYA)>.65:shot+=1
            previous=hist;name=f'{len(samples):06d}.jpg';cv2.imwrite(str(output/name),image,[cv2.IMWRITE_JPEG_QUALITY,94])
            samples.append({'name':name,'sourceTimeUs':round(timestamp*1e6),'shot':shot});next_at=timestamp+1/fps if fps else timestamp
            progress('Reading source frames',progress_from+progress_span*(timestamp-start)/max(.001,end-start),frames=len(samples))
            if len(samples)>=max_frames:break
    if len(samples)<4:raise ValueError('At least four distinct video frames are required for camera reconstruction.')
    return samples,{'sourceWidth':w,'sourceHeight':h,'width':image.shape[1],'height':image.shape[0],'rotation':rotation,'decoder':device or 'cpu','relativeScale':True}

def relocalize(model,database,samples,poses):
    """Match directly against fixed reconstructed 3D landmarks; no integration of screen-space deltas."""
    conn=sqlite3.connect(str(database));descriptors={};keypoints={}
    for image_id,rows,cols,data in conn.execute('SELECT image_id,rows,cols,data FROM descriptors'):
        if data is None or rows==0:continue
        descriptors[image_id]=np.frombuffer(data,dtype=np.uint8).reshape(rows,cols).astype(np.float32)
    for image_id,rows,cols,data in conn.execute('SELECT image_id,rows,cols,data FROM keypoints'):
        if data is None or rows==0:continue
        keypoints[image_id]=np.frombuffer(data,dtype=np.float32).reshape(rows,cols)[:,:2]
    bank={}
    for image_id,image in model.images.items():
        if not image.has_pose or image_id not in descriptors:continue
        for index,point in enumerate(image.points2D):
            if point.has_point3D() and point.point3D_id in model.points3D and model.points3D[point.point3D_id].error<2.5:
                bank.setdefault(point.point3D_id,[]).append(descriptors[image_id][index])
    ids=list(bank);reference=np.array([np.mean(bank[i],axis=0) for i in ids],dtype=np.float32)
    if len(reference)<20:return poses
    reference/=np.maximum(1,np.linalg.norm(reference,axis=1,keepdims=True));xyz=np.array([model.points3D[i].xyz for i in ids]);matcher=cv2.BFMatcher(cv2.NORM_L2)
    names={name:identifier for identifier,name in conn.execute('SELECT image_id,name FROM images')};conn.close()
    known={pose['name'] for pose in poses};base=poses[0];K=np.array(base['intrinsics']);dist=np.array([*(base['distortion'] or [0]),0,0,0],dtype=float)[:4]
    for row in samples:
        if row['name'] in known:continue
        image_id=names.get(row['name']);query=descriptors.get(image_id)
        if query is None or len(query)<20:continue
        query=query/np.maximum(1,np.linalg.norm(query,axis=1,keepdims=True));pairs=matcher.knnMatch(query,reference,k=2);matches=[m for m,n in pairs if m.distance<.78*n.distance]
        unique={}
        for match in sorted(matches,key=lambda m:m.distance):unique.setdefault(match.trainIdx,match)
        matches=list(unique.values())
        if len(matches)<16:continue
        objects=np.array([xyz[m.trainIdx] for m in matches]);pixels=np.array([keypoints[image_id][m.queryIdx] for m in matches],dtype=np.float64)
        ok,rvec,tvec,inliers=cv2.solvePnPRansac(objects,pixels,K,dist,iterationsCount=500,reprojectionError=2.5,confidence=.999,flags=cv2.SOLVEPNP_EPNP)
        if not ok or inliers is None or len(inliers)<16 or len(inliers)/len(matches)<.35:continue
        chosen=inliers[:,0];rvec,tvec=cv2.solvePnPRefineLM(objects[chosen],pixels[chosen],K,dist,rvec,tvec)
        projected,_=cv2.projectPoints(objects[chosen],rvec,tvec,K,dist);error=float(np.median(np.linalg.norm(projected[:,0]-pixels[chosen],axis=1)))
        if error>1.5:continue
        R,_=cv2.Rodrigues(rvec);matrix=np.column_stack([R,tvec[:,0]])
        if np.mean((objects[chosen]@R.T+tvec[:,0])[:,2]>0)<.95:continue
        poses.append({**row,'cameraId':base['cameraId'],'worldToCamera':matrix.tolist(),'intrinsics':K.tolist(),'distortion':base['distortion'],'cameraModel':base['cameraModel'],'observations':len(chosen),'reprojectionError':error,'status':'observed','method':'global-landmark-pnp','features':[{'xy':pixels[i].tolist(),'pointId':str(ids[matches[i].trainIdx])} for i in chosen]})
        progress('Relocalizing against reconstructed landmarks',.65+.2*len(poses)/len(samples),registered=len(poses))
    return poses

def flow_relocalize(model,samples,image_path,poses):
    """Bidirectional LK carries existing 3D landmark identities into an unregistered image.
    Only independently verified PnP inliers become observations, never integrated motion estimates.
    """
    known={p['name']:p for p in poses};landmarks=model if isinstance(model,dict) else {str(i):p.xyz for i,p in model.points3D.items() if p.error<2.5}
    for direction in [samples,list(reversed(samples))]:
        previous=None;image0=None
        for row in direction:
            if row['name'] in known:
                previous=known[row['name']];image0=cv2.imread(str(image_path/row['name']),0);continue
            if previous is None or abs(row['sourceTimeUs']-previous['sourceTimeUs'])>400000:continue
            features=[p for p in previous.get('features',[]) if str(p['pointId']) in landmarks]
            if len(features)<20:continue
            image=cv2.imread(str(image_path/row['name']),0);p0=np.float32([p['xy'] for p in features]).reshape(-1,1,2)
            p1,ok,error=cv2.calcOpticalFlowPyrLK(image0,image,p0,None,winSize=(25,25),maxLevel=4,criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,30,.01))
            back,ok2,_=cv2.calcOpticalFlowPyrLK(image,image0,p1,None,winSize=(25,25),maxLevel=4)
            keep=(ok[:,0]>0)&(ok2[:,0]>0)&(np.linalg.norm(back[:,0]-p0[:,0],axis=1)<.7)&(error[:,0]<24)
            pixels=p1[keep,0].astype(np.float64);chosen=[f for f,k in zip(features,keep) if k];objects=np.float64([landmarks[str(f['pointId'])] for f in chosen])
            if len(objects)<20:continue
            K=np.array(previous['intrinsics']);dist=np.array([*(previous['distortion'] or [0]),0,0,0],dtype=float)[:4]
            ok,r,t,inliers=cv2.solvePnPRansac(objects,pixels,K,dist,iterationsCount=300,reprojectionError=2,confidence=.999,flags=cv2.SOLVEPNP_EPNP)
            if not ok or inliers is None or len(inliers)<20 or len(inliers)/len(objects)<.5:continue
            ii=inliers[:,0];r,t=cv2.solvePnPRefineLM(objects[ii],pixels[ii],K,dist,r,t);projected,_=cv2.projectPoints(objects[ii],r,t,K,dist);err=float(np.median(np.linalg.norm(projected[:,0]-pixels[ii],axis=1)))
            # A point cluster confined to a tiny line or corner cannot establish a stable camera pose.
            spread=np.linalg.eigvalsh(np.cov(pixels[ii].T));R,_=cv2.Rodrigues(r)
            if err>1.2 or spread[0]<16 or np.mean((objects[ii]@R.T+t[:,0])[:,2]>0)<.98:continue
            pose={**previous,**row,'worldToCamera':np.column_stack([R,t[:,0]]).tolist(),'observations':len(ii),'reprojectionError':err,'status':'observed','method':'landmark-lk-pnp','features':[{'xy':pixels[i].tolist(),'pointId':str(chosen[i]['pointId'])} for i in ii]}
            known[row['name']]=pose;poses.append(pose);previous=pose;image0=image
    return poses

def geometry_mesh(points,poses,width,height):
    """Conservative observed surface triangles. Unsupported holes stay holes.
    Triangles must recur in at least two independent observations, with bounded depth/edge span.
    """
    by_id={p['id']:i for i,p in enumerate(points)};xyz=np.array([p['xyz'] for p in points]);counts={}
    for pose in poses:
        features=[f for f in pose.get('features',[]) if f['pointId'] in by_id and 1<f['xy'][0]<width-1 and 1<f['xy'][1]<height-1]
        if len(features)<4:continue
        subdiv=cv2.Subdiv2D((0,0,width,height));lookup={}
        for f in features:
            xy=tuple(map(float,f['xy']));key=(round(xy[0]*4),round(xy[1]*4))
            if key in lookup:continue
            subdiv.insert(xy);lookup[key]=by_id[f['pointId']]
        M=np.array(pose['worldToCamera'])
        for triangle in subdiv.getTriangleList():
            ids=[lookup.get((round(float(x)*4),round(float(y)*4))) for x,y in triangle.reshape(3,2)]
            if any(i is None for i in ids) or len(set(ids))!=3:continue
            vertices=xyz[ids];depth=vertices@M[2,:3]+M[2,3]
            lengths=np.array([np.linalg.norm(vertices[i]-vertices[(i+1)%3]) for i in range(3)])
            if depth.min()<=0 or depth.max()/depth.min()>1.35 or lengths.max()>np.median(depth)*.2 or lengths.max()/max(1e-6,lengths.min())>4:continue
            key=tuple(sorted(ids));counts[key]=counts.get(key,0)+1
    return {'vertices':xyz.tolist(),'triangles':[list(k) for k,n in counts.items() if n>=2],'confidence':.9}

def floor_gravity(points,poses,width,height):
    reference=poses[0];M=np.array(reference['worldToCamera']);K=np.array(reference['intrinsics']);candidates=[]
    for point in points:
        q=M[:,:3]@point['xyz']+M[:,3]
        if q[2]>0 and K[1,1]*q[1]/q[2]+K[1,2]>height*.65:candidates.append(point['xyz'])
    if len(candidates)<30:return None
    P=np.array(candidates);threshold=float(np.median(np.linalg.norm(P-P.mean(axis=0),axis=1)))*.015;random=np.random.default_rng(17);best=None;down=M[1,:3]
    for _ in range(240):
        a,b,c=P[random.choice(len(P),3,replace=False)];n=np.cross(b-a,c-a);length=np.linalg.norm(n)
        if length<1e-7:continue
        n/=length
        if abs(n@down)<.7:continue
        inliers=np.abs((P-a)@n)<threshold
        if best is None or inliers.sum()>best.sum():best=inliers
    if best is None or best.sum()<30 or best.mean()<.4:return None
    Q=P[best];center=Q.mean(axis=0);values,vectors=np.linalg.eigh(np.cov(Q.T));normal=vectors[:,0]
    if values[1]<1e-5:return None
    if normal@down<0:normal=-normal
    return {'direction':normal.tolist(),'support':int(best.sum()),'error':float(np.median(np.abs((Q-center)@normal))),'source':'reconstructed floor plane','confidence':float(best.mean())}

def loop_candidates(database,image_path,output,min_gap=12,max_pairs=80):
    """Bounded global retrieval followed by actual SIFT correspondence verification.
    Appearance proposes pairs; only robust geometric matches enter bundle adjustment.
    """
    connection=sqlite3.connect(str(database));images=list(connection.execute('SELECT image_id,name FROM images ORDER BY name'));features=[]
    for identifier,name in images:
        image=cv2.imread(str(image_path/name),0)
        if image is None:features.append(np.zeros(576,np.float32));continue
        small=cv2.resize(image,(32,18)).astype(np.float32);small-=small.mean();features.append(small.reshape(-1)/max(1,np.linalg.norm(small)))
    values=np.array(features);scores=values@values.T;pairs=set()
    for i in range(len(images)):
        eligible=[j for j in range(len(images)) if abs(i-j)>=min_gap and scores[i,j]>.55]
        for j in sorted(eligible,key=lambda j:-scores[i,j])[:2]:pairs.add(tuple(sorted((i,j))))
    pairs=sorted(pairs,key=lambda ij:-scores[ij])[:max_pairs];written=[];matcher=cv2.BFMatcher(cv2.NORM_L2)
    for i,j in pairs:
        a,an=images[i];b,bn=images[j];pair_id=min(a,b)*2147483647+max(a,b)
        existing=connection.execute('SELECT rows FROM matches WHERE pair_id=?',(pair_id,)).fetchone()
        if existing and existing[0]>=20:continue
        def descriptor(identifier):
            row=connection.execute('SELECT rows,cols,data FROM descriptors WHERE image_id=?',(identifier,)).fetchone()
            return np.frombuffer(row[2],np.uint8).reshape(row[0],row[1]).astype(np.float32) if row and row[0] else None
        da,db=descriptor(a),descriptor(b)
        if da is None or db is None or len(db)<2:continue
        matches=np.array([[m.queryIdx,m.trainIdx] for m,n in matcher.knnMatch(da,db,k=2) if m.distance<.75*n.distance],np.uint32)
        if len(matches)<20:continue
        if a>b:matches=matches[:,::-1].copy()
        connection.execute('INSERT OR REPLACE INTO matches(pair_id,rows,cols,data) VALUES(?,?,?,?)',(pair_id,len(matches),2,matches.tobytes()));written.append((min(a,b),max(a,b),an,bn))
    connection.commit();connection.close()
    if written:
        path=output/'loop-pairs.txt';path.write_text('\n'.join(an+' '+bn for _,_,an,bn in written))
        # verify_matches starts its own default-sized thread pool. Estimate each bounded pair directly instead.
        native=pycolmap.Database(str(database));options=pycolmap.TwoViewGeometryOptions();options.ransac.max_num_trials=10000
        try:
            for a,b,_,_ in written:
                ca=native.read_camera(native.read_image(a).camera_id);cb=native.read_camera(native.read_image(b).camera_id);pa=native.read_keypoints(a)[:,:2].astype(np.float64);pb=native.read_keypoints(b)[:,:2].astype(np.float64);geometry=pycolmap.estimate_two_view_geometry(ca,pa,cb,pb,native.read_matches(a,b),options)
                if len(geometry.inlier_matches)>=20:native.write_two_view_geometry(a,b,geometry)
        finally:native.close()
    return len(written)

def solve_shot(samples,image_path,output,dimensions,workspace=None,content=None):
    output.mkdir(parents=True,exist_ok=True);database=output/'features.db';models=output/'models';models.mkdir(exist_ok=True)
    names=[row['name'] for row in samples]
    if not database.exists():
        sift=pycolmap.SiftExtractionOptions();sift.num_threads=2;sift.max_image_size=960;sift.max_num_features=3000
        reader=pycolmap.ImageReaderOptions();bounds=content or {'x':0,'y':0,'w':1,'h':1};focal=max(dimensions['width']*bounds['w'],dimensions['height']*bounds['h'])*.72;reader.camera_params=f"{focal},{dimensions['width']*(bounds['x']+bounds['w']/2)},{dimensions['height']*(bounds['y']+bounds['h']/2)},0"
        if content:
            masks=output/'feature-masks';masks.mkdir(exist_ok=True);mask=np.zeros((dimensions['height'],dimensions['width']),np.uint8);x,y,w,h=[bounds[k] for k in ['x','y','w','h']];mask[round(y*dimensions['height']):round((y+h)*dimensions['height']),round(x*dimensions['width']):round((x+w)*dimensions['width'])]=255
            for name in names:cv2.imwrite(str(masks/(name+'.png')),mask)
            reader.mask_path=str(masks)
        pycolmap.extract_features(str(database),str(image_path),image_list=names,camera_mode=pycolmap.CameraMode.SINGLE,camera_model='SIMPLE_RADIAL',reader_options=reader,sift_options=sift,device=pycolmap.Device.cpu)
        options=pycolmap.SiftMatchingOptions();options.num_threads=2;options.guided_matching=True
        sequential=pycolmap.SequentialMatchingOptions();sequential.overlap=8;sequential.loop_detection=False
        if len(names)<=70:pycolmap.match_exhaustive(str(database),sift_options=options,device=pycolmap.Device.cpu)
        else:
            pycolmap.match_sequential(str(database),sift_options=options,matching_options=sequential,device=pycolmap.Device.cpu)
            loop_candidates(database,image_path,output)
    progress('Reconstructing camera and static geometry',.42)
    options=pycolmap.IncrementalPipelineOptions();options.num_threads=2;options.max_num_models=3;options.min_model_size=4
    options.mapper.init_min_num_inliers=40;options.mapper.init_min_tri_angle=2;options.mapper.init_max_forward_motion=.999;options.mapper.init_max_reg_trials=5;options.mapper.abs_pose_min_num_inliers=20;options.mapper.filter_max_reproj_error=2.5
    options.ba_global_max_num_iterations=40;options.ba_local_max_num_iterations=20
    existing=[p for p in models.iterdir() if (p/'images.bin').exists()]
    reconstructions={i:pycolmap.Reconstruction(str(p)) for i,p in enumerate(existing)} if existing else pycolmap.incremental_mapping(str(database),str(image_path),str(models),options=options)
    if not reconstructions:raise ValueError('No reliable translated camera was reconstructed. Use the surface tracker or add stronger visual features. Rotation-only motion cannot establish scene depth.')
    model=max(reconstructions.values(),key=lambda m:m.num_reg_images());model.normalize()
    poses=[];points=[];by_name={s['name']:s for s in samples}
    for identifier,image in model.images.items():
        if not image.has_pose:continue
        camera=model.cameras[image.camera_id];transform=image.cam_from_world;matrix=transform.matrix()
        observed=[p for p in image.points2D if p.has_point3D() and p.point3D_id in model.points3D]
        errors=[model.points3D[p.point3D_id].error for p in observed]
        poses.append({**by_name[image.name],'cameraId':image.camera_id,'worldToCamera':matrix.tolist(),'intrinsics':camera.calibration_matrix().tolist(),'distortion':camera.params[3:].tolist() if camera.model.name=='SIMPLE_RADIAL' else [],'cameraModel':camera.model.name,'observations':len(observed),'reprojectionError':float(np.median(errors)) if errors else None,'status':'observed','features':[{'xy':p.xy.tolist(),'pointId':str(p.point3D_id)} for p in observed]})
    for identifier,point in model.points3D.items():
        if point.error>2.5 or point.track.length()<3:continue
        points.append({'id':str(identifier),'xyz':point.xyz.tolist(),'color':point.color.tolist(),'error':point.error,'observations':point.track.length()})
    poses=relocalize(model,database,samples,poses);poses=flow_relocalize(model,samples,image_path,poses);
    if workspace and len(poses)/len(samples)<.85:
        from matching import recover
        poses=recover(points,samples,poses,image_path,workspace,progress)
    poses.sort(key=lambda p:p['sourceTimeUs']);registered=len(poses)/len(samples)
    if len(poses)<4 or len(points)<30 or registered<.45:raise ValueError(f'Camera geometry is uncertain: {len(poses)}/{len(samples)} registered frames, {len(points)} reliable scene points. No world anchor was generated.')
    # Translation/triangulation must be observable; a merely rotating camera is insufficient.
    centers=np.array([-np.array(p['worldToCamera'])[:,:3].T@np.array(p['worldToCamera'])[:,3] for p in poses]);baseline=float(np.linalg.norm(centers-centers[0],axis=1).max())
    if baseline<1e-4:raise ValueError('No observable camera translation: world depth is not established.')
    (output/'reconstruction').mkdir(exist_ok=True);model.write(str(output/'reconstruction'))
    return {'poses':poses,'points':points,'mesh':geometry_mesh(points,poses,dimensions['width'],dimensions['height']),'gravity':floor_gravity(points,poses,dimensions['width'],dimensions['height']),'registeredShare':registered,'cameraBaseline':baseline,'reprojectionError':float(np.median([p['error'] for p in points])),'quality':'Good' if registered>.8 else 'Fair'}

def dense_camera(config,solution):
    """Native-resolution camera refinements between SfM keys. No smoothing of observed shake.
    Disk-backed frames bound memory; forward/backward LK + calibrated landmark PnP verify each pose.
    """
    if config['to']-config['from']>30:return solution
    progress('Refining source-frame camera movement',.86)
    output=Path(config['output'])/'camera-frames';samples,dimensions=frames(Path(config['source']),config['from'],config['to'],output,fps=30,max_frames=900,longest=960,progress_from=.86,progress_span=.06)
    by_time={r['sourceTimeUs']:r for r in samples};observed=[]
    for shot in solution['shots']:
        if not shot.get('poses'):continue
        chosen=[r for r in samples if shot['fromUs']<=r['sourceTimeUs']<=shot['toUs']]
        seeds=[]
        for pose in shot['poses']:
            # The original solve may use a frame between output-cadence frames. Link it into the disk-backed sequence.
            row=by_time.get(pose['sourceTimeUs'])
            if row is None:
                name='seed-'+pose['name'];source=Path(config['output'])/'frames'/pose['name'];target=output/name
                if not target.exists():os.link(source,target)
                row={'sourceTimeUs':pose['sourceTimeUs'],'shot':shot['id'],'name':name};chosen.append(row)
            seeds.append({**pose,'name':row['name']})
        chosen.sort(key=lambda r:r['sourceTimeUs']);landmarks={p['id']:np.array(p['xyz']) for p in shot['points']};poses=flow_relocalize(landmarks,chosen,output,seeds);poses.sort(key=lambda p:p['sourceTimeUs'])
        # Preserve sparse feature references only for original SfM observations; render needs matrices, not frame histories.
        sparse_times={p['sourceTimeUs'] for p in seeds}
        for p in poses:
            if p['sourceTimeUs'] not in sparse_times:p.pop('features',None)
        shot['poses']=poses;shot['refinedFrames']=len(poses);shot['refinementCoverage']=len(poses)/max(1,len(chosen));observed.extend(chosen)
    solution['sourceTimestampsUs']=sorted(set(r['sourceTimeUs'] for r in observed));solution['notes'].append('Source-frame LK/PnP refinement preserves observed shake between sparse reconstruction keys. Refinement is bounded to 30-second ranges; longer shots retain sparse camera samples.')
    return solution

def reconstruct(config):
    started=time.monotonic();root=Path(config['output']);root.mkdir(parents=True,exist_ok=True);progress('Opening native camera analysis',0)
    samples,dimensions=frames(Path(config['source']),config['from'],config['to'],root/'frames',fps=min(config.get('fps',6),config.get('maxFrames',180)/max(.001,config['to']-config['from'])),max_frames=config.get('maxFrames',180),longest=config.get('longest',960))
    progress('Matching static scene features',.18)
    shots=[]
    for shot in sorted(set(s['shot'] for s in samples)):
        selected=[s for s in samples if s['shot']==shot]
        if len(selected)<4:shots.append({'id':shot,'status':'lost','reason':'Too few source observations'});continue
        try:shots.append({'id':shot,'fromUs':selected[0]['sourceTimeUs'],'toUs':selected[-1]['sourceTimeUs'],**solve_shot(selected,root/'frames',root/f'shot-{shot}',dimensions,config.get('workspace'),config.get('content'))})
        except ValueError as error:shots.append({'id':shot,'status':'lost','reason':str(error)})
    if not any(s.get('poses') for s in shots):raise ValueError('; '.join(s.get('reason','Invalid shot') for s in shots))
    return {'version':2,'content':config.get('content'),'engine':f'pycolmap-{pycolmap.__version__}/opencv-{cv2.__version__}',**dimensions,'from':config['from'],'to':config['to'],'shots':shots,'sourceTimestampsUs':[s['sourceTimeUs'] for s in samples],'elapsedMs':round((time.monotonic()-started)*1000),'peakRSSBytes':peak_rss(),'sourceHash':config.get('sourceHash'),'notes':['Relative world scale; use a known distance to calibrate.','Only visually registered camera poses are observations. Missing or cut intervals are never silently bridged.']}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args();config=json.loads(Path(args.config).read_text())
    try:
        watch_memory(config);started=time.monotonic();result=dense_camera(config,reconstruct(config));result['elapsedMs']=round((time.monotonic()-started)*1000);result['peakRSSBytes']=peak_rss();target=Path(config['output'])/'solution.json';temporary=target.with_suffix('.tmp');temporary.write_text(json.dumps(result,separators=(',',':')));temporary.replace(target);print(json.dumps({'type':'done','path':str(target),'elapsedMs':result['elapsedMs']}),flush=True)
    except Exception as error:
        print(json.dumps({'type':'error','message':str(error)}),flush=True);raise
