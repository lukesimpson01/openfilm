/* Heavy photometric plane-angle search runs off the editor UI thread.
 * Only small grayscale scan proxies are copied. A stale scan cancels on Worker termination.
 */
import { refineSurfaceAnchor } from './spatial-refine.js';

self.onmessage = ({ data }) => {
  try {
    const { anchor, solution, frames, click, refTimeUs } = data;
    const result = refineSurfaceAnchor(anchor, solution, frames, click, refTimeUs, {
      maxFrames: 20, half: 24, stride: 4,
    });
    self.postMessage({ improved: result.improved === true, anchor: result.anchor, reason: result.reason ?? null });
  } catch (error) {
    self.postMessage({ improved: false, anchor: data?.anchor, reason: String(error?.message ?? error) });
  }
};
