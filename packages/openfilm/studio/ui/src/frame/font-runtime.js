import { fontChoice } from './font-library.js';
const loaded=new Map();
export function loadFont(name,base=new URL('./fonts/',import.meta.url).href){
  const font=fontChoice(name);if(!font)return Promise.resolve();const key=base+font.id;
  if(!loaded.has(key))loaded.set(key,(async()=>{const face=new FontFace(font.name,`url("${base}${font.id}.ttf")`,{weight:'100 900',style:'normal'});await face.load();document.fonts.add(face);})().catch(e=>{loaded.delete(key);throw e;}));
  return loaded.get(key);
}
export async function loadLayerFonts(layer){
  const names=new Set(['Inter','Sora',layer.font,...(layer.items??[]).map(i=>i.font),...(layer.layers??[]).map(i=>i.font),layer.style?.font].filter(Boolean));
  await Promise.all([...names].map(name=>loadFont(name).catch(()=>{})));
}
