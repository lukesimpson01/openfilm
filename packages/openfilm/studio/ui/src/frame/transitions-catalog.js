/* CapCut "Classic" transitions: the registry the panel, the inspector, the timeline and the renderer all read.
   Each entry: id, name, group, premium (★: motion blur / bloom / 3D lighting), code (the shader's effect number),
   defaultDuration (s), motion (true: velocity motion blur applies), params (the controls it shows) and defaults. */
const P = { intensity: 'intensity', motionBlur: 'motionBlur', direction: 'direction', feather: 'feather', color: 'color', center: 'center', hold: 'hold', strips: 'strips', angle: 'angle', grain: 'grain',
  /* shutters */ amount: 'amount', split: 'split', balance: 'balance', match: 'match', shadow: 'shadow', glow: 'glow', color2: 'color2', line: 'line',
  /* zoom */ spin: 'spin', scale: 'scale', zoomIn: 'zoomIn', zoomOut: 'zoomOut', /* piercing */ pierce: 'pierce', reverse: 'reverse' };
const dir4 = ['left', 'right', 'up', 'down'];
const e = (id, name, group, code, o = {}) => ({ id: `classic.${id}`, name, group, code, premium: !!o.premium, motion: !!o.motion, defaultDuration: o.duration ?? 0.5, sfx: o.sfx ?? null, about: o.about ?? '', also: o.also ?? [], styles: o.styles ?? null,
  params: o.params ?? [P.intensity], directions: o.directions ?? null, defaults: { intensity: 0.7, motionBlur: o.motion ? 1 : 0, feather: 0.03, color: '#000000', hold: 0, strips: 8, angle: 35, grain: 0.5, center: [0.5, 0.5], ...(o.defaults || {}) } });

/* Clyra's ripple (shader effect 51): the classic single wave, kept as a style for projects made with it, and the
   NameDrop style — several thick refractive waves that gather, travel, strike and settle; with a 3D scan of the clip they
   travel through the scene (its camera, a surface, or a corridor's floor and walls) and pass behind people. One
   implementation: the transition between clips and the one-clip effect are the same shader. */
const RIPPLE_STYLES = ['namedrop', 'classic'];
const RIPPLE_PARAMS = ['rippleStyle', 'intensity', 'center', 'waves', 'thickness', 'geometry', 'placement', 'reach', 'refraction', 'buildUp', 'dissipate', 'impact', 'interference', 'softness', 'highlight', 'glow'];
const RIPPLE_DEFAULTS = { rippleStyle: 'namedrop', intensity: 0.7, center: [0.5, 0.5], waves: 5, thickness: 0.045, geometry: 'auto', placement: 'scene', reach: 0.9, refraction: 0.6, buildUp: 0.18, dissipate: 0.25, impact: 0.7, interference: 0.5, softness: 0.5, highlight: 0.5, glow: 0.25 };
const RIPPLE_ABOUT = 'Several thick refractive waves gather at a point, travel out, strike and settle. With a 3D scan of the clip they stay in the scene as the camera moves, follow a surface or a corridor, and pass behind people.';
export const TRANSITION_GROUPS = ['Creator Effects', 'Cinematic', 'Shutters & reveals', 'Modern', 'Fades & blends', 'Camera moves', 'Wipes & masks', '3D', 'Stylized'];
export const TRANSITIONS = [
  e('mix', 'Mix', 'Fades & blends', 1, { params: [] }),
  e('black_fade', 'Black Fade', 'Fades & blends', 2, { params: [P.hold, P.color] }),
  e('white_flash', 'White Flash', 'Fades & blends', 3, { premium: true, params: [P.intensity], defaults: { intensity: 0.9 } }),
  e('blur', 'Blur', 'Fades & blends', 4, { premium: true }),
  e('dissolve', 'Dissolve', 'Fades & blends', 5, { params: [P.feather, P.grain], defaults: { feather: 0.08 } }),
  e('vertical_blur', 'Vertical Blur', 'Fades & blends', 6, { premium: true }),
  e('horizontal_blur', 'Horizontal Blur', 'Fades & blends', 7, { premium: true }),

  e('pull_in', 'Pull In', 'Camera moves', 10, { premium: true, motion: true, params: [P.intensity, P.motionBlur, P.center] }),
  e('pull_out', 'Pull Out', 'Camera moves', 11, { premium: true, motion: true, params: [P.intensity, P.motionBlur, P.center] }),
  e('zoom_in', 'Zoom In', 'Camera moves', 12, { motion: true, params: [P.intensity, P.center], defaults: { motionBlur: 0.35 } }),
  e('zoom_out', 'Zoom Out', 'Camera moves', 13, { motion: true, params: [P.intensity, P.center], defaults: { motionBlur: 0.35 } }),
  e('swipe', 'Swipe', 'Camera moves', 14, { premium: true, motion: true, params: [P.direction, P.intensity, P.motionBlur], directions: dir4, defaults: { direction: 'left', intensity: 0.3 } }),
  e('slide', 'Slide', 'Camera moves', 15, { motion: true, params: [P.direction, P.motionBlur], directions: dir4, defaults: { direction: 'left', motionBlur: 0.4 } }),
  e('push', 'Push', 'Camera moves', 16, { motion: true, params: [P.direction, P.motionBlur], directions: dir4, defaults: { direction: 'left', motionBlur: 0.5 } }),
  e('rotate', 'Rotate', 'Camera moves', 17, { premium: true, motion: true, params: [P.direction, P.intensity, P.motionBlur], directions: ['cw', 'ccw'], defaults: { direction: 'cw' } }),
  e('shake', 'Shake', 'Camera moves', 18, { premium: true, motion: true, params: [P.intensity, P.motionBlur], defaults: { intensity: 0.6 } }),

  e('wipe', 'Wipe', 'Wipes & masks', 20, { params: [P.direction, P.feather], directions: dir4, defaults: { direction: 'left' } }),
  e('diagonal_wipe', 'Diagonal Wipe', 'Wipes & masks', 21, { params: [P.angle, P.feather] }),
  e('circle_open', 'Circle Open', 'Wipes & masks', 22, { params: [P.feather, P.center] }),
  e('circle_close', 'Circle Close', 'Wipes & masks', 23, { params: [P.feather, P.center] }),
  e('clock_wipe', 'Clock Wipe', 'Wipes & masks', 24, { params: [P.direction, P.feather], directions: ['cw', 'ccw'], defaults: { direction: 'cw', feather: 0.01 } }),
  e('split_vertical', 'Split Vertical', 'Wipes & masks', 25, { params: [P.feather] }),
  e('split_horizontal', 'Split Horizontal', 'Wipes & masks', 26, { params: [P.feather] }),
  e('blinds', 'Blinds', 'Wipes & masks', 27, { params: [P.strips, P.feather], defaults: { feather: 0.01 } }),
  e('heart', 'Heart', 'Wipes & masks', 28, { params: [P.feather, P.center] }),
  e('star', 'Star', 'Wipes & masks', 29, { params: [P.feather, P.center] }),
  e('rectangle', 'Rectangle', 'Wipes & masks', 30, { params: [P.feather, P.center] }),
  e('diamond', 'Diamond', 'Wipes & masks', 31, { params: [P.feather, P.center] }),

  e('cube', 'Cube', '3D', 40, { premium: true, params: [P.direction], directions: dir4, defaults: { direction: 'left' }, duration: 0.6 }),
  e('flip_horizontal', 'Flip Horizontal', '3D', 41, { premium: true, params: [], duration: 0.6 }),
  e('flip_vertical', 'Flip Vertical', '3D', 42, { premium: true, params: [], duration: 0.6 }),
  e('fold', 'Fold', '3D', 43, { params: [], duration: 0.6 }),
  e('page_curl', 'Page Curl', '3D', 44, { premium: true, params: [], duration: 0.7 }),

  e('mosaic', 'Mosaic', 'Stylized', 50, { params: [P.intensity] }),
  e('ripple', 'Ripple', 'Stylized', 51, { premium: true, duration: 1.2, about: RIPPLE_ABOUT, styles: RIPPLE_STYLES, params: RIPPLE_PARAMS, defaults: RIPPLE_DEFAULTS }),
  e('glitch', 'Glitch', 'Stylized', 52, { also: ['Creator Effects'], premium: true, params: [P.intensity] }),
  e('flash_cut', 'Flash Cut', 'Stylized', 53, { params: [], duration: 0.2 }),
  e('black_flash', 'Black Flash', 'Stylized', 54, { params: [], duration: 0.2 }),

  /* Premium library: real compositing in the same renderer (preview and export draw them identically) */
  e('piercing_bullet', 'Piercing Bullet', 'Creator Effects', 91, { premium: true, motion: true, duration: 0.8, sfx: 'razor-slash',
    about: 'A fast projectile streaks to the impact point, the frame punches open there and the next clip appears through the opening, which grows to fill the frame. Styles: clean, cinematic, glass, metal, comic, energy.',
    styles: ['clean', 'cinematic', 'glass', 'metal', 'comic', 'energy'],
    params: [P.pierce, P.center, P.angle, P.amount, P.split, P.intensity, P.glow, P.shadow, P.motionBlur, P.reverse],
    defaults: { pierce: 'clean', center: [0.5, 0.45], angle: 200, amount: 0.35, split: 0.35, intensity: 0.35, glow: 0, shadow: 0.3, motionBlur: 0.6, reverse: false } }),
  e('landscape_close', 'Landscape Close', 'Shutters & reveals', 60, { premium: true, duration: 1.2, sfx: 'whoosh', also: ['Creator Effects'],
    about: 'Black shutters close from top and bottom to a strip (or fully), the clip changes under them, and they open again on the next clip.',
    params: [P.amount, P.line, P.split, P.hold, P.balance, P.match, P.color, P.color2, P.feather, P.shadow, P.glow],
    defaults: { amount: 1, split: 0.5, hold: 0.08, balance: 0, match: 0, shadow: 0.35, glow: 0, color: '#000000', color2: '#000000', feather: 0, center: [0.5, 0.5] } }),
  e('portrait_close', 'Portrait Close', 'Shutters & reveals', 61, { premium: true, duration: 1.2, sfx: 'whoosh',
    about: 'Shutters close from the left and right to a vertical strip, the clip changes, and they open on the next one.',
    params: [P.amount, P.line, P.split, P.hold, P.balance, P.match, P.color, P.color2, P.feather, P.shadow, P.glow],
    defaults: { amount: 1, split: 0.5, hold: 0.08, balance: 0, match: 0, shadow: 0.35, glow: 0, color: '#000000', color2: '#000000', feather: 0, center: [0.5, 0.5] } }),
  e('whip_pan', 'Whip Pan', 'Cinematic', 62, { also: ['Creator Effects'], premium: true, params: [P.direction, P.intensity], directions: dir4, defaults: { direction: 'left', intensity: 0.8 }, duration: 0.45, sfx: 'swoosh',
    about: 'One fast camera move carries A out and B in; the streak follows the speed of the move.' }),
  e('lens_push', 'Lens Push', 'Cinematic', 63, { premium: true, motion: true, params: [P.intensity, P.motionBlur, P.center], defaults: { intensity: 0.6, motionBlur: 0.7 }, duration: 0.6 }),
  e('perspective_slide', 'Perspective Slide', 'Cinematic', 64, { premium: true, params: [P.direction], directions: ['left', 'right'], defaults: { direction: 'left' }, duration: 0.8 }),
  e('pullback_reveal', 'Pullback Reveal', 'Cinematic', 65, { premium: true, params: [], duration: 1.1, about: 'The shot pulls back into a floating window that rises away, revealing the next shot behind it.' }),
  e('card_stack', 'Card Stack', 'Modern', 66, { premium: true, params: [], duration: 0.8 }),
  e('flash_zoom', 'Flash Zoom', 'Modern', 67, { also: ['Creator Effects'], premium: true, params: [P.intensity, P.center], defaults: { intensity: 0.7 }, duration: 0.4 }),
  e('lens_cover', 'Lens Cover', 'Modern', 68, { params: [P.direction], directions: ['left', 'right'], defaults: { direction: 'left' }, duration: 0.6 }),
  e('film_burn', 'Film Burn', 'Modern', 69, { also: ['Creator Effects'], premium: true, params: [P.intensity], defaults: { intensity: 0.8 }, duration: 0.9 }),
  e('light_sweep', 'Light Sweep', 'Modern', 70, { premium: true, params: [P.angle, P.intensity], defaults: { angle: 20, intensity: 0.7 }, duration: 0.7 }),
  e('portal_zoom', 'Portal Zoom', 'Cinematic', 71, { premium: true, params: [P.center], duration: 0.9 }),
  e('liquid_morph', 'Liquid Morph', 'Modern', 72, { premium: true, params: [P.intensity], defaults: { intensity: 0.7 }, duration: 0.9 }),
  e('smooth_stretch', 'Smooth Stretch', 'Modern', 73, { params: [P.direction, P.intensity], directions: dir4, defaults: { direction: 'left', intensity: 0.5 }, duration: 0.45 }),
  e('glass_refraction', 'Glass Refraction', 'Modern', 74, { premium: true, params: [P.intensity], defaults: { intensity: 0.7 }, duration: 0.9 }),
  e('prism_split', 'Prism Split', 'Modern', 75, { params: [P.direction, P.intensity], directions: dir4, defaults: { direction: 'right', intensity: 0.5 }, duration: 0.45 }),
  e('paper_tear', 'Paper Tear', 'Shutters & reveals', 76, { premium: true, params: [], duration: 0.8 }),
  e('sliding_panels', 'Sliding Panels', 'Shutters & reveals', 77, { params: [P.strips], defaults: { strips: 5 }, duration: 0.9 }),
  e('film_strip', 'Film Strip', 'Modern', 78, { premium: true, params: [], duration: 0.9 }),
  e('beat_punch', 'Beat Punch', 'Modern', 79, { also: ['Creator Effects'], params: [P.intensity], defaults: { intensity: 0.7 }, duration: 0.35 }),
  e('split_merge', 'Split Screen Merge', 'Shutters & reveals', 80, { params: [], duration: 0.9 }),
  e('speed_ramp', 'Speed Ramp', 'Cinematic', 81, { premium: true, motion: true, params: [P.intensity, P.motionBlur], defaults: { intensity: 0.6, motionBlur: 0.8 }, duration: 0.8,
    about: 'A speeds up into the cut and B eases out of it: the footage itself is retimed over the transition, and the move blurs at its peak.' }),
  e('camera_spin', 'Camera Spin', 'Cinematic', 83, { also: ['Creator Effects'], premium: true, motion: true, params: [P.spin, P.direction, P.motionBlur], directions: ['cw', 'ccw'], defaults: { angle: 180, direction: 'cw', motionBlur: 0.8 }, duration: 0.7 }),
  e('freeze_frame', 'Freeze Frame', 'Modern', 85, { also: ['Creator Effects'], premium: true, params: [], duration: 1.1, about: "A's last frame freezes into a photo that tilts back and slides away over B." }),
  e('parallax_split', 'Parallax Split', 'Modern', 86, { params: [P.direction], directions: ['left', 'right'], defaults: { direction: 'left' }, duration: 0.7 }),
  e('snap_rotate', 'Snap Rotate', 'Modern', 87, { params: [P.direction, P.intensity], directions: ['cw', 'ccw'], defaults: { direction: 'cw', intensity: 0.7 }, duration: 0.4 }),
  e('soft_edge_reveal', 'Soft Edge Reveal', 'Shutters & reveals', 20, { params: [P.direction, P.feather], directions: dir4, defaults: { direction: 'left', feather: 0.18 }, duration: 0.9 }),
];

/* Zoom on one clip: not between two clips, an effect over part of a video or photo (frame/layer-fx-…). */
export const ZOOM_EFFECT = e('zoom_focus', 'Zoom', 'Effects', 90, { premium: true, motion: true, duration: 2.5,
  params: [P.scale, P.center, P.zoomIn, P.zoomOut, P.motionBlur], defaults: { scale: 2, center: [0.5, 0.5], zoomIn: 0.3, zoomOut: 0.3, motionBlur: 0.25, easing: 'smooth' } });
ZOOM_EFFECT.id = 'fx.zoom';

/* Styles: one effect, its character changed — never a separate implementation */
export const TRANSITION_STYLES = {
  Cinematic: { easing: 'smooth', motionBlur: 0.9, intensity: 0.7 },
  Smooth: { easing: 'easeInOut', motionBlur: 0.6, intensity: 0.5 },
  Energetic: { easing: 'snappy', motionBlur: 1, intensity: 1 },
  Minimal: { easing: 'easeInOut', motionBlur: 0.2, intensity: 0.3, glow: 0, shadow: 0.15 },
  Documentary: { easing: 'easeInOut', motionBlur: 0.4, intensity: 0.45 },
  Social: { easing: 'snappy', motionBlur: 0.8, intensity: 0.85 },
  Retro: { easing: 'linear', motionBlur: 0, intensity: 0.6, grain: 0.8 },
  'Premium SaaS': { easing: 'smooth', motionBlur: 0.5, intensity: 0.4, shadow: 0.25 },
};
/* One-clip effects (like Zoom): drawn over part of one video or photo from its own footage. */
const fx = (id, name, code, o) => { const d = e(id, name, 'Effects', code, o); d.id = `fx.${id}`; return d; };
export const EFFECTS = [
  ZOOM_EFFECT,
  fx('velocity', 'Velocity Edit', 98, { duration: 1.6, about: 'Speeds the footage up, slows it down and speeds up again (the classic velocity edit), landing exactly where the clip continues. Intensity sets how strong the swing is; a speed graph shapes it.', params: [P.intensity], defaults: { intensity: 0.65 } }),
  fx('beatShake', 'Beat Shake', 92, { duration: 0.6, about: 'A controlled directional shake on a musical hit (the beat point), settling quickly.', params: [P.split, P.direction, P.intensity], directions: ['left', 'right', 'up', 'down'], defaults: { split: 0.1, direction: 'right', intensity: 0.7 } }),
  fx('flash', 'Flash Impact', 93, { duration: 0.5, about: 'A brief exposure pulse with a punch zoom and a chromatic offset, on the beat point.', params: [P.split, P.intensity, P.glow, P.center], defaults: { split: 0.2, intensity: 0.8, glow: 0.3, center: [0.5, 0.5] } }),
  fx('glitch', 'Glitch Snap', 94, { duration: 0.5, about: 'A very short RGB displacement and frame break on the beat point.', params: [P.split, P.intensity], defaults: { split: 0.2, intensity: 0.8 } }),
  fx('leak', 'Film Burn / Light Leak', 95, { duration: 1.4, about: 'Warm light drifting across the frame, exposure rising and falling.', params: [P.intensity, P.direction], directions: ['left', 'right'], defaults: { intensity: 0.7, direction: 'left' } }),
  fx('roll', 'Smooth Camera Roll', 96, { duration: 1.2, about: 'Turns the picture about a point with a matched zoom (no corners show) and back.', params: [P.angle, P.direction, P.center, P.zoomIn, P.zoomOut], directions: ['cw', 'ccw'], defaults: { angle: 12, direction: 'cw', center: [0.5, 0.5], zoomIn: 0.4, zoomOut: 0.4 } }),
  fx('ripple', 'Ripple', 51, { duration: 2.4, about: RIPPLE_ABOUT, styles: RIPPLE_STYLES, params: RIPPLE_PARAMS, defaults: RIPPLE_DEFAULTS }),
  fx('splitFreeze', 'Split-Frame Freeze', 97, { duration: 1.2, about: 'Holds the frame and cuts it into strips that slide apart in turn.', params: [P.strips, P.amount, P.color], defaults: { strips: 4, amount: 0.6, color: '#000000' } }),
];
export const transitionById = (id) => (String(id).startsWith('fx.') ? EFFECTS.find((t) => t.id === id) : TRANSITIONS.find((t) => t.id === id));
export const EASINGS = ['smooth', 'easeInOut', 'easeIn', 'easeOut', 'linear', 'snappy', 'overshoot'];
export const EASING_NAMES = { smooth: 'Smooth (CapCut)', easeInOut: 'Ease in-out', easeIn: 'Ease in', easeOut: 'Ease out', linear: 'Linear', snappy: 'Snappy', overshoot: 'Overshoot' };
/** Hook for gating premium tiles; the editor has no gating, so nothing is locked. */
export const isLocked = (id) => !id && false;
