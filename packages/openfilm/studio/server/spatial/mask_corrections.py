"""Apply explicit source-time brush corrections only. No camera solve or model inference."""
from pathlib import Path
import argparse,json,os,sys
import numpy as np,cv2

def correct(config):
    base=Path(config['baseOcclusion']);data=json.loads(base.read_text());directory=base.parent;output=Path(config['output']);masks=output/'masks';masks.mkdir(parents=True,exist_ok=True);corrections=config['corrections'];affected=0
    def reference(path):return os.path.relpath(directory/path,output).replace(os.sep,'/') if path else None
    for frame in data['frames']:
        active=[c for c in corrections if c['from']*1e6<=frame['sourceTimeUs']<=c['to']*1e6];entries=frame.get('instances',[]);loaded={};edited=False
        if active:
            for entry in entries:loaded[entry['id']]=cv2.imread(str(directory/entry['path']),0)
            for c in active:
                identifier=c.get('instanceId');w,h=data['width'],data['height'];px,py=round(c['x']*(w-1)),round(c['y']*(h-1))
                if identifier is not None and identifier not in loaded:continue
                if identifier is None:
                    # A brush outside all masks targets the nearest observed silhouette, never an arbitrary ID.
                    possible=[]
                    for candidate,mask in loaded.items():
                        if mask is None:continue
                        ys,xs=np.where(mask>127)
                        if len(xs):
                            dx=max(int(xs.min())-px,0,px-int(xs.max()));dy=max(int(ys.min())-py,0,py-int(ys.max()));possible.append((dx*dx+dy*dy,candidate))
                    identifier=min(possible)[1] if possible else None
                if identifier is None:continue
                mask=loaded[identifier]
                if mask is None:continue
                cv2.circle(mask,(px,py),max(1,round(c['r']*w)),255 if c['add'] else 0,-1,lineType=cv2.LINE_AA);edited=True
        union=None
        for entry in entries:
            if edited and loaded.get(entry['id']) is not None:
                mask=loaded[entry['id']];name=f"{frame['sourceTimeUs']}-{entry['id']}.png";cv2.imwrite(str(masks/name),mask);entry['path']='masks/'+name;union=mask.copy() if union is None else np.maximum(union,mask)
            else:entry['path']=reference(entry['path'])
        if edited and union is not None:
            name=f"{frame['sourceTimeUs']}-union.png";cv2.imwrite(str(masks/name),union);frame['mask']='masks/'+name;frame['manuallyCorrected']=True;affected+=1
        else:frame['mask']=reference(frame.get('mask'))
        for key in ['depth','depthRelative']:
            if frame.get(key):frame[key]=reference(frame[key])
    data['manualCorrections']={'affectedFrames':affected,'count':len(corrections)};return data
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);config=json.loads(Path(p.parse_args().config).read_text())
    try:
        data=correct(config);out=Path(config['output'])/'occlusion.json';temporary=out.with_suffix('.tmp');temporary.write_text(json.dumps(data,separators=(',',':')));temporary.replace(out);print(json.dumps({'type':'done','path':str(out)}),flush=True)
    except Exception as e:print(json.dumps({'type':'error','message':str(e)}),flush=True);raise
