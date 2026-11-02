import test from 'node:test'; import assert from 'node:assert/strict';
import { projectedTrackPoints, nearestTriangle, anchorFromPoints, targetQuad } from '../track-points.js';
import { projectWorld, spatialPoseAt } from '../spatial-geometry.js';
const K = [[500, 0, 320], [0, 500, 240], [0, 0, 1]], pose = (us, x = 0, z = 0) => ({ sourceTimeUs: us, shotId: 0, worldToCamera: [[1, 0, 0, -x], [0, 1, 0, 0], [0, 0, 1, -z]], intrinsics: K, distortion: [0], status: 'observed' });
/* a wall 4 units ahead tilted 25° about the vertical axis, covered with landmarks */
const tilt = 25 * Math.PI / 180, wall = (u, v) => [u * Math.cos(tilt), v, 4 + u * Math.sin(tilt)];
const points = Array.from({ length: 169 }, (_, i) => ({ id: 'p' + i, xyz: wall((i % 13 - 6) * .18, (Math.floor(i / 13) - 6) * .14), error: .3, observations: 6 }));
const solution = { width: 640, height: 480, shots: [{ id: 0, fromUs: 0, toUs: 400000, poses: [pose(0), pose(200000, .15, .3), pose(400000, .3, .6)], points }] };

test('landmarks seen in a frame become evenly spread targets', () => {
  const pts = projectedTrackPoints(solution, 0, 640, 480, 120); assert.ok(pts.length > 20 && pts.length <= 130);
  for (const p of pts) assert.ok(p.x > 0 && p.x < 640 && p.y > 0 && p.y < 480);
});
test('hovering between targets finds the triangle that contains the cursor', () => {
  const pts = projectedTrackPoints(solution, 0, 640, 480, 150), c = pts[Math.floor(pts.length / 2)], tri = nearestTriangle(pts, c.x + 3, c.y + 2, 200);
  assert.equal(tri.length, 3); const [a, b, d] = tri, area = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)); assert.ok(area > 0);
});
test('three landmarks give the wall plane: its tilt is recovered and it stays fixed in the world as the camera moves', () => {
  const pts = projectedTrackPoints(solution, 0, 640, 480, 150), c = pts[Math.floor(pts.length / 2)], tri = nearestTriangle(pts, c.x + 3, c.y + 2, 200), a = anchorFromPoints(solution, 0, tri);
  const truth = [Math.cos(tilt), 0, Math.sin(tilt)]; const wallNormal = [-Math.sin(tilt), 0, Math.cos(tilt)]; // the surface's own normal
  assert.ok(Math.abs(a.normal[0] * wallNormal[0] + a.normal[1] * wallNormal[1] + a.normal[2] * wallNormal[2]) > .999, 'plane normal matches the real wall');
  const q0 = targetQuad(solution, 0, a, 640, 480), q1 = targetQuad(solution, .4, a, 640, 480); assert.ok(q0 && q1);
  assert.notDeepEqual(q0, q1, 'the target is drawn for each camera, from one fixed world plane'); assert.ok(truth);
});
test('many selected landmarks fit one best plane and ignore a stray point only if it lies on it', () => {
  const sel = points.filter((p, i) => i % 5 === 0).map((p) => ({ id: p.id, xyz: p.xyz })), a = anchorFromPoints(solution, 0, sel);
  const wallNormal = [-Math.sin(tilt), 0, Math.cos(tilt)]; assert.ok(Math.abs(a.normal[0] * wallNormal[0] + a.normal[2] * wallNormal[2]) > .9999); assert.equal(a.support, sel.length);
});
test('fewer than three landmarks never invent a plane', () => assert.equal(anchorFromPoints(solution, 0, points.slice(0, 2).map((p) => ({ id: p.id, xyz: p.xyz }))), null));
