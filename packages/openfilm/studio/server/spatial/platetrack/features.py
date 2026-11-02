"""ROI-masked feature detection with sub-pixel refinement."""

from __future__ import annotations

import cv2
import numpy as np

_SUBPIX_CRITERIA = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01)


def detect_features(
    gray: np.ndarray,
    roi_quad: np.ndarray,
    max_corners: int = 200,
    quality: float = 0.01,
    exclude: np.ndarray | None = None,
    exclude_radius: int = 10,
) -> np.ndarray:
    """Detect trackable corners inside roi_quad. Returns (N,2) float32."""
    mask = np.zeros(gray.shape[:2], dtype=np.uint8)
    cv2.fillPoly(mask, [np.round(roi_quad).astype(np.int32)], 255)
    if exclude is not None:
        for x, y in exclude:
            cv2.circle(mask, (int(round(x)), int(round(y))), exclude_radius, 0, -1)

    diag = float(np.linalg.norm(roi_quad[0] - roi_quad[2]))
    min_distance = max(5.0, diag / 30.0)
    pts = cv2.goodFeaturesToTrack(gray, max_corners, quality, min_distance, mask=mask)
    if pts is None:
        return np.empty((0, 2), dtype=np.float32)
    pts = pts.reshape(-1, 2).astype(np.float32)
    cv2.cornerSubPix(gray, pts, (5, 5), (-1, -1), _SUBPIX_CRITERIA)
    return pts
