/* Place lookup over Natural Earth's populated places (public domain), bundled: the destination search in a map
   graphic's inspector and the editor AI both use it. Nothing is ever made up — no match is no result. */
export type Place = { name: string; lat: number; lon: number; country?: string; region?: string; label?: string };
type Row = [string, string, string, number, number, number];
let gazetteer: Promise<Row[]> | null = null;
const load = () => (gazetteer ??= import('./geo/places.json').then((m) => (m.default as unknown as { places: Row[] }).places));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/* what people (and the AI) write for a country or state, as the gazetteer names it */
const ALIAS: Record<string, string> = {
  usa: 'united states', us: 'united states', 'u.s.': 'united states', 'u.s.a.': 'united states', america: 'united states', 'united states of america': 'united states',
  uk: 'united kingdom', 'u.k.': 'united kingdom', britain: 'united kingdom', 'great britain': 'united kingdom', england: 'united kingdom', scotland: 'united kingdom', wales: 'united kingdom',
  uae: 'united arab emirates', 'south korea': 'korea', 'north korea': 'korea', russia: 'russia', czechia: 'czech', holland: 'netherlands', 'the netherlands': 'netherlands',
  nv: 'nevada', ca: 'california', ny: 'new york', tx: 'texas', fl: 'florida', wa: 'washington', il: 'illinois', ma: 'massachusetts', az: 'arizona', co: 'colorado', or: 'oregon', ga: 'georgia', nsw: 'new south wales',
};

/** "Paris" or "Paris, France" (or "Portland, Oregon"): matching places, most populous first. */
export async function searchPlaces(q: string, limit = 8): Promise<Place[]> {
  const query = fold(q); if (query.length < 2) return [];
  const [name, ...rest] = query.split(',').map((s) => s.trim()); const within = rest.map((r) => ALIAS[r] ?? r).join(' ');
  const all = await load();
  const hit = (p: Row, exact: boolean) => (exact ? fold(p[0]) === name : fold(p[0]).startsWith(name)) && (!within || fold(`${p[1]} ${p[2]}`).includes(within));
  const exact = all.filter((p) => hit(p, true));
  let rows = (exact.length ? exact : all.filter((p) => hit(p, false)));
  /* a qualifier the gazetteer words differently ("Las Vegas, Nevada, US") must not hide an exact city name */
  if (!rows.length && within) rows = all.filter((p) => fold(p[0]) === name);
  rows = rows.slice(0, limit);
  return rows.map((p) => ({ name: p[0], region: p[1], country: p[2], lat: p[3], lon: p[4], label: p[0] }));
}
/** One place for a name, or null when there is none (the caller says so; it never guesses). */
export async function resolvePlace(q: unknown): Promise<Place | null> {
  if (q && typeof q === 'object' && Number.isFinite((q as Place).lat) && Number.isFinite((q as Place).lon)) return q as Place;
  if (typeof q !== 'string') return null;
  return (await searchPlaces(q, 1))[0] ?? null;
}
