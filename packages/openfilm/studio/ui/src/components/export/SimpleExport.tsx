import React from 'react';
import { createPortal } from 'react-dom';
import { Download, FolderOpen, Check, X, CircleAlert, ChevronDown, Film, Music2, RotateCcw } from 'lucide-react';
import { api, projectEvents } from '@/api';
import { startExports, listExports, cancelExport, revealExport, type ExportJob, type ExportRequest } from '@/lib/export-jobs';
import type { ExportQuality, ExportVideoCodec } from '@/lib/export-spec';
import type { ExportCenterProps } from './ExportCenter';

/* Export: pick a size, press Export. Everything else (frame rate, quality, codec, captions) waits under "More settings"
   with sensible defaults. While it runs the dialog follows the real server job: stage, frames, elapsed and time left.
   The finished file can be shown in its folder; a failed or cancelled one can be tried again. */
type Preset = { id: 'hd' | 'small' | '4k' | 'audio'; title: string; sub: string; shortEdge?: number };
const PRESETS: Preset[] = [
  { id: 'hd', title: '1080p', sub: 'Full HD · best for sharing', shortEdge: 1080 },
  { id: 'small', title: '720p', sub: 'Smaller · quick to send', shortEdge: 720 },
  { id: '4k', title: '4K', sub: '2160p · maximum detail', shortEdge: 2160 },
  { id: 'audio', title: 'Audio only', sub: 'M4A · the full mix' },
];
const CODECS: [ExportVideoCodec, string][] = [['h264', 'H.264 · plays everywhere'], ['hevc', 'HEVC · smaller files'], ['prores422hq', 'ProRes 422 HQ · for editing']];
const QUALITIES: [ExportQuality, string][] = [['standard', 'Standard'], ['high', 'High'], ['master', 'Master']];
const STAGE: Record<string, string> = { preparing: 'Preparing', audio: 'Mixing the sound', rendering: 'Rendering frames', encoding: 'Encoding', copying: 'Saving', finishing: 'Finishing' };
const clock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function SimpleExport(p: ExportCenterProps) {
  const [preset, setPreset] = React.useState<Preset['id']>('hd'), [folder, setFolder] = React.useState('');
  const [more, setMore] = React.useState(false), [fps, setFps] = React.useState(0), [quality, setQuality] = React.useState<ExportQuality>('high');
  const [codec, setCodec] = React.useState<ExportVideoCodec>('h264'), [captions, setCaptions] = React.useState(true);
  const [job, setJob] = React.useState<ExportJob | null>(null), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [now, setNow] = React.useState(() => Date.now());
  const dialog = React.useRef<HTMLDivElement>(null), previousFocus = React.useRef<HTMLElement | null>(null);
  const projectFps = Math.round(p.projectFps || 30);
  React.useEffect(() => {
    if (!p.open) return;
    setError('');
    // A completed delivery must not trap later edits in the previous export's success screen.
    setJob(current => current?.project === p.projectId && ['waiting', 'running'].includes(current.status) ? current : null);
    previousFocus.current = document.activeElement as HTMLElement; dialog.current?.focus();
    let alive = true; void listExports(p.projectId).then(r => { if (alive) setFolder(f => f || r.folder); }).catch(e => { if (alive) setError(e.message); });
    const stop = projectEvents(p.projectId, e => { if (e.type === 'export') setJob(j => j?.id === e.job.id ? e.job : j); });
    return () => { alive = false; stop(); previousFocus.current?.focus(); };
  }, [p.open, p.projectId]);
  const active = !!job && ['waiting', 'running'].includes(job.status), done = job?.status === 'done', failed = job?.status === 'failed' || job?.status === 'cancelled';
  React.useEffect(() => {
    if (!p.open || !active) return;
    const poll = setInterval(() => void listExports(p.projectId).then(r => setJob(j => r.exports.find(x => x.id === j?.id) ?? j)).catch(() => {}), 1500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [p.open, p.projectId, job?.id, active]);
  if (!p.open) return null;

  const shortSide = Math.min(p.stage.w, p.stage.h), chosen = PRESETS.find(x => x.id === preset)!;
  const available = PRESETS.filter(x => x.id !== '4k' || shortSide >= 1440);
  const choose = async () => { setError(''); try { const picked = await api.pickFolder('Save exported video', folder || undefined); if (picked) setFolder(picked); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const request = (): ExportRequest => preset === 'audio'
    ? { kind: 'audio', format: 'm4a', mix: true, stems: false, name: p.title, label: 'Audio · M4A' }
    : { kind: 'video', codec, shortEdge: chosen.shortEdge, fps: fps || Math.min(60, projectFps), quality, audio: true, frame: 'native', burnSubtitles: captions, name: p.title, label: `${chosen.shortEdge}p ${codec === 'prores422hq' ? 'ProRes' : codec === 'hevc' ? 'HEVC' : 'MP4'}` };
  const start = async () => { setBusy(true); setError(''); try { const jobs = await startExports(p.projectId, [request()], folder || undefined); if (!jobs[0]) throw new Error('The export was not queued.'); setJob(jobs[0]); setNow(Date.now()); p.onQueued?.(jobs); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const pct = Math.round(Math.min(1, Math.max(0, job?.progress ?? 0)) * 100);
  const elapsed = job?.startedAt ? now - job.startedAt : 0, blocked = !p.durationMs || !folder || !!p.missingFiles?.length;
  const ring = 2 * Math.PI * 34, aspect = p.stage.w / Math.max(1, p.stage.h);
  const seg = (on: boolean) => `rounded-xl border px-3.5 py-3 text-left transition duration-150 ${on ? 'border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--fill-tsp)]'}`;
  const field = 'min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px]';

  return createPortal(<div className="fixed inset-0 z-[10020] grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]" style={{ animation: 'export-fade .18s ease-out both' }} onPointerDown={e => { if (e.target === e.currentTarget && !active) p.onClose(); }}>
    <style>{`@keyframes export-fade{from{opacity:0}to{opacity:1}}@keyframes export-rise{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}@keyframes export-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}@media(prefers-reduced-motion:reduce){[data-export-dialog],[data-export-dialog] *{animation:none!important;transition:none!important}}`}</style>
    <div ref={dialog} data-export-dialog role="dialog" aria-modal="true" aria-labelledby="simple-export-title" tabIndex={-1}
      className="flex max-h-[calc(100vh-32px)] w-full max-w-[600px] flex-col overflow-hidden rounded-[22px] border border-[var(--border)] bg-[var(--bg)] shadow-[0_24px_64px_rgba(0,0,0,.18),0_4px_12px_rgba(0,0,0,.06)] outline-none"
      style={{ animation: 'export-rise .24s cubic-bezier(.22,1,.36,1) both' }}
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); }
        if (e.key === 'Tab') { const focus = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')]; const first = focus[0], last = focus.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
      }}>
      <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-6 py-4">
        <h2 id="simple-export-title" className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{done ? 'Export complete' : active ? 'Exporting' : 'Export video'}</h2>
        <button type="button" aria-label="Close export" onClick={p.onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--fill-tsp)] hover:text-[var(--text)]"><X size={17} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {/* what is being exported: the film's shape, name, length and size */}
        <div className="mb-5 flex items-center gap-4">
          <div className="relative flex h-[76px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(145deg,#1c2433,#0d1118)] text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]" style={{ width: Math.round(Math.min(136, Math.max(44, 76 * aspect))) }}>
            {preset === 'audio' ? <Music2 size={22} /> : <Film size={22} />}
            <span className="absolute bottom-1 right-1.5 rounded bg-black/45 px-1 text-[9.5px] font-medium tabular-nums">{clock(p.durationMs)}</span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold">{p.title}</p>
            <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{p.stage.w} × {p.stage.h} · {projectFps} fps · {clock(p.durationMs)}</p>
          </div>
        </div>

        {!active && !done && <div className="flex flex-col gap-5">
          <fieldset><legend className="mb-2 text-[12.5px] font-medium text-[var(--text-dim)]">Format</legend>
            <div className={`grid gap-2 ${available.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>{available.map(x => <button key={x.id} type="button" aria-pressed={preset === x.id} disabled={busy} onClick={() => setPreset(x.id)} className={seg(preset === x.id)}><span className="block text-[14px] font-semibold">{x.title}</span><span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-muted)]">{x.sub}</span></button>)}</div>
          </fieldset>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5">
            <FolderOpen size={16} className="shrink-0 text-[var(--text-muted)]" />
            <label className="min-w-0 flex-1"><span className="block text-[11px] text-[var(--text-muted)]">Save to</span><input aria-label="Save to" value={folder} onChange={e => setFolder(e.target.value)} placeholder="Choose a folder" title={folder} className="w-full truncate bg-transparent text-[13px] font-medium outline-none placeholder:font-normal placeholder:text-[var(--text-faint)]" /></label>
            <button type="button" onClick={() => void choose()} className="rounded-lg px-2.5 py-1 text-[12.5px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]">Change</button>
          </div>
          {preset !== 'audio' && <div>
            <button type="button" aria-expanded={more} onClick={() => setMore(v => !v)} className="flex w-full items-center justify-between text-[12.5px] font-medium text-[var(--text-muted)] transition hover:text-[var(--text)]">More settings<ChevronDown size={14} className={`transition duration-200 ${more ? 'rotate-180' : ''}`} /></button>
            {more && <div className="mt-3 grid gap-2.5" style={{ animation: 'export-fade .18s ease-out both' }}>
              <label className="flex items-center gap-3 text-[12.5px]"><span className="w-24 shrink-0 text-[var(--text-dim)]">Frame rate</span><select aria-label="Frame rate" value={fps} onChange={e => setFps(Number(e.target.value))} className={field}><option value={0}>Same as project ({Math.min(60, projectFps)} fps)</option>{[24, 25, 30, 60].filter(v => v !== projectFps).map(v => <option key={v} value={v}>{v} fps</option>)}</select></label>
              <label className="flex items-center gap-3 text-[12.5px]"><span className="w-24 shrink-0 text-[var(--text-dim)]">Quality</span><select aria-label="Quality" value={quality} onChange={e => setQuality(e.target.value as ExportQuality)} className={field}>{QUALITIES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
              <label className="flex items-center gap-3 text-[12.5px]"><span className="w-24 shrink-0 text-[var(--text-dim)]">Codec</span><select aria-label="Codec" value={codec} onChange={e => setCodec(e.target.value as ExportVideoCodec)} className={field}>{CODECS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
              <label className="flex items-center justify-between gap-3 text-[12.5px]"><span className="text-[var(--text-dim)]">Burn captions into the picture</span><input type="checkbox" checked={captions} onChange={e => setCaptions(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" /></label>
            </div>}
          </div>}
        </div>}

        {active && <div role="status" aria-live="polite" className="flex items-center gap-5 py-2">
          <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0 -rotate-90" aria-hidden="true"><circle cx="42" cy="42" r="34" fill="none" stroke="var(--fill-tsp)" strokeWidth="6" /><circle cx="42" cy="42" r="34" fill="none" stroke="var(--accent)" strokeWidth="6" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset .4s cubic-bezier(.22,1,.36,1)' }} /></svg>
          <div className="min-w-0 flex-1">
            <p className="text-[28px] font-semibold leading-none tabular-nums">{pct}%</p>
            <p className="mt-2 text-[13px] font-medium">{job?.status === 'waiting' ? 'Waiting to start' : STAGE[job?.phase ?? ''] ?? 'Rendering'}</p>
            <p className="mt-1 text-[12px] tabular-nums text-[var(--text-muted)]">{job?.framesTotal ? `${job.framesDone} of ${job.framesTotal} frames · ` : ''}{clock(elapsed)} elapsed{job?.etaMs ? ` · about ${clock(job.etaMs)} left` : ''}</p>
          </div>
        </div>}

        {done && <div className="flex items-center gap-4 py-2">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,#22a35a_14%,transparent)] text-[#1f9d55]" style={{ animation: 'export-pop .35s cubic-bezier(.22,1,.36,1) both' }}><Check size={24} strokeWidth={2.5} /></div>
          <div className="min-w-0"><p className="truncate text-[14px] font-semibold">{folderName(job?.outputs[0] || p.title)}</p><p className="mt-0.5 truncate text-[12px] text-[var(--text-muted)]" title={job?.outputs[0] || folder}>Saved to {folderName(folder)}{job?.startedAt ? ` · took ${clock(job.finishedAt ? job.finishedAt - job.startedAt : elapsed)}` : ''}</p></div>
        </div>}

        {(error || failed) && <p role="alert" className="mt-4 flex gap-2 rounded-lg bg-[color-mix(in_srgb,var(--err)_8%,transparent)] px-3 py-2 text-[12.5px] text-[var(--err)]"><CircleAlert size={15} className="mt-px shrink-0" />{error || (job?.status === 'cancelled' ? 'The export was cancelled. Nothing was saved.' : job?.error || 'The export failed. Try again.')}</p>}
        {p.missingFiles?.length ? <p className="mt-3 text-[12px] text-[var(--err)]">Reconnect {p.missingFiles.length} missing file{p.missingFiles.length === 1 ? '' : 's'} before exporting.</p> : null}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--border-soft)] px-6 py-4">
        {done ? <>
          <button type="button" onClick={() => setJob(null)} className="flex min-h-10 items-center gap-1.5 rounded-xl px-4 text-[13px] font-medium text-[var(--text-dim)] transition hover:bg-[var(--fill-tsp)]"><RotateCcw size={14} />Export again</button>
          <button type="button" onClick={() => void revealExport(p.projectId, job!.id).catch(e => setError(e.message))} className="ml-auto flex min-h-10 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,.12)] transition hover:brightness-110"><FolderOpen size={15} />Show in folder</button>
        </> : active ? (
          <button type="button" onClick={() => void cancelExport(p.projectId, job!.id).catch(e => setError(e.message))} className="ml-auto flex min-h-10 items-center rounded-xl border border-[var(--border)] px-5 text-[13.5px] font-medium transition hover:bg-[var(--fill-tsp)]">Cancel</button>
        ) : <>
          <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-muted)]">{preset === 'audio' ? 'M4A audio' : `${chosen.shortEdge}p · ${CODECS.find(c => c[0] === codec)![1].split(' · ')[0]} · ${fps || Math.min(60, projectFps)} fps`}</p>
          <button type="button" disabled={busy || blocked} onClick={() => void start()} className="flex min-h-10 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-[13.5px] font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,.12)] transition hover:brightness-110 disabled:opacity-40">{busy ? 'Starting…' : <><Download size={15} />{failed ? 'Try again' : 'Export'}</>}</button>
        </>}
      </div>
    </div>
  </div>, document.body);
}
