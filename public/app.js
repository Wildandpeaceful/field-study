(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const canvas = $("#compositionCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const fileInput = $("#fileInput");
  const dropZone = $("#dropZone");
  const lowerFileInput = $("#lowerFileInput");
  const lowerDropZone = $("#lowerDropZone");
  const emptyOverlay = $("#emptyOverlay");
  const processingOverlay = $("#processingOverlay");
  const processStatus = $("#processStatus");
  const processStatusText = $("#processStatusText");
  const harmoniousSwatches = $("#harmoniousSwatches");
  const contrastSwatches = $("#contrastSwatches");
  const layerScale = $("#layerScale");
  const layerScaleOutput = $("#layerScaleOutput");
  const effectSize = $("#effectSize");
  const effectSizeOutput = $("#effectSizeOutput");
  const pixelColorSteps = $("#pixelColorSteps");
  const pixelColorStepsOutput = $("#pixelColorStepsOutput");
  const pixelContrast = $("#pixelContrast");
  const pixelContrastOutput = $("#pixelContrastOutput");
  const activeLayerLabel = $("#activeLayerLabel");
  const toast = $("#toast");
  const defaultTextTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, color: null, locked: false });

  const state = {
    sourceImage: null,
    foregroundImage: null,
    foregroundBounds: null,
    sourceUrl: null,
    foregroundUrl: null,
    lowerImage: null,
    lowerUrl: null,
    lowerFile: null,
    file: null,
    fileBase: "field-study",
    sourceMode: "linked",
    effect: "original",
    effectSize: 12,
    pixelColorSteps: 0,
    pixelContrast: 0,
    background: "#d6ff45",
    harmonious: ["#d6ff45", "#dce5d2", "#b7c9ff", "#f1e7d0", "#a6ae9b"],
    contrast: ["#4b45ff", "#ff5c45", "#8d4eff", "#14564d", "#181b17"],
    layout: "orbit",
    activeLayer: "subject",
    subject: { x: 0.5, y: 0.43, scale: 1 },
    photo: { x: 0.5, y: 0.5, scale: 1 },
    showSilhouette: true,
    showPhotoWords: false,
    photoWords: "Street Study · by Field Studio · Color Archive",
    photoWordTone: "auto",
    copy: {
      title: "A Study in Motion",
      note: "Form held briefly against the field",
      style: "Field Composition",
      credit: "Studio Archive",
    },
    textLayers: {
      left: defaultTextTransform(),
      right: defaultTextTransform(),
      center: defaultTextTransform(),
      rail: defaultTextTransform(),
    },
    outputWidth: 900,
    processing: false,
    uploadController: null,
  };

  let toastTimer = null;
  let dragging = null;

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("visible");
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function setProcessStatus(kind, message) {
    processStatus.className = `process-status${kind ? ` ${kind}` : ""}`;
    processStatusText.textContent = message;
  }

  function setLowerProcessStatus(kind, message) {
    const status = $("#lowerProcessStatus");
    status.className = `process-status${kind ? ` ${kind}` : ""}`;
    $("#lowerProcessStatusText").textContent = message;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image could not be displayed in this browser"));
      image.src = url;
    });
  }

  function fileLabel(file) {
    const size = file.size > 1024 * 1024
      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.size / 1024))} KB`;
    return `${size} · ${file.type.replace("image/", "").toUpperCase()}`;
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast("That image is larger than the 30 MB local limit.");
      return;
    }

    state.uploadController?.abort();
    state.uploadController = new AbortController();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.foregroundUrl) URL.revokeObjectURL(state.foregroundUrl);

    state.file = file;
    state.fileBase = (file.name.replace(/\.[^.]+$/, "") || "field-study")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "field-study";
    state.sourceUrl = URL.createObjectURL(file);
    state.foregroundUrl = null;
    state.foregroundImage = null;
    state.foregroundBounds = null;
    state.processing = true;

    $("#sourceThumb").src = state.sourceUrl;
    $("#sourceName").textContent = file.name;
    $("#sourceMeta").textContent = fileLabel(file);
    $("#sourcePreview").hidden = false;
    $("#dropIdle").hidden = true;
    $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
    emptyOverlay.hidden = true;
    processingOverlay.hidden = false;
    setProcessStatus("working", "Analyzing image and extracting subject");

    try {
      state.sourceImage = await loadImage(state.sourceUrl);
      state.harmonious = extractPalette(state.sourceImage, 5);
      state.contrast = buildContrastPalette(state.harmonious);
      state.background = selectStrongBackground(state.harmonious);
      $("#customColor").value = state.background;
      $("#colorValue").textContent = state.background.toUpperCase();
      renderSwatches();
      suggestCopyFromImage(false);

      const response = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
        signal: state.uploadController.signal,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Foreground extraction failed");
      }
      const foregroundBlob = await response.blob();
      state.foregroundUrl = URL.createObjectURL(foregroundBlob);
      state.foregroundImage = await loadImage(state.foregroundUrl);
      state.foregroundBounds = findAlphaBounds(state.foregroundImage);
      if (!state.foregroundBounds) throw new Error("No foreground subject was found");

      state.processing = false;
      processingOverlay.hidden = true;
      setProcessStatus("ready", "Foreground isolated locally · ready to compose");
      resetTransformsForLayout();
      syncControls();
      render();
      showToast("Foreground extracted. Drag the subject to compose.");
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error(error);
      state.processing = false;
      processingOverlay.hidden = true;
      syncControls();

      if (state.sourceImage) {
        state.foregroundImage = createFallbackForeground(state.sourceImage);
        state.foregroundBounds = findAlphaBounds(state.foregroundImage);
        const visionRuntimeUnavailable = /ANECF|inference plan|CVPixelBuffer|VisionCore/i.test(error.message);
        const statusMessage = visionRuntimeUnavailable
          ? "Apple Vision is unavailable in this launch · using a soft local fallback"
          : "Vision found no clear subject · using a soft local fallback";
        const toastMessage = visionRuntimeUnavailable
          ? "Apple Vision could not access its local model. Relaunch Field/Study normally for precise extraction."
          : "A precise subject was not found; a soft fallback was applied.";
        setProcessStatus("error", statusMessage);
        render();
        showToast(toastMessage);
      } else {
        emptyOverlay.hidden = false;
        setProcessStatus("error", error.message);
        showToast(error.message);
      }
    }
  }

  async function handleLowerFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Choose a JPG, PNG, or WebP image for the lower frame.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast("That lower-frame image is larger than the 30 MB local limit.");
      return;
    }

    if (state.lowerUrl) URL.revokeObjectURL(state.lowerUrl);
    state.lowerFile = file;
    state.lowerUrl = URL.createObjectURL(file);
    $("#lowerSourceThumb").src = state.lowerUrl;
    $("#lowerSourceName").textContent = file.name;
    $("#lowerSourceMeta").textContent = fileLabel(file);
    $("#lowerSourcePreview").hidden = false;
    $("#lowerDropIdle").hidden = true;
    setLowerProcessStatus("working", "Loading the independent lower frame");

    try {
      state.lowerImage = await loadImage(state.lowerUrl);
      state.photo = { x: 0.5, y: 0.5, scale: 1 };
      setLowerProcessStatus("ready", "Independent lower frame ready");
      syncControls();
      render();
      showToast("Lower-frame image added. Select Lower photo to reposition it.");
    } catch (error) {
      state.lowerImage = null;
      setLowerProcessStatus("error", error.message);
      showToast(error.message);
    }
  }

  function setSourceMode(mode) {
    state.sourceMode = mode;
    const separate = mode === "separate";
    $("#lowerSourceBlock").hidden = !separate;
    $("#sourceModeNote").textContent = separate
      ? "The subject and lower frame use independent photographs."
      : "One photograph drives the subject and lower frame.";
    if (separate) state.showSilhouette = false;
    syncControls();
    render();
  }

  async function swapSourceImages() {
    if (state.sourceMode !== "separate" || !state.file || !state.lowerFile || state.processing) {
      showToast("Add both source images before swapping their roles.");
      return;
    }
    const button = $("#swapSourceImages");
    const previousSubjectFile = state.file;
    const previousLowerFile = state.lowerFile;
    button.classList.add("working");
    button.disabled = true;
    setProcessStatus("working", "Swapping roles and extracting the new top subject");
    try {
      await handleFile(previousLowerFile);
      await handleLowerFile(previousSubjectFile);
      selectActiveLayer("subject", true);
      showToast("Images swapped. The new top subject has been extracted locally.");
    } finally {
      button.classList.remove("working");
      syncControls();
    }
  }

  function createFallbackForeground(image) {
    const maxDimension = 1200;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const work = document.createElement("canvas");
    work.width = Math.max(1, Math.round(image.naturalWidth * scale));
    work.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const wctx = work.getContext("2d");
    wctx.drawImage(image, 0, 0, work.width, work.height);
    const frame = wctx.getImageData(0, 0, work.width, work.height);
    const { data, width, height } = frame;

    const corners = [
      sampleAverage(data, width, height, 0, 0, 0.16, 0.16),
      sampleAverage(data, width, height, 0.84, 0, 0.16, 0.16),
      sampleAverage(data, width, height, 0, 0.84, 0.16, 0.16),
      sampleAverage(data, width, height, 0.84, 0.84, 0.16, 0.16),
    ];

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        let nearest = Infinity;
        for (const color of corners) {
          const dr = data[index] - color[0];
          const dg = data[index + 1] - color[1];
          const db = data[index + 2] - color[2];
          nearest = Math.min(nearest, Math.sqrt(dr * dr + dg * dg + db * db));
        }
        const nx = (x / width - 0.5) / 0.5;
        const ny = (y / height - 0.5) / 0.5;
        const centerBias = Math.max(0, 1 - Math.sqrt(nx * nx + ny * ny)) * 34;
        data[index + 3] = Math.round(clamp((nearest + centerBias - 34) / 62, 0, 1) * 255);
      }
    }
    wctx.putImageData(frame, 0, 0);
    return work;
  }

  function sampleAverage(data, width, height, nx, ny, nw, nh) {
    const startX = Math.floor(nx * width);
    const startY = Math.floor(ny * height);
    const endX = Math.min(width, Math.ceil((nx + nw) * width));
    const endY = Math.min(height, Math.ceil((ny + nh) * height));
    const sum = [0, 0, 0];
    let count = 0;
    for (let y = startY; y < endY; y += 4) {
      for (let x = startX; x < endX; x += 4) {
        const index = (y * width + x) * 4;
        sum[0] += data[index];
        sum[1] += data[index + 1];
        sum[2] += data[index + 2];
        count += 1;
      }
    }
    return sum.map((value) => value / Math.max(1, count));
  }

  function findAlphaBounds(image) {
    const scale = Math.min(1, 600 / Math.max(image.width, image.height));
    const check = document.createElement("canvas");
    check.width = Math.max(1, Math.round(image.width * scale));
    check.height = Math.max(1, Math.round(image.height * scale));
    const cctx = check.getContext("2d", { willReadFrequently: true });
    cctx.drawImage(image, 0, 0, check.width, check.height);
    const pixels = cctx.getImageData(0, 0, check.width, check.height).data;
    let minX = check.width;
    let minY = check.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < check.height; y += 1) {
      for (let x = 0; x < check.width; x += 1) {
        if (pixels[(y * check.width + x) * 4 + 3] > 18) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const inv = 1 / scale;
    const pad = 2 * inv;
    return {
      x: Math.max(0, minX * inv - pad),
      y: Math.max(0, minY * inv - pad),
      width: Math.min(image.width, (maxX - minX + 1) * inv + pad * 2),
      height: Math.min(image.height, (maxY - minY + 1) * inv + pad * 2),
    };
  }

  function extractPalette(image, colorCount) {
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 96;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    const cover = coverGeometry(image.width, image.height, 96, 96, 0.5, 0.5, 1);
    sctx.drawImage(image, cover.x, cover.y, cover.width, cover.height);
    const rgba = sctx.getImageData(0, 0, 96, 96).data;
    const samples = [];
    for (let i = 0; i < rgba.length; i += 16) {
      if (rgba[i + 3] < 180) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max > 248 && min > 245) continue;
      samples.push([r, g, b]);
    }
    if (samples.length < colorCount) return [...state.harmonious];

    const sorted = [...samples].sort((a, b) => luminance(a) - luminance(b));
    let centers = Array.from({ length: colorCount }, (_, index) =>
      [...sorted[Math.floor((index + 0.5) * sorted.length / colorCount)]]
    );
    let assignments = new Array(samples.length).fill(0);

    for (let iteration = 0; iteration < 10; iteration += 1) {
      assignments = samples.map((sampleColor) => nearestCenter(sampleColor, centers));
      centers = centers.map((center, centerIndex) => {
        const members = samples.filter((_, sampleIndex) => assignments[sampleIndex] === centerIndex);
        if (!members.length) return center;
        return [0, 1, 2].map((channel) =>
          members.reduce((sum, member) => sum + member[channel], 0) / members.length
        );
      });
    }

    const ranked = centers.map((center, index) => ({
      center,
      count: assignments.filter((assignment) => assignment === index).length,
      saturation: rgbToHsl(...center).s,
    })).sort((a, b) => (b.count + b.saturation * 260) - (a.count + a.saturation * 260));

    return ranked.map(({ center }) => rgbToHex(center.map(Math.round)));
  }

  function nearestCenter(color, centers) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = color.reduce((sum, value, channel) => sum + (value - center[channel]) ** 2, 0);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function buildContrastPalette(colors) {
    const offsets = [180, 150, 210, 120, 240];
    return colors.map((color, index) => {
      const { h, s, l } = hexToHsl(color);
      const contrastSaturation = clamp(Math.max(0.48, s * 1.08), 0, 0.9);
      const contrastLightness = l > 0.72 ? 0.34 : l < 0.24 ? 0.72 : 0.52;
      return hslToHex((h + offsets[index % offsets.length]) % 360, contrastSaturation, contrastLightness);
    });
  }

  function selectStrongBackground(colors) {
    return [...colors].sort((a, b) => {
      const ah = hexToHsl(a);
      const bh = hexToHsl(b);
      return (bh.s * (1 - Math.abs(bh.l - 0.55))) - (ah.s * (1 - Math.abs(ah.l - 0.55)));
    })[0];
  }

  function renderSwatches() {
    harmoniousSwatches.replaceChildren(...state.harmonious.map((color) => createSwatch(color, "Harmonious")));
    contrastSwatches.replaceChildren(...state.contrast.map((color) => createSwatch(color, "Contrast")));
  }

  function createSwatch(color, group) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `swatch${state.background.toLowerCase() === color.toLowerCase() ? " selected" : ""}`;
    button.style.setProperty("--swatch-color", color);
    button.title = `${group} color ${color.toUpperCase()}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", state.background.toLowerCase() === color.toLowerCase() ? "true" : "false");
    button.addEventListener("click", () => {
      state.background = color;
      $("#customColor").value = color;
      $("#colorValue").textContent = color.toUpperCase();
      renderSwatches();
      render();
    });
    return button;
  }

  function resetTransformsForLayout() {
    const positions = {
      orbit: { x: 0.5, y: 0.43 },
      baseline: { x: 0.5, y: 0.36 },
      editorial: { x: 0.34, y: 0.45 },
    };
    state.subject = { ...positions[state.layout], scale: 1 };
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    state.textLayers = {
      left: defaultTextTransform(),
      right: defaultTextTransform(),
      center: defaultTextTransform(),
      rail: defaultTextTransform(),
    };
    updateLayerScaleControl();
  }

  function resetComposition() {
    state.effect = "original";
    state.effectSize = 12;
    state.pixelColorSteps = 0;
    state.pixelContrast = 0;
    state.layout = "orbit";
    state.activeLayer = "subject";
    state.showSilhouette = state.sourceMode === "linked";
    state.showPhotoWords = false;
    state.photoWords = "Street Study · by Field Studio · Color Archive";
    state.photoWordTone = "auto";
    state.copy = {
      title: "A Study in Motion",
      note: "Form held briefly against the field",
      style: "Field Composition",
      credit: "Studio Archive",
    };
    if (state.sourceImage) {
      state.background = selectStrongBackground(state.harmonious);
      suggestCopyFromImage(false);
    } else {
      state.background = "#d6ff45";
    }
    resetTransformsForLayout();
    syncControls();
    renderSwatches();
    render();
    showToast("Composition reset.");
  }

  function syncControls() {
    $$('[data-source-mode]').forEach((button) => {
      const selected = button.dataset.sourceMode === state.sourceMode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$("[data-effect]").forEach((button) => {
      const selected = button.dataset.effect === state.effect;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$("[data-layout]").forEach((button) => {
      const selected = button.dataset.layout === state.layout;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    $$("[data-layer]").forEach((button) => {
      const selected = button.dataset.layer === state.activeLayer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    effectSize.value = state.effectSize;
    effectSizeOutput.textContent = state.effectSize;
    pixelColorSteps.value = state.pixelColorSteps;
    pixelColorStepsOutput.textContent = state.pixelColorSteps;
    pixelContrast.value = state.pixelContrast;
    pixelContrastOutput.textContent = state.pixelContrast > 0 ? `+${state.pixelContrast}%` : "0";
    $("#pixelControls").hidden = state.effect !== "pixel";
    const separateSources = state.sourceMode === "separate";
    $("#lowerSourceBlock").hidden = !separateSources;
    $("#sourceModeNote").textContent = separateSources
      ? "The subject and lower frame use independent photographs."
      : "One photograph drives the subject and lower frame.";
    $("#showSilhouette").checked = state.showSilhouette;
    $("#showSilhouette").disabled = separateSources;
    $("#silhouetteToggleRow").classList.toggle("disabled", separateSources);
    $("#silhouetteHint").textContent = separateSources
      ? "Available when one image drives both halves"
      : "Fill the subject in the lower photo";
    $("#showPhotoWords").checked = state.showPhotoWords;
    $("#photoWordFields").hidden = !state.showPhotoWords;
    $("#photoWordsInput").value = state.photoWords;
    $("#photoWordTone").value = state.photoWordTone;
    $("#titleInput").value = state.copy.title;
    $("#noteInput").value = state.copy.note;
    $("#styleInput").value = state.copy.style;
    $("#creditInput").value = state.copy.credit;
    $("#customColor").value = state.background;
    $("#colorValue").textContent = state.background.toUpperCase();
    activeLayerLabel.textContent = state.activeLayer === "subject"
      ? "TOP SUBJECT ACTIVE"
      : "LOWER PHOTO ACTIVE";
    updateLayerScaleControl();
  }

  function selectActiveLayer(layer, openControls = false) {
    if (layer !== "subject" && layer !== "photo") return;
    state.activeLayer = layer;
    if (openControls) $("#positionControls").open = true;
    syncControls();
  }

  function updateLayerScaleControl() {
    const layer = state[state.activeLayer];
    const percent = Math.round(layer.scale * 100);
    layerScale.value = percent;
    layerScaleOutput.textContent = `${percent}%`;
  }

  function suggestCopyFromImage(showMessage = true) {
    const paletteNames = state.harmonious.slice(0, 3).map(nearestColorName);
    const dominant = hexToHsl(state.background);
    const mood = dominant.l < 0.32 ? "After Dark" : dominant.s > 0.55 ? "High Color" : "Quiet Field";
    const subjects = ["Motion", "Pause", "Transit", "Distance", "Figure", "Interval"];
    const subjectWord = subjects[Math.abs(hashString(state.fileBase)) % subjects.length];
    state.copy.title = `${mood}: ${subjectWord}`;
    state.copy.note = `A study of ${subjectWord.toLowerCase()} held against an open field`;
    state.copy.style = dominant.s > 0.55 ? "Chromatic Field Study" : "Editorial Field Study";
    state.copy.credit = "Internal Studio Archive";
    state.photoWords = `${state.copy.title} · by ${state.copy.credit} · ${paletteLabel()}`;
    syncControls();
    render();
    if (showMessage) showToast(`Suggested from ${paletteNames.join(", ")}.`);
  }

  function render() {
    const logicalWidth = 900;
    const logicalHeight = 1200;
    const scale = state.outputWidth / logicalWidth;
    const expectedHeight = Math.round(state.outputWidth * 4 / 3);
    if (canvas.width !== state.outputWidth || canvas.height !== expectedHeight) {
      canvas.width = state.outputWidth;
      canvas.height = expectedHeight;
    }
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    ctx.fillStyle = "#f0efe8";
    ctx.fillRect(0, 0, logicalWidth, logicalHeight);

    if (!state.sourceImage || !state.foregroundImage) {
      ctx.restore();
      return;
    }

    const splitY = 632;
    const topRect = { x: 0, y: 0, width: logicalWidth, height: splitY };
    const bottomRect = { x: 0, y: splitY, width: logicalWidth, height: logicalHeight - splitY };
    ctx.fillStyle = state.background;
    ctx.fillRect(topRect.x, topRect.y, topRect.width, topRect.height);
    drawTopSubject(ctx, topRect);
    drawEditorialCopy(ctx, topRect);
    drawLowerPhoto(ctx, bottomRect);
    drawPhotoWordRail(ctx, bottomRect);
    ctx.fillStyle = contrastTextColor(state.background, 0.44);
    ctx.fillRect(0, splitY - 1, logicalWidth, 2);
    ctx.restore();
    window.editorialText?.refresh("foreground");
  }

  function subjectGeometry(topRect) {
    const bounds = state.foregroundBounds;
    const maxWidth = state.layout === "editorial" ? 350 : 330;
    const maxHeight = state.layout === "baseline" ? 405 : 365;
    const baseScale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
    const drawScale = baseScale * state.subject.scale;
    const width = bounds.width * drawScale;
    const height = bounds.height * drawScale;
    return {
      x: topRect.x + topRect.width * state.subject.x - width / 2,
      y: topRect.y + topRect.height * state.subject.y - height / 2,
      width,
      height,
      scale: drawScale,
    };
  }

  function drawTopSubject(target, topRect) {
    const bounds = state.foregroundBounds;
    const geometry = subjectGeometry(topRect);
    target.save();
    target.beginPath();
    target.rect(topRect.x, topRect.y, topRect.width, topRect.height);
    target.clip();

    if (state.effect === "original") {
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = "high";
      target.drawImage(
        state.foregroundImage,
        bounds.x, bounds.y, bounds.width, bounds.height,
        geometry.x, geometry.y, geometry.width, geometry.height
      );
    } else if (state.effect === "pixel") {
      drawPixelSubject(target, geometry, bounds);
    } else {
      drawHalftoneSubject(target, geometry, bounds);
    }
    target.restore();
  }

  function drawPixelSubject(target, geometry, bounds) {
    const block = state.effectSize;
    const pixelCanvas = document.createElement("canvas");
    pixelCanvas.width = Math.max(2, Math.ceil(geometry.width / block));
    pixelCanvas.height = Math.max(2, Math.ceil(geometry.height / block));
    const pctx = pixelCanvas.getContext("2d");
    pctx.imageSmoothingEnabled = true;
    pctx.drawImage(
      state.foregroundImage,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, pixelCanvas.width, pixelCanvas.height
    );
    if (state.pixelColorSteps > 0 || state.pixelContrast > 0) {
      const frame = pctx.getImageData(0, 0, pixelCanvas.width, pixelCanvas.height);
      const contrast = 1 + state.pixelContrast / 100;
      const steps = Math.max(2, state.pixelColorSteps);
      for (let index = 0; index < frame.data.length; index += 4) {
        if (frame.data[index + 3] < 8) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          let value = frame.data[index + channel];
          if (state.pixelContrast > 0) {
            value = clamp((value - 128) * contrast + 128, 0, 255);
          }
          if (state.pixelColorSteps > 0) {
            value = Math.round(value / 255 * (steps - 1)) * 255 / (steps - 1);
          }
          frame.data[index + channel] = value;
        }
      }
      pctx.putImageData(frame, 0, 0);
    }
    target.save();
    target.imageSmoothingEnabled = false;
    target.drawImage(pixelCanvas, geometry.x, geometry.y, geometry.width, geometry.height);
    target.restore();
  }

  function drawHalftoneSubject(target, geometry, bounds) {
    const sampleScale = Math.min(1, 520 / Math.max(geometry.width, geometry.height));
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = Math.max(2, Math.ceil(geometry.width * sampleScale));
    sampleCanvas.height = Math.max(2, Math.ceil(geometry.height * sampleScale));
    const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(
      state.foregroundImage,
      bounds.x, bounds.y, bounds.width, bounds.height,
      0, 0, sampleCanvas.width, sampleCanvas.height
    );
    const pixels = sctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    const step = state.effectSize;
    const sampleStep = Math.max(2, step * sampleScale);

    for (let sy = sampleStep / 2; sy < sampleCanvas.height; sy += sampleStep) {
      for (let sx = sampleStep / 2; sx < sampleCanvas.width; sx += sampleStep) {
        const px = clamp(Math.floor(sx), 0, sampleCanvas.width - 1);
        const py = clamp(Math.floor(sy), 0, sampleCanvas.height - 1);
        const index = (py * sampleCanvas.width + px) * 4;
        const alpha = pixels[index + 3] / 255;
        if (alpha < 0.12) continue;
        const radius = Math.max(1.2, step * 0.44 * Math.sqrt(alpha));
        const x = geometry.x + sx / sampleScale;
        const y = geometry.y + sy / sampleScale;
        target.beginPath();
        target.arc(x, y, radius, 0, Math.PI * 2);
        target.fillStyle = `rgba(${pixels[index]}, ${pixels[index + 1]}, ${pixels[index + 2]}, ${Math.min(1, alpha + 0.12)})`;
        target.fill();
      }
    }
  }

  function drawLowerPhoto(target, rect) {
    const image = state.sourceMode === "separate" && state.lowerImage
      ? state.lowerImage
      : state.sourceImage;
    const geometry = coverGeometry(
      image.width,
      image.height,
      rect.width,
      rect.height,
      state.photo.x,
      state.photo.y,
      state.photo.scale,
      rect.x,
      rect.y
    );
    target.save();
    target.beginPath();
    target.rect(rect.x, rect.y, rect.width, rect.height);
    target.clip();
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = "high";
    target.drawImage(image, geometry.x, geometry.y, geometry.width, geometry.height);

    if (state.showSilhouette && state.sourceMode === "linked") {
      const mask = document.createElement("canvas");
      mask.width = 900;
      mask.height = 1200;
      const mctx = mask.getContext("2d");
      mctx.drawImage(state.foregroundImage, geometry.x, geometry.y, geometry.width, geometry.height);
      mctx.globalCompositeOperation = "source-in";
      mctx.fillStyle = state.background;
      mctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      mctx.globalCompositeOperation = "source-over";
      target.drawImage(mask, 0, 0);
    }
    target.restore();
  }

  function drawPhotoWordRail(target, rect) {
    if (!state.showPhotoWords || !state.photoWords.trim()) return;
    const words = state.photoWords.trim().split(/\s+/).filter(Boolean).slice(0, 14);
    if (!words.length) return;

    const margin = 46;
    const availableWidth = rect.width - margin * 2;
    const fontSize = words.length > 11 ? 13 : words.length > 8 ? 15 : 17;
    const y = rect.y + 27;
    let fallbackColor;
    if (state.photoWordTone === "light") fallbackColor = "#ffffff";
    else if (state.photoWordTone === "dark") fallbackColor = "#171914";
    else fallbackColor = sampledBandTextColor(target, rect);
    const color = state.textLayers.rail.color || fallbackColor;
    const bounds = photoRailBounds(rect);

    window.editorialText.transformContext(target, bounds, state.textLayers.rail, () => {
      target.save();
      target.beginPath();
      target.rect(rect.x, rect.y, rect.width, rect.height);
      target.clip();
      target.fillStyle = color;
      target.font = `700 ${fontSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif`;
      target.textBaseline = "middle";
      target.shadowColor = color === "#ffffff" ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.24)";
      target.shadowBlur = 1.5;
      target.shadowOffsetY = 1;

      words.forEach((word, index) => {
        if (words.length === 1) {
          target.textAlign = "center";
          target.fillText(word, rect.x + rect.width / 2, y);
          return;
        }
        const x = rect.x + margin + availableWidth * index / (words.length - 1);
        target.textAlign = index === 0 ? "left" : index === words.length - 1 ? "right" : "center";
        target.fillText(word, x, y);
      });
      target.restore();
    });
  }

  function photoRailBounds(rect = { x: 0, y: 632, width: 900, height: 568 }) {
    return { x: rect.x + 36, y: rect.y + 7, width: rect.width - 72, height: 40 };
  }

  function sampledBandTextColor(target, rect) {
    try {
      const scale = target.getTransform().a || 1;
      const x = Math.max(0, Math.round((rect.x + 20) * scale));
      const y = Math.max(0, Math.round((rect.y + 8) * scale));
      const width = Math.min(target.canvas.width - x, Math.round((rect.width - 40) * scale));
      const height = Math.min(target.canvas.height - y, Math.max(1, Math.round(42 * scale)));
      const pixels = target.getImageData(x, y, width, height).data;
      let brightness = 0;
      let samples = 0;
      const stride = Math.max(4, Math.floor(pixels.length / 1200 / 4) * 4);
      for (let index = 0; index < pixels.length; index += stride) {
        brightness += pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
        samples += 1;
      }
      return brightness / Math.max(1, samples) > 148 ? "#171914" : "#ffffff";
    } catch {
      return "#ffffff";
    }
  }

  function copyLayerBounds(id, rect = { width: 900, height: 632 }) {
    if (state.layout === "orbit") {
      return id === "left"
        ? { x: 48, y: 272, width: 245, height: 92 }
        : { x: 607, y: 272, width: 245, height: 108 };
    }
    if (state.layout === "baseline") {
      if (id === "left") return { x: 38, y: rect.height - 92, width: 235, height: 82 };
      if (id === "center") return { x: 285, y: rect.height - 82, width: 330, height: 42 };
      return { x: 627, y: rect.height - 92, width: 235, height: 82 };
    }
    return id === "left"
      ? { x: 538, y: 164, width: 310, height: 160 }
      : { x: 538, y: 330, width: 330, height: 42 };
  }

  function drawForegroundTextLayer(target, id, rect, fallbackColor, draw) {
    const transform = state.textLayers[id];
    const color = transform.color || fallbackColor;
    window.editorialText.transformContext(target, copyLayerBounds(id, rect), transform, () => draw(color));
  }

  function drawEditorialCopy(target, rect) {
    const textColor = contrastTextColor(state.background);

    if (state.layout === "orbit") {
      drawForegroundTextLayer(target, "left", rect, textColor, (color) => {
        target.textBaseline = "top";
        drawCopyBlock(target, state.copy.title, state.copy.note, 58, 284, 235, "left", color);
      });
      drawForegroundTextLayer(target, "right", rect, textColor, (color) => {
        target.textBaseline = "top";
        drawCopyBlock(target, state.copy.style, `${state.copy.credit}\n${paletteLabel()}`, 842, 284, 235, "right", color);
      });
    } else if (state.layout === "baseline") {
      drawForegroundTextLayer(target, "left", rect, textColor, (color) => {
        target.textBaseline = "top";
        drawCopyBlock(target, state.copy.title, state.copy.credit, 48, rect.height - 81, 225, "left", color);
      });
      drawForegroundTextLayer(target, "center", rect, textColor, (color) => {
        target.textBaseline = "top";
        target.font = "600 14px ui-sans-serif, -apple-system, sans-serif";
        target.textAlign = "center";
        drawTrackingLine(target, state.copy.note.toUpperCase(), 450, rect.height - 62, 330, color);
      });
      drawForegroundTextLayer(target, "right", rect, textColor, (color) => {
        target.textBaseline = "top";
        drawCopyBlock(target, state.copy.style, paletteLabel(), 852, rect.height - 81, 225, "right", color);
      });
    } else {
      drawForegroundTextLayer(target, "left", rect, textColor, (color) => {
        target.fillStyle = color;
        target.textBaseline = "top";
        target.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        target.textAlign = "left";
        target.fillText("FIELD / 01", 548, 178);
        drawCopyBlock(target, state.copy.title, state.copy.note, 548, 218, 290, "left", color, 22);
      });
      drawForegroundTextLayer(target, "right", rect, textColor, (color) => {
        const baseAlpha = target.globalAlpha;
        target.fillStyle = color;
        target.globalAlpha = baseAlpha * 0.7;
        target.textBaseline = "top";
        target.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        target.textAlign = "left";
        target.fillText(`${state.copy.style.toUpperCase()} · ${paletteLabel()}`, 548, 350);
        target.globalAlpha = baseAlpha;
      });
    }
  }

  function drawCopyBlock(target, title, detail, x, y, width, align, color, titleSize = 17) {
    target.fillStyle = color;
    target.textAlign = align;
    target.font = `700 ${titleSize}px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif`;
    const titleLines = wrapText(target, title, width, 2);
    titleLines.forEach((line, index) => target.fillText(line, x, y + index * (titleSize + 3)));
    const titleHeight = titleLines.length * (titleSize + 3);
    const baseAlpha = target.globalAlpha;
    target.globalAlpha = baseAlpha * 0.72;
    target.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const detailLines = String(detail).split("\n").flatMap((line) => wrapText(target, line, width, 2));
    detailLines.forEach((line, index) => target.fillText(line, x, y + titleHeight + 9 + index * 15));
    target.globalAlpha = baseAlpha;
  }

  function drawTrackingLine(target, text, centerX, y, maxWidth, color) {
    const words = text.split(/\s+/).filter(Boolean).slice(0, 8);
    if (!words.length) return;
    target.fillStyle = color;
    const start = centerX - maxWidth / 2;
    const spacing = words.length === 1 ? 0 : maxWidth / (words.length - 1);
    words.forEach((word, index) => target.fillText(word, start + spacing * index, y));
  }

  function wrapText(target, text, maxWidth, maxLines = 3) {
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let current = words.shift();
    for (const word of words) {
      const candidate = `${current} ${word}`;
      if (target.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
        if (lines.length === maxLines - 1) break;
      }
    }
    if (lines.length < maxLines) lines.push(current);
    return lines;
  }

  function paletteLabel() {
    return state.harmonious.slice(0, 3).map(nearestColorName).join("—").toUpperCase();
  }

  function coverGeometry(imageWidth, imageHeight, boxWidth, boxHeight, positionX = 0.5, positionY = 0.5, zoom = 1, offsetX = 0, offsetY = 0) {
    const baseScale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    const scale = baseScale * zoom;
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      x: offsetX + boxWidth * positionX - width / 2,
      y: offsetY + boxHeight * positionY - height / 2,
      width,
      height,
    };
  }

  function contrastTextColor(color, threshold = 0.56) {
    const [r, g, b] = hexToRgb(color).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > threshold ? "#171914" : "#ffffff";
  }

  function nearestColorName(hex) {
    const names = [
      ["Ivory", [242, 238, 218]], ["Ebony", [29, 30, 26]], ["Slate", [91, 101, 108]],
      ["Azure", [43, 112, 196]], ["Cobalt", [35, 68, 174]], ["Sky", [125, 185, 224]],
      ["Forest", [45, 94, 61]], ["Emerald", [30, 145, 91]], ["Chartreuse", [190, 226, 63]],
      ["Ochre", [194, 144, 46]], ["Terracotta", [184, 81, 56]], ["Coral", [235, 98, 81]],
      ["Umber", [103, 71, 52]], ["Cream", [232, 218, 175]], ["Violet", [100, 71, 143]],
      ["Rose", [204, 98, 124]], ["Silver", [185, 189, 185]], ["Charcoal", [57, 60, 59]],
    ];
    const rgb = hexToRgb(hex);
    return names.reduce((best, item) => {
      const distance = rgb.reduce((sum, value, index) => sum + (value - item[1][index]) ** 2, 0);
      return distance < best.distance ? { name: item[0], distance } : best;
    }, { name: "Color", distance: Infinity }).name;
  }

  function hashString(value) {
    return [...value].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
  }

  function luminance(color) {
    return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
  }

  function rgbToHex(rgb) {
    return `#${rgb.map((channel) => clamp(channel, 0, 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    return [0, 2, 4].map((index) => parseInt(normalized.slice(index, index + 2), 16));
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: lightness };
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue;
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    return { h: hue * 60, s: saturation, l: lightness };
  }

  function hexToHsl(hex) {
    return rgbToHsl(...hexToRgb(hex));
  }

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return rgbToHex(rgb.map((value) => Math.round((value + m) * 255)));
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function exportPng() {
    if (!state.sourceImage || !state.foregroundImage) {
      showToast("Add a photograph before exporting.");
      return;
    }
    render();
    const filename = `${state.fileBase}-${state.effect}-${state.layout}-${state.outputWidth}x${Math.round(state.outputWidth * 4 / 3)}.png`;
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
    showToast("High-resolution PNG exported.");
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * 900,
      y: (event.clientY - rect.top) / rect.height * 1200,
    };
  }

  fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));
  lowerFileInput.addEventListener("change", () => handleLowerFile(lowerFileInput.files?.[0]));
  $("#emptyChooseButton").addEventListener("click", () => fileInput.click());

  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  }));
  dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));

  ["dragenter", "dragover"].forEach((eventName) => lowerDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    lowerDropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => lowerDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    lowerDropZone.classList.remove("dragover");
  }));
  lowerDropZone.addEventListener("drop", (event) => handleLowerFile(event.dataTransfer?.files?.[0]));

  $$('[data-source-mode]').forEach((button) => button.addEventListener("click", () => {
    setSourceMode(button.dataset.sourceMode);
  }));

  $$("[data-effect]").forEach((button) => button.addEventListener("click", () => {
    state.effect = button.dataset.effect;
    syncControls();
    render();
  }));

  $$("[data-layout]").forEach((button) => button.addEventListener("click", () => {
    state.layout = button.dataset.layout;
    resetTransformsForLayout();
    syncControls();
    render();
  }));

  $$("[data-layer]").forEach((button) => button.addEventListener("click", () => {
    selectActiveLayer(button.dataset.layer);
  }));

  effectSize.addEventListener("input", () => {
    state.effectSize = Number(effectSize.value);
    effectSizeOutput.textContent = state.effectSize;
    render();
  });

  pixelColorSteps.addEventListener("input", () => {
    state.pixelColorSteps = Number(pixelColorSteps.value);
    pixelColorStepsOutput.textContent = state.pixelColorSteps;
    render();
  });

  pixelContrast.addEventListener("input", () => {
    state.pixelContrast = Number(pixelContrast.value);
    pixelContrastOutput.textContent = state.pixelContrast > 0 ? `+${state.pixelContrast}%` : "0";
    render();
  });

  layerScale.addEventListener("input", () => {
    state[state.activeLayer].scale = Number(layerScale.value) / 100;
    layerScaleOutput.textContent = `${layerScale.value}%`;
    render();
  });

  $("#showSilhouette").addEventListener("change", (event) => {
    state.showSilhouette = event.target.checked;
    render();
  });

  $("#showPhotoWords").addEventListener("change", (event) => {
    state.showPhotoWords = event.target.checked;
    $("#photoWordFields").hidden = !state.showPhotoWords;
    render();
  });

  $("#photoWordsInput").addEventListener("input", (event) => {
    state.photoWords = event.target.value;
    render();
  });

  $("#photoWordTone").addEventListener("change", (event) => {
    state.photoWordTone = event.target.value;
    render();
  });

  $("#customColor").addEventListener("input", (event) => {
    state.background = event.target.value;
    $("#colorValue").textContent = state.background.toUpperCase();
    renderSwatches();
    render();
  });

  $("#refreshPalette").addEventListener("click", () => {
    if (!state.sourceImage) {
      showToast("Add an image to calculate its palette.");
      return;
    }
    state.harmonious = extractPalette(state.sourceImage, 5);
    state.contrast = buildContrastPalette(state.harmonious);
    state.background = selectStrongBackground(state.harmonious);
    renderSwatches();
    syncControls();
    render();
    showToast("Palette recalculated from the source image.");
  });

  $("#suggestCopy").addEventListener("click", () => {
    if (!state.sourceImage) {
      showToast("Add an image before suggesting copy.");
      return;
    }
    suggestCopyFromImage(true);
  });

  [
    ["#titleInput", "title"],
    ["#noteInput", "note"],
    ["#styleInput", "style"],
    ["#creditInput", "credit"],
  ].forEach(([selector, key]) => $(selector).addEventListener("input", (event) => {
    state.copy[key] = event.target.value;
    render();
  }));

  const startLayerDrag = (event) => {
    if (!state.sourceImage || state.processing) return;
    const point = canvasPoint(event);
    const layer = event.currentTarget.dataset.canvasLayer;
    selectActiveLayer(layer, true);
    dragging = { point, pointerId: event.pointerId, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveLayer = (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    const deltaX = point.x - dragging.point.x;
    const deltaY = point.y - dragging.point.y;
    if (state.activeLayer === "subject") {
      state.subject.x = clamp(state.subject.x + deltaX / 900, -0.1, 1.1);
      state.subject.y = clamp(state.subject.y + deltaY / 632, -0.15, 1.15);
    } else {
      state.photo.x = clamp(state.photo.x + deltaX / 900, -0.1, 1.1);
      state.photo.y = clamp(state.photo.y + deltaY / 568, -0.25, 1.25);
    }
    dragging.point = point;
    render();
  };

  const stopDragging = (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const captureTarget = dragging.target;
    dragging = null;
    captureTarget.releasePointerCapture?.(event.pointerId);
  };
  $$("[data-canvas-layer]").forEach((zone) => {
    zone.addEventListener("pointerdown", startLayerDrag);
    zone.addEventListener("pointermove", moveLayer);
    zone.addEventListener("pointerup", stopDragging);
    zone.addEventListener("pointercancel", stopDragging);
    zone.addEventListener("click", () => selectActiveLayer(zone.dataset.canvasLayer, true));
  });

  const foregroundExportController = {
    exportPng,
    getExportOptions: () => ({
      canExport: Boolean(state.sourceImage && state.foregroundImage),
      motionAvailable: false,
      outputWidth: state.outputWidth,
    }),
    setOutputWidth: (width) => {
      state.outputWidth = [900, 1350].includes(Number(width)) ? Number(width) : 900;
      $("#canvasDimensions").textContent = `${state.outputWidth} × ${Math.round(state.outputWidth * 4 / 3)} PX`;
      render();
    },
  };

  function activeExportController() {
    const activeTool = document.body.dataset.activeTool;
    if (activeTool === "poetic") return window.poeticFragments;
    if (activeTool === "contour") return window.contourLoom;
    return foregroundExportController;
  }

  function syncExportDialog() {
    const activeTool = document.body.dataset.activeTool || "foreground";
    const labels = {
      foreground: "Foreground Study",
      poetic: "Poetic Fragments",
      contour: "Contour Loom",
    };
    const controller = activeExportController();
    const options = controller?.getExportOptions?.() || { canExport: false, motionAvailable: false, outputWidth: 900 };
    const motionAvailable = Boolean(options.motionAvailable);
    const clipDuration = Math.max(3, Math.min(60, Number(options.clipDuration) || 10));
    const formatLabel = options.format?.label || "browser-native video";
    $("#exportDialogTool").textContent = labels[activeTool];
    $("#exportDialogSize").value = String(options.outputWidth || 900);
    $("#exportImageChoice").disabled = !options.canExport || Boolean(options.recording);
    $("#exportImageChoice small").textContent = `PNG · ${options.outputWidth || 900} × ${Math.round((options.outputWidth || 900) * 4 / 3)} · current frame`;
    $("#animatedExportControls").hidden = !motionAvailable;
    $("#animatedExport").hidden = !motionAvailable;
    $("#animatedClipDuration").value = clipDuration;
    $("#animatedClipDurationOutput").textContent = `${clipDuration}s`;
    const motionChoice = $("#animatedExport");
    motionChoice.disabled = !motionAvailable || Boolean(options.recording);
    $("strong", motionChoice).textContent = options.recording
      ? "Recording video"
      : `Export ${clipDuration}s video`;
    $("#animatedExportFormat").textContent = `Records locally as ${formatLabel} · ${options.audioEnabled ? "sound on" : "silent"} · current playhead`;
    $("#exportDialogNote").textContent = !options.canExport
      ? "Add the required source media before exporting."
      : motionAvailable
        ? options.audioEnabled
          ? "Choose a current-frame image or a moving export with the enabled video sound."
          : options.soundAvailable
            ? "Choose a current-frame image or a silent moving export. Turn on the video sound control to include audio."
            : "Choose a current-frame image or a silent moving export."
        : "This composition is ready to export as an image.";
  }

  function openExportDialog() {
    const dialog = $("#exportDialog");
    syncExportDialog();
    if (!dialog.open) dialog.showModal();
    $("#exportImageChoice").focus();
  }

  function activateTool(tool) {
    const availableTools = new Set(["foreground", "poetic", "contour"]);
    const nextTool = availableTools.has(tool) ? tool : "foreground";
    const previousTool = document.body.dataset.activeTool;
    if (previousTool !== nextTool && previousTool === "poetic") window.poeticFragments?.deactivate?.();
    document.body.dataset.activeTool = nextTool;
    window.editorialText?.activate(nextTool);
    $$("[data-tool-view]").forEach((view) => {
      view.hidden = view.dataset.toolView !== nextTool;
    });
    $$("[data-tool-switch]").forEach((button) => {
      const selected = button.dataset.toolSwitch === nextTool;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (nextTool === "poetic") {
      document.title = "Poetic Fragments — Field/Study";
      window.poeticFragments?.activate();
    } else if (nextTool === "contour") {
      document.title = "Contour Loom — Field/Study";
      window.contourLoom?.activate();
    } else {
      document.title = "Foreground Study — Field/Study";
      $("#fileNameHeader").textContent = state.sourceImage
        ? state.fileBase.replace(/-/g, " ").toUpperCase()
        : "UNTITLED STUDY";
      render();
    }
  }

  $$("[data-tool-switch]").forEach((button) => {
    button.addEventListener("click", () => activateTool(button.dataset.toolSwitch));
  });

  $("#resetButton").addEventListener("click", () => {
    const activeTool = document.body.dataset.activeTool;
    if (activeTool === "poetic") window.poeticFragments?.reset();
    else if (activeTool === "contour") window.contourLoom?.reset();
    else resetComposition();
  });
  $("#exportButton").addEventListener("click", openExportDialog);
  $("#exportDialogClose").addEventListener("click", () => $("#exportDialog").close());
  $("#exportDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  $("#exportDialogSize").addEventListener("change", (event) => {
    activeExportController()?.setOutputWidth?.(event.target.value);
    syncExportDialog();
  });
  $("#exportImageChoice").addEventListener("click", () => {
    const controller = activeExportController();
    $("#exportDialog").close();
    controller?.exportPng?.();
  });
  $("#animatedClipDuration").addEventListener("input", (event) => {
    activeExportController()?.setClipDuration?.(event.target.value);
    syncExportDialog();
  });
  $("#animatedExport").addEventListener("click", () => {
    const controller = activeExportController();
    $("#exportDialog").close();
    controller?.exportAnimated?.();
  });

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
      event.preventDefault();
      openExportDialog();
    }
  });

  window.fieldStudyShell = { activateTool, showToast };
  window.foregroundStudy = foregroundExportController;

  window.editorialText.register("foreground", {
    canvas,
    shell: $("#artboardShell"),
    panel: "#foregroundEditorialPanel",
    width: 900,
    height: 1200,
    getLayers: () => {
      const textColor = contrastTextColor(state.background);
      const layers = [
        { id: "left", label: "Primary editorial text", bounds: copyLayerBounds("left"), enabled: Boolean(state.sourceImage) },
        { id: "right", label: "Secondary editorial text", bounds: copyLayerBounds("right"), enabled: Boolean(state.sourceImage) },
        { id: "center", label: "Center tracking line", bounds: copyLayerBounds("center"), enabled: Boolean(state.sourceImage && state.layout === "baseline") },
        { id: "rail", label: "Photo word rail", bounds: photoRailBounds(), enabled: Boolean(state.sourceImage && state.showPhotoWords) },
      ];
      return layers.map((layer) => ({
        ...layer,
        transform: state.textLayers[layer.id],
        color: state.textLayers[layer.id].color || (layer.id === "rail" && state.photoWordTone === "dark" ? "#171914" : layer.id === "rail" ? "#ffffff" : textColor),
      }));
    },
    updateLayer: (id, patch) => Object.assign(state.textLayers[id], patch),
    resetLayer: (id) => { state.textLayers[id] = defaultTextTransform(); },
    getAlignment: (layer) => layer.id === "rail"
      ? { x: 450, y: 916, threshold: 12, region: { x: 0, y: 632, width: 900, height: 568 } }
      : { x: 450, y: 316, threshold: 12, region: { x: 0, y: 0, width: 900, height: 632 } },
    render,
  });

  renderSwatches();
  syncControls();
  render();
  activateTool("foreground");
})();
