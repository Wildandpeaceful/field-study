(() => {
  "use strict";

  const presets = [
    { id: "three-four", label: "3:4", name: "Field portrait", ratio: 3 / 4, typical: "900 × 1200" },
    { id: "four-five", label: "4:5", name: "Social portrait", ratio: 4 / 5, typical: "1080 × 1350" },
    { id: "square", label: "1:1", name: "Album cover", ratio: 1, typical: "3000 × 3000" },
    { id: "story", label: "9:16", name: "Story / reel", ratio: 9 / 16, typical: "1080 × 1920" },
    { id: "wide", label: "16:9", name: "Landscape", ratio: 16 / 9, typical: "1920 × 1080" },
  ];
  const presetMap = new Map(presets.map((preset) => [preset.id, preset]));
  const stored = (() => {
    try { return JSON.parse(localStorage.getItem("field-study-output-format") || "null"); }
    catch (_) { return null; }
  })();
  const state = {
    id: presetMap.has(stored?.id) ? stored.id : "three-four",
    behavior: ["reflow", "preserve", "fill"].includes(stored?.behavior) ? stored.behavior : "reflow",
    shortEdge: [900, 1350, 3000].includes(stored?.shortEdge) ? stored.shortEdge : 900,
  };
  const listeners = new Set();

  const current = () => presetMap.get(state.id) || presets[0];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function dimensions(shortEdge = 900) {
    const edge = Math.max(320, Math.round(Number(shortEdge) || 900));
    const ratio = current().ratio;
    return ratio >= 1
      ? { width: Math.round(edge * ratio), height: edge }
      : { width: edge, height: Math.round(edge / ratio) };
  }

  function logicalDimensions() {
    return dimensions(900);
  }

  function sideBySide() {
    return state.behavior === "reflow" && current().ratio > 1.2;
  }

  function save() {
    try { localStorage.setItem("field-study-output-format", JSON.stringify(state)); }
    catch (_) { /* Local persistence is optional. */ }
  }

  function notify(outputSizeChanged = false) {
    save();
    syncUi();
    const detail = { ...get(), outputSizeChanged };
    listeners.forEach((listener) => listener(detail));
    window.dispatchEvent(new CustomEvent("fieldstudy:formatchange", { detail }));
  }

  function set(id, behavior = state.behavior, shortEdge = state.shortEdge) {
    if (!presetMap.has(id)) return;
    state.id = id;
    if (["reflow", "preserve", "fill"].includes(behavior)) state.behavior = behavior;
    const outputSizeChanged = [900, 1350, 3000].includes(Number(shortEdge)) && state.shortEdge !== Number(shortEdge);
    if (outputSizeChanged) state.shortEdge = Number(shortEdge);
    notify(outputSizeChanged);
  }

  function setOutputSize(shortEdge) {
    if (![900, 1350, 3000].includes(Number(shortEdge))) return;
    set(state.id, state.behavior, Number(shortEdge));
  }

  function setBehavior(behavior) {
    if (!["reflow", "preserve", "fill"].includes(behavior)) return;
    state.behavior = behavior;
    notify();
  }

  function get() {
    return { ...current(), behavior: state.behavior, shortEdge: state.shortEdge, dimensions: dimensions(state.shortEdge), logical: logicalDimensions(), sideBySide: sideBySide() };
  }

  function applyShell(shell, split = false) {
    if (!shell) return;
    const preset = current();
    shell.style.aspectRatio = String(preset.ratio);
    shell.dataset.outputFormat = preset.id;
    shell.dataset.outputBehavior = state.behavior;
    shell.dataset.panelFlow = split && sideBySide() ? "side" : "stack";
  }

  function fitTransform(source, destination, mode = "fit") {
    const scale = mode === "cover"
      ? Math.max(destination.width / source.width, destination.height / source.height)
      : Math.min(destination.width / source.width, destination.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    return {
      scale,
      x: destination.x + (destination.width - width) / 2,
      y: destination.y + (destination.height - height) / 2,
      width,
      height,
    };
  }

  function splitMapping(splitY, baseWidth = 900, baseHeight = 1200) {
    const output = logicalDimensions();
    if (sideBySide()) {
      const leftWidth = Math.round(output.width / 2);
      return [
        { source: { x: 0, y: 0, width: baseWidth, height: splitY }, destination: { x: 0, y: 0, width: leftWidth, height: output.height }, mode: "fit" },
        { source: { x: 0, y: splitY, width: baseWidth, height: baseHeight - splitY }, destination: { x: leftWidth, y: 0, width: output.width - leftWidth, height: output.height }, mode: "cover" },
      ];
    }
    const topHeight = Math.round(output.height * splitY / baseHeight);
    return [
      { source: { x: 0, y: 0, width: baseWidth, height: splitY }, destination: { x: 0, y: 0, width: output.width, height: topHeight }, mode: "fit" },
      { source: { x: 0, y: splitY, width: baseWidth, height: baseHeight - splitY }, destination: { x: 0, y: topHeight, width: output.width, height: output.height - topHeight }, mode: "cover" },
    ];
  }

  function wholeMapping(baseWidth = 900, baseHeight = 1200) {
    const output = logicalDimensions();
    const destination = { x: 0, y: 0, width: output.width, height: output.height };
    return [{
      source: { x: 0, y: 0, width: baseWidth, height: baseHeight },
      destination,
      mode: state.behavior === "fill" ? "cover" : "fit",
    }];
  }

  function mappings(splitY, baseWidth = 900, baseHeight = 1200) {
    return state.behavior === "reflow"
      ? splitMapping(splitY, baseWidth, baseHeight)
      : wholeMapping(baseWidth, baseHeight);
  }

  function splitPanels(splitY, baseWidth = 900, baseHeight = 1200) {
    return splitMapping(splitY, baseWidth, baseHeight).map((entry) => ({ ...entry.destination }));
  }

  function isReflow() {
    return state.behavior === "reflow";
  }

  function mappingTransform(mapping) {
    return fitTransform(mapping.source, mapping.destination, mapping.mode);
  }

  function presentSplit(target, source, splitY, options = {}) {
    const output = dimensions(options.shortEdge || 900);
    if (target.width !== output.width || target.height !== output.height) {
      target.width = output.width;
      target.height = output.height;
    }
    const context = target.getContext("2d", { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, output.width, output.height);
    context.fillStyle = options.background || "#f0efe8";
    context.fillRect(0, 0, output.width, output.height);

    const logical = logicalDimensions();
    const scaleX = output.width / logical.width;
    const scaleY = output.height / logical.height;
    context.save();
    context.scale(scaleX, scaleY);
    const map = mappings(splitY, source.width, source.height);
    map.forEach((entry, index) => {
      const transform = mappingTransform(entry);
      context.save();
      context.beginPath();
      context.rect(entry.destination.x, entry.destination.y, entry.destination.width, entry.destination.height);
      context.clip();
      context.fillStyle = index === 0 ? (options.upperBackground || options.background || "#f0efe8") : (options.lowerBackground || options.background || "#f0efe8");
      context.fillRect(entry.destination.x, entry.destination.y, entry.destination.width, entry.destination.height);
      context.drawImage(
        source,
        entry.source.x, entry.source.y, entry.source.width, entry.source.height,
        transform.x, transform.y, transform.width, transform.height
      );
      context.restore();
    });
    if (state.behavior === "reflow" && map.length === 2) {
      context.fillStyle = options.divider || "rgba(23,25,20,0.35)";
      if (sideBySide()) context.fillRect(map[1].destination.x - 1, 0, 2, logical.height);
      else context.fillRect(0, map[1].destination.y - 1, logical.width, 2);
      options.upperOverlay?.(context, { ...map[0].destination }, map[0]);
      options.lowerOverlay?.(context, { ...map[1].destination }, map[1]);
    }
    context.restore();
    applyShell(options.shell, true);
    return output;
  }

  function presentFull(target, source, options = {}) {
    const output = dimensions(options.shortEdge || 900);
    if (target.width !== output.width || target.height !== output.height) {
      target.width = output.width;
      target.height = output.height;
    }
    const context = target.getContext("2d", { alpha: false });
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = options.background || "#f0efe8";
    context.fillRect(0, 0, output.width, output.height);
    const destination = { x: 0, y: 0, width: output.width, height: output.height };
    const mode = state.behavior === "fill" ? "cover" : "fit";
    const transform = fitTransform({ x: 0, y: 0, width: source.width, height: source.height }, destination, mode);
    context.drawImage(source, transform.x, transform.y, transform.width, transform.height);
    applyShell(options.shell, false);
    return output;
  }

  function projectRect(rect, splitY, baseWidth = 900, baseHeight = 1200) {
    const map = mappings(splitY, baseWidth, baseHeight);
    const centerY = rect.y + rect.height / 2;
    const entry = map.length === 1 ? map[0] : centerY < splitY ? map[0] : map[1];
    const transform = mappingTransform(entry);
    return {
      x: transform.x + (rect.x - entry.source.x) * transform.scale,
      y: transform.y + (rect.y - entry.source.y) * transform.scale,
      width: rect.width * transform.scale,
      height: rect.height * transform.scale,
    };
  }

  function unprojectPoint(point, splitY, baseWidth = 900, baseHeight = 1200) {
    const map = mappings(splitY, baseWidth, baseHeight);
    const entry = map.find((candidate) => point.x >= candidate.destination.x && point.x <= candidate.destination.x + candidate.destination.width
      && point.y >= candidate.destination.y && point.y <= candidate.destination.y + candidate.destination.height) || map[0];
    const transform = mappingTransform(entry);
    return {
      x: clamp(entry.source.x + (point.x - transform.x) / transform.scale, entry.source.x, entry.source.x + entry.source.width),
      y: clamp(entry.source.y + (point.y - transform.y) / transform.scale, entry.source.y, entry.source.y + entry.source.height),
    };
  }

  function projectAlignment(alignment, splitY, baseWidth = 900, baseHeight = 1200) {
    const region = projectRect(alignment.region || { x: 0, y: 0, width: baseWidth, height: baseHeight }, splitY, baseWidth, baseHeight);
    const point = projectRect({
      x: Number.isFinite(alignment.x) ? alignment.x : region.x,
      y: Number.isFinite(alignment.y) ? alignment.y : region.y,
      width: 0,
      height: 0,
    }, splitY, baseWidth, baseHeight);
    return {
      ...alignment,
      x: Number.isFinite(alignment.x) ? point.x : undefined,
      y: Number.isFinite(alignment.y) ? point.y : undefined,
      region,
      threshold: (alignment.threshold || 12) * Math.max(0.45, region.width / Math.max(1, alignment.region?.width || baseWidth)),
    };
  }

  function projectGuides(guides, splitY, baseWidth = 900, baseHeight = 1200) {
    const region = projectRect(guides.region || { x: 0, y: 0, width: baseWidth, height: baseHeight }, splitY, baseWidth, baseHeight);
    const point = projectRect({
      x: Number.isFinite(guides.vertical) ? guides.vertical : 0,
      y: Number.isFinite(guides.horizontal) ? guides.horizontal : 0,
      width: 0,
      height: 0,
    }, splitY, baseWidth, baseHeight);
    return {
      vertical: Number.isFinite(guides.vertical) ? point.x : undefined,
      horizontal: Number.isFinite(guides.horizontal) ? point.y : undefined,
      region,
    };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function exportSquareJpeg(canvas, options = {}) {
    if (!canvas || typeof options.render !== "function") {
      throw new Error("The current composition cannot be rendered as a JPEG.");
    }
    const previousFormat = get();
    const previousShortEdge = Number(options.getShortEdge?.()) || 900;
    let dataUrl;
    try {
      options.setShortEdge?.(3000);
      set("square", previousFormat.behavior);
      options.render();
      dataUrl = canvas.toDataURL("image/jpeg", clamp(Number(options.quality) || 0.94, 0.7, 1));
    } finally {
      options.setShortEdge?.(previousShortEdge);
      set(previousFormat.id, previousFormat.behavior);
      options.render();
    }

    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/export";
    form.target = "fieldStudyDownload";
    form.hidden = true;
    const imageField = document.createElement("input");
    imageField.type = "hidden";
    imageField.name = "image";
    imageField.value = dataUrl;
    const filenameField = document.createElement("input");
    filenameField.type = "hidden";
    filenameField.name = "filename";
    filenameField.value = String(options.filename || "field-study-3000x3000.jpg");
    form.append(imageField, filenameField);
    document.body.appendChild(form);
    form.submit();
    requestAnimationFrame(() => form.remove());
  }

  function syncUi() {
    const preset = current();
    const button = document.querySelector("#outputFormatButton");
    if (button) {
      button.querySelector("strong").textContent = preset.label;
      const output = dimensions(state.shortEdge);
      button.title = `Canvas · ${preset.name} · ${output.width} × ${output.height} px`;
    }
    document.querySelectorAll("button[data-output-format]").forEach((button) => {
      const selected = button.dataset.outputFormat === preset.id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    document.querySelectorAll("button[data-output-behavior]").forEach((button) => {
      const selected = button.dataset.outputBehavior === state.behavior;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const summary = document.querySelector("#outputFormatSummary");
    if (summary) {
      const output = dimensions(state.shortEdge);
      summary.textContent = preset.name + " · " + output.width + " × " + output.height + " · " + state.behavior;
    }
    const sizeSelect = document.querySelector("#outputCanvasSize");
    if (sizeSelect) {
      Array.from(sizeSelect.options).forEach((option) => {
        const output = dimensions(Number(option.value));
        const label = option.value === "3000" ? "Master" : option.value === "1350" ? "High" : "Standard";
        option.textContent = `${label} · ${output.width} × ${output.height} px`;
      });
      sizeSelect.value = String(state.shortEdge);
    }
    document.querySelectorAll("[data-canvas-ratio]").forEach((label) => { label.textContent = preset.label; });
  }

  function wireUi() {
    const dialog = document.querySelector("#outputFormatDialog");
    document.querySelector("#outputFormatButton")?.addEventListener("click", () => {
      syncUi();
      if (dialog && !dialog.open) dialog.showModal();
    });
    document.querySelector("#outputFormatClose")?.addEventListener("click", () => dialog?.close());
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.querySelectorAll("button[data-output-format]").forEach((button) => button.addEventListener("click", () => set(button.dataset.outputFormat, "reflow", button.dataset.outputFormat === "square" ? 3000 : state.shortEdge)));
    document.querySelector("#outputCanvasSize")?.addEventListener("change", (event) => setOutputSize(event.target.value));
    document.querySelectorAll("button[data-output-behavior]").forEach((button) => button.addEventListener("click", () => setBehavior(button.dataset.outputBehavior)));
    syncUi();
  }

  window.outputFormat = {
    presets,
    get,
    set,
    setOutputSize,
    setBehavior,
    subscribe,
    dimensions,
    logicalDimensions,
    sideBySide,
    isReflow,
    splitPanels,
    applyShell,
    presentSplit,
    presentFull,
    projectRect,
    projectAlignment,
    projectGuides,
    unprojectPoint,
    exportSquareJpeg,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireUi, { once: true });
  else wireUi();
})();
