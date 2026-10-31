import type { ScanFrames } from './analysis';

/* The surface under a click, found in a worker from the scan's frames. A newer click replaces an older one. */
export type FoundSurface = {
  quad: [number, number][]; normal: [number, number, number] | null; tilted: boolean; quality: string; spread: number | null;
  result: { frames: { t: number; H: number[]; lost?: boolean }[]; quality: string; lostShare: number; [key: string]: unknown };
};
let worker: Worker | null = null, serial = 0, idle: ReturnType<typeof setTimeout> | undefined;
export function findSurface(frames: ScanFrames, k: number, click: [number, number], global: unknown, signal?: AbortSignal): Promise<FoundSurface> {
  clearTimeout(idle);
  worker ??= new Worker(new URL('./local-surface-worker.js', import.meta.url), { type: 'module' });
  const w = worker, id = ++serial;
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => { w.removeEventListener('message', on); signal?.removeEventListener('abort', stop); idle = setTimeout(() => { worker?.terminate(); worker = null; }, 30000); fn(); };
    const on = (e: MessageEvent) => { if (e.data?.id !== id) return; done(() => (e.data.ok ? resolve(e.data.r as FoundSurface) : reject(new Error(e.data.error)))); };
    const stop = () => done(() => reject(new DOMException('cancelled', 'AbortError')));
    w.addEventListener('message', on); signal?.addEventListener('abort', stop, { once: true });
    w.postMessage({ id, grays: frames.grays, times: frames.times, w: frames.w, h: frames.h, k, click, global });
  });
}
