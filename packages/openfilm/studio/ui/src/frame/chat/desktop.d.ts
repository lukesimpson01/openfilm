/* the desktop app's chat, built into the editor (vite.config.ts `@desktop`, `twoTrees`); typed by its own package */
declare module '@desktop/chat/src/mount' { export function mountChat(root: HTMLElement): Promise<void>; }
declare module '@desktop/chat/src/chat.css';
declare module '@desktop/src/preload.cjs?raw' { const text: string; export default text; }
