(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $("#imageIndexCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  const fileInput = $("#imageIndexSourceInput");
  const dropZone = $("#imageIndexDropZone");
  let WIDTH = 900;
  let HEIGHT = 1200;
  const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
  const baseLayer = document.createElement("canvas");
  baseLayer.width = WIDTH;
  baseLayer.height = HEIGHT;
  const baseContext = baseLayer.getContext("2d", { alpha: false });

  const defaultSubject = () => ({ x: 0.5, y: 0.52, scale: 1 });
  const state = {
    sourceImage: null,
    foregroundImage: null,
    sourceUrl: null,
    file: null,
    fileBase: "image-index",
    alphaBounds: null,
    visionLabels: [],
    metrics: null,
    labels: ["SUBJECT", "ISOLATED", "FORM", "COLOR-STUDY", "SHARP-FOCUS", "OBJECT-INDEX"],
    subject: defaultSubject(),
    cellCount: 22,
    spread: 1,
    layout: "fragmented",
    smear: 0.72,
    windows: 0.42,
    smearDirection: "mixed",
    lineWeight: 1,
    fontSize: 18,
    background: "#ffffff",
    lineColor: "#747474",
    textColor: "#111111",
    palette: ["#ffffff", "#111111", "#747474"],
    paletteTarget: "background",
    subjectSelected: false,
    outputWidth: 900,
    seed: 11,
    labelIteration: 0,
    cells: [],
    dragging: null,
  };

  function showToast(message) {
    window.fieldStudyShell?.showToast(message);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeFileBase(name) {
    return (name || "image-index")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "image-index";
  }

  function formatFileMeta(file) {
    const size = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + " MB"
      : Math.max(1, Math.round(file.size / 1024)) + " KB";
    const type = (file.type.split("/")[1] || "IMAGE").toUpperCase();
    return size + " · " + type;
  }

  function setStatus(kind, message) {
    $("#imageIndexProcessStatus").className = "process-status" + (kind ? " " + kind : "");
    $("#imageIndexProcessStatusText").textContent = message;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image could not be decoded."));
      image.src = url;
    });
  }

  function seededRandom(seed) {
    let value = Math.abs(Math.trunc(seed)) % 2147483647 || 1;
    return () => {
      value = value * 16807 % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function normalizeLabel(value) {
    return String(value || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[_/]+/g, " ")
      .replace(/[^a-zA-Z0-9 -]+/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .toUpperCase()
      .slice(0, 28);
  }

  function uniqueLabels(values) {
    const seen = new Set();
    return values.map(normalizeLabel).filter((label) => {
      if (!label || label.length < 2 || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  }

  function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return { hue: 0, saturation: 0, lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return { hue: hue * 60, saturation, lightness };
  }

  function colorName(metrics) {
    if (metrics.saturation < 0.12) {
      if (metrics.lightness > 0.82) return "ALABASTER";
      if (metrics.lightness < 0.24) return "CHARCOAL";
      return "SLATE";
    }
    const hue = metrics.hue;
    if (hue < 15 || hue >= 345) return "RED";
    if (hue < 42) return "ORANGE";
    if (hue < 68) return "GOLD";
    if (hue < 155) return "GREEN";
    if (hue < 190) return "TEAL";
    if (hue < 250) return "BLUE";
    if (hue < 285) return "VIOLET";
    if (hue < 330) return "MAGENTA";
    return "CRIMSON";
  }

  function analyzeSource(image) {
    const sample = document.createElement("canvas");
    sample.width = 72;
    sample.height = 72;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(image, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 12) continue;
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      count += 1;
    }
    const average = {
      red: red / Math.max(1, count),
      green: green / Math.max(1, count),
      blue: blue / Math.max(1, count),
    };
    const hsl = rgbToHsl(average.red, average.green, average.blue);
    return {
      ...average,
      ...hsl,
      aspect: image.naturalWidth / Math.max(1, image.naturalHeight),
    };
  }

  function deriveLabels() {
    const visual = state.metrics || { hue: 0, saturation: 0.3, lightness: 0.6, aspect: 1 };
    const hueName = colorName(visual);
    const vision = state.visionLabels
      .flatMap((item) => String(item.identifier || item).split(/[,|/]/))
      .filter((item) => item.trim().length <= 34);
    const moodSets = [
      ["QUIET-FORM", "MEASURED-STUDY", "OBJECT-ARCHIVE"],
      ["GRAPHIC-PRESENCE", "VISUAL-TAXONOMY", "FIELD-NOTE"],
      ["SPECIMEN-STUDY", "SURFACE-DETAIL", "FORM-REGISTER"],
    ];
    const mood = moodSets[state.labelIteration % moodSets.length];
    const brightness = visual.lightness > 0.72 ? "HIGH-KEY" : visual.lightness < 0.34 ? "LOW-KEY" : "MID-TONE";
    const colorQuality = visual.saturation > 0.48 ? "VIVID-" + hueName : visual.saturation < 0.18 ? "MUTED-" + hueName : hueName + "-TONES";
    const orientation = visual.aspect > 1.15 ? "LANDSCAPE-FRAME" : visual.aspect < 0.82 ? "PORTRAIT-FRAME" : "SQUARE-FRAME";
    return uniqueLabels([
      ...vision,
      colorQuality,
      brightness,
      orientation,
      "ISOLATED-SUBJECT",
      "PURE-WHITE-FIELD",
      "ORGANIC-SHAPE",
      "SHARP-FOCUS",
      "LOCAL-VISION",
      "IMAGE-INDEX",
      ...mood,
    ]).slice(0, 36);
  }

  function setDerivedLabels(showMessage = false) {
    state.labels = deriveLabels();
    $("#imageIndexLabels").value = state.labels.join("\n");
    render();
    if (showMessage) showToast("Local labels rebuilt from the image.");
  }

  function findAlphaBounds(image) {
    const maxDimension = 900;
    const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const sample = document.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(image, 0, 0, width, height);
    const pixels = sampleContext.getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] < 16) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) {
      return { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
    }
    return {
      x: left / ratio,
      y: top / ratio,
      width: (right - left + 1) / ratio,
      height: (bottom - top + 1) / ratio,
    };
  }

  function makeCells() {
    const random = seededRandom(hashString(state.fileBase) + state.seed * 977);
    const satelliteCount = state.layout === "fragmented"
      ? clamp(Math.floor(state.cellCount / 6), 2, 6)
      : 0;
    const coreCount = Math.max(4, state.cellCount - satelliteCount);
    const rects = [{ x: 0, y: 0, width: 1, height: 1 }];
    while (rects.length < coreCount) {
      let splitIndex = 0;
      let largestScore = -1;
      rects.forEach((rect, index) => {
        const score = rect.width * rect.height * (0.85 + random() * 0.3);
        if (score > largestScore) {
          largestScore = score;
          splitIndex = index;
        }
      });
      const rect = rects.splice(splitIndex, 1)[0];
      const splitVertical = rect.width / Math.max(rect.height, 0.01) > 1.18
        ? true
        : rect.height / Math.max(rect.width, 0.01) > 1.35
          ? false
          : random() > 0.5;
      const split = 0.31 + random() * 0.38;
      if (splitVertical) {
        rects.push(
          { x: rect.x, y: rect.y, width: rect.width * split, height: rect.height },
          { x: rect.x + rect.width * split, y: rect.y, width: rect.width * (1 - split), height: rect.height },
        );
      } else {
        rects.push(
          { x: rect.x, y: rect.y, width: rect.width, height: rect.height * split },
          { x: rect.x, y: rect.y + rect.height * split, width: rect.width, height: rect.height * (1 - split) },
        );
      }
    }
    for (let index = 0; index < satelliteCount; index += 1) {
      const side = index % 4;
      const width = 0.17 + random() * 0.19;
      const height = 0.13 + random() * 0.2;
      let x = random() * 0.75;
      let y = random() * 0.78;
      if (side === 0) x = -width * (0.45 + random() * 0.45);
      if (side === 1) x = 1 - width * (0.25 + random() * 0.35);
      if (side === 2) y = -height * (0.45 + random() * 0.45);
      if (side === 3) y = 1 - height * (0.25 + random() * 0.35);
      rects.push({ x, y, width, height });
    }
    state.cells = rects.map((rect, index) => ({
      ...rect,
      modeValue: random(),
      direction: random() > 0.5 ? "horizontal" : "vertical",
      sample: 0.08 + random() * 0.84,
      labelIndex: index,
    }));
  }

  function subjectGeometry() {
    const bounds = state.alphaBounds || {
      x: 0,
      y: 0,
      width: state.foregroundImage?.naturalWidth || 1,
      height: state.foregroundImage?.naturalHeight || 1,
    };
    const fit = Math.min(WIDTH * 0.733 / Math.max(1, bounds.width), HEIGHT * 0.7 / Math.max(1, bounds.height));
    const width = bounds.width * fit * state.subject.scale;
    const height = bounds.height * fit * state.subject.scale;
    const centerX = state.subject.x * WIDTH;
    const centerY = state.subject.y * HEIGHT;
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      centerX,
      centerY,
      source: bounds,
    };
  }

  function gridFootprint(geometry) {
    const baseWidth = Math.max(WIDTH * 0.433, geometry.width + WIDTH * 0.15);
    const baseHeight = Math.max(HEIGHT * 0.358, geometry.height + HEIGHT * 0.121);
    const width = baseWidth * state.spread;
    const height = baseHeight * state.spread;
    return {
      x: geometry.centerX - width / 2,
      y: geometry.centerY - height / 2,
      width,
      height,
    };
  }

  function cellRect(cell, footprint) {
    return {
      x: footprint.x + cell.x * footprint.width,
      y: footprint.y + cell.y * footprint.height,
      width: cell.width * footprint.width,
      height: cell.height * footprint.height,
    };
  }

  function drawSubject(targetContext, geometry) {
    if (!state.foregroundImage) return;
    const source = geometry.source;
    targetContext.drawImage(
      state.foregroundImage,
      source.x,
      source.y,
      source.width,
      source.height,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
    );
  }

  function drawStretch(rect, cell, geometry) {
    const direction = state.smearDirection === "mixed" ? cell.direction : state.smearDirection;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.globalAlpha = 0.97;
    if (direction === "horizontal") {
      const sampleX = clamp(geometry.x + geometry.width * cell.sample, 0, WIDTH - 2);
      const sourceY = clamp(rect.y, 0, HEIGHT - 2);
      const sourceHeight = clamp(rect.height, 2, HEIGHT - sourceY);
      ctx.drawImage(baseLayer, sampleX, sourceY, 2, sourceHeight, rect.x, rect.y, rect.width, rect.height);
    } else {
      const sampleY = clamp(geometry.y + geometry.height * cell.sample, 0, HEIGHT - 2);
      const sourceX = clamp(rect.x, 0, WIDTH - 2);
      const sourceWidth = clamp(rect.width, 2, WIDTH - sourceX);
      ctx.drawImage(baseLayer, sourceX, sampleY, sourceWidth, 2, rect.x, rect.y, rect.width, rect.height);
    }
    ctx.restore();
  }

  function fitLabel(label, maxWidth, preferredSize) {
    let size = preferredSize;
    ctx.font = "700 " + size + "px ui-monospace, SFMono-Regular, Menlo, monospace";
    while (size > 8 && ctx.measureText(label).width > maxWidth) {
      size -= 1;
      ctx.font = "700 " + size + "px ui-monospace, SFMono-Regular, Menlo, monospace";
    }
    return size;
  }

  function drawCellLabel(rect, cell) {
    const label = state.labels[cell.labelIndex % Math.max(1, state.labels.length)] || "INDEX";
    if (rect.width < 34 || rect.height < 27) return;
    const padding = clamp(Math.min(rect.width, rect.height) * 0.055, 5, 11);
    const preferred = Math.min(state.fontSize, rect.height * 0.25);
    const size = fitLabel(label, Math.max(15, rect.width - padding * 2), preferred);
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillStyle = state.textColor;
    ctx.textBaseline = "top";
    ctx.font = "700 " + size + "px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText(label, rect.x + padding, rect.y + padding);
    if (rect.height > size + padding * 2 + 11) {
      const arrows = ["↓", "→", "↑", "←"];
      ctx.font = "500 " + Math.max(8, size * 0.72) + "px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(String(cell.labelIndex + 1) + arrows[cell.labelIndex % arrows.length], rect.x + padding, rect.y + padding + size + 4);
    }
    ctx.restore();
  }

  function render() {
    const logical = window.outputFormat.logicalDimensions();
    WIDTH = logical.width;
    HEIGHT = logical.height;
    const output = window.outputFormat.dimensions(state.outputWidth);
    const scale = output.width / WIDTH;
    if (canvas.width !== output.width || canvas.height !== output.height) {
      canvas.width = output.width;
      canvas.height = output.height;
    }
    if (baseLayer.width !== WIDTH || baseLayer.height !== HEIGHT) {
      baseLayer.width = WIDTH;
      baseLayer.height = HEIGHT;
    }
    window.outputFormat.applyShell($("#imageIndexArtboardShell"), false);
    $("#imageIndexCanvasDimensions").textContent = output.width + " × " + output.height + " PX";
    window.alignmentGuides?.update?.("index", WIDTH, HEIGHT);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (!state.foregroundImage) return;

    const geometry = subjectGeometry();
    baseContext.setTransform(1, 0, 0, 1, 0, 0);
    baseContext.fillStyle = state.background;
    baseContext.fillRect(0, 0, WIDTH, HEIGHT);
    drawSubject(baseContext, geometry);
    ctx.drawImage(baseLayer, 0, 0);

    const footprint = gridFootprint(geometry);
    state.cells.forEach((cell) => {
      const rect = cellRect(cell, footprint);
      if (cell.modeValue < state.windows) {
        // A clear index window keeps the isolated subject visible.
      } else if (cell.modeValue < state.windows + state.smear * (1 - state.windows)) {
        drawStretch(rect, cell, geometry);
      } else {
        ctx.fillStyle = state.background;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    });

    ctx.strokeStyle = state.lineColor;
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = state.lineWeight;
    state.cells.forEach((cell) => {
      const rect = cellRect(cell, footprint);
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    });
    ctx.globalAlpha = 1;
    state.cells.forEach((cell) => drawCellLabel(cellRect(cell, footprint), cell));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function syncControls() {
    $("#imageIndexSubjectScale").value = Math.round(state.subject.scale * 100);
    $("#imageIndexSubjectScaleOutput").textContent = Math.round(state.subject.scale * 100) + "%";
    $("#imageIndexSubjectX").value = Math.round(state.subject.x * 100);
    $("#imageIndexSubjectXOutput").textContent = Math.round(state.subject.x * 100) + "%";
    $("#imageIndexSubjectY").value = Math.round(state.subject.y * 100);
    $("#imageIndexSubjectYOutput").textContent = Math.round(state.subject.y * 100) + "%";
    $("#imageIndexCellCount").value = state.cellCount;
    $("#imageIndexCellCountOutput").textContent = String(state.cellCount);
    $("#imageIndexSpread").value = Math.round(state.spread * 100);
    $("#imageIndexSpreadOutput").textContent = Math.round(state.spread * 100) + "%";
    $("#imageIndexSmear").value = Math.round(state.smear * 100);
    $("#imageIndexSmearOutput").textContent = Math.round(state.smear * 100) + "%";
    $("#imageIndexWindows").value = Math.round(state.windows * 100);
    $("#imageIndexWindowsOutput").textContent = Math.round(state.windows * 100) + "%";
    $("#imageIndexSmearDirection").value = state.smearDirection;
    $("#imageIndexLineWeight").value = Math.round(state.lineWeight * 2);
    $("#imageIndexLineWeightOutput").textContent = state.lineWeight.toFixed(1) + " px";
    $("#imageIndexFontSize").value = state.fontSize;
    $("#imageIndexFontSizeOutput").textContent = state.fontSize + " px";
    [["#imageIndexBackground", "#imageIndexBackgroundOutput", state.background],
      ["#imageIndexLineColor", "#imageIndexLineColorOutput", state.lineColor],
      ["#imageIndexTextColor", "#imageIndexTextColorOutput", state.textColor]]
      .forEach(([input, output, value]) => {
        $(input).value = value;
        $(output).textContent = value.toUpperCase();
      });
    $$("[data-index-layout]").forEach((button) => {
      const selected = button.dataset.indexLayout === state.layout;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("#imageIndexPaletteTarget").value = state.paletteTarget;
    $("#imageIndexArtboardShell").classList.toggle("image-layer-selected", state.subjectSelected);
    $("#imageIndexLayerStatus").textContent = state.subjectSelected ? "SUBJECT INDEX ACTIVE" : "CLICK SUBJECT TO SELECT";
    renderProjectPalette();
  }

  function refreshProjectPalette(showMessage = false) {
    if (!state.sourceImage) {
      if (showMessage) showToast("Add an image to find its project colors.");
      return;
    }
    state.palette = window.projectPalette?.extract([state.sourceImage, state.foregroundImage], 10) || state.palette;
    renderProjectPalette();
    if (showMessage) showToast("Project colors refreshed from the image.");
  }

  function renderProjectPalette() {
    window.projectPalette?.render(
      $("#imageIndexPaletteSwatches"),
      state.palette,
      (color) => {
        state[state.paletteTarget] = color;
        syncControls();
        render();
      },
      state[state.paletteTarget]
    );
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
      showToast("Choose a JPG, PNG, WebP, or HEIC image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast("That image is larger than the 30 MB local limit.");
      return;
    }
    $("#imageIndexProcessingOverlay").hidden = false;
    $("#imageIndexEmptyOverlay").hidden = true;
    setStatus("working", "Isolating subject and building local labels…");
    try {
      const nextUrl = URL.createObjectURL(file);
      const sourceImage = await loadImage(nextUrl);
      const response = await fetch("/api/index", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!response.ok) {
        let message = "Apple Vision could not isolate the subject.";
        try {
          const error = await response.json();
          message = error.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      const analysis = await response.json();
      const foregroundImage = await loadImage(analysis.foreground);
      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = nextUrl;
      state.file = file;
      state.fileBase = safeFileBase(file.name);
      state.sourceImage = sourceImage;
      state.foregroundImage = foregroundImage;
      state.alphaBounds = findAlphaBounds(foregroundImage);
      state.visionLabels = Array.isArray(analysis.labels) ? analysis.labels : [];
      state.metrics = analyzeSource(sourceImage);
      state.palette = window.projectPalette?.extract([sourceImage, foregroundImage], 10) || state.palette;
      state.subject = defaultSubject();
      state.subjectSelected = true;
      state.labelIteration = 0;
      state.seed += 1;
      state.cells = [];
      makeCells();
      setDerivedLabels();
      $("#imageIndexSourceThumb").src = nextUrl;
      $("#imageIndexSourceName").textContent = file.name;
      $("#imageIndexSourceMeta").textContent = formatFileMeta(file);
      $("#imageIndexDropIdle").hidden = true;
      $("#imageIndexSourcePreview").hidden = false;
      $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
      $("#imageIndexEmptyOverlay").hidden = true;
      setStatus("ready", state.visionLabels.length
        ? "Subject isolated · " + state.visionLabels.length + " local visual cues found"
        : "Subject isolated · visual labels derived locally");
      syncControls();
      render();
      showToast("Image Index built locally. Drag the subject or reroll the grid.");
    } catch (error) {
      $("#imageIndexEmptyOverlay").hidden = Boolean(state.foregroundImage);
      setStatus("error", error.message);
      showToast(error.message);
    } finally {
      $("#imageIndexProcessingOverlay").hidden = true;
      fileInput.value = "";
    }
  }

  function resetSubject(showMessage = true) {
    state.subject = defaultSubject();
    state.subjectSelected = true;
    syncControls();
    render();
    if (showMessage) showToast("Image Index subject position reset.");
  }

  function reset() {
    state.subject = defaultSubject();
    state.cellCount = 22;
    state.spread = 1;
    state.layout = "fragmented";
    state.smear = 0.72;
    state.windows = 0.42;
    state.smearDirection = "mixed";
    state.lineWeight = 1;
    state.fontSize = 18;
    state.background = "#ffffff";
    state.lineColor = "#747474";
    state.textColor = "#111111";
    state.paletteTarget = "background";
    state.subjectSelected = false;
    state.seed = 11;
    state.labelIteration = 0;
    if (state.sourceImage) setDerivedLabels();
    makeCells();
    syncControls();
    render();
    showToast("Image Index composition reset.");
  }

  function exportPng() {
    if (!state.foregroundImage) {
      showToast("Add an image before exporting.");
      return;
    }
    render();
    const output = window.outputFormat.dimensions(state.outputWidth);
    const filename = state.fileBase + "-image-index-" + output.width + "x" + output.height + ".png";
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/export";
    form.target = "fieldStudyDownload";
    form.hidden = true;
    const imageField = document.createElement("input");
    imageField.type = "hidden";
    imageField.name = "image";
    imageField.value = canvas.toDataURL("image/png");
    const filenameField = document.createElement("input");
    filenameField.type = "hidden";
    filenameField.name = "filename";
    filenameField.value = filename;
    form.append(imageField, filenameField);
    document.body.appendChild(form);
    form.submit();
    requestAnimationFrame(() => form.remove());
    showToast("Image Index PNG exported.");
  }

  function exportJpeg() {
    if (!state.foregroundImage) {
      showToast("Add an image before exporting.");
      return;
    }
    window.outputFormat.exportSquareJpeg(canvas, {
      filename: `${state.fileBase}-image-index-3000x3000.jpg`,
      getShortEdge: () => state.outputWidth,
      setShortEdge: (width) => { state.outputWidth = width; },
      render,
    });
    showToast("Image Index 3000 × 3000 JPEG exported.");
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * WIDTH,
      y: (event.clientY - rect.top) / rect.height * HEIGHT,
    };
  }

  function startDrag(event) {
    if (!state.foregroundImage || event.button !== 0) return;
    const point = canvasPoint(event);
    const geometry = subjectGeometry();
    const hit = point.x >= geometry.x && point.x <= geometry.x + geometry.width && point.y >= geometry.y && point.y <= geometry.y + geometry.height;
    if (!hit) {
      state.subjectSelected = false;
      window.editorialText?.deselect("index");
      syncControls();
      render();
      return;
    }
    const wasSelected = state.subjectSelected;
    state.subjectSelected = true;
    $("details[aria-labelledby='imageIndexPositionHeading']")?.setAttribute("open", "");
    state.dragging = {
      pointerId: event.pointerId,
      offsetX: point.x - geometry.centerX,
      offsetY: point.y - geometry.centerY,
      wasSelected,
      moved: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("dragging");
  }

  function moveDrag(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    state.dragging.moved = true;
    const point = canvasPoint(event);
    let centerX = point.x - state.dragging.offsetX;
    let centerY = point.y - state.dragging.offsetY;
    const snapX = window.alignmentGuides?.snap(centerX, WIDTH / 2, 12) || { value: centerX, aligned: false };
    const snapY = window.alignmentGuides?.snap(centerY, HEIGHT / 2, 12) || { value: centerY, aligned: false };
    centerX = snapX.value;
    centerY = snapY.value;
    state.subject.x = clamp(centerX / WIDTH, -0.15, 1.15);
    state.subject.y = clamp(centerY / HEIGHT, -0.15, 1.15);
    window.alignmentGuides?.show("index", {
      vertical: snapX.aligned ? WIDTH / 2 : undefined,
      horizontal: snapY.aligned ? HEIGHT / 2 : undefined,
    });
    syncControls();
    render();
  }

  function stopDrag(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    const shouldDeselect = state.dragging.wasSelected && !state.dragging.moved;
    state.dragging = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.classList.remove("dragging");
    window.alignmentGuides?.hide("index");
    if (shouldDeselect) {
      state.subjectSelected = false;
      syncControls();
      render();
    }
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));
  $("#imageIndexEmptyChooseButton").addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  }));
  dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));
  $("#imageIndexSubjectScale").addEventListener("input", (event) => {
    state.subjectSelected = true;
    state.subject.scale = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#imageIndexSubjectX").addEventListener("input", (event) => {
    state.subjectSelected = true;
    state.subject.x = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#imageIndexSubjectY").addEventListener("input", (event) => {
    state.subjectSelected = true;
    state.subject.y = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#imageIndexResetSubject").addEventListener("click", () => resetSubject());
  $("#imageIndexResetDefaults").addEventListener("click", reset);
  $("#imageIndexRefreshPalette").addEventListener("click", () => refreshProjectPalette(true));
  $("#imageIndexPaletteTarget").addEventListener("change", (event) => {
    state.paletteTarget = event.target.value;
    renderProjectPalette();
  });
  $("#imageIndexCellCount").addEventListener("input", (event) => {
    state.cellCount = Number(event.target.value);
    makeCells();
    syncControls();
    render();
  });
  $("#imageIndexSpread").addEventListener("input", (event) => {
    state.spread = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $$("[data-index-layout]").forEach((button) => button.addEventListener("click", () => {
    state.layout = button.dataset.indexLayout;
    makeCells();
    syncControls();
    render();
  }));
  $("#imageIndexReroll").addEventListener("click", () => {
    if (!state.foregroundImage) {
      showToast("Add an image before rerolling its index.");
      return;
    }
    state.seed += 1;
    makeCells();
    render();
    showToast("A new index structure is ready.");
  });
  $("#imageIndexSmearDirection").addEventListener("change", (event) => {
    state.smearDirection = event.target.value;
    render();
  });
  $("#imageIndexSmear").addEventListener("input", (event) => {
    state.smear = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#imageIndexWindows").addEventListener("input", (event) => {
    state.windows = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#imageIndexLineWeight").addEventListener("input", (event) => {
    state.lineWeight = Number(event.target.value) / 2;
    syncControls();
    render();
  });
  $("#imageIndexRegenerateLabels").addEventListener("click", () => {
    if (!state.sourceImage) {
      showToast("Add an image before rebuilding its labels.");
      return;
    }
    state.labelIteration += 1;
    setDerivedLabels(true);
  });
  $("#imageIndexLabels").addEventListener("input", (event) => {
    state.labels = uniqueLabels(event.target.value.split(/\n+/));
    render();
  });
  $("#imageIndexFontSize").addEventListener("input", (event) => {
    state.fontSize = Number(event.target.value);
    syncControls();
    render();
  });
  [["#imageIndexBackground", "background"], ["#imageIndexLineColor", "lineColor"], ["#imageIndexTextColor", "textColor"]]
    .forEach(([selector, key]) => $(selector).addEventListener("input", (event) => {
      state[key] = event.target.value;
      syncControls();
      render();
    }));
  canvas.addEventListener("pointerdown", startDrag);
  canvas.addEventListener("pointermove", moveDrag);
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      state.subjectSelected = false;
      window.editorialText?.deselect("index");
      syncControls();
      render();
      return;
    }
    if (!state.foregroundImage || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") state.subject.x -= step / WIDTH;
    if (event.key === "ArrowRight") state.subject.x += step / WIDTH;
    if (event.key === "ArrowUp") state.subject.y -= step / HEIGHT;
    if (event.key === "ArrowDown") state.subject.y += step / HEIGHT;
    state.subject.x = clamp(state.subject.x, -0.15, 1.15);
    state.subject.y = clamp(state.subject.y, -0.15, 1.15);
    syncControls();
    render();
  });

  function activate() {
    $("#fileNameHeader").textContent = state.sourceImage
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "IMAGE INDEX";
    syncControls();
    render();
  }

  window.alignmentGuides?.register("index", $("#imageIndexArtboardShell"), WIDTH, HEIGHT);
  window.imageIndex = {
    activate,
    refreshFormat: render,
    reset,
    exportPng,
    exportJpeg,
    getExportOptions: () => ({
      canExport: Boolean(state.foregroundImage),
      motionAvailable: false,
      outputWidth: state.outputWidth,
      outputHeight: window.outputFormat.dimensions(state.outputWidth).height,
    }),
    setOutputWidth: (width) => {
      state.outputWidth = [900, 1350].includes(Number(width)) ? Number(width) : 900;
      render();
    },
  };
  makeCells();
  syncControls();
  render();
})();
