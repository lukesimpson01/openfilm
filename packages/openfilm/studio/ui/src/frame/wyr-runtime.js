/* Shorts would-you-rather: the home tool's phone (studioEngine.js wyrPhoneMarkup / paintWyrAt), drawn as a pure
   function of t. Same markup, timing (option A, option B, countdown, results) and styles (chat.css holds studioStyles).
   Designed on a 256 × 454 phone, scaled to the stage. */
const FPS = 60;
const easeOut = (t) => { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const DEFAULT_TIMING = { countdown: 3, results: 2.4, gap: 0.55 };
function wyrQ(timing) {
  const first = 0.48, second = 1.33, count = 2.45;
  return { first, second, count, reveal: count + timing.countdown, one: count + timing.countdown + timing.results + timing.gap };
}
export function wyrDuration(questions, timing = DEFAULT_TIMING) { return questions.reduce((a) => a + wyrQ(timing).one, 0); }

export function createWyr(layer, root) {
  const questions = layer.questions?.length ? layer.questions : [{ a: 'Option A', b: 'Option B', percent: 50, label: true }];
  const timing = { ...DEFAULT_TIMING, ...(layer.timing || {}) };
  const total = wyrDuration(questions, timing);
  root.innerHTML = `<div class="csp-root cs-root csp-render-root"><div class="csp-stage"><div class="phone wyrPhone"><div class="wyrStages"><div class="wyrHalf wyrTop"><div class="wyrChoice" data-top-content><span class="wyrOverline">OPTION A</span><img class="wyrPic" data-img-a alt="" hidden><div class="wyrOption" data-opt-a></div><div class="wyrVote" data-vote-a><strong data-percent-a>50%</strong><span class="wyrVoteBar"><i data-bar-a></i></span></div></div></div><div class="wyrHalf wyrBottom"><div class="wyrChoice" data-bottom-content><span class="wyrOverline">OPTION B</span><img class="wyrPic" data-img-b alt="" hidden><div class="wyrOption" data-opt-b></div><div class="wyrVote" data-vote-b><strong data-percent-b>50%</strong><span class="wyrVoteBar"><i data-bar-b></i></span></div></div></div><div class="wyrMiddle"><span data-wyr-middle>OR</span></div><span class="wyrQuestionTag" data-qtag></span></div></div></div></div>`;
  const outer = root.firstElementChild, ph = root.querySelector('.wyrPhone');
  const $ = (s) => ph.querySelector(s);
  /* chat.css writes its sizes in --chat-scale (the home tool sets it) */
  ph.style.setProperty('--chat-scale', '1');
  const fit = () => { const s = Math.min(innerWidth / 256, innerHeight / 454); outer.style.cssText = `position:absolute;left:${(innerWidth - 256 * s) / 2}px;top:${(innerHeight - 454 * s) / 2}px;transform:scale(${s});transform-origin:0 0;width:256px;height:454px`; };
  fit();
  return {
    duration: Math.max(1, total),
    frame(time) {
      fit();
      const d = wyrQ(timing), t0 = Math.min(Math.max(0, time), Math.max(0, total - 1 / FPS));
      const index = Math.min(questions.length - 1, Math.floor(t0 / d.one)), q = questions[index], t = t0 - index * d.one;
      const st = { a: easeOut((t - d.first) / 0.52), b: easeOut((t - d.second) / 0.52), countdown: t >= d.count && t < d.reveal, number: Math.max(1, Math.ceil(d.reveal - t)), revealed: t >= d.reveal, progress: easeOut((t - d.reveal) / 0.48) };
      const A = $('[data-top-content]'), B = $('[data-bottom-content]');
      $('[data-opt-a]').innerHTML = esc(q.a); $('[data-opt-b]').innerHTML = esc(q.b);
      /* an option's picture, above its words (the home tool's) */
      for (const [key, src] of [['a', q.imageA], ['b', q.imageB]]) { const img = $(`[data-img-${key}]`); if (src) { if (img.getAttribute('src') !== src) img.src = src; img.hidden = false; } else img.hidden = true; $(key === 'a' ? '[data-top-content]' : '[data-bottom-content]').classList.toggle('hasPic', !!src); }
      A.style.opacity = st.a; A.style.transform = `translateX(${(1 - st.a) * -26}px)`;
      B.style.opacity = st.b; B.style.transform = `translateX(${(1 - st.b) * 26}px)`;
      const middle = $('[data-wyr-middle]'), mid = $('.wyrMiddle');
      middle.textContent = st.countdown ? String(st.number) : 'OR';
      mid.classList.toggle('isCounting', st.countdown); mid.classList.toggle('isResults', st.revealed);
      const pct = Math.max(0, Math.min(100, Number(q.percent) || 0));
      $('[data-percent-a]').textContent = pct + '%'; $('[data-percent-b]').textContent = (100 - pct) + '%';
      $('[data-vote-a]').classList.toggle('isWinner', pct > 50); $('[data-vote-a]').classList.toggle('isLoser', pct < 50);
      $('[data-vote-b]').classList.toggle('isWinner', pct < 50); $('[data-vote-b]').classList.toggle('isLoser', pct > 50);
      for (const key of ['a', 'b']) {
        const wrap = $('[data-vote-' + key + ']');
        wrap.style.opacity = st.revealed ? st.progress : 0;
        wrap.style.transform = `translateY(${st.revealed ? (1 - st.progress) * 10 : 10}px)`;
        $('[data-bar-' + key + ']').style.width = (st.revealed ? (key === 'a' ? pct : 100 - pct) * st.progress : 0) + '%';
      }
      $('[data-qtag]').textContent = q.label !== false && st.a > 0 ? 'QUESTION ' + (index + 1) : '';
    },
  };
}
