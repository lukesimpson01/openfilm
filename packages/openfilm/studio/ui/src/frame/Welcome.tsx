import { Upload } from 'lucide-react';

/* The first screen of an empty project: a quiet empty state over the picture. One line, two ways in; every tool is in
   the rail on the left. It fits any window without scrolling and fades in. */
export function Welcome({ onImport, onDismiss }: { onStart?: (tab: string) => void; onImport: () => void; onDismiss: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 top-8 z-10 flex items-center justify-center overflow-hidden bg-[var(--dock-pane)] p-6" data-frame-welcome="">
      <style>{`@keyframes frame-welcome-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
      <div className="flex max-w-[360px] flex-col items-center text-center" style={{ animation: 'frame-welcome-in .36s cubic-bezier(.22,1,.36,1) both' }}>
        <span aria-hidden className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border)] text-[var(--text-dim)]">
          <Upload size={20} strokeWidth={1.7} />
        </span>
        <h1 className="text-[17px] font-semibold tracking-tight text-[var(--text)]">Start your video</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">Add a clip or a photo to begin. Text, stories, transitions and motion graphics are in the tools on the left.</p>
        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={onImport}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-[13px] font-medium text-white transition hover:brightness-105 active:scale-[0.98]">
            <Upload size={14} /> Add media
          </button>
          <button type="button" onClick={onDismiss}
            className="h-9 rounded-lg border border-[var(--border)] px-4 text-[13px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            Blank canvas
          </button>
        </div>
      </div>
    </div>
  );
}
