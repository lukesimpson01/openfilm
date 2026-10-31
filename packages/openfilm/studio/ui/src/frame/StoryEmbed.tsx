import React from 'react';
import { Plus, MessagesSquare, MessageSquareQuote, Scale, Scissors, Check, Loader2 } from 'lucide-react';
import type { Film, Op } from '@/api';
import { makeLayer, readLayer, writeLayer, livePreview, isFrameSrc, layerIdOf, round, type FrameLayer } from './layers';
import { chatLength, redditLength, wyrLength, type ChatMessage, type RedditPost, type WyrQuestion, type WyrTiming } from './StoryFields';
import { SHORTS_HOME } from './FrameRail';
import { placeClip } from './lines';
import { seg, segWrap } from './ui';

/* The story tools of the Shorts home page, shown as they are in the sidebar: the tool's own menu runs in a frame
   (Shorts' /embed/<tool>) and sends its state here on every change; that state becomes the story clip's layer. The
   tool's state is kept on the layer too, so selecting the clip later opens the menu just as it was left. */
export type StoryKind = 'chat' | 'reddit' | 'wyr';
/** The Tools tab: the three story tools and the AI clipper (AutoClip), which hands back a source video */
export type ToolKind = StoryKind | 'clip';
const TOOL: Record<ToolKind, { path: string; label: string; short?: string; icon: React.ReactNode }> = {
  chat: { path: 'text-video', label: 'Fake text', icon: <MessagesSquare size={13} /> },
  reddit: { path: 'reddit-video', label: 'Reddit', icon: <MessageSquareQuote size={13} /> },
  wyr: { path: 'would-you-rather', label: 'Would you rather', short: 'WYR', icon: <Scale size={13} /> },
  clip: { path: 'auto-clip', label: 'AI clipper', short: 'Clipper', icon: <Scissors size={13} /> },
};
const shortsOrigin = () => { try { return new URL(SHORTS_HOME()).origin; } catch { return 'http://127.0.0.1:4173'; } };
/* the tools play the 60 fps cuts; the editor ships the 30 fps ones under the same names */
const baseFile = (f?: string) => (f || 'minecraft-01.mp4').replace('-60.mp4', '.mp4');

type ToolState = Record<string, any>;
/** What the story's page needs, from a tool's state. */
function fromTool(kind: StoryKind, s: ToolState): Partial<FrameLayer> {
  if (kind === 'chat') {
    const messages: ChatMessage[] = (s.messages ?? []).map((m: any, i: number) => ({ id: m.id ?? `m${i}`, side: m.side === 'right' ? 'right' : 'left', text: String(m.text ?? ''), ...(m.imageUrl && !String(m.imageUrl).startsWith('blob:') ? { imageUrl: m.imageUrl } : {}) }));
    return { contact: s.name || 'Unknown', skin: typeof s.theme === 'string' ? s.theme : 'ios-dark', messages };
  }
  if (kind === 'reddit') {
    const posts: RedditPost[] = [{ id: 'first', author: s.name, title: s.title, body: s.script, votes: s.votes?.[0], comments: s.votes?.[1], imageUrl: s.image, avatarUrl: s.avatar }, ...(s.extraPosts ?? [])]
      .map((p: any, i: number) => ({ id: p.id ?? `p${i}`, author: p.author ?? '', title: p.title ?? '', body: p.body ?? '', votes: String(p.votes ?? ''), comments: String(p.comments ?? ''), ...(p.imageUrl ? { imageUrl: p.imageUrl } : {}), ...(p.avatarUrl ? { avatarUrl: p.avatarUrl } : {}) }));
    return { posts, dark: !!s.dark };
  }
  const questions: WyrQuestion[] = (s.questions ?? []).map((q: any, i: number) => ({ id: `q${i}`, a: q.a, b: q.b, percent: Number(q.percent) || 0, label: q.label !== false, ...(q.imageA ? { imageA: q.imageA } : {}), ...(q.imageB ? { imageB: q.imageB } : {}) }));
  return { questions, timing: s.timing as WyrTiming };
}
function lengthOf(kind: StoryKind, l: Partial<FrameLayer>) {
  return kind === 'chat' ? chatLength(l.messages as ChatMessage[]) : kind === 'reddit' ? redditLength(l.posts as RedditPost[]) : wyrLength(l.questions as WyrQuestion[], l.timing as WyrTiming);
}

export function StoryEmbed({ projectId, folder, film, timeMs, edit, notify, selected, onSelectClip, start, onNameLine }: {
  projectId: string; folder: string; film: Film | null; timeMs: number; notify: (m: string) => void;
  edit: (ops: Op[], label: string) => Promise<string | null>; onSelectClip: (id: string) => void;
  selected: { clipId?: string; src?: string; startMs: number; endMs: number } | null; start?: StoryKind | null;
  onNameLine?: (clipId: string, label: string) => void;
}) {
  const [kind, setKind] = React.useState<ToolKind>(start ?? 'chat');
  React.useEffect(() => { if (start) setKind(start); }, [start]);
  /* the selected clip, when it is a story: the menu edits it */
  const [editing, setEditing] = React.useState<FrameLayer | null>(null);
  const selectedId = selected && isFrameSrc(selected.src) ? layerIdOf(selected.src!) : null;
  /* "New story" while one is selected: the menu starts fresh until another clip is picked */
  const [fresh, setFresh] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    if (!selectedId || selectedId === fresh) { setEditing(null); return; }
    readLayer(folder, selectedId).then((l) => { if (!live) return; if (l && (l.kind === 'chat' || l.kind === 'reddit' || l.kind === 'wyr')) { setEditing(l); setKind(l.kind as StoryKind); } else setEditing(null); });
    return () => { live = false; };
  }, [folder, selectedId, fresh]);

  const frame = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(()=>{const theme=()=>frame.current?.contentWindow?.postMessage({type:'shorts-embed-theme',theme:document.documentElement.dataset.theme??'light'},shortsOrigin());window.addEventListener('frame-theme',theme);const observer=new MutationObserver(theme);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>{window.removeEventListener('frame-theme',theme);observer.disconnect();};},[]);
  const latest = React.useRef<ToolState | null>(null);
  const editingRef = React.useRef(editing); editingRef.current = editing;
  const live = React.useRef({ edit, film, projectId, selected, timeMs }); live.current = { edit, film, projectId, selected, timeMs };
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = React.useState(false);

  /* a gameplay picked in the tool goes under the story: the clip made with it is pointed at the new file */
  const importGameplay = React.useCallback(async (file: string) => {
    const r = await fetch(`/assets/media/fake-text-gameplay/${file}`);
    if (!r.ok) return null;
    const up = await fetch(`/api/projects/${live.current.projectId}/files?path=${encodeURIComponent(`video/${file}`)}`, { method: 'PUT', body: await r.blob() });
    return up.ok ? ((await up.json()).path as string) : null;
  }, []);

  const save = React.useCallback(async (state: ToolState) => {
    const layer = editingRef.current;
    if (!layer) return;
    /* the tool reports its starting state as soon as it opens: nothing changed, nothing to write */
    if (JSON.stringify(state) === JSON.stringify(layer.toolState)) return;
    /* a story the editor AI wrote: the tool's first report is that script read back in its own words (and its own
       gameplay pick); it becomes the baseline, and the story is left as written */
    if (layer.toolState?.aiSeed) { const seeded: FrameLayer = { ...layer, toolState: state }; setEditing(seeded); void writeLayer(live.current.projectId, seeded, true); return; }
    const k = layer.kind as StoryKind;
    const next: FrameLayer = { ...layer, ...fromTool(k, state), toolState: state };
    next.duration = lengthOf(k, next);
    setEditing(next); livePreview(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await writeLayer(live.current.projectId, next, false);
      const sel = live.current.selected;
      const ops: Op[] = [];
      if (sel?.clipId && Math.abs((sel.endMs - sel.startMs) / 1000 - next.duration) > 0.05) ops.push({ op: 'set', clip: sel.clipId, field: 'time', value: [0, round(next.duration)] } as Op);
      if (k !== 'wyr' && (next.videoClip || next.background) && baseFile(state.gameplayFile) !== layer.gameplay) {
        const path = await importGameplay(baseFile(state.gameplayFile));
        if (path) {
          next.gameplay = baseFile(state.gameplayFile);
          /* older stories have their gameplay as a clip of its own under them; newer ones draw it in the page */
          if (next.videoClip && !next.background) ops.push({ op: 'set', clip: next.videoClip, field: 'src', value: path } as Op);
          else { next.background = path; livePreview(next); }
          await writeLayer(live.current.projectId, next, true);
        }
      }
      if (ops.length) await live.current.edit(ops, 'Edit story');
    }, 500);
  }, [importGameplay]);

  /* the AI clipper's source video, put on the Video line (a YouTube link cannot be: nothing is downloaded from it) */
  const addSource = React.useCallback(async (file: File | null, link: string | null) => {
    if (!file) { notify(link ? 'A YouTube link stays a link: upload the video file to put it on the timeline.' : 'Upload a video first.'); return; }
    const { edit: run, film: now, projectId: pid } = live.current;
    const name = file.name.replace(/[^\w.-]+/g, '-').slice(-80) || 'clip.mp4';
    const up = await fetch(`/api/projects/${pid}/files?path=${encodeURIComponent(`video/${name}`)}`, { method: 'PUT', body: file });
    if (!up.ok) { notify('The video could not be added to the project.'); return; }
    const path = (await up.json()).path as string;
    const probe = document.createElement('video'); probe.preload = 'metadata'; probe.src = URL.createObjectURL(file);
    const len = await new Promise<number>((done) => { probe.onloadedmetadata = () => done(probe.duration || 10); probe.onerror = () => done(10); setTimeout(() => done(10), 5000); });
    URL.revokeObjectURL(probe.src);
    const id = `clip-${Date.now().toString(36)}`;
    const placed = placeClip(now, { src: path, id, time: [0, round(len)] }, live.current.timeMs / 1000, len, 'media');
    const fail = await run([placed.op], 'Add clipper source');
    if (fail) { notify(fail); return; }
    if (placed.opened) onNameLine?.(id, placed.opened.label);
    onSelectClip(id);
    notify(`${file.name} is on the Video line.`);
  }, [notify, onNameLine, onSelectClip]);

  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data) return;
      if (e.data.type === 'shorts-embed-ready') frame.current?.contentWindow?.postMessage({ type: 'shorts-embed-init', state: editingRef.current?.toolState ?? null,theme:document.documentElement.dataset.theme??'light' }, shortsOrigin());
      if (e.data.type === 'shorts-embed-change') { latest.current = e.data.state; void save(e.data.state); }
      if (e.data.type === 'shorts-embed-media') void addSource(e.data.file as File | null, e.data.link as string | null);
      /* the tool's last step: its own "Add to timeline" */
      if (e.data.type === 'shorts-embed-add') void addRef.current();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [save, addSource]);

  const [added, setAdded] = React.useState(false);
  /* tells the tool's own last-step button how the add is going */
  const tell = (phase: 'start' | 'done' | 'error') => frame.current?.contentWindow?.postMessage({ type: 'shorts-embed-added', phase }, '*');
  const add = async () => {
    if (kind === 'clip' || busy) return;
    const state = latest.current;
    if (!state) { notify('The tool is still loading.'); tell('error'); return; }
    setBusy(true); tell('start');
    try {
      const ops: Op[] = [];
      const opened: [string, string][] = [];
      const at = Math.floor(timeMs) / 1000;
      if (!film?.tracks.some((t) => t.clips.length)) ops.push({ op: 'stage', w: 1080, h: 1920 });
      const body = fromTool(kind, state), duration = lengthOf(kind, body);
      const layer = makeLayer('shape', { id: `layer-story-${kind}-${Date.now().toString(36)}`, kind, name: kind === 'chat' ? 'Fake text story' : kind === 'reddit' ? 'Reddit story' : 'Would you rather', ...body, duration, toolState: state } as never);
      /* the gameplay plays inside the story's page, so the story is one clip on the Video line */
      if (kind !== 'wyr') {
        const file = baseFile(state.gameplayFile ?? (kind === 'reddit' ? 'subway-01.mp4' : undefined));
        const path = await importGameplay(file);
        if (path) Object.assign(layer, { background: path, gameplay: file });
      }
      await writeLayer(projectId, layer);
      const placedStory = placeClip(film, { src: `frame/${layer.id}.html`, id: layer.id, time: [0, round(duration)] }, at, duration, 'media');
      ops.push(placedStory.op);
      if (placedStory.opened) opened.push([layer.id, placedStory.opened.label]);
      const fail = await edit(ops, 'Add story');
      if (fail) throw new Error(fail);
      for (const [id, label] of opened) onNameLine?.(id, label);
      onSelectClip(layer.id);
      /* the new story settles into its place on the timeline */
      setTimeout(() => document.querySelector<HTMLElement>(`[data-block-id="${window.CSS.escape(layer.id)}"]`)?.animate(
        [{ opacity: 0, transform: 'translateY(8px) scaleX(.96)', transformOrigin: 'left center', filter: 'brightness(1.25)' }, { opacity: 1, transform: 'none', filter: 'none' }],
        { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' }), 160);
      tell('done'); setAdded(true); setTimeout(() => setAdded(false), 2400);
      notify(`${layer.name} is on the timeline.`);
    } catch (e) { notify(e instanceof Error ? e.message : String(e)); tell('error'); }
    finally { setBusy(false); }
  };
  const addRef = React.useRef(add); addRef.current = add;

  const tool = TOOL[kind];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border-soft)] px-2.5 pb-2.5 pt-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--accent)]">{tool.icon}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">Editing {tool.label.toLowerCase()} story</span>
            <button type="button" className="flex h-7 items-center gap-1 rounded-md px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]" onClick={() => setFresh(selectedId)}><Plus size={13} />New story</button>
          </div>
        ) : (
          <>
            <div className={segWrap}>
              {(Object.keys(TOOL) as ToolKind[]).map((k) => <button key={k} type="button" className={`${seg(kind === k)} whitespace-nowrap`} title={TOOL[k].label} onClick={() => setKind(k)}>{TOOL[k].icon}{TOOL[k].short ?? TOOL[k].label}</button>)}
            </div>
          </>
        )}
      </div>
      <iframe ref={frame} key={`${kind}:${editing?.id ?? 'new'}`} title={`${tool.label} tool`} src={`${shortsOrigin()}/embed/${tool.path}`}
        className="min-h-0 w-full flex-1 border-0 bg-white" />
      {/* a quiet footer: the tool's menu above is what the eye is for; adding is the last step */}
      {editing || kind === 'clip' ? null : (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-soft)] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-muted)]">Joins the Video line at the playhead</span>
          <button type="button" disabled={busy} onClick={() => void add()}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px] font-semibold text-white shadow-[0_6px_16px_rgba(69,104,238,0.25)] transition duration-200 active:scale-[0.98] ${added ? 'bg-[#16a34a]' : 'bg-[var(--accent)] hover:brightness-105'} ${busy ? 'cursor-progress opacity-90' : ''}`}>
            {busy ? <><Loader2 size={14} className="animate-spin" />Adding to timeline…</> : added ? <><Check size={14} />Added</> : <><Plus size={14} />Add to timeline</>}
          </button>
        </div>
      )}
    </div>
  );
}
