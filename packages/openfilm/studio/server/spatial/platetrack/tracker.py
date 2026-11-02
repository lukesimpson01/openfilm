"""Planar and point tracking orchestration.

track_planar: features -> LK -> robust model fit -> chain -> ECC refine-to-reference.
Keyframe pins are hard constraints; the tracked/pinned residual is blended over
the trailing frames of the segment to avoid pops.
"""

from __future__ import annotations

from typing import Callable, Sequence

import cv2
import numpy as np

from .features import detect_features
from .lk import lk_step
from .models import fit_motion
from .refine import ecc_refine_to_reference
from .types import TrackData

PIN_BLEND_FRAMES = 10


def _h_from_corners(corners_ref: np.ndarray, corners_i: np.ndarray) -> np.ndarray:
    """H_to_ref for frame i given its ROI corners (maps frame-i -> ref coords)."""
    return np.asarray(
        cv2.getPerspectiveTransform(corners_i.astype(np.float32), corners_ref.astype(np.float32)),
        dtype=np.float64,
    )


def _corners_at(H_to_ref_i: np.ndarray, corners_ref: np.ndarray) -> np.ndarray:
    pts = corners_ref.reshape(-1, 1, 2).astype(np.float64)
    return cv2.perspectiveTransform(pts, np.linalg.inv(H_to_ref_i)).reshape(-1, 2)


def _confidence(inlier_ratio, fb_term, ecc_cc):
    if ecc_cc is None:
        conf = (0.5 * inlier_ratio + 0.25 * fb_term) / 0.75
    else:
        conf = 0.5 * inlier_ratio + 0.25 * fb_term + 0.25 * max(ecc_cc, 0.0)
    return float(np.clip(conf, 0.0, 1.0))


def _blend_pin_residual(H, order, pin_idx, corners_ref, corners_tracked, corners_pinned):
    """Distribute the tracked->pinned corner residual over the trailing frames."""
    residual = corners_pinned - corners_tracked
    pos = order.index(pin_idx)
    window = order[max(0, pos - PIN_BLEND_FRAMES) : pos]
    for j, idx in enumerate(window):
        w = (j + 1) / (len(window) + 1)
        corners_j = _corners_at(H[idx], corners_ref) + w * residual
        H[idx] = _h_from_corners(corners_ref, corners_j)


def _track_direction(
    frames,
    indices,
    reference_frame,
    roi_quad,
    model,
    H,
    conf,
    *,
    ecc_refine,
    max_corners,
    fb_thresh,
    min_features,
    keyframes,
    progress,
):
    ref_gray = frames[reference_frame]
    pts = detect_features(ref_gray, roi_quad, max_corners=max_corners)
    if len(pts) < 4:
        raise ValueError(
            f"only {len(pts)} trackable features inside the ROI at frame {reference_frame}; "
            "pick a more textured region or enlarge the ROI"
        )
    n_init = len(pts)
    prev_gray = ref_gray
    order = []

    # Appearance tracking (chain + ECC) runs independently of pins; a pin
    # defines a persistent reference-space correction composed on top, so the
    # ECC refine cannot fight a user correction on subsequent frames.
    H_app_prev = np.eye(3, dtype=np.float64)
    pin_offset = np.eye(3, dtype=np.float64)

    for idx in indices:
        cur_gray = frames[idx]
        p1, good, fb = lk_step(prev_gray, cur_gray, pts, fb_thresh=fb_thresh)

        Hp, inliers = (None, None)
        if good.sum() >= 4:
            Hp, inliers = fit_motion(pts[good], p1[good], model)

        if Hp is None:
            # Lost the region this frame: hold the previous transform, flag it.
            H_app = H_app_prev.copy()
            inlier_ratio = 0.0
            pts_next = p1[good]
        else:
            H_app = H_app_prev @ np.linalg.inv(Hp)
            inlier_ratio = float(inliers.mean())
            pts_next = p1[good][inliers]

        ecc_cc = None
        if ecc_refine and Hp is not None:
            H_app, ecc_cc = ecc_refine_to_reference(ref_gray, cur_gray, H_app, roi_quad, model)

        H[idx] = pin_offset @ H_app
        fb_term = float(1.0 - min(fb[good].mean() / fb_thresh, 1.0)) if good.any() else 0.0
        conf[idx] = _confidence(inlier_ratio, fb_term, ecc_cc)
        order.append(idx)

        if idx in keyframes:
            corners_pinned = np.asarray(keyframes[idx], dtype=np.float64)
            corners_tracked = _corners_at(H[idx], corners_ref=roi_quad)
            H[idx] = _h_from_corners(roi_quad, corners_pinned)
            pin_offset = H[idx] @ np.linalg.inv(H_app)
            conf[idx] = 1.0
            _blend_pin_residual(H, order, idx, roi_quad, corners_tracked, corners_pinned)
            pts_next = detect_features(cur_gray, corners_pinned, max_corners=max_corners)
            n_init = max(len(pts_next), 4)

        pts = pts_next
        if len(pts) < max(min_features, 0.5 * n_init):
            cur_roi = _corners_at(H[idx], roi_quad)
            fresh = detect_features(cur_gray, cur_roi, max_corners=max_corners, exclude=pts)
            if len(fresh):
                pts = np.concatenate([pts, fresh]) if len(pts) else fresh
                n_init = len(pts)

        H_app_prev = H_app
        prev_gray = cur_gray
        if progress is not None:
            progress()


def track_planar(
    frames: Sequence[np.ndarray],
    roi_quad: np.ndarray,
    reference_frame: int = 0,
    model: str = "homography",
    *,
    ecc_refine: bool = True,
    max_corners: int = 200,
    fb_thresh: float = 1.0,
    min_features: int = 40,
    keyframes: dict[int, np.ndarray] | None = None,
    progress: Callable[[], None] | None = None,
) -> TrackData:
    """Track a planar region through grayscale frames.

    frames: sequence of (H,W) uint8 grayscale, all the same size.
    roi_quad: (4,2) ROI corners at the reference frame (TL,TR,BR,BL).
    Returns TrackData at the resolution of `frames`.
    """
    n = len(frames)
    if not (0 <= reference_frame < n):
        raise ValueError(f"reference_frame {reference_frame} outside 0..{n - 1}")
    roi_quad = np.asarray(roi_quad, dtype=np.float64)
    keyframes = keyframes or {}

    H = np.tile(np.eye(3, dtype=np.float64), (n, 1, 1))
    conf = np.zeros(n, dtype=np.float64)
    conf[reference_frame] = 1.0

    common = dict(
        ecc_refine=ecc_refine,
        max_corners=max_corners,
        fb_thresh=fb_thresh,
        min_features=min_features,
        keyframes=keyframes,
        progress=progress,
    )
    if reference_frame < n - 1:
        _track_direction(
            frames, range(reference_frame + 1, n), reference_frame, roi_quad, model, H, conf, **common
        )
    if reference_frame > 0:
        _track_direction(
            frames, range(reference_frame - 1, -1, -1), reference_frame, roi_quad, model, H, conf, **common
        )

    h, w = frames[0].shape[:2]
    return TrackData(
        plate_size=(w, h),
        reference_frame=reference_frame,
        frame_count=n,
        model=model,
        corners_ref=roi_quad,
        H_to_ref=H,
        confidence=conf,
        keyframes={k: np.asarray(v, dtype=np.float64) for k, v in keyframes.items()},
        meta={"tracker": "planar", "ecc_refine": ecc_refine, "max_corners": max_corners},
    )


def track_points(
    frames: Sequence[np.ndarray],
    points: np.ndarray,
    reference_frame: int = 0,
    model: str | None = None,
    *,
    fb_thresh: float = 1.5,
    progress: Callable[[], None] | None = None,
) -> TrackData:
    """Track 1-4 explicit points; fit the richest model the point count allows.

    Point positions are chained with LK; the per-frame transform is fitted
    directly from reference positions -> current positions, so model error
    does not accumulate.
    """
    points = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    n_pts = len(points)
    if not (1 <= n_pts <= 4):
        raise ValueError("track_points expects 1-4 points")
    if model is None:
        model = {1: "translation", 2: "similarity", 3: "affine", 4: "homography"}[n_pts]

    n = len(frames)
    H = np.tile(np.eye(3, dtype=np.float64), (n, 1, 1))
    conf = np.zeros(n, dtype=np.float64)
    conf[reference_frame] = 1.0
    positions = np.zeros((n, n_pts, 2), dtype=np.float64)
    positions[reference_frame] = points

    for indices in (range(reference_frame + 1, n), range(reference_frame - 1, -1, -1)):
        prev_gray = frames[reference_frame]
        prev_H = np.eye(3, dtype=np.float64)
        cur_pts = points.astype(np.float32)
        alive = np.ones(n_pts, dtype=bool)
        for idx in indices:
            cur_gray = frames[idx]
            p1, good, _ = lk_step(prev_gray, cur_gray, cur_pts, fb_thresh=fb_thresh)
            # A lost point freezes at its last position and taxes confidence.
            cur_pts = np.where(good[:, None], p1, cur_pts).astype(np.float32)
            alive &= good
            positions[idx] = cur_pts
            Hf, _ = fit_motion(cur_pts.astype(np.float64), points, model)
            H[idx] = Hf if Hf is not None else prev_H
            prev_H = H[idx]
            conf[idx] = float(alive.mean())
            prev_gray = cur_gray
            if progress is not None:
                progress()

    # ROI for point tracks: bounding box of the points (degenerate for 1 point,
    # but corners_ref is only cosmetic in that case).
    x0, y0 = points.min(axis=0) - 1
    x1, y1 = points.max(axis=0) + 1
    quad = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float64)

    h, w = frames[0].shape[:2]
    return TrackData(
        plate_size=(w, h),
        reference_frame=reference_frame,
        frame_count=n,
        model=model,
        corners_ref=quad,
        H_to_ref=H,
        confidence=conf,
        meta={"tracker": "points", "points_ref": points.tolist(), "positions": positions.tolist()},
    )
