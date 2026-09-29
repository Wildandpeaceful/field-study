/* Exact Euclidean contour distances; shared by the preview and image exports. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AuraEngine = api;
})(globalThis, () => {
  'use strict';
  function distanceField(alpha, width, height) {
    const total = width * height;
    if (alpha.length !== total) throw new Error('Mask dimensions do not match.');
    if (!alpha.some(a => a >= 128)) return null;
    const distance = new Float32Array(total);
    const max = Math.max(width, height);
    const f = new Float64Array(max), d = new Float64Array(max);
    const v = new Int32Array(max), z = new Float64Array(max + 1);
    function transform(n) {
      let k = 0;
      v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let s;
        do {
          const p = v[k];
          s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * (q - p));
          if (s > z[k]) break;
          k--;
        } while (k >= 0);
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) ** 2 + f[v[k]];
      }
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) f[y] = alpha[y * width + x] >= 128 ? 0 : 1e12;
      transform(height);
      for (let y = 0; y < height; y++) distance[y * width + x] = d[y];
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) f[x] = distance[y * width + x];
      transform(width);
      for (let x = 0; x < width; x++) distance[y * width + x] = Math.sqrt(d[x]);
    }
    return { width, height, distance };
  }
  function random(x, y, seed) {
    let n = Math.imul(x + seed * 1013, 374761393) ^ Math.imul(y + 19, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  function sample(field, x, y) {
    const x0 = Math.max(0, Math.min(field.width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(field.height - 1, Math.floor(y)));
    const x1 = Math.min(field.width - 1, x0 + 1), y1 = Math.min(field.height - 1, y0 + 1);
    const tx = Math.max(0, x - x0), ty = Math.max(0, y - y0), a = field.distance;
    return (a[y0 * field.width + x0] * (1 - tx) + a[y0 * field.width + x1] * tx) * (1 - ty)
      + (a[y1 * field.width + x0] * (1 - tx) + a[y1 * field.width + x1] * tx) * ty;
  }
  function render(field, width, height, settings, logicalWidth) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    if (!field) return pixels;
    const unit = width / logicalWidth, fieldUnit = field.width / logicalWidth;
    const colors = settings.colors.map(hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)));
    const rough = settings.roughness / 100, half = settings.thickness / 2;
    const period = settings.spacing + settings.thickness, first = settings.gap + half;
    const maxDistance = first + period * (settings.count - 1) + half + rough * 7 + 2;
    // Rows/columns are precomputed so grain and roughness stay fixed while controls change.
    const wavesX = new Float32Array(width), wavesY = new Float32Array(height);
    for (let x = 0; x < width; x++) wavesX[x] = Math.sin(x / unit * 0.073 + settings.seed) * 1.7 + Math.sin(x / unit * 0.197) * 0.6;
    for (let y = 0; y < height; y++) wavesY[y] = Math.sin(y / unit * 0.061 + settings.seed * 2) * 1.6 + Math.cos(y / unit * 0.233) * 0.55;
    for (let y = 0; y < height; y++) {
      const fy = (y + 0.5) / height * field.height - 0.5;
      for (let x = 0; x < width; x++) {
        const distance = sample(field, (x + 0.5) / width * field.width - 0.5, fy) / fieldUnit;
        if (distance < 0.7 || distance > maxDistance) continue;
        const noise = random(Math.floor(x / unit), Math.floor(y / unit), settings.seed);
        const distorted = distance + rough * (wavesX[x] + wavesY[y] + (noise - 0.5) * 2.7);
        const ring = Math.round((distorted - first) / period);
        if (ring < 0 || ring >= settings.count) continue;
        let coverage = Math.max(0, Math.min(1, (half - Math.abs(distorted - first - ring * period)) * unit + 0.5));
        if (!coverage) continue;
        coverage *= 1 - rough * (noise < 0.055 ? 0.84 : noise * 0.28);
        const color = colors[settings.multicolor ? ring % colors.length : 0];
        const i = (y * width + x) * 4;
        pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = Math.round(255 * coverage);
      }
    }
    return pixels;
  }
  return { distanceField, render };
});
