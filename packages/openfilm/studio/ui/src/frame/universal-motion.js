/* Source observations stay untouched. This offline camera solver is shared by preview and export. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const valid = (p) => p && ["observed", "reacquired"].includes(p.status);
export function sourcePlacement(w, h, stage, box = null, fit = "contain") {
  const b = box ?? { x: 0, y: 0, w: stage.w, h: stage.h, r: 0 },
    scale =
      fit === "fill"
        ? null
        : fit === "cover"
          ? Math.max(b.w / w, b.h / h)
          : Math.min(b.w / w, b.h / h);
  const sx = scale ?? b.w / w,
    sy = scale ?? b.h / h,
    angle = ((b.r ?? 0) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    a: sx * c,
    b: sx * s,
    c: -sy * s,
    d: sy * c,
    e: b.x + b.w / 2 - (w * sx * c - h * sy * s) / 2,
    f: b.y + b.h / 2 - (w * sx * s + h * sy * c) / 2,
  };
}
export function transformPoint(m, x, y) {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}
export function inversePoint(m, x, y) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-9)
    throw Error("The selected clip has no visible area.");
  return [
    (m.d * (x - m.e) - m.c * (y - m.f)) / det,
    (-m.b * (x - m.e) + m.a * (y - m.f)) / det,
  ];
}
/** A preview point belongs to a target only inside the transformed source image. */
export function sourcePointAt(m, x, y, width, height, clampToEdge = false) {
  const p = inversePoint(m, x, y);
  if (!clampToEdge && (p[0] < 0 || p[1] < 0 || p[0] >= width || p[1] >= height)) return null;
  return [clamp(p[0], 0, Math.max(0, width - 1)), clamp(p[1], 0, Math.max(0, height - 1))];
}
export function sourceTime(clip, t, at = 0) {
  const from = clip.time?.[0] ?? 0,
    to = clip.time?.[1] ?? Infinity,
    speed = clip.speed ?? 1;
  return clamp(
    speed < 0 ? to + (t - at) * speed : from + (t - at) * speed,
    from,
    to,
  );
}
export function pathAt(path, time) {
  if (!path?.length) return null;
  let a = 0,
    b = path.length - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (path[mid].sourceTimeUs <= time) a = mid;
    else b = mid - 1;
  }
  const p = path[a],
    q = path[a + 1];
  if (!q || q.cut || !p.visible || !q.visible) return { ...p };
  const k = clamp(
    (time - p.sourceTimeUs) / (q.sourceTimeUs - p.sourceTimeUs),
    0,
    1,
  );
  return {
    ...p,
    x: p.x + (q.x - p.x) * k,
    y: p.y + (q.y - p.y) * k,
    zoom: p.zoom + (q.zoom - p.zoom) * k,
  };
}
export function solveFollow(track, settings, stage, placement) {
  const points = track.observations,
    span = Math.max(stage.w, stage.h),
    zoom = Math.max(1, settings.zoom || 1),
    m =
      placement ??
      sourcePlacement(track.sourceWidth, track.sourceHeight, stage);
  const path = points.map((p) => {
    const [x, y] = transformPoint(m, p.x, p.y);
    return {
      sourceTimeUs: p.sourceTimeUs,
      x: x + ((0.5 - settings.x) * stage.w) / zoom,
      y: y + ((0.5 - settings.y) * stage.h) / zoom,
      zoom,
      visible: valid(p),
      cut: !!p.jump,
    };
  });
  const windowUs =
    (settings.style === "cinematic" ? 0.65 : 0.18) *
    (settings.smoothness ?? 0.7) *
    (1.5 - (settings.responsiveness ?? 0.8)) *
    1e6;
  if (settings.style !== "precise" && windowUs > 0) {
    const desired = path.map((p) => ({ ...p }));
    for (let i = 0; i < path.length; i++) {
      if (!path[i].visible) continue;
      let weight = 1,
        x = desired[i].x,
        y = desired[i].y;
      for (const dir of [-1, 1])
        for (let j = i + dir; j >= 0 && j < path.length; j += dir) {
          const dt = Math.abs(path[j].sourceTimeUs - path[i].sourceTimeUs);
          if (
            dt > windowUs ||
            !path[j].visible ||
            (dir < 0 ? path[j + 1].cut : path[j].cut)
          )
            break;
          const w =
            Math.exp(-3 * (dt / windowUs) ** 2) *
            (dir > 0 ? 1 + (settings.lookahead ?? 0) : 1);
          weight += w;
          x += desired[j].x * w;
          y += desired[j].y * w;
        }
      path[i].x = x / weight;
      path[i].y = y / weight;
    }
    let velocity = [0, 0],
      acceleration = [0, 0];
    for (let i = 1; i < path.length; i++) {
      const p = path[i],
        prev = path[i - 1],
        dt = (p.sourceTimeUs - prev.sourceTimeUs) / 1e6;
      if (!p.visible || !prev.visible || p.cut || dt <= 0 || dt > 0.25) {
        velocity = [0, 0];
        acceleration = [0, 0];
        continue;
      }
      const dead = ((settings.deadZone ?? 0) * span) / zoom;
      for (const [axis, k] of [
        ["x", 0],
        ["y", 1],
      ]) {
        let delta = p[axis] - prev[axis];
        if (Math.abs(delta) < dead) delta = 0;
        const v = clamp(
            delta / dt,
            -settings.maxSpeed * span,
            settings.maxSpeed * span,
          ),
          a = clamp(
            (v - velocity[k]) / dt,
            -settings.maxAcceleration * span,
            settings.maxAcceleration * span,
          ),
          nextA = clamp(
            a,
            acceleration[k] - settings.maxJerk * span * dt,
            acceleration[k] + settings.maxJerk * span * dt,
          ),
          nextV = velocity[k] + nextA * dt;
        const proposed = prev[axis] + nextV * dt;
        /* Keep the real target inside the crop even when motion limits cannot both be met. */ const half =
          ((axis === "x" ? stage.w : stage.h) / zoom) * 0.46;
        p[axis] = clamp(
          proposed,
          desired[i][axis] - half,
          desired[i][axis] + half,
        );
        velocity[k] = (p[axis] - prev[axis]) / dt;
        acceleration[k] = nextA;
      }
    }
  }
  for (const p of path) {
    if (
      settings.autoZoom &&
      !["cursor", "text-caret", "point"].includes(track.selection.kind)
    ) {
      const observation = points.find((q) => q.sourceTimeUs === p.sourceTimeUs);
      if (observation && valid(observation)) {
        const size = Math.max(
          observation.width / track.selection.region.width,
          observation.height / track.selection.region.height,
        );
        p.zoom = clamp(zoom / Math.max(0.5, size), 1, 8);
      }
    }
    for (const key of settings.manual ?? [])
      if (Math.abs(key.sourceTimeUs - p.sourceTimeUs) < 1000) {
        p.x = key.x;
        p.y = key.y;
        p.zoom = key.zoom ?? p.zoom;
      }
    if (settings.bounds !== "allow") {
      const det = m.a * m.d - m.b * m.c,
        ia = m.d / det,
        ib = -m.b / det,
        ic = -m.c / det,
        id = m.a / det;
      const extentX = (Math.abs(ia) * stage.w + Math.abs(ic) * stage.h) / 2,
        extentY = (Math.abs(ib) * stage.w + Math.abs(id) * stage.h) / 2;
      p.zoom = Math.max(
        p.zoom,
        (extentX * 2) / track.sourceWidth,
        (extentY * 2) / track.sourceHeight,
      );
      const center = inversePoint(m, p.x, p.y),
        sx = clamp(
          center[0],
          extentX / p.zoom,
          track.sourceWidth - extentX / p.zoom,
        ),
        sy = clamp(
          center[1],
          extentY / p.zoom,
          track.sourceHeight - extentY / p.zoom,
        );
      [p.x, p.y] = transformPoint(m, sx, sy);
    }
  }
  return path;
}
export function trackingSpan(host, config, t) {
  const spans = host?.__filmSpans?.() ?? [],
    active = spans.filter((s) => t >= s.at && t < s.end),
    chosen =
      active.find((s) => s.id === config.clipId) ||
      active.find(
        (s) =>
          s.id?.startsWith(config.clipId + "-") &&
          s.src?.split("#")[0] === config.src?.split("#")[0],
      );
  if (!chosen) return null;
  const time = host.__filmSourceAt?.(chosen.id, t);
  return Number.isFinite(time) ? { clip: chosen, timeUs: time * 1e6 } : null;
}
