import * as Engine from './lib/animationEngine.js';
import { FPS, PROPERTY_DEFS, type FrameLayer, type Keyframe } from './layers';

/* Keyframes the editor AI writes: the same keyframe operations the inspector's key lane uses (one key per frame,
   sorted), with the easing names the engine knows — so the AI's animation is edited like any other afterwards. */
const { upsertKeyframe, EASING_OPTIONS } = Engine as unknown as {
  upsertKeyframe: (f: Keyframe[], k: { time: number; value: number | string; ease?: string }, fps?: number) => Keyframe[];
  EASING_OPTIONS: string[];
};
export const EASINGS = EASING_OPTIONS;
const easeName = (e?: string) => (e ? EASING_OPTIONS.find((o) => o.toLowerCase().replace(/[^a-z]/g, '') === e.toLowerCase().replace(/[^a-z]/g, '')) : undefined);

/** Keys on one property (added to its keys, or replacing them). Null when the property cannot be animated. */
export function upsertKey(layer: FrameLayer, key: string, keys: { time: number; value: number | string; ease?: string }[], replace = false): FrameLayer | null {
  if (!PROPERTY_DEFS[key]) return null;
  let frames = replace ? [] : (layer.keyframes?.[key] ?? []);
  for (const k of keys) frames = upsertKeyframe(frames, { time: k.time, value: k.value, ease: easeName(k.ease) }, FPS);
  return { ...layer, keyframes: { ...(layer.keyframes ?? {}), [key]: frames } };
}
