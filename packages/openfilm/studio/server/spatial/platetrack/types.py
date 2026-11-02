"""TrackData: the contract carried between every node and exporter.

Convention used everywhere in this package:
    H_to_ref[i] maps frame-i pixel coordinates -> reference-frame coordinates.
All matrices are stored at plate resolution; any tracking downscale is folded
in before storage (H_full = S^-1 @ H_small @ S).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import cv2
import numpy as np

SCHEMA_VERSION = 1

MOTION_MODELS = ("translation", "similarity", "affine", "homography")


@dataclass
class TrackData:
    plate_size: tuple[int, int]  # (W, H)
    reference_frame: int
    frame_count: int
    model: str
    corners_ref: np.ndarray  # (4,2) float64, ROI quad at reference frame (TL,TR,BR,BL)
    H_to_ref: np.ndarray  # (N,3,3) float64
    confidence: np.ndarray  # (N,) float64 in 0..1
    keyframes: dict[int, np.ndarray] = field(default_factory=dict)  # frame -> (4,2) pinned corners
    stab: dict | None = None  # written by Stabilize, read by Destabilize
    meta: dict = field(default_factory=dict)
    version: int = SCHEMA_VERSION

    def corners_at(self, i: int) -> np.ndarray:
        """ROI corners in frame-i coordinates, (4,2) float64."""
        H_inv = np.linalg.inv(self.H_to_ref[i])
        pts = self.corners_ref.reshape(-1, 1, 2).astype(np.float64)
        return cv2.perspectiveTransform(pts, H_inv).reshape(-1, 2)

    def to_json(self) -> str:
        return json.dumps(
            {
                "version": self.version,
                "plate_size": list(self.plate_size),
                "reference_frame": self.reference_frame,
                "frame_count": self.frame_count,
                "model": self.model,
                "corners_ref": self.corners_ref.tolist(),
                "H_to_ref": self.H_to_ref.tolist(),
                "confidence": self.confidence.tolist(),
                "keyframes": {str(k): v.tolist() for k, v in self.keyframes.items()},
                "stab": self.stab,
                "meta": self.meta,
            }
        )

    @classmethod
    def from_json(cls, text: str) -> "TrackData":
        d = json.loads(text)
        if d["version"] > SCHEMA_VERSION:
            raise ValueError(f"platetrack JSON schema {d['version']} is newer than supported {SCHEMA_VERSION}")
        return cls(
            plate_size=tuple(d["plate_size"]),
            reference_frame=d["reference_frame"],
            frame_count=d["frame_count"],
            model=d["model"],
            corners_ref=np.asarray(d["corners_ref"], dtype=np.float64),
            H_to_ref=np.asarray(d["H_to_ref"], dtype=np.float64),
            confidence=np.asarray(d["confidence"], dtype=np.float64),
            keyframes={int(k): np.asarray(v, dtype=np.float64) for k, v in d["keyframes"].items()},
            stab=d.get("stab"),
            meta=d.get("meta", {}),
            version=d["version"],
        )

    def copy(self) -> "TrackData":
        return TrackData.from_json(self.to_json())
