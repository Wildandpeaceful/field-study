(() => {
  "use strict";

  const registry = new Map();
  let activeTool = "foreground";
  let selection = null;
  let interaction = null;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function layerFor(instance, id) {
    return instance.config.getLayers().find((layer) => layer.id === id && layer.enabled !== false) || null;
  }

  function selectedLayer() {
    if (!selection) return null;
    const instance = registry.get(selection.tool);
    if (!instance) return null;
    const layer = layerFor(instance, selection.id);
    return layer ? { instance, layer } : null;
  }

  function canvasPoint(instance, event) {
    const rect = instance.canvas.getBoundingClientRect();
    const dimensions = instance.config.getDimensions?.() || { width: instance.config.width, height: instance.config.height };
    const point = {
      x: (event.clientX - rect.left) / rect.width * dimensions.width,
      y: (event.clientY - rect.top) / rect.height * dimensions.height,
    };
    return instance.config.unprojectPoint?.(point) || point;
  }

  function layerCenter(layer) {
    return {
      x: layer.bounds.x + layer.bounds.width / 2 + layer.transform.x,
      y: layer.bounds.y + layer.bounds.height / 2 + layer.transform.y,
    };
  }

  function updateSelected(patch) {
    const current = selectedLayer();
    if (!current || current.layer.transform.locked) return;
    current.instance.config.updateLayer(current.layer.id, patch);
    current.instance.config.render();
    refresh(current.instance.tool);
  }

  function syncPanel(instance) {
    if (!instance.panel) return;
    const layer = selection?.tool === instance.tool ? layerFor(instance, selection.id) : null;
    const controls = instance.panel.querySelector("[data-editorial-controls]");
    const empty = instance.panel.querySelector("[data-editorial-empty]");
    if (controls) controls.hidden = !layer;
    if (empty) empty.hidden = Boolean(layer);

    instance.panel.querySelectorAll("[data-editorial-layer]").forEach((button) => {
      const target = layerFor(instance, button.dataset.editorialLayer);
      const isSelected = Boolean(layer && layer.id === button.dataset.editorialLayer);
      button.disabled = !target;
      button.classList.toggle("selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    });
    const label = instance.panel.querySelector("[data-editorial-selected-label]");
    if (!layer) {
      if (label) label.textContent = instance.emptyLabel || "Choose a text layer";
      instance.panel.classList.remove("is-locked");
      return;
    }

    const transform = layer.transform;
    if (label) label.textContent = layer.label;
    const scale = instance.panel.querySelector("[data-editorial-scale]");
    const scaleOutput = instance.panel.querySelector("[data-editorial-scale-output]");
    const rotation = instance.panel.querySelector("[data-editorial-rotation]");
    const rotationOutput = instance.panel.querySelector("[data-editorial-rotation-output]");
    const opacity = instance.panel.querySelector("[data-editorial-opacity]");
    const opacityOutput = instance.panel.querySelector("[data-editorial-opacity-output]");
    const color = instance.panel.querySelector("[data-editorial-color]");
    const colorOutput = instance.panel.querySelector("[data-editorial-color-output]");
    const locked = instance.panel.querySelector("[data-editorial-lock]");
    if (scale) scale.value = Math.round(transform.scale * 100);
    if (scaleOutput) scaleOutput.textContent = Math.round(transform.scale * 100) + "%";
    if (rotation) rotation.value = Math.round(transform.rotation);
    if (rotationOutput) rotationOutput.textContent = Math.round(transform.rotation) + "°";
    if (opacity) opacity.value = Math.round(transform.opacity * 100);
    if (opacityOutput) opacityOutput.textContent = Math.round(transform.opacity * 100) + "%";
    if (color) color.value = layer.color;
    if (colorOutput) colorOutput.textContent = layer.color.toUpperCase();
    if (locked) locked.checked = Boolean(transform.locked);
    instance.panel.classList.toggle("is-locked", Boolean(transform.locked));
  }

  function select(tool, id, openPanel = true) {
    const instance = registry.get(tool);
    if (!instance || !layerFor(instance, id)) return;
    selection = { tool, id };
    if (openPanel && instance.panel) {
      const details = instance.panel.closest("details");
      if (details) details.open = true;
    }
    refresh(tool);
  }

  function deselect() {
    const previous = selection?.tool;
    selection = null;
    if (previous) window.alignmentGuides?.hide(previous);
    if (previous) refresh(previous);
  }

  function beginInteraction(instance, layer, type, event) {
    const zone = event.currentTarget.closest(".editorial-hit-zone") || event.currentTarget;
    zone._editorialWasSelected = selection?.tool === instance.tool && selection.id === layer.id;
    zone._editorialDragged = false;
    select(instance.tool, layer.id, true);
    if (layer.transform.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(instance, event);
    const center = layerCenter(layer);
    interaction = {
      tool: instance.tool,
      id: layer.id,
      type,
      pointerId: event.pointerId,
      target: event.currentTarget,
      point,
      center,
      start: { ...layer.transform },
      distance: Math.max(8, Math.hypot(point.x - center.x, point.y - center.y)),
      angle: Math.atan2(point.y - center.y, point.x - center.x),
      zone,
    };
    window.alignmentGuides?.hide(instance.tool);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveInteraction(event) {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const instance = registry.get(interaction.tool);
    const layer = instance && layerFor(instance, interaction.id);
    if (!instance || !layer) return;
    const point = canvasPoint(instance, event);
    if (Math.hypot(point.x - interaction.point.x, point.y - interaction.point.y) > 2) {
      interaction.zone._editorialDragged = true;
    }
    if (interaction.type === "move") {
      let nextX = interaction.start.x + point.x - interaction.point.x;
      let nextY = interaction.start.y + point.y - interaction.point.y;
      const alignment = instance.config.getAlignment?.(layer) || {
        x: instance.config.width / 2,
        y: instance.config.height / 2,
        region: { x: 0, y: 0, width: instance.config.width, height: instance.config.height },
      };
      const threshold = alignment.threshold || 12;
      const baseCenterX = layer.bounds.x + layer.bounds.width / 2;
      const baseCenterY = layer.bounds.y + layer.bounds.height / 2;
      let vertical;
      let horizontal;
      if (Number.isFinite(alignment.x)) {
        const snappedX = window.alignmentGuides.snap(baseCenterX + nextX, alignment.x, threshold);
        nextX += snappedX.value - (baseCenterX + nextX);
        if (snappedX.aligned) vertical = alignment.x;
      }
      if (Number.isFinite(alignment.y)) {
        const snappedY = window.alignmentGuides.snap(baseCenterY + nextY, alignment.y, threshold);
        nextY += snappedY.value - (baseCenterY + nextY);
        if (snappedY.aligned) horizontal = alignment.y;
      }
      instance.config.updateLayer(layer.id, {
        x: nextX,
        y: nextY,
      });
      const guideAlignment = instance.config.projectGuides?.({ vertical, horizontal, region: alignment.region }) || { vertical, horizontal, region: alignment.region };
      window.alignmentGuides?.show(instance.tool, guideAlignment);
    } else if (interaction.type === "scale") {
      window.alignmentGuides?.hide(instance.tool);
      const distance = Math.max(8, Math.hypot(point.x - interaction.center.x, point.y - interaction.center.y));
      instance.config.updateLayer(layer.id, { scale: clamp(interaction.start.scale * distance / interaction.distance, 0.45, 3) });
    } else {
      window.alignmentGuides?.hide(instance.tool);
      const angle = Math.atan2(point.y - interaction.center.y, point.x - interaction.center.x);
      instance.config.updateLayer(layer.id, {
        rotation: Math.round(interaction.start.rotation + (angle - interaction.angle) * 180 / Math.PI),
      });
    }
    instance.config.render();
    refresh(instance.tool);
  }

  function endInteraction(event) {
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interaction.target.releasePointerCapture?.(event.pointerId);
    window.alignmentGuides?.hide(interaction.tool);
    interaction = null;
  }

  function createZone(instance, layer) {
    const zone = document.createElement("button");
    zone.type = "button";
    zone.className = "editorial-hit-zone";
    zone.dataset.editorialHit = layer.id;
    zone.innerHTML = '<span class="editorial-zone-label"></span><span class="editorial-rotate-handle" data-editorial-handle="rotate" aria-hidden="true"></span><span class="editorial-scale-handle" data-editorial-handle="scale" aria-hidden="true"></span>';
    zone.addEventListener("pointerdown", (event) => {
      const current = layerFor(instance, zone.dataset.editorialHit);
      if (!current) return;
      if (event.target.closest("[data-editorial-handle]")) return;
      beginInteraction(instance, current, "move", event);
    });
    zone.querySelectorAll("[data-editorial-handle]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        const current = layerFor(instance, zone.dataset.editorialHit);
        if (!current) return;
        beginInteraction(instance, current, handle.dataset.editorialHandle, event);
      });
    });
    zone.addEventListener("pointermove", moveInteraction);
    zone.addEventListener("pointerup", endInteraction);
    zone.addEventListener("pointercancel", endInteraction);
    zone.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (zone._editorialDragged) {
        zone._editorialDragged = false;
        return;
      }
      if (zone._editorialWasSelected) deselect();
      else select(instance.tool, zone.dataset.editorialHit, true);
      zone._editorialWasSelected = false;
    });
    instance.overlay.appendChild(zone);
    instance.zones.set(layer.id, zone);
    return zone;
  }

  function refresh(tool) {
    const instance = registry.get(tool);
    if (!instance) return;
    const layers = instance.config.getLayers().filter((layer) => layer.enabled !== false);
    const validIds = new Set(layers.map((layer) => layer.id));
    instance.zones.forEach((zone, id) => {
      if (!validIds.has(id)) {
        zone.remove();
        instance.zones.delete(id);
      }
    });
    layers.forEach((layer) => {
      const zone = instance.zones.get(layer.id) || createZone(instance, layer);
      const transform = layer.transform;
      const projected = instance.config.projectBounds?.({
        x: layer.bounds.x + transform.x,
        y: layer.bounds.y + transform.y,
        width: layer.bounds.width,
        height: layer.bounds.height,
      }) || { x: layer.bounds.x + transform.x, y: layer.bounds.y + transform.y, width: layer.bounds.width, height: layer.bounds.height };
      const dimensions = instance.config.getDimensions?.() || { width: instance.config.width, height: instance.config.height };
      zone.style.left = projected.x / dimensions.width * 100 + "%";
      zone.style.top = projected.y / dimensions.height * 100 + "%";
      zone.style.width = projected.width / dimensions.width * 100 + "%";
      zone.style.height = projected.height / dimensions.height * 100 + "%";
      zone.style.transform = `rotate(${transform.rotation}deg) scale(${transform.scale})`;
      zone.classList.toggle("selected", selection?.tool === tool && selection.id === layer.id);
      zone.classList.toggle("locked", Boolean(transform.locked));
      zone.setAttribute("aria-label", `${layer.label}. Click and drag to move${transform.locked ? ". Locked" : ", use handles to scale or rotate"}.`);
      zone.querySelector(".editorial-zone-label").textContent = layer.label + (transform.locked ? " · LOCKED" : "");
    });
    if (selection?.tool === tool && !validIds.has(selection.id)) selection = null;
    syncPanel(instance);
  }

  function wirePanel(instance) {
    if (!instance.panel) return;
    instance.panel.querySelectorAll("[data-editorial-layer]").forEach((button) => {
      button.addEventListener("click", () => {
        const alreadySelected = selection?.tool === instance.tool && selection.id === button.dataset.editorialLayer;
        if (alreadySelected) deselect();
        else select(instance.tool, button.dataset.editorialLayer, false);
      });
    });
    instance.panel.querySelectorAll("[data-editorial-nudge]").forEach((button) => {
      button.addEventListener("click", () => {
        const amount = Number(button.dataset.editorialNudgeAmount || 10);
        const direction = button.dataset.editorialNudge;
        updateSelected({
          x: selectedLayer().layer.transform.x + (direction === "left" ? -amount : direction === "right" ? amount : 0),
          y: selectedLayer().layer.transform.y + (direction === "up" ? -amount : direction === "down" ? amount : 0),
        });
      });
    });
    const scale = instance.panel.querySelector("[data-editorial-scale]");
    const rotation = instance.panel.querySelector("[data-editorial-rotation]");
    const opacity = instance.panel.querySelector("[data-editorial-opacity]");
    const color = instance.panel.querySelector("[data-editorial-color]");
    const locked = instance.panel.querySelector("[data-editorial-lock]");
    scale?.addEventListener("input", (event) => updateSelected({ scale: Number(event.target.value) / 100 }));
    rotation?.addEventListener("input", (event) => updateSelected({ rotation: Number(event.target.value) }));
    opacity?.addEventListener("input", (event) => updateSelected({ opacity: Number(event.target.value) / 100 }));
    color?.addEventListener("input", (event) => updateSelected({ color: event.target.value }));
    locked?.addEventListener("change", (event) => {
      const current = selectedLayer();
      if (!current) return;
      current.instance.config.updateLayer(current.layer.id, { locked: event.target.checked });
      current.instance.config.render();
      refresh(instance.tool);
    });
    instance.panel.querySelector("[data-editorial-reset]")?.addEventListener("click", () => {
      const current = selectedLayer();
      if (!current) return;
      current.instance.config.resetLayer(current.layer.id);
      current.instance.config.render();
      refresh(instance.tool);
    });
  }

  function register(tool, config) {
    window.alignmentGuides?.register(tool, config.shell, config.width, config.height);
    const overlay = document.createElement("div");
    overlay.className = "editorial-overlay";
    overlay.setAttribute("aria-label", "Editable text layers");
    config.shell.appendChild(overlay);
    const instance = {
      tool,
      config,
      canvas: config.canvas,
      overlay,
      panel: typeof config.panel === "string" ? document.querySelector(config.panel) : config.panel,
      zones: new Map(),
    };
    instance.emptyLabel = instance.panel?.querySelector("[data-editorial-selected-label]")?.textContent || "Choose a text layer";
    registry.set(tool, instance);
    wirePanel(instance);
    refresh(tool);
  }

  function activate(tool) {
    activeTool = tool;
    if (selection && selection.tool !== tool) selection = null;
    registry.forEach((instance) => refresh(instance.tool));
  }

  function transformContext(context, bounds, transform, draw) {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    context.save();
    context.translate(centerX + transform.x, centerY + transform.y);
    context.rotate(transform.rotation * Math.PI / 180);
    context.scale(transform.scale, transform.scale);
    context.translate(-centerX, -centerY);
    context.globalAlpha *= transform.opacity;
    draw();
    context.restore();
  }

  window.addEventListener("keydown", (event) => {
    if (!selection || selection.tool !== activeTool) return;
    if (event.key === "Escape") {
      deselect();
      return;
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!directions[event.key]) return;
    const current = selectedLayer();
    if (!current || current.layer.transform.locked) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    updateSelected({
      x: current.layer.transform.x + directions[event.key][0] * step,
      y: current.layer.transform.y + directions[event.key][1] * step,
    });
  });

  document.addEventListener("pointerdown", (event) => {
    if (!selection || selection.tool !== activeTool) return;
    const current = selectedLayer();
    if (!current) return;
    if (event.target.closest(".editorial-hit-zone")) return;
    if (current.instance.panel?.contains(event.target)) return;
    deselect();
  }, true);

  window.editorialText = { register, refresh, activate, select, deselect, transformContext };
})();
