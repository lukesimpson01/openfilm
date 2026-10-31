import React from 'react';
import { createPortal } from 'react-dom';
import { useStageRect, stageClipStyle } from './StageOverlay';
import { useSceneTracks } from './useSceneTracks';
import { foregroundMaskTile } from './foreground-mask.js';

type SourceRect = { x: number; y: number; w: number; h: number };
type NativeFrame = { sourceTimeUs: number; mask?: string; confidence?: number };
type NativeMasks = { frames?: NativeFrame[] };
type MatteMasks = { w: number; h: number; cols: number; rows: number; count: number; fps: number; start: number; times?: number[]; atlases: string[]; frames: unknown[] };
/** A restrained editing guide made from saved source-frame masks. It never participates in export or hit testing. */
export function ForegroundOutline({ folder, occlusionPath, mattePath, time, sourceRect }: {
  folder: string; occlusionPath?: string | null; mattePath?: string | null; time: number; sourceRect: SourceRect;
}) {
  const tracks = useSceneTracks(folder, [occlusionPath, mattePath]);
  const rect = useStageRect(), canvas = React.useRef<HTMLCanvasElement>(null);
  const cache = React.useRef(new Map<string, Promise<HTMLImageElement | null>>());
  const serial = React.useRef(0);
  const native = occlusionPath ? tracks[occlusionPath] as NativeMasks | undefined : undefined;
  const matte = mattePath ? tracks[mattePath] as MatteMasks | undefined : undefined;
  const tile = foregroundMaskTile(folder, occlusionPath, native ?? null, matte ?? null, time);
  const key = tile ? `${tile.url}|${tile.x}|${tile.y}|${tile.w ?? ''}|${tile.h ?? ''}|${tile.timestamp}` : '';

  React.useEffect(() => {
    const el = canvas.current, token = ++serial.current;
    if (!el) return;
    const out = el.getContext('2d', { willReadFrequently: true });
    out?.clearRect(0, 0, el.width, el.height);
    delete el.dataset.maskTimestamp;
    if (!tile || !out) return;
    let pending = cache.current.get(tile.url);
    if (!pending) {
      pending = new Promise(resolve => {
        const image = new Image(); image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image); image.onerror = () => { cache.current.delete(tile.url); resolve(null); }; image.src = tile.url;
      });
      cache.current.set(tile.url, pending);
      // A small decoded-image budget prevents 4K masks from retaining hundreds of MB.
      while (cache.current.size > 3) cache.current.delete(cache.current.keys().next().value!);
    }
    void pending.then(image => {
      if (token !== serial.current || !image) return;
      const sw = tile.w ?? image.naturalWidth, sh = tile.h ?? image.naturalHeight;
      if (!(sw > 0 && sh > 0)) return;
      const quality = Math.min(1, 320 / Math.max(sw, sh));
      el.width = Math.max(1, Math.round(sw * quality)); el.height = Math.max(1, Math.round(sh * quality));
      const ctx = el.getContext('2d', { willReadFrequently: true }); if (!ctx) return;
      try {
        ctx.drawImage(image, tile.x, tile.y, sw, sh, 0, 0, el.width, el.height);
        const { data } = ctx.getImageData(0, 0, el.width, el.height), result = ctx.createImageData(el.width, el.height);
        const w = el.width, h = el.height, visible = (i: number) => data[i * 4] >= 128;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const p = y * w + x; if (!visible(p)) continue;
          const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 || !visible(p - 1) || !visible(p + 1) || !visible(p - w) || !visible(p + w);
          const i = p * 4; result.data[i] = 69; result.data[i + 1] = 104; result.data[i + 2] = 238; result.data[i + 3] = edge ? 240 : 18;
        }
        ctx.putImageData(result, 0, 0); el.dataset.maskTimestamp = String(tile.timestamp);
      } catch { ctx.clearRect(0, 0, el.width, el.height); }
    });
    return () => { serial.current++; };
    // The tile key changes only when the source-frame evidence changes.
  }, [key, !!rect]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => () => { serial.current++; cache.current.clear(); }, []);
  if (!rect || !rect.width) return null;
  return createPortal(<div aria-hidden="true" data-film-select="" data-foreground-outline="" className="pointer-events-none fixed z-[39]" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, ...stageClipStyle(rect) }}>
    <canvas ref={canvas} style={{ position: 'absolute', left: `${sourceRect.x * 100}%`, top: `${sourceRect.y * 100}%`, width: `${sourceRect.w * 100}%`, height: `${sourceRect.h * 100}%` }}/>
  </div>, document.body);
}
