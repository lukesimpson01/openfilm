import { cleanMask, type CleanIn } from './mask-clean';

/* Cleans one scan's masks off the page's thread (see mask-clean.ts). Frames arrive in order; the last one is kept to
   steady the next. */
const state: { prev: Float32Array | null } = { prev: null };
self.onmessage = (e: MessageEvent<CleanIn>) => {
  const out = cleanMask(e.data, state);
  (self as unknown as Worker).postMessage(out, [out.tile.buffer, out.small.buffer]);
};
