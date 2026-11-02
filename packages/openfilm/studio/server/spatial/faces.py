"""Every face in a stretch of footage, frame by frame, with identities: the AI Clipper's own face tracker.
Clyra's clipper_face_tracking.py (UltraFace RFB-320 detections on every frame, MediaPipe face/pose where installed, validated
Lucas-Kanade flow between detections, an IoU tracker for identities) is run on the clip's range at the clip's own frame
rate. The editor picks the face under a click from this and follows that identity; nothing here guesses a face that was
neither detected nor carried by verified flow. Output: faces.json with per-frame boxes in source pixels.
"""
from engine import metadata, progress, peak_rss
from pathlib import Path
import argparse, json, os, shutil, sys, tempfile, time


def clipper_module():
    """clipper_face_tracking.py lives at the root of the Clyra checkout (CLYRA_SPATIAL_HOME), or above this file."""
    roots = [os.environ.get('CLYRA_SPATIAL_HOME'), *[str(p) for p in Path(__file__).resolve().parents]]
    for root in roots:
        if root and (Path(root) / 'clipper_face_tracking.py').is_file():
            sys.path.insert(0, root)
            import clipper_face_tracking
            return clipper_face_tracking
    raise RuntimeError("The AI Clipper's face tracker (clipper_face_tracking.py) was not found.")


def run(config):
    started = time.monotonic()
    out = Path(config['output']); out.mkdir(parents=True, exist_ok=True)
    tracker = clipper_module()
    meta = metadata(config['source']); w, h = int(meta['width']), int(meta['height'])
    rotation = next((s['rotation'] for s in meta.get('side_data_list', []) if 'rotation' in s), 0)
    if round(rotation) % 180 == 90: w, h = h, w
    num, _, den = str(meta.get('avg_frame_rate', '30/1')).partition('/')
    fps = max(1.0, min(60.0, float(num) / float(den or 1))) if float(num or 0) > 0 else 30.0
    start, end = float(config['from']), float(config['to'])
    progress('Finding faces', .1)
    cache = tempfile.mkdtemp(prefix='clyra-faces-', dir=str(out))
    try:
        a = tracker._analyse_proxy_stream(shutil.which('ffmpeg') or 'ffmpeg', config['source'], start, end - start, cache,
                                          height=480, fps=fps, thumb_dir=None, source_fps=fps, tracking_quality='quality')
    finally:
        shutil.rmtree(cache, ignore_errors=True)
    frames = []
    for f in a['face_tracks']:
        faces = []
        for x in f['faces']:
            b = x['bbox']
            faces.append({'id': x['trackId'], 'box': [b[0] * w, b[1] * h, b[2] * w, b[3] * h], 'confidence': round(float(x.get('confidence') or 0), 3),
                          'source': 'flow' if f.get('source') == 'optical-flow' else 'detected'})
        frames.append({'t': round(start + f['timeMs'] / 1000.0, 4), 'faces': faces})
    result = {'version': 1, 'w': w, 'h': h, 'fps': fps, 'backend': a['backend'], 'frames': frames,
              'elapsedMs': round((time.monotonic() - started) * 1000), 'peakRssBytes': peak_rss()}
    (out / 'faces.json').write_text(json.dumps(result))
    progress('Faces found', 1)


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--config', required=True)
    try:
        run(json.loads(Path(p.parse_args().config).read_text()))
    except Exception as e:
        print(json.dumps({'type': 'error', 'message': str(e)}), flush=True); raise
