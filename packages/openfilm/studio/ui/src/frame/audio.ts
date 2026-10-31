import { sfxById, renderSfx, soundDuration, toWav, SFX_SAMPLE_RATE } from './lib/sfxLibrary.js';
import { recordingIssue, soundRecordingSource } from '../../../../src/recording-identity.mjs';

/* Sounds from the FRAME libraries: played from here to preview, and written into the project as a file to use as a clip. */
export type Sound = { id: string; name: string; url?: string; dur?: number; [k: string]: any };

let ctx: AudioContext | null = null;
let current: { stop: () => void; id: string } | null = null;
const listeners = new Set<() => void>();
export const onPreview = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export const previewing = () => current?.id ?? null;
const notify = () => listeners.forEach((f) => f());
const recordingsOrigin=()=>window.location.origin;
export async function recordingFor(entry: Sound):Promise<Sound>{
  if(!entry.take&&entry.group!=='brainrot'&&!entry.originalRecording)return entry;
  const r=await fetch(`${recordingsOrigin()}/api/editor-audio/library`,{cache:'no-store'});
  if(!r.ok)throw new Error('The recording library is not answering.');
  const {recordings}=await r.json(),saved=recordings?.[entry.id];
  if(!saved)throw new Error(`${entry.name}: the original recording is unavailable. Download it into the local recording library first.`);
  const issue=recordingIssue(entry.id,saved,entry.name);if(issue)throw new Error(issue);
  entry.dur=saved.duration;
  return {...entry,url:`${recordingsOrigin()}/api/editor-audio/${encodeURIComponent(entry.id)}`,dur:saved.duration,recording:true};
}

export function stopPreview() { if (current) { current.stop(); current = null; notify(); } }
export async function playPreview(entry: Sound) {
  const was = current?.id;
  stopPreview();
  if (was === entry.id) return;
  const source=soundRecordingSource(entry.id);
  if(source&&source.status!=='verified')throw new Error(`${entry.name}: exact recording is unresolved.`);
  // Start inside the click gesture. The stable local URL needs no catalogue request first and streams long songs
  // through the native decoder, rather than keeping a whole decoded music buffer in memory.
  if(entry.originalRecording||entry.take||entry.group==='brainrot')entry={...entry,url:`${recordingsOrigin()}/api/editor-audio/${encodeURIComponent(entry.id)}`};
  if (entry.url) {
    const a = new Audio(entry.url);
    const playback={ id: entry.id, stop: () => { a.onended=null;a.pause();a.removeAttribute('src');a.load(); } };
    a.onended = () => { if (current === playback) { current = null; notify(); } };
    current = playback;
    notify();
    try{await a.play();}catch(e){if(current!==playback)return;stopPreview();throw new Error(`${entry.name} could not play. ${e instanceof Error?e.message:String(e)}`);}
    return;
  }
  ctx ??= new AudioContext();
  await ctx.resume();
  const data = renderSfx(sfxById(entry.id) ?? entry, ctx.sampleRate) as Float32Array | null;
  if (!data) return;
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.copyToChannel(data as never, 0);
  const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
  src.onended = () => { if (current?.id === entry.id) { current = null; notify(); } };
  src.start();
  current = { id: entry.id, stop: () => { try { src.stop(); } catch { /* ended */ } } };
  notify();
}

export const durationOf = (entry: Sound): number => { try { return entry.dur ?? soundDuration(sfxById(entry.id) ?? entry) ?? 0; } catch { return 0; } };

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound';
/** The sound as a project file (a bundled track is fetched, a synthesised one rendered to WAV); returns the path it landed at. */
export async function importSound(projectId: string, entry: Sound): Promise<string> {
  entry=await recordingFor(entry);
  let body: Blob; let name: string;
  if (entry.url) {
    const r = await fetch(entry.url);
    if (!r.ok) throw new Error(`could not load ${entry.name}`);
    body = await r.blob(); name = `${safe(entry.name)}${entry.recording?'.mp3':entry.url.slice(entry.url.lastIndexOf('.'))}`;
  } else {
    const data = renderSfx(sfxById(entry.id) ?? entry, SFX_SAMPLE_RATE) as Float32Array | null;
    if (!data) throw new Error(`${entry.name} has no sound to add`);
    body = new Blob([toWav(data, SFX_SAMPLE_RATE) as BlobPart], { type: 'audio/wav' }); name = `${safe(entry.name)}.wav`;
  }
  const r = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(`audio/${name}`)}`, { method: 'PUT', body });
  if (!r.ok) throw new Error(`could not add ${entry.name}: ${r.status}`);
  return (await r.json()).path as string;
}
