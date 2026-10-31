import type { Clip, Film, Op } from '@/api';

/* Where a new clip goes, iMovie-style: every video and photo on one Video line, sounds on Audio lines, and titles,
   subtitles each on lines of their own. A story (its gameplay drawn inside its page) is a clip of the Video line. A line is a film.html track; its label is the track's name. */
export type Line = 'media' | 'audio' | 'overlay' | 'story' | 'subtitles' | 'transition' | 'effect' | 'graphics';
export const LINE_LABEL: Record<Line, string> = { media: 'Video', audio: 'Audio', overlay: 'Titles & shapes', story: 'Stories', subtitles: 'Subtitles', transition: 'Transitions', effect: 'Effects', graphics: 'Motion graphics' };

const VIDEO = /\.(mp4|mov|webm|m4v|mkv|gif|png|jpe?g|webp|avif|svg)$/i;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
export function lineOf(src = ''): Line {
  const path = src.split('#')[0];
  if (path.startsWith('frame/layer-sub')) return 'subtitles';
  if (path.startsWith('frame/layer-story-')) return 'media';
  if (path.startsWith('frame/layer-tr-')) return 'transition';
  if (path.startsWith('frame/layer-fx-')) return 'effect';
  if (path.startsWith('frame/layer-mg-')) return 'graphics';
  if (path.startsWith('frame/')) return 'overlay';
  if (AUDIO.test(path)) return 'audio';
  if (VIDEO.test(path)) return 'media';
  return 'overlay';
}

/** Each clip's place on its track: an explicit `at`, else right after the one before. Unknown lengths are null. */
export function spans(clips: readonly Clip[]) {
  let t = 0;
  return clips.map((c) => {
    const start = typeof c.at === 'number' ? c.at : t;
    const len = c.time && c.time.length === 2 ? (c.time[1] - c.time[0]) / (c.speed || 1) : null;
    const end = len == null ? null : start + len;
    t = end ?? start;
    return { start, end };
  });
}

/**
 * The insert for a clip of `length` seconds at `at`, and the label of the line it opened (if it opened one).
 * Media joins the Video line, moved to the line's end when the playhead is over another clip there (as iMovie
 * appends); anything else takes the first line of its kind with room, else opens a new one.
 */
export function placeClip(film: Film | null, clip: Partial<Clip> & { src: string }, at: number, length: number, line: Line = lineOf(clip.src), append = true) {
  const tracks = film?.tracks ?? [];
  const mine = tracks.map((tr, i) => ({ tr, i })).filter(({ tr }) => tr.clips.length && tr.clips.every((c) => lineOf(c.src) === line));
  const fits = (clips: readonly Clip[], from: number) => spans(clips).every(({ start, end }) => end != null && (from + length <= start + 1e-3 || from >= end - 1e-3));
  for (const { tr, i } of mine) {
    if (fits(tr.clips, at)) return { op: { op: 'insert', clip, at: floorMs(at), track: i } as Op, opened: null };
  }
  if (line === 'media' && append && mine.length) {
    const { tr, i } = mine[mine.length - 1];
    const ends = spans(tr.clips).map((s) => s.end);
    if (ends.every((e) => e != null)) return { op: { op: 'insert', clip, at: round(Math.max(...(ends as number[]), 0)), track: i } as Op, opened: null };
  }
  /* video and sound lines sit under the titles; titles, stories and subtitles on top */
  const index = line === 'media' || line === 'audio' ? tracks.length : 0;
  return { op: { op: 'insert', clip, at: floorMs(at), newTrack: index } as Op, opened: { index, label: line === 'audio' && mine.length ? `${LINE_LABEL.audio} ${mine.length + 1}` : LINE_LABEL[line] } };
}
const round = (n: number) => Math.round(n * 1000) / 1000;
/* a clip put at the playhead starts at or just before it (never a fraction after: it would not be on the frame shown) */
const floorMs = (n: number) => Math.floor(n * 1000 + 1e-6) / 1000;
