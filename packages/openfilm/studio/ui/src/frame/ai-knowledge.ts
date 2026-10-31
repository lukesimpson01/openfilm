import { TRANSITIONS, TRANSITION_STYLES } from './transitions-catalog.js';
import { SFX_CATALOG, sfxById, soundDuration } from './lib/sfxLibrary.js';
import { ALL_MUSIC } from './lib/musicLibrary.js';
import { ANIMATION_PRESETS } from './lib/animationPresets.js';
import { WORD_PRESETS, LINE_STYLES, SUB_ANIMATIONS, SUB_FONTS } from './subtitle-styles.js';

/* What the editor's AI needs to choose well, not only what exists: what each transition looks and feels like and
   when it fits, what each sound is for, the mood of each track, what each animation preset does, and what each
   subtitle style looks like. The lists come from the registries (so nothing is missing or out of date); the meanings
   are written here, next to the ids they explain. */

/* look · feel · fits · a sound that goes with it (an SFX id) */
const T: Record<string, [string, string, string, string]> = {
  mix: ['a plain crossfade', 'neutral, invisible', 'any calm cut, interviews, b-roll; the safe default', ''],
  black_fade: ['dips to black (or a colour) and back', 'a pause, time passing, a chapter break', 'scene or day changes, endings, before a reveal', ''],
  white_flash: ['bright exposure flash peaking at the cut', 'energetic, memory-like', 'montages, flashbacks, beat drops', 'flash'],
  blur: ['A blurs out, B blurs in', 'soft, dreamy', 'lifestyle, calm vlogs, out-of-focus moods', ''],
  dissolve: ['grainy noise dissolve', 'textured, nostalgic', 'retro, documentary, memories', ''],
  vertical_blur: ['vertical motion smear through the cut', 'quick, upward/downward energy', 'scrolling feeds, vertical movement', 'swipe'],
  horizontal_blur: ['horizontal motion smear through the cut', 'quick, sideways energy', 'fast b-roll, travel', 'swipe'],
  pull_in: ['zooms hard into A and lands zoomed out of B (seamless)', 'punchy, forward momentum', 'hooks, high-energy edits, travel', 'zoom-in-out'],
  pull_out: ['zooms out of A and into B (seamless)', 'expanding, revealing', 'reveals, wide establishing shots', 'reverse-whoosh'],
  zoom_in: ['gentle zoom while crossfading in', 'smooth, polished', 'product, lifestyle, soft emphasis', ''],
  zoom_out: ['gentle zoom out while crossfading', 'smooth, settling', 'endings, calm reveals', ''],
  swipe: ['motion-blurred swipe in a direction', 'fast, social, TikTok-like', 'list items, quick b-roll, energetic pacing', 'whoosh'],
  slide: ['B slides over A', 'clean, app-like', 'step-by-step, tutorials, SaaS', 'swoosh'],
  push: ['B pushes A out of frame', 'directional, logical next', 'sequences, before/after, timelines', 'swoosh'],
  rotate: ['spins through the cut', 'playful, dizzy', 'fun content, gaming, chaos', 'whoosh'],
  shake: ['camera shake at the cut', 'impact, intensity', 'reactions, hits, hype moments', 'impact-hit'],
  wipe: ['hard or soft-edged wipe', 'classic, graphic', 'retro, comparisons, structured edits', 'swoosh'],
  diagonal_wipe: ['angled wipe', 'dynamic, sporty', 'sports, gaming, promos', 'swoosh'],
  circle_open: ['iris opens on B', 'cartoonish, a reveal', 'intros, reveals, comedy', 'pop'],
  circle_close: ['iris closes on A', 'an ending, "that\'s all folks"', 'outros, punchlines', 'pop'],
  clock_wipe: ['clock-hand sweep', 'time passing', 'countdowns, time skips, schedules', 'transition-sweep'],
  split_vertical: ['A splits open left/right', 'doors opening', 'reveals, new sections', 'swoosh'],
  split_horizontal: ['A splits open top/bottom', 'a mouth/curtain opening', 'reveals, chapter starts', 'swoosh'],
  blinds: ['venetian blind strips', 'stylised, retro', 'retro edits, slideshows', ''],
  heart: ['heart-shaped reveal', 'cute, romantic', 'love, weddings, couples, wholesome', 'sparkle'],
  star: ['star-shaped reveal', 'playful, celebratory', 'kids, wins, celebrations', 'sparkle'],
  rectangle: ['growing rectangle reveal', 'neat, geometric', 'slides, presentations', ''],
  diamond: ['diamond reveal', 'stylised, retro game', 'gaming, retro', ''],
  cube: ['3D cube turns to the next face', 'techy, presentation', 'feature lists, slides, product sides', 'whoosh'],
  flip_horizontal: ['3D card flip sideways', 'a reveal, the other side', 'before/after, answers, cards', 'swoosh'],
  flip_vertical: ['3D card flip vertically', 'a reveal, flipping a page', 'answers, reveals', 'swoosh'],
  fold: ['A folds away in 3D', 'paper, crafty', 'tutorials, recipes, playful edits', 'swoosh'],
  page_curl: ['page turns with curl and shadow', 'storybook, next chapter', 'stories, recipes, journals', 'swoosh'],
  mosaic: ['pixelates through the cut', 'digital, retro game', 'gaming, censorship jokes, glitchy edits', 'digital-beep'],
  ripple: ['water ripple distortion', 'dreamy, a flashback', 'memories, dream sequences', 'shimmer'],
  glitch: ['digital glitch with RGB split', 'edgy, techy, chaotic', 'tech, gaming, horror, hype', 'glitch'],
  flash_cut: ['one-frame white flash', 'a hard punch on the beat', 'beat-synced montages, quick cuts', 'camera-shutter'],
  black_flash: ['one-frame black flash', 'a blink, a hard stop', 'dramatic cuts, horror, beat cuts', 'impact-hit'],
  piercing_bullet: ['a projectile streaks to the impact point, the frame punches open there and the next clip shows through the opening, which grows to fill the frame (styles: clean, cinematic, glass, metal, comic, energy)', 'high-impact, viral', 'hype reveals, action, gaming, before/after, a punchline cut', 'razor-slash'],
  landscape_close: ['black bars close from top and bottom to a strip (or fully) and reopen on B', 'cinematic, widescreen, premium', 'travel, trailers, dramatic moments, scene changes', 'transition-sweep'],
  portrait_close: ['bars close from the sides to a vertical strip and reopen on B', 'cinematic, vertical-native', 'vertical cinematic edits, fashion, reveals', 'transition-sweep'],
  whip_pan: ['one fast camera pan carries A out and B in with a speed streak', 'energetic, seamless, filmic', 'travel, action, b-roll sequences, location changes', 'whoosh'],
  lens_push: ['accelerates into the focus point with barrel distortion, lands in B', 'immersive, forward', 'travel, product focus, POV', 'zoom-in-out'],
  perspective_slide: ['A swings away in depth while B slides in', 'modern, spatial', 'app/product showcases, lists', 'swoosh'],
  pullback_reveal: ['A shrinks into a floating window that rises away, revealing B', 'premium, a "zoom out" reveal', 'transitions to a new topic, outros, recaps', 'reverse-whoosh'],
  card_stack: ['A drops back in a stack while B slides up to the front', 'app-like, swipeable', 'lists, tips, product cards, rankings', 'swoosh'],
  flash_zoom: ['short exposure peak with a quick zoom', 'hype, impact', 'beat drops, reveals, sports', 'flash'],
  lens_cover: ['something close to the lens passes across and hides the cut', 'organic, filmed-in-camera', 'vlogs, travel, walking shots', 'swoosh'],
  film_burn: ['warm light leak blooms and hides the cut', 'nostalgic, warm, analogue', 'travel, weddings, summer vlogs, memories', 'shimmer'],
  light_sweep: ['a band of light sweeps across, leaving B', 'sleek, premium', 'product, luxury, logos, tech', 'shimmer'],
  portal_zoom: ['B appears inside an opening that grows from a point', 'magical, immersive', 'gaming, fantasy, travel "go there" moments', 'transition-sweep'],
  liquid_morph: ['the picture flows like liquid and B pours in', 'fluid, artsy', 'music videos, aesthetic edits, beauty', 'swoosh'],
  smooth_stretch: ['A stretches along the move, B snaps back', 'snappy, elastic, social', 'fast social edits, fashion, dance', 'swipe'],
  glass_refraction: ['a glass pane slides across, bending the picture', 'premium, clean', 'tech, product, architecture', 'shimmer'],
  prism_split: ['colour fringes open and close on B', 'stylish, subtle chromatic', 'music, fashion, night scenes', 'glitch'],
  paper_tear: ['A tears away top to bottom with a ragged paper edge and shadow', 'tactile, scrapbook', 'crafts, collages, reveals, comedy', 'razor-slash'],
  sliding_panels: ['the frame splits into panels that slide away in turn', 'graphic, structured', 'intros, multi-point lists, promos', 'swoosh'],
  film_strip: ['the shots are frames on a rolling film strip', 'retro cinema, montage', 'recaps, memories, behind-the-scenes', 'camera-shutter'],
  beat_punch: ['a sharp scale punch exactly on the cut', 'impact on the beat', 'music-synced edits, hype, reveals', 'impact-hit'],
  split_merge: ['three bands carry A out and B in, each on its own beat', 'rhythmic, graphic', 'music edits, promos, intros', 'swoosh'],
  speed_ramp: ['the footage itself speeds up into the cut and eases out after', 'action, filmic', 'action, sports, car/travel shots', 'whoosh'],
  camera_spin: ['an exact 90/180/360° turn with matched zoom, landing level', 'dynamic, show-off', 'travel, drone-like, energetic intros', 'whoosh'],
  freeze_frame: ["A's last frame freezes like a photo, tilts and slides away", 'comedic or dramatic beat', '"yep, that\'s me" moments, reveals, storytelling', 'record-scratch'],
  parallax_split: ['top and bottom halves travel at different speeds', 'depth, modern', 'travel, lifestyle, promos', 'swoosh'],
  snap_rotate: ['a quick snap turn into the cut, settling level', 'snappy, playful', 'fast social edits, lists', 'swipe'],
  soft_edge_reveal: ['a feathered-edge wipe reveals B', 'gentle, elegant', 'calm vlogs, weddings, beauty', ''],
};

/* what a sound is for, by id (every id in the library is covered by its category's line if not named here) */
const SFX_USE: Record<string, string> = {
  'camera-shutter': 'a photo being taken, freeze frames, quick flash cuts', 'camera-flash': 'paparazzi/photo flash, flash transitions', flash: 'white flash transitions, reveals',
  'razor-slash': 'slash cuts, sharp text reveals, paper tear', whoosh: 'most transitions and fast moves (the default transition sound)', swoosh: 'slides, pushes, things moving across', swipe: 'very quick swipes, list items',
  'zoom-in-out': 'zoom transitions, punch-ins, add_zoom', 'reverse-whoosh': 'build into a cut, pull-outs, reveals', 'transition-sweep': 'longer cinematic transitions (shutters, portals)', glitch: 'glitch effects, tech errors, horror',
  riser: 'tension building before a reveal/drop (place it to END on the moment)', 'impact-hit': 'hard cuts, text slams, hits', 'cinematic-boom': 'trailer moments, big title reveals', 'bass-drop': 'beat drops, hype reveals',
  'vine-boom': 'meme punchline, shocking reveal, dramatic stare', 'metal-clang': 'meme fail moment, something falling', 'record-scratch': 'sudden stop, "wait, what?", freeze frame',
  click: 'button press, UI tap', 'mouse-click': 'cursor clicks in screen demos', 'ui-tap': 'phone taps', 'keyboard-typing': 'typing on screen, text appearing', typewriter: 'typewriter text, retro titles',
  'text-reveal': 'titles and words appearing', 'digital-beep': 'tech UI, scanning, censor beep', 'notification-ding': 'notifications, messages arriving, a new point', pop: 'text/emoji/sticker appearing (subtle)',
  'bubble-pop': 'cute pops, cartoonish appear', shimmer: 'magic, light sweeps, premium reveals', sparkle: 'something clean/new/shiny, wholesome wins',
  'rizz-sound-effect': 'meme: smooth flirting / rizz moment', 'among-us-role-reveal': 'meme: dramatic role/identity reveal', 'taco-bell-bong': 'meme: absurd or awkward moment', 'death-sound-fortnite': 'meme: failure, someone getting destroyed',
  'heavenly-music': 'meme: something perfect or angelic', fah: 'meme: exaggerated reaction', 'fah-2': 'meme: exaggerated reaction (variant)', 'dexter-meme': 'meme: suspicious, plotting', 'tuco-get-out': 'meme: kicking someone out, rejection',
  romance: 'meme: romantic moment (ironic or sweet)', 'the-undertaker-bell': 'meme: someone is in trouble, ominous arrival', 'fart-with-reverb': 'meme: crude comedic punchline', 'discord-leave-noise': 'meme: someone leaves / awkward exit', 'emotional-damage-meme': 'meme: a roast landing',
};
const SFX_CAT_USE: Record<string, string> = { Camera: 'photo moments', 'Whoosh & Transition': 'movement and transitions', 'Impact & Cinematic': 'emphasis and drama', 'UI & Typing': 'screens, apps and text', 'Sparkle & Pop': 'things appearing', Brainrot: 'meme humour (use only for comedic content)' };

const PRESET_USE: Record<string, string> = {
  'fade-in': 'appears softly', 'slide-in': 'slides in from a side (opts: direction)', 'zoom-in': 'grows in from small', pop: 'pops in with overshoot (social default)', 'bounce-in': 'bounces in', 'drop-in': 'drops from above',
  'rise-in': 'rises from below', 'spin-in': 'spins in', 'blur-in': 'sharpens from blur (cinematic)', reveal: 'revealed by a mask', 'wipe-in': 'wiped in', typewriter: 'letters type on (text only)',
  'fade-out': 'fades away', 'slide-out': 'slides off', shrink: 'shrinks away', 'spin-out': 'spins away', 'blur-out': 'blurs away', dissolve: 'dissolves away', 'drop-out': 'falls away', 'wipe-out': 'wiped away',
  float: 'floats gently (loop)', pulse: 'pulses in size (loop)', wiggle: 'wiggles (loop)', shake: 'shakes (loop)', rotate: 'rotates continuously', bob: 'bobs up and down', sway: 'sways side to side', blink: 'blinks on/off', 'glow-pulse': 'glow pulses', breathing: 'slow breathing scale',
  counter: 'number counts up (numeric text)', progress: 'bar fills (shape)', 'line-reveal': 'line draws on', 'shape-morph': 'shape morphs in', 'logo-reveal': 'logo-style reveal', parallax: 'slow parallax drift',
  'punch-zoom': 'fast punch-in for emphasis', 'emphasis-pop': 'quick emphasis pop on a key word', 'caption-bounce': 'caption bounces in', 'emoji-pop': 'emoji/sticker pop', notification: 'slides in like a phone notification',
  'screen-shake': 'shaking emphasis (loop)', 'meme-zoom': 'slow dramatic meme zoom', 'dramatic-pause': 'holds then hits', 'quick-flash': 'flashes in',
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
function wordStyle(id: string, [fill, edge]: string[]) { return `${id}: ${fill.toLowerCase() === '#fff' ? 'white' : fill} words, ${edge} outline/shadow`; }
function lineStyle(id: string, s: Record<string, any>) {
  const font = String(s.font).split(',')[0].replace(/'/g, '');
  const bits = [`${font}${s.upper ? ' caps' : ''}${s.italic ? ' italic' : ''}`, `${s.fill} text`];
  if (s.active && s.active !== s.fill) bits.push(`spoken word ${s.active}`);
  if (s.box) bits.push(`on a ${s.box[0]} box`); if (s.stroke) bits.push(`${s.stroke} outline`); if (s.glow) bits.push('glow'); if (s.shadow) bits.push('shadow');
  return `${id}: ${bits.join(', ')}`;
}

/** The knowledge block for the system prompt. */
export function knowledge(): string {
  const tr = (TRANSITIONS as { id: string; name: string; group: string; defaultDuration: number; params: string[]; directions: string[] | null; about?: string }[]).map((t) => {
    const k = T[t.id.replace('classic.', '')];
    const ps = t.params.map((p) => (p === 'direction' && t.directions ? `direction(${t.directions.join('|')})` : p)).join(', ');
    return `- ${t.id} "${t.name}" ${t.defaultDuration}s — ${k ? `${k[0]}. Feels ${k[1]}. Fits ${k[2]}.${k[3] ? ` Sound: ${k[3]}.` : ''}` : t.about ?? t.group}${ps ? ` Params: ${ps}.` : ''}`;
  }).join('\n');
  const sfx = (SFX_CATALOG as { id: string; name: string; category: string; tags: string[]; aliases: string[]; needsFile?: boolean;recordingStatus?:string }[]).filter((s) => !s.needsFile&&s.recordingStatus==='verified').map((s) => {
    let d = ''; try { d = ` ${soundDuration(sfxById(s.id)).toFixed(1)}s`; } catch { /* length unknown */ }
    return `- ${s.id} "${s.name}"${d} — ${SFX_USE[s.id] ?? `${s.tags.join(' ')} (${SFX_CAT_USE[s.category] ?? s.category})`}`;
  }).join('\n');
  const music = (ALL_MUSIC as { id: string; name: string; artist?: string; mood?: string; section?: string; bpm?: number; tags?: string[]; dur?: number; take?: boolean; needsFile?: boolean }[]).filter((m) => !m.needsFile).map((m) =>
    `- ${m.id} "${m.name}"${m.artist ? ` by ${m.artist}` : ''} — source recording; ${(m.tags ?? []).join(' ')}${m.bpm ? `, ${m.bpm} bpm` : ''}${m.dur ? `, ${Math.round(m.dur)}s (loops/trims to fit)` : ''}`).join('\n');
  const presets = (ANIMATION_PRESETS as { id: string; name: string; category: string; phase: string; duration: number }[]).map((p) => `${p.id} (${p.phase}${p.phase !== 'loop' ? `, ${p.duration}s` : ''}: ${PRESET_USE[p.id] ?? p.name})`).join('; ');
  const words = Object.entries(WORD_PRESETS as Record<string, string[]>).map(([id, c]) => wordStyle(id, c)).join('; ');
  const lines = Object.entries(LINE_STYLES as Record<string, Record<string, unknown>>).map(([id, s]) => lineStyle(id, s)).join('; ');
  return `TRANSITIONS — what each looks like, how it feels, what it fits, and the sound that goes with it. Match the transition to the content and pace; keep one family per video unless variety is asked for. Typical length 0.3–0.6s for social pace, 0.8–1.2s for cinematic.
${tr}
Transition styles (put the name in params.style; it sets easing, blur and intensity for that feel): ${Object.entries(TRANSITION_STYLES as Record<string, Record<string, unknown>>).map(([k, v]) => `${k} (${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')})`).join('; ')}.

SOUND EFFECTS — exact named source recordings. Use only these verified ids. Extra letters, punctuation or version numbers can identify different recordings: never silently substitute. Unresolved catalog labels are intentionally unavailable. Place a sound so its peak lands on the moment (a whoosh starting ~0.1s before the cut; a riser ending on the reveal).
${sfx}

MUSIC — actual named recordings and bundled tracks; source credits apply. Pick by the video's mood; one track per video unless asked. Music sits under speech: lower it with set_volume (0.2–0.4) when there is talking.
${music}

ANIMATION PRESETS (for add_text / add_shape / update_layer "animation"; give a list like ["pop","fade-out"] for an entrance and an exit): ${presets}

SUBTITLE STYLES — Word mode (one word at a time, styleId): ${words}. Lines mode (a line with the spoken word lit, styleId): ${lines}. Animations: ${(SUB_ANIMATIONS as string[]).join(', ')}. Fonts: ${(SUB_FONTS as string[]).join(', ')}. Positions: Top ${pct(0.14)}, Middle 50%, Bottom ${pct(0.8)} of the height.`;
}
