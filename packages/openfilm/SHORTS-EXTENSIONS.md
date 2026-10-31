# Shorts extensions to OpenFilm

This copy of OpenFilm is the Shorts advanced editor. On top of the format in SPEC.md it adds editable **layer pages**:
`frame/<id>.html` files holding a JSON layer (`<script type="application/json" id="layer">`) and the shared runtime
(`runtime.js`, copied into `frame/` by the editor). Every one is a pure function of `t`, so preview and export match.
An agent editing a project by hand should write layers in the same shape the editor does (or use the editor's AI chat,
which has tools for all of them). The runtime files are refreshed when the editor opens a project.

| `kind` | What it is | Key fields |
| --- | --- | --- |
| `text`, `shape`, `image` | Elements with keyframes (`keyframes[prop] = [{t,value,ease}]`) | `x`,`y` (% of frame), `width`,`height`, `color`, `fontSize`… |
| `mg` | Motion graphic from the registry in `motion-graphics.js` (`mg.flight` Travel Route, `mg.counter`…) | `graphic`, `params` |
| `transition` | A transition between two clips (shader `transition-gl.js`, catalog `transitions-catalog.js`) | `effect` (`classic.*`), `params`, `clipId`, `side` |
| `effect` | A one-clip effect over a video's own footage | `effect`: `fx.zoom`, `fx.velocity`, `fx.beatShake`, `fx.flash`, `fx.glitch`, `fx.leak`, `fx.roll`, `fx.splitFreeze`; `aSrc`, `aAt`, `aSpeed` |
| `chat`, `reddit`, `wyr`, `subtitle` | Story videos and captions | see `StoryFields.tsx`, `SubtitleFields.tsx` |
| `scene3d` | Three.js scene: phone, laptop, cards, 3D text; screens play project media | `objects[] = {type, screen:{src,fit,offset,speed,loop}, motion, finish, lid}`, `cameraMotion`, `motionBlur` |
| `camera` | A camera clip (file name `layer-cam-*.html`) | `camera = {mode:'2d'|'3d', preset, opts, motion, bounds, holdAfter, media}` |
| `track` | Objects placed in real footage, and subject effects | `source`, `track` (tracking json), `matte.meta`, `items[]`, `mode`, `occlusion[]`, `defaultDepth` |

## Motion (`motion3d.js`)

One engine for devices, 3D text, cards and both cameras: `motion = { keys:[{t, p:[x,y,z], r:[x,y,z]°, s, o, lid, zoom,
look, fov}], curved, arcLength, smoothStart, smoothStop, returnBack, returnAt, returnDuration, smoothReturn, loop,
reverse, faceCamera, alongPath, bank, shake }`. Keys are reached exactly at their times; speed is continuous through
inner keys; after the last key the state holds (no drift); a return starts at `returnAt`. Device positions are frame
units (−1…1 at depth 0), z toward the viewer. 2D camera keys use `p:[cx,cy,0]` in stage px and `zoom`.

## Cameras

The film timeline (`src/timeline.mjs`) treats a page whose film object has `camera(t)` as a camera. The highest camera
on at `t` (or holding after its end when `holdAfter`) is used: a 2D camera's CSS transform is put before the own place
of every clip on the tracks below it; a 3D camera's state is given to the pages below (`window.__filmCamera3d`), which
3D pages draw through. Clips are never changed by a camera. A 3D camera also gives a CSS `matrix3d` (`camera3dCss` in
`motion3d.js`) to every other clip below it, so plain footage, photos and text orbit, tilt and push in with real
perspective; pages that draw their own 3D (`scene3d`, marked `camera3d: true`) are left to do it themselves. The view
is enlarged just enough that it never shows past the footage's edges (`bounds: 'allow'` turns that off).

## Tracking and masks

`analysis.ts` (editor) decodes a stretch of footage at proxy size, tracks it (`track-core.js`: Shi–Tomasi corners,
pyramidal Lucas–Kanade with a forward–backward check, RANSAC homography or similarity against the reference frame, cut
detection) and segments the subject with MediaPipe (DeepLab v3 for people/objects in a scene, tiled; the multiclass
selfie model for close-ups). Results: `assets/track/<id>.json` (per-frame homography, error, inliers, `refPoints`),
`assets/mattes/<id>/matte.json` + `atlas-*.png` (8×8 mask frames per atlas, subject box and foot line per frame).
The solve is planar (one dominant surface) or motion-only; it is not a full 3D reconstruction, and it says how good it
is (`quality`, `medianError`, `inlierShare`).

## Placing on a surface (Track tab)

The Track tab scans on its own when footage is selected, then shows diamonds: the scene reader's planes when it ran,
otherwise `suggestSpots` (`cling.js`): the frame's best trackable corners. A click finds the surface under it from the
scan's own frames (`local-surface.js`, in a worker): a patch around the click is tracked over the shot, its homographies
are decomposed to the surface's orientation (walls upright, floors flat; the solution that faces the camera, keeps the
clicked point in front of both views and needs the least camera turn wins; three patch widths must agree), and the text
gets a perspective quad on that surface. Frames the patch loses continue with the whole camera's motion. A click on a
detected person or object asks whether the text goes behind or in front, and uses the background track.

Scans default to the fast path (in-browser tracking and masks, seconds). When a scan sees the camera travel
(`trackTranslation` in `analysis-plan.js`) or people, the Track tab offers "Sharpen with 3D and precise masks": the
native path (COLMAP camera solve, then SAM 2 masks), which takes minutes. On a 2019 Intel MacBook Pro the solve took
about 14 minutes for a 12 s 720p clip and SAM 2 hit its 15 minute budget, so it is never started without asking. Free
memory is read from `vm_stat` on macOS. A reconstructed surface the camera sees nearly edge-on (sparse points behind glass)
is not trusted: the text stands at that depth facing the camera, and the card says so.

Subject masks are upsampled edge-aware in `track-runtime.js` (each mask sample weighted by how close its footage colour
is), widened by `edgeShift` −0.06 by default, and both passes blend "over" for alpha as well as colour.

A patch that has mostly left the picture is treated as gone from then on (what it still "finds" there is the background
behind it); frames after it continue with the patch's own last motion when it was leaving, so a poster walked past leaves
the frame with the text on it. A detected "person" lying wholly inside the text's own surface without reaching its lower
edge (a figure printed on a poster or shown on a screen) is drawn under the text, not over it (`uExclude` in the subject
pass); people in front of a hung poster stand on the ground below it, so they still cover the text.

Known limits: a click right on a wall/floor edge can pick the mirror orientation; the light (in-browser) masks are coarse
for crowds, so text can show through a body or a halo where they miss; the native path takes minutes for a 12 s clip.

Precise people masks for one spot: once text is placed, `crossingPeople` (`printed-subjects.js`) looks for people the
light masks see crossing the text's surface (printed figures excluded) and, when there are any, the Track tab offers
"Make their edges precise". That runs SAM 2.1 tiny on just those people over just those seconds (8 fps, no camera solve),
saves the union mask beside the scan result and the subject pass uses it in place of the light mask. Measured on the same
laptop: about 11 minutes for 4.2 s with two people, so the card states its estimate and the job can be cancelled.

## Editor basics

- Media: analysis folders (`spatial`, `track`, `mattes`, `scene`, `tracking2d`) under `assets/` are left out of the media
  list (`listFiles`), and layer pages (`frame/…`) show only when searched. Every tile has a "+" that adds it to the
  timeline, for those who do not drag.
- Text: a double click on a title on the stage edits its words in place; Escape keeps what was typed. A double click on a
  layer title (no editable words on the stage) focuses the inspector's Text field.
- Undo: inspector edits of a layer's page (text, transform, effects, keyframes) are undo steps (`record` in `use-film.ts`):
  one step per burst of edits, undo writes the page back as it was before it.
- Music: a song added from the Music tab ends where the last picture ends (sound effects keep their own length).
  Kevin MacLeod tracks are bundled under CC BY 4.0; commercial releases are never bundled, each plays only from a copy in
  the local recording library (`shorts-library/recordings`, git-ignored).
