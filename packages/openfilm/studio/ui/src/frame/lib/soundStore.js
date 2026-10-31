import { registerImported, registerCustom, unregisterImported, SFX_CATALOG, SFX_LICENSE, sfxById, catalogEntry } from "./sfxLibrary.js";
import { getAudioContext } from "./sfxPlayback.js";
import {exactSoundName}from'../../../../../src/recording-identity.mjs';

/* Imported sounds live in IndexedDB on this machine only. A file imported into a library slot (e.g. "Fah") fills that slot;
   anything that doesn't match a slot becomes a "My sounds" entry. Nothing is uploaded anywhere. */
const DB = "frame-sounds", STORE = "files";
const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode), s = t.objectStore(STORE), r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); };

export async function decodeToMono(blob) {
  const ctx = getAudioContext(), buf = await ctx.decodeAudioData(await blob.arrayBuffer()), mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  return { samples: mono, sr: buf.sampleRate, dur: buf.duration };
}
function activate(id, name, decoded) {
  registerImported(id, { ...decoded, name });
  if (!catalogEntry(id)) registerCustom({ id, name, category: "My sounds", tags: ["mine", "imported"], aliases: [], seed: 1, imported: true, samples: decoded.samples, sr: decoded.sr, dur: decoded.dur, ...SFX_LICENSE, license: "Your file", creator: "You", source: "Imported on this device" });
}
export async function loadImportedSounds() {
  let files = [];
  try { const db = await open(); files = await new Promise((res, rej) => { const out = [], r = db.transaction(STORE).objectStore(STORE).openCursor(); r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); }; r.onerror = () => rej(r.error); }); } catch { return 0; }
  let n = 0;
  for (const [id, v] of files) { try { activate(id, v.name, await decodeToMono(v.blob)); n++; } catch { /* undecodable file is skipped */ } }
  return n;
}
/** An exact label or explicit catalog id only. Variants remain separate user sounds. */
export function matchSlot(fileName, slots = SFX_CATALOG.filter((s) => s.group === "brainrot")) {
  const stem=exactSoundName(String(fileName).replace(/\.[a-z0-9]{2,5}$/i,''));
  return slots.find(s=>exactSoundName(s.name)===stem||exactSoundName(s.id)===stem)??null;
}
export async function importSoundFile(file, slotId = null) {
  const decoded = await decodeToMono(file), slot = slotId ? catalogEntry(slotId) : matchSlot(file.name);
  const id = slot ? slot.id : "imp-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name = slot ? slot.name : file.name.replace(/\.[^.]+$/, "");
  await tx("readwrite", (s) => s.put({ name, blob: file }, id));
  activate(id, name, decoded);
  return { id, name, slot: !!slot };
}
export async function removeImported(id) { await tx("readwrite", (s) => s.delete(id)); unregisterImported(id); }

/** Bundled / URL sounds (e.g. the Kevin MacLeod tracks) decode on first use. Resolves when samples are ready (or fails quietly). */
const loading = new Map();
export function ensureLoaded(id) {
  const e = sfxById(id);
  if (!e || e.samples || !e.url) return Promise.resolve(!!e?.samples);
  if (!loading.has(id)) loading.set(id, fetch(e.url).then((r) => { if (!r.ok) throw new Error("fetch"); return r.blob(); }).then(decodeToMono).then((d) => { registerImported(id, { ...d, name: e.name, fromUrl: true }); return true; }).catch(() => { loading.delete(id); return false; }));
  return loading.get(id);
}
export const isLoading = (id) => loading.has(id) && !sfxById(id)?.samples;
