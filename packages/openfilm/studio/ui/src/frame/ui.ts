/* Shared classes for the Shorts tools, in Studio's own language: quiet grays, 12px type, neutral fills.
   A chosen control turns its icon and label blue on a neutral fill (never a solid blue block); solid blue is kept for
   the one action that adds something. */
export const T = {
  section: 'flex flex-col gap-1.5',
  heading: 'px-0.5 text-[11.5px] font-medium text-[var(--text-muted)]',
  hint: 'px-0.5 text-[11px] leading-snug text-[var(--text-faint)]',
  field: 'h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[12px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]',
  small: 'h-7 min-w-0 rounded-md border border-transparent bg-[var(--fill-tsp)] px-2 text-[11.5px] text-[var(--text)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--bg)]',
  /* a tile or chip that does something */
  tile: 'flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12px] text-[var(--text-dim)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40',
  /* the main action of a panel */
  primary: 'flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] text-[12px] font-medium text-[var(--on-accent)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition hover:brightness-105 disabled:opacity-40',
  secondary: 'flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg)] text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
  icon: 'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]',
};
/** A segmented control's option: chosen = blue text, nothing behind it (grey is for hover). */
export const seg = (on: boolean) => `flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[6px] text-[11.5px] transition ${on ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`;
export const segWrap = 'flex gap-0.5 rounded-lg border border-[var(--border)] p-0.5';
/** A pill or tile that can be chosen: chosen = blue icon and text, blue hairline, neutral fill. */
export const pick = (on: boolean) => `transition ${on ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--bg)]' : 'border-[var(--border)] text-[var(--text-dim)] bg-[var(--bg)] hover:border-[var(--border-strong)] hover:text-[var(--text)]'}`;
