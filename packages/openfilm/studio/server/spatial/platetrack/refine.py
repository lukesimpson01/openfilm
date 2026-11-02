"""ECC refinement of a chained homography against the reference frame.

Pure frame-to-frame chaining accumulates drift; re-aligning every frame's ROI
patch to the *reference* patch with findTransformECC pins the track down.
"""

from __future__ import annotations

import cv2
import numpy as np

_ECC_MOTION = {
    "translation": cv2.MOTION_TRANSLATION,
    "similarity": cv2.MOTION_EUCLIDEAN,
    "affine": cv2.MOTION_AFFINE,
    "homography": cv2.MOTION_HOMOGRAPHY,
}

_ECC_CRITERIA = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_COUNT, 50, 1e-5)

MAX_PATCH = 256


def _crop_transform(roi_quad: np.ndarray):
    """T maps patch coords -> reference-frame coords (offset + optional upscale)."""
    x0, y0 = np.floor(roi_quad.min(axis=0))
    x1, y1 = np.ceil(roi_quad.max(axis=0))
    w, h = x1 - x0, y1 - y0
    scale = max(w, h) / MAX_PATCH if max(w, h) > MAX_PATCH else 1.0
    T = np.array([[scale, 0, x0], [0, scale, y0], [0, 0, 1]], dtype=np.float64)
    size = (int(round(w / scale)), int(round(h / scale)))
    return T, size


def ecc_refine_to_reference(
    ref_gray: np.ndarray,
    cur_gray: np.ndarray,
    H_chain: np.ndarray,
    roi_quad_ref: np.ndarray,
    model: str,
):
    """Refine H_chain (cur -> ref) by aligning the warped ROI patch to the reference patch.

    Returns (H_refined, ecc_cc). On ECC divergence returns (H_chain, None).
    """
    T, size = _crop_transform(roi_quad_ref)
    T_inv = np.linalg.inv(T)

    template = cv2.warpPerspective(ref_gray, T_inv, size, flags=cv2.INTER_LINEAR)
    warped = cv2.warpPerspective(cur_gray, T_inv @ H_chain, size, flags=cv2.INTER_LINEAR)

    motion = _ECC_MOTION[model]
    if motion == cv2.MOTION_HOMOGRAPHY:
        warp = np.eye(3, dtype=np.float32)
    else:
        warp = np.eye(2, 3, dtype=np.float32)

    try:
        cc, warp = cv2.findTransformECC(
            template, warped, warp, motion, _ECC_CRITERIA, None, 5
        )
    except cv2.error:
        return H_chain, None

    M = np.eye(3, dtype=np.float64)
    M[: warp.shape[0], :] = warp.astype(np.float64)

    # findTransformECC: template(x) ~ warped(M @ x), so a template point x
    # corresponds to warped-patch point M @ x. Composing through the patch
    # transforms gives the corrected cur -> ref mapping:
    H_refined = T @ np.linalg.inv(M) @ T_inv @ H_chain
    return H_refined, float(cc)
