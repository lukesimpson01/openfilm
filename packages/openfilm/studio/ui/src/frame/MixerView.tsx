import React from 'react';
import { Music2, Volume2, VolumeX, Film, Zap, Mic } from 'lucide-react';
import type { Op } from '@/api';
import type { TimelineBlock, TimelineTrack } from '@/lib/timeline-layout';
import { meterPosition, METER_FLOOR_DB } from '@/lib/audio-levels';
import { mediaFetch } from '@/lib/media-queue';
import type { PlaybackClock } from '@/components/LiveTime';

/* The timeline as a mixer: one channel strip for every clip with sound (sound effects, music, voice, videos that play
   their own sound), each with its level as it plays and a fader for the clip's volume. There is no master fader: the
   film's own meters, larger, stand on the right. A channel's level is the clip's real envelope (the waveform's peaks,
   40 a second) at the playhead, times its volume. */
const FLOOR = METER_FLOOR_DB;
const MAX_DB = 6;
/* the fader runs in dB: −60 … +6 dB, its bottom off */
const toPos = (v: number) => (v <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(v) - FLOOR) / (MAX_DB - FLOOR))));
const toGain = (p: number) => (p <= 0.001 ? 0 : 10 ** ((FLOOR + p * (MAX_DB - FLOOR)) / 20));
const dbText = (v: number) => (v <= 0 ? '−∞' : `${(20 * Math.log10(v)) >= 0 ? '+' : ''}${(20 * Math.log10(v)).toFixed(1)}`);

type Wave = { peaks: number[]; duration: number };
const waves = new Map<string, Promise<Wave | null>>();
function wave(url: string) {
  if (!waves.has(url)) waves.set(url, mediaFetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => (j?.peaks?.length ? { peaks: j.peaks, duration: j.duration } : null)).catch(() => null));
  return waves.get(url)!;
}

type Channel = { block: TimelineBlock; track: TimelineTrack };
const iconOf = (b: TimelineBlock) => (b.kind === 'video' ? <Film size={12} /> : b.kind === 'music' ? <Music2 size={12} /> : b.kind === 'voice' ? <Mic size={12} /> : <Zap size={12} />);

export function MixerView({ tracks, clock, playing, waveUrl, edit, titleOf, master }: {
  tracks: readonly TimelineTrack[]; clock: PlaybackClock; playing: boolean;
  waveUrl?: (src: string) => string; edit: (ops: Op[], label: string) => Promise<string | null>;
  titleOf?: (src?: string) => string | undefined; master: React.ReactNode;
}) {
  const channels: Channel[] = React.useMemo(() => tracks.flatMap((track) => track.blocks
    .filter((b) => b.clipId && b.src && (b.kind === 'sfx' || b.kind === 'music' || b.kind === 'voice' || (b.kind === 'video' && b.ownAudio && !b.silent)))
    .map((block) => ({ block, track }))).sort((a, b) => a.block.startMs - b.block.startMs), [tracks]);
  const bars = React.useRef(new Map<string, HTMLDivElement>());
  const gains = React.useRef(new Map<string, number>());
  const [, redraw] = React.useReducer((n: number) => n + 1, 0);
  const envelopes = React.useRef(new Map<string, Wave | null>());
  React.useEffect(() => {
    for (const { block } of channels) {
      if (!waveUrl || envelopes.current.has(block.src!)) continue;
      envelopes.current.set(block.src!, null);
      void wave(waveUrl(block.src!)).then((w) => envelopes.current.set(block.src!, w));
    }
  }, [channels, waveUrl]);

  /* the levels, once a frame while playing (falling back after), straight onto the bars */
  React.useEffect(() => {
    let frame = 0;
    const shown = new Map<string, number>();
    const tick = () => {
      const t = clock.get();
      let moving = false;
      for (const { block } of channels) {
        const el = bars.current.get(block.id);
        if (!el) continue;
        let db = FLOOR;
        const env = envelopes.current.get(block.src!);
        if (playing && env && t >= block.startMs && t < block.endMs) {
          const srcMs = (block.inMs ?? 0) + (t - block.startMs) * (block.speed ?? 1);
          const i = Math.floor((srcMs / 1000) * 40);
          const peak = Math.max(env.peaks[i - 1] ?? 0, env.peaks[i] ?? 0, env.peaks[i + 1] ?? 0);
          const v = (gains.current.get(block.id) ?? block.volume ?? 1) * peak;
          db = v > 0 ? Math.max(FLOOR, 20 * Math.log10(v)) : FLOOR;
        }
        const was = shown.get(block.id) ?? FLOOR;
        /* up at once, down at 24 dB a second (a meter's fall) */
        const now = db >= was ? db : Math.max(db, was - 0.4);
        if (now > FLOOR) moving = true;
        shown.set(block.id, now);
        el.style.transform = `scaleY(${meterPosition(now)})`;
      }
      if (playing || moving) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [channels, playing, clock]);

  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const setGain = (b: TimelineBlock, v: number) => {
    gains.current.set(b.id, v); redraw();
    const old = timers.current.get(b.id); if (old) clearTimeout(old);
    timers.current.set(b.id, setTimeout(() => { void edit([{ op: 'set', clip: b.clipId, field: 'volume', value: Math.round(v * 1000) / 1000 } as Op], 'Volume'); }, 220));
  };

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:thin]">
        {channels.length ? channels.map(({ block }) => {
          const v = gains.current.get(block.id) ?? block.volume ?? 1;
          const off = v <= 0;
          return (
            <div key={block.id} data-mixer-channel="" className="flex w-[82px] shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-2 pb-2 pt-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] animate-[mixer-in_.32s_cubic-bezier(.2,.8,.2,1)_both]">
              <div className="flex w-full min-w-0 items-center gap-1 text-[var(--text-dim)]" title={titleOf?.(block.src) ?? block.title}>
                <span className="shrink-0 text-[var(--accent)]">{iconOf(block)}</span>
                <span className="min-w-0 truncate text-[11px] font-medium text-[var(--text)]">{titleOf?.(block.src) ?? block.title}</span>
              </div>
              <div className="flex min-h-0 flex-1 items-stretch gap-2.5">
                {/* its level */}
                <div className="relative w-[8px] overflow-hidden rounded-full bg-[var(--tl-lane)]">
                  <div ref={(el) => { if (el) bars.current.set(block.id, el); else bars.current.delete(block.id); }}
                    className="absolute inset-0 origin-bottom rounded-full" style={{ transform: 'scaleY(0)', background: 'linear-gradient(to top, #4568ee 0%, #4568ee 62%, #e8c547 80%, #e5484d 100%)' }} />
                </div>
                {/* its fader (dB) */}
                <input type="range" min={0} max={1} step={0.001} value={toPos(v)} aria-label={`${block.title} volume`}
                  onChange={(e) => setGain(block, toGain(Number(e.target.value)))}
                  onDoubleClick={() => setGain(block, 1)}
                  className="mixer-fader" />
              </div>
              <span className={`text-[10.5px] tabular-nums ${off ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]'}`}>{dbText(v)} dB</span>
              <button type="button" onClick={() => setGain(block, off ? 1 : 0)} aria-label={off ? 'Unmute' : 'Mute'}
                className={`flex h-6 w-full items-center justify-center rounded-md text-[11px] transition ${off ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
                {off ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>
          );
        }) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--fill-tsp)] text-[var(--text-muted)]"><Volume2 size={20} /></span>
            <strong className="text-[13px] font-semibold text-[var(--text)]">Nothing makes a sound yet</strong>
            <span className="max-w-[260px] text-[12px] text-[var(--text-muted)]">Add music, a sound effect or a video with sound: each gets a channel here.</span>
          </div>
        )}
      </div>
      {/* the film's own level, larger: no master fader */}
      <div className="flex w-[96px] shrink-0 flex-col items-center border-l border-[var(--border-soft)] px-2 pb-2 pt-2.5">
        <span className="pb-1 text-[11px] font-semibold text-[var(--text)]">Master</span>
        <div className="relative min-h-0 w-full flex-1">{master}</div>
      </div>
    </div>
  );
}
