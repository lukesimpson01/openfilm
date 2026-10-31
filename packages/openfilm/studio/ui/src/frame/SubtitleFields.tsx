import React from 'react';
import { Type as TypeIcon, AlignVerticalJustifyCenter, Palette, Sparkles, AlignVerticalJustifyStart, AlignVerticalJustifyEnd } from 'lucide-react';
import { SUB_ANIMATIONS, SUB_POSITIONS } from './subtitle-styles.js';
import { FontPicker } from './FontPicker';
import { seg, segWrap } from './ui';

/* Subtitle data and the settings behind the Style tab's gear: text, position, colors and motion, each a short
   section that fits without scrolling. */
export type Cue = { id: string; start: number; duration: number; text: string; wordTimes?:{start:number;end?:number}[] };
export type SubtitleStyle = {
  mode: 'Word' | 'Lines'; styleId: number; y: number; fontSize: number; font: string; textCase: 'none' | 'upper' | 'lower' | 'title';
  animation: string; animationSpeed: number; customColors: boolean; appearedColor: string; activeColor: string; emphasisColor: string; outlineColor: string; outline: number;
};
export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  mode: 'Word', styleId: 2, y: SUB_POSITIONS.Middle, fontSize: 78, font: 'Sora', textCase: 'none', animation: 'Pop', animationSpeed: 0.25,
  customColors: false, appearedColor: '#ffffff', activeColor: '#ffffff', emphasisColor: '#ffffff', outlineColor: '#000000', outline: 0,
};
const uid = () => Math.random().toString(36).slice(2, 8);
export const newCue = (start: number, text = 'Add text', duration = 2): Cue => ({ id: `c${uid()}`, start, duration, text });

/** A script becomes timed cues: about six words each, at roughly three words a second. */
export function cuesFromScript(script: string, from = 0, perCue = 6, wps = 3): Cue[] {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const out: Cue[] = []; let t = from;
  for (let i = 0; i < words.length; i += perCue) {
    const part = words.slice(i, i + perCue), d = Math.max(0.6, part.length / wps);
    out.push(newCue(Math.round(t * 100) / 100, part.join(' '), Math.round(d * 100) / 100)); t += d;
  }
  return out;
}
export const cuesLength = (cues: Cue[]) => Math.max(1, ...cues.map((c) => c.start + c.duration));

const SECTIONS = [['Text', TypeIcon], ['Position', AlignVerticalJustifyCenter], ['Colors', Palette], ['Motion', Sparkles]] as const;
const row = 'flex items-center gap-2 text-[11.5px] text-[var(--text-dim)]';
const slider = 'h-1 flex-1 cursor-pointer accent-[var(--accent)]';

export function SubtitleSettings({ value, onChange }: { value: SubtitleStyle; onChange: (patch: Partial<SubtitleStyle>) => void }) {
  const [section, setSection] = React.useState<(typeof SECTIONS)[number][0]>('Text');
  const position = Object.entries(SUB_POSITIONS).find(([, y]) => y === value.y)?.[0] ?? 'Custom';
  const colors: [string, keyof SubtitleStyle][] = [['Appeared', 'appearedColor'], ['Active', 'activeColor'], ['Emphasis', 'emphasisColor'], ['Outline', 'outlineColor']];
  const posIcon: Record<string, React.ReactNode> = { Top: <AlignVerticalJustifyStart size={13} />, Middle: <AlignVerticalJustifyCenter size={13} />, Bottom: <AlignVerticalJustifyEnd size={13} /> };
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5">
      <div className={segWrap} role="tablist">
        {SECTIONS.map(([name, Icon]) => <button key={name} role="tab" aria-selected={section === name} className={seg(section === name)} onClick={() => setSection(name)}><Icon size={12} />{name}</button>)}
      </div>
      {section === 'Text' && <>
        <FontPicker value={value.font} onChange={font=>onChange({font})}/>
        <label className={row}><span className="w-14">Size</span><input type="range" min={30} max={160} value={value.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className={slider} /><span className="w-7 text-right tabular-nums">{value.fontSize}</span></label>
        <div className={row}><span className="w-14">Case</span><div className={`${segWrap} flex-1`}>{([['Aa', 'none'], ['AA', 'upper'], ['aa', 'lower'], ['Ab', 'title']] as const).map(([l, c]) => <button key={c} type="button" aria-pressed={value.textCase === c} className={seg(value.textCase === c)} onClick={() => onChange({ textCase: c })}>{l}</button>)}</div></div>
        <label className={row}><span className="w-14">Outline</span><input type="range" min={-1} max={20} value={value.outline} onChange={(e) => onChange({ outline: Number(e.target.value) })} className={slider} /><span className="w-7 text-right tabular-nums">{value.outline === -1 ? 'Off' : value.outline === 0 ? 'Auto' : value.outline}</span></label>
      </>}
      {section === 'Position' && <>
        <div className={segWrap}>{Object.keys(SUB_POSITIONS).map((n) => <button key={n} type="button" aria-pressed={position === n} className={seg(position === n)} onClick={() => onChange({ y: (SUB_POSITIONS as Record<string, number>)[n] })}>{posIcon[n]}{n}</button>)}</div>
        <label className={row}><span className="w-14">Height</span><input type="range" min={5} max={95} value={value.y} onChange={(e) => onChange({ y: Number(e.target.value) })} className={slider} /><span className="w-8 text-right tabular-nums">{Math.round(value.y)}%</span></label>
      </>}
      {section === 'Colors' && <>
        <label className={`${row} justify-between`}>Custom colors<input type="checkbox" checked={value.customColors} onChange={(e) => onChange({ customColors: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /></label>
        <div className={`grid grid-cols-2 gap-2 ${value.customColors ? '' : 'pointer-events-none opacity-40'}`}>
          {colors.map(([label, key]) => (
            <label key={key} className="flex items-center justify-between gap-2 rounded-md bg-[var(--fill-tsp)] px-2 py-1 text-[11.5px] text-[var(--text-dim)]">{label}
              <input type="color" value={String(value[key])} onChange={(e) => onChange({ [key]: e.target.value } as Partial<SubtitleStyle>)} className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0" /></label>
          ))}
        </div>
      </>}
      {section === 'Motion' && <>
        <div className="grid grid-cols-3 gap-1">
          {SUB_ANIMATIONS.map((a: string) => (
            <button key={a} type="button" aria-pressed={value.animation === a} onClick={() => onChange({ animation: a })}
              className={`h-7 rounded-md border text-[11px] ${value.animation === a ? 'border-[var(--accent)] bg-[var(--bg)] font-medium text-[var(--accent)]' : 'border-transparent bg-[var(--fill-tsp)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}>{a}</button>
          ))}
        </div>
        <label className={row}><span className="w-14">Speed</span><input type="range" min={0.08} max={0.6} step={0.01} value={value.animationSpeed} onChange={(e) => onChange({ animationSpeed: Number(e.target.value) })} className={slider} /></label>
      </>}
    </div>
  );
}
