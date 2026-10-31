/* A graphic written for one moment: HTML and CSS (its movement as CSS animations and transitions), laid out on a
   stage-sized box (1080×1920 unless the layer says) scaled to the page. Every animation is paused and set to the film's
   time each frame, so it is a function of t like every other page: the preview and the export draw the same frame.
   --t (seconds) and --p (0…1 through the clip) are set on the box for calc()-driven styles. Scripts and inline
   handlers are dropped: a graphic is markup and style only. */
export function createCustom(layer, root) {
  const W = layer.stageW ?? 1080, H = layer.stageH ?? 1920, duration = Math.max(0.1, layer.duration || 4);
  const style = document.createElement('style'); style.textContent = String(layer.css ?? '');
  const box = document.createElement('div'); box.className = 'g';
  box.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;overflow:hidden`;
  const clean = String(layer.html ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
  box.innerHTML = clean;
  root.append(style, box);
  const fit = () => { const k = Math.min(innerWidth / W, innerHeight / H); box.style.transform = `translate(${(innerWidth - W * k) / 2}px, ${(innerHeight - H * k) / 2}px) scale(${k})`; };
  const imgs = [...box.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((d) => { i.onload = i.onerror = d; })));
  const ready = Promise.all([document.fonts?.ready, ...imgs]).then(() => {});
  return {
    duration, ready,
    frame(t) {
      fit(); const tt = Math.min(Math.max(t, 0), duration);
      box.style.setProperty('--t', String(tt)); box.style.setProperty('--p', String(tt / duration));
      for (const a of box.getAnimations({ subtree: true })) { a.pause(); a.currentTime = tt * 1000; }
    },
  };
}
