"""Motion-model fitting between point sets, embedded as 3x3 homogeneous matrices."""

from __future__ import annotations

import cv2
import numpy as np

RANSAC_THRESH = 1.5


def _embed_affine(A: np.ndarray) -> np.ndarray:
    H = np.eye(3, dtype=np.float64)
    H[:2, :] = A
    return H


def fit_motion(src: np.ndarray, dst: np.ndarray, model: str):
    """Fit `model` mapping src -> dst points.

    Returns (H (3,3) float64, inlier_mask (N,) bool) or (None, None) when the
    fit is impossible (too few points, degenerate configuration).
    """
    n = len(src)
    min_pts = {"translation": 1, "similarity": 2, "affine": 3, "homography": 4}[model]
    if n < min_pts:
        return None, None

    src32 = src.astype(np.float32)
    dst32 = dst.astype(np.float32)

    if model == "translation":
        d = np.median(dst - src, axis=0)
        H = np.array([[1, 0, d[0]], [0, 1, d[1]], [0, 0, 1]], dtype=np.float64)
        residual = np.linalg.norm((src + d) - dst, axis=1)
        return H, residual < RANSAC_THRESH

    if model == "similarity":
        A, inliers = cv2.estimateAffinePartial2D(src32, dst32, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_THRESH)
    elif model == "affine":
        A, inliers = cv2.estimateAffine2D(src32, dst32, method=cv2.RANSAC, ransacReprojThreshold=RANSAC_THRESH)
    elif model == "homography":
        if n == 4:
            H = cv2.getPerspectiveTransform(src32, dst32)
            return np.asarray(H, dtype=np.float64), np.ones(4, dtype=bool)
        A, inliers = cv2.findHomography(src32, dst32, cv2.USAC_MAGSAC, RANSAC_THRESH)
        if A is None:
            return None, None
        return A.astype(np.float64), inliers.ravel().astype(bool)
    else:
        raise ValueError(f"unknown motion model: {model}")

    if A is None:
        return None, None
    return _embed_affine(A), inliers.ravel().astype(bool)


def decompose_similarity(H: np.ndarray):
    """Extract (tx, ty, rotation_deg, scale) from the affine part of H."""
    a, b = H[0, 0], H[0, 1]
    scale = float(np.hypot(a, b))
    rotation = float(np.degrees(np.arctan2(H[1, 0], H[0, 0])))
    return float(H[0, 2]), float(H[1, 2]), rotation, scale
