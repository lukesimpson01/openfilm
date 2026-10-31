export type TargetKind =
  | "cursor"
  | "text-caret"
  | "face"
  | "hand"
  | "body"
  | "text-ui"
  | "object"
  | "point"
  | "custom";
export type TrackStatus =
  | "observed"
  | "predicted"
  | "occluded"
  | "lost"
  | "reacquired";
export type TargetSelection = {
  id: string;
  kind: TargetKind;
  sourceTimeUs: number;
  anchorX: number;
  anchorY: number;
  region: { x: number; y: number; width: number; height: number };
  hotspotOffset?: { x: number; y: number };
};
export type TrackObservation = {
  sourceTimeUs: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  velocity: [number, number];
  confidence: number;
  status: TrackStatus;
  method: string;
  jump?: boolean;
  corrected?: boolean;
};
export type TargetTrack = {
  version: 1;
  id: string;
  src: string;
  clipId: string;
  sourceWidth: number;
  sourceHeight: number;
  from: number;
  to: number;
  selection: TargetSelection;
  observations: TrackObservation[];
  corrections: TargetSelection[];
  metrics: {
    frames: number;
    jobFrames?: number;
    meanMs: number;
    p95Ms: number;
    elapsedMs: number;
    observedShare: number;
  };
  notes: string[];
};
/** A repair's processing cost is local; confidence and frame count describe the complete saved source path. */
export function withTrackMetrics(track: TargetTrack): TargetTrack {
  const frames = track.observations.length;
  return {
    ...track,
    metrics: {
      ...track.metrics,
      jobFrames: track.metrics.jobFrames ?? track.metrics.frames,
      frames,
      observedShare:
        track.observations.filter(
          (p) => p.status === "observed" || p.status === "reacquired",
        ).length / Math.max(1, frames),
    },
  };
}
export type FollowSettings = {
  style: "precise" | "smooth" | "cinematic";
  x: number;
  y: number;
  zoom: number;
  smoothness: number;
  lookahead: number;
  deadZone: number;
  autoZoom: boolean;
  responsiveness: number;
  maxSpeed: number;
  maxAcceleration: number;
  maxJerk: number;
  bounds: "constrain" | "allow";
  manual?: { sourceTimeUs: number; x: number; y: number; zoom?: number }[];
};
export const DEFAULT_FOLLOW: FollowSettings = {
  style: "precise",
  x: 0.5,
  y: 0.5,
  zoom: 1.8,
  smoothness: 0.7,
  lookahead: 0.15,
  deadZone: 0.04,
  autoZoom: false,
  responsiveness: 0.8,
  maxSpeed: 2,
  maxAcceleration: 6,
  maxJerk: 30,
  bounds: "constrain",
};
