import React from 'react';
import { ChevronLeft, Palette, Trash2, Pencil, Paintbrush, Settings2, Sparkles, Captions, Plus } from 'lucide-react';
import type { Film, Op } from '@/api';
import { WORD_PRESETS, LINE_STYLES } from './subtitle-styles.js';
import { SubtitleSettings, DEFAULT_SUBTITLE_STYLE, cuesLength, newCue, type Cue, type SubtitleStyle } from './SubtitleFields';
import { makeLayer, readLayer, writeLayer, livePreview, round, type FrameLayer } from './layers';
import { T, seg, segWrap } from './ui';

/* Subtitles, as the Shorts home tools and Crayo do them: first a choice of AI or manual subtitles, then the cue list
   (Edit) and the look (Style). All the cues live in one subtitle clip that starts at 0, so a cue's times are film
   times. */
export const SUB_PREFIX = 'layer-sub';
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const seek = (s: number) => window.dispatchEvent(new CustomEvent('frame-seek', { detail: s }));

export function findSubtitleClip(film: Film | null) {
  for (const track of film?.tracks ?? []) for (const clip of track.clips) if (clip.src?.startsWith(`frame/${SUB_PREFIX}`)) return clip;
  return null;
}

export function SubtitlesPanel({ projectId, folder, film, timeMs, edit, notify, onNameLine }: {
  projectId: string; folder: string; film: Film | null; timeMs: number; notify: (m: string) => void; onNameLine?: (clipId: string, label: string) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>;
}) {
  const clip = findSubtitleClip(film);
  const [view, setView] = React.useState<'choose' | 'ai' | 'manual'>(clip ? 'manual' : 'choose');
  const [mode, setMode] = React.useState<'edit' | 'style'>('edit');
  const [layer, setLayer] = React.useState<FrameLayer | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = React.useRef<FrameLayer | null>(null);
  const clipId = clip?.id ?? null;
  /* a project that has subtitles opens on them (the film may load after this panel) */
  const chose = React.useRef(false);
  React.useEffect(() => { if (clipId && !chose.current) setView('manual'); }, [clipId]);
  const go = (v: 'choose' | 'ai' | 'manual') => { chose.current = true; setView(v); };

  React.useEffect(() => {
    if (!clipId) { setLayer(null); return; }
    let live = true;
    readLayer(folder, clipId).then((l) => { if (live && l && !pending.current) setLayer(l); });
    return () => { live = false; };
  }, [folder, clipId]);

  const live = React.useRef({ clip, edit, projectId });
  live.current = { clip, edit, projectId };
  const flush = React.useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const l = pending.current; pending.current = null;
    if (!l) return;
    const { clip: c, edit: run, projectId: id } = live.current;
    await writeLayer(id, l);
    /* the clip is as long as its last cue */
    const len = round(cuesLength(l.cues as Cue[]));
    const have = c?.time?.[1];
    if (c && (have == null || Math.abs(have - len) > 0.01)) await run([{ op: 'set', clip: c.id, field: 'time', value: [0, len] } as Op], 'Subtitle length');
  }, []);
  React.useEffect(() => () => { void flush(); }, [flush]);

  const commit = (next: FrameLayer) => {
    setLayer(next); pending.current = next; livePreview(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 250);
  };
  const style = (layer ?? DEFAULT_SUBTITLE_STYLE) as unknown as SubtitleStyle;
  const cues = ((layer?.cues ?? []) as Cue[]).slice().sort((a, b) => a.start - b.start);
  const at = Math.max(0, timeMs / 1000);

  /* a line just added takes the keys at once, its placeholder selected: typing replaces it (and reaches no shortcut) */
  const [fresh, setFresh] = React.useState<string | null>(null);
  const addCue = async () => {
    const cue = newCue(round(at), 'Add text', 2);
    if (!layer || !clip) {
      const fresh = makeLayer('shape', { id: `${SUB_PREFIX}-${Date.now().toString(36)}`, kind: 'subtitle', name: 'Subtitles', ...DEFAULT_SUBTITLE_STYLE, cues: [cue], duration: cue.start + cue.duration } as never);
      await writeLayer(projectId, fresh);
      const fail = await edit([{ op: 'insert', clip: { src: `frame/${fresh.id}.html`, id: fresh.id, time: [0, round(cue.start + cue.duration)] }, at: 0, newTrack: 0 } as Op], 'Add subtitle');
      if (fail) { notify(fail); return; }
      onNameLine?.(fresh.id, 'Subtitles');
      setLayer(fresh);
    } else commit({ ...layer, cues: [...(layer.cues as Cue[]), cue] });
    setSelected(cue.id); setFresh(cue.id);
  };
  const patchCue = (id: string, p: Partial<Cue>) => layer && commit({ ...layer, cues: (layer.cues as Cue[]).map((c) => (c.id === id ? { ...c, ...p,...(p.text!=null&&p.text!==c.text?{wordTimes:undefined}:{}) } : c)) });
  const removeCue = (id: string) => layer && commit({ ...layer, cues: (layer.cues as Cue[]).filter((c) => c.id !== id) });
  const patchStyle = (p: Partial<SubtitleStyle>) => { if (layer) commit({ ...layer, ...p }); };

  if (view === 'choose') {
    return (
      <div className="flex flex-col gap-2 p-2">
        <h2 className="px-1 pb-1 pt-1 text-[14px] font-semibold text-[var(--text)]">Select subtitles</h2>
        <ChoiceCard icon={<Sparkles size={17} />} title="AI subtitles" text="Automatically recognize speech and add subtitles" onClick={() => go('ai')} />
        <ChoiceCard icon={<Captions size={17} />} title="Manual subtitles" text="Add subtitles manually with custom timing" onClick={() => go('manual')} />
      </div>
    );
  }
  if (view === 'ai') {
    return (
      <div className="flex flex-col gap-3 p-2">
        <Header title="AI subtitles" onBack={() => go('choose')} />
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
          Recognizing speech needs a transcription service. None is connected in this editor, so nothing is sent anywhere.
          Type or paste your lines in manual subtitles instead; the styles and animations are the same.
        </div>
        <button type="button" className={T.primary} onClick={() => go('manual')}>Use manual subtitles</button>
      </div>
    );
  }
  return (
    <div className="flex min-h-full flex-col gap-2 p-2">
      <div className="flex items-center gap-1">
        <Header title="Subtitles" onBack={() => go('choose')} />
        <div className={`${segWrap} ml-auto w-[150px]`} role="tablist">
          <button role="tab" aria-selected={mode === 'edit'} className={seg(mode === 'edit')} onClick={() => setMode('edit')}><Pencil size={12} />Edit</button>
          <button role="tab" aria-selected={mode === 'style'} className={seg(mode === 'style')} onClick={() => setMode('style')}><Paintbrush size={12} />Style</button>
        </div>
      </div>
      {mode === 'edit' ? (
        <div className="flex flex-col gap-1">
          {cues.map((c) => {
            const on = selected === c.id;
            return (
              <div key={c.id} onClick={() => { setSelected(c.id); seek(c.start); }}
                className={`flex flex-col gap-0.5 rounded-lg px-2.5 pb-1.5 pt-2 transition ${on ? 'bg-[var(--bg-hover)]' : 'hover:bg-[var(--bg-hover)]'}`}>
                <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--text-muted)]">
                  {on ? (
                    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <TimeInput label="Start" value={c.start} onChange={(v) => patchCue(c.id, { start: v })} />
                      <span>–</span>
                      <TimeInput label="End" value={c.start + c.duration} onChange={(v) => patchCue(c.id, { duration: Math.max(0.2, v - c.start) })} />
                    </span>
                  ) : <span>{fmt(c.start)} - {fmt(c.start + c.duration)}</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <button type="button" className={T.icon} aria-label="Subtitle style" title="Style" onClick={(e) => { e.stopPropagation(); setMode('style'); }}><Palette size={13} /></button>
                    <button type="button" className={T.icon} aria-label="Delete subtitle" onClick={(e) => { e.stopPropagation(); removeCue(c.id); }}><Trash2 size={13} /></button>
                  </span>
                </div>
                <AutoText value={c.text} focus={fresh === c.id} onFocus={() => { setSelected(c.id); seek(c.start); }} onChange={(text) => patchCue(c.id, { text })} />
              </div>
            );
          })}
          <button type="button" className={`${T.secondary} mt-1 font-medium`} onClick={() => void addCue()}><Plus size={13} />Add subtitle</button>
          {!cues.length ? <p className={`${T.hint} pt-1`}>A subtitle is added at the playhead. Type straight into it; it shows on the video as you type.</p> : null}
        </div>
      ) : (
        <StyleView value={style} disabled={!layer} onChange={patchStyle} onNeedCue={() => void addCue()} />
      )}
    </div>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="flex h-8 items-center gap-0.5 rounded-md pr-2 text-[14px] font-semibold text-[var(--text)] transition hover:text-[var(--accent)]">
      <ChevronLeft size={17} />{title}
    </button>
  );
}

function ChoiceCard({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5 text-left transition hover:border-[var(--border-strong)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.05)]">
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--accent)]">{icon}</span>
      <span className="text-[13.5px] font-semibold text-[var(--text)]">{title}</span>
      <span className="text-[11.5px] text-[var(--text-muted)]">{text}</span>
    </button>
  );
}

/* The cue's words, edited in place: a borderless textarea that grows with its text, as in Crayo */
function AutoText({ value, onChange, onFocus, focus = false }: { value: string; onChange: (v: string) => void; onFocus: () => void; focus?: boolean }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { if (focus && ref.current) { ref.current.focus(); ref.current.select(); } }, [focus]);
  React.useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = '0px'; el.style.height = `${el.scrollHeight}px`; } }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} aria-label="Subtitle text" onFocus={onFocus} onChange={(e) => onChange(e.target.value)} onClick={(e) => e.stopPropagation()}
      className="w-full resize-none overflow-hidden bg-transparent text-[13px] leading-snug text-[var(--text)] outline-none" />
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <input aria-label={label} type="number" step={0.1} min={0} value={Math.round(value * 100) / 100} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className="h-6 w-[58px] rounded border border-[var(--border)] bg-[var(--bg)] px-1 text-[11px] tabular-nums text-[var(--text)] outline-none focus:border-[var(--accent)]" />
  );
}

/* Style: Word / Lines, a grid of preview tiles, and the gear for text, position, colors and motion */
function StyleView({ value, onChange, disabled, onNeedCue }: { value: SubtitleStyle; onChange: (p: Partial<SubtitleStyle>) => void; disabled: boolean; onNeedCue: () => void }) {
  const [settings, setSettings] = React.useState(false);
  if (disabled) return (
    <div className="flex flex-col gap-2 pt-2">
      <p className={T.hint}>Add a subtitle first; the style applies to all of them.</p>
      <button type="button" className={T.secondary} onClick={onNeedCue}><Plus size={13} />Add subtitle</button>
    </div>
  );
  const lines = value.mode === 'Lines';
  const ids = Object.keys(lines ? LINE_STYLES : WORD_PRESETS).map(Number);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className={`${segWrap} w-[140px]`}>
          {(['Word', 'Lines'] as const).map((m) => <button key={m} type="button" aria-pressed={value.mode === m} className={seg(value.mode === m)} onClick={() => onChange({ mode: m, styleId: m === 'Lines' ? 1 : 2 })}>{m}</button>)}
        </div>
        <button type="button" aria-pressed={settings} title="Text, position, colors and motion" aria-label="Subtitle settings" onClick={() => setSettings((v) => !v)}
          className={`ml-auto flex h-7 w-7 items-center justify-center rounded-md transition ${settings ? 'text-[var(--accent)] hover:bg-[var(--bg-hover)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}><Settings2 size={15} /></button>
      </div>
      {settings ? <SubtitleSettings value={value} onChange={onChange} /> : null}
      <div className="grid grid-cols-2 gap-2" role="listbox" aria-label="Subtitle styles">
        {ids.map((id) => <StyleTile key={id} id={id} lines={lines} on={value.styleId === id} onClick={() => onChange({ styleId: id })} />)}
      </div>
    </div>
  );
}

function StyleTile({ id, lines, on, onClick }: { id: number; lines: boolean; on: boolean; onClick: () => void }) {
  const css: React.CSSProperties = { fontSize: 22, lineHeight: 1, paintOrder: 'stroke fill' };
  if (lines) {
    const st = (LINE_STYLES as unknown as Record<number, { font: string; weight: number; italic?: boolean; upper?: boolean; fill: string; active: string; stroke?: string; strokeW?: number; box?: [string, number]; glow?: [string, number]; shadow?: [string, number]; drop?: number }>)[id];
    Object.assign(css, { fontFamily: st.font, fontWeight: st.weight, fontStyle: st.italic ? 'italic' : 'normal', color: st.active, textTransform: st.upper ? 'uppercase' : 'none',
      WebkitTextStroke: st.stroke ? `${Math.max(1, 22 * (st.strokeW ?? 0.08))}px ${st.stroke}` : undefined,
      textShadow: st.glow ? `0 0 10px ${st.glow[0]}` : st.drop ? '2px 2px 0 #000' : st.shadow ? `0 2px 8px ${st.shadow[0]}` : undefined,
      background: st.box ? st.box[0] : undefined, padding: st.box ? '3px 8px' : undefined, borderRadius: st.box ? 5 : undefined });
  } else {
    const [fill, edge] = (WORD_PRESETS as unknown as Record<number, [string, string]>)[id];
    Object.assign(css, { fontFamily: 'Sora, Inter, sans-serif', fontWeight: 800, color: fill, WebkitTextStroke: `2.5px ${edge}`, textShadow: '0 3px 6px rgba(0,0,0,.35)' });
  }
  return (
    <button type="button" role="option" aria-selected={on} title={`Style ${id}`} onClick={onClick}
      className={`flex h-[68px] items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(160deg,#868a95,#5d616c)] transition ${on ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--dock-pane)]' : 'hover:brightness-110'}`}>
      <span style={css}>Shorts</span>
    </button>
  );
}
