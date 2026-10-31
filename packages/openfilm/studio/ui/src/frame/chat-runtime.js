/* FRAME fake-text story: the phone from the old live preview, drawn as a pure function of t (page contract §3).
   Markup, timing and sizes are the preview's own (256 × 454 phone, scaled to the stage); the clock is `t`, not rAF. */
const SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs><symbol id="chev-left" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></symbol><symbol id="video" viewBox="0 0 24 24"><rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/></symbol><symbol id="phone-call" viewBox="0 0 24 24"><path d="M6 3h4l1 5-2 2a17 17 0 0 0 5 5l2-2 5 1v4a3 3 0 0 1-3 3A16 16 0 0 1 3 6a3 3 0 0 1-3 3Z"/></symbol><symbol id="play" viewBox="0 0 24 24"><path d="m8 4 12 8-12 8z" fill="currentColor" stroke="none"/></symbol><symbol id="pause" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/></symbol><symbol id="full" viewBox="0 0 24 24"><path d="M9 3H3v6m18 0V3h-6M3 15v6h6m6 0h6v-6"/></symbol></defs></svg>`;
const icons = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const displayDuration = n => { n = Math.round(n); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const getMessageSeconds = msg => Math.max(msg.imageUrl ? 2.2 : 1.15, Math.min(7, (msg.text?.length || 0) / 15 + .75));
export function messageTimeline(messages) {
  const lines = messages.filter(m => m.text?.trim() || m.imageUrl); let at = .35;
  const cues = lines.map(m => { const appearAt = at * 1000; at += getMessageSeconds(m) + .45; return { appearAt, end: at * 1000 }; });
  return { cues, duration: Math.max(1, lines.reduce((a, m) => a + getMessageSeconds(m) + .45, 0)) * 1000 };
}
const textIndexAt = (seconds, lines) => { let at = .35, num = 0; for (const m of lines) { if (seconds + 1e-5 < at) break; num++; at += getMessageSeconds(m) + .45; } return num; };

export function createChat(layer, root) {
  const lines = (layer.messages || []).filter((m) => m.text?.trim() || m.imageUrl).map((m, i) => ({ ...m, id: m.id ?? `m${i}`, from: m.side === 'right' ? 'sender' : 'receiver' }));
  const skin = layer.skin || 'ios-dark', wa = skin.startsWith('whatsapp');
  const profileName = () => (layer.contact || '').trim() || 'Unknown';
  const timeline = messageTimeline(lines);
  function waHeader() { return `<div class="waBar"><span class="waBack">${icons('chev-left')}</span><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="waContact"><div class="waName">${escapeHtml(profileName())}</div><div class="waStatus">online</div></div><span class="waHeaderIcons">${icons('video')}${icons('phone-call')}</span></div>`; }
  function iosHeader() { return `<div class="iosbar"><div class="backBadge">${icons('chev-left', 'sm')}<span class="badge99">99</span></div><div class="contactMini"><span class="miniAvatar">${escapeHtml(profileName()[0].toUpperCase())}</span><div class="contactName">${escapeHtml(profileName())}<span class="contactChevron">›</span></div></div>${icons('video', 'sm')}</div>`; }
  function messageContent(message, index) { return `${message.imageUrl ? `<img src="${escapeHtml(message.imageUrl)}" alt="${escapeHtml(message.imageName || 'Message image')}"/>` : ''}<span class="messageCopy">${escapeHtml(message.text || '')}</span>${wa ? `<span class="waMeta"><span>10:${String(40 + index).padStart(2, '0')}</span>${message.from === 'sender' ? '<span class="waTicks" aria-label="Read"></span>' : ''}</span>` : ''}`; }
  root.innerHTML = `<div class="csp-root cs-root csp-render-root">${SPRITE}<div class="csp-stage"><div class="phone ${skin}"><div class="storyChat" id="storyChat">${wa ? waHeader() : iosHeader()}<div class="chatMessages" id="chatMessages"></div></div></div></div></div>`;
  const outer = root.firstElementChild, phone = root.querySelector('.phone'), card = root.querySelector('.storyChat'), chat = root.querySelector('.chatMessages');
  /* the phone's sizes are written in --chat-scale (the home tool sets it): unset, every calc() using it falls away (no
     padding under the last message) */
  phone.style.setProperty('--chat-scale', '1');
  let built = '';
  const fit = () => { const s = Math.min(innerWidth / 256, innerHeight / 454); outer.style.cssText = `position:absolute;left:${(innerWidth - 256 * s) / 2}px;top:${(innerHeight - 454 * s) / 2}px;transform:scale(${s});transform-origin:0 0;width:256px;height:454px`; };
  fit();
  const bubbleHtml = (m, i) => `<div class="bubbleLine ${m.from === 'sender' ? 'from-sender' : ''}" data-message-id="${escapeHtml(m.id)}"><div class="bubble ${m.imageUrl ? 'has-image' : ''}">${messageContent(m, i)}</div></div>`;
  /* Pages: the conversation is split where the next message would not fit above the card's limit. When a page is
     full the chat clears (CLEAR_MS) and goes on from the top of the card, without the contact bar: as a long text
     story does. Each bubble is measured once, laid out as it is shown (its images loaded). */
  const CLEAR_MS = 260;
  let pages = null;
  const header = card.firstElementChild;
  function paginate() {
    const probe = chat.cloneNode(false);
    probe.removeAttribute('id');
    probe.style.cssText = 'position:absolute;left:0;right:0;top:0;visibility:hidden;pointer-events:none;margin:0';
    probe.innerHTML = lines.map(bubbleHtml).join('');
    card.appendChild(probe);
    const sizes = [...probe.children].map((n) => n.offsetHeight + (Number.parseFloat(getComputedStyle(n).marginBottom) || 0));
    probe.remove();
    const limit = phone.offsetHeight * 0.77, head = header.offsetHeight;
    const starts = [0];
    let used = 0;
    sizes.forEach((h, i) => {
      const room = starts.length === 1 ? limit - head : limit - 12;
      if (used > 0 && used + h > room) { starts.push(i); used = 0; }
      used += h;
    });
    return { starts, head };
  }
  const ready = Promise.all([...new Set(lines.map((m) => m.imageUrl).filter(Boolean))].map((src) => new Promise((done) => { const i = new Image(); i.onload = i.onerror = done; i.src = src; }))).then(() => document.fonts?.ready);
  return {
    duration: Math.max(1, timeline.duration / 1000 + 1),
    ready,
    frame(t) {
      fit();
      if (!pages) pages = paginate();
      const ms = t * 1000, playIndex = textIndexAt(t, lines), { starts } = pages;
      /* the page of the newest message shown; while a new page clears in, the page before it fades out */
      let page = 0;
      for (let k = starts.length - 1; k > 0; k--) if (playIndex - 1 >= starts[k]) { page = k; break; }
      const clearing = page > 0 && ms < timeline.cues[starts[page]].appearAt + CLEAR_MS;
      const shownPage = clearing ? page - 1 : page;
      const from = starts[shownPage], to = clearing ? starts[page] : playIndex;
      const key = `${from}:${to}`;
      if (key !== built) {
        /* playing forward only adds the new bubble: the ones already there are never rebuilt */
        const [bf, bt] = built ? built.split(':').map(Number) : [-1, -1];
        if (bf === from && to > bt && chat.children.length === bt - bf) chat.insertAdjacentHTML('beforeend', lines.slice(bt, to).map((m, i) => bubbleHtml(m, bt + i)).join(''));
        else chat.innerHTML = lines.slice(from, to).map((m, i) => bubbleHtml(m, from + i)).join('');
        built = key;
      }
      /* the contact bar is the first page's only */
      header.style.display = shownPage > 0 ? 'none' : '';
      chat.style.paddingTop = shownPage > 0 ? '8px' : '';
      chat.style.scrollBehavior = 'auto';
      const head = shownPage > 0 ? 0 : header.offsetHeight, limit = phone.offsetHeight * .77;
      const content = chat.scrollHeight;
      const last = chat.lastElementChild, margin = last ? Number.parseFloat(getComputedStyle(last).marginBottom) || 0 : 0;
      const growing = !clearing && to > from;
      const contentBefore = growing && last ? Math.max(0, content - last.offsetHeight - margin) : content;
      const appear = (i) => timeline.cues[i].appearAt + (page > 0 && i === starts[page] ? CLEAR_MS : 0);
      const age = growing ? ms - appear(to - 1) : 1000;
      const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, age / 450)), 3);
      /* the card grows down to reveal a new bubble; a page never overflows, but one bubble taller than the card slides */
      const grow = (c) => Math.max(head + 8, Math.min(limit, head + c));
      const height = grow(contentBefore) + (grow(content) - grow(contentBefore)) * eased;
      const over = (c) => Math.max(0, head + c - limit);
      const shift = over(contentBefore) + (over(content) - over(contentBefore)) * eased;
      card.style.transition = 'none'; card.style.height = height + 'px';
      chat.style.marginTop = -shift + 'px';
      /* the clearing page: out and up, quickly; the new one comes in from the top */
      const fade = clearing ? Math.max(0, Math.min(1, (ms - timeline.cues[starts[page]].appearAt) / CLEAR_MS)) : 0;
      const fe = 1 - Math.pow(1 - fade, 3);
      card.style.opacity = clearing ? String(1 - fe) : '';
      card.style.transform = clearing ? `translateY(${-10 * fe}px) scale(${1 - 0.02 * fe})` : '';
      for (let i = from; i < to; i++) {
        const node = chat.children[i - from]; if (!node) continue;
        const p = clearing ? 1 : Math.max(0, Math.min(1, (ms - appear(i)) / 300)), e = 1 - Math.pow(1 - p, 3);
        node.style.setProperty('--bubble-o', String(p)); node.style.setProperty('--bubble-y', `${(1 - e) * 10}px`); node.style.setProperty('--bubble-s', String(.98 + .02 * e));
      }
    },
  };
}
