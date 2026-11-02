"""Sub-pixel planar solve for the dominant surface, using the vendored PlateTrack core (features -> LK -> robust fit ->
chain -> ECC refine-to-reference). The editor's in-browser scan finds the surface at 1/3 resolution (about 4-6 px of
slide at full size); this re-solves the same surface at full analysis resolution and writes the same track contract,
in the scan's own coordinates, so everything that reads the track (placement, preview, export) gets the better matrices.
A frame it cannot verify stays lost, exactly as before; nothing is invented.
"""
from engine import frames, progress, peak_rss
from pathlib import Path
import argparse, json, time
import numpy as np, cv2
from platetrack.tracker import track_planar

LOST_BELOW = .35

def solve(config):
    started = time.monotonic(); output = Path(config['output'])
    samples, dim = frames(Path(config['source']), config['from'], config['to'], output / 'frames', fps=config.get('fps', 18), max_frames=config.get('maxFrames', 240), longest=config.get('longest', 960))
    W, H = dim['width'], dim['height']; tw, th = config['trackW'], config['trackH']; sx, sy = W / tw, H / th
    shot = samples[0]['shot']; first = [i for i, r in enumerate(samples) if r['shot'] == shot]; last_in_shot = first[-1]
    grays = [cv2.imread(str(output / 'frames' / samples[i]['name']), 0) for i in first]
    # The surface's region: the box around the points the scan trusted, padded; a wide region keeps a passer-by from dominating.
    pts = np.array(config.get('refPoints') or [], dtype=float).reshape(-1, 2)
    if len(pts) >= 8:
        x0, y0 = pts.min(0) - [.08 * tw, .08 * th]; x1, y1 = pts.max(0) + [.08 * tw, .08 * th]
    else:
        x0, y0, x1, y1 = .08 * tw, .08 * th, .92 * tw, .92 * th
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(tw, x1), min(th, y1)
    # Only the surface the scan found is tracked: its inlier points mark where that plane is. A wider box would pull the
    # floor and side walls (other planes) into the fit.
    if (x1 - x0) * (y1 - y0) < .06 * tw * th:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; hw, hh = .13 * tw, .13 * th; x0, y0, x1, y1 = cx - hw, cy - hh, cx + hw, cy + hh
    roi = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) * [sx, sy]
    progress('Refining the surface to sub-pixel accuracy', .1)
    track = track_planar(grays, roi, reference_frame=0, model='homography', max_corners=300)
    S = np.diag([1 / sx, 1 / sy, 1.]); Sinv = np.diag([sx, sy, 1.]); out = []; Hlast = np.eye(3); err = []
    for k in range(len(samples)):
        row = samples[k]; t = row['sourceTimeUs'] / 1e6
        if k > last_in_shot or k >= len(first):   # a cut: the next shot is its own scene, tracked on its own
            out.append({'t': t, 'H': Hlast.ravel().tolist(), 'lost': True, 'inliers': 0, 'points': 0}); continue
        conf = float(track.confidence[k]); Href = S @ np.linalg.inv(track.H_to_ref[k]) @ Sinv; Href = Href / Href[2, 2]
        if k and conf < LOST_BELOW:
            out.append({'t': t, 'H': Hlast.ravel().tolist(), 'lost': True, 'inliers': 0, 'points': 0}); continue
        Hlast = Href; out.append({'t': t, 'H': Href.ravel().tolist(), 'inliers': 64, 'points': 64, 'err': round(1 - conf, 4), 'method': 'platetrack-ecc', **({'ref': True} if k == 0 else {})})
        if k: err.append(1 - conf)
    return {'version': 1, 'w': tw, 'h': th, 'mode': 'camera', 'model': 'homography', 'frames': out, 'engine': 'platetrack-ecc/opencv-' + cv2.__version__,
            'lostShare': sum(bool(f.get('lost')) for f in out) / len(out), 'elapsedMs': round((time.monotonic() - started) * 1000), 'peakRSSBytes': peak_rss()}

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--config', required=True); config = json.loads(Path(p.parse_args().config).read_text())
    try:
        result = solve(config); out = Path(config['output']) / 'track.json'; tmp = out.with_suffix('.tmp'); tmp.write_text(json.dumps(result, separators=(',', ':'))); tmp.replace(out)
        print(json.dumps({'type': 'done', 'path': str(out)}), flush=True)
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': str(e)}), flush=True); raise
