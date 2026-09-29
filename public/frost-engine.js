/* Deterministic, browser-independent frost texture and Gaussian box approximation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrostEngine = api;
})(globalThis, () => {
  'use strict';

  function blur(input, width, height, sigma) {
    if (input.length !== width * height * 4) throw new Error('Image dimensions do not match.');
    if (!Number.isFinite(sigma) || sigma < 0) throw new Error('Invalid blur radius.');
    const result = new Uint8ClampedArray(input);
    if (sigma < .3) return result;
    const scratch = new Uint8ClampedArray(input.length);
    let lower = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
    if (lower % 2 === 0) lower--;
    lower = Math.max(1, lower);
    const upper = lower + 2;
    const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
    for (let pass = 0; pass < 3; pass++) {
      const radius = ((pass < count ? lower : upper) - 1) / 2;
      if (!radius) continue;
      const divisor = radius * 2 + 1;
      // Clamp at the image boundary: frost must not introduce a dark frame.
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let channel = 0; channel < 4; channel++) {
          let sum = 0;
          for (let dx = -radius; dx <= radius; dx++) sum += result[(row + Math.max(0, Math.min(width - 1, dx))) * 4 + channel];
          for (let x = 0; x < width; x++) {
            scratch[(row + x) * 4 + channel] = sum / divisor;
            sum += result[(row + Math.min(width - 1, x + radius + 1)) * 4 + channel]
              - result[(row + Math.max(0, x - radius)) * 4 + channel];
          }
        }
      }
      for (let x = 0; x < width; x++) {
        for (let channel = 0; channel < 4; channel++) {
          let sum = 0;
          for (let dy = -radius; dy <= radius; dy++) sum += scratch[(Math.max(0, Math.min(height - 1, dy)) * width + x) * 4 + channel];
          for (let y = 0; y < height; y++) {
            result[(y * width + x) * 4 + channel] = sum / divisor;
            sum += scratch[(Math.min(height - 1, y + radius + 1) * width + x) * 4 + channel]
              - scratch[(Math.max(0, y - radius) * width + x) * 4 + channel];
          }
        }
      }
    }
    return result;
  }

  function noise(x, y, seed) {
    let n = Math.imul(x + seed * 1013, 374761393) ^ Math.imul(y + 19, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function frost(input, width, height, settings, unit = 1) {
    const output = blur(input, width, height, settings.blur * unit);
    const tint = [1, 3, 5].map(i => parseInt(settings.tint.slice(i, i + 2), 16));
    const veil = settings.veil / 100;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const grain = (noise(Math.floor(x / unit), Math.floor(y / unit), settings.seed) - .5) * settings.grain * .65;
        const i = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) output[i + c] = output[i + c] * (1 - veil) + tint[c] * veil + grain;
      }
    }
    return output;
  }
  return { blur, frost };
});
