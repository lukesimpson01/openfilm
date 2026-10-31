#!/usr/bin/env node
/* Builds the motion graphics' map data from Natural Earth (public domain, naturalearthdata.com, "Made with Natural
   Earth"): src/frame/geo/world.json, every country's outline simplified for drawing at video sizes, and
   src/frame/geo/places.json, a gazetteer of ~7,300 populated places for the destination search.
   Usage: node build-geo.mjs <countries.json (Clyra Eye's delta-encoded pack)> <ne_10m_populated_places_simple.geojson> */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [countriesPath, placesPath] = process.argv.slice(2);
if (!countriesPath || !placesPath) { console.error('usage: build-geo.mjs <countries.json> <places.geojson>'); process.exit(2); }
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'frame', 'geo');
mkdirSync(out, { recursive: true });

const decode = (enc, decimals) => { const f = 10 ** decimals, ring = []; let x = 0, y = 0; for (let i = 0; i + 1 < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; ring.push([x / f, y / f]); } return ring; };
/* Douglas–Peucker on lon/lat (degrees) */
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let max = 0, at = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > max) { max = d; at = i; } }
    if (max > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = (r) => { let s = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s / 2); };

const pack = JSON.parse(readFileSync(countriesPath, 'utf8'));
const decimals = pack.meta?.decimals ?? 3;
const countries = [];
for (const f of pack.features) {
  const polys = [];
  for (const poly of f.polygons) {
    const outer = decode(poly[0], f.d ?? decimals);
    if (area(outer) < 0.02) continue; /* tiny islets do not read at video sizes */
    const s = simplify(outer, 0.06);
    if (s.length >= 4) polys.push(s.flatMap(([x, y]) => [Math.round(x * 10), Math.round(y * 10)]));
  }
  if (!polys.length) continue;
  /* the label point: the centroid of the largest part */
  const big = polys.reduce((a, b) => (b.length > a.length ? b : a));
  let cx = 0, cy = 0; for (let i = 0; i < big.length; i += 2) { cx += big[i]; cy += big[i + 1]; }
  countries.push({ n: f.name, iso: f.iso, c: [Math.round(cx / (big.length / 2)) / 10, Math.round(cy / (big.length / 2)) / 10], p: polys });
}
writeFileSync(join(out, 'world.json'), JSON.stringify({ source: 'Natural Earth 10m admin-0 countries (public domain), simplified', scale: 10, countries }));

const places = JSON.parse(readFileSync(placesPath, 'utf8')).features.map(({ properties: p }) => [
  p.nameascii || p.name, p.adm1name || '', p.adm0name || p.sov0name || '', Math.round(p.latitude * 1e4) / 1e4, Math.round(p.longitude * 1e4) / 1e4, p.pop_max || 0,
]).filter((x) => x[0] && Number.isFinite(x[3]) && Number.isFinite(x[4])).sort((a, b) => b[5] - a[5]);
writeFileSync(join(out, 'places.json'), JSON.stringify({ source: 'Natural Earth 10m populated places (public domain)', fields: ['name', 'region', 'country', 'lat', 'lon', 'population'], places }));
console.log(`world: ${countries.length} countries · places: ${places.length}`);
