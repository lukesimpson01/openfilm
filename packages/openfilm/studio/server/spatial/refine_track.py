"""Sub-pixel refinement of an existing planar track.
The editor's scan tracks a surface at a third of the footage's size (a few pixels of slide at full size). This re-aligns
every frame directly to the reference patch at full analysis size with PlateTrack's ECC refine-to-reference, starting from
the matrices the scan already found. A refinement is kept only when the patch agrees strongly and the answer stays near
the coarse one, or agrees very strongly (which also corrects chained drift); anything else keeps the scan's matrix. Frames
the scan marked lost stay lost. Output uses the scan's own coordinates and the same track contract.
"""
from engine import metadata, progress, peak_rss
from pathlib import Path
import argparse, bisect, json, time
import numpy as np, cv2, av
from platetrack.refine import ecc_refine_to_reference

def decode(path, times, longest):
    meta = metadata(path); rotation = next((s['rotation'] for s in meta.get('side_data_list', []) if 'rotation' in s), 0)
    order = sorted(range(len(times)), key=lambda i: times[i]); sorted_t = [times[i] for i in order]
    best = {}; container = av.open(str(path))
    with container:
        stream = container.streams.video[0]; stream.thread_type = 'AUTO'; origin = float((stream.start_time or 0) * stream.time_base)
        container.seek(int((max(0, sorted_t[0] - .25) + origin) / stream.time_base), stream=stream, backward=True)
        for frame in container.decode(stream):
            if frame.pts is None: continue
            ts = float(frame.pts * frame.time_base) - origin
            if ts < sorted_t[0] - .12: continue
            if ts > sorted_t[-1] + .12: break
            k = bisect.bisect_left(sorted_t, ts); cands = [c for c in (k - 1, k) if 0 <= c < len(sorted_t)]
            c = min(cands, key=lambda c: abs(sorted_t[c] - ts)); d = abs(sorted_t[c] - ts); idx = order[c]
            if idx in best and best[idx][0] <= d: continue
            im = frame.to_ndarray(format='gray')
            if round(rotation) % 360 == 270: im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
            elif round(rotation) % 360 == 90: im = cv2.rotate(im, cv2.ROTATE_90_COUNTERCLOCKWISE)
            elif round(rotation) % 360 == 180: im = cv2.rotate(im, cv2.ROTATE_180)
            h, w = im.shape[:2]; sc = min(1, longest / max(w, h)); im = cv2.resize(im, (round(w * sc), round(h * sc)), interpolation=cv2.INTER_AREA)
            best[idx] = (d, im)
    return {i: v[1] for i, v in best.items()}

def refine(config):
    started = time.monotonic(); Path(config['output']).mkdir(parents=True, exist_ok=True); times = config['times']; Hs = [np.array(h, dtype=float).reshape(3, 3) for h in config['H']]; lost = config.get('lost') or [False] * len(times)
    tw, th = config['trackW'], config['trackH']; n = len(times); ref = config['refIndex']
    progress('Reading the frames to refine', .05); grays = decode(Path(config['source']), times, config.get('longest', 960) if n <= 400 else 640)
    if ref not in grays: raise ValueError('The reference frame could not be read.')
    H0, W0 = grays[ref].shape; sx, sy = W0 / tw, H0 / th; S = np.diag([1 / sx, 1 / sy, 1.]); Sinv = np.diag([sx, sy, 1.])
    quad = (np.array(config['quad'], dtype=float) * [W0, H0]); refg = grays[ref]; frames = []; refined = 0; shifts = []
    for i in range(n):
        base = Hs[i]
        entry = {'t': times[i], 'H': base.ravel().tolist()}
        if i == ref: entry['ref'] = True
        if lost[i]: entry['lost'] = True; entry['inliers'] = 0; entry['points'] = 0; frames.append(entry); continue
        if i != ref and i in grays:
            Hp = Sinv @ base @ S; Hc = np.linalg.inv(Hp)   # plate resolution, frame -> reference
            Hr, cc = ecc_refine_to_reference(refg, grays[i], Hc, quad, 'homography')
            if cc is not None and cc >= .9:
                Hf = np.linalg.inv(Hr); Hf = Hf / Hf[2, 2]
                shift = float(np.linalg.norm(cv2.perspectiveTransform(quad.astype(np.float32)[None], Hf)[0] - cv2.perspectiveTransform(quad.astype(np.float32)[None], Hp)[0], axis=1).mean())
                if np.isfinite(shift) and not ((cc < .94 and shift > 4) or shift > 60):
                    out = S @ Hf @ Sinv; out = out / out[2, 2]; entry['H'] = out.ravel().tolist(); entry['method'] = 'ecc-refine'; entry['ecc'] = round(cc, 4); refined += 1; shifts.append(shift)
        frames.append(entry)
        if i % 8 == 0: progress('Refining the surface to sub-pixel accuracy', .1 + .88 * i / n)
    return {'frames': frames, 'refined': refined, 'considered': sum(1 for l in lost if not l) - 1, 'medianShiftPx': round(float(np.median(shifts)), 2) if shifts else 0,
            'elapsedMs': round((time.monotonic() - started) * 1000), 'peakRSSBytes': peak_rss()}

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--config', required=True); config = json.loads(Path(p.parse_args().config).read_text())
    try:
        result = refine(config); out = Path(config['output']) / 'track.json'; tmp = out.with_suffix('.tmp'); tmp.write_text(json.dumps(result, separators=(',', ':'))); tmp.replace(out)
        print(json.dumps({'type': 'done', 'path': str(out)}), flush=True)
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': str(e)}), flush=True); raise
