import type {
  TargetSelection,
  TargetTrack,
  TrackObservation,
} from "./universal-types";
import { putFile } from "./layers";
import { withTrackMetrics } from "./universal-types";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Demux/decode is code-split and instantiated only for selection or tracking. Samples retain their source PTS. */
export async function openTrackingSource(url: string, signal?: AbortSignal) {
  const { Input, UrlSource, ALL_FORMATS, VideoSampleSink } = await import(
    "mediabunny"
  );
  let input = new Input({
    source: new UrlSource(`${url}${url.includes("?") ? "&" : "?"}film-facts`),
    formats: ALL_FORMATS,
  });
  const cancel = () => input.dispose();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    let track = await input.getPrimaryVideoTrack(),
      proxy = false;
    if (!track || !(await track.canDecode())) {
      input.dispose();
      input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
      track = await input.getPrimaryVideoTrack();
      proxy = true;
    }
    if (!track || !(await track.canDecode())) {
      input.dispose();
      throw new Error(
        "This browser cannot decode this source. Convert it to H.264 MP4 to track it.",
      );
    }
    const sink = new VideoSampleSink(track),
      w = await track.getDisplayWidth(),
      h = await track.getDisplayHeight(),
      duration = await input.computeDuration();
    signal?.throwIfAborted();
    return {
      input,
      sink,
      w,
      h,
      duration,
      proxy,
      dispose: () => {
        signal?.removeEventListener("abort", cancel);
        input.dispose();
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", cancel);
    input.dispose();
    throw error;
  }
}
function gray(ctx: CanvasRenderingContext2D) {
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height),
    out = new Uint8Array(image.width * image.height);
  for (let i = 0; i < out.length; i++)
    out[i] =
      0.299 * image.data[i * 4] +
      0.587 * image.data[i * 4 + 1] +
      0.114 * image.data[i * 4 + 2];
  return out;
}
async function analyseTargetSource(o: {
  projectId: string;
  folder: string;
  src: string;
  clipId: string;
  from: number;
  to: number;
  selection: TargetSelection;
  signal: AbortSignal;
  existing?: TargetTrack;
  repair?: [number, number];
  force?: boolean;
  progress: (
    p: number,
    message: string,
    observation?: TrackObservation,
  ) => void;
}) {
  const facts = await fetch(`${o.folder + o.src}?film-facts`, {
    method: "HEAD",
    signal: o.signal,
  });
  const fingerprint = [
    facts.headers.get("content-length"),
    facts.headers.get("last-modified"),
    facts.headers.get("etag"),
  ];
  const started = performance.now(),
    signature = JSON.stringify([
      "target-v4",
      fingerprint,
      o.src,
      o.from,
      o.to,
      { ...o.selection, id: undefined },
      /* a face is followed by the AI Clipper's tracker now: a track made before that is not reused for it */
      o.selection.kind === "face" ? "clipper-face-1" : null,
    ]),
    digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(signature),
    ),
    id = [...new Uint8Array(digest).slice(0, 10)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
    path = `assets/tracking2d/${id}.json`;
  if (!o.repair && !o.force) {
    const saved = await fetch(o.folder + path, {
      cache: "no-store",
      signal: o.signal,
    });
    if (saved.ok) {
      o.progress(1, "Using the saved source track");
      return {
        ...withTrackMetrics(await saved.json()),
        path,
      } as TargetTrack & {
        path: string;
      };
    }
  }
  /* Face: the AI Clipper's tracker (every face detected on every frame, identities held) when the native runtime is here */
  if (o.selection.kind === "face" && !o.repair) {
    const native = await nativeFaceTrack(o);
    if (native) {
      const result: TargetTrack = {
          version: 1, id, src: o.src, clipId: o.clipId, sourceWidth: native.w, sourceHeight: native.h, from: o.from, to: o.to,
          selection: o.selection, observations: native.observations, corrections: [...(o.existing?.corrections ?? [])],
          metrics: {
            frames: native.observations.length, jobFrames: native.observations.length,
            meanMs: native.elapsedMs / Math.max(1, native.observations.length), p95Ms: 0, elapsedMs: performance.now() - started,
            observedShare: native.observations.filter((p) => p.status === "observed").length / Math.max(1, native.observations.length),
          },
          notes: [`Faces found by the AI Clipper's tracker (${native.backend}); face ${native.faceId} followed by identity.`],
        };
      o.signal.throwIfAborted();
      const saved = await putFile(o.projectId, path, JSON.stringify(result));
      o.progress(1, "Source track saved");
      return { ...result, path: saved };
    }
  }
  o.progress(0, "Opening source frames");
  const source = await openTrackingSource(o.folder + o.src, o.signal),
    worker = new Worker(new URL("./universal-worker.ts", import.meta.url), { type: "module" }),
    timings: number[] = [],
    observations: TrackObservation[] = [];
  const roi = document.createElement("canvas"),
    global = document.createElement("canvas"),
    gx = global.getContext("2d", { willReadFrequently: true })!,
    rx = roi.getContext("2d", { willReadFrequently: true })!;
  const ratio = Math.min(
    1,
    (["cursor", "text-caret"].includes(o.selection.kind) ? 960 : 384) /
      Math.max(source.w, source.h),
  );
  global.width = Math.max(8, Math.round(source.w * ratio));
  global.height = Math.max(8, Math.round(source.h * ratio));
  let sequence = 0,
    pending: {
      ok: (v: any) => void;
      bad: (e: Error) => void;
      id: number;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
  const cancel = () => {
    source.dispose();
    worker.terminate();
    pending?.bad(new DOMException("Tracking cancelled", "AbortError"));
  };
  o.signal.addEventListener("abort", cancel, { once: true });
  worker.onmessage = (e) => {
    const done = pending;
    if (!done || done.id !== e.data.id) return;
    clearTimeout(done.timer);
    pending = null;
    e.data.error ? done.bad(new Error(e.data.error)) : done.ok(e.data);
  };
  worker.onerror = (e) => pending?.bad(new Error(e.message));
  const request = (data: any) =>
    new Promise<any>((ok, bad) => {
      const transfers: ArrayBuffer[] = [];
      for (const image of [data.roi, data.global, ...(data.regions ?? [])])
        if (image?.data) transfers.push(image.data.buffer);
      const id = ++sequence,
        timer = setTimeout(
          () =>
            bad(
              new Error(
                "The tracking worker took too long. Cancel and select a smaller area.",
              ),
            ),
          60000,
        );
      pending = { id, ok, bad, timer };
      worker.postMessage({ id, ...data }, transfers);
    });
  let nativeCopy = true,
    copyBuffer = new Uint8Array(0);
  const crop = async (sample: any, x: number, y: number, radius: number) => {
    const w = Math.max(
        2,
        (Math.min(source.w, Math.ceil(radius * 2)) >> 1) << 1,
      ),
      h = Math.max(2, (Math.min(source.h, Math.ceil(radius * 2)) >> 1) << 1),
      left = Math.floor(clamp(Math.round(x - w / 2), 0, source.w - w) / 2) * 2,
      top = Math.floor(clamp(Math.round(y - h / 2), 0, source.h - h) / 2) * 2;
    // Read only the native luma crop when the decoder exposes planar pixels. No full-frame RGBA readback.
    if (
      nativeCopy &&
      !sample.rotation &&
      !sample.flip &&
      sample.codedWidth === source.w &&
      sample.codedHeight === source.h &&
      ["I420", "I420A", "I422", "I444", "NV12"].includes(sample.format)
    )
      try {
        const options = { rect: { x: left, y: top, width: w, height: h } },
          size = sample.allocationSize(options);
        if (copyBuffer.length < size) copyBuffer = new Uint8Array(size);
        const layout = await sample.copyTo(copyBuffer, options),
          data = new Uint8Array(w * h);
        for (let row = 0; row < h; row++)
          data.set(
            copyBuffer.subarray(
              layout[0].offset + row * layout[0].stride,
              layout[0].offset + row * layout[0].stride + w,
            ),
            row * w,
          );
        return { x: left, y: top, w, h, step: 1, data };
      } catch {
        nativeCopy = false;
      }
    if (roi.width !== w) roi.width = w;
    if (roi.height !== h) roi.height = h;
    sample.draw(rx, left, top, w, h, 0, 0, w, h);
    return { x: left, y: top, w, h, step: 1, data: gray(rx) };
  };

  let current = o.selection,
    previous: TrackObservation | null = null;
  const analysisFrom = o.repair?.[0] ?? o.from,
    analysisTo = Math.min(o.repair?.[1] ?? o.to, source.duration),
    selectionSeconds = o.selection.sourceTimeUs / 1e6;
  let completedShare = 0;
  async function process(sample: any, first: boolean, backward = false) {
    o.signal.throwIfAborted();
    const now = performance.now(),
      time = sample.microsecondTimestamp,
      dt = previous
        ? Math.min(0.2, Math.abs(time - previous.sourceTimeUs) / 1e6)
        : 0,
      predicted =
        previous && ["observed", "reacquired"].includes(previous.status)
          ? [
              previous.x + previous.velocity[0] * dt,
              previous.y + previous.velocity[1] * dt,
            ]
          : [previous?.x ?? current.anchorX, previous?.y ?? current.anchorY],
      radius = Math.min(
        256,
        Math.max(current.region.width, current.region.height) / 2 +
          70 +
          Math.min(100, Math.hypot(...(previous?.velocity ?? [0, 0])) * dt),
      );
    const readGlobal = () => {
      sample.draw(gx, 0, 0, global.width, global.height);
      return {
        x: 0,
        y: 0,
        w: global.width,
        h: global.height,
        sourceW: source.w,
        sourceH: source.h,
        data: gray(gx),
      };
    };
    const local = await crop(sample, predicted[0], predicted[1], radius),
      g =
        first || !["cursor", "text-caret"].includes(current.kind)
          ? readGlobal()
          : null;
    let result = await request({
      type: first ? "init" : "frame",
      selection: current,
      sourceW: source.w,
      sourceH: source.h,
      sourceTimeUs: time,
      roi: local,
      global: g,
    });
    if (result.needsGlobal) {
      const search = await request({ type: "search", global: readGlobal() });
      result.requests = search.requests;
    }
    if (result.requests?.length) {
      const regions = [];
      for (const p of result.requests.slice(0, 4))
        regions.push(
          await crop(
            sample,
            p.x,
            p.y,
            Math.max(
              90,
              Math.max(current.region.width, current.region.height) / 2 + 65,
            ),
          ),
        );
      const recovered = await request({ type: "recover", regions });
      if (recovered.observation) result.observation = recovered.observation;
    }
    previous = result.observation;
    observations.push(previous!);
    timings.push(performance.now() - now);
    completedShare = Math.max(
      completedShare,
      clamp(
        (backward
          ? analysisTo - selectionSeconds + selectionSeconds - sample.timestamp
          : sample.timestamp - selectionSeconds) /
          Math.max(0.001, analysisTo - analysisFrom),
        0,
        0.99,
      ),
    );
    o.progress(
      completedShare,
      `${observations.length} source frames · ${previous!.status}`,
      previous!,
    );
  }
  try {
    const first = await source.sink.getSample(
      o.selection.sourceTimeUs / 1e6 + 0.000001,
    );
    if (!first) throw new Error("No source frame at this selection.");
    try {
      await process(first, true);
    } finally {
      first.close();
    }
    const end = Math.min(o.to, source.duration),
      from = o.repair?.[0] ?? o.from,
      to = Math.min(o.repair?.[1] ?? end, end);
    for await (const sample of source.sink.samples(
      o.selection.sourceTimeUs / 1e6 + 0.000001,
      to,
    )) {
      try {
        if (sample.microsecondTimestamp > o.selection.sourceTimeUs)
          await process(sample, false);
      } finally {
        sample.close();
      }
    }
    // Backward pass uses exact encoded presentation timestamps, with bounded decoder state and no retained frames.
    if (o.selection.sourceTimeUs / 1e6 > from + 0.0001) {
      const { EncodedPacketSink } = await import("mediabunny"),
        track = await source.input.getPrimaryVideoTrack(),
        packets = new EncodedPacketSink(track!);
      const pts: number[] = [];
      const start = await packets.getPacket(from, { metadataOnly: true });
      for await (const packet of packets.packets(
        start ?? undefined,
        undefined,
        { metadataOnly: true },
      )) {
        o.signal.throwIfAborted();
        // Packets arrive in decode order: a later reference picture may precede earlier B-frame PTS.
        if (
          packet.timestamp >= from &&
          packet.timestamp < o.selection.sourceTimeUs / 1e6
        )
          pts.push(packet.timestamp);
      }
      pts.sort((a, b) => a - b);
      const ref = await source.sink.getSample(
        o.selection.sourceTimeUs / 1e6 + 0.000001,
      );
      if (ref) {
        try {
          previous = null;
          await process(ref, true, true);
        } finally {
          ref.close();
        }
      }
      // Decode forward in bounded batches, then walk those frames backwards. Avoid one GOP seek per frame.
      const batchSize = Math.max(
        2,
        Math.min(
          12,
          Math.floor((64 * 1024 * 1024) / (source.w * source.h * 1.5)),
        ),
      );
      for (let end = pts.length; end > 0; end -= batchSize) {
        const times = pts.slice(Math.max(0, end - batchSize), end),
          wanted = new Set(
            times.flatMap((t) => [Math.floor(t * 1e6), Math.ceil(t * 1e6)]),
          ),
          held: any[] = [];
        try {
          for await (const sample of source.sink.samples(
            Math.max(0, times[0] - 0.000001),
            times[times.length - 1] + 0.000001,
          )) {
            o.signal.throwIfAborted();
            if (wanted.has(sample.microsecondTimestamp)) held.push(sample);
            else sample.close();
          }
          while (held.length) {
            const sample = held.pop();
            try {
              await process(sample, false, true);
            } finally {
              sample.close();
            }
          }
        } finally {
          held.forEach((sample) => sample.close());
        }
      }
    }
    const unique = [
      ...new Map(observations.map((p) => [p.sourceTimeUs, p])).values(),
    ].sort((a, b) => a.sourceTimeUs - b.sourceTimeUs);
    // Backward analysis predicts backwards; persisted velocities always describe increasing source time.
    unique.forEach((point, i) => {
      const previous = unique[i - 1],
        dt = previous ? (point.sourceTimeUs - previous.sourceTimeUs) / 1e6 : 0;
      point.velocity =
        previous &&
        dt > 0 &&
        dt < 0.25 &&
        !point.jump &&
        [point, previous].every((p) =>
          ["observed", "reacquired"].includes(p.status),
        )
          ? [(point.x - previous.x) / dt, (point.y - previous.y) / dt]
          : [0, 0];
    });
    const merged =
        o.existing && o.repair
          ? [
              ...o.existing.observations.filter(
                (p) =>
                  p.sourceTimeUs < o.repair![0] * 1e6 ||
                  p.sourceTimeUs > o.repair![1] * 1e6,
              ),
              ...unique,
            ].sort((a, b) => a.sourceTimeUs - b.sourceTimeUs)
          : unique,
      sorted = [...timings].sort((a, b) => a - b);
    const result: TargetTrack = {
      version: 1,
      id,
      src: o.src,
      clipId: o.clipId,
      sourceWidth: source.w,
      sourceHeight: source.h,
      from: o.from,
      to: end,
      selection: o.selection,
      observations: merged,
      corrections: [
        ...(o.existing?.corrections ?? []),
        ...(o.repair ? [o.selection] : []),
      ],
      metrics: {
        frames: merged.length,
        jobFrames: unique.length,
        meanMs:
          timings.reduce((s, n) => s + n, 0) / Math.max(1, timings.length),
        p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        elapsedMs: performance.now() - started,
        observedShare:
          merged.filter((p) => ["observed", "reacquired"].includes(p.status))
            .length / Math.max(1, merged.length),
      },
      notes: [
        source.proxy
          ? "The original codec was unavailable; analysis used the browser-compatible proxy. Tiny source detail may be reduced."
          : "Native source resolution retained for local crops.",
        "Unverified intervals are labelled; source observations are independent of camera smoothing.",
      ],
    };
    o.signal.throwIfAborted();
    const saved = await putFile(o.projectId, path, JSON.stringify(result));
    o.signal.throwIfAborted();
    o.progress(1, "Source track saved");
    return { ...result, path: saved };
  } finally {
    o.signal.removeEventListener("abort", cancel);
    if (pending) clearTimeout(pending.timer);
    worker.terminate();
    source.dispose();
    roi.width = global.width = 1;
  }
}


/** The native face job (spatial/faces.py, the AI Clipper's tracker), turned into this selection's observations. Null when the
 * native runtime is missing, the job fails, or the click is not on a face: the in-browser tracker then runs as before. */
async function nativeFaceTrack(o: { projectId: string; folder: string; src: string; from: number; to: number; selection: TargetSelection; signal: AbortSignal; progress: (p: number, m: string) => void }) {
  const base = `/api/projects/${o.projectId}/spatial`;
  try {
    const status = await fetch(base + "/status", { signal: o.signal }).then((r) => (r.ok ? r.json() : null));
    if (!status?.native) return null;
    o.progress(0.05, "Finding every face in the clip");
    const r = await fetch(base + "/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "faces", src: o.src, from: o.from, to: o.to }), signal: o.signal });
    const initial = await r.json();
    if (!r.ok) return null;
    let job = initial;
    while (job.state !== "done") {
      o.signal.throwIfAborted();
      if (["error", "cancelled"].includes(job.state)) return null;
      await new Promise((ok) => setTimeout(ok, 300));
      job = await fetch(`${base}/jobs/${initial.id}`, { signal: o.signal }).then((x) => x.json());
      o.progress(Math.min(0.9, 0.05 + (job.share ?? 0) * 0.85), job.stage ?? "Finding every face in the clip");
    }
    const data = await fetch(`${o.folder}${job.path}`, { signal: o.signal, cache: "no-store" }).then((x) => (x.ok ? x.json() : null));
    if (!data?.frames?.length) return null;
    const { faceObservations } = await import("./face-native.js");
    const picked = faceObservations(data, o.selection);
    if (!picked) return null;
    return { w: data.w as number, h: data.h as number, backend: String(data.backend), elapsedMs: Number(data.elapsedMs) || 0, faceId: picked.id, observations: picked.observations as TrackObservation[] };
  } catch (e) {
    if (o.signal.aborted) throw e;
    return null;
  }
}
const activeJobs = new Map<string, AbortController>();
let activeWorkers = 0;
const waiting: { signal: AbortSignal; start: () => void }[] = [];
function workerSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const release = () => {
      activeWorkers--;
      const next = waiting.shift();
      next?.start();
    };
    const start = () => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      activeWorkers++;
      resolve(release);
    };
    const entry = { signal, start },
      cancel = () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) waiting.splice(i, 1);
        reject(
          signal.reason ?? new DOMException("Tracking cancelled", "AbortError"),
        );
      };
    if (signal.aborted) {
      cancel();
      return;
    }
    if (activeWorkers < 2) start();
    else {
      waiting.push(entry);
      signal.addEventListener("abort", cancel, { once: true });
    }
  });
}
/** At most two decoding/tracking jobs; a new selection cancels stale work for that clip. */
export async function analyseTarget(
  o: Parameters<typeof analyseTargetSource>[0],
) {
  const key = `${o.projectId}:${o.clipId}`,
    controller = new AbortController();
  activeJobs
    .get(key)
    ?.abort(
      new DOMException("A newer selection replaced this track", "AbortError"),
    );
  activeJobs.set(key, controller);
  const cancel = () => controller.abort(o.signal.reason);
  o.signal.addEventListener("abort", cancel, { once: true });
  if (o.signal.aborted) cancel();
  let release: (() => void) | undefined;
  try {
    if (activeWorkers >= 2)
      o.progress(0, "Waiting for an available tracking worker");
    release = await workerSlot(controller.signal);
    return await analyseTargetSource({ ...o, signal: controller.signal });
  } finally {
    release?.();
    o.signal.removeEventListener("abort", cancel);
    if (activeJobs.get(key) === controller) activeJobs.delete(key);
  }
}
