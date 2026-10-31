import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {existsSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {readable} from './files.mjs';
import {readyProxy} from './proxies.mjs';
import {TOOL_DIR} from './projects.mjs';
const jobs=new Map();let queue=Promise.resolve();
const run=args=>new Promise((ok,fail)=>{const child=spawn('ffmpeg',['-hide_banner','-nostdin','-loglevel','error','-y',...args],{stdio:['ignore','ignore','pipe']});let error='';const timer=setTimeout(()=>child.kill('SIGTERM'),120000);child.stderr.on('data',d=>error=(error+d).slice(-1200));child.once('error',fail);child.once('exit',code=>{clearTimeout(timer);code===0?ok():fail(new Error(error||'Scan preview could not be prepared.'));});});
export const scanPreviewFile=(root,id)=>/^[a-f0-9]{24}$/.test(id)?join(root,TOOL_DIR,'cache','scan-loops',id,'loop.mp4'):null;

/** A once-cached native forward/reverse movie. Reverse only two-second chunks: memory stays bounded for long clips. */
export async function prepareScanPreview(root,src,from,to){
  root=resolve(root);
  const original=readable(root,src),stats=statSync(original);
  if(!/\.(mp4|mov|m4v|webm|mkv)$/i.test(src)||!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from||to-from>600)throw new Error('Invalid scan preview range.');
  const id=createHash('sha256').update(JSON.stringify([2,original,stats.size,stats.mtimeMs,from,to])).digest('hex').slice(0,24),out=scanPreviewFile(root,id);
  if(existsSync(out))return {id,file:out};
  if(!jobs.has(out)){
    const job=queue.catch(()=>{}).then(async()=>{
      const dir=join(root,TOOL_DIR,'cache','scan-loops',id);await mkdir(dir,{recursive:true});
      const input=readyProxy(root,src,720)??readyProxy(root,src,540)??original,forward=join(dir,'forward.mp4'),duration=to-from;
      const encode=['-an','-c:v','libx264','-preset','ultrafast','-crf','22','-pix_fmt','yuv420p','-g','30','-threads','2'];
      const files=[];
      try{
        await run(['-ss',String(from),'-i',input,'-t',String(duration),'-vf','scale=640:480:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',...encode,forward]);files.push(forward);
        const reverse=[];
        for(let start=0,i=0;start<duration-.001;start+=2,i++){const file=join(dir,`reverse-${i}.mp4`);await run(['-ss',String(start),'-i',forward,'-t',String(Math.min(2,duration-start)),'-vf','reverse,setpts=PTS-STARTPTS',...encode,file]);reverse.unshift(file);files.push(file);}
        const list=join(dir,'concat.txt'),temp=join(dir,'loop.tmp.mp4');files.push(list,temp);
        await writeFile(list,[forward,...reverse].map(f=>`file '${f.replaceAll("'","'\\''")}'`).join('\n'));
        await run(['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',temp]);await rename(temp,out);
      }finally{await Promise.all(files.map(file=>rm(file,{force:true})));}
    });jobs.set(out,job);queue=job;job.finally(()=>jobs.delete(out)).catch(()=>{});
  }
  await jobs.get(out);return {id,file:out};
}
