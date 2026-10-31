import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foregroundMaskTile, nearestMaskFrame } from '../foreground-mask.js';

test('foreground silhouettes use the nearest recent native observation only', () => {
  const native = { frames: [{ sourceTimeUs: 0, mask: '0.png', confidence: .9 }, { sourceTimeUs: 100000, mask: '1.png', confidence: .95 }] };
  assert.equal(foregroundMaskTile('/p/', 'assets/scene/occlusion.json', native, null, .098).url, '/p/assets/scene/1.png');
  assert.equal(foregroundMaskTile('/p/', 'assets/scene/occlusion.json', native, null, 1), null);
  assert.equal(nearestMaskFrame([], .1, () => 0, .08), null);
});

test('uncertain or missing native masks do not masquerade as detected people', () => {
  const fallback = { w: 20, h: 10, cols: 2, rows: 1, count: 1, fps: 10, start: 0, atlases: ['atlas.png'], frames: [{ box: [0, 0, 2, 2] }] };
  assert.equal(foregroundMaskTile('/p/', 'assets/occ.json', { frames: [{ sourceTimeUs: 0, mask: 'weak.png', confidence: .4 }] }, fallback, 0), null);
  assert.equal(foregroundMaskTile('/p/', 'assets/occ.json', { frames: [{ sourceTimeUs: 0 }] }, fallback, 0), null);
});

test('lightweight masks select the correct atlas tile and omit frames without a detection', () => {
  const matte = { w: 20, h: 10, cols: 2, rows: 1, count: 4, fps: 10, start: 1, times: [1, 1.1, 1.2, 1.3], atlases: ['first.png', 'second.png'], frames: [{ box: 1 }, { box: 1 }, { box: 1 }, null] };
  assert.deepEqual(foregroundMaskTile('/p/', null, null, matte, 1.2), { url: '/p/second.png', x: 0, y: 0, w: 20, h: 10, timestamp: 1.2 });
  assert.equal(foregroundMaskTile('/p/', null, null, matte, 1.3), null);
  assert.equal(foregroundMaskTile('/p/', null, null, matte, 2), null);
});
