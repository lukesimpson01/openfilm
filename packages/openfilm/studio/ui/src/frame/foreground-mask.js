/** Choose the nearest actual observation, without extrapolating past its allowed age. */
export function nearestMaskFrame(frames, time, timestamp, maxAge) {
  if (!Array.isArray(frames) || !frames.length || !Number.isFinite(time)) return null;
  let low = 0, high = frames.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (timestamp(frames[mid], mid) <= time) low = mid; else high = mid; }
  const index = Math.abs(timestamp(frames[high], high) - time) < Math.abs(timestamp(frames[low], low) - time) ? high : low;
  const t = timestamp(frames[index], index);
  return Number.isFinite(t) && Math.abs(t - time) <= maxAge ? { frame: frames[index], index, time: t } : null;
}

/** Resolve a precise SAM2 mask or one observed tile in the lighter mask atlas. */
export function foregroundMaskTile(folder, occlusionPath, native, matte, time) {
  const hit = nearestMaskFrame(native?.frames ?? [], time, frame => frame?.sourceTimeUs / 1e6, .08);
  if (hit) {
    if (!hit.frame?.mask || hit.frame.confidence != null && hit.frame.confidence < .55 || !occlusionPath) return null;
    const base = occlusionPath.slice(0, occlusionPath.lastIndexOf('/') + 1);
    return { url: folder + base + hit.frame.mask, x: 0, y: 0, timestamp: hit.time };
  }
  if (!matte || !matte.w || !matte.h || !matte.cols || !matte.rows || !(matte.fps > 0) || !Array.isArray(matte.atlases) || !matte.atlases.length || !Array.isArray(matte.frames) || !matte.frames.length) return null;
  const matching = nearestMaskFrame(matte.frames, time, (_, index) => matte.times?.[index] ?? matte.start + index / matte.fps, Math.max(.08, .55 / matte.fps));
  if (!matching?.frame || matching.index >= matte.count) return null;
  const per = matte.cols * matte.rows, tile = matching.index % per, atlas = matte.atlases[Math.floor(matching.index / per)];
  return atlas ? { url: folder + atlas, x: tile % matte.cols * matte.w, y: Math.floor(tile / matte.cols) * matte.h, w: matte.w, h: matte.h, timestamp: matching.time } : null;
}
