#!/usr/bin/env node
/**
 * The desktop app's chat, for the web editor: what the app's main process does for its chat page (src/main.mjs —
 * the agents, the chat's record of each project, its skills, the agents' roster), done here, in Node, without
 * Electron. The page reaches it over HTTP instead of IPC:
 *
 *   POST /ipc/<channel>   { args: [...] }  → the handler's answer (ipcMain.handle's)    { ok, value } | { ok: false, error }
 *   POST /send/<channel>  { args: [...] }  → for ipcMain.on's (no answer)
 *   GET  /events          server-sent events: { channel, value }, what the app sends the page (webContents.send)
 *
 * The handlers are the app's own modules, unchanged (src/local-agents-ipc.mjs, chat-ipc.mjs, skills-ipc.mjs,
 * agent-roster.mjs). It listens on 127.0.0.1 only. Studio (the dev one, its run.json) answers its /api.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { registerLocalAgentIpc } from '../src/local-agents-ipc.mjs';
import { readPreferences, registerChatIpc } from '../src/chat-ipc.mjs';
import { registerSkillsIpc } from '../src/skills-ipc.mjs';
import { createRoster } from '../src/agent-roster.mjs';
import { checkAgentProgram, diagnoseAgent, listAgents, localAgent, openAgentInstaller, openAgentSignIn, setChosenPaths } from '../src/agents.mjs';
import { agentUsage, forgetAgentUsage } from '../src/agent-usage.mjs';
import { installOpenfilmCommand } from '../src/openfilm-command.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SHORTS_CHAT_PORT || 4851);
const STUDIO_HOME = process.env.OPENFILM_HOME || join(here, '..', '..', '..', 'packages', 'openfilm', '.dev', 'home');
/* the app's own data (its roster, preferences, logs): beside Studio's dev home */
const DATA = process.env.SHORTS_CHAT_DATA || join(STUDIO_HOME, '..', 'chat-data');
mkdirSync(DATA, { recursive: true });
const log = (line) => { try { appendFileSync(join(DATA, 'chat-host.log'), line.endsWith('\n') ? line : `${line}\n`); } catch { /* */ } };

/* Studio's address and key, as it wrote them when it started */
async function studioApi(path) {
  const run = JSON.parse(readFileSync(join(STUDIO_HOME, 'run.json'), 'utf8'));
  const res = await fetch(`${run.origin}${path}`, { headers: { 'x-studio-key': run.key } });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
  return res.json();
}
const projects = async () => (await studioApi('/api/projects')).projects.filter((p) => !p.missing).map((p) => p.path);

/* ── what the app sends the page: to every page listening ── */
const clients = new Set();
function broadcast(channel, value) {
  const line = `data: ${JSON.stringify({ channel, value: encode(value) })}\n\n`;
  for (const res of clients) res.write(line);
}
/* the one page there is: never destroyed while the host runs (its 'destroyed' is never heard) */
const sender = { send: broadcast, isDestroyed: () => false, id: 1, once: () => sender, on: () => sender, off: () => sender, removeListener: () => sender };
const event = { sender, senderFrame: { url: 'http://127.0.0.1/' } };

/* bytes travel as base64 both ways (a reference's picture, a pasted file) */
function encode(value) {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return { __bytes: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === 'object' && value.constructor === Object) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)]));
  return value;
}
function decode(value) {
  if (value && typeof value === 'object' && typeof value.__bytes === 'string') { const b = Buffer.from(value.__bytes, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decode(v)]));
  return value;
}

/* ── ipcMain, as the app's modules use it ── */
const handlers = new Map();
const listeners = new Map();
const ipcMain = {
  handle: (channel, fn) => { handlers.set(channel, fn); },
  on: (channel, fn) => { listeners.set(channel, fn); },
};
const trusted = () => true;
/* on macOS a program is shown in its folder, a folder opened (as the app's shell does) */
const reveal = (path) => { try { spawn('open', ['-R', path], { stdio: 'ignore', detached: true }).unref(); } catch { /* */ } };

registerChatIpc(ipcMain, { trusted, projects, dataDir: DATA, reveal, tell: broadcast, log });

const prefsHome = process.env.OPENFILM_SHARED_HOME || join(homedir(), '.openfilm');
const mySkills = process.env.OPENFILM_SKILLS || (await import('openfilm/skills')).mySkillsDir();
let roster = null;
const localAgents = registerLocalAgentIpc(ipcMain, {
  trusted,
  log,
  binDir: installOpenfilmCommand(DATA, { env: { OPENFILM_HOME: STUDIO_HOME } }),
  env: { OPENFILM_HOME: STUDIO_HOME, OPENFILM_SHARED_HOME: prefsHome },
  harness: async (id) => roster?.harness(id) ?? null,
  logDir: () => (readPreferences(DATA).developer ? join(DATA, 'agent-logs') : null),
  skills: { dataDir: DATA, mine: mySkills, prefsHome },
});
registerSkillsIpc(ipcMain, {
  trusted, projects, dataDir: DATA, mine: mySkills, prefsHome, oldMine: join(STUDIO_HOME, 'skills'), reveal,
  pickFolder: async () => null, refreshSkills: (agent) => localAgents?.refreshSkills(agent), log,
});
/* an own key is kept as the app keeps one where there is no keychain */
const seal = (text) => Buffer.from(`raw:${text}`);
const unseal = (data) => Buffer.from(data).subarray(4).toString();
roster = createRoster({
  dataDir: DATA, localAgents: listAgents, localAgent, openSignIn: openAgentSignIn, openInstaller: openAgentInstaller,
  closeSessions: (id) => { forgetAgentUsage(id); localAgents?.closeAgent(id); },
  seal, unseal, onChange: (list) => broadcast('desktop:agents', list), usePaths: setChosenPaths,
  pickProgram: async () => null, checkProgram: checkAgentProgram, diagnose: (id) => diagnoseAgent(id, { appVersion: 'web' }),
});
const agentHandle = (channel, fn) => ipcMain.handle(channel, (_event, opts) => fn(opts ?? {}));
agentHandle('desktop:agents:list', () => { void roster.refresh(); return roster.list(); });
agentHandle('desktop:agents:connect', ({ id }) => roster.connect(String(id)));
agentHandle('desktop:agents:disconnect', ({ id }) => { roster.disconnect(String(id)); return { ok: true }; });
agentHandle('desktop:agents:usage', ({ id, fresh }) => agentUsage(String(id), { fresh: fresh === true }));
agentHandle('desktop:agents:locate', ({ id, words }) => roster.locate(String(id), words));
agentHandle('desktop:agents:automatic', ({ id }) => roster.useAutomatic(String(id)));
agentHandle('desktop:agents:install', ({ id }) => roster.install(String(id)));
agentHandle('desktop:agents:diagnose', ({ id }) => roster.diagnose(String(id)));
agentHandle('desktop:agents:shown', ({ id, shown }) => { roster.setShown(String(id), shown === true); return { ok: true }; });
agentHandle('desktop:agents:own-model', ({ config }) => roster.saveOwnModel(config));
agentHandle('desktop:agents:own-model-remove', ({ id }) => { roster.removeOwnModel(String(id)); return { ok: true }; });
agentHandle('desktop:agents:report', async () => '');
agentHandle('desktop:diagnostics:copy', async () => ({ ok: false }));
ipcMain.handle('desktop:hello', () => ({ flavor: 'web', version: 'web', ffmpeg: true, update: null, chatOpen: false, chatWidth: 400, chatMin: 340, studioMin: 640, fullScreen: false }));
ipcMain.handle('desktop:reveal', (_e, path) => { if (typeof path === 'string' && path) reveal(path); });
ipcMain.handle('desktop:pick-folder', () => null);
ipcMain.handle('desktop:capture', () => null);
ipcMain.handle('desktop:update-state', () => null);
ipcMain.handle('desktop:update-check', () => null);
ipcMain.handle('desktop:update-restart', () => ({ ok: false }));

/* ── HTTP ── */
const cors = (req) => ({ 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'origin' });
const body = (req) => new Promise((done, fail) => { let s = ''; req.setEncoding('utf8'); req.on('data', (c) => { s += c; if (s.length > 64 * 1024 * 1024) req.destroy(); }); req.on('end', () => done(s)); req.on('error', fail); });

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)).end(); return; }
  if (url.pathname === '/events') {
    res.writeHead(200, { ...cors(req), 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  const m = /^\/(ipc|send)\/(.+)$/.exec(url.pathname);
  if (!m || req.method !== 'POST') { res.writeHead(404, cors(req)).end(); return; }
  const channel = decodeURIComponent(m[2]);
  let args = [];
  try { args = decode(JSON.parse((await body(req)) || '{}').args ?? []); } catch { /* */ }
  if (m[1] === 'send') {
    try { listeners.get(channel)?.(event, ...args); } catch (e) { log(`${channel}: ${e?.message ?? e}`); }
    res.writeHead(204, cors(req)).end();
    return;
  }
  const fn = handlers.get(channel);
  const reply = (status, value) => { res.writeHead(status, { ...cors(req), 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (!fn) return reply(404, { ok: false, error: `no handler for ${channel}` });
  try { reply(200, { ok: true, value: encode(await fn(event, ...args)) ?? null }); }
  catch (e) { log(`${channel}: ${e?.stack ?? e}`); reply(200, { ok: false, error: e instanceof Error ? e.message : String(e) }); }
}).listen(PORT, '127.0.0.1', () => console.log(`chat host  http://127.0.0.1:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
if (!existsSync(join(STUDIO_HOME, 'run.json'))) log('Studio has not started yet: its projects are asked for when needed');
