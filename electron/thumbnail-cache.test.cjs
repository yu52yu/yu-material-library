const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createThumbnailCache } = require('./thumbnail-cache.cjs');
test('reuses disk cache across instances, coalesces requests, invalidates changed files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-thumb-'));
  try {
    const source = path.join(root, 'source.png');
    await fs.writeFile(source, 'original');
    let calls = 0;
    const generate = async () => Buffer.from(`preview-${++calls}`);
    const get = createThumbnailCache(path.join(root, 'cache'), generate);
    const results = await Promise.all(Array.from({ length: 8 }, () => get(source)));
    assert.equal(calls, 1);
    assert.ok(results.every(bytes => bytes.toString() === 'preview-1'));
    await createThumbnailCache(path.join(root, 'cache'), generate)(source);
    assert.equal(calls, 1);
    await fs.writeFile(source, 'changed file');
    assert.equal((await get(source)).toString(), 'preview-2');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('bounds parallel generation and retries failed jobs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yu-thumb-'));
  try {
    let active = 0, peak = 0, fail = true;
    const get = createThumbnailCache(path.join(root, 'cache'), async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 10));
      active--;
      if (fail) { fail = false; throw new Error('codec failed'); }
      return Buffer.from('png');
    });
    const sources = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
      const source = path.join(root, `${i}.png`);
      await fs.writeFile(source, 'image'); return source;
    }));
    const results = await Promise.allSettled(sources.map(get));
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.ok(peak <= 2);
    for (const source of sources) assert.equal((await get(source)).toString(), 'png');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
