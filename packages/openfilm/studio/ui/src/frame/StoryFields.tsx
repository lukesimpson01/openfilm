import { Plus, Trash2, ArrowLeftRight } from 'lucide-react';
import { messageTimeline } from './chat-runtime.js';
import type { FrameLayer } from './layers';

/* The fields of the story layers: a fake text chat and Reddit posts. Used when making one and when editing it. */
export type ChatMessage = { id: string; side: 'left' | 'right'; text: string; imageUrl?: string };
export type RedditPost = { id: string; author: string; title: string; body: string; votes: string; comments: string; imageUrl?: string; avatarUrl?: string };

export const SKINS: [string, string][] = [['ios-dark', 'iMessage dark'], ['ios-light', 'iMessage light'], ['whatsapp-dark', 'WhatsApp dark'], ['whatsapp-light', 'WhatsApp light']];
const uid = () => Math.random().toString(36).slice(2, 8);
export const newMessage = (side: ChatMessage['side'], text = ''): ChatMessage => ({ id: `m${uid()}`, side, text });
export const newPost = (): RedditPost => ({ id: `p${uid()}`, author: 'u/throwaway123', title: '', body: '', votes: '12.4k', comments: '2.1k' });

export const SAMPLE_MESSAGES: ChatMessage[] = [newMessage('left', 'hello'), newMessage('right', 'hey bro'), newMessage('right', 'what is going on?'), newMessage('left', 'nothing much')];
export const chatLength = (messages: ChatMessage[]) => Math.max(1, (messageTimeline(messages.filter((m) => m.text.trim())) as { duration: number }).duration / 1000 + 1);
export const redditLength = (posts: RedditPost[]) => Math.max(5, posts.length * 5);

const field = 'h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)]';
const small = 'h-6 rounded border border-transparent bg-[var(--fill-tsp)] px-1.5 text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--accent)]';
const iconBtn = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

export function ChatFields({ value, onChange }: { value: { contact?: string; skin?: string; messages: ChatMessage[] }; onChange: (v: { contact: string; skin: string; messages: ChatMessage[] }) => void }) {
  const messages = value.messages, set = (m: ChatMessage[]) => onChange({ contact: value.contact ?? 'Unknown', skin: value.skin ?? 'ios-dark', messages: m });
  const patch = (i: number, p: Partial<ChatMessage>) => set(messages.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const paste = () => {
    const text = window.prompt('Paste a conversation. Start a line with “me:” or “them:” (otherwise it alternates).');
    if (!text) return;
    let side: ChatMessage['side'] = 'left';
    set(text.split('\n').filter((l) => l.trim()).map((l) => { const m = /^(me|them)\s*:\s*(.*)$/i.exec(l.trim()); if (m) side = m[1].toLowerCase() === 'me' ? 'right' : 'left'; else side = side === 'left' ? 'right' : 'left'; return newMessage(side, m ? m[2] : l.trim()); }));
  };
  return (
    <div className="flex flex-col gap-2">
      <input className={field} value={value.contact ?? ''} onChange={(e) => onChange({ contact: e.target.value, skin: value.skin ?? 'ios-dark', messages })} aria-label="Contact name" placeholder="Contact name" />
      <select className={field} value={value.skin ?? 'ios-dark'} onChange={(e) => onChange({ contact: value.contact ?? 'Unknown', skin: e.target.value, messages })} aria-label="Chat style">
        {SKINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <div className="flex flex-col gap-1" role="list" aria-label="Messages">
        {messages.map((m, i) => (
          <div key={m.id} role="listitem" className="flex items-center gap-1">
            <button type="button" title="Switch sender" aria-label={`Message ${i + 1} is from ${m.side === 'right' ? 'you' : 'them'}; switch`} onClick={() => patch(i, { side: m.side === 'right' ? 'left' : 'right' })}
              className={`flex h-6 w-9 shrink-0 items-center justify-center gap-0.5 rounded text-[10px] font-medium transition ${m.side === 'right' ? 'border border-[var(--accent)] bg-[var(--bg)] text-[var(--accent)]' : 'border border-transparent bg-[var(--fill-tsp)] text-[var(--text-dim)]'}`}>
              {m.side === 'right' ? 'Me' : 'Them'}
            </button>
            <input className={`${small} min-w-0 flex-1`} value={m.text} onChange={(e) => patch(i, { text: e.target.value })} aria-label={`Message ${i + 1}`} placeholder="Message" />
            <button type="button" className={iconBtn} aria-label={`Delete message ${i + 1}`} onClick={() => set(messages.filter((_, j) => j !== i))}><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button type="button" className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border)] text-[11.5px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" onClick={() => set([...messages, newMessage(messages.length && messages[messages.length - 1].side === 'left' ? 'right' : 'left')])}><Plus size={12} /> Message</button>
        <button type="button" className="flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border)] px-2 text-[11.5px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" onClick={paste}><ArrowLeftRight size={12} /> Paste chat</button>
      </div>
    </div>
  );
}

export function RedditFields({ value, onChange }: { value: { dark?: boolean; posts: RedditPost[] }; onChange: (v: { dark: boolean; posts: RedditPost[] }) => void }) {
  const posts = value.posts, set = (p: RedditPost[]) => onChange({ dark: !!value.dark, posts: p });
  const patch = (i: number, p: Partial<RedditPost>) => set(posts.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between text-[12px] text-[var(--text-dim)]">Dark card
        <input type="checkbox" checked={!!value.dark} onChange={(e) => onChange({ dark: e.target.checked, posts })} className="h-4 w-4 accent-[var(--accent)]" /></label>
      {posts.map((p, i) => (
        <div key={p.id} className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-2">
          <div className="flex items-center gap-1">
            <input className={`${small} min-w-0 flex-1`} value={p.author} onChange={(e) => patch(i, { author: e.target.value })} aria-label={`Post ${i + 1} author`} placeholder="u/author" />
            {posts.length > 1 ? <button type="button" className={iconBtn} aria-label={`Delete post ${i + 1}`} onClick={() => set(posts.filter((_, j) => j !== i))}><Trash2 size={12} /></button> : null}
          </div>
          <input className={small} value={p.title} onChange={(e) => patch(i, { title: e.target.value })} aria-label={`Post ${i + 1} title`} placeholder="Title" />
          <textarea className={`${small} h-16 resize-none py-1`} value={p.body} onChange={(e) => patch(i, { body: e.target.value })} aria-label={`Post ${i + 1} text`} placeholder="Story text (shows word by word)" />
          <div className="flex gap-1"><input className={`${small} w-1/2`} value={p.votes} onChange={(e) => patch(i, { votes: e.target.value })} aria-label="Votes" placeholder="Votes" /><input className={`${small} w-1/2`} value={p.comments} onChange={(e) => patch(i, { comments: e.target.value })} aria-label="Comments" placeholder="Comments" /></div>
        </div>
      ))}
      <button type="button" className="flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border)] text-[11.5px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" onClick={() => set([...posts, newPost()])}><Plus size={12} /> Post (5 s each)</button>
    </div>
  );
}

export type WyrQuestion = { id: string; a: string; b: string; percent: number; label: boolean; imageA?: string; imageB?: string };
export type WyrTiming = { countdown: number; results: number; gap: number };
export const DEFAULT_WYR_TIMING: WyrTiming = { countdown: 3, results: 2.4, gap: 0.55 };
export const newQuestion = (a = 'New choice A', b = 'New choice B', percent = 50): WyrQuestion => ({ id: `q${uid()}`, a, b, percent, label: true });
export const SAMPLE_QUESTIONS: WyrQuestion[] = [newQuestion('Get GTA VI early', 'Feed the homeless', 78), newQuestion('£10m now but you can never play video games again', 'A 10% chance of £100m', 22), newQuestion('Be able to fly', 'Be able to turn invisible', 55)];
/* the home tool's timing: A at 0.48 s, B at 1.33 s, countdown from 2.45 s, then results and a gap */
export const wyrLength = (questions: WyrQuestion[], timing: WyrTiming = DEFAULT_WYR_TIMING) => Math.max(1, questions.length * (2.45 + timing.countdown + timing.results + timing.gap));

export function WyrFields({ value, onChange }: { value: { questions: WyrQuestion[]; timing?: WyrTiming }; onChange: (v: { questions: WyrQuestion[]; timing: WyrTiming }) => void }) {
  const timing = value.timing ?? DEFAULT_WYR_TIMING, qs = value.questions;
  const set = (q: WyrQuestion[]) => onChange({ questions: q, timing });
  const patch = (i: number, p: Partial<WyrQuestion>) => set(qs.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-2">
      {qs.map((q, i) => (
        <section key={q.id} className="flex flex-col gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2.5">
          <div className="flex items-center text-[11px] font-medium text-[var(--text-muted)]">
            Question {i + 1}
            {qs.length > 1 ? <button type="button" className={`${iconBtn} ml-auto`} aria-label={`Delete question ${i + 1}`} onClick={() => set(qs.filter((_, j) => j !== i))}><Trash2 size={12} /></button> : null}
          </div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full bg-[#e8443a]" /><input className={`${small} h-7 flex-1`} value={q.a} onChange={(e) => patch(i, { a: e.target.value })} aria-label={`Question ${i + 1} option A`} /></div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full bg-[#3b82f6]" /><input className={`${small} h-7 flex-1`} value={q.b} onChange={(e) => patch(i, { b: e.target.value })} aria-label={`Question ${i + 1} option B`} /></div>
          <div className="flex items-center gap-2 text-[11px] tabular-nums text-[var(--text-dim)]">
            <span className="w-8 text-[#e8443a]">{q.percent}%</span>
            <input type="range" min={0} max={100} value={q.percent} onChange={(e) => patch(i, { percent: Number(e.target.value) })} aria-label={`Question ${i + 1} votes for A`} className="flex-1 accent-[var(--accent)]" />
            <span className="w-8 text-right text-[#3b82f6]">{100 - q.percent}%</span>
            <label className="flex items-center gap-1"><input type="checkbox" checked={q.label} onChange={(e) => patch(i, { label: e.target.checked })} className="h-3.5 w-3.5 accent-[var(--accent)]" />Label</label>
          </div>
        </section>
      ))}
      <button type="button" className="flex h-7 items-center justify-center gap-1 rounded-md border border-[var(--border)] text-[11.5px] text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]" onClick={() => set([...qs, newQuestion()])}><Plus size={12} /> Add question</button>
      <div className="grid grid-cols-3 gap-1.5 text-[10.5px] text-[var(--text-muted)]">
        {([['countdown', 'Countdown'], ['results', 'Results'], ['gap', 'Gap']] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-0.5">{label}
            <input type="number" min={0} max={10} step={0.1} value={timing[k]} onChange={(e) => onChange({ questions: qs, timing: { ...timing, [k]: Math.max(0, Number(e.target.value)) } })} className={`${small} h-7`} /></label>
        ))}
      </div>
    </div>
  );
}

/** The layer fields a story edit changes, and how long the story then runs. */
export function storyLength(layer: FrameLayer): number | null {
  if (layer.kind === 'chat') return chatLength(layer.messages as ChatMessage[]);
  if (layer.kind === 'reddit') return redditLength(layer.posts as RedditPost[]);
  if (layer.kind === 'wyr') return wyrLength(layer.questions as WyrQuestion[], layer.timing as WyrTiming);
  return null;
}
