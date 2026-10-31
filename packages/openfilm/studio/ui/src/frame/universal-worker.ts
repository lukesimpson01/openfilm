import { createUniversalTracker, verified } from "./universal-core.js";
let engine: any,
  selection: any,
  landmarker: any,
  modelAttempted = false,
  kind = "",
  last: any,
  frameNumber = 0;
const models = {
  face: ["FaceLandmarker", "face_landmarker.task", "faceLandmarks"],
  hand: ["HandLandmarker", "hand_landmarker.task", "landmarks"],
  body: ["PoseLandmarker", "pose_landmarker_lite.task", "landmarks"],
} as const;
async function semanticCandidate(packet: any) {
  const spec = models[kind as keyof typeof models];
  if (!spec) return [];
  if (!modelAttempted) {
    modelAttempted = true;
    try {
      const mp = await import(
        /* @vite-ignore */ `${location.origin}/assets/vendor/mediapipe/vision_bundle.mjs`
      );
      const files = await mp.FilesetResolver.forVisionTasks(
        `${location.origin}/assets/vendor/mediapipe/wasm`,
      );
      landmarker = await mp[spec[0]].createFromOptions(files, {
        baseOptions: {
          modelAssetPath: `${location.origin}/assets/vendor/models/${spec[1]}`,
          delegate: "CPU",
        },
        runningMode: "IMAGE",
        ...(kind === "face"
          ? { numFaces: 4 }
          : kind === "hand"
            ? { numHands: 2 }
            : { numPoses: 4 }),
        minFaceDetectionConfidence: 0.65,
        minHandDetectionConfidence: 0.65,
        minPoseDetectionConfidence: 0.65,
      });
    } catch {
      return [];
    }
  }
  if (!landmarker) return [];
  const g = packet.global,
    c = new OffscreenCanvas(g.w, g.h),
    ctx = c.getContext("2d")!,
    rgba = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.data.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g.data[i];
    rgba[i * 4 + 3] = 255;
  }
  ctx.putImageData(new ImageData(rgba, g.w, g.h), 0, 0);
  const found = landmarker.detect(c),
    groups = found[spec[2]] ?? [],
    candidates = groups.map((points: any[]) => {
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y);
      return {
        x: ((Math.min(...xs) + Math.max(...xs)) / 2) * g.sourceW,
        y: ((Math.min(...ys) + Math.max(...ys)) / 2) * g.sourceH,
        radius: 60,
      };
    });
  return candidates
    .sort(
      (a: any, b: any) =>
        Math.hypot(a.x - last.x, a.y - last.y) -
        Math.hypot(b.x - last.x, b.y - last.y),
    )
    .slice(0, 2);
}
self.onmessage = async (e: MessageEvent) => {
  const { id, type, ...packet } = e.data;
  try {
    if (type === "init") {
      selection = packet.selection;
      kind = selection.kind;
      frameNumber = 0;
      engine = createUniversalTracker(
        selection,
        packet.sourceW,
        packet.sourceH,
      );
      last = engine.initialize(packet);
      self.postMessage({ id, observation: last, requests: [] });
    }
    if (type === "frame") {
      const result = engine.observe(packet);
      if (
        !verified(result.observation) &&
        ++frameNumber % 12 === 1 &&
        ["face", "hand", "body"].includes(kind)
      )
        result.requests.push(...(await semanticCandidate(packet)));
      last = result.observation;
      self.postMessage({ id, ...result,semanticBackend:landmarker?'ready':modelAttempted?'unavailable':'idle' });
    }
    if (type === "recover") {
      const observation = engine.recover(packet.regions);
      if (observation) last = observation;
      self.postMessage({ id, observation });
    }
    if (type === "search") {
      self.postMessage({
        id,
        requests: engine.recoveryCandidates(packet.global).slice(0, 4),
      });
    }
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
