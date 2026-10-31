import { Captions, Shapes, Sparkles, Music2, Zap, MessagesSquare, ChevronLeft, LibraryBig, Blend, Wand2, Box } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';

/* The tool rail down the whole left edge (as in the Shorts home tools): Home at the top, then each tool. A tool's
   icon and label turn blue when its panel is open; pressing it again closes the panel. */
export type FrameTab = 'subtitles' | 'layers' | 'animate' | 'transitions' | 'graphics' | 'scene3d' | 'music' | 'sfx' | 'stories' | 'media';
export const FRAME_TABS: { id: FrameTab; label: string; icon: React.ReactNode }[] = [
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
    <nav aria-label="Tools" className="flex w-[68px] shrink-0 flex-col items-center gap-0 overflow-y-auto overscroll-contain border-r border-[var(--border-soft)] bg-[var(--dock-pane)] pb-2 pt-2 [scrollbar-width:none]" data-frame-rail="">
      <Tooltip label="Back to Shorts home" side="bottom">
        <a href={SHORTS_HOME()} aria-label="Back to Shorts home" className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ChevronLeft size={17} />
        </a>
      </Tooltip>
      <span aria-hidden className="mb-1.5 h-px w-8 bg-[var(--border-soft)]" />
      {FRAME_TABS.map((t) => {
        const on = t.id === 'media' ? mediaOpen : open && tab === t.id;
        return (
          <button key={t.id} type="button" aria-pressed={on} onClick={() => onTab(t.id)}
            className={`group flex w-[62px] shrink-0 flex-col items-center gap-0.5 rounded-lg py-1.5 text-center text-[10px] leading-[1.15] transition ${on ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            <span className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${on ? '' : 'group-hover:bg-[var(--bg-hover)]'}`}>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
