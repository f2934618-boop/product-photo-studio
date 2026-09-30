import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, defaultPlan, imagePrompt, generateImages } from './ai-api.js';

const fixture = { provider: 'openai', endpoint: 'https://images.example.test/v1/images/edits', model: 'image-model', key: 'not-a-real-key' };
test('credentials cannot go to a second analysis host or a URL query', () => {
  assert.throws(() => validateConfig({ ...fixture, analysisEndpoint: 'https://wrong.example.test/v1/chat/completions' }));
  assert.throws(() => validateConfig({ ...fixture, endpoint: fixture.endpoint + '?key=secret' }));
  assert.throws(() => validateConfig({ ...fixture, endpoint: 'http://images.example.test/v1/images/edits' }));
  assert.equal(validateConfig(fixture).model, fixture.model);
});
test('batch refinement is one independent composition per product; clothing has distinct suites', () => {
  assert.equal(defaultPlan('retouch', 8).split('\n').length, 1);
  assert.equal(defaultPlan('detail', 8).split('\n').length, 8);
  assert.match(defaultPlan('clothing', 4, 'basic'), /人台/);
  assert.match(defaultPlan('clothing', 4, 'model'), /成年模特/);
  assert.match(imagePrompt({ mode: 'style', index: 0, total: 4, references: true, productCount: 2, shot: 'cover', language: '无文字', platform: '通用', brief: '' }), /DESIGN reference only/);
});
test('multipart sends real source images and image dimensions, and accepts base64 output', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, fixture.endpoint); assert.equal(options.headers.Authorization, 'Bearer not-a-real-key');
    assert.equal(options.body.getAll('image[]').length, 2); assert.equal(options.body.get('size'), '1024x1536');
    assert.equal(options.body.get('n'), '1'); assert.equal(options.body.get('quality'), 'high');
    return new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgo=' }] }), { status: 200 });
  };
  try {
    const result = await generateImages(fixture, { images: [new Blob(['a'], { type: 'image/jpeg' }), new Blob(['b'], { type: 'image/png' })], prompt: 'Keep product', ratio: 'portrait', quality: 'high' }, new AbortController().signal);
    assert.equal(result.length, 1); assert.equal(result[0].type, 'image/png'); assert.equal(result[0].size, 8);
  } finally { globalThis.fetch = originalFetch; }
});
test('API errors redact the key and never count as generated images', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad not-a-real-key' } }), { status: 401 });
  try { await assert.rejects(generateImages(fixture, { images: [], prompt: 'x', ratio: 'square', quality: 'auto' }, new AbortController().signal), error => error.message.includes('401') && !error.message.includes(fixture.key)); }
  finally { globalThis.fetch = originalFetch; }
});
