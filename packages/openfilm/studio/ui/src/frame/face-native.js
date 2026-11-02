/* The AI Clipper's face tracker as a target track.
 *
 * spatial/faces.py runs clipper_face_tracking.py over the clip: every face, every frame, with identities that hold across
 * frames (detections on every frame, verified optical flow between them). A click on a face picks that identity; the
 * clicked spot is kept in the face's own units (so a pin on an ear stays on the ear as the face turns and grows) and
 * followed for the whole clip. A frame without that face is never filled with another face: a short gap is marked
 * predicted at the last place, a longer one lost. */

const PREDICT_S = 0.25;

/** The face at time t (seconds) under or nearest a point, within reach (in face widths); null when there is none. */
export function faceAt(frames, t, x, y, reach = 1.5) {
  if (!frames?.length) return null;
  const frame = frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  let best = null, bestD = Infinity;
  for (const f of frame.faces) {
    const [x0, y0, x1, y1] = f.box, w = x1 - x0, h = y1 - y0;
    const dx = Math.max(x0 - x, 0, x - x1) / w, dy = Math.max(y0 - y, 0, y - y1) / h, d = Math.hypot(dx, dy);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best && bestD <= reach ? { face: best, frame } : null;
}

/**
 * @param data      faces.json from the native job ({ frames: [{ t, faces: [{ id, box, confidence, source }] }] })
 * @param selection the target selection (anchorX/anchorY in source pixels, sourceTimeUs, region)
 * @returns observations in the universal track contract, or null when the click is not on a face
 */
export function faceObservations(data, selection) {
  const t0 = selection.sourceTimeUs / 1e6, hit = faceAt(data.frames, t0, selection.anchorX, selection.anchorY);
  if (!hit) return null;
  const id = hit.face.id, [bx0, by0, bx1, by1] = hit.face.box, bw0 = bx1 - bx0, bh0 = by1 - by0;
  /* the clicked spot, in the face's own units from its centre */
  const ux = (selection.anchorX - (bx0 + bx1) / 2) / bw0, uy = (selection.anchorY - (by0 + by1) / 2) / bh0;
  const out = [];
  let last = null, lastSeen = -Infinity;
  for (const frame of data.frames) {
    const f = frame.faces.find((g) => g.id === id), sourceTimeUs = Math.round(frame.t * 1e6);
    if (f) {
      const [x0, y0, x1, y1] = f.box, w = x1 - x0, h = y1 - y0, k = w / bw0;
      const x = (x0 + x1) / 2 + ux * w, y = (y0 + y1) / 2 + uy * h;
      const dt = Math.max(1e-3, frame.t - lastSeen), jump = !!last && frame.t - lastSeen > PREDICT_S;
      const velocity = last && !jump ? [(x - last.x) / dt, (y - last.y) / dt] : [0, 0];
      last = { x, y, width: selection.region.width * k, height: selection.region.height * k };
      lastSeen = frame.t;
      out.push({ sourceTimeUs, ...last, rotation: 0, velocity, confidence: Math.max(0, Math.min(1, f.confidence ?? 1)),
        status: 'observed', method: `clipper-face:${f.source ?? 'detected'}`, jump });
    } else if (last) {
      out.push({ sourceTimeUs, ...last, rotation: 0, velocity: [0, 0], confidence: 0,
        status: frame.t - lastSeen <= PREDICT_S ? 'predicted' : 'lost', method: 'unverified', jump: false });
    } else {
      /* before the face is first seen: nothing to show yet */
      out.push({ sourceTimeUs, x: selection.anchorX, y: selection.anchorY, width: selection.region.width, height: selection.region.height,
        rotation: 0, velocity: [0, 0], confidence: 0, status: 'lost', method: 'unverified', jump: false });
    }
  }
  return { id, observations: out };
}
