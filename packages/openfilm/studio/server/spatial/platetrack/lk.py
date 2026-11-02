"""Pyramidal Lucas-Kanade step with forward-backward validation."""

from __future__ import annotations

import cv2
import numpy as np

_LK_PARAMS = dict(
    winSize=(21, 21),
    maxLevel=4,
    criteria=(cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 30, 0.01),
)


def lk_step(
    prev_gray: np.ndarray,
    next_gray: np.ndarray,
    pts: np.ndarray,
    fb_thresh: float = 1.0,
):
    """Track pts from prev to next. Returns (next_pts (N,2), good (N,) bool, fb_err (N,))."""
    if len(pts) == 0:
        return pts.copy(), np.zeros(0, dtype=bool), np.zeros(0)

    p0 = pts.reshape(-1, 1, 2).astype(np.float32)
    p1, st_f, _ = cv2.calcOpticalFlowPyrLK(prev_gray, next_gray, p0, None, **_LK_PARAMS)
    p0r, st_b, _ = cv2.calcOpticalFlowPyrLK(next_gray, prev_gray, p1, None, **_LK_PARAMS)

    fb_err = np.linalg.norm(p0.reshape(-1, 2) - p0r.reshape(-1, 2), axis=1)
    good = (st_f.ravel() == 1) & (st_b.ravel() == 1) & (fb_err < fb_thresh)
    return p1.reshape(-1, 2), good, fb_err
