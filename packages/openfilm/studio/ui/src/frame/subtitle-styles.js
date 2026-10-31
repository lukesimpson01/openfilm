/* FRAME subtitle presets, from the old editor: Word presets (one word at a time) and Lines presets (a line of four,
   the spoken word lit). Shared by the page runtime and the panel. */
const IMPACT = "Impact, 'Arial Narrow Bold', 'Haettenschweiler', sans-serif", BLACKF = "'Arial Black', 'Helvetica Neue', Arial, sans-serif", SOFT = "Sora, Poppins, 'Helvetica Neue', Arial, sans-serif", MARKER = "'Marker Felt', 'Comic Sans MS', 'Arial Black', sans-serif", ROUND = "'Arial Rounded MT Bold', Nunito, 'Helvetica Neue', Arial, sans-serif";
export const WORD_PRESETS = { 2: ['#fff', '#000'], 215: ['#4bd8f4', '#000'], 4: ['#fff', '#111'], 5: ['#fff', '#222'], 9: ['#fff', '#000'], 18: ['#fff', '#111'], 24: ['#f7e44b', '#222'], 39: ['#7cf66d', '#121212'], 48: ['#fb73d4', '#111'], 54: ['#fff', '#2966f2'], 58: ['#fff', '#171717'], 72: ['#ffdd00', '#000'], 78: ['#fff', '#111'], 108: ['#62d5ff', '#173248'], 113: ['#fff', '#f4554e'], 143: ['#fff', '#131313'] };
export const LINE_STYLES = {
  1: { font: SOFT, weight: 700, fill: '#fff', active: '#fff', shadow: ['rgba(0,0,0,.85)', 18] },
  7: { font: SOFT, weight: 600, fill: '#fff', active: '#fff', stroke: '#b9bec8', strokeW: 0.05 },
  3: { font: IMPACT, weight: 400, italic: true, upper: true, fill: '#fff', active: '#1d5cff', stroke: '#000', strokeW: 0.09, drop: 4 },
  6: { font: SOFT, weight: 500, fill: '#0d0f14', active: '#0d0f14', box: ['#ececec', 0.28] },
  67: { font: MARKER, weight: 800, italic: true, upper: true, fill: '#fff', active: '#fff', stroke: '#000', strokeW: 0.14 },
  8: { font: SOFT, weight: 400, fill: '#ffff1a', active: '#ffff1a', glow: ['#ffff1a', 26] },
  34: { font: IMPACT, weight: 400, italic: true, upper: true, fill: '#fff', active: '#e0222a', stroke: '#000', strokeW: 0.1, drop: 4 },
  37: { font: BLACKF, weight: 900, upper: true, fill: '#fff', active: '#f2d31a', stroke: '#000', strokeW: 0.11 },
  61: { font: BLACKF, weight: 900, upper: true, fill: '#22e5e5', active: '#22e5e5' },
  66: { font: BLACKF, weight: 900, upper: true, fill: '#fff', active: '#a6f24a', stroke: '#000', strokeW: 0.13 },
  104: { font: ROUND, weight: 800, fill: '#fff', active: '#ffc872', stroke: '#e0596b', strokeW: 0.09 },
  114: { font: IMPACT, weight: 400, italic: true, upper: true, fill: '#fff', active: '#f0a3b8', stroke: '#d8d8e0', strokeW: 0.03 },
  122: { font: BLACKF, weight: 900, upper: true, fill: '#fff', active: '#fff', stroke: '#000', strokeW: 0.08 },
  131: { font: BLACKF, weight: 900, upper: true, fill: '#fff', active: '#fff', box: ['#1a7bf0', 0.22], shadow: ['rgba(0,0,0,.5)', 8] },
  157: { font: SOFT, weight: 700, fill: '#fff', active: '#fff', box: ['#000', 0.2] },
  208: { font: 'Arial, sans-serif', weight: 700, upper: true, fill: '#fff', active: '#9fd0ff', glow: ['#ffffff', 14] },
};
export const SUB_ANIMATIONS = ['None', 'Pop', 'Bounce', 'Fade', 'Slide up', 'Slide down', 'Zoom', 'Rise', 'Blur in', 'Spin in', 'Typewriter', 'Shake', 'Glow'];
export const SUB_POSITIONS = { Top: 14, Middle: 50, Bottom: 80 };
export const SUB_FONTS = ['Sora', 'Inter', 'Arial', 'Montserrat', 'Poppins', 'Impact', 'Georgia', 'Roboto'];
