import React from "react";
import { createPortal } from "react-dom";
import { Crosshair, Play, Square, X, Move, Plus } from "lucide-react";
import type { Film, Op } from "@/api";
import {
  addLayerOps,
  makeLayer,
  livePreview,
  readLayer,
  writeLayer,
  isFrameSrc,
  layerIdOf,
} from "./layers";
import { useStageRect } from "./StageOverlay";
import { T } from "./ui";
import { Slider } from "./TrackControls";
import type {
  TargetKind,
  TargetSelection,
  TargetTrack,
  FollowSettings,
} from "./universal-types";
import { DEFAULT_FOLLOW, withTrackMetrics } from "./universal-types";
import {
  sourcePlacement,
  sourcePointAt,
  transformPoint,
  sourceTime,
  solveFollow,
} from "./universal-motion.js";
import { observationAt } from "./universal-core.js";
import { clingTarget } from "./cling.js";
import { consumeUniversalTracking, consumeUniversalKind } from "./universal-open";
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const presets: [TargetKind, string][] = [
  ["cursor", "Cursor"],
  ["text-caret", "Text caret"],
  ["face", "Face"],
  ["hand", "Hand"],
  ["body", "Body"],
  ["text-ui", "Text / UI"],
  ["object", "Object"],
  ["point", "Point"],
];
const frameWindow = () => {
  for (const el of document.querySelectorAll<HTMLIFrameElement>("iframe"))
    try {
      if ((el.contentWindow as any)?.__filmSpans)
        return el.contentWindow as any;
    } catch {}
  return null;
};
type Saved = {
  track: TargetTrack;
  path: string;
  settings: FollowSettings;
  cameraId?: string;
  attachmentId?: string;
};
export function UniversalTracking({
  projectId,
  folder,
  film,
  block,
  timeMs,
  geometry,
  edit,
}: {
  projectId: string;
  folder: string;
  film: Film | null;
  block: any;
  timeMs: number;
  geometry: any;
  edit: (ops: Op[], label: string) => Promise<any>;
}) {
  const rect = useStageRect(),
    [kind, setKind] = React.useState<TargetKind>("point"),
    [selecting, setSelecting] = React.useState(false),
    [selection, setSelection] = React.useState<TargetSelection | null>(null),
    [saved, setSaved] = React.useState<Saved | null>(null),
    [settings, setSettings] = React.useState<FollowSettings>(DEFAULT_FOLLOW),
    [mode, setMode] = React.useState<"camera" | "attach">("camera"),
    [attach, setAttach] = React.useState(""),
    [busyKind, setBusyKind] = React.useState<"tracking" | "applying" | null>(null),
    [progress, setProgress] = React.useState(0),
    [message, setMessage] = React.useState(""),
    [error, setError] = React.useState(""),
    [dims, setDims] = React.useState({
      w: block.size?.w ?? 1920,
      h: block.size?.h ?? 1080,
    }),
    [hover, setHover] = React.useState<[number, number] | null>(null),
    [drag, setDrag] = React.useState<[number, number] | null>(null),
    [repair, setRepair] = React.useState(false),
    [, setRevision] = React.useState(0);
  const source = React.useRef<any>(null),
    pickerAbort = React.useRef<AbortController | null>(null),
    sample = React.useRef<any>(null),
    lens = React.useRef<HTMLCanvasElement>(null),
    abort = React.useRef<AbortController | null>(null),
    index = React.useRef<Record<string, Saved>>({}),
    session = React.useRef(0);
  const busy = busyKind !== null;
  let clip: any;
  for (const tr of film?.tracks ?? [])
    for (const c of tr.clips) if (c.id === block.clipId) clip = c;
  const stage = {
    w: film?.stage?.w ?? geometry?.stage?.w ?? 1080,
    h: film?.stage?.h ?? geometry?.stage?.h ?? 1920,
  };
  const [mapped, setMapped] = React.useState<any>(null);
  const currentSource = () => {
    if (
      mapped &&
      Math.abs(mapped.filmTime - timeMs / 1000) < 0.05 &&
      Number.isFinite(mapped.presentedTime)
    )
      return mapped.presentedTime;
    const host = frameWindow(),
      exact = host?.__filmSourceAt?.(block.clipId, timeMs / 1000);
    return Number.isFinite(exact)
      ? exact
      : sourceTime(clip ?? {}, timeMs / 1000, block.startMs / 1000);
  };
  const fallbackPlacement = (sourcePlacement as any)(
    dims.w,
    dims.h,
    stage,
    geometry
      ? {
          x: geometry.x,
          y: geometry.y,
          w: geometry.w,
          h: geometry.h,
          r: geometry.r,
        }
      : null,
    frameWindow()
      ?.__filmSpans?.()
      .find((c: any) => c.id === block.clipId)?.look?.fit ?? "contain",
  );
  React.useEffect(() => {
    const origin = new URL(folder).origin;
    const target = () =>
      [...document.querySelectorAll<HTMLIFrameElement>("iframe")].find((el) => {
        try {
          return (
            new URL(el.src).origin === origin &&
            new URL(el.src).pathname.endsWith("/film.html")
          );
        } catch {
          return false;
        }
      });
    const receive = (e: MessageEvent) => {
      if (
        e.origin !== origin ||
        e.source !== target()?.contentWindow ||
        e.data?.type !== "tracking-map-result" ||
        e.data.clipId !== block.clipId ||
        !e.data.current
      )
        return;
      setMapped((old: any) =>
        JSON.stringify(old) === JSON.stringify(e.data) ? old : e.data,
      );
    };
    const update = () =>
      target()?.contentWindow?.postMessage(
        {
          type: "tracking-map-request",
          clipId: block.clipId,
          w: dims.w,
          h: dims.h,
        },
        origin,
      );
    window.addEventListener("message", receive);
    update();
    const timer = setInterval(update, 120);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", receive);
    };
  }, [folder, block.clipId, dims.w, dims.h]);
  const placement = mapped?.current ?? fallbackPlacement,
    basePlacement = mapped?.base ?? fallbackPlacement;
  const closeSelection = () => {
    session.current++;
    pickerAbort.current?.abort();
    pickerAbort.current = null;
    sample.current?.close();
    sample.current = null;
    source.current?.dispose();
    source.current = null;
    setSelecting(false);
    setHover(null);
    setDrag(null);
    delete document.body.dataset.trackingSelection;
  };
  React.useEffect(() => {
    let live = true;
    setSaved(null);
    setSelection(null);
    setError("");
    const load = () =>
      fetch(folder + "frame/tracking2d-index.json", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : {}))
        .then((all: Record<string, Saved>) => {
          if (!live) return;
          index.current = all;
          const found =
            all[block.clipId] ??
            (Object.values(all).find(
              (s: any) =>
                s.track?.src === block.src &&
                block.clipId?.startsWith(s.track.clipId + "-"),
            ) as Saved | undefined);
          if (found) {
            found.track = withTrackMetrics(found.track);
            setSaved(found);
            setSelection(found.track.selection);
            setSettings(found.settings);
            setAttach(found.attachmentId ?? "");
            setDims({
              w: found.track.sourceWidth,
              h: found.track.sourceHeight,
            });
          }
        })
        .catch(() => {});
    void load();
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === block.clipId) void load();
    };
    window.addEventListener("frame-target-track", changed);
    return () => {
      live = false;
      window.removeEventListener("frame-target-track", changed);
      abort.current?.abort();
      closeSelection();
    };
  }, [folder, block.clipId]);
  React.useEffect(() => {
    if (!selecting) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSelection();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selecting]);
  async function begin(nextKind = kind, correct = false) {
    setError("");
    setKind(nextKind);
    setRepair(correct);
    window.dispatchEvent(new CustomEvent("frame-pause"));
    const outside = timeMs < block.startMs || timeMs >= block.endMs;
    const selectionTime = outside ? block.startMs / 1000 : timeMs / 1000;
    if (outside)
      window.dispatchEvent(
        new CustomEvent("frame-seek", { detail: selectionTime }),
      );
    setSelecting(true);
    document.body.dataset.trackingSelection = "";
    const token = ++session.current;
    const controller = new AbortController();
    pickerAbort.current?.abort();
    pickerAbort.current = controller;
    try {
      const { openTrackingSource } = await import("./universal-analysis");
      const s = await openTrackingSource(folder + block.src, controller.signal);
      if (token !== session.current) {
        s.dispose();
        return;
      }
      source.current = s;
      setDims({ w: s.w, h: s.h });
      const wanted = clamp(
        outside ? sourceTime(clip ?? {}, selectionTime, block.startMs / 1000) : currentSource(),
        clip?.time?.[0] ?? 0,
        clip?.time?.[1] ?? s.duration,
      );
      /* a clip whose first frame is stamped a hair after zero has no sample at exactly zero: ask a frame or two later */
      let p = await s.sink.getSample(wanted);
      for (const step of [0.034, 0.067, 0.1]) if (!p) p = await s.sink.getSample(wanted + step);
      if (token !== session.current) {
        p?.close();
        return;
      }
      sample.current = p;
      if (!p) throw Error("No visible source frame here.");
      setMessage(
        s.proxy
          ? "Selection uses the compatible proxy for this codec."
          : "Select a precise point, or drag an area.",
      );
    } catch (e) {
      if (token !== session.current) return;
      setError(e instanceof Error ? e.message : String(e));
      closeSelection();
    }
  }
  const autoRun = React.useRef(false),
    [askFlat, setAskFlat] = React.useState(false);
  React.useEffect(() => {
    if (!autoRun.current || !selection) return;
    autoRun.current = false;
    void track();
  }, [selection]);
  const beginRef = React.useRef(begin);
  beginRef.current = begin;
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      clearTimeout(timer);
      // Keep the request pending through a mount that React immediately tears
      // down (for example Strict Mode), then consume it from the live panel.
      timer = setTimeout(() => {
        if (!consumeUniversalTracking(block.clipId)) return;
        if (busy) { setError('Wait for the current tracking job to finish.'); return; }
        void beginRef.current(consumeUniversalKind());
      }, 0);
    };
    window.addEventListener('frame-open-universal-tracking', open);
    open();
    return () => { clearTimeout(timer); window.removeEventListener('frame-open-universal-tracking', open); };
  }, [block.clipId, busy]);
  const toSource = (cx: number, cy: number, limitToFrame = false): [number, number] | null => {
    if (!rect) return null;
    return sourcePointAt(
      placement,
      ((cx - rect.left) / rect.width) * stage.w,
      ((cy - rect.top) / rect.height) * stage.h,
      dims.w, dims.h, limitToFrame,
    ) as [number, number] | null;
  };
  const toScreen = (x: number, y: number): [number, number] => {
    const p = transformPoint(placement, x, y);
    return [
      rect!.left + (p[0] / stage.w) * rect!.width,
      rect!.top + (p[1] / stage.h) * rect!.height,
    ];
  };
  function pick(p: [number, number], end: [number, number]) {
    const custom = Math.hypot(end[0] - p[0], end[1] - p[1]) > 5;
    let n = kind === "cursor" ? 32 : kind === "text-caret" ? 24 : kind === "face" || kind === "body" ? 100 : 40,
      w = custom ? Math.max(8, Math.abs(end[0] - p[0])) : n,
      h = custom ? Math.max(8, Math.abs(end[1] - p[1])) : n,
      x = custom ? (p[0] + end[0]) / 2 : p[0],
      y = custom ? (p[1] + end[1]) / 2 : p[1],
      quality: "good" | "weak" | "none" = "good";
    /* cling: nudge a click onto the nearest corner and size the patch to what is trackable; flat areas are asked about */
    if (!custom && sample.current) {
      try {
        const k = Math.max(1, Math.max(dims.w, dims.h) / 640), side = 160, native = side * k;
        const sx = clamp(x - native / 2, 0, Math.max(0, dims.w - native)), sy = clamp(y - native / 2, 0, Math.max(0, dims.h - native));
        const c = document.createElement("canvas");
        c.width = c.height = side;
        const g = c.getContext("2d", { willReadFrequently: true })!;
        sample.current.draw(g, sx, sy, Math.min(native, dims.w), Math.min(native, dims.h), 0, 0, side, side);
        const px = g.getImageData(0, 0, side, side).data, gray = new Uint8Array(side * side);
        for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
        const r = clingTarget(gray, side, side, ((x - sx) / native) * side, ((y - sy) / native) * side);
        quality = r.quality;
        if (r.quality !== "none") {
          x = clamp(sx + (r.x / side) * native, 0, dims.w - 1);
          y = clamp(sy + (r.y / side) * native, 0, dims.h - 1);
          w = h = Math.max(24, r.size * k);
        }
      } catch {
        /* the frame cannot be read: keep the click as it is */
      }
    }
    setSelection({
      id: correctId(),
      /* a dragged area keeps the mode it was chosen in (Face, Object); only a plain point becomes a custom area */
      kind: custom && kind === "point" ? "custom" : kind,
      sourceTimeUs:
        sample.current?.microsecondTimestamp ??
        Math.round(currentSource() * 1e6),
      anchorX: x,
      anchorY: y,
      region: {
        x: clamp(x - w / 2, 0, dims.w - w - 1),
        y: clamp(y - h / 2, 0, dims.h - h - 1),
        width: w,
        height: h,
      },
    });
    closeSelection();
    if (quality === "none") {
      setMessage("There is nothing here to follow: it is a flat area. Click an edge, corner or marking instead.");
      setAskFlat(true);
    } else {
      setAskFlat(false);
      setMessage(quality === "weak" ? "Not much detail here, so tracking may drift. Following it anyway." : custom ? "Area selected. Tracking it…" : "Locked onto the nearest detail. Tracking it…");
      autoRun.current = true;
    }
  }
  React.useEffect(() => {
    if (!hover || !lens.current || !sample.current) return;
    const c = lens.current,
      ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const size = 32,
      x = clamp(hover[0] - size / 2, 0, dims.w - size),
      y = clamp(hover[1] - size / 2, 0, dims.h - size);
    ctx.clearRect(0, 0, 128, 128);
    sample.current.draw(ctx, x, y, size, size, 0, 0, 128, 128);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(((hover[0] - x) / size) * 128 - 0.5, 0, 1, 128);
    ctx.strokeRect(0, ((hover[1] - y) / size) * 128 - 0.5, 128, 1);
  }, [hover, dims]);
  async function persist(next: Saved) {
    index.current = { ...index.current, [block.clipId]: next };
    const r = await fetch(
      `/api/projects/${projectId}/files?path=frame%2Ftracking2d-index.json&overwrite=1`,
      { method: "PUT", body: JSON.stringify(index.current) },
    );
    if (!r.ok) throw Error("Could not save the tracking settings.");
    setSaved(next);
    /* the film reloads its footage after a save and can draw before the video has a frame (a black picture until the
     * next seek): ask for the playhead's frame again once it has had time to load */
    for (const wait of [700, 1600])
      setTimeout(() => window.dispatchEvent(new CustomEvent("frame-seek", { detail: playhead.current / 1000 })), wait);
  }
  const playhead = React.useRef(timeMs);
  playhead.current = timeMs;
  async function saveUpdatedLayer(layer: Awaited<ReturnType<typeof readLayer>>) {
    if (!layer) return;
    await writeLayer(projectId, layer);
    livePreview(layer);
  }
  async function track() {
    if (!selection || busy) return;
    closeSelection();
    setBusyKind("tracking");
    setError("");
    setProgress(0);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const { analyseTarget } = await import("./universal-analysis"),
        from = clip?.time?.[0] ?? 0,
        to = clip?.time?.[1] ?? from + (block.endMs - block.startMs) / 1000,
        result = await analyseTarget({
          projectId,
          folder,
          src: block.src,
          clipId: block.clipId,
          from,
          to,
          selection,
          signal: controller.signal,
          existing: repair ? saved?.track : undefined,
          force: !!saved && !repair,
          repair: repair
            ? [
                Math.max(from, selection.sourceTimeUs / 1e6 - 1.5),
                Math.min(to, selection.sourceTimeUs / 1e6 + 1.5),
              ]
            : undefined,
          progress: (p, m) => {
            setProgress(p);
            setMessage(m);
          },
        });
      // A new selection should not silently retarget an existing effect. Keep
      // it in place until the user explicitly applies the new track; repairing
      // or retracking the same target can update the existing effects.
      const updatesCurrentTarget = !!saved && (repair || saved.track.selection.id === selection.id);
      if (updatesCurrentTarget && saved?.cameraId) {
        const camera = await readLayer(folder, saved.cameraId);
        if (camera?.camera?.tracking) {
          camera.camera.tracking.path = solveFollow(
            result,
            settings,
            stage,
            basePlacement,
          );
          camera.camera.tracking.trackPath = result.path;
          await saveUpdatedLayer(camera);
        }
      }
      if (updatesCurrentTarget && saved?.attachmentId) {
        const attached = layers.find((c) => c.id === saved.attachmentId),
          element = attached
            ? await readLayer(folder, layerIdOf(attached.src))
            : null;
        if (element?.targetTracking) {
          element.targetTracking.observations = result.observations;
          await saveUpdatedLayer(element);
        }
      }
      await persist({
        track: result,
        path: result.path,
        settings,
        cameraId: saved?.cameraId,
        attachmentId: saved?.attachmentId,
      });
      setSelection(result.selection);
      setRepair(false);
      setMessage(
        `Saved ${result.metrics.frames} source frames. Uncertain sections are marked below.`,
      );
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
      abort.current = null;
    }
  }
  const layers = (film?.tracks ?? [])
    .flatMap((tr) => tr.clips)
    .filter((c) => isFrameSrc(c.src) && c.id !== saved?.cameraId);
  React.useEffect(() => {
    if (mode === "attach" && !attach && layers.length) setAttach(layers[layers.length - 1].id);
  }, [mode, attach, layers.length]);
  const [elementNames, setElementNames] = React.useState<
    Record<string, { name: string; camera: boolean }>
  >({});
  React.useEffect(() => {
    if (mode !== "attach") return;
    let live = true;
    void (async () => {
      const names: Record<string, { name: string; camera: boolean }> = {};
      for (let i = 0; i < layers.length; i += 8) {
        const batch = layers.slice(i, i + 8);
        await Promise.all(
          batch.map(async (c) => {
            const page = await readLayer(folder, layerIdOf(c.src));
            if (page)
              names[c.id] = {
                name: page.name ?? c.id,
                camera: page.kind === "camera",
              };
          }),
        );
      }
      if (live) setElementNames(names);
    })();
    return () => {
      live = false;
    };
  }, [mode, film, folder]);
  async function apply() {
    if (!saved) return;
    setBusyKind("applying");
    setError("");
    try {
      const path = solveFollow(saved.track, settings, stage, basePlacement);
      if (mode === "camera") {
        const old =
            saved.cameraId &&
            (film?.tracks ?? []).some((tr) =>
              tr.clips.some((c) => c.id === saved.cameraId),
            )
              ? await readLayer(folder, saved.cameraId)
              : null,
          layer =
            old ??
            makeLayer("camera", {
              name: "Follow target",
              duration: (block.endMs - block.startMs) / 1000,
            });
        layer.camera = {
          mode: "2d",
          stageW: stage.w,
          stageH: stage.h,
          tracking: {
            clipId: block.clipId,
            src: block.src,
            path,
            settings,
            trackPath: saved.path,
          },
          bounds: settings.bounds,
        };
        await saveUpdatedLayer(layer);
        if (!old) {
          const failed = await edit(
            addLayerOps(film, layer, block.startMs / 1000),
            "Follow selected target",
          );
          if (failed) throw Error(String(failed));
        }
        await persist({ ...saved, settings, cameraId: layer.id });
      } else {
        const target = layers.find((c) => c.id === attach);
        if (!target) throw Error("Choose an existing element to attach.");
        const id = layerIdOf(target.src!),
          layer = await readLayer(folder, id);
        if (!layer || layer.kind === "camera")
          throw Error(
            "Choose an editable element layer, rather than a camera.",
          );
        const p = observationAt(
          saved.track.observations,
          timeMs >= block.startMs && timeMs < block.endMs
            ? currentSource() * 1e6
            : saved.track.selection.sourceTimeUs,
        );
        if (!p || !["observed", "reacquired"].includes(p.status))
          throw Error("Choose a frame where the target is verified.");
        layer.targetTracking = {
          clipId: block.clipId,
          src: block.src,
          observations: saved.track.observations,
          placement: basePlacement,
          reference: [p.x, p.y],
          stage,
        };
        const previous = saved.attachmentId && saved.attachmentId !== target.id
          ? layers.find((c) => c.id === saved.attachmentId)
          : null;
        const previousLayer = previous ? await readLayer(folder, layerIdOf(previous.src)) : null;
        const previousTracking = previousLayer?.targetTracking;
        const oldTracking = (await readLayer(folder, id))?.targetTracking;
        try {
          await saveUpdatedLayer(layer);
          if (previousLayer && previousLayer.targetTracking?.clipId === block.clipId) {
            delete previousLayer.targetTracking;
            await saveUpdatedLayer(previousLayer);
          }
          await persist({ ...saved, settings, attachmentId: target.id });
        } catch (failure) {
          if (oldTracking) layer.targetTracking = oldTracking;
          else delete layer.targetTracking;
          await saveUpdatedLayer(layer).catch(() => {});
          if (previousLayer && previousTracking) {
            previousLayer.targetTracking = previousTracking;
            await saveUpdatedLayer(previousLayer).catch(() => {});
          }
          throw failure;
        }
      }
      setMessage(
        mode === "camera"
          ? "Camera path applied. Source tracking was reused."
          : "Element attached to the verified target.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
    }
  }
  const hasCurrentTrack = !!saved && !!selection && saved.track.selection.id === selection.id && !repair;
  const observed = hasCurrentTrack && saved
      ? observationAt(saved.track.observations, currentSource() * 1e6)
      : null,
    marker =
      observed ??
      (selection && {
        x: selection.anchorX,
        y: selection.anchorY,
        status: "observed",
        width: selection.region.width,
        height: selection.region.height,
      });
  return (
    <section
      data-universal-tracking=""
      className="mx-3 my-3 flex min-w-0 flex-col gap-2 border-t border-[var(--border)] pt-3"
    >
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <Crosshair size={14} />
        Track motion
      </div>
      <button
        className={T.secondary}
        disabled={busy}
        onClick={() => void begin(kind)}
      >
        <Crosshair size={14} />
        {selection ? "Choose a different target" : "Choose a target on the video"}
      </button>
      {!selection && <p className={T.hint}>Click what you want to follow. Tracking starts on its own.</p>}
      {selection && (
        <>
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate">
              {selection.kind === "custom"
                ? "Custom area"
                : (presets.find((p) => p[0] === selection.kind)?.[1] ??
                  "Point")}{" "}
              · {Math.round(selection.anchorX)}, {Math.round(selection.anchorY)}
            </span>
            <button
              className="text-[var(--accent)]"
              onClick={() => void begin(selection.kind)}
            >
              Change
            </button>
          </div>
          {!!error && !busy &&
          <button
            className={T.primary}
            disabled={busy}
            onClick={() => void track()}
          >
            <Play size={13} />
            Try tracking again
          </button>}
        </>
      )}
      {busyKind === "tracking" && (
        <div className="flex flex-col gap-1">
          <progress
            aria-label="Tracking progress"
            value={progress}
            max={1}
            className="h-1 w-full accent-[var(--accent)]"
          />
          <button
            className={T.secondary}
            onClick={() => abort.current?.abort()}
          >
            <Square size={11} />
            Cancel tracking
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-red-500">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={T.hint}>
          {message}
        </p>
      )}
      {askFlat && selection && !busy && (
        <div className="grid grid-cols-2 gap-1">
          <button className={T.primary} onClick={() => { setAskFlat(false); void begin("point"); }}>
            Pick another spot
          </button>
          <button className={T.secondary} onClick={() => { setAskFlat(false); void track(); }}>
            Track anyway
          </button>
        </div>
      )}
      {saved && hasCurrentTrack && (
        <>
          <p className={T.hint}>{saved.track.metrics.observedShare < 0.95 ? 'Some frames are uncertain. Open tracking details to review or correct them.' : 'Target tracked. Choose what should follow it.'}</p>
          <div className="grid grid-cols-2 gap-1">
            {(["camera", "attach"] as const).map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                className={`${T.tile} h-7 text-[11px] ${mode === m ? "text-[var(--accent)]" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "camera" ? "Follow camera" : "Attach element"}
              </button>
            ))}
          </div>
          {mode === "attach" ? (
            <select
              aria-label="Element to attach"
              className={T.small}
              value={attach}
              onChange={(e) => setAttach(e.target.value)}
            >
              <option value="">Choose an existing element</option>
              {layers
                .filter((c) => !elementNames[c.id]?.camera)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {elementNames[c.id]?.name ?? c.id}
                  </option>
                ))}
            </select>
          ) : (
            <>
              <Slider
                label="Zoom"
                value={settings.zoom}
                min={1}
                max={8}
                step={0.05}
                fmt={(v) => `${v.toFixed(2)}×`}
                onChange={(zoom) => setSettings({ ...settings, zoom })}
              />
              <div className="grid grid-cols-3 gap-1" role="group" aria-label="Camera feel">
                {(["precise", "smooth", "cinematic"] as const).map((style) => (
                  <button
                    key={style}
                    aria-pressed={settings.style === style}
                    className={`${T.tile} h-7 text-[11px] capitalize ${settings.style === style ? "text-[var(--accent)]" : ""}`}
                    onClick={() => setSettings({ ...settings, style })}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            className={T.primary}
            disabled={busy || (mode === "attach" && !attach)}
            onClick={() => void apply()}
          >
            <Plus size={13} />
            {mode === "camera" ? (saved.cameraId ? "Update camera follow" : "Follow with camera") : "Attach element"}
          </button>
          {((mode === "camera" && saved.cameraId) ||
            (mode === "attach" && saved.attachmentId)) && (
            <button
              className={T.secondary}
              disabled={busy}
              onClick={async () => {
                setBusyKind("applying");
                try {
                  if (mode === "camera") {
                    const failed = await edit(
                      [{ op: "remove", clip: saved.cameraId! }],
                      "Remove camera follow",
                    );
                    if (failed) throw Error(String(failed));
                    await persist({ ...saved, cameraId: undefined });
                  } else {
                    const clip = layers.find(
                        (c) => c.id === saved.attachmentId,
                      ),
                      element = clip
                        ? await readLayer(folder, layerIdOf(clip.src))
                        : null;
                    if (element) {
                      delete element.targetTracking;
                      await saveUpdatedLayer(element);
                    }
                    await persist({ ...saved, attachmentId: undefined });
                  }
                  setMessage("Source tracking kept for later use.");
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusyKind(null);
                }
              }}
            >
              {mode === "camera" ? "Remove camera follow" : "Detach element"}
            </button>
          )}
          <details>
            <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
              Tracking details and corrections
            </summary>
            <div aria-label="Track confidence" className="mt-2 flex h-2 overflow-hidden rounded bg-[var(--fill-tsp)]">
              {saved.track.observations.filter((_, i) => i % Math.max(1, Math.floor(saved.track.observations.length / 160)) === 0).map((p, i) => (
                <button key={i} title={`${(p.sourceTimeUs / 1e6).toFixed(2)}s · ${p.status}`} aria-label={`Seek ${p.status} ${(p.sourceTimeUs / 1e6).toFixed(2)} seconds`}
                  onClick={() => window.dispatchEvent(new CustomEvent("frame-seek", { detail: block.startMs / 1000 + (clip?.speed < 0 ? ((clip?.time?.[1] ?? 0) - p.sourceTimeUs / 1e6) : (p.sourceTimeUs / 1e6 - (clip?.time?.[0] ?? 0))) / Math.abs(clip?.speed || 1) }))}
                  className={`h-full min-w-0 flex-1 ${["observed", "reacquired"].includes(p.status) ? "bg-[var(--accent)]" : "bg-amber-500"}`}/>
              ))}
            </div>
            <button className={`${T.secondary} mt-2 w-full`} disabled={busy} onClick={() => void begin(selection?.kind ?? "point", true)}><Move size={13} />Correct at this frame</button>
            <button className={`${T.secondary} mt-1 w-full`} disabled={busy} onClick={() => void track()}>Track again</button>
            <p className={T.hint}>
              {saved.track.metrics.frames} frames ·{" "}
              {saved.track.metrics.meanMs.toFixed(1)} ms average ·{" "}
              {saved.track.metrics.p95Ms.toFixed(1)} ms p95 ·{" "}
              {Math.round(saved.track.metrics.observedShare * 100)}% verified
            </p>
            {saved.track.notes.map((n) => (
              <p key={n} className={T.hint}>
                {n}
              </p>
            ))}
          </details>
        </>
      )}
      {rect &&
        (selecting ||
          (marker && timeMs >= block.startMs && timeMs < block.endMs)) &&
        createPortal(
          <div
            data-film-select=""
            data-tracking-guides=""
            style={{
              position: "fixed",
              inset: 0,
              pointerEvents: "none",
              zIndex: 70,
            }}
          >
            {selecting && (
              <div
                role="application"
                aria-label="Select a tracking target in the video"
                style={{
                  position: "absolute",
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  pointerEvents: "auto",
                  cursor: "crosshair",
                  outline: "1px solid var(--accent)",
                }}
                onPointerDown={(e) => {
                  if (!sample.current) return;
                  const p = toSource(e.clientX, e.clientY);
                  if (!p) { setError('Select a point inside the source video.'); return; }
                  setError('');
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag(p);
                  setHover(p);
                }}
                onPointerMove={(e) => setHover(toSource(e.clientX, e.clientY, !!drag))}
                onPointerUp={(e) => {
                  const end = toSource(e.clientX, e.clientY, true);
                  if (drag && end && sample.current) pick(drag, end);
                }}
              >
                <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/80 px-2 py-1 text-[11px] text-white">
                  {sample.current
                    ? "Click a point · drag an area"
                    : "Opening source frame…"}
                </span>
                <button
                  aria-label="Cancel target selection"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={closeSelection}
                  className="absolute right-2 top-2 rounded bg-black/80 p-1 text-white"
                >
                  <X size={15} />
                </button>
              </div>
            )}
            {drag && hover && selecting && (
              <svg
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                }}
              >
                <polygon
                  points={[
                    [drag[0], drag[1]],
                    [hover[0], drag[1]],
                    [hover[0], hover[1]],
                    [drag[0], hover[1]],
                  ]
                    .map((p) => toScreen(p[0], p[1]).join(","))
                    .join(" ")}
                  fill="rgba(69,104,238,.08)"
                  stroke="#8eacff"
                  strokeWidth={1}
                />
              </svg>
            )}
            {hover && selecting && (
              <canvas
                ref={lens}
                width={128}
                height={128}
                aria-label="Magnified source pixels"
                style={{
                  position: "absolute",
                  left: clamp(toScreen(...hover)[0] + 20, 8, innerWidth - 136),
                  top: clamp(toScreen(...hover)[1] - 140, 8, innerHeight - 136),
                  width: 128,
                  height: 128,
                  borderRadius: 12,
                  border: "1px solid #fff",
                  boxShadow: "0 4px 16px #0008",
                  background: "#111",
                }}
              />
            )}
            {marker &&
              !selecting &&
              (() => {
                const [x, y] = toScreen(marker.x, marker.y);
                const corners = [
                  [marker.x - marker.width / 2, marker.y - marker.height / 2],
                  [marker.x + marker.width / 2, marker.y - marker.height / 2],
                  [marker.x + marker.width / 2, marker.y + marker.height / 2],
                  [marker.x - marker.width / 2, marker.y + marker.height / 2],
                ].map(p => toScreen(p[0], p[1]).join(",")).join(" ");
                const confirmed = ["observed", "reacquired"].includes(marker.status);
                return (
                  <>
                    <svg aria-hidden="true" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
                      <polygon points={corners} fill="none" stroke={confirmed ? "#7fa2ff" : "#fbbf24"} strokeWidth="1" strokeDasharray={confirmed ? undefined : "4 3"}/>
                    </svg>
                    <Crosshair
                      size={16}
                      color="#fff"
                      style={{
                        position: "fixed",
                        left: x - 8,
                        top: y - 8,
                        filter: "drop-shadow(0 1px 2px #000)",
                      }}
                    />
                  </>
                );
              })()}
          </div>,
          document.body,
        )}
    </section>
  );
}
const correctId = () => `target-${Date.now().toString(36)}`;
