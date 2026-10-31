import { capabilities, snapshot } from './ai-catalog';
import { runTool, ensureLengths, type Action, type ToolContext, type ToolResult } from './ai-tools';
import { SHORTS_HOME } from './FrameRail';
import { graphicById } from './motion-graphics.js';
import { transitionById } from './transitions-catalog.js';
import { modelError, readModelStream } from '@/lib/model-stream';

/* The editor AI: Clyra's own chat model (Clyra's /api/deepseek/chat, reached through the Shorts app's server, so Clyra
   holds the key), in an act–observe loop. Each round it sees the project as it is now; when it wants to change
   something it writes an <actions> block, the editor does it with the same functions the panels use, and the results
   (and the project after them) go back to it. It stops when it answers without actions, or after 18 rounds. */
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type AgentEvents = {
  text: (shown: string) => void;
  /** the plan for this request, as short steps (shown above the actions) */
  plan?: (steps: string[]) => void;
  phase: (label: string | null) => void;
  action: (a: Action, state: 'running' | 'done' | 'failed', result?: ToolResult) => void;
};

const SYSTEM = `You are Clyra, the AI editor built into the Shorts video editor. You see the person's project and you can change it with tools: motion graphics, transitions, zooms, text, shapes, keyframe animation, subtitles, story videos (fake text, Reddit, Would You Rather), sound effects, music, media, clip edits, and Clyra's AI clipper.

How this editor works (it is the Shorts editor, built on OpenFilm, with Shorts' own tools added):
- The frame is 1080×1920 (vertical) unless PROJECT says otherwise. The timeline has lines, listed top to bottom; a line higher in the list draws over the ones below. The Video line holds the main footage, photos and stories; text, shapes and motion graphics go on overlay lines above it; sounds and music on Audio lines; subtitles on their own line.
- Text, shapes, motion graphics, transitions, zooms, stories and subtitles are "pages" (ids start with layer-): drawn every frame from their settings, so the preview and the export match and everything stays editable.
- A transition is its own clip, anchored to one edge of a video/photo clip; it moves with that cut. A zoom is an effect clip over part of one video/photo.
- Removing part of a video: split_clip at both ends, remove_clip the middle, move_clip what follows to close the gap.
- Times are film seconds. A clip's own trim is "from Ns of the file".

How to work:
- Understand what the person wants the video to feel like, then use the tools that genuinely fit. A trip or a place → Travel Route (plane for flights, car for road trips), Earth Zoom or Location Reveal. A statistic → Number Counter, Bar Chart Race, Progress Ring or Percentage Change. A software product → App Window Reveal, Floating UI Showcase, Feature Callout, Cursor Demo, Dashboard, Workflow. Cuts between clips → transitions that suit the pace (Landscape Close for cinematic, Whip Pan or Flash Zoom for energy, Mix or Blur for calm). A key moment → add_zoom. A video URL, or a long video to cut down → clip_video. A text-message, Reddit or Would You Rather video → add_story with a full script you write. Captions → add_subtitles. A title or callout that should move → add_text/add_shape then animate.
- 3D and camera work: a product, app or website → add_device (iPhone/MacBook with the person's screen recording on the screen); a reveal or emphasis on footage → add_camera (2D: zoom to a target and back; the video keeps playing while the camera holds); text that should live inside real footage, or that people walk in front of → add_tracked (it analyses first; report its tracking quality); quick viral beats → add_effect (velocity, beat shake, flash, glitch) or the Piercing Bullet transition.
- Sound design makes edits feel finished: when you add transitions, graphics or text, add a fitting sound effect from SOUND EFFECTS at the same moment (by id), unless the person asked for silence.
- Fill every graphic with real content from the request (text, numbers, places, colours, media paths from MEDIA). Place params take names like "Tokyo, Japan".
- Place things sensibly in time: no overlapping graphics on the same moment unless intended; transitions only on video/photo clips.
- Prefer a few polished, well-timed additions over many. Restraint is premium.
- If something cannot be done (a tool says it failed), say so plainly and offer what you can do instead. Never claim something happened unless RESULTS says it did.
- A saved-settings review verifies properties and timings only. Do not claim visual safe zones, no overlaps, smooth playback or correct appearance unless actual visual evidence supports each claim. Summarise the specific saved changes instead.
- If the request is a question, answer it; act only when acting helps.
- For an inspection request, report the actual observations and timestamps. Do not merely say you inspected it. Use inspect_scene for physical floor/wall geometry and safe title boundaries. A wall pin uses surface:"wall" on analyse_footage/add_tracked so local planar tracking and perspective match that wall. Never guess an exact proprietary game font: Rajdhani is an available tactical location treatment.

DESIGN RULES (house style — follow them unless the person asks otherwise):
- Frame safety (1080×1920): keep text and key graphics inside x 80–1000, y 260–1500. The bottom ~420px is covered by the app's caption/buttons and the top ~220px by its header; subtitles sit around y 1180–1380.
- Hook: something moves or appears in the first 1.5s. Titles hold at least 1.2s plus 0.25s per word. Nothing important lasts under 0.6s.
- Type: one display face per video, at most two weights; headline 90–150px, support 40–60px, never under 34px. Max ~6 words per line, 2 lines. High contrast: white on dark footage with a soft shadow, or a solid pill behind.
- Colour: 1 accent + neutrals; reuse the same accent across graphics, text and stickers.
- Motion: ease out on the way in (cubic-bezier(.22,1,.36,1)), ease in on the way out; stagger groups 60–120ms; one transition family per video (energetic: whip/flash/glitch; cinematic: blur/landscape close/mix); no more than one transition every ~2.5s.
- Sound: every transition, graphic entrance and text pop gets a matching sound effect landing ON the moment (whoosh 0.1s before a transition's middle; pop/click on text in; rise before a reveal); music sits under speech (set_volume ~0.25 when there is talking).
- 3D: respect a manual or still view and any request for no preset. When a camera move is requested, use a deliberate orbit, hero shot or custom shots (front → close left45 → wide top), usually 1.5–4s with eased ends.
- Footage text (add_tracked): place the base on the ground or a wall, choose behind for depth, walkThrough when people cross it; a location title (template location) on a building wall reads like a game.
- Distinguish a real-footage track from a synthetic 3D scene. A 3D camera animates devices/scenes; it cannot reconstruct unseen parts of real footage. For tracked text use sceneDepth, elevation, rotationY, thickness and spacing. People and recognised objects are detected together automatically. If several videos overlap, specify the source clip id. Honour source aspect ratio and detected letterboxing; never assume the video fills the project stage.
- Read inspect_layer before editing a custom graphic, camera path, device or tracked item. Reuse catalog graphics when they fit; create_graphic supports new HTML/CSS graphics, not arbitrary scripts. Custom flight paths use timed shots (camera) or keys (device). Preserve custom shots when adjusting only the lens or distance.
- When a device already exists, continue it with append_device_action (turn/move/hold/screenOn/screenOff/openLid/closeLid). Do not create another phone or MacBook for every action. Inspect its terminal pose and screen timing first. Use inspect_video before deciding what is in footage or where to position an object; sampled vision is evidence, not a full 3D reconstruction.
- Imported characters use add_model, inspect_model and append_model_animation. Inspect bones and clip durations, reuse the existing scene and character, and append actions after the last one. Avoid unintended overlapping schedules. Use set_3d_keyframe for timed object/camera positions; these are the same timeline diamonds the person can drag. A manual camera or still object needs no preset. WASD free flight is available in the camera preview for hands-on path recording. Respect custom keys when changing a lens or screen.
- Restraint: 3–6 well-timed elements beat 15. Don't stack two graphics on the same moment unless they are one design.

HOW TO WORK (each request):
1. PLAN first: for anything that changes the video, start your first reply with <plan>…</plan>: 2–6 short lines, each "time — what — why" (e.g. "0.0s — kinetic title 'TOKYO IN 24H' — hook"). Then the actions for the first steps.
2. ACT in small batches (1–6 actions per block), read RESULTS, fix what failed, continue.
3. REVIEW: use review_project and inspect_layer to check saved edits against your plan. A structural check is not a visual inspection. For a read-only question, give the requested answer without an unrelated project review. When you get a REVIEW request, fix concrete problems before finishing; never add unsolicited sounds while reviewing an unrelated edit.

PROTOCOL: to act, end your reply with exactly one block:
<actions>
[{"tool":"add_motion_graphic","graphic":"mg.flight","params":{"from":"Sydney, Australia","to":"Tokyo, Japan"}}]
</actions>
The block is valid JSON: an array of actions, each with "tool" and its fields. They run in order. You then get RESULTS and the updated PROJECT: continue with more actions if needed, or finish.
Every reply ends with EITHER an <actions> block OR the marker <final/> (nothing after it). Before <final/>, summarise only what RESULTS confirmed. A reply that wants something changed must carry the <actions> block — describing a change is not making it; nothing changes without actions. When you send actions, write one short line of intent before the block, not a summary of results.
Use only clip ids that appear in PROJECT, or "last" for the clip the previous action in the same block added. Times are seconds on the timeline. Keep your words short and friendly; the person sees your text and a list of what you did.`;

const shortsOrigin = () => { try { return new URL(SHORTS_HOME()).origin; } catch { return 'http://127.0.0.1:4173'; } };

async function stream(messages: { role: string; content: string }[], onDelta: (s: string) => void, signal: AbortSignal) {
  let res:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
    try{res=await fetch(`${shortsOrigin()}/api/editor-ai/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ model: 'deepseek-v4-pro', stream: true, max_tokens: 8000, temperature: 0.45, thinking: { type: 'disabled' }, messages }),
    });if(res.ok||![429,502,503,504].includes(res.status)||attempt===2)break;await res.body?.cancel();}
    catch(e){if(signal.aborted||attempt===2)throw e;}
    await new Promise<void>((resolve,reject)=>{const onAbort=()=>{clearTimeout(timer);reject(signal.reason??new DOMException('Aborted','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},700*(attempt+1));signal.addEventListener('abort',onAbort,{once:true});});signal.throwIfAborted();
  }
  if(!res)throw new Error('Clyra could not reach the model. Try again.');
  if (!res.ok || !res.body) { const d = await res.json().catch(() => ({})); throw new Error(modelError(d, `Clyra's model did not answer (${res.status}). Open Shorts from Clyra so the editor can reach it.`)); }
  return readModelStream(res.body, onDelta);
}
/** The reply without its actions block (and without a half-written one while it streams). */
export const visible = (text: string) => text.replace(/<plan>[\s\S]*?(<\/plan>|$)/g, '').replace(/<actions>[\s\S]*?(<\/actions>|$)/g, '').replace(/<final\s*\/?>/gi, '').replace(/<(act|fin)[a-z]*$/i, '').trim();
function parseActions(text: string): Action[] | null {
  const tagged = /<actions>([\s\S]*?)<\/actions>/.exec(text);
  /* a model that forgets the tags but writes the action list as JSON (often in a code fence) still means it */
  const fenced = tagged ? null : /```(?:json)?\s*(\[[\s\S]*?"tool"[\s\S]*?\])\s*```/.exec(text) ?? /(\[\s*\{\s*"tool"[\s\S]*\}\s*\])/.exec(text);
  const raw = tagged?.[1] ?? fenced?.[1]; if (raw == null) return null;
  const body = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { const v = JSON.parse(body); return Array.isArray(v) ? v.filter((a) => a && typeof a.tool === 'string') : null; } catch { return []; }
}
/* the reply shown without any action JSON it carried outside the tags */
const withoutJson = (t: string) => t.replace(/```(?:json)?\s*\[[\s\S]*?"tool"[\s\S]*?\]\s*```/g, '').replace(/\[\s*\{\s*"tool"[\s\S]*\}\s*\]/g, '').trim();
const FINAL = /<final\s*\/?>/i;
/* a request that asks for something to change (not a question) */
const ASKS_CHANGE = (t: string) => !/\b(do not|don't|without)\s+(edit|change|modify|add)\b/i.test(t)&&!/^\s*(inspect|describe|review|look at|tell me|explain|what|why|how|which|who|when|where|(?:can|could|would) you (?:explain|inspect|describe|review|look|tell)|is|are|does)\b/i.test(t.trim());
export const debugLog: { round: number; raw: string }[] = [];
const PHASE: Record<string, string> = {
  add_motion_graphic: 'Adding a motion graphic', update_motion_graphic: 'Updating a motion graphic', add_transition: 'Adding a transition', update_transition: 'Updating a transition',
  apply_transition_to_all_cuts: 'Adding transitions to every cut', add_zoom: 'Adding a zoom', add_text: 'Adding text', add_sound: 'Adding a sound', add_music: 'Adding music', add_media: 'Adding media',
  clip_video: 'Running the AI clipper', find_place: 'Looking up a place', move_clip: 'Moving a clip', set_length: 'Changing a length', remove_clip: 'Removing a clip',
  add_device: 'Adding a 3D device', update_device: 'Updating the 3D device', add_camera: 'Adding a camera', update_camera: 'Updating the camera', freeze_frame: 'Freezing the frame',
  inspect_spatial:'Reading calibrated scene geometry',place_spatial:'Attaching to the reconstructed surface',refine_spatial_foreground:'Refining foreground masks',
  add_effect: 'Adding an effect', analyse_footage: 'Analysing the footage', add_tracked: 'Placing text in the scene',
  update_tracked: 'Adjusting scene placement', inspect_layer: 'Reading layer settings', review_project: 'Verifying saved changes',
  inspect_video:'Looking at the video',inspect_scene:'Understanding scene surfaces',inspect_model:'Reading model and bones',add_model:'Adding the model',append_model_animation:'Continuing character animation',set_3d_keyframe:'Placing a 3D keyframe', append_device_action:'Continuing the device animation',
  split_clip: 'Splitting a clip', set_fade: 'Adding a fade', place_clip: 'Placing a clip', set_look: 'Changing the look', set_line: 'Changing a line',
  create_graphic: 'Designing a new graphic', update_graphic: 'Reworking the graphic',
  add_story: 'Writing the story', add_subtitles: 'Adding subtitles', add_shape: 'Adding a shape', update_layer: 'Updating a layer', animate: 'Animating', duplicate_clip: 'Duplicating a clip',
};
export const actionLabel = (a: Action, running = false) => {
  if (running && PHASE[a.tool]) return PHASE[a.tool];
  const g = graphicById(String(a.graphic ?? '')); const t = transitionById(String(a.effect ?? '').startsWith('classic.') ? String(a.effect) : `classic.${a.effect}`);
  switch (a.tool) {
    case 'add_motion_graphic': return `Added ${g?.name ?? 'a motion graphic'}`;
    case 'update_motion_graphic': return 'Updated a motion graphic';
    case 'add_transition': return `Added ${t?.name ?? 'a transition'}`;
    case 'update_transition': return t ? `Changed the transition to ${t.name}` : 'Updated a transition';
    case 'apply_transition_to_all_cuts': return `${t?.name ?? 'Transition'} on every cut`;
    case 'add_zoom': return `Added a ×${a.scale ?? 2} zoom`;
    case 'add_text': return `Added text “${String(a.text ?? '').slice(0, 28)}”`;
    case 'add_sound': return `Added a ${String(a.id ?? a.query ?? '').replace(/-/g, ' ')} sound`;
    case 'add_music': return `Added music (${a.id ?? a.query})`;
    case 'add_media': return `Added ${String(a.path ?? '').split('/').pop()}`;
    case 'clip_video': return 'Ran the AI clipper';
    case 'find_place': return `Looked up ${a.query}`;
    case 'move_clip': return 'Moved a clip';
    case 'set_length': return 'Changed a length';
    case 'remove_clip': return 'Removed a clip';
    case 'set_speed': return `Set speed ${a.speed}×`;
    case 'set_volume': return 'Changed a volume';
    case 'open_tool': return `Opened ${a.panel}`;
    case 'seek': return `Moved the playhead to ${a.time}s`;
    case 'add_story': return `Added a ${a.kind === 'reddit' ? 'Reddit' : a.kind === 'wyr' ? 'Would You Rather' : 'fake text'} story`;
    case 'add_subtitles': return 'Added subtitles';
    case 'add_shape': return `Added a ${a.shape ?? 'shape'}`;
    case 'update_layer': return 'Updated a layer';
    case 'animate': return `Animated ${a.property}`;
    case 'duplicate_clip': return 'Duplicated a clip';
    case 'split_clip': return `Split a clip at ${a.at}s`;
    case 'add_device': return `Added a 3D ${a.device === 'laptop' ? 'MacBook' : a.preset && a.preset !== 'floatingReveal' ? String(a.preset) : 'iPhone'} scene`;
    case 'update_device': return 'Updated the 3D device';
    case 'add_camera': return `Added a ${a.mode === '3d' ? '3D' : '2D'} camera`;
    case 'update_camera': return 'Updated the camera';
    case 'freeze_frame': return 'Froze the frame';
    case 'add_effect': return `Added ${String(a.effect ?? 'an effect').replace('fx.', '')}`;
    case 'inspect_spatial': return 'Read calibrated scene geometry';
    case 'place_spatial': return 'Placed a world anchor';
    case 'refine_spatial_foreground': return 'Refined foreground masks';
    case 'analyse_footage': return 'Analysed the footage';
    case 'add_tracked': return `Placed “${String(a.text ?? '').slice(0, 20)}” in the scene`;
    case 'update_tracked': return 'Updated scene placement';
    case 'inspect_layer': return 'Read layer settings';
    case 'review_project': return 'Checked saved layers';
    case 'inspect_video': return 'Viewed video frames';
    case 'inspect_scene': return 'Understood scene surfaces';
    case 'inspect_model': return 'Read model animations';
    case 'add_model': return 'Added the model';
    case 'append_model_animation': return 'Added the next character action';
    case 'set_3d_keyframe': return 'Saved a 3D motion key';
    case 'append_device_action': return 'Added the next device action';
    case 'set_fade': return 'Added a fade';
    case 'place_clip': return a.layout ? `Placed a clip (${a.layout})` : 'Placed a clip';
    case 'set_look': return 'Changed a look';
    case 'set_line': return 'Changed a line';
    case 'create_graphic': return `Designed “${String(a.name ?? 'a new graphic').slice(0, 30)}”`;
    case 'update_graphic': return 'Reworked a graphic';
    default: return a.tool;
  }
};

export async function runAgent(history: ChatTurn[], userText: string, ctx: ToolContext, ev: AgentEvents): Promise<{ reply: string; touched: string[] }> {
  const caps = capabilities();
  const msgs: { role: string; content: string }[] = [{ role: 'system', content: `${SYSTEM}\n\n${caps}` }, ...history.slice(-12).map((t) => ({ role: t.role, content: t.content }))];
  /* whole videos are measured first, so the model sees every clip's real length */
  await ensureLengths(ctx);
  let turn = `${userText}\n\n${await snapshot(ctx.projectId, ctx.folder, ctx.film(), ctx.timeMs())}`;
  const shown: string[] = []; const touched: string[] = []; let ran = 0; let nudged = false; let reviewed = false;
  const ROUNDS = 18; let finished = false; const failures = new Map<string, number>();
  for (let round = 0; round < ROUNDS; round++) {
    if (ctx.signal.aborted) break;
    msgs.push({ role: 'user', content: turn });
    ev.phase(round === 0 ? 'Planning the edit' : reviewed && round > 0 && turn.startsWith('REVIEW') ? 'Reviewing the edit' : 'Checking the result');
    const raw = await stream(msgs, (s) => { const v = visible(s); if (v) { ev.phase(null); ev.text([...shown, v].join('\n\n')); } }, ctx.signal);
    msgs.push({ role: 'assistant', content: raw });
    debugLog.push({ round, raw }); if (debugLog.length > 36) debugLog.shift(); (window as unknown as { __clyraAiLog?: unknown }).__clyraAiLog = debugLog;
    const plan = /<plan>([\s\S]*?)<\/plan>/i.exec(raw);
    if (plan) ev.plan?.(plan[1].split('\n').map((x) => x.replace(/^\s*[-*\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 8));
    const actions = parseActions(raw);
    const v = withoutJson(visible(raw));
    if(!actions&&v&&ran===0&&!ASKS_CHANGE(userText)){shown.push(v);ev.text(shown.join('\n\n'));finished=true;break;}
    /* nothing changes without actions: a reply that neither acts nor ends with <final/>, or that finishes a change
       request when nothing has run, is not shown as fact — the model is told, and acts */
    if (!actions && round < ROUNDS - 1 && !nudged && (!FINAL.test(raw) || (ran === 0 && ASKS_CHANGE(userText)))) {
      nudged = true;
      ev.text(shown.join('\n\n'));
      turn = ran === 0
        ? 'RESULTS: nothing has changed — no <actions> block was received, so none of what you described happened. Send the actions now in an <actions> block (a valid JSON array), then wait for RESULTS. If you truly cannot do it, say why and end with <final/>.'
        : 'RESULTS: your reply had no <actions> block and no <final/>. Either send the remaining actions in an <actions> block, or end with <final/> after summarising what RESULTS confirmed.';
      if (ran === 0 && FINAL.test(raw) && /\b(can't|cannot|unable|not possible|isn't possible)\b/i.test(v)) { shown.push(v); ev.text(shown.join('\n\n'));finished=true; break; }
      continue;
    }
    /* the self-review: once, after something changed, before the final answer stands */
    if (!actions && ran > 0 && !reviewed && round < ROUNDS - 1) {
      reviewed = true;
      const check: Action = { tool: 'review_project' }; ev.phase('Verifying saved changes'); ev.action(check, 'running');
      const checked = await runTool(check, ctx).catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e) }));
      ev.action(check, checked.ok ? 'done' : 'failed', checked);
      msgs.push({ role: 'user', content: `VERIFIED RESULTS: ${checked.message}` });
      turn = `REVIEW: check the saved result against the user's requested scope and your plan: timing, missing sources, unintended duplication, placement and legibility. Fix concrete defects. Do not add music, camera movement or decorations that were not requested. Saved settings checks do not prove rendered quality or perfect tracking. Finish with what RESULTS confirmed and any material limitation, then <final/>.\n\n${await snapshot(ctx.projectId, ctx.folder, ctx.film(), ctx.timeMs())}`;
      continue;
    }
    if (v) shown.push(v);
    ev.text(shown.join('\n\n'));
    if (!actions) { finished = true; break; }
    if (!actions.length) { turn = 'RESULTS: the actions block was not valid JSON. Write it again as a JSON array.'; continue; }
    const results: string[] = [];
    for (const a of actions.slice(0, 8)) {
      if (ctx.signal.aborted) break;
      /* "last" means the clip the previous action made (its id is not known until it runs) */
      if (typeof a.clip === 'string' && /^\$?(last|latest|previous)$|-(latest|last)$/i.test(a.clip) && touched.length) a.clip = touched[touched.length - 1];
      ev.phase(PHASE[a.tool] ?? 'Working'); ev.action(a, 'running');
      let r: ToolResult;
      try { const signature = JSON.stringify(a); r = (failures.get(signature) ?? 0) >= 2 ? { ok: false, message: 'This exact action has failed twice. Inspect the layer or choose a different approach.' } : await runTool(a, { ...ctx, progress: (m) => ev.phase(m) }); } catch (e) { r = { ok: false, message: e instanceof Error ? e.message : String(e) }; }
      ev.action(a, r.ok ? 'done' : 'failed', r);
      if (r.clipIds) touched.push(...r.clipIds);
      if (r.ok && !['inspect_layer','inspect_video','inspect_scene','inspect_spatial','inspect_track','inspect_model','review_project','find_place','seek','open_tool','analyse_footage'].includes(a.tool)) ran++;
      results.push(`- ${a.tool}: ${r.ok ? 'done' : 'FAILED'} — ${r.message}`);
      if (!r.ok) { const signature = JSON.stringify(a); failures.set(signature, (failures.get(signature) ?? 0) + 1); results.push('Remaining actions in this batch were NOT run. Inspect the failure and revise the next batch; do not repeat successful additions.'); break; }
    }
    ev.phase(null);
    turn = `RESULTS:\n${results.join('\n')}\n\n${await snapshot(ctx.projectId, ctx.folder, ctx.film(), ctx.timeMs())}`;
  }
  ev.phase(null);
  if (!finished) { shown.push(ctx.signal.aborted ? 'Stopped. Completed edits are kept; the remaining work has not been verified.' : 'The edit reached its step limit. Completed edits are kept, but the remaining work is unfinished.'); ev.text(shown.join('\n\n')); }
  return { reply: shown.join('\n\n'), touched };
}
