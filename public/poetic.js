(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $("#poeticCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const fileInput = $("#poeticSourceInput");
  const dropZone = $("#poeticDropZone");
  const WIDTH = 900;
  const HEIGHT = 1200;
  const SPLIT_Y = 520;
  const PHOTO_HEIGHT = HEIGHT - SPLIT_Y;

  const state = {
    image: null,
    sourceUrl: null,
    file: null,
    fileBase: "poetic-fragments",
    caption: "Small windows of color gather inside the quiet architecture of an afternoon.",
    fragmentCount: 7,
    fragmentScale: 1,
    fragments: [],
    placement: "locked",
    fontFamily: "sans",
    bracketStyle: "round",
    fontSize: 36,
    background: "#efeee9",
    textColor: "#171914",
    photo: { x: 0.5, y: 0.5, scale: 1 },
    outputWidth: 900,
    seed: 4,
    dragging: null,
    activeFragment: -1,
  };

  function showToast(message) {
    window.fieldStudyShell?.showToast(message);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("The photograph could not be decoded."));
      image.src = url;
    });
  }

  function safeFileBase(name) {
    return (name || "poetic-fragments")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "poetic-fragments";
  }

  function setStatus(kind, message) {
    $("#poeticProcessStatus").className = "process-status" + (kind ? " " + kind : "");
    $("#poeticProcessStatusText").textContent = message;
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Choose a JPG, PNG, or WebP photograph.");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      showToast("That photograph is larger than 30 MB.");
      return;
    }
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.sourceUrl = URL.createObjectURL(file);
    try {
      state.image = await loadImage(state.sourceUrl);
      state.file = file;
      state.fileBase = safeFileBase(file.name);
      state.photo = { x: 0.5, y: 0.5, scale: 1 };
      state.activeFragment = -1;
      $("#poeticSourceThumb").src = state.sourceUrl;
      $("#poeticSourceName").textContent = file.name;
      $("#poeticSourceMeta").textContent = Math.round(file.size / 1024) + " KB · " + file.type.split("/")[1].toUpperCase();
      $("#poeticDropIdle").hidden = true;
      $("#poeticSourcePreview").hidden = false;
      $("#poeticEmptyOverlay").hidden = true;
      if (document.body.dataset.activeTool === "poetic") {
        $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
      }
      setStatus("success", "Crop windows ready · drag them directly on the artwork");
      suggestCaption(false);
      generateFragments();
      syncControls();
      render();
    } catch (error) {
      state.image = null;
      setStatus("error", error.message);
      showToast(error.message);
    }
  }

  function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ result >>> 15, result | 1);
      result ^= result + Math.imul(result ^ result >>> 7, result | 61);
      return ((result ^ result >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashString(value) {
    return [...value].reduce((hash, character) => ((hash << 5) - hash + character.charCodeAt(0)) | 0, 0);
  }

  function makeFragment(index) {
    const random = seededRandom(Math.abs(hashString(state.fileBase)) + state.seed * 977 + index * 131);
    const portrait = index % 3 === 1;
    const baseWidth = portrait ? 0.055 + random() * 0.035 : 0.075 + random() * 0.075;
    const baseHeight = portrait ? 0.105 + random() * 0.055 : 0.075 + random() * 0.07;
    return {
      x: 0.06 + random() * (0.88 - baseWidth),
      y: 0.05 + random() * (0.88 - baseHeight),
      baseWidth,
      baseHeight,
    };
  }

  function ensureFragments() {
    if (state.fragments.length > state.fragmentCount) {
      state.fragments = state.fragments.slice(0, state.fragmentCount);
    }
    while (state.fragments.length < state.fragmentCount) {
      state.fragments.push(makeFragment(state.fragments.length));
    }
  }

  function generateFragments() {
    state.seed += 1;
    state.fragments = Array.from({ length: state.fragmentCount }, (_, index) => makeFragment(index));
    state.activeFragment = -1;
  }

  function fragmentRect(fragment) {
    const width = clamp(fragment.baseWidth * state.fragmentScale, 0.035, 0.24);
    const height = clamp(fragment.baseHeight * state.fragmentScale, 0.045, 0.25);
    return {
      x: clamp(fragment.x, 0, 1 - width) * WIDTH,
      y: clamp(fragment.y, 0, 1 - height) * PHOTO_HEIGHT,
      width: width * WIDTH,
      height: height * PHOTO_HEIGHT,
    };
  }

  function analyzeImage() {
    const sample = document.createElement("canvas");
    sample.width = 48;
    sample.height = 48;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    const cover = coverGeometry(state.image.width, state.image.height, 48, 48, 0.5, 0.5, 1);
    sampleContext.drawImage(state.image, cover.x, cover.y, cover.width, cover.height);
    const pixels = sampleContext.getImageData(0, 0, 48, 48).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 32) {
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      count += 1;
    }
    red /= count;
    green /= count;
    blue /= count;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    let family = "silver";
    if (max - min > 20) {
      if (blue >= red && blue >= green) family = "indigo";
      else if (green >= red && green >= blue) family = "verdant";
      else if (red > green * 1.12) family = "ember";
      else family = "amber";
    }
    const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    return { family, light: luminance > 0.62 };
  }

  function suggestCaption(showMessage = true) {
    const descriptor = state.image ? analyzeImage() : { family: "silver", light: true };
    const templates = [
      "Small windows of color gather like signals against the " + descriptor.family + " field of a passing hour.",
      "Fragments of " + descriptor.family + " light drift through the quiet architecture of an afternoon.",
      "The image remembers itself in pieces, each one holding a different kind of weather.",
      "Bright intervals surface between the words and disappear again into the wider scene.",
      "A loose constellation of details crosses the stillness of the " + descriptor.family + " frame.",
    ];
    const index = Math.abs(hashString(state.fileBase + "-" + state.seed)) % templates.length;
    state.caption = templates[index];
    $("#poeticCaptionInput").value = state.caption;
    if (state.placement === "random" && state.image) generateFragments();
    render();
    if (showMessage) showToast("A new local caption variation is ready.");
  }

  function fontFamily() {
    if (state.fontFamily === "serif") return 'Georgia, "Times New Roman", serif';
    if (state.fontFamily === "mono") return 'ui-monospace, SFMono-Regular, Menlo, monospace';
    return 'Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
  }

  function bracketCharacters() {
    if (state.bracketStyle === "square") return ["[", "]"];
    if (state.bracketStyle === "none") return ["", ""];
    return ["(", ")"];
  }

  function coverGeometry(imageWidth, imageHeight, boxWidth, boxHeight, positionX, positionY, scale) {
    const baseScale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
    const width = imageWidth * baseScale * scale;
    const height = imageHeight * baseScale * scale;
    const overflowX = Math.max(0, width - boxWidth);
    const overflowY = Math.max(0, height - boxHeight);
    return {
      x: -overflowX * positionX,
      y: -overflowY * positionY,
      width,
      height,
    };
  }

  function buildPhotoLayer() {
    const photoLayer = document.createElement("canvas");
    photoLayer.width = WIDTH;
    photoLayer.height = PHOTO_HEIGHT;
    const photoContext = photoLayer.getContext("2d");
    const geometry = coverGeometry(
      state.image.width,
      state.image.height,
      WIDTH,
      PHOTO_HEIGHT,
      state.photo.x,
      state.photo.y,
      state.photo.scale
    );
    photoContext.imageSmoothingEnabled = true;
    photoContext.imageSmoothingQuality = "high";
    photoContext.drawImage(state.image, geometry.x, geometry.y, geometry.width, geometry.height);
    return photoLayer;
  }

  function captionItems(photoLayer) {
    const words = state.caption.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const insertions = new Map();
    state.fragments.forEach((fragment, fragmentIndex) => {
      const wordIndex = Math.min(words.length - 1, Math.floor((fragmentIndex + 1) * words.length / (state.fragments.length + 1)));
      if (!insertions.has(wordIndex)) insertions.set(wordIndex, []);
      insertions.get(wordIndex).push(fragmentIndex);
    });
    const items = [];
    words.forEach((word, wordIndex) => {
      items.push({ type: "word", text: word });
      (insertions.get(wordIndex) || []).forEach((fragmentIndex) => {
        items.push({ type: "fragment", fragmentIndex, photoLayer });
      });
    });
    return items;
  }

  function layoutCaptionItems(items) {
    ctx.font = "400 " + state.fontSize + "px " + fontFamily();
    const gap = Math.max(7, state.fontSize * 0.24);
    const brackets = bracketCharacters();
    const bracketWidth = brackets[0] ? ctx.measureText(brackets[0]).width + ctx.measureText(brackets[1]).width + gap * 0.7 : 0;
    const measured = items.map((item) => {
      if (item.type === "word") {
        return { ...item, width: ctx.measureText(item.text).width, height: state.fontSize * 1.15 };
      }
      const rect = fragmentRect(state.fragments[item.fragmentIndex]);
      const displayHeight = state.fontSize * 1.42;
      const imageWidth = clamp(displayHeight * rect.width / Math.max(1, rect.height), state.fontSize * 0.72, state.fontSize * 2.7);
      return {
        ...item,
        width: imageWidth + bracketWidth,
        imageWidth,
        height: displayHeight,
        sourceRect: rect,
        brackets,
      };
    });
    const lines = [];
    const maxWidth = 790;
    let line = [];
    let lineWidth = 0;
    measured.forEach((item) => {
      const nextWidth = line.length ? lineWidth + gap + item.width : item.width;
      if (line.length && nextWidth > maxWidth) {
        lines.push({ items: line, width: lineWidth });
        line = [item];
        lineWidth = item.width;
      } else {
        line.push(item);
        lineWidth = nextWidth;
      }
    });
    if (line.length) lines.push({ items: line, width: lineWidth });
    lines.forEach((entry) => {
      entry.height = Math.max(...entry.items.map((item) => item.height)) + state.fontSize * 0.55;
    });
    return { lines, gap };
  }

  function drawCaption(photoLayer) {
    const items = captionItems(photoLayer);
    if (!items.length) return;
    const layout = layoutCaptionItems(items);
    const totalHeight = layout.lines.reduce((sum, line) => sum + line.height, 0);
    let y = Math.max(38, (SPLIT_Y - totalHeight) / 2);
    ctx.fillStyle = state.textColor;
    ctx.textBaseline = "alphabetic";
    ctx.font = "400 " + state.fontSize + "px " + fontFamily();
    layout.lines.forEach((line) => {
      let x = (WIDTH - line.width) / 2;
      const baseline = y + line.height / 2 + state.fontSize * 0.34;
      line.items.forEach((item, itemIndex) => {
        if (itemIndex) x += layout.gap;
        if (item.type === "word") {
          ctx.fillStyle = state.textColor;
          ctx.fillText(item.text, x, baseline);
          x += item.width;
          return;
        }
        const bracketGap = item.brackets[0] ? layout.gap * 0.35 : 0;
        if (item.brackets[0]) {
          ctx.fillStyle = state.textColor;
          ctx.fillText(item.brackets[0], x, baseline);
          x += ctx.measureText(item.brackets[0]).width + bracketGap;
        }
        const imageY = y + (line.height - item.height) / 2;
        ctx.drawImage(
          photoLayer,
          item.sourceRect.x,
          item.sourceRect.y,
          item.sourceRect.width,
          item.sourceRect.height,
          x,
          imageY,
          item.imageWidth,
          item.height
        );
        x += item.imageWidth;
        if (item.brackets[1]) {
          x += bracketGap;
          ctx.fillStyle = state.textColor;
          ctx.fillText(item.brackets[1], x, baseline);
          x += ctx.measureText(item.brackets[1]).width;
        }
      });
      y += line.height;
    });
  }

  function drawCropWindows() {
    state.fragments.forEach((fragment, index) => {
      const rect = fragmentRect(fragment);
      ctx.fillStyle = state.background;
      ctx.fillRect(rect.x, SPLIT_Y + rect.y, rect.width, rect.height);
      if (index === state.activeFragment) {
        ctx.strokeStyle = "#4b69ff";
        ctx.lineWidth = 3;
        ctx.strokeRect(rect.x + 1.5, SPLIT_Y + rect.y + 1.5, rect.width - 3, rect.height - 3);
      }
    });
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
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (!state.image) {
      ctx.restore();
      return;
    }
    const photoLayer = buildPhotoLayer();
    ctx.drawImage(photoLayer, 0, SPLIT_Y);
    drawCropWindows();
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, SPLIT_Y);
    drawCaption(photoLayer);
    ctx.fillStyle = state.textColor;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(0, SPLIT_Y - 1, WIDTH, 2);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function syncControls() {
    $("#fragmentCount").value = state.fragmentCount;
    $("#fragmentCountOutput").textContent = state.fragmentCount;
    $("#fragmentScale").value = Math.round(state.fragmentScale * 100);
    $("#fragmentScaleOutput").textContent = state.fragmentScale.toFixed(1) + "×";
    $("#poeticFontFamily").value = state.fontFamily;
    $("#poeticBracketStyle").value = state.bracketStyle;
    $("#poeticFontSize").value = state.fontSize;
    $("#poeticFontSizeOutput").textContent = state.fontSize + "px";
    $("#poeticBackgroundColor").value = state.background;
    $("#poeticBackgroundValue").textContent = state.background.toUpperCase();
    $("#poeticTextColor").value = state.textColor;
    $("#poeticTextValue").textContent = state.textColor.toUpperCase();
    $("#poeticPhotoScale").value = Math.round(state.photo.scale * 100);
    $("#poeticPhotoScaleOutput").textContent = Math.round(state.photo.scale * 100) + "%";
    $("#poeticExportSize").value = state.outputWidth;
    $("#poeticCanvasDimensions").textContent = state.outputWidth + " × " + Math.round(state.outputWidth * 4 / 3) + " PX";
    $("#poeticFragmentStatus").textContent = state.fragmentCount + (state.fragmentCount === 1 ? " FRAGMENT" : " FRAGMENTS");
    $$("[data-fragment-placement]").forEach((button) => {
      const selected = button.dataset.fragmentPlacement === state.placement;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function reset() {
    state.caption = "Small windows of color gather inside the quiet architecture of an afternoon.";
    state.fragmentCount = 7;
    state.fragmentScale = 1;
    state.placement = "locked";
    state.fontFamily = "sans";
    state.bracketStyle = "round";
    state.fontSize = 36;
    state.background = "#efeee9";
    state.textColor = "#171914";
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    state.activeFragment = -1;
    $("#poeticCaptionInput").value = state.caption;
    if (state.image) generateFragments();
    syncControls();
    render();
    showToast("Poetic Fragments reset.");
  }

  function exportPng() {
    if (!state.image) {
      showToast("Add a photograph before exporting.");
      return;
    }
    render();
    const filename = state.fileBase + "-poetic-fragments-" + state.outputWidth + "x" + Math.round(state.outputWidth * 4 / 3) + ".png";
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
    showToast("Poetic Fragments PNG exported.");
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * WIDTH,
      y: (event.clientY - rect.top) / rect.height * HEIGHT,
    };
  }

  function fragmentAtPoint(point) {
    if (point.y < SPLIT_Y) return -1;
    const localY = point.y - SPLIT_Y;
    for (let index = state.fragments.length - 1; index >= 0; index -= 1) {
      const rect = fragmentRect(state.fragments[index]);
      if (point.x >= rect.x && point.x <= rect.x + rect.width && localY >= rect.y && localY <= rect.y + rect.height) {
        return index;
      }
    }
    return -1;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.image) return;
    const point = canvasPoint(event);
    if (point.y < SPLIT_Y) return;
    const fragmentIndex = fragmentAtPoint(point);
    state.activeFragment = fragmentIndex;
    state.dragging = {
      type: fragmentIndex >= 0 ? "fragment" : "photo",
      fragmentIndex,
      point,
      pointerId: event.pointerId,
    };
    if (fragmentIndex >= 0) $("#fragmentControls").open = true;
    else $("#poeticPhotoControls").open = true;
    canvas.setPointerCapture(event.pointerId);
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPoint(event);
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) {
      canvas.style.cursor = fragmentAtPoint(point) >= 0 ? "move" : "grab";
      return;
    }
    const deltaX = point.x - state.dragging.point.x;
    const deltaY = point.y - state.dragging.point.y;
    if (state.dragging.type === "fragment") {
      const fragment = state.fragments[state.dragging.fragmentIndex];
      const rect = fragmentRect(fragment);
      const width = rect.width / WIDTH;
      const height = rect.height / PHOTO_HEIGHT;
      fragment.x = clamp(fragment.x + deltaX / WIDTH, 0, 1 - width);
      fragment.y = clamp(fragment.y + deltaY / PHOTO_HEIGHT, 0, 1 - height);
    } else {
      state.photo.x = clamp(state.photo.x - deltaX / WIDTH, 0, 1);
      state.photo.y = clamp(state.photo.y - deltaY / PHOTO_HEIGHT, 0, 1);
    }
    state.dragging.point = point;
    render();
  });

  function stopDragging(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    state.dragging = null;
    canvas.releasePointerCapture?.(event.pointerId);
  }

  canvas.addEventListener("pointerup", stopDragging);
  canvas.addEventListener("pointercancel", stopDragging);
  canvas.addEventListener("pointerleave", () => {
    if (!state.dragging) canvas.style.cursor = "grab";
  });

  fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));
  $("#poeticEmptyChooseButton").addEventListener("click", () => fileInput.click());
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
  }));
  dropZone.addEventListener("drop", (event) => handleFile(event.dataTransfer?.files?.[0]));

  $("#poeticSuggestCaption").addEventListener("click", () => {
    state.seed += 1;
    suggestCaption(true);
  });
  $("#poeticCaptionInput").addEventListener("input", (event) => {
    state.caption = event.target.value;
    if (state.placement === "random" && state.image) generateFragments();
    render();
  });
  $("#fragmentCount").addEventListener("input", (event) => {
    state.fragmentCount = Number(event.target.value);
    if (state.placement === "random") generateFragments();
    else ensureFragments();
    syncControls();
    render();
  });
  $("#fragmentScale").addEventListener("input", (event) => {
    state.fragmentScale = Number(event.target.value) / 100;
    if (state.placement === "random") generateFragments();
    syncControls();
    render();
  });
  $$("[data-fragment-placement]").forEach((button) => {
    button.addEventListener("click", () => {
      state.placement = button.dataset.fragmentPlacement;
      if (state.placement === "random" && state.image) generateFragments();
      syncControls();
      render();
    });
  });
  $("#rerollFragments").addEventListener("click", () => {
    if (!state.image) {
      showToast("Add a photograph before shuffling crop windows.");
      return;
    }
    generateFragments();
    render();
    showToast("Crop windows shuffled.");
  });
  $("#poeticFontFamily").addEventListener("change", (event) => {
    state.fontFamily = event.target.value;
    render();
  });
  $("#poeticBracketStyle").addEventListener("change", (event) => {
    state.bracketStyle = event.target.value;
    render();
  });
  $("#poeticFontSize").addEventListener("input", (event) => {
    state.fontSize = Number(event.target.value);
    syncControls();
    render();
  });
  $("#poeticBackgroundColor").addEventListener("input", (event) => {
    state.background = event.target.value;
    syncControls();
    render();
  });
  $("#poeticTextColor").addEventListener("input", (event) => {
    state.textColor = event.target.value;
    syncControls();
    render();
  });
  $("#poeticPhotoScale").addEventListener("input", (event) => {
    state.photo.scale = Number(event.target.value) / 100;
    syncControls();
    render();
  });
  $("#poeticExportSize").addEventListener("change", (event) => {
    state.outputWidth = Number(event.target.value);
    syncControls();
    render();
  });
  $("#poeticRailExport").addEventListener("click", exportPng);

  function activate() {
    $("#fileNameHeader").textContent = state.image
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "POETIC FRAGMENTS";
    syncControls();
    render();
  }

  window.poeticFragments = { activate, reset, exportPng };
  ensureFragments();
  syncControls();
  render();
})();
