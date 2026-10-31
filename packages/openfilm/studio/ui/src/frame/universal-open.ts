/** Select a source and open its point picker, even if the inspector mounts later. */
declare global {
  interface Window { __pendingTargetSelection?: string }
}

export function requestUniversalTracking(clipId: string) {
  window.__pendingTargetSelection = clipId;
  window.dispatchEvent(new CustomEvent('frame-select-clip', { detail: clipId }));
  window.dispatchEvent(new CustomEvent('frame-open-universal-tracking', { detail: clipId }));
}

export function consumeUniversalTracking(clipId: string) {
  if (window.__pendingTargetSelection !== clipId) return false;
  delete window.__pendingTargetSelection;
  return true;
}
