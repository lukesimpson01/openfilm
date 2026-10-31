import type { Film, Op } from '@/api';
import { putFile, round } from './layers';
import { spans } from './lines';

/* Freeze frame: the video itself stops on a frame for a while, then goes on — not the camera stopping (a camera that
   stops holds its framing while the video keeps playing). The frame at `at` is taken from the file (full size), kept
   as a still in the project, and put in the clip's place for `hold` seconds; the rest of the clip and everything
   after it on its line move later by that much. */
export async function freezeFrame(projectId: string, folder: string, film: Film | null, clipId: string, at: number, hold: number, edit: (ops: Op[], label: string) => Promise<string | null>) {
  let found: { track: number; index: number; start: number; end: number | null } | null = null;
  (film?.tracks ?? []).forEach((tr, track) => { const sp = spans(tr.clips); tr.clips.forEach((c, index) => { if (c.id === clipId) found = { track, index, start: sp[index].start, end: sp[index].end }; }); });
  if (!found) return 'No such clip.';
  const f = found as { track: number; index: number; start: number; end: number | null };
  const clip = film!.tracks[f.track].clips[f.index]; const path = clip.src.split('#')[0];
  if (!/\.(mp4|mov|webm|m4v|mkv)$/i.test(path)) return 'Freeze frame works on a video clip.';
  if (at <= f.start + 0.02 || (f.end != null && at >= f.end - 0.02)) return 'Put the playhead inside the video, where the picture should stop.';
  const sp = clip.speed || 1, inP = clip.time?.[0] ?? 0, src = inP + (at - f.start) * sp;
  /* the frame, from the file */
  const v = document.createElement('video'); v.muted = true; v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.src = `${folder}${path}`;
  await new Promise<void>((done, fail) => { v.onloadeddata = () => done(); v.onerror = () => fail(new Error('The video could not be read.')); });
  await new Promise<void>((done) => { v.addEventListener('seeked', () => done(), { once: true }); v.currentTime = src + 0.001; setTimeout(done, 4000); });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
  const still = await putFile(projectId, `assets/freeze/${path.split('/').pop()!.replace(/\.\w+$/, '')}-${Math.round(src * 1000)}.jpg`, blob);
  const ops: Op[] = [];
  const outP = clip.time?.[1] ?? inP + ((f.end ?? at + 5) - f.start) * sp;
  /* split at the frame, then: the still for `hold`, the rest after it; later clips on the line move by `hold` */
  const restId = `${clip.id}-after-${Date.now().toString(36)}`;
  ops.push({ op: 'split', clip: clip.id, at: round(at), time: [round(inP), round(src)], restTime: [round(src), round(outP)], restId } as Op);
  const later = film!.tracks[f.track].clips.slice(f.index + 1);
  for (const [i, lc] of later.reverse().entries()) { void i; const s0 = spans(film!.tracks[f.track].clips)[film!.tracks[f.track].clips.indexOf(lc)].start; ops.push({ op: 'move', clip: lc.id, at: round(s0 + hold) } as Op); }
  ops.push({ op: 'move', clip: restId, at: round(at + hold) } as Op);
  ops.push({ op: 'insert', clip: { src: still, id: `freeze-${Date.now().toString(36)}`, time: [0, round(hold)] }, at: round(at), track: f.track } as Op);
  return edit(ops, 'Freeze frame');
}
