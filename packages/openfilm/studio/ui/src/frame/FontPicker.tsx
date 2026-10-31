import React from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { FONT_CHOICES } from './font-library.js';
import { loadFont } from './font-runtime.js';
import { T } from './ui';
export function FontPicker({value,onChange}:{value:string;onChange:(name:string)=>void}){
  const [open,setOpen]=React.useState(false),[query,setQuery]=React.useState('');const id=React.useId(),button=React.useRef<HTMLButtonElement>(null);
  React.useEffect(()=>{void loadFont(value,`${location.origin}/assets/fonts/`).catch(()=>{});},[value]);
  React.useEffect(()=>{if(open)void Promise.all(FONT_CHOICES.map(f=>loadFont(f.name,`${location.origin}/assets/fonts/`).catch(()=>{})));},[open]);
  return <div className="min-w-0" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);button.current?.focus();}}}>
    <button ref={button} type="button" aria-label="Choose font" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)} className={`${T.secondary} w-full justify-between`}><span style={{fontFamily:`"${value}",sans-serif`}} className="truncate text-[16px]">{value}</span><ChevronDown size={13}/></button>
    {open&&<div className="mt-2 rounded-lg border border-[var(--border)] p-2"><label className="relative mb-2 block"><Search size={13} className="absolute left-2 top-2.5 text-[var(--text-muted)]"/><input aria-label="Search fonts" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search fonts or style" className={`${T.field} pl-7`}/></label><div id={id} role="listbox" aria-label="Font previews" className="grid max-h-[340px] grid-cols-2 gap-1.5 overflow-y-auto">
      {FONT_CHOICES.filter(f=>`${f.name} ${f.group}`.toLowerCase().includes(query.toLowerCase())).map(f=><button key={f.id} role="option" title={f.name} aria-selected={value===f.name} type="button" onClick={()=>{onChange(f.name);setOpen(false);button.current?.focus();}} className={`min-w-0 rounded-md border p-2 text-left ${value===f.name?'border-[var(--accent)] bg-[var(--accent-soft)]':'border-[var(--border)] hover:bg-[var(--fill-tsp)]'}`}><span className="block truncate text-[19px] leading-8" style={{fontFamily:`"${f.name}",sans-serif`}}>Aa</span><span className="flex min-w-0 items-center justify-between gap-1 text-[10px] text-[var(--text-muted)]"><span className="truncate">{f.name}</span>{value===f.name&&<Check size={11}/>}</span></button>)}
    </div><p className="mt-2 text-[10px] text-[var(--text-faint)]">24 bundled fonts · Tactical includes an original game-style location treatment.</p></div>}
  </div>;
}
