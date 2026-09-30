import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MODEL_INFO, readResponse, modelBytes } from './model-loader.js';

test('truncated and oversized downloads are rejected instead of being used as model weights', async () => {
  await assert.rejects(readResponse(new Response(new Uint8Array(3)), { expected: 4 }), /下载中断/);
  await assert.rejects(readResponse(new Response(new Uint8Array(5)), { expected: 4 }), /大小不符/);
  const progress = [];
  assert.deepEqual(await readResponse(new Response(new Uint8Array([1, 2, 3, 4])), { expected: 4, onProgress: n => progress.push(n) }), new Uint8Array([1, 2, 3, 4]));
  assert.equal(progress.at(-1), 4);
});

test('retry reuses verified pieces, and damaged cached pieces are fetched again', async t => {
  const base = 'https://studio.test/project/', bytes = new Uint8Array(MODEL_INFO.u2netp.bytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const pieces = [], stores = new Map(), requests = [];
  for (let start = 0, n = 0; start < bytes.length; start += 2 * 1024 ** 2, n++) {
    const data = bytes.slice(start, start + 2 * 1024 ** 2), sha256 = createHash('sha256').update(data).digest('hex');
    pieces.push({ file: `u2netp.${n}.${sha256.slice(0, 12)}.bin`, bytes: data.length, sha256, data });
  }
  t.mock.method(globalThis, 'fetch', async url => {
    const href = String(url);
    if (href.includes('manifest.json')) return Response.json({ models: { u2netp: { bytes: bytes.length, parts: pieces.map(({ data, ...part }) => part) } } });
    const part = pieces.find(p => href.endsWith(p.file)); assert.ok(part, 'only declared same-origin model assets may be requested');
    requests.push(part.file);
    if (fail && part === pieces[1]) throw new Error('Simulated connection failure');
    return new Response(part.data);
  });
  const previousCaches = globalThis.caches;
  globalThis.caches = { open: async name => {
    if (!stores.has(name)) stores.set(name, new Map()); const store = stores.get(name);
    return { match: async key => store.get(String(key))?.clone(), put: async (key, response) => store.set(String(key), response.clone()), delete: async key => store.delete(String(key)) };
  } };
  t.after(() => { globalThis.caches = previousCaches; });
  let fail = true;
  await assert.rejects(modelBytes(base, 'u2netp'), /下载失败/);
  const cache = stores.get('product-studio-model-parts-v2'); assert.ok(cache.size >= 1, 'completed parts survive a failed request');
  const cachedNames = new Set([...cache.keys()].map(url => url.split('/').at(-1)));
  requests.length = 0; fail = false;
  assert.deepEqual(new Uint8Array(await modelBytes(base, 'u2netp')), bytes);
  assert.ok(requests.every(file => !cachedNames.has(file)), 'verified parts must not be downloaded again');
  requests.length = 0;
  const brokenURL = new URL(`models/${pieces[0].file}`, base).href;
  cache.set(brokenURL, new Response(new Uint8Array(pieces[0].bytes)));
  assert.deepEqual(new Uint8Array(await modelBytes(base, 'u2netp')), bytes);
  assert.deepEqual(requests, [pieces[0].file], 'only the corrupt part is replaced');
});
