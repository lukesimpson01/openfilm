/** Select a source and open its point picker, even if the inspector mounts later. */
declare global {
  interface Window { __pendingTargetSelection?: string; __pendingTargetKind?: string }
}

export function requestUniversalTracking(clipId: string, kind: 'face' | 'object' | 'point' = 'point') {
  window.__pendingTargetSelection = clipId;
  window.__pendingTargetKind = kind;
  window.dispatchEvent(new CustomEvent('frame-select-clip', { detail: clipId }));
  window.dispatchEvent(new CustomEvent('frame-open-universal-tracking', { detail: clipId }));
}

export function consumeUniversalTracking(clipId: string) {
  if (window.__pendingTargetSelection !== clipId) return false;
  delete window.__pendingTargetSelection;
  return true;
}

export const consumeUniversalKind = (): 'face' | 'object' | 'point' => { const k = window.__pendingTargetKind as any; delete window.__pendingTargetKind; return k === 'face' || k === 'object' ? k : 'point'; };
