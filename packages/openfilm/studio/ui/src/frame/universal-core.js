import { pyramid, corners, track, ransac, apply } from "./track-core.js";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  median = (a) => a.sort((a, b) => a - b)[a.length >> 1] ?? 0;
export const verified = (o) =>
  o && ["observed", "reacquired"].includes(o.status);
function pixel(image, x, y) {
  const fx = (x - image.x) / (image.step ?? 1),
    fy = (y - image.y) / (image.step ?? 1);
  if (fx < 0 || fy < 0 || fx > image.w - 1.001 || fy > image.h - 1.001)
    return null;
  const ix = Math.min(image.w - 2, fx | 0),
    iy = Math.min(image.h - 2, fy | 0),
    a = fx - ix,
    b = fy - iy,
    i = iy * image.w + ix,
    d = image.data;
  return (
    (d[i] * (1 - a) + d[i + 1] * a) * (1 - b) +
    (d[i + image.w] * (1 - a) + d[i + image.w + 1] * a) * b
  );
}
function template(image, target) {
  const r = target.region,
    step = Math.max(1, Math.max(r.width, r.height) / 47),
    w = Math.max(5, Math.round(r.width / step)),
    h = Math.max(5, Math.round(r.height / step)),
    data = [],
    weights = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = r.x + (x + 0.5) * step,
        sy = r.y + (y + 0.5) * step,
        v = pixel(image, sx, sy);
      if (v == null)
        throw new Error("Keep the selection inside the source image.");
      data.push(v);
      const dx =
          (pixel(image, sx + 1, sy) ?? v) - (pixel(image, sx - 1, sy) ?? v),
        dy = (pixel(image, sx, sy + 1) ?? v) - (pixel(image, sx, sy - 1) ?? v),
        caret =
          target.kind === "text-caret"
            ? Math.abs(sx - target.anchorX) < 2.5
              ? 1
              : 0.035
            : 1;
      weights.push((0.12 + Math.min(2, Math.hypot(dx, dy) / 40)) * caret);
    }
  const total = weights.reduce((s, n) => s + n, 0),
    mean = data.reduce((s, n, i) => s + n * weights[i], 0) / total,
    variance =
      data.reduce((s, n, i) => s + (n - mean) ** 2 * weights[i], 0) / total;
  return {
    w,
    h,
    step,
    data,
    weights,
    total,
    mean,
    variance,
    ax: (target.anchorX - r.x) / step - 0.5,
    ay: (target.anchorY - r.y) / step - 0.5,
  };
}
function similarity(t, image, x, y, scale = 1, rotation = 0, stride = 2) {
  let weight = 0,
    a = 0,
    b = 0,
    aa = 0,
    bb = 0,
    ab = 0;
  const cs = Math.cos(rotation),
    sn = Math.sin(rotation);
  for (let v = 0; v < t.h; v += stride)
    for (let u = 0; u < t.w; u += stride) {
      const i = v * t.w + u,
        dx = (u - t.ax) * t.step * scale,
        dy = (v - t.ay) * t.step * scale,
        B = pixel(image, x + dx * cs - dy * sn, y + dx * sn + dy * cs);
      if (B == null) return -1;
      const A = t.data[i],
        k = t.weights[i];
      weight += k;
      a += A * k;
      b += B * k;
      aa += A * A * k;
      bb += B * B * k;
      ab += A * B * k;
    }
  const va = aa - (a * a) / weight,
    vb = bb - (b * b) / weight;
  if (va < 12 || vb < 12) return -1;
  return (ab - (a * b) / weight) / Math.sqrt(va * vb);
}
function match(bank, image, prediction, radius, scale = 1, angle = 0) {
  const candidates = [],
    step = bank.some((t) => Math.min(t.w, t.h) * t.step < 24)
      ? 1
      : radius > 75
        ? 4
        : 2;
  for (const t of bank)
    for (let y = prediction[1] - radius; y <= prediction[1] + radius; y += step)
      for (
        let x = prediction[0] - radius;
        x <= prediction[0] + radius;
        x += step
      ) {
        const score = similarity(t, image, x, y, scale, angle, 3);
        if (score > 0.55) candidates.push({ x, y, score, t, scale, angle });
      }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  let refined = best;
  for (let y = best.y - step; y <= best.y + step; y += 0.5)
    for (let x = best.x - step; x <= best.x + step; x += 0.5) {
      const score = similarity(best.t, image, x, y, scale, angle, 1);
      if (score > refined.score) refined = { ...best, x, y, score };
    }
  const second = candidates.find(
    (c) =>
      Math.hypot(c.x - refined.x, c.y - refined.y) >
      Math.max(4, Math.min(best.t.w, best.t.h) * best.t.step * 0.5),
  );
  return { ...refined, gap: refined.score - (second?.score ?? 0.35) };
}
/** Original geometric cursor references, not third-party model weights. The anchor is the active hotspot. */
function cursorTemplates() {
  const out = [];
  for (const size of [16, 24, 32])
    for (const invert of [false, true])
      for (const kind of ["arrow", "hand", "ibeam"]) {
        const w = size,
          h = Math.round(size * 1.4),
          data = [],
          weights = [],
          s = size / 20,
          poly =
            kind === "arrow"
              ? [
                  [1, 1],
                  [1, 23],
                  [7, 17],
                  [12, 26],
                  [16, 24],
                  [11, 15],
                  [20, 15],
                ]
              : kind === "hand"
                ? [
                    [8, 1],
                    [11, 1],
                    [12, 11],
                    [17, 9],
                    [21, 11],
                    [20, 24],
                    [8, 24],
                    [2, 15],
                    [4, 13],
                    [8, 17],
                  ]
                : null,
          hot = kind === "arrow" ? [1, 1] : kind === "hand" ? [9, 1] : [10, 13];
        const inside = (x, y) => {
          let yes = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i],
              b = poly[j];
            if (
              a[1] > y !== b[1] > y &&
              x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
            )
              yes = !yes;
          }
          return yes;
        };
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const X = x / s,
              Y = y / s,
              fill = poly
                ? inside(X, Y)
                : (Math.abs(X - 10) < 1.4 && Y > 2 && Y < 25) ||
                  (Y > 2 && Y < 4 && X > 6 && X < 14) ||
                  (Y > 23 && Y < 25 && X > 6 && X < 14);
            let edge = false;
            if (fill)
              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const nx = X + dx,
                  ny = Y + dy;
                const near = poly
                  ? inside(nx, ny)
                  : (Math.abs(nx - 10) < 1.4 && ny > 2 && ny < 25) ||
                    (ny > 2 && ny < 4 && nx > 6 && nx < 14) ||
                    (ny > 23 && ny < 25 && nx > 6 && nx < 14);
                if (!near) edge = true;
              }
            data.push(invert ? (edge ? 255 : 0) : edge ? 0 : 255);
            weights.push(fill ? 1 : 0);
          }
        out.push({
          w,
          h,
          step: 1,
          data,
          weights,
          ax: hot[0] * s,
          ay: hot[1] * s,
          style: kind,
        });
      }
  return out;
}
/** Motion candidates only narrow a native-resolution recovery search. They are never observations. */
export function motionCandidates(current, previous, older, max = 8) {
  if (!previous || current.w !== previous.w) return [];
  const { w, h, data } = current,
    seen = new Uint8Array(w * h),
    list = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        seen[i] ||
        Math.abs(data[i] - previous.data[i]) < 24 ||
        (older && Math.abs(data[i] - older.data[i]) < 16)
      )
        continue;
      const queue = [i];
      seen[i] = 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        n = 0;
      for (let q = 0; q < queue.length && q < 1800; q++) {
        const at = queue[q],
          X = at % w,
          Y = (at / w) | 0;
        n++;
        minX = Math.min(minX, X);
        maxX = Math.max(maxX, X);
        minY = Math.min(minY, Y);
        maxY = Math.max(maxY, Y);
        for (const next of [at - 1, at + 1, at - w, at + w])
          if (
            next >= w &&
            next < w * (h - 1) &&
            !seen[next] &&
            Math.abs(data[next] - previous.data[next]) > 20
          ) {
            seen[next] = 1;
            queue.push(next);
          }
      }
      if (n >= 2 && n < 1300 && maxX - minX < w * 0.2 && maxY - minY < h * 0.28)
        list.push({
          x: ((minX + maxX) / 2 / current.w) * current.sourceW,
          y: ((minY + maxY) / 2 / current.h) * current.sourceH,
          n,
        });
    }
  return list.sort((a, b) => b.n - a.n).slice(0, max);
}
export function createUniversalTracker(selection, sourceW, sourceH) {
  let bank = [],
    cursorBank = null,
    last = null,
    velocity = [0, 0],
    misses = 0,
    previous = null,
    older = null,
    prevPyramid = null,
    featurePoints = [],
    rotation = 0,
    scale = 1,
    candidates = [],
    lastPacket = null,
    flowRun = 0;
  const target = structuredClone(selection),
    referenceAnchor = [target.anchorX, target.anchorY];
  function initialize(packet) {
    bank = [template(packet.roi, target)];
    if (bank[0].variance < 18)
      throw new Error(
        "This patch has too little visible detail. Enlarge the area or choose an edge.",
      );
    last = {
      x: target.anchorX,
      y: target.anchorY,
      sourceTimeUs: packet.sourceTimeUs,
    };
    previous = packet.global;
    prevPyramid = ["cursor", "text-caret"].includes(target.kind)
      ? null
      : pyramid(previous.data, previous.w, previous.h);
    seed();
    return observation(packet, 1, "observed", "reference");
  }
  function seed(keep = null) {
    if (!previous || !prevPyramid) return;
    const sx = previous.w / sourceW,
      sy = previous.h / sourceH,
      r = target.region,
      w = r.width * scale,
      h = r.height * scale,
      box = [
        (last.x - w / 2) * sx,
        (last.y - h / 2) * sy,
        (last.x + w / 2) * sx,
        (last.y + h / 2) * sy,
      ],
      inside = (p) => p[0] >= box[0] && p[1] >= box[1] && p[0] <= box[2] && p[1] <= box[3],
      kept = (keep ?? []).filter(inside);
    /* points that kept agreeing stay; fresh corners only top the cloud up */
    if (kept.length >= 32) {
      featurePoints = kept;
      return;
    }
    const fresh = corners(prevPyramid, 48, 3, null, box).filter((p) =>
      kept.every((q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 2),
    );
    featurePoints = [...kept, ...fresh].slice(0, 64);
  }
  function prediction(timeUs) {
    const dt = Math.min(0.2, Math.abs(timeUs - last.sourceTimeUs) / 1e6);
    return [
      clamp(last.x + velocity[0] * dt, 0, sourceW - 1),
      clamp(last.y + velocity[1] * dt, 0, sourceH - 1),
    ];
  }
  function observation(
    packet,
    confidence,
    status,
    method,
    point = last,
    jump = false,
  ) {
    return {
      sourceTimeUs: packet.sourceTimeUs,
      x: point.x,
      y: point.y,
      width: target.region.width * scale,
      height: target.region.height * scale,
      rotation: (rotation * 180) / Math.PI,
      velocity: [...velocity],
      confidence: clamp(confidence, 0, 1),
      status,
      method,
      jump,
    };
  }
  function accept(packet, found, recovered = false) {
    const dt = Math.max(
        1e-6,
        Math.abs(packet.sourceTimeUs - last.sourceTimeUs) / 1e6,
      ),
      distance = Math.hypot(found.x - last.x, found.y - last.y),
      jump =
        distance > Math.max(target.region.width * 2.5, sourceW * 0.12) ||
        (target.kind === "text-caret" && distance > 3);
    velocity = jump
      ? [0, 0]
      : [
          clamp((found.x - last.x) / dt, -sourceW * 6, sourceW * 6),
          clamp((found.y - last.y) / dt, -sourceH * 6, sourceH * 6),
        ];
    last = { x: found.x, y: found.y, sourceTimeUs: packet.sourceTimeUs };
    misses = 0;
    if (found.scale) scale = clamp(found.scale, 0.25, 4);
    if (Number.isFinite(found.angle)) rotation = found.angle;
    if (found.score > 0.97 && found.gap > 0.08 && bank.length < 4) {
      const r = target.region,
        dx = last.x - referenceAnchor[0],
        dy = last.y - referenceAnchor[1];
      try {
        bank.push(
          template(packet.roi, {
            ...target,
            anchorX: last.x,
            anchorY: last.y,
            region: { ...r, x: r.x + dx, y: r.y + dy },
          }),
        );
      } catch {}
    }
    return observation(
      packet,
      found.score,
      recovered ? "reacquired" : "observed",
      found.t?.style ? `cursor-hotspot:${found.t.style}` : "native-patch+flow",
      last,
      jump,
    );
  }
  function observe(packet) {
    lastPacket = packet;
    const predicted = prediction(packet.sourceTimeUs),
      P =
        !packet.global || ["cursor", "text-caret"].includes(target.kind)
          ? null
          : pyramid(packet.global.data, packet.global.w, packet.global.h),
      sx = (packet.global?.w ?? 1) / sourceW,
      sy = (packet.global?.h ?? 1) / sourceH;
    let flow = null,
      carried = null;
    if (
      prevPyramid &&
      featurePoints.length >= 4 &&
      !["cursor", "text-caret"].includes(target.kind)
    ) {
      const tracked = track(prevPyramid, P, featurePoints, 0.8, 7, 10),
        src = [],
        dst = [];
      tracked.forEach((p, i) => {
        if (p) {
          src.push(featurePoints[i]);
          dst.push(p);
        }
      });
      if (src.length >= 4) {
        const fit = ransac(src, dst, "similarity", 1.3);
        if (
          fit &&
          fit.inliers.length >= 4 &&
          fit.inliers.length / src.length > 0.65
        ) {
          const at = apply(fit.H, [last.x * sx, last.y * sy]);
          flow = {
            x: at[0] / sx,
            y: at[1] / sy,
            scale: scale * Math.hypot(fit.H[0], fit.H[3]),
            angle: rotation + Math.atan2(fit.H[3], fit.H[0]),
            inliers: fit.inliers.length,
            /* share of the points that survived the forward-backward check and agree on one motion */
            agreement: fit.inliers.length / featurePoints.length,
          };
          /* carry the agreeing points on, so a point cloud follows the target rather than re-seeding from scratch */
          carried = fit.inliers.map((i) => dst[i]);
        }
      }
    }
    candidates = packet.global ? recoveryCandidates(packet.global) : [];
    if (P) prevPyramid = P;
    let found =
      misses === 0
        ? match(bank.slice(0, 1), packet.roi, predicted, 8, scale, rotation)
        : null;
    if (!found || found.score < 0.94 || found.gap < 0.05)
      found = match(
        bank,
        packet.roi,
        predicted,
        Math.min(90, 18 + misses * 12),
        scale,
        rotation,
      );
    if (flow) {
      const f = match(
        bank,
        packet.roi,
        [flow.x, flow.y],
        8,
        clamp(flow.scale, 0.25, 4),
        flow.angle,
      );
      if (f && (!found || f.score > found.score)) found = f;
    }
    const stationary =
        found && Math.hypot(found.x - last.x, found.y - last.y) < 2,
      /* enough points survived the forward-backward check and move together: real-world targets (a logo on a shirt,
       * a car, a sign) bend and turn so the first-frame template stops matching long before the target is gone */
      strongFlow =
        flow && misses === 0 && flow.inliers >= 8 && flow.agreement >= 0.45,
      templateOk =
        found &&
        found.score > 0.82 &&
        (found.gap > 0.025 || (stationary && found.score > 0.97));
    if (
      templateOk &&
      !(
        strongFlow &&
        Math.hypot(found.x - flow.x, found.y - flow.y) >
          Math.max(6, 0.2 * Math.min(target.region.width, target.region.height) * scale)
      )
    ) {
      const result = accept(packet, found, misses > 0);
      seed(strongFlow ? carried : null);
      return { observation: result, requests: [] };
    }
    if (strongFlow) {
      const result = accept(packet, {
        x: flow.x,
        y: flow.y,
        scale: flow.scale,
        angle: flow.angle,
        score: clamp(0.55 + 0.4 * flow.agreement, 0, 0.95),
        gap: 0,
      });
      result.method = "point-cloud-flow";
      /* keep one template that follows the target's current look, so a later loss can be re-detected */
      if (++flowRun % 6 === 0) {
        const r = target.region,
          w = r.width * scale,
          h = r.height * scale;
        try {
          const t = template(packet.roi, {
            ...target,
            anchorX: last.x,
            anchorY: last.y,
            region: { x: last.x - w / 2, y: last.y - h / 2, width: w, height: h },
          });
          if (t.variance >= 18) bank[bank.length < 4 ? bank.length : 3] = t;
        } catch {}
      }
      seed(carried);
      return { observation: result, requests: [] };
    }
    misses++;
    const dt = Math.abs(packet.sourceTimeUs - last.sourceTimeUs) / 1e6,
      status =
        target.kind === "text-caret" && dt < 1
          ? "occluded"
          : dt < 0.25
            ? "predicted"
            : "lost";
    // Preserved coordinates remain explicitly unverified. Prediction is used only for the next search.
    return {
      observation: observation(
        packet,
        Math.max(0, found?.score ?? 0),
        status,
        "unverified",
        last,
      ),
      needsGlobal: !packet.global && misses % 3 === 1,
      requests: (misses % 3 === 1 ? candidates.slice(0, 4) : []).map((p) => ({
        x: p.x,
        y: p.y,
        radius: 50,
      })),
    };
  }
  function recoveryCandidates(global) {
    const found = motionCandidates(global, previous, older);
    older = previous;
    previous = global;
    return found;
  }
  function recover(regions) {
    let best = null;
    for (const image of regions) {
      const found = match(
        bank,
        image,
        [image.x + image.w / 2, image.y + image.h / 2],
        Math.min(55, image.w * 0.3),
        scale,
        rotation,
      );
      if (
        found &&
        found.score > 0.91 &&
        found.gap > 0.055 &&
        (!best || found.score > best.score)
      )
        best = { ...found, image };
    }
    // Preserve the source identity before considering a validated pointer-shape change.
    if (!best && target.kind === "cursor") {
      const variants = (cursorBank ??= cursorTemplates());
      const start = (misses % 3) * 6;
      for (const image of regions)
        for (const t of variants.slice(start, start + 6)) {
          const found = match(
            [t],
            image,
            [image.x + image.w / 2, image.y + image.h / 2],
            Math.min(45, image.w * 0.25),
            1,
            0,
          );
          if (
            found &&
            found.score > 0.97 &&
            found.gap > 0.12 &&
            (!best || found.score > best.score)
          )
            best = { ...found, image };
        }
    }
    if (best) {
      const result = accept({ ...lastPacket, roi: best.image }, best, true);
      seed();
      return result;
    }
    return null;
  }
  return {
    initialize,
    predict: prediction,
    observe,
    recover,
    recoveryCandidates,
    dispose() {
      bank = [];
      cursorBank = null;
      previous = older = prevPyramid = lastPacket = null;
      featurePoints = [];
    },
  };
}
/** Never interpolate through invisible targets, hard jumps or manual cuts. */
export function observationAt(observations, timeUs) {
  if (!observations.length || timeUs < observations[0].sourceTimeUs - 100000)
    return null;
  /* a file whose first frame is stamped a frame after zero still shows that frame at zero */
  if (timeUs < observations[0].sourceTimeUs) return { ...observations[0] };
  let lo = 0,
    hi = observations.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (observations[m].sourceTimeUs <= timeUs) lo = m;
    else hi = m - 1;
  }
  const a = observations[lo],
    b = observations[lo + 1];
  if (!b)
    return timeUs > a.sourceTimeUs + 100000
      ? { ...a, status: "lost" }
      : { ...a };
  if (
    !verified(a) ||
    !verified(b) ||
    b.jump ||
    b.sourceTimeUs - a.sourceTimeUs > 250000
  )
    return timeUs > a.sourceTimeUs && verified(a)
      ? { ...a, status: "predicted" }
      : { ...a };
  const k = clamp(
    (timeUs - a.sourceTimeUs) / (b.sourceTimeUs - a.sourceTimeUs),
    0,
    1,
  );
  return {
    ...a,
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    width: a.width + (b.width - a.width) * k,
    height: a.height + (b.height - a.height) * k,
    rotation: a.rotation + (b.rotation - a.rotation) * k,
  };
}
