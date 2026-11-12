import type { ReactNode } from 'react';
import { Captions, Shapes, Sparkles, Music2, Zap, MessagesSquare, ChevronLeft, LibraryBig, Blend, Wand2, Box } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';

/* The tool rail down the whole left edge (as in the Shorts home tools): Home at the top, then each tool. A tool's
   icon and label turn blue when its panel is open; pressing it again closes the panel. */
export type FrameTab = 'subtitles' | 'layers' | 'animate' | 'transitions' | 'graphics' | 'scene3d' | 'music' | 'sfx' | 'stories' | 'media';
export const FRAME_TABS: { id: FrameTab; label: string; icon: ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <LibraryBig size={19} strokeWidth={1.7} /> },
  { id: 'subtitles', label: 'Subtitles', icon: <Captions size={19} strokeWidth={1.7} /> },
  { id: 'layers', label: 'Elements', icon: <Shapes size={19} strokeWidth={1.7} /> },
  { id: 'animate', label: 'Animate', icon: <Sparkles size={19} strokeWidth={1.7} /> },
  { id: 'transitions', label: 'Transitions', icon: <Blend size={19} strokeWidth={1.7} /> },
  { id: 'graphics', label: 'Motion graphics', icon: <Wand2 size={19} strokeWidth={1.7} /> },
  { id: 'scene3d', label: '3D', icon: <Box size={19} strokeWidth={1.7} /> },
  { id: 'music', label: 'Music', icon: <Music2 size={19} strokeWidth={1.7} /> },
  { id: 'sfx', label: 'Sound FX', icon: <Zap size={19} strokeWidth={1.7} /> },
  { id: 'stories', label: 'Tools', icon: <MessagesSquare size={19} strokeWidth={1.7} /> },
];
export const SHORTS_HOME = () => { try { return localStorage.getItem('shorts.homeUrl') || 'http://127.0.0.1:4173/dashboard'; } catch { return 'http://127.0.0.1:4173/dashboard'; } };

export function FrameRail({ tab, open, mediaOpen, onTab }: { tab: FrameTab; open: boolean; mediaOpen: boolean; onTab: (t: FrameTab) => void }) {
  return (
    <nav aria-label="Editor tools" className="flex w-[56px] shrink-0 flex-col items-center gap-1 overflow-y-auto overscroll-contain border-r border-[var(--border-soft)] bg-[var(--dock-pane)] px-1 pb-3 pt-2 [scrollbar-width:none]" data-frame-rail="">
      <Tooltip label="Back to Shorts" side="right">
        <a href={SHORTS_HOME()} aria-label="Back to Shorts" className="mb-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
          <ChevronLeft size={17} strokeWidth={1.7} />
        </a>
      </Tooltip>
      <span aria-hidden className="mb-1 h-px w-7 bg-[var(--border-soft)]" />
      {FRAME_TABS.map((t) => {
        const on = t.id === 'media' ? mediaOpen : open && tab === t.id;
        return (
          <Tooltip key={t.id} label={t.label} side="right">
            <button type="button" aria-label={t.label} aria-pressed={on} onClick={() => onTab(t.id)}
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-[background-color,color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${on ? 'bg-[var(--bg-active)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
              {on && <span aria-hidden className="absolute -left-1 top-3 h-4 w-[2px] rounded-full bg-[var(--accent)]" />}
              <span aria-hidden>{t.icon}</span>
            </button>
          </Tooltip>
        );
      })}
    </nav>
  );
}
