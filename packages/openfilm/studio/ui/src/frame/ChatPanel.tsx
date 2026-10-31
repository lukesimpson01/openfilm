import React from 'react';
import { X, ArrowUp, Square, Plus, Paperclip, Check, CircleAlert, Loader2, Sparkles, Shuffle, ZoomIn, Type, Music, Volume2, Film as FilmIcon, Scissors, Box, Video, ScanLine, Wand2, Palette, Shapes, MessageSquare, Captions, MapPin, Move, Clock, Snowflake, ListChecks, ScanEye, Eye, PenTool, Layers, type LucideIcon } from 'lucide-react';
import type { Film, Op } from '@/api';
import { runAgent, visible, actionLabel, type ChatTurn } from './ai-agent';
import type { Action, ToolResult } from './ai-tools';
import { ScanOverlay } from './StageOverlay';
import { footageAt } from './zoom';
import { footageRect, clipFit } from './track-space.js';

/* The editor's AI chat: Clyra's own model, working on this project with every tool the editor has (ai-tools.ts).
   It slides in from the right. While it works the timeline shimmers, and each clip it adds settles into place.
   (It replaces the desktop app's agent chat, which needed a chat host and knew nothing of the editor's tools.) */
type Row = { id: string; action: Action; state: 'running' | 'done' | 'failed'; result?: ToolResult };
type Msg = { id: string; role: 'user' | 'assistant'; text: string; rows?: Row[]; plan?: string[] };
/* what each action looks like in the list: an icon for the kind of work, so a run reads at a glance */
const ICON: Record<string, LucideIcon> = {
  add_motion_graphic: Sparkles, update_motion_graphic: Sparkles, create_graphic: PenTool, update_graphic: PenTool, add_transition: Shuffle, update_transition: Shuffle, apply_transition_to_all_cuts: Shuffle,
  add_zoom: ZoomIn, add_text: Type, add_shape: Shapes, update_layer: Layers, animate: Wand2, add_sound: Volume2, add_music: Music, set_volume: Volume2, add_media: FilmIcon, place_clip: Move, move_clip: Move,
  split_clip: Scissors, remove_clip: Scissors, set_length: Clock, set_speed: Clock, set_fade: Wand2, set_look: Palette, set_line: Layers, duplicate_clip: Layers, clip_video: Scissors,
  add_device: Box, update_device: Box, add_camera: Video, update_camera: Video, freeze_frame: Snowflake, add_effect: Wand2, analyse_footage: ScanLine, add_tracked: MapPin,
  add_story: MessageSquare, add_subtitles: Captions, find_place: MapPin, seek: Clock, open_tool: Layers,
  update_tracked: Move, inspect_layer: Eye, review_project: ScanEye,
  inspect_spatial:Box,place_spatial:MapPin,refine_spatial_foreground:ScanLine,inspect_video:ScanEye,inspect_scene:ScanEye,inspect_track:ScanEye,track_target:ScanEye,correct_track:ScanEye,follow_target:ScanEye,attach_target:ScanEye,inspect_model:Box,add_model:Box,append_model_animation:Box,set_3d_keyframe:Box, append_device_action:Box,
};
const phaseIcon = (p: string): LucideIcon => (/^Plan/i.test(p) ? ListChecks : /^Review/i.test(p) ? ScanEye : /^Check/i.test(p) ? Eye : /scan|analys/i.test(p) ? ScanLine : Sparkles);
const uid = () => Math.random().toString(36).slice(2, 10);
const store = (projectId: string) => `shorts.ai.chat.${projectId}`;
const SUGGEST = [
  'Make a hook: a bold title, a punch-in zoom and a whoosh in the first 2s',
  'Put my app recording on a 3D iPhone with a hero camera move',
  'Add a game-style location title on the wall that people walk past',
  'Design a new animated stat card for 1,000,000 views',
];

/* the timeline shimmers while the AI works; a clip it adds rises into place */
const STYLE = `
[data-ai-working] [data-timeline] { position: relative; }
[data-ai-working] [data-timeline]::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 30;
  background: linear-gradient(100deg, transparent 0%, transparent 35%, color-mix(in srgb, var(--accent) 14%, transparent) 50%, transparent 65%, transparent 100%);
  background-size: 250% 100%; animation: ai-sweep 1.8s linear infinite; }
@keyframes ai-sweep { from { background-position: 125% 0; } to { background-position: -125% 0; } }
@keyframes ai-shimmer { from { background-position: 100% 0; } to { background-position: 0% 0; } }
.ai-tile { position: relative; overflow: hidden; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
.ai-tile::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 30%, color-mix(in srgb, var(--accent) 28%, transparent) 50%, transparent 70%); background-size: 250% 100%; animation: ai-sweep 1.4s linear infinite; }
.ai-shimmer { background: linear-gradient(100deg, var(--text-faint) 0%, var(--text-faint) 38%, var(--text) 50%, var(--text-faint) 62%, var(--text-faint) 100%); background-size: 260% 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; animation: ai-shimmer 2.2s linear infinite; }
@keyframes ai-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes ai-orb { 0%, 100% { transform: scale(.7); opacity: .5; } 50% { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { [data-ai-working] [data-timeline]::after, [data-chat-panel] *, .ai-shimmer, .ai-tile::after { animation: none !important; transition: none !important; } }
`;
function reveal(ids: string[]) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  /* after the film has re-rendered with them */
  setTimeout(() => {
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${window.CSS.escape(id)}"]`);
      el?.animate([{ opacity: 0, transform: 'translateY(8px) scaleX(.96)', transformOrigin: 'left center', filter: 'brightness(1.25)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }, 160);
}

function Text({ text }: { text: string }) {
  const inline=(s:string)=>s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')?<strong key={i} className="font-semibold">{part.slice(2,-2)}</strong>:part.startsWith('`')?<code key={i} className="rounded bg-[var(--fill-tsp)] px-1 py-0.5 text-[11.5px]">{part.slice(1,-1)}</code>:part);
  return (
    <div className="flex flex-col gap-2 text-[13px] leading-[1.55] text-[var(--text)]">
      {text.split(/\n{2,}/).map((para, i) => {
        const lines = para.split('\n'); const items = lines.filter((l) => /^\s*[-•*]\s+/.test(l));
        if (items.length && items.length === lines.length) return <ul key={i} className="flex list-disc flex-col gap-1 pl-4">{items.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>)}</ul>;
        return <p key={i} className="whitespace-pre-wrap break-words">{inline(para)}</p>;
      })}
    </div>
  );
}

export function ChatPanel({ open, onClose, projectId, folder, film, edit, timeMs, seek, select, nameLine }: {
  open: boolean; onClose: () => void; projectId: string; folder?: string;
  film?: () => Film | null; edit?: (ops: Op[], label: string) => Promise<string | null>; timeMs?: () => number;
  seek?: (ms: number) => void; select?: (clipId: string) => void; nameLine?: (clipId: string, label: string) => void;
}) {
  const [msgs, setMsgs] = React.useState<Msg[]>(() => { try { return JSON.parse(localStorage.getItem(store(projectId)) || '[]'); } catch { return []; } });
  const [draft, setDraft] = React.useState('');
  const [phase, setPhase] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [scanSource,setScanSource]=React.useState<{source:string;rect:{x:number;y:number;w:number;h:number};from:number;to:number}|undefined>();
  const scanProbe=React.useRef<HTMLVideoElement|null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  React.useEffect(()=>()=>{abort.current?.abort();if(scanProbe.current){scanProbe.current.removeAttribute('src');scanProbe.current.load();}},[projectId]);
  React.useEffect(() => { try { localStorage.setItem(store(projectId), JSON.stringify(msgs.slice(-40))); } catch { /* full */ } }, [msgs, projectId]);
  React.useEffect(() => { const el = list.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [msgs, phase]);
  React.useEffect(() => {
    if (!open) return undefined;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [open, onClose, busy]);
  React.useEffect(() => { if (busy) document.documentElement.setAttribute('data-ai-working', ''); else document.documentElement.removeAttribute('data-ai-working'); return () => document.documentElement.removeAttribute('data-ai-working'); }, [busy]);

  const send = async (text: string) => {
    const t = text.trim(); if (!t || busy || !film || !edit || !folder) return;
    setDraft('');
    const history: ChatTurn[] = msgs.map((m) => ({ role: m.role, content: m.text })).filter((m) => m.content);
    const reply: Msg = { id: uid(), role: 'assistant', text: '', rows: [] };
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: t }, reply]);
    const patch = (fn: (m: Msg) => Msg) => setMsgs((all) => all.map((m) => (m.id === reply.id ? fn(m) : m)));
    setBusy(true); abort.current = new AbortController();
    try {
      /* each edit is waited on until the film shows it, so the next action reads the timeline as it now is */
      const settled = async (ops: Op[], label: string) => {
        const before = film(); const fail = await edit(ops, label);
        for (let i = 0; !fail && i < 40 && film() === before; i++) await new Promise((r) => setTimeout(r, 25));
        return fail;
      };
      await runAgent(history, t, {
        projectId, folder, film, edit: settled, timeMs: timeMs ?? (() => 0), seek: seek ?? (() => {}), select: select ?? (() => {}), nameLine: nameLine ?? (() => {}),
        progress: () => {}, signal: abort.current.signal,
      }, {
        text: (shown) => patch((m) => ({ ...m, text: shown })),
        plan: (steps) => patch((m) => ({ ...m, plan: steps })),
        phase: (p) => setPhase(p),
        action: (a, state, result) => {
          if(['analyse_footage','add_tracked','refine_spatial_foreground','inspect_video','inspect_scene'].includes(a.tool)){
            if(scanProbe.current){scanProbe.current.onloadedmetadata=null;scanProbe.current.removeAttribute('src');scanProbe.current.load();scanProbe.current=null;}
            setScanSource(undefined);
            const current=film(),f=footageAt(current,(timeMs?.()??0)/1000,typeof a.clip==='string'?a.clip:undefined);
            if(state==='running'&&f&&/\.(mp4|mov|webm|m4v)$/i.test(f.clip.src.split('#')[0])){
              const video=document.createElement('video'),source=`${folder}${f.clip.src.split('#')[0]}`;scanProbe.current=video;
              video.preload='metadata';video.onloadedmetadata=()=>{
                if(scanProbe.current!==video||abort.current?.signal.aborted)return;
                const from=f.clip.time?.[0]??0,to=Math.min(video.duration,from+(f.end-f.start)*(f.clip.speed||1));
                setScanSource({source,from,to,rect:footageRect(current?.stage?.w??1080,current?.stage?.h??1920,video.videoWidth,video.videoHeight,f.clip.box,clipFit(f.clip))});
                video.onloadedmetadata=null;video.removeAttribute('src');video.load();scanProbe.current=null;
              };video.src=source;
            }
          }
          patch((m) => {
            const rows = [...(m.rows ?? [])]; const i = rows.findIndex((r) => r.action === a);
            if (i >= 0) rows[i] = { ...rows[i], state, result }; else rows.push({ id: uid(), action: a, state, result });
            return { ...m, rows };
          });
          if (state === 'done' && result?.clipIds?.length) reveal(result.clipIds);
        },
      });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') patch((m) => ({ ...m, text: `${m.text ? `${m.text}\n\n` : ''}${e instanceof Error ? e.message : String(e)}` }));
    } finally { setBusy(false); setPhase(null);setScanSource(undefined);patch(m=>({...m,rows:m.rows?.map(r=>r.state==='running'?{...r,state:'failed',result:{ok:false,message:'Stopped before this action completed.'}}:r)})); abort.current = null; }
  };
  const attach = async (f: File) => {
    const path = `assets/${f.name.replace(/[^\w.-]+/g, '-')}`;
    const r = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: 'PUT', body: f });
    if (r.ok) { const p = ((await r.json()) as { path?: string }).path ?? path; setDraft((d) => `${d}${d ? ' ' : ''}[${p}]`); }
  };

  return (
    <aside data-chat-panel="" aria-hidden={!open || undefined}
      className={`fixed bottom-2 right-2 top-[52px] z-[130] flex w-[400px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_24px_60px_rgba(15,23,42,0.22)] transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(.2,.8,.2,1)] ${open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-[calc(100%+24px)] opacity-0'}`}>
      <style>{STYLE}</style>
      {scanSource?<ScanOverlay rect={scanSource.rect} seen={null} source={scanSource.source} from={scanSource.from} to={scanSource.to}/>:null}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-soft)] px-3">
        <span className="flex-1 text-[13px] font-semibold text-[var(--text)]">Clyra AI</span>
        <button type="button" disabled={busy || !msgs.length} onClick={() => setMsgs([])} aria-label="New chat" title="New chat" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-30"><Plus size={15} /></button>
        <button type="button" onClick={onClose} aria-label="Close the chat" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={15} /></button>
      </div>
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!msgs.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center" style={{ animation: 'ai-in .3s cubic-bezier(.22,1,.36,1) both' }}>
            <p className="text-[14px] font-semibold text-[var(--text)]">What should we make?</p>
            <p className="max-w-[280px] text-[12px] leading-relaxed text-[var(--text-muted)]">Edit clips, reuse or design motion graphics, track text into a video, and shape 3D camera paths. Clyra reads your project, makes editable changes and checks what was saved.</p>
            <div className="mt-1 flex w-full flex-col gap-1.5">
              {SUGGEST.map((s) => <button key={s} type="button" onClick={() => void send(s)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-left text-[12px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--text)]">{s}</button>)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {msgs.map((m) => m.role === 'user' ? (
              <div key={m.id} className="ml-auto max-w-[85%] rounded-2xl bg-[var(--fill-tsp)] px-3.5 py-2 text-[13px] leading-[1.5] text-[var(--text)]" style={{ animation: 'ai-in .3s cubic-bezier(.22,1,.36,1) both' }}>{m.text}</div>
            ) : (
              <div key={m.id} className="flex flex-col gap-2.5" style={{ animation: 'ai-in .3s cubic-bezier(.22,1,.36,1) both' }}>
                {m.plan?.length ? (
                  <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--fill-tsp)]/60 px-3 py-2" style={{ animation: 'ai-in .28s cubic-bezier(.22,1,.36,1) both' }}>
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]"><ListChecks size={12} />Plan</div>
                    <ol className="flex flex-col gap-0.5">{m.plan.map((p, i) => <li key={i} className="flex gap-2 text-[12px] leading-snug text-[var(--text-dim)]" style={{ animation: `ai-in .3s cubic-bezier(.22,1,.36,1) ${i * 60}ms both` }}><span className="w-3 shrink-0 tabular-nums text-[var(--text-faint)]">{i + 1}</span><span className="min-w-0">{p}</span></li>)}</ol>
                  </div>
                ) : null}
                {m.rows?.length ? (
                  <ul className="flex flex-col gap-1">
                    {m.rows.map((r) => { const Ic = ICON[r.action.tool] ?? Sparkles; return (
                      <li key={r.id} className="flex items-start gap-2.5 text-[12px] text-[var(--text-dim)]" title={r.result?.message} style={{ animation: 'ai-in .24s cubic-bezier(.22,1,.36,1) both' }}>
                        <span className={`relative mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${r.state === 'running' ? 'ai-tile border-[var(--accent)]/40 text-[var(--accent)]' : r.state === 'done' ? 'border-[var(--border-soft)] bg-[var(--fill-tsp)] text-[var(--text)]' : 'border-[#dc2626]/30 text-[#dc2626]'}`}>
                          <Ic size={13} />
                          {r.state === 'done' ? <span className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-[var(--accent)] text-white ring-2 ring-[var(--bg)]"><Check size={8} strokeWidth={3.5} /></span> : null}
                          {r.state === 'failed' ? <span className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-[#dc2626] text-white ring-2 ring-[var(--bg)]"><CircleAlert size={8} /></span> : null}
                          {r.state === 'running' ? <Loader2 size={22} className="absolute animate-spin text-[var(--accent)]/35" strokeWidth={1.5} /> : null}
                        </span>
                        <span className="min-w-0 pt-[3px]"><span className={r.state === 'running' ? 'ai-shimmer font-medium' : r.state === 'done' ? 'text-[var(--text)]' : ''}>{actionLabel(r.action, r.state === 'running')}</span>
                          {r.state === 'failed' && r.result ? <span className="block text-[11px] text-[var(--text-faint)]">{r.result.message}</span> : null}</span>
                      </li>); })}
                  </ul>
                ) : null}
                {visible(m.text) ? <Text text={visible(m.text)} /> : null}
              </div>
            ))}
            {phase ? (
              <div role="status" aria-live="polite" className="flex items-center gap-2 text-[12.5px]" style={{ animation: 'ai-in .28s cubic-bezier(.22,1,.36,1) both' }}>
                {(() => { const Ic = phaseIcon(phase); return <span aria-hidden className="ai-tile flex h-6 w-6 items-center justify-center rounded-lg border border-[var(--accent)]/40 text-[var(--accent)]"><Ic size={13} style={{ animation: 'ai-orb 1.6s cubic-bezier(.45,0,.55,1) infinite' }} /></span>; })()}
                <span className="ai-shimmer font-medium">{phase}…</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="shrink-0 p-3 pt-0">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-2 transition focus-within:border-[var(--accent)]">
          <textarea aria-label="Ask Clyra to edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder="Ask Clyra to edit, add or clip…"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            className="block w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-[1.45] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach a video or photo" title="Attach a video or photo" className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Paperclip size={14} /></button>
            <input ref={fileInput} type="file" accept="video/*,image/*,.fbx,.glb,.gltf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} aria-label="Stop" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)]"><Square size={11} fill="currentColor" /></button>
            ) : (
              <button type="button" onClick={() => void send(draft)} disabled={!draft.trim()} aria-label="Send" className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-white transition disabled:opacity-30"><ArrowUp size={14} /></button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
