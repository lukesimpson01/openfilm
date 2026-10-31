/* Trending-sound research (reference only — no audio is bundled or downloaded).
   Compiled 25 Oct 2026 from editorial roundups (newengen.com October TikTok trends, stackinfluence.com 2026 audio guide).
   These are editorial picks, NOT TikTok usage data — check TikTok Creative Center for live rankings. */
export const TRENDING_AS_OF = "25 Oct 2026";
export const TRENDING_SOURCES = [
  ["October 2026 TikTok trends", "https://newengen.com/insights/october-tiktok-trends/"],
  ["Popular TikTok songs 2026", "https://stackinfluence.com/blog/popular-tiktok-songs-2026-the-creators-audio-guide"],
  ["TikTok Creative Center (live rankings)", "https://ads.tiktok.com/business/creativecenter/inspiration/popular/music/pc/en"],
  ["TikTok Commercial Music Library", "https://ads.tiktok.com/business/en-US/blog/audio-library-royalty-free-music"],
];
export const TRENDING_SOUNDS = [
  { title: "Two Fishes", by: "Corbin Mims (Love Island USA)", tag: "Meme audio · October", note: "Spoken audio clip, not a song." },
  { title: "Ramalama (Bang Bang)", by: "Róisín Murphy", tag: "Halloween reveals", note: "Used for dramatic costume reveals." },
  { title: "Quiet on the Creek", by: "Saucy Santana", tag: "Dance · late summer", note: "Peaked late Aug–Sept; may be fading." },
  { title: "Jess Glynne", by: "TikTok's top artist of 2026", tag: "Year-level honour", note: "Named by TikTok in Dec 2025." },
];
export const soundSearchLinks = (s) => {
  const q = encodeURIComponent(`${s.title} ${s.by}`.replace(/\(.*?\)/g, "").trim());
  return { tiktok: `https://www.tiktok.com/search?q=${q}`, youtube: `https://www.youtube.com/results?search_query=${q}` };
};
