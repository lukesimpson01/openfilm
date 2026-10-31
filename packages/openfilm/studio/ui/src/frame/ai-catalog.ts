import type { Film } from '@/api';
import { api } from '@/api';
import { ZOOM_EFFECT } from './transitions-catalog.js';
import { GRAPHICS, BRAND_KITS } from './motion-graphics.js';
import { SUB_ANIMATIONS, SUB_FONTS, WORD_PRESETS, LINE_STYLES } from './subtitle-styles.js';
import { EASINGS } from './ai-keys';
import { knowledge } from './ai-knowledge';
import { DEVICE_PRESETS, START_FROM, FINISH_AT, ROTATIONS, EXITS } from './devices';
import { CAMERA_PRESETS, CAMERA3D_PRESETS } from './motion3d.js';
import { EFFECTS } from './transitions-catalog.js';
import { EFFECT_MODES, STICKERS, ANIM_NAMES } from './tracked';
import { lineOf, spans, LINE_LABEL } from './lines';
import { fadeMsOf } from '@/lib/clip-fade';
import { isFrameSrc, layerIdOf, readLayer, PROPERTY_DEFS as PROPERTY_DEFS_KEYS } from './layers';
import { FONT_CHOICES } from './font-library.js';

/* What the editor's AI knows: every tool it can use, each transition and motion graphic with what it does and the
   settings it takes (written from the same registries the panels and the renderer use, so it is never out of date),
   and the project as it stands now. */
type GParam = { key: string; label: string; type: string; options?: string[]; min?: number; max?: number; hint?: string };
type GDef = { id: string; name: string; category: string; about?: string; duration: number; params: GParam[]; defaults: Record<string, unknown> };

export function capabilities(): string {
  const gr = (GRAPHICS as unknown as GDef[]).map((g) => {
    const ps = g.params.map((p) => `${p.key} "${p.label}": ${p.type === 'select' ? (p.options ?? []).join('|') : p.type === 'number' && p.min != null ? `number ${p.min}–${p.max}` : p.type}${p.hint ? ` (${p.hint})` : ''} = ${JSON.stringify(g.defaults[p.key] ?? null)?.slice(0, 40)}`).join('; ');
    return `- ${g.id} "${g.name}" [${g.category}, ${g.duration}s] ${g.about || ''}\n    params: ${ps}`;
  }).join('\n');
  return `TOOLS (use them by writing an <actions> block, see PROTOCOL). Any "clip" can be "last": the clip the previous action in the same block added. An ease on a keyframe shapes the motion arriving at it.
- add_motion_graphic {graphic, at?, duration?, params?, name?} — put a motion graphic on the timeline (at = seconds, default the playhead). Params you leave out keep their defaults. A "place" param can be a name like "Tokyo, Japan" (resolved from the bundled Natural Earth gazetteer; never invent coordinates). "places" is a list of such names. Media params take a project file path (see MEDIA).
- update_motion_graphic {clip, params?, duration?} — change a motion graphic already on the timeline.
- add_transition {clip, side: "start"|"end", effect, duration?, params?, curve?} — a transition on a VIDEO or PHOTO clip's start or end: between it and its neighbour on the Video line, or from/to black at a free edge. curve is an optional speed graph [[0,0],[x,y]…,[1,1]] (progress over time) for this transition only.
- update_transition {clip, effect?, duration?, params?, curve?} — change a transition clip (its id starts with layer-tr-).
- apply_transition_to_all_cuts {effect, duration?, params?} — the same transition on every cut of the Video line.
- add_zoom {clip?, at?, duration?, scale?(1.1–4), center?[x,y 0–1], zoomIn?(share 0–1), zoomOut?(share, 0 = stay zoomed), easing?, curve?} — zoom into a point of the video/photo at the playhead (or the given clip): the point glides to the centre as it grows.
- add_text {text, at?, duration?, style?: "heading"|"text"|"caption", y?(0–100), color?, animation?} — a text layer; animation is a preset id or a list (an entrance, an exit, a loop) from ANIMATION PRESETS.
- add_sound {id?, query?, at?} — a sound effect from the library (see SOUND EFFECTS; use its id). Put sounds on the moment they belong to: a whoosh on a transition's start, a pop on a text or graphic appearing, an impact on a hard cut, a riser before a reveal.
- add_music {id?, query?} — a music track from the library (see MUSIC; by id, or a mood/name query), on an audio line from 0 s.
- add_media {path, at?} — put a project file (video/photo) on the Video line.
- move_clip {clip, at, line?(line index from PROJECT, to move it onto another line)} · set_length {clip, length} · remove_clip {clip} · set_speed {clip, speed(0.25–4, video/sound)} · set_volume {clip, volume(0–2)}
- clip_video {url?, path?, count?(1–8), length?(15–90 s), focus?} — run Clyra's AI clipper on a YouTube/web video URL or a project video: it finds the best moments, reframes them 9:16 with burned captions, and puts the clips on the Video line. Takes minutes; say so.
- add_story {kind:"chat"|"reddit"|"wyr", at?, gameplay?(minecraft-01|subway-01|gta-01|trackmania-01)} + for chat: {contact, skin?(ios-dark|ios-light|whatsapp-dark|whatsapp-light), messages:[{side:"left"|"right", text}]} (right = me); reddit: {posts:[{title, body, author?, votes?, comments?}], dark?}; wyr: {questions:[{a, b, percent(0–100 for a)}]} — a complete story video (with gameplay under chat/reddit) on the Video line. Write the whole script yourself.
- add_subtitles {cues?:[{start, end, text}], script?, from?, wordsPerCue?, position?(Top|Middle|Bottom), mode?(Word|Lines), styleId?, animation?, font?, fontSize?, textCase?(none|upper|lower|title), replace?} — captions on the subtitle line (times are film seconds). Speech is not transcribed automatically: write the cues from what the person gives you. styleId (Word): ${Object.keys(WORD_PRESETS).join(', ')}; (Lines): ${Object.keys(LINE_STYLES).join(', ')}. animation: ${(SUB_ANIMATIONS as string[]).join(', ')}. font: ${(SUB_FONTS as string[]).join(', ')}.
- create_graphic {name, html, css, at?, duration?} — a NEW motion graphic you design when no catalog graphic fits: HTML laid out on a 1080×1920 box (absolute px), CSS with @keyframes for every movement (animation-delay = when, in s from the clip start; fill-mode both). The film's time drives the animations, so preview = export. --t and --p (0–1) CSS variables are set each frame. No scripts. Make it premium: a clear focal point, 2–3 colours, real type hierarchy (e.g. 96–140px headline, 40–56px support), eased motion (cubic-bezier(.22,1,.36,1) in, (.64,0,.78,0) out), staggered entrances 60–120ms apart, inside the safe zone (see DESIGN RULES).
- update_graphic {clip, html?, css?, name?} — rewrite a custom graphic (read its current html/css from the layer in PROJECT first).
- add_shape {shape:"rect"|"ellipse"|"triangle"|"star"|"diamond"|"polygon"|"line"|"arrow", at?, duration?, props?, animation?} — an element on an overlay line. props: x, y (centre, % of frame), width, height (%), color, color2+gradient, cornerRadius, strokeColor, strokeWidth, opacity, rotation, shadowBlur, glow.
- update_layer {clip, text?, props?, animation?} — change a text, shape or image layer: text, x, y, width, height, scale, rotation, opacity, color, fontSize, font, weight, align, textCase, letterSpacing, strokeColor, strokeWidth, cornerRadius, shadowBlur, glow, blur; animation applies a preset.
- animate {clip, property, keyframes:[{time, value, ease?}], replace?(default true: these keys replace that property's keys, including a preset's; false adds to them)} — keyframes on a text/shape/image layer (time in seconds from the layer's start). property: ${Object.keys(PROPERTY_DEFS_KEYS).join(', ')}. ease: ${EASINGS.join(', ')}.
- split_clip {clip, at} — cut a video or sound clip in two at a film time (both halves keep their place; use it to remove a part: split twice, remove the middle, move what follows back).
- set_fade {clip, in?, out?} — fade a clip's picture and sound up from nothing at its start / down at its end (seconds).
- place_clip {clip, layout?: "full"|"top"|"bottom"|"left"|"right"|"pip-top-right"|"pip-top-left"|"pip-bottom-right"|"pip-bottom-left"|"center-card", left?, top?, width?, height? (all % of the frame), rotate?, fit?: "cover"|"contain"} — where a video, photo or page sits and how big (split screen, picture-in-picture, a card). "full" resets it.
- set_look {clip, brightness?, contrast?, saturate?, blur?(px), grayscale?, sepia?, hue?(deg), opacity?, radius?(px corner rounding)} — a colour/filter look on a video or photo (1 = unchanged for brightness/contrast/saturate; 0–1 for grayscale/sepia/opacity). Pass reset:true to clear.
- set_line {line, muted?, hidden?, locked?} — mute, hide or lock a whole line (index from PROJECT).
- add_device {preset, device?:"phone"|"laptop", screen?(project video/photo path), at?, length?, quick?:{entrance:"float"|"slide"|"fly"|"rise"|"none", startFrom:${Object.keys(START_FROM).join('|')}, finishAt:${Object.keys(FINISH_AT).join('|')}, duration(s of the move), rotation:${Object.keys(ROTATIONS).join('|')}, smooth, holdAtEnd, returnMotion, exit:${EXITS.join('|')}, exitDuration}, images?:[paths] (photoCards)} — real 3D devices (generic phone with camera bump and buttons, laptop with keyboard, trackpad and hinged lid) whose screen plays a project video in sync with the film. Presets: ${DEVICE_PRESETS.map((p) => `${p.id} (${p.about})`).join('; ')}.
- update_device {clip, object?(index), quick?, screen?, graphic?(a motion graphic id on the screen), finish?(phone: titanium|black|silver|gold|blue|white; laptop: silver|space|midnight|gold), lid?(0–135°), notch?, backlight?, scale?, motionBlur?(0–1, renders sub-frames: export quality), keys?:[{t, p:[x,y,z], r:[x,y,z]°, s, lid}] (a custom flight path: x,y in frame units −1…1, z toward the viewer)}.
- add_camera {mode:"2d"|"3d", preset, at?, length?, target?:[x,y] (0–1 of the frame), targets?:[[x,y]…] (between), zoom?(1–4), start?, stop? (s from the camera clip's start: when it moves and when it stops), smoothStart?, smoothStop?, returnBack?, returnDuration?, smoothReturn?, holdAfter?(keep the framing after the clip ends), shake?; 3D: orbit?(°), distance?, fov?, shots?:[{t (s from the clip start), view}] — a custom flight path, easiest way: views front, left45, left, back, right, right45, top, low, plus close / wide / high, combinable ("close left45", "wide top"); the camera flies smoothly between shots, always looking at the object} — a camera clip on its own line above the Video line: everything below it is seen through it (clips are not changed). Stopping the camera holds the framing while the video keeps playing. 2D presets: ${Object.entries(CAMERA_PRESETS).map(([k, v]) => `${k} "${v}"`).join(', ')}. 3D presets (move the 3D scenes below it): ${Object.entries(CAMERA3D_PRESETS).map(([k, v]) => `${k} "${v}"`).join(', ')}.
- update_camera {clip, preset?, target?, zoom?, start?, stop?, smoothStart?, smoothStop?, returnBack?, returnDuration?, returnAt?, smoothReturn?, holdAfter?, bounds?:"constrain"|"fill"|"allow", orbit?, distance?, fov?, shots? (3D: replaces the path, see add_camera)}.
- freeze_frame {clip, at, duration} — the VIDEO stops on the frame at \`at\` for \`duration\` s (a still put in), then continues; what follows moves later. (Different from a camera stop.)
- add_effect {effect, clip?, at?, duration?, params?} — a one-clip effect over the video at the playhead: ${(EFFECTS as { id: string; name: string; about: string; params: string[] }[]).map((e) => `${e.id} "${e.name}": ${e.about || 'zoom into a point (use add_zoom)'} params: ${e.params.join(', ')}`).join('; ')}. "split" is the beat point as a share (0–1) of the effect's length.
- analyse_footage {clip, at?, quality?:"fast"|"balanced"|"high", engine?:"auto"|"surface"|"spatial"|"advanced"} — automatically tracks camera motion and segments recognised people AND objects, refining close-ups when needed. Use an explicit source clip when several videos overlap. Reports quality, detected portrait inset and limitations; A result with analysis.spatial contains calibrated native COLMAP poses and sparse world points; otherwise it is a planar solve. Never describe the fallback as a 3D reconstruction. Advanced additionally requests optional SAM 2 instances and video depth; model and calibration failures stay explicit.
- track_target {clip, point:[sourcePixelX,sourcePixelY], size?:[width,height], sourceTime?(seconds), kind?:"cursor"|"text-caret"|"face"|"hand"|"body"|"text-ui"|"object"|"point"|"custom"} — real local patch/flow tracking, source PTS, confidence states, cached path. User-selected anchor remains authoritative. Cursor means hotspot; caret is blink-aware. Do not guess intended tiny targets or promise universal recovery. Headless/browser codec limitations may require proxy analysis, which the result reports.
- inspect_track {clip} — saved selection, measured timing, confidence and uncertain source intervals.
- correct_track {clip,point:[sourcePixelX,sourcePixelY],size?,sourceTime,kind?} — repair only the 3-second interval around a correction, preserving unaffected samples.
- follow_target {clip,settings?:{style:"precise"|"smooth"|"cinematic",zoom,x,y,smoothness,lookahead,deadZone,autoZoom}} — create or update a camera for the selected source, using cached observations. Never re-track to adjust framing. x/y use 0–1 composition coordinates.
- attach_target {clip,element} — attach an existing text/image/shape layer to verified target motion. Unobserved intervals hide the attachment; they are never presented as measured positions.
- inspect_layer {clip} — read the full saved settings, motion keys, source clip and placement before making a detailed edit.
- inspect_video {clip, question?} — DeepSeek vision reads 3 timestamped frames, reporting visible people, objects, motion cues and good placement. Use before reasoning about video contents; report provider errors honestly.
- inspect_scene {clip, at?} — DeepSeek vision identifies visible wall/floor planes and a safe interior polygon. Use before scene-aware tracked text. analyse_footage and add_tracked accept surface:"wall" to track a local wall plane and project text into its perspective, or surface:"auto" for standing text inside the scene.
- inspect_model {path} — read imported GLB/glTF/FBX meshes, bones and available animation names/durations. Animation-only files have no meshes.
- add_model {path, clip?(existing 3D scene), name?, at?, duration?, position?:[x,y,z], animation?:false} — import an existing project model into a scene. Reuse an existing scene for additional characters. Default embedded animation loops in place; animation:false leaves it still.
- append_model_animation {clip, object?(index), path?(animation FBX/glTF project path, default the model), animation?(clip index or name), start?(local seconds, default after last action), duration?, loop?, inPlace?, speed?, fade?} — add a later character action without duplicating the character. Mixamo bones are matched by name; inspect files first. glTF bundles need their binaries/textures beside them.
- set_3d_keyframe {clip, object?(index), time(local seconds), position?:[x,y,z], rotation?:[x,y,z degrees], look?:[x,y,z](camera target), scale?, lid?, fov?} — insert/update a custom motion diamond on an existing 3D object or camera. Preserves other keys and extends the clip. For no preset use add_camera mode:3d,preset:manual. In the fullscreen camera view, Fly with keyboard uses WASD, Q/E vertical, drag to look, Space to capture a key, Escape to leave flight mode.
Bundled fonts with visual previews: ${FONT_CHOICES.map((f:{name:string})=>f.name).join(', ')}. Rajdhani, Teko and Barlow Condensed suit original tactical location titles. Entrance/exit can be disabled with in:0/out:0; shadow is a separate boolean.
- append_device_action {clip, object?(index), action:"move"|"turn"|"hold"|"screenOn"|"screenOff"|"openLid"|"closeLid"|"exitLeft"|"exitRight"|"flyAway"|"fadeOut"|"reveal", duration?(seconds), position?:[x,y,z] (move target), turn?(degrees), screen?(project media path for screenOn)} — appends a new block on the SAME timeline track, sharing the existing scene/device. Always starts after the last action, independent of the playhead. Preserves the exact intro and previous terminal pose. Importing screen media does not turn it on: use screenOn to begin playback at that action. MacBook lids use bounded, minimum-jerk motion.
- refine_spatial_foreground {clip,from?,to?,instances?:[{box:[left,top,right,bottom]}],corrections?:[{x,y,r,add,from,to,instanceId?}]} — reuse the existing native camera; refine only foreground or apply explicit source-time mask edits. Boxes must come from actual visible evidence or user selection. Never invent a person. Inspect saved mask coverage/calibration afterward.
- append_model_animation also accepts spatial video layers; object is the imported item index. Actions continue on the same model and cannot extend beyond the source footage.
- inspect_spatial {clip, sourceTime?} — inspect native reconstruction quality, registered poses, world axes, relative scale, current camera and existing item anchors. A null pose is an unsupported frame; never invent one.
- place_spatial {clip, item?, sourceTime?, point:[x,y] normalized SOURCE pixels, type:"surface"|"world", distance?} — ray-cast into verified reconstructed neighbors for Surface; World uses an explicitly chosen relative ray distance. Surfaces require local support surrounding the click. A rejected click requires another point or a manually supplied transform; do not claim it succeeded.
- update_tracked additionally accepts world:{position:[x,y,z],rotation:[degreesX,degreesY,degreesZ],scale:[x,y,z],offset:[x,y,z],pivot:[x,y,z],depthOffset,motionSpace:"local"|"world",faceCamera:boolean,normal:[x,y,z],sidedness:"decal"|"double",parentId:another item ID or null} and motionKey:{t (layer-local seconds),p:[x,y,z],r:[degreesX,degreesY,degreesZ],scale3:[x,y,z],hold?,bezier?:[x1,y1,x2,y2]}. Inspect before editing. Scene units are relative; positive local Z follows the surface normal. Use keys to continue movement, never duplicate the object. Preview/export share these calibrated transforms. Camera solves do not rerun for text or motion changes. Auto depth needs calibrated depth; explicit Behind/In front is the honest fallback for relative-only depth. Surface attachments keep fixed normals and cannot face the camera; manual normals and depth are user choices. Per-instance overrides retain static geometry occlusion. Object-surface tracking currently assumes a rigid plane, and must not be described as a full non-rigid human pose.
- update_tracked {clip, item?(zero-based), anchor?:[x,y] (0–1 of SOURCE frame), sceneDepth?(0 near, .5 tracked plane, 1 far), elevation?(0–2 item heights), spacing?(.8–2), depth?(letter thickness 0–.6), size?, text?, font?, color?, sideColor?, rotationY?, tiltX?, rotation?, letters?, shadow?, anim?, animOut?, in?, out?, occlusion?:"auto"|"behind"|"front"|"manual",occlusionTarget?:instance ID or "all",manualDepth?:relative distance,occlusionRange?:{from,to,mode}} — edit existing tracked objects without rescanning. Distance controls perspective/parallax; thickness is separate. Inspect first; anchors refer to the analysis reference frame.
- review_project {} — read back saved layers and check durations, missing sources, weak tracking and missing foreground masks. Call before finishing an edit, fix the reported issues, and accurately state what was verified.
- add_tracked {clip?, at?, text, template:"behind"|"walkThrough"|"giant"|"floating"|"surface"|"location"|"sticker"|"image"|"video"|"model", sub?, sub2? (location: the lines under the place name, e.g. "OLD PORT · MONTREAL", "22:41 LOCAL"), sticker? (template sticker: ${STICKERS.map(([k]) => k).join(', ')}), image? (template image/video/model: a MEDIA path), animIn?, inDuration?, animOut?, outDuration? (styles: ${Object.keys(ANIM_NAMES).join(', ')}), anchor?:[x,y] (0–1 of the footage frame, where the text stands — its base), depth?:"behind"|"front"|"auto", occlusion?:[{from, to, mode}], style?:{font, color, color2, gradient, weight, sceneDepth(0 near to 1 far), elevation(0–2), spacing(.8–2), depth(letter thickness), tiltX, rotationY, size(px of the analysed frame), letters}, effect?, params?} — text placed IN the footage: tracked with the scene, people walk in front of it (behind), or it stays in front; walkThrough splits letters so a person can pass between them (auto). Subject effects (effect): ${Object.entries(EFFECT_MODES).filter(([k]) => k !== 'textBehind').map(([k, v]) => `${k} "${v}"`).join(', ')}. Runs analyse_footage first when needed.
- duplicate_clip {clip, at?} — copy a clip (and its page) to another time on the same line (default right after it).
- find_place {query} — look a place up in the gazetteer (to check before using it).
- open_tool {panel: "subtitles"|"stories"|"music"|"sfx"|"graphics"|"transitions"|"media"} — open a panel for the person to work in themselves (you can make stories and subtitles directly with add_story / add_subtitles).
- seek {time} — move the playhead.

Piercing Bullet (classic.piercing_bullet) params: pierce: clean|cinematic|glass|metal|comic|energy (its look), center [x,y] (impact point), angle (° the projectile comes from), amount (first opening size), split (impact moment share), intensity (flash), glow (debris), shadow (shake & bend), motionBlur (streak length), reverse.
Shared transition params: intensity 0–1, motionBlur 0–1, feather, easing (smooth|easeInOut|easeIn|easeOut|linear|snappy|overshoot), direction, center [x,y]. Shutters (landscape/portrait close): amount 0–1 (1 = fully close, 0.7 = 70% covered), center [x,y] (the strip centres on it), split (closing share; 1 = close and stay), hold, balance −1–1, match (crossfade inside a partial strip), color, color2, shadow, glow. Zoom (${ZOOM_EFFECT.id}) is added with add_zoom.

${knowledge()}

MOTION GRAPHICS (graphic ids). For trips use mg.flight "Travel Route": vehicle "airplane" (flights; route curved or great) or "car" (road trips; route "road"), from/to as place names, stops for a multi-stop trip, mapStyle vivid|sunset|night|minimal|dark|atlas|blueprint|mono, accent + accent2 (route gradient). Brand kits for params: ${Object.keys(BRAND_KITS).join(', ')} (or set accent/theme/speed yourself).
${gr}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/* a page clip in words: what it is and the settings that matter for editing it */
function describeLayer(l: Record<string, any>): string {
  const anim = Object.keys(l.appliedPresets ?? {}).length ? `, animation ${Object.keys(l.appliedPresets).join('+')}` : '';
  const keys = Object.keys(l.keyframes ?? {}).filter((k) => l.keyframes[k]?.length);
  const kf = keys.length ? `, keyframes on ${keys.join(', ')}` : '';
  switch (l.kind) {
    case 'mg': {
      const p = l.params ?? {}; const brief = Object.entries(p).filter(([, v]) => typeof v === 'string' && v && !String(v).startsWith('#') || (v && typeof v === 'object' && 'name' in (v as object)))
        .slice(0, 6).map(([k, v]) => `${k}=${typeof v === 'object' ? (v as { name: string }).name : String(v).slice(0, 30)}`).join(', ');
      return `motion graphic ${l.graphic} "${l.name}"${brief ? ` [${brief}]` : ''}`;
    }
    case 'transition': return `transition ${l.effect} ${l.duration}s on the ${l.side ?? '?'} of ${l.clipId ?? '?'} (${l.edge ?? 'cut'})${l.params?.style ? `, style ${l.params.style}` : ''}`;
    case 'effect': return l.effect && l.effect !== 'fx.zoom' ? `effect ${l.effect} "${l.name}" ${l.duration}s on ${l.clipId ?? 'the clip under it'}` : `zoom ×${l.params?.scale ?? 2} toward ${JSON.stringify(l.params?.center ?? [0.5, 0.5])} on ${l.clipId ?? 'the clip under it'}`;
    case 'text': return `text "${String(l.text ?? '').slice(0, 50)}" at x${Math.round(l.x)} y${Math.round(l.y)}, size ${l.fontSize}, ${l.color}${anim}${kf}`;
    case 'shape': return `shape ${l.shapeType ?? 'rect'} at x${Math.round(l.x)} y${Math.round(l.y)} ${l.width}×${l.height}%, ${l.color}${anim}${kf}`;
    case 'image': return `image ${l.src ?? ''}${anim}${kf}`;
    case 'subtitle': return `subtitles: ${(l.cues ?? []).length} lines (${(l.cues ?? []).slice(0, 3).map((c: { text: string }) => `"${c.text.slice(0, 20)}"`).join(', ')}${(l.cues ?? []).length > 3 ? '…' : ''}), ${l.mode} style ${l.styleId}`;
    case 'scene3d': return `3D scene "${l.name}" (${(l.objects ?? []).map((o: { type: string; screen?: { src?: string; graphic?: string } }) => `${o.type}${o.screen?.src ? ` screen=${o.screen.src}` : o.screen?.graphic ? ` screen=${o.screen.graphic}` : ''}`).join(', ')}${l.cameraMotion ? ', own camera move' : ''}${l.motionBlur ? `, motion blur ${l.motionBlur}` : ''})`;
    case 'camera': { const cm = l.camera ?? {}; const o = cm.opts ?? {}; if (cm.shots?.length) return `3D camera on shots ${cm.shots.map((x: { t: number; view: string }) => `${x.t}s ${x.view}`).join(' → ')}`; return `${cm.mode === '3d' ? '3D' : '2D'} camera ${cm.preset}: moves ${o.start ?? 0}–${o.stop ?? '?'}s${o.zoom ? `, zoom ${o.zoom}` : ''}${o.target ? `, target ${JSON.stringify(o.target)}` : ''}${o.returnBack ? `, returns over ${o.returnDuration ?? 0.8}s` : cm.holdAfter ? ', holds after the clip' : ''}`; }
    case 'track': return `tracked ${l.mode ?? 'textBehind'} "${l.name}" on ${l.clipId}: ${(l.items ?? []).map((it: { text?: string; image?: string; card?: string; place?: string; anim?: string }) => `${it.card === 'location' ? 'location title ' : ''}"${it.text ?? it.image}" (${it.place}${it.anim ? `, in: ${it.anim}` : ''})`).join(', ') || 'no objects'}, depth ${l.defaultDepth}, tracking ${l.analysis?.quality ?? '?'}`;
    case 'custom': return `custom graphic "${l.name}" ${l.duration}s — html: ${String(l.html ?? '').replace(/\s+/g, ' ').slice(0, 600)} — css: ${String(l.css ?? '').replace(/\s+/g, ' ').slice(0, 900)}`;
    case 'chat': return `fake text story with ${l.contact}: ${(l.messages ?? []).length} messages`;
    case 'reddit': return `Reddit story: "${String(l.posts?.[0]?.title ?? '').slice(0, 40)}"`;
    case 'wyr': return `Would You Rather: ${(l.questions ?? []).map((q: { a: string; b: string }) => `"${q.a.slice(0, 20)}" vs "${q.b.slice(0, 20)}"`).join('; ')}`;
    default: return `${l.kind} "${String(l.name ?? '').slice(0, 40)}"`;
  }
}
/** The project now: stage, playhead, every line and clip (with ids), and the media files it has. */
export async function snapshot(projectId: string, folder: string, film: Film | null, timeMs: number): Promise<string> {
  const lines: string[] = [];
  const stage = film?.stage ? `${film.stage.w}×${film.stage.h}` : '1080×1920';
  let end = 0;
  for (const [ti, tr] of (film?.tracks ?? []).entries()) {
    const sp = spans(tr.clips);
    const kind = tr.clips.length ? lineOf(tr.clips[0].src) : 'overlay';
    const rows: string[] = [];
    for (const [i, c] of tr.clips.entries()) {
      const s = sp[i]; if (s.end != null) end = Math.max(end, s.end);
      let what = c.src.split('#')[0];
      if (isFrameSrc(c.src)) {
        const l = await readLayer(folder, layerIdOf(c.src)).catch(() => null);
        if (l) what = describeLayer(l);
      }
      const fade = fadeMsOf(c); const extra: string[] = [];
      if (c.speed && c.speed !== 1) extra.push(`speed ${c.speed}`);
      if (c.volume != null && c.volume !== 1) extra.push(`volume ${c.volume}`);
      if (fade[0] || fade[1]) extra.push(`fade ${fade[0] / 1000}/${fade[1] / 1000}s`);
      if (c.box) extra.push(`placed ${JSON.stringify(c.box)}`);
      if (c.style) extra.push(`look "${c.style.slice(0, 60)}"`);
      if (c.time && !isFrameSrc(c.src) && c.time[0]) extra.push(`from ${c.time[0]}s of the file`);
      rows.push(`    ${c.id}: ${what} @ ${r2(s.start)}–${s.end != null ? r2(s.end) : '?'}s${extra.length ? ` (${extra.join(', ')})` : ''}`);
    }
    const flags = [tr.muted && 'muted', tr.hidden && 'hidden', tr.locked && 'locked'].filter(Boolean).join(', ');
    lines.push(`  line ${ti} (${LINE_LABEL[kind as keyof typeof LINE_LABEL] ?? kind}${flags ? `, ${flags}` : ''}):\n${rows.join('\n') || '    (empty)'}`);
  }
  let media = '';
  try {
    const listing = await api.files(projectId);
    media = listing.files.filter((f) => f.kind === 'video' || f.kind === 'image' || f.kind === 'audio'||/\.(fbx|glb|gltf)$/i.test(f.path)).slice(0, 100).map((f) => `  ${f.path} (${f.kind})`).join('\n');
  } catch { /* the listing is optional */ }
  return `PROJECT (now): stage ${stage}, length ${r2(end)}s, playhead ${r2(timeMs / 1000)}s. Lines top to bottom:
${lines.join('\n') || '  (no clips yet)'}
MEDIA files in the project:
${media || '  (none)'}`;
}

