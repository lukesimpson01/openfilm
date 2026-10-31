import type { Film } from '@/api';
import { isFootage } from './transitions';
const durations = new Map<string, Promise<number>>();
/** Metadata only, loaded on demand. Never rewrites the user's source or assumes a one-hour video. */
function duration(url: string) {
  if (!durations.has(url)) durations.set(url, new Promise<number>((resolve, reject) => {
    const video = document.createElement('video'); video.preload = 'metadata';
    const finish = (value?: number) => { clearTimeout(timer); video.onloadedmetadata = video.onerror = null; video.removeAttribute('src'); video.load(); if (value && Number.isFinite(value)) resolve(value); else { durations.delete(url); reject(new Error('Could not read the selected video’s duration.')); } };
    const timer = setTimeout(() => finish(), 10000);
    video.onloadedmetadata = () => finish(video.duration); video.onerror = () => finish(); video.src = url;
  }));
  return durations.get(url)!;
}
export async function resolveMediaTiming(film: Film | null, folder: string): Promise<Film | null> {
  if (!film) return null;
  return {...film, tracks: await Promise.all(film.tracks.map(async track => ({...track, clips: await Promise.all(track.clips.map(async clip => {
    if (!isFootage(clip.src) || clip.time?.length === 2) return clip;
    const path = clip.src.split('#')[0];
    if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path)) return {...clip, time: [clip.time?.[0] ?? 0, (clip.time?.[0] ?? 0) + 5] as [number,number]};
    return {...clip, time: [clip.time?.[0] ?? 0, await duration(folder + path)] as [number,number]};
  }))}))) };
}
