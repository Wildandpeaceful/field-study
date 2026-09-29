const assert = require('node:assert/strict');
const { blur, frost } = require('../public/frost-engine.js');
const w = 41, h = 29;
const flat = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < flat.length; i += 4) flat.set([80, 120, 160, 255], i);
assert.deepEqual(blur(flat, w, h, 20), flat, 'Blur must preserve a uniform field, including its edges.');
assert.throws(() => blur(flat, 2, 2, 1));
assert.throws(() => blur(flat, w, h, -1));
const original = flat.slice();
const settings = { blur: 0, veil: 0, grain: 0, tint: '#ffffff', seed: 7 };
assert.deepEqual(frost(flat, w, h, settings), flat, 'All effects off must reproduce the photograph.');
const white = frost(flat, w, h, { ...settings, veil: 100 });
assert.ok(white.every(v => v === 255), 'Full white veil should be opaque white.');
const grain = frost(flat, w, h, { ...settings, grain: 50 });
assert.deepEqual(grain, frost(flat, w, h, { ...settings, grain: 50 }), 'Texture must not flicker between renders.');
assert.notDeepEqual(grain, frost(flat, w, h, { ...settings, grain: 50, seed: 8 }));
assert.deepEqual(flat, original, 'Source pixels must remain untouched.');
const edge = new Uint8ClampedArray(w * h * 4);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const i = (y * w + x) * 4;
  edge[i] = edge[i + 1] = edge[i + 2] = 255;
  edge[i + 3] = x < 20 ? 0 : 255;
}
const feather = blur(edge, w, h, 3);
const row = Array.from({ length: w }, (_, x) => feather[((h >> 1) * w + x) * 4 + 3]);
assert.equal(row[0], 0); assert.equal(row[w - 1], 255);
assert.ok(row.some(v => v > 0 && v < 255), 'Feathering should produce partial coverage.');
assert.ok(row.every((v, i) => !i || v >= row[i - 1]), 'A feathered straight edge must remain monotonic.');
console.log('Frosted Reveal: blur boundaries, no-effect identity, veil, seeded grain, source preservation, and mask feathering passed.');
