(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $("#contourCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const WIDTH = 900;
  const HEIGHT = 1200;
  const SPLIT_Y = 600;
  const PHOTO_HEIGHT = HEIGHT - SPLIT_Y;

  const defaultTextTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, color: null, locked: false });

  const state = {
    textureImage: null,
    textureUrl: null,
    textureFile: null,
    maskImage: null,
    maskUrl: null,
    maskFile: null,
    maskSource: "upload",
    lucideIcon: null,
    fileBase: "contour-loom",
    gridSize: 31,
    sensitivity: 75,
    cleanup: 1,
    cellGap: 0.08,
    hollow: true,
    invert: false,
    cellShape: "square",
    textureMapping: "continuous",
    textureTone: "#7d745f",
    symmetry: "none",
    layout: "orbit",
    activeLayer: "motif",
    motif: { x: 0.5, y: 0.47, scale: 1 },
    photo: { x: 0.5, y: 0.5, scale: 1 },
    showDots: true,
    fieldColor: "#f5f3ee",
    textColor: "#171914",
    maskColor: "#f5f3ee",
    leftTitle: "Chromatic Field Study",
    leftNote: "a quiet geometry gathered from light",
    rightTitle: "Woven Contour Motif",
    rightNote: "Colorway: Moss · Ochre · Alabaster",
    textLayers: {
      left: defaultTextTransform(),
      right: defaultTextTransform(),
    },
    cells: [],
    bounds: null,
    outputWidth: 900,
    dragging: null,
    suggestionIndex: 0,
  };

  function showToast(message) {
    window.fieldStudyShell?.showToast(message);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeFileBase(name) {
    return (name || "contour-loom")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "contour-loom";
  }

  function fileMeta(file) {
    const size = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + " MB"
      : Math.max(1, Math.round(file.size / 1024)) + " KB";
    return size + " · " + (file.type.split("/")[1] || "IMAGE").toUpperCase();
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The image could not be decoded."));
      image.src = url;
    });
  }

  function validateFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Choose a JPG, PNG, or WebP image.");
      return false;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast("That image is larger than the 30 MB local limit.");
      return false;
    }
    return true;
  }

  function setStatus(kind, message) {
    $("#contourProcessStatus").className = "process-status" + (kind ? " " + kind : "");
    $("#contourProcessStatusText").textContent = message;
  }

  function updateReadyState() {
    $("#contourEmptyOverlay").hidden = Boolean(state.textureImage || state.maskImage);
    if (state.textureImage && state.maskImage && !state.cells.length) {
      setStatus("error", "No contour cells detected · raise sensitivity or invert the selection");
    } else if (state.textureImage && state.maskImage) {
      setStatus("ready", state.cells.length + " contour cells woven locally · ready to compose");
    } else if (state.textureImage) {
      setStatus("working", "Texture ready · add a contour image to build the motif");
    } else if (state.maskImage) {
      setStatus("working", "Contour ready · add a texture image to complete the composition");
    } else {
      setStatus("", "Waiting for texture and contour images");
    }
  }

  async function handleTextureFile(file) {
    if (!validateFile(file)) return;
    if (state.textureUrl) URL.revokeObjectURL(state.textureUrl);
    state.textureUrl = URL.createObjectURL(file);
    try {
      state.textureImage = await loadImage(state.textureUrl);
      state.textureFile = file;
      state.fileBase = safeFileBase(file.name);
      state.photo = { x: 0.5, y: 0.5, scale: 1 };
      state.textureTone = averageTextureColor();
      $("#contourTextureThumb").src = state.textureUrl;
      $("#contourTextureName").textContent = file.name;
      $("#contourTextureMeta").textContent = fileMeta(file);
      $("#contourTextureIdle").hidden = true;
      $("#contourTexturePreview").hidden = false;
      $("#contourTextureActions").hidden = false;
      if (document.body.dataset.activeTool === "contour") {
        $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
      }
      suggestCopy(false);
      updateReadyState();
      syncControls();
      render();
      showToast("Texture image added. Now add a contour source.");
    } catch (error) {
      state.textureImage = null;
      setStatus("error", error.message);
      showToast(error.message);
    }
  }

  async function handleMaskFile(file, options = {}) {
    if (!validateFile(file)) return false;
    if (state.maskUrl) URL.revokeObjectURL(state.maskUrl);
    state.maskUrl = URL.createObjectURL(file);
    try {
      state.maskImage = await loadImage(state.maskUrl);
      state.maskFile = file;
      state.maskSource = options.source || "upload";
      state.lucideIcon = options.icon || null;
      $("#contourMaskThumb").src = state.maskUrl;
      $("#contourMaskName").textContent = options.label || file.name;
      $("#contourMaskMeta").textContent = state.maskSource === "lucide"
        ? "LUCIDE ICON · LOCAL SVG"
        : fileMeta(file);
      $("#contourMaskIdle").hidden = true;
      $("#contourMaskPreview").hidden = false;
      $("#contourMaskActions").hidden = false;
      rebuildContour();
      suggestCopy(false);
      updateReadyState();
      syncControls();
      render();
      showToast(state.maskSource === "lucide"
        ? `${options.label || "Lucide icon"} translated into a contour.`
        : "Contour translated into a pixel matrix.");
      return true;
    } catch (error) {
      state.maskImage = null;
      setStatus("error", error.message);
      showToast(error.message);
      return false;
    }
  }

  async function useLucideIcon(icon) {
    if (!icon?.name || !icon?.file) throw new Error("Choose a valid Lucide icon.");
    const response = await fetch(`/vendor/lucide/${icon.file}`);
    if (!response.ok) throw new Error(`The ${icon.label || icon.name} icon could not be loaded.`);
    const svg = await response.text();
    const file = new File([svg], `${icon.name}.svg`, { type: "image/svg+xml" });
    const accepted = await handleMaskFile(file, {
      source: "lucide",
      icon: { name: icon.name, label: icon.label, file: icon.file },
      label: icon.label,
    });
    if (!accepted) throw new Error(`The ${icon.label || icon.name} icon could not be decoded.`);
    state.activeLayer = "motif";
    $("#contourPositionControls").open = true;
    syncControls();
  }

  function clearTexture() {
    if (state.textureUrl) URL.revokeObjectURL(state.textureUrl);
    state.textureImage = null;
    state.textureFile = null;
    state.textureUrl = null;
    state.fileBase = "contour-loom";
    $("#contourTextureInput").value = "";
    $("#contourTextureThumb").removeAttribute("src");
    $("#contourTextureIdle").hidden = false;
    $("#contourTexturePreview").hidden = true;
    $("#contourTextureActions").hidden = true;
    if (document.body.dataset.activeTool === "contour") $("#fileNameHeader").textContent = "CONTOUR LOOM";
    updateReadyState();
    syncControls();
    render();
    showToast("Texture image removed.");
  }

  function clearMask() {
    if (state.maskUrl) URL.revokeObjectURL(state.maskUrl);
    state.maskImage = null;
    state.maskFile = null;
    state.maskUrl = null;
    state.maskSource = "upload";
    state.lucideIcon = null;
    state.cells = [];
    state.bounds = null;
    $("#contourMaskInput").value = "";
    $("#contourMaskThumb").removeAttribute("src");
    $("#contourMaskIdle").hidden = false;
    $("#contourMaskPreview").hidden = true;
    $("#contourMaskActions").hidden = true;
    updateReadyState();
    syncControls();
    render();
    showToast("Contour image removed.");
  }

  function resetPhotoPosition(showMessage = true) {
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    if (state.activeLayer === "photo") syncControls();
    render();
    if (showMessage) showToast("Lower photo position reset.");
  }

  function resetMotifPosition(showMessage = true) {
    state.motif = { x: 0.5, y: 0.47, scale: 1 };
    if (state.activeLayer === "motif") syncControls();
    render();
    if (showMessage) showToast("Pixel motif position reset.");
  }

  function coverGeometry(imageWidth, imageHeight, boxWidth, boxHeight, positionX, positionY, scale) {
    const baseScale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    const width = imageWidth * baseScale * scale;
    const height = imageHeight * baseScale * scale;
    return {
      x: boxWidth * positionX - width / 2,
      y: boxHeight * positionY - height / 2,
      width,
      height,
    };
  }

  function averageTextureColor() {
    if (!state.textureImage) return "#7d745f";
    const sample = document.createElement("canvas");
    sample.width = 1;
    sample.height = 1;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(state.textureImage, 0, 0, 1, 1);
    const [red, green, blue] = sampleContext.getImageData(0, 0, 1, 1).data;
    return "#" + [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function buildPhotoLayer() {
    const layer = document.createElement("canvas");
    layer.width = WIDTH;
    layer.height = PHOTO_HEIGHT;
    const layerContext = layer.getContext("2d");
    layerContext.fillStyle = "#d7d7d0";
    layerContext.fillRect(0, 0, WIDTH, PHOTO_HEIGHT);
    if (!state.textureImage) return layer;
    const geometry = coverGeometry(
      state.textureImage.width,
      state.textureImage.height,
      WIDTH,
      PHOTO_HEIGHT,
      state.photo.x,
      state.photo.y,
      state.photo.scale
    );
    layerContext.imageSmoothingEnabled = true;
    layerContext.imageSmoothingQuality = "high";
    layerContext.drawImage(state.textureImage, geometry.x, geometry.y, geometry.width, geometry.height);
    return layer;
  }

  function containGeometry(imageWidth, imageHeight, boxSize) {
    const scale = Math.min(boxSize / imageWidth, boxSize / imageHeight) * 0.9;
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { x: (boxSize - width) / 2, y: (boxSize - height) / 2, width, height };
  }

  function sampledMask() {
    const n = state.gridSize;
    const sample = document.createElement("canvas");
    sample.width = n;
    sample.height = n;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.fillStyle = "#ffffff";
    sampleContext.fillRect(0, 0, n, n);
    if (!state.maskImage) return Array.from({ length: n }, () => Array(n).fill(false));
    const geometry = containGeometry(state.maskImage.width, state.maskImage.height, n);
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.drawImage(state.maskImage, geometry.x, geometry.y, geometry.width, geometry.height);
    const pixels = sampleContext.getImageData(0, 0, n, n).data;
    const cornerIndexes = [0, n - 1, n * (n - 1), n * n - 1];
    const background = cornerIndexes.reduce((sum, pixelIndex) => {
      const index = pixelIndex * 4;
      sum[0] += pixels[index];
      sum[1] += pixels[index + 1];
      sum[2] += pixels[index + 2];
      return sum;
    }, [0, 0, 0]).map((value) => value / cornerIndexes.length);
    const cutoff = 0.34 - state.sensitivity / 100 * 0.27;
    const matrix = Array.from({ length: n }, () => Array(n).fill(false));
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const index = (y * n + x) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const distance = Math.hypot(red - background[0], green - background[1], blue - background[2]) / 441.67;
        const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
        let selected = distance > cutoff || luminance < 0.16 + state.sensitivity / 100 * 0.3;
        if (state.invert) selected = !selected;
        matrix[y][x] = selected;
      }
    }
    return matrix;
  }

  function applySymmetry(matrix) {
    const n = matrix.length;
    if (state.symmetry === "none") return matrix;
    const result = matrix.map((row) => row.slice());
    const add = (x, y) => {
      if (x >= 0 && x < n && y >= 0 && y < n) result[y][x] = true;
    };
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (!matrix[y][x]) continue;
        if (state.symmetry === "horizontal" || state.symmetry === "quad") add(n - 1 - x, y);
        if (state.symmetry === "vertical" || state.symmetry === "quad") add(x, n - 1 - y);
        if (state.symmetry === "quad") add(n - 1 - x, n - 1 - y);
        if (state.symmetry === "kaleidoscope") {
          const cx = (n - 1) / 2;
          const dx = Math.round(x - cx);
          const dy = Math.round(y - cx);
          [[dx, dy], [-dx, dy], [dx, -dy], [-dx, -dy], [dy, dx], [-dy, dx], [dy, -dx], [-dy, -dx]]
            .forEach(([tx, ty]) => add(Math.round(cx + tx), Math.round(cx + ty)));
        }
      }
    }
    return result;
  }

  function cleanupMatrix(matrix) {
    let result = matrix.map((row) => row.slice());
    const n = result.length;
    for (let pass = 0; pass < state.cleanup; pass += 1) {
      const previous = result;
      result = previous.map((row, y) => row.map((selected, x) => {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < n && ny >= 0 && ny < n && previous[ny][nx]) neighbors += 1;
          }
        }
        if (selected) return neighbors >= 2;
        return neighbors >= 6;
      }));
    }
    return result;
  }

  function outlineMatrix(matrix) {
    if (!state.hollow) return matrix;
    const n = matrix.length;
    return matrix.map((row, y) => row.map((selected, x) => {
      if (!selected) return false;
      return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || nx >= n || ny < 0 || ny >= n || !matrix[ny][nx];
      });
    }));
  }

  function rebuildContour() {
    if (!state.maskImage) {
      state.cells = [];
      state.bounds = null;
      return;
    }
    const matrix = outlineMatrix(applySymmetry(cleanupMatrix(sampledMask())));
    const cells = [];
    for (let y = 0; y < matrix.length; y += 1) {
      for (let x = 0; x < matrix.length; x += 1) {
        if (matrix[y][x]) cells.push({ x, y });
      }
    }
    if (!cells.length) {
      state.cells = [];
      state.bounds = null;
      return;
    }
    const minX = Math.min(...cells.map((cell) => cell.x));
    const maxX = Math.max(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    const maxY = Math.max(...cells.map((cell) => cell.y));
    state.cells = cells;
    state.bounds = { minX, maxX, minY, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  function motifGeometry() {
    if (!state.bounds) return null;
    const targetSize = 300 * state.motif.scale;
    const cellSize = targetSize / Math.max(state.bounds.width, state.bounds.height);
    const width = state.bounds.width * cellSize;
    const height = state.bounds.height * cellSize;
    return {
      cellSize,
      x: state.motif.x * WIDTH - width / 2,
      y: state.motif.y * SPLIT_Y - height / 2,
      width,
      height,
    };
  }

  function traceCell(x, y, size) {
    ctx.beginPath();
    if (state.cellShape === "round") {
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    } else if (state.cellShape === "diamond") {
      ctx.moveTo(x + size / 2, y);
      ctx.lineTo(x + size, y + size / 2);
      ctx.lineTo(x + size / 2, y + size);
      ctx.lineTo(x, y + size / 2);
      ctx.closePath();
    } else {
      ctx.rect(x, y, size, size);
    }
  }

  function fillCell(x, y, size, color) {
    traceCell(x, y, size);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawMotif(photoLayer, lower = false) {
    const geometry = motifGeometry();
    if (!geometry || !state.cells.length) return;
    const gap = geometry.cellSize * state.cellGap;
    state.cells.forEach((cell) => {
      const localX = cell.x - state.bounds.minX;
      const localY = cell.y - state.bounds.minY;
      const x = geometry.x + localX * geometry.cellSize + gap / 2;
      const y = (lower ? SPLIT_Y : 0) + geometry.y + localY * geometry.cellSize + gap / 2;
      const size = Math.max(1, geometry.cellSize - gap);
      if (lower || !state.textureImage) {
        fillCell(x, y, size, lower ? state.maskColor : "#4b69ff");
        return;
      }
      if (state.textureMapping === "tonal") {
        fillCell(x, y, size, state.textureTone);
        return;
      }
      let sourceX = localX / Math.max(1, state.bounds.width - 1) * (WIDTH - 24);
      let sourceY = localY / Math.max(1, state.bounds.height - 1) * (PHOTO_HEIGHT - 24);
      if (state.textureMapping === "mosaic") {
        const hash = Math.abs(((cell.x + 17) * 73856093) ^ ((cell.y + 31) * 19349663));
        sourceX = hash % Math.max(1, WIDTH - 36);
        sourceY = Math.floor(hash / 997) % Math.max(1, PHOTO_HEIGHT - 36);
      }
      const sourceSizeX = Math.max(16, WIDTH / state.bounds.width * 1.8);
      const sourceSizeY = Math.max(16, PHOTO_HEIGHT / state.bounds.height * 1.8);
      ctx.save();
      traceCell(x, y, size);
      ctx.clip();
      ctx.drawImage(photoLayer, sourceX, sourceY, sourceSizeX, sourceSizeY, x, y, size, size);
      ctx.restore();
    });
  }

  function drawDotField() {
    if (!state.showDots) return;
    const rgb = hexToRgb(state.textColor);
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`;
    for (let y = 18; y < SPLIT_Y; y += 30) {
      for (let x = 18; x < WIDTH; x += 30) {
        ctx.beginPath();
        ctx.arc(x, y, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function hexToRgb(hex) {
    const value = hex.replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function fitText(text, maxWidth, weight, maxSize) {
    let size = maxSize;
    while (size > 11) {
      ctx.font = `${weight} ${size}px Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 1;
    }
    return size;
  }

  function drawCopyBlock(title, note, centerX, centerY, maxWidth, color) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    const titleSize = fitText(title, maxWidth, 750, 18);
    ctx.font = `750 ${titleSize}px Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(title, centerX, centerY - 12);
    const noteSize = fitText(note, maxWidth, 500, 16);
    ctx.font = `500 ${noteSize}px Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(note, centerX, centerY + 13);
  }

  function copyLayerBounds(id) {
    if (state.layout === "baseline") {
      return id === "left"
        ? { x: 45, y: SPLIT_Y - 82, width: 370, height: 64 }
        : { x: 485, y: SPLIT_Y - 82, width: 370, height: 64 };
    }
    return id === "left"
      ? { x: 38, y: 260, width: 240, height: 72 }
      : { x: 622, y: 260, width: 240, height: 72 };
  }

  function drawTextLayer(id, draw) {
    const transform = state.textLayers[id];
    const bounds = copyLayerBounds(id);
    const color = transform.color || state.textColor;
    window.editorialText.transformContext(ctx, bounds, transform, () => draw(color));
  }

  function drawCopy() {
    if (state.layout === "baseline") {
      drawTextLayer("left", (color) => drawCopyBlock(state.leftTitle, state.leftNote, 230, SPLIT_Y - 49, 370, color));
      drawTextLayer("right", (color) => drawCopyBlock(state.rightTitle, state.rightNote, 670, SPLIT_Y - 49, 370, color));
      return;
    }
    drawTextLayer("left", (color) => drawCopyBlock(state.leftTitle, state.leftNote, 158, 296, 230, color));
    drawTextLayer("right", (color) => drawCopyBlock(state.rightTitle, state.rightNote, 742, 296, 230, color));
  }

  function render() {
    const scale = state.outputWidth / WIDTH;
    const outputHeight = Math.round(state.outputWidth * 4 / 3);
    if (canvas.width !== state.outputWidth || canvas.height !== outputHeight) {
      canvas.width = state.outputWidth;
      canvas.height = outputHeight;
    }
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = state.fieldColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawDotField();
    const photoLayer = buildPhotoLayer();
    if (state.textureImage) ctx.drawImage(photoLayer, 0, SPLIT_Y);
    drawMotif(photoLayer, false);
    drawMotif(photoLayer, true);
    drawCopy();
    ctx.fillStyle = state.textColor;
    ctx.globalAlpha = 0.24;
    ctx.fillRect(0, SPLIT_Y - 1, WIDTH, 2);
    ctx.globalAlpha = 1;
    ctx.restore();
    window.editorialText?.refresh("contour");
  }

  function selectLayer(layer, openControls = false) {
    state.activeLayer = layer;
    $$('[data-contour-layer]').forEach((button) => {
      const selected = button.dataset.contourLayer === layer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (openControls) $("#contourPositionControls").open = true;
    syncControls();
  }

  function syncControls() {
    $("#contourGridSize").value = state.gridSize;
    $("#contourGridSizeOutput").textContent = state.gridSize + " × " + state.gridSize;
    $("#contourSensitivity").value = state.sensitivity;
    $("#contourSensitivityOutput").textContent = state.sensitivity;
    $("#contourCleanup").value = state.cleanup;
    $("#contourCleanupOutput").textContent = state.cleanup === 1 ? "1 pass" : state.cleanup + " passes";
    $("#contourCellGap").value = Math.round(state.cellGap * 100);
    $("#contourCellGapOutput").textContent = Math.round(state.cellGap * 100) + "%";
    $("#contourHollow").checked = state.hollow;
    $("#contourInvert").checked = state.invert;
    $("#contourShowDots").checked = state.showDots;
    $("#contourFieldColor").value = state.fieldColor;
    $("#contourFieldValue").textContent = state.fieldColor.toUpperCase();
    $("#contourTextColor").value = state.textColor;
    $("#contourTextValue").textContent = state.textColor.toUpperCase();
    $("#contourMaskColor").value = state.maskColor;
    $("#contourMaskValue").textContent = state.maskColor.toUpperCase();
    $("#contourLayerScale").value = Math.round(state[state.activeLayer].scale * 100);
    $("#contourLayerScaleOutput").textContent = Math.round(state[state.activeLayer].scale * 100) + "%";
    $("#contourExportSize").value = state.outputWidth;
    $("#contourCanvasDimensions").textContent = state.outputWidth + " × " + Math.round(state.outputWidth * 4 / 3) + " PX";
    $("#contourLayerStatus").textContent = state.activeLayer === "motif"
      ? "PIXEL MOTIF · " + state.cells.length + " CELLS"
      : "LOWER PHOTO ACTIVE";
    $$('[data-contour-symmetry]').forEach((button) => {
      const selected = button.dataset.contourSymmetry === state.symmetry;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$('[data-contour-layout]').forEach((button) => {
      const selected = button.dataset.contourLayout === state.layout;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
    $$('[data-contour-cell]').forEach((button) => {
      const selected = button.dataset.contourCell === state.cellShape;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$('[data-contour-texture]').forEach((button) => {
      const selected = button.dataset.contourTexture === state.textureMapping;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$('[data-contour-layer]').forEach((button) => {
      const selected = button.dataset.contourLayer === state.activeLayer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const iconMark = $("#contourIconSourceMark");
    const iconNote = $("#contourIconSourceNote");
    if (state.lucideIcon) {
      iconMark.src = `/vendor/lucide/${state.lucideIcon.file}`;
      iconNote.textContent = `${state.lucideIcon.label} selected · browse to replace`;
    } else {
      iconMark.src = "/vendor/lucide/icons/shapes.svg";
      iconNote.textContent = "Search 2,035 local icon shapes";
    }
  }

  function analyzeTexture() {
    if (!state.textureImage) return { mood: "Chromatic", family: "Moss · Ochre · Alabaster" };
    const sample = document.createElement("canvas");
    sample.width = 24;
    sample.height = 24;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.drawImage(state.textureImage, 0, 0, 24, 24);
    const pixels = sampleContext.getImageData(0, 0, 24, 24).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 24) {
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      count += 1;
    }
    red /= count;
    green /= count;
    blue /= count;
    if (blue > red * 1.08 && blue > green * 1.08) return { mood: "Ethereal Indigo", family: "Indigo · Azure · Alabaster" };
    if (green > red * 1.06) return { mood: "Verdant Interval", family: "Moss · Fern · Alabaster" };
    if (red > blue * 1.2) return { mood: "Ember Bloom", family: "Terracotta · Ochre · Alabaster" };
    return { mood: "Chromatic Field", family: "Slate · Ochre · Alabaster" };
  }

  function suggestCopy(showMessage = true) {
    const analysis = analyzeTexture();
    const density = state.cells.length / Math.max(1, state.gridSize * state.gridSize);
    const contourCharacter = density < 0.1 ? "Delicate" : density > 0.35 ? "Dense" : "Sculpted";
    const symmetryCharacter = state.symmetry === "kaleidoscope" ? "Kaleidoscopic" : state.symmetry === "none" ? contourCharacter : "Mirrored";
    const notes = [
      "a quiet geometry gathered from light",
      "a soft signal held inside the wider field",
      "small intervals woven through the afternoon",
      "a measured bloom translated into pixels",
    ];
    const motifs = [symmetryCharacter + " Contour Motif", contourCharacter + " Pixel Ornament", "Symmetric Field Motif", "Contour Study in Color"];
    state.leftTitle = analysis.mood + " Study";
    state.leftNote = notes[state.suggestionIndex % notes.length];
    state.rightTitle = motifs[state.suggestionIndex % motifs.length];
    state.rightNote = "Colorway: " + analysis.family;
    state.suggestionIndex += 1;
    syncCopyFields();
    render();
    if (showMessage) showToast("Both images analyzed locally · new labels ready.");
  }

  function syncCopyFields() {
    $("#contourLeftCopy").value = state.leftTitle + "\n" + state.leftNote;
    $("#contourRightCopy").value = state.rightTitle + "\n" + state.rightNote;
  }

  function parseCopyField(value) {
    const [title = "", ...noteLines] = value.split(/\n/);
    return { title: title.trim(), note: noteLines.join(" ").trim() };
  }

  function reset() {
    state.gridSize = 31;
    state.sensitivity = 75;
    state.cleanup = 1;
    state.cellGap = 0.08;
    state.hollow = true;
    state.invert = false;
    state.cellShape = "square";
    state.textureMapping = "continuous";
    state.symmetry = "none";
    state.layout = "orbit";
    state.activeLayer = "motif";
    state.motif = { x: 0.5, y: 0.47, scale: 1 };
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    state.showDots = true;
    state.fieldColor = "#f5f3ee";
    state.textColor = "#171914";
    state.maskColor = "#f5f3ee";
    state.leftTitle = "Chromatic Field Study";
    state.leftNote = "a quiet geometry gathered from light";
    state.rightTitle = "Woven Contour Motif";
    state.rightNote = "Colorway: Moss · Ochre · Alabaster";
    state.textLayers = { left: defaultTextTransform(), right: defaultTextTransform() };
    syncCopyFields();
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
    showToast("Contour Loom reset.");
  }

  function exportPng() {
    if (!state.textureImage || !state.maskImage) {
      showToast("Add both a texture and contour image before exporting.");
      return;
    }
    render();
    const height = Math.round(state.outputWidth * 4 / 3);
    const filename = state.fileBase + "-contour-loom-" + state.outputWidth + "x" + height + ".png";
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
    showToast("Contour Loom PNG exported.");
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * WIDTH,
      y: (event.clientY - rect.top) / rect.height * HEIGHT,
    };
  }

  function startDrag(event) {
    if (!state.textureImage && !state.maskImage) return;
    const layer = event.currentTarget.dataset.contourCanvasLayer;
    selectLayer(layer, true);
    state.dragging = { layer, point: canvasPoint(event), pointerId: event.pointerId, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    const deltaX = point.x - state.dragging.point.x;
    const deltaY = point.y - state.dragging.point.y;
    if (state.dragging.layer === "motif") {
      state.motif.x = clamp(state.motif.x + deltaX / WIDTH, -0.12, 1.12);
      state.motif.y = clamp(state.motif.y + deltaY / SPLIT_Y, -0.12, 1.12);
    } else {
      state.photo.x = clamp(state.photo.x + deltaX / WIDTH, -0.2, 1.2);
      state.photo.y = clamp(state.photo.y + deltaY / PHOTO_HEIGHT, -0.2, 1.2);
    }
    state.dragging.point = point;
    render();
  }

  function stopDrag(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    const target = state.dragging.target;
    state.dragging = null;
    target.releasePointerCapture?.(event.pointerId);
  }

  function wireDropZone(zone, input, handler) {
    input.addEventListener("change", () => handler(input.files?.[0]));
    ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove("dragover");
    }));
    zone.addEventListener("drop", (event) => handler(event.dataTransfer?.files?.[0]));
  }

  wireDropZone($("#contourTextureDropZone"), $("#contourTextureInput"), handleTextureFile);
  wireDropZone($("#contourMaskDropZone"), $("#contourMaskInput"), handleMaskFile);
  $("#contourEmptyChooseButton").addEventListener("click", () => $("#contourTextureInput").click());
  $("#contourResetPhoto").addEventListener("click", () => resetPhotoPosition());
  $("#contourResetMotif").addEventListener("click", () => resetMotifPosition());
  $("#contourClearTexture").addEventListener("click", clearTexture);
  $("#contourClearMask").addEventListener("click", clearMask);

  document.addEventListener("paste", (event) => {
    if (document.body.dataset.activeTool !== "contour") return;
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
    const file = imageItem?.getAsFile();
    if (!file) return;
    event.preventDefault();
    if (!state.textureImage || (state.textureImage && state.maskImage && state.activeLayer === "photo")) {
      handleTextureFile(file);
    } else {
      handleMaskFile(file);
    }
  });

  $("#contourGridSize").addEventListener("input", (event) => {
    state.gridSize = Number(event.target.value);
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  });
  $("#contourSensitivity").addEventListener("input", (event) => {
    state.sensitivity = Number(event.target.value);
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  });
  $("#contourCleanup").addEventListener("input", (event) => {
    state.cleanup = Number(event.target.value);
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  });
  $("#contourCellGap").addEventListener("input", (event) => {
    state.cellGap = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#contourHollow").addEventListener("change", (event) => {
    state.hollow = event.target.checked;
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  });
  $("#contourInvert").addEventListener("change", (event) => {
    state.invert = event.target.checked;
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  });
  $$('[data-contour-symmetry]').forEach((button) => button.addEventListener("click", () => {
    state.symmetry = button.dataset.contourSymmetry;
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
  }));
  $$('[data-contour-layout]').forEach((button) => button.addEventListener("click", () => {
    state.layout = button.dataset.contourLayout;
    syncControls();
    render();
  }));
  $$('[data-contour-cell]').forEach((button) => button.addEventListener("click", () => {
    state.cellShape = button.dataset.contourCell;
    syncControls();
    render();
  }));
  $$('[data-contour-texture]').forEach((button) => button.addEventListener("click", () => {
    state.textureMapping = button.dataset.contourTexture;
    syncControls();
    render();
  }));
  $$('[data-contour-layer]').forEach((button) => button.addEventListener("click", () => selectLayer(button.dataset.contourLayer)));
  $("#contourLayerScale").addEventListener("input", (event) => {
    state[state.activeLayer].scale = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#contourSuggestCopy").addEventListener("click", () => suggestCopy(true));
  $("#contourLeftCopy").addEventListener("input", (event) => {
    const copy = parseCopyField(event.target.value);
    state.leftTitle = copy.title;
    state.leftNote = copy.note;
    render();
  });
  $("#contourRightCopy").addEventListener("input", (event) => {
    const copy = parseCopyField(event.target.value);
    state.rightTitle = copy.title;
    state.rightNote = copy.note;
    render();
  });
  $("#contourShowDots").addEventListener("change", (event) => {
    state.showDots = event.target.checked;
    render();
  });
  [["#contourFieldColor", "fieldColor"], ["#contourTextColor", "textColor"], ["#contourMaskColor", "maskColor"]]
    .forEach(([selector, key]) => $(selector).addEventListener("input", (event) => {
      state[key] = event.target.value;
      syncControls();
      render();
    }));
  $("#contourExportSize").addEventListener("change", (event) => {
    state.outputWidth = Number(event.target.value);
    syncControls();
    render();
  });
  $("#contourRailExport").addEventListener("click", exportPng);

  $$('[data-contour-canvas-layer]').forEach((zone) => {
    zone.addEventListener("pointerdown", startDrag);
    zone.addEventListener("pointermove", moveDrag);
    zone.addEventListener("pointerup", stopDrag);
    zone.addEventListener("pointercancel", stopDrag);
    zone.addEventListener("click", () => selectLayer(zone.dataset.contourCanvasLayer, true));
  });

  function activate() {
    $("#fileNameHeader").textContent = state.textureImage
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "CONTOUR LOOM";
    updateReadyState();
    syncControls();
    render();
  }

  window.editorialText.register("contour", {
    canvas,
    shell: $("#contourArtboardShell"),
    panel: "#contourEditorialPanel",
    width: WIDTH,
    height: HEIGHT,
    getLayers: () => ["left", "right"].map((id) => ({
      id,
      label: id === "left" ? "Left editorial label" : "Right editorial label",
      bounds: copyLayerBounds(id),
      transform: state.textLayers[id],
      color: state.textLayers[id].color || state.textColor,
      enabled: true,
    })),
    updateLayer: (id, patch) => Object.assign(state.textLayers[id], patch),
    resetLayer: (id) => { state.textLayers[id] = defaultTextTransform(); },
    getAlignment: () => ({ x: WIDTH / 2, y: SPLIT_Y / 2, threshold: 12, region: { x: 0, y: 0, width: WIDTH, height: SPLIT_Y } }),
    render,
  });

  window.contourLoom = {
    activate,
    reset,
    exportPng,
    useLucideIcon,
    getCurrentLucideIcon: () => state.lucideIcon,
  };
  updateReadyState();
  syncControls();
  render();
})();
