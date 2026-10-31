/** Source analysis bounds are authoritative even when the timeline clip has no explicit out point. */
export function trackedRange(footage, analysis, at, requestedLength) {
  const speed = footage.clip.speed || 1, sourceIn = footage.clip.time?.[0] ?? 0;
  const start = Math.max(footage.start, footage.start + Math.max(0, analysis.from - sourceIn) / speed);
  const end = Math.min(footage.end, footage.start + (analysis.to - sourceIn) / speed);
  if (!Number.isFinite(end) || end <= start) throw new Error('The analysed footage has no usable duration. Scan the selected video again.');
  const from = at >= start && at < end - .05 ? at : start;
  return {from, length: Math.min(requestedLength ?? end - from, end - from)};
}
