/* Subtitle layout and word reveals are evaluated from film time: scrubbing and export produce the same frame. */
import { WORD_PRESETS, LINE_STYLES } from './subtitle-styles.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const applyCase = (w, mode) => (mode === 'upper' ? w.toUpperCase() : mode === 'lower' ? w.toLowerCase() : mode === 'title' ? w.charAt(0).toUpperCase() + w.slice(1) : w);
const bounce = (x) => { const n1 = 7.5625, d1 = 2.75; if (x < 1 / d1) return n1 * x * x; if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75; if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375; return n1 * (x -= 2.625 / d1) * x + 0.984375; };

export function subtitleWordStarts(cue, count) {
  // Transcribed words use their actual cue-local timestamps. Manual captions have no speech observations, so
  // distribute their words across the authored cue; editing the text invalidates stale alignment.
  const timed = cue.wordTimes;
  if (timed?.length === count && timed.every((w,i) => Number.isFinite(w.start) && w.start >= 0 && (!i || w.start >= timed[i-1].start))) return timed.map(w => w.start);
  return Array.from({length:count},(_,i) => i * cue.duration / count);
}

export function createSubtitles(layer, root) {
  const cues = (layer.cues || []).map((c) => {const words=String(c.text || '').trim().split(/\s+/).filter(Boolean);return {...c,words,starts:subtitleWordStarts(c,words.length)};}).filter((c) => c.words.length);
  const lines = layer.mode === 'Lines';
  const st = lines ? (LINE_STYLES[layer.styleId] || LINE_STYLES[1]) : null;
  const [wFill, wEdge] = WORD_PRESETS[layer.styleId] || WORD_PRESETS[2];
  const box = document.createElement('div');
  root.appendChild(box);
  let key = '';
  const length = Math.max(0.5, ...cues.map((c) => c.start + c.duration));
  return {
    duration: length,
    frame(t) {
      const cue = cues.find((c) => t >= c.start && t < c.start + c.duration);
      if (!cue) { box.style.display = 'none'; return; }
      const W = innerWidth, u = W / 720, fs = (Number(layer.fontSize) || 78) * u;
      const slot = Math.max(0.08, cue.duration / cue.words.length);
      const elapsed = clamp(t - cue.start, 0, Math.max(0, cue.duration - 0.001));
      const index = Math.max(0,cue.starts.findLastIndex(s=>elapsed>=s));
      const start = lines ? Math.floor(index / 4) * 4 : index, active = index - start;
      const progress = (elapsed - cue.starts[index]) / slot;
      const caseMode = layer.textCase === 'upper' || layer.textCase === 'lower' || layer.textCase === 'title' ? layer.textCase : st && st.upper ? 'upper' : 'none';
      const words = cue.words.slice(start, lines ? start + 4 : start + 1).map((w) => applyCase(w, caseMode));
      const family = lines ? `${layer.font && layer.font !== 'Arial' ? layer.font + ', ' : ''}${st.font}` : `${layer.font || 'Sora'}, Arial, sans-serif`;
      box.style.cssText = `position:absolute;left:50%;top:${layer.y ?? 50}%;transform:translate(-50%,-50%);width:92%;text-align:center;display:block;font:${lines && st.italic ? 'italic ' : ''}${lines ? st.weight : 800} ${fs}px ${family};line-height:1.15`;
      const k = `${cue.id}|${start}|${words.join(' ')}`;
      if (k !== key) {
        key = k; box.innerHTML = '';
        const line = document.createElement('span');
        line.style.cssText = 'display:inline-block;white-space:pre-wrap;padding:0 .1em';
        words.forEach((w, i) => { const s = document.createElement('span'); s.style.cssText = 'display:inline-block;white-space:pre'; s.textContent = w; line.appendChild(s); if (i < words.length - 1) line.appendChild(document.createTextNode(' ')); });
        box.appendChild(line);
      }
      const line = box.firstChild, spans = [...line.querySelectorAll(':scope > span')];
      if (lines && st.box) { const padY = fs * st.box[1]; line.style.background = st.box[0]; line.style.borderRadius = `${fs * 0.2}px`; line.style.padding = `${padY * 0.2}px ${padY * 1.3}px`; }
      const custom = !!layer.customColors;
      spans.forEach((s, i) => {
        const isActive = i === active;
        let fill, edge = null, edgeW = 0;
        if (lines) {
          fill = custom ? (isActive ? layer.activeColor : layer.appearedColor) : isActive ? st.active : st.fill;
          if (st.stroke) { edge = custom ? layer.outlineColor : st.stroke; edgeW = fs * st.strokeW; }
        } else {
          fill = custom ? layer.activeColor : wFill; edge = custom ? layer.outlineColor : wEdge;
          edgeW = layer.outline === -1 ? 0 : layer.outline > 0 ? layer.outline * u : Math.max(4 * u, fs * 0.09);
        }
        s.style.color = fill;
        s.style.webkitTextStroke = edge && edgeW ? `${edgeW}px ${edge}` : '0';
        s.style.paintOrder = 'stroke fill';
        let shadow = '';
        if (lines && st.shadow) shadow = `0 ${3 * u}px ${st.shadow[1] * u}px ${st.shadow[0]}`;
        if (lines && st.glow) shadow = `0 0 ${st.glow[1] * u}px ${st.glow[0]}`;
        if (lines && st.drop) shadow = `${st.drop * u}px ${st.drop * u}px 0 #000`;
        if (!lines) shadow = `0 ${7 * u}px ${12 * u}px rgba(0,0,0,.45)`;
        let tf = '', op = 1, text = words[i];
        const animated = layer.animation && layer.animation !== 'None';
        const wordElapsed=t-cue.start-cue.starts[start+i];
        if(lines&&animated&&wordElapsed<0)op=0;
        if (animated && (!lines || wordElapsed>=0)) {
          const linear=clamp(wordElapsed/Math.max(.12,layer.animationSpeed??.3),0,1);
          const entry = 1-Math.pow(1-linear,4), a = layer.animation;
          if (a === 'Pop' || a === 'Scale' || a === 'Zoom') tf += `scale(${0.82 + 0.18 * entry})`;
          if (a === 'Slide up' || a === 'Rise' || a === 'Jump') {tf += `translateY(${(1 - entry) * fs * .85}px)`;op=entry;}
          if (a === 'Slide down') {tf += `translateY(${-(1 - entry) * fs * .85}px)`;op=entry;}
          if (a === 'Fade' || a === 'Blur in') op = entry;
          if (a === 'Spin in') tf += `rotate(${(1 - entry) * -9}deg)`;
          if (a === 'Bounce') { const b = bounce(entry); tf += `translateY(${-(1 - b) * 46 * u}px) scale(${0.9 + 0.1 * b}, ${1.12 - 0.12 * b})`; }
          if (a === 'Shake') tf += `translateX(${Math.sin(progress * 60) * 6 * (1 - entry * 0.5) * u}px)`;
          if (a === 'Glow') shadow = `0 0 ${28 * u * (0.6 + 0.4 * Math.sin(progress * Math.PI))}px ${fill}`;
          if (a === 'Typewriter') text = text.slice(0, Math.max(1, Math.ceil(text.length * entry)));
        }
        s.textContent = text; s.style.transform = tf; s.style.opacity = String(op); s.style.textShadow = shadow;
      });
    },
  };
}
