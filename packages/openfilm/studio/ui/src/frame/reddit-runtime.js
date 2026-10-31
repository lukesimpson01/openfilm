/* FRAME Reddit story: the post card of the old live preview, as a pure function of t. Posts take 5 s each; the body
   shows word by word. The phone it was designed on is 247 px wide (9:16), scaled to the stage. */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SLOT = 5;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON_UP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 4 4 13h5v7h6v-7h5z"/></svg>';
const ICON_MSG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.4A8.5 8.5 0 1 1 21 11.5z"/></svg>';

export function createReddit(layer, root) {
  const posts = layer.posts?.length ? layer.posts : [{ author: 'u/creator', title: 'Your story title', body: '', votes: '0', comments: '0' }];
  const dark = !!layer.dark, duration = Math.max(SLOT, posts.length * SLOT);
  root.innerHTML = '<div class="rlp-fit"><div class="rlp-phone ' + (dark ? 'dark' : 'light') + '"><article class="rlp-post"></article></div></div>';
  const fitEl = root.firstElementChild, phone = root.querySelector('.rlp-phone'), card = root.querySelector('.rlp-post');
  let shown = -1;
  const fit = () => { const s = Math.min(innerWidth / 247, innerHeight / 439); fitEl.style.cssText = `position:absolute;left:${(innerWidth - 247 * s) / 2}px;top:${(innerHeight - 439 * s) / 2}px;width:247px;height:439px;transform:scale(${s});transform-origin:0 0`; };
  fit();
  return {
    duration,
    frame(t) {
      fit();
      const index = Math.min(posts.length - 1, Math.floor(t / SLOT)), post = posts[index];
      const words = String(post.body || '').split(/\s+/).filter(Boolean);
      if (index !== shown) {
        const avatar = post.avatarUrl ? `<img src="${esc(post.avatarUrl)}" alt="">` : esc(String(post.author || 'u')[0].toUpperCase());
        const picture = post.imageUrl ? `<div class="rlp-image"><img src="${esc(post.imageUrl)}" alt=""></div>` : '';
        card.innerHTML = `<div class="rlp-author"><span class="rlp-avatar">${avatar}</span><div><strong>${esc(post.author || 'u/creator')}</strong><small>Posted just now · Story</small></div></div><h3>${esc(post.title || 'Your story title')}</h3>${picture}<p>${words.map((w) => `<span>${esc(w)} </span>`).join('')}</p><footer><span>${ICON_UP}${esc(post.votes || '0')}</span><span>${ICON_MSG}${esc(post.comments || '0')}</span><span>Share</span></footer>`;
        shown = index;
        const pending = [...card.querySelectorAll('img')].filter((i) => !i.complete);
        if (pending.length) return Promise.all(pending.map((i) => new Promise((done) => { i.onload = i.onerror = done; setTimeout(done, 4000); }))).then(() => this.frame(t));
      }
      const local = t - index * SLOT, reveal = clamp((local - 0.5) / 3.8, 0, 1), count = Math.ceil(words.length * reveal);
      card.querySelectorAll('p span').forEach((s, i) => { s.style.opacity = i < count ? '1' : '.13'; });
      const e = clamp(local / 0.32, 0, 1), ease = 1 - Math.pow(1 - e, 3);
      card.style.opacity = String(0.5 + 0.5 * ease);
      card.style.transform = `translateY(${(1 - ease) * 12}px) scale(${0.97 + 0.03 * ease})`;
    },
  };
}
