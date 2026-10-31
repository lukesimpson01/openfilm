import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { writeFrameFile } from './files.mjs';

const body = (text) => Readable.from([Buffer.from(text)]);

test('FRAME layer pages are written in place, again and again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frame-file-'));
  try {
    await writeFrameFile(root, 'frame/layer-a.html', body('one'));
    await writeFrameFile(root, 'frame/layer-a.html', body('two'));
    assert.equal(await readFile(join(root, 'frame/layer-a.html'), 'utf8'), 'two');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('only frame/ pages and scripts can be written that way', async () => {
  const root = await mkdtemp(join(tmpdir(), 'frame-file-'));
  try {
    for (const bad of ['film.html', 'frame/x.png', 'frame/sub/x.html', '../frame/x.html', 'frame/../film.html', 'assets/frame/x.js']) {
      await assert.rejects(() => writeFrameFile(root, bad, body('x')), undefined, bad);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
