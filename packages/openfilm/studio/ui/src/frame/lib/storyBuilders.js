/* Builders for the in-editor story tools (Fake text story, Would You Rather, Reddit). Each returns plain editor layer specs
   (text/shape + animation presets), grouped so the scene moves together and stays fully editable. Times are relative. */
const wordsTime = (text, per = 0.2, min = 1.4, max = 5) => Math.min(max, Math.max(min, String(text).trim().split(/\s+/).length * per));
const at = (x, y, extra = {}) => ({ x, y, ...extra });
const text = (name, t, o = {}) => ({ kind: "text", name, props: { text: t, fontSize: 40, bold: true, weight: 600, color: "#fff", ...o.props }, at: o.at || 0, dur: o.dur, presets: o.presets });
const box = (name, o = {}) => ({ kind: "shape", name, props: { color: "#4568ee", width: 60, height: 14, cornerRadius: 30, ...o.props }, at: o.at || 0, dur: o.dur, presets: o.presets });

export const CHAT_THEMES = { ios: { bg: "#ffffff", me: "#2f7cf6", them: "#e6e6eb", meText: "#fff", themText: "#101114", head: "#f6f6f8", headText: "#101114", name: "Messages" }, dark: { bg: "#0d0d10", me: "#2f7cf6", them: "#2a2a2f", meText: "#fff", themText: "#f2f2f5", head: "#17171b", headText: "#f2f2f5", name: "Messages" }, green: { bg: "#ece5dd", me: "#d9fdd3", them: "#ffffff", meText: "#101114", themText: "#101114", head: "#075e54", headText: "#fff", name: "Chat" } };
export function buildFakeText({ contact = "Alex", theme = "ios", messages = [], gap = 0.5 }) {
  const th = CHAT_THEMES[theme] || CHAT_THEMES.ios, specs = [], list = messages.filter((m) => m.text.trim());
  let t = 0.3, y = 20;
  const total = list.reduce((n, m) => n + wordsTime(m.text, 0.18, 1, 3.2) + gap, 1.2);
  specs.push(box("Chat background", { props: at(50, 50, { width: 100, height: 100, color: th.bg, cornerRadius: 0 }), dur: total }));
  specs.push(box("Header", { props: at(50, 6, { width: 100, height: 11, color: th.head, cornerRadius: 0 }), dur: total }));
  specs.push(text("Contact", contact || "Contact", { props: at(50, 7.2, { fontSize: 34, color: th.headText, weight: 700 }), dur: total }));
  list.forEach((m, i) => {
    const mine = m.from === "me", len = m.text.length, w = Math.min(70, Math.max(24, 12 + len * 1.55)), lines = Math.max(1, Math.ceil(len / 22)), h = 4.6 + lines * 2.7;
    y += h / 2 + (i ? 1.2 : 0);
    const x = mine ? 96 - w / 2 : 4 + w / 2;
    specs.push(box(`Bubble ${i + 1}`, { props: at(x, y, { width: w, height: h, color: mine ? th.me : th.them, cornerRadius: 45 }), at: t, dur: total - t, presets: [["pop", { duration: 0.32 }]] }));
    specs.push(text(`Message ${i + 1}`, m.text, { props: at(x, y, { fontSize: 31, weight: 500, bold: false, color: mine ? th.meText : th.themText, width: w }), at: t, dur: total - t, presets: [["fade-in", { delay: 0.1, duration: 0.2 }]] }));
    y += h / 2;
    t += wordsTime(m.text, 0.18, 1, 3.2) + gap;
  });
  return { specs, duration: total };
}
export function buildWyr({ question = "Would you rather…", a = "", b = "", pctA = 62, colorA = "#3b6df0", colorB = "#e8485a", reveal = 5, intro = 1.2 }) {
  const total = intro + reveal + 2.5, pctB = 100 - pctA, specs = [];
  specs.push(box("Option A panel", { props: at(50, 25.5, { width: 100, height: 51, color: colorA, cornerRadius: 0 }), dur: total, presets: [["slide-in", { direction: "Left", duration: 0.45 }]] }));
  specs.push(box("Option B panel", { props: at(50, 74.5, { width: 100, height: 51, color: colorB, cornerRadius: 0 }), dur: total, presets: [["slide-in", { direction: "Right", duration: 0.45, delay: 0.12 }]] }));
  specs.push(text("Question", question, { props: at(50, 51, { fontSize: 38, color: "#fff", weight: 800 }), dur: total, presets: [["pop", { delay: 0.2 }]] }));
  specs.push(text("Option A", a || "Option A", { props: at(50, 27, { fontSize: 58, weight: 800 }), dur: total, presets: [["rise-in", { delay: 0.5, duration: 0.5 }]] }));
  specs.push(text("Option B", b || "Option B", { props: at(50, 75, { fontSize: 58, weight: 800 }), dur: total, presets: [["rise-in", { delay: 0.8, duration: 0.5 }]] }));
  specs.push(text("A %", `${pctA}%`, { props: at(50, 40, { fontSize: 78, weight: 900 }), at: intro + reveal, dur: total - intro - reveal, presets: [["counter", { duration: 1.2 }]] }));
  specs.push(text("B %", `${pctB}%`, { props: at(50, 87, { fontSize: 78, weight: 900 }), at: intro + reveal, dur: total - intro - reveal, presets: [["counter", { duration: 1.2 }]] }));
  return { specs, duration: total };
}
export function buildReddit({ subreddit = "AmItheAsshole", user = "throwaway123", title = "", body = "", upvotes = "12.4k", comments = "2.1k", dark = false }) {
  const bg = dark ? "#1a1a1b" : "#ffffff", ink = dark ? "#d7dadc" : "#1a1a1b", sub = "#7c7c7c", total = 1 + wordsTime(`${title} ${body}`, 0.22, 4, 14), specs = [];
  specs.push(box("Post card", { props: at(50, 40, { width: 90, height: 40, color: bg, cornerRadius: 6 }), dur: total, presets: [["pop", { duration: 0.4 }]] }));
  specs.push(box("Subreddit icon", { props: at(15, 24.5, { width: 7, height: 4, color: "#ff4500", cornerRadius: 50 }), dur: total, presets: [["pop", { delay: 0.2 }]] }));
  specs.push(text("Subreddit", `r/${subreddit}`, { props: at(44, 24, { fontSize: 28, color: ink, weight: 700, width: 60 }), dur: total, presets: [["fade-in", { delay: 0.25 }]] }));
  specs.push(text("User", `u/${user}`, { props: at(44, 26.8, { fontSize: 22, color: sub, weight: 500, bold: false }), dur: total, presets: [["fade-in", { delay: 0.3 }]] }));
  specs.push(text("Title", title || "Your post title here", { props: at(50, 35, { fontSize: 36, color: ink, weight: 800 }), dur: total, presets: [["fade-in", { delay: 0.4 }]] }));
  if (body.trim()) specs.push(text("Body", body, { props: at(50, 45, { fontSize: 28, color: ink, weight: 400, bold: false }), dur: total, presets: [["typewriter", { delay: 0.8, duration: Math.max(1.5, total - 2) }]] }));
  specs.push(text("Votes", `▲ ${upvotes}   💬 ${comments}`, { props: at(34, 57, { fontSize: 24, color: sub, weight: 700 }), dur: total, presets: [["fade-in", { delay: 0.6 }]] }));
  return { specs, duration: total };
}
