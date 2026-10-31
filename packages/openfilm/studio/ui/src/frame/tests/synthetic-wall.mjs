import { intrinsics } from '../local-surface.js';
export const W = 180, H = 320, K = intrinsics(W, H);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
export const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
/* a textured world plane (sum of sines), seen by a camera that walks forward and drifts sideways while turning slightly */
export function render(n, d, j) {
  const right = unit([n[2], 0, -n[0]]), up = unit([n[1] * right[2] - n[2] * right[1], n[2] * right[0] - n[0] * right[2], n[0] * right[1] - n[1] * right[0]]);
  const rnd = (() => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  const waves = Array.from({ length: 40 }, () => [rnd() * 40 + 6, rnd() * 40 - 20, rnd() * 6.28, rnd() * 0.8 + 0.2]);
  const c = [0.025 * j, 0, 0.11 * j], yaw = 0.006 * j, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = [(x - K[2]) / K[0], (y - K[5]) / K[4], 1], dir = [cy * r[0] + sy * r[2], r[1], -sy * r[0] + cy * r[2]];
    const lam = (d - dot(n, c)) / dot(n, dir); if (!(lam > 0)) { out[y * W + x] = 128; continue; }
    const P = [c[0] + lam * dir[0], c[1] + lam * dir[1], c[2] + lam * dir[2]], u = dot(P, right) * 5, v = dot(P, up) * 5;
    let s = 0; for (const [a, b, p, g] of waves) s += g * Math.sin(a * u * 0.12 + b * v * 0.12 + p);
    out[y * W + x] = Math.max(0, Math.min(255, 128 + s * 9));
  }
  return out;
}
export const scene = (n, d, count = 12) => ({ grays: Array.from({ length: count }, (_, j) => render(n, d, j)), times: Array.from({ length: count }, (_, j) => j * 0.1) });

