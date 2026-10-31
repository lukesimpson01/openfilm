import React from 'react';
const cache=new Map<string,Promise<any>>();
export function useSceneTracks(folder:string,paths:(string|null|undefined)[]){
  const signature=JSON.stringify([...new Set(paths.filter(Boolean))].sort()),[tracks,setTracks]=React.useState<Record<string,any>>({});
  React.useEffect(()=>{let live=true;void Promise.all((JSON.parse(signature) as string[]).map(async path=>{const url=folder+path;if(!cache.has(url)){cache.set(url,fetch(url).then(r=>{if(!r.ok)throw new Error('Track unavailable');return r.json();}).catch(()=>{cache.delete(url);return null;}));if(cache.size>48)cache.delete(cache.keys().next().value!);}return [path,await cache.get(url)];})).then(entries=>{if(live)setTracks(Object.fromEntries(entries));});return()=>{live=false;};},[folder,signature]);
  return tracks;
}
