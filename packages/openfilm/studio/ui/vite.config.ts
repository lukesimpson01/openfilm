import { defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Studio's editor: built once into dist/ and served by Studio's own server (studio/server/server.mjs) */
const STUDIO = normalizePath(fileURLToPath(new URL('./src/', import.meta.url)));
/* the desktop app's chat (apps/desktop/chat), shown in the editor's chat column (src/frame/ChatPanel.tsx) */
const DESKTOP = fileURLToPath(new URL('../../../../apps/desktop/', import.meta.url));
const CHAT = normalizePath(join(DESKTOP, 'chat/src/'));

/** `@/…` is the importing file's own tree: Studio's files and the chat's each name their `src` so (as the app's shell). */
function twoTrees(): Plugin {
  return {
    name: 'shorts-two-trees',
    enforce: 'pre',
    resolveId(source, importer, options) {
      if (!source.startsWith('@/') || !importer) return null;
      const base = normalizePath(importer).startsWith(CHAT) ? CHAT : STUDIO;
      return this.resolve(join(base, source.slice(2)), importer, { ...options, skipSelf: true });
    },
  };
}

/** The chat's styles kept to the chat (apps/desktop/shell/vite.config.ts `scopeChat`, the same rule). */
/* postcss's plugin, typed here (postcss is Vite's own dependency, not this package's) */
type Rule = { selectors: string[]; parent?: { type: string; name?: string }; remove(): void };
type PostcssPlugin = { postcssPlugin: string; Once(root: { walkRules(fn: (rule: Rule) => void): void }, helpers: { result: { opts: { from?: string } } }): void };
const scopeChat: PostcssPlugin = {
  postcssPlugin: 'shorts-scope-chat',
  Once(root, { result }) {
    if (!normalizePath(result.opts.from ?? '').startsWith(CHAT)) return;
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name ?? '')) return;
      const selectors = new Set<string>();
      for (const raw of rule.selectors) {
        const s = raw.trim();
        if (/:not\(\[data-theme\]\)|data-assets-open|openfilm-inset-titlebar|openfilm-fullscreen|tl-scrubbing|data-focus-nav/.test(s)) continue;
        const page = /^(?::root|html|body)(?![\w-])/.exec(s);
        const theme = /^\[data-theme='(?:light|dark)'\]/.exec(s);
        if (page) selectors.add(`.of-chat${s.slice(page[0].length)}`);
        else if (theme) selectors.add(`${theme[0]} .of-chat${s.slice(theme[0].length)}`);
        else selectors.add(`.of-chat ${s}`);
      }
      if (selectors.size) rule.selectors = [...selectors];
      else rule.remove();
    });
  },
};

export default defineConfig({
  root: __dirname,
  plugins: [twoTrees(), react(), tailwind()],
  css: { postcss: { plugins: [scopeChat as never] } },
  resolve: {
    alias: { '@desktop': DESKTOP },
    /* one React for both trees (each would find its own package's otherwise) */
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', sourcemap: false },
});
