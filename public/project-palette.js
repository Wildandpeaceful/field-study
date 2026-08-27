(() => {
  "use strict";

  const FALLBACK = ["#171914", "#f5f3ee", "#d6ff45", "#4b69ff", "#d24e3e", "#38b878", "#d9a441", "#8b6fb1"];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function sourceSize(source) {
    return {
      width: source?.videoWidth || source?.naturalWidth || source?.width || 0,
      height: source?.videoHeight || source?.naturalHeight || source?.height || 0,
    };
  }

  function srgbToLinear(value) {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }

  function rgbToOklab(red, green, blue) {
    const r = srgbToLinear(red);
    const g = srgbToLinear(green);
    const b = srgbToLinear(blue);
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const lRoot = Math.cbrt(l);
    const mRoot = Math.cbrt(m);
    const sRoot = Math.cbrt(s);
    return [
      0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
      1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
      0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
    ];
  }

  function perceptualDistance(left, right) {
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("");
  }

  function collectSamples(sources) {
    const histogram = new Map();
    sources.filter(Boolean).forEach((source) => {
      const dimensions = sourceSize(source);
      if (!dimensions.width || !dimensions.height) return;
      const sample = document.createElement("canvas");
      sample.width = 112;
      sample.height = 112;
      const context = sample.getContext("2d", { willReadFrequently: true });
      const scale = Math.max(sample.width / dimensions.width, sample.height / dimensions.height);
      const width = dimensions.width * scale;
      const height = dimensions.height * scale;
      try {
        context.drawImage(source, (sample.width - width) / 2, (sample.height - height) / 2, width, height);
      } catch (_) {
        return;
      }
      const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
      for (let index = 0; index < pixels.length; index += 12) {
        if (pixels[index + 3] < 120) continue;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const key = (red >> 3) + ":" + (green >> 3) + ":" + (blue >> 3);
        const existing = histogram.get(key) || { rgb: [0, 0, 0], count: 0 };
        existing.rgb[0] += red;
        existing.rgb[1] += green;
        existing.rgb[2] += blue;
        existing.count += 1;
        histogram.set(key, existing);
      }
    });
    return [...histogram.values()].map((entry) => {
      const rgb = entry.rgb.map((value) => value / entry.count);
      return { rgb, lab: rgbToOklab(...rgb), count: entry.count };
    });
  }

  function extract(sources, requestedCount = 8) {
    const samples = collectSamples(Array.isArray(sources) ? sources : [sources]);
    const count = clamp(Math.round(requestedCount), 3, 12);
    if (samples.length < count) return FALLBACK.slice(0, count);
    const byWeight = [...samples].sort((left, right) => right.count - left.count);
    const centers = [{ ...byWeight[0], rgb: [...byWeight[0].rgb], lab: [...byWeight[0].lab] }];
    while (centers.length < count) {
      const next = samples.reduce((best, sample) => {
        const distance = Math.min(...centers.map((center) => perceptualDistance(sample.lab, center.lab)));
        const chroma = Math.hypot(sample.lab[1], sample.lab[2]);
        const score = distance * distance * Math.sqrt(sample.count) * (1 + chroma * 1.8);
        return score > best.score ? { sample, score } : best;
      }, { sample: samples[centers.length], score: -1 }).sample;
      centers.push({ ...next, rgb: [...next.rgb], lab: [...next.lab] });
    }

    let assignments = [];
    for (let iteration = 0; iteration < 12; iteration += 1) {
      assignments = samples.map((sample) => {
        let nearest = 0;
        let distance = Infinity;
        centers.forEach((center, centerIndex) => {
          const nextDistance = perceptualDistance(sample.lab, center.lab);
          if (nextDistance < distance) {
            distance = nextDistance;
            nearest = centerIndex;
          }
        });
        return nearest;
      });
      centers.forEach((center, centerIndex) => {
        const members = samples.filter((_, sampleIndex) => assignments[sampleIndex] === centerIndex);
        if (!members.length) return;
        const total = members.reduce((sum, member) => sum + member.count, 0);
        center.rgb = [0, 1, 2].map((channel) =>
          members.reduce((sum, member) => sum + member.rgb[channel] * member.count, 0) / total
        );
        center.lab = rgbToOklab(...center.rgb);
      });
    }

    const ranked = centers.map((center, centerIndex) => {
      const population = samples.reduce((sum, sample, sampleIndex) =>
        sum + (assignments[sampleIndex] === centerIndex ? sample.count : 0), 0);
      const chroma = Math.hypot(center.lab[1], center.lab[2]);
      const lightnessBalance = 1 - Math.min(0.75, Math.abs(center.lab[0] - 0.56));
      return { ...center, score: population * (1 + chroma * 2.2) * lightnessBalance };
    }).sort((left, right) => right.score - left.score);

    const selected = [];
    ranked.forEach((candidate) => {
      if (selected.length >= count) return;
      if (selected.every((existing) => perceptualDistance(existing.lab, candidate.lab) > 0.045)) selected.push(candidate);
    });
    ranked.forEach((candidate) => {
      if (selected.length < count && !selected.includes(candidate)) selected.push(candidate);
    });
    return selected.slice(0, count).map((entry) => rgbToHex(entry.rgb));
  }

  function contrastText(hex) {
    const value = hex.replace("#", "");
    const rgb = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
    const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    return luminance > 0.62 ? "#171914" : "#ffffff";
  }

  function render(container, colors, onSelect, selected = "") {
    if (!container) return;
    container.replaceChildren(...colors.map((color) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "universal-swatch" + (selected.toLowerCase() === color.toLowerCase() ? " selected" : "");
      button.style.setProperty("--swatch-color", color);
      button.style.setProperty("--swatch-ink", contrastText(color));
      button.innerHTML = "<span>" + color.toUpperCase() + "</span>";
      button.title = "Apply " + color.toUpperCase();
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(selected.toLowerCase() === color.toLowerCase()));
      button.addEventListener("click", () => onSelect(color));
      return button;
    }));
  }

  window.projectPalette = { extract, render, fallback: [...FALLBACK] };
})();
