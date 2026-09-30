import test from 'node:test';
import assert from 'node:assert/strict';
import { detailCrop, defaultSettings } from './imaging.js';

test('detail crop magnifies original pixels, follows the requested aspect, and stays within the subject', () => {
  const bitmap = { width: 4284, height: 5712 }, subject = [.1, .2, .9, .93];
  for (const ratio of [1, 3 / 4, 9 / 16, 4 / 3]) for (const x of [0, 50, 100]) for (const y of [0, 50, 100]) {
    const c = detailCrop(subject, bitmap, ratio, 1.8, x, y);
    assert.ok(c[0] >= subject[0] - 1e-12 && c[1] >= subject[1] - 1e-12);
    assert.ok(c[2] <= subject[2] + 1e-12 && c[3] <= subject[3] + 1e-12);
    assert.ok(Math.abs((c[2] - c[0]) * bitmap.width / ((c[3] - c[1]) * bitmap.height) - ratio) < 1e-9);
    assert.ok(c[2] - c[0] < subject[2] - subject[0], 'detail must not repeat the whole product');
  }
  const left = detailCrop(subject, bitmap, 1, 2, 0, 50), right = detailCrop(subject, bitmap, 1, 2, 100, 50);
  assert.ok(right[0] > left[0], 'horizontal detail control must move the actual crop');
});

test('default image settings preserve source lighting and orientation', () => {
  const s = defaultSettings(); assert.equal(s.brightness, 100); assert.equal(s.shadow, 0); assert.equal(s.rotation, 0);
});
