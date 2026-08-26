(() => {
  "use strict";

  const registry = new Map();

  function register(tool, shell, width, height) {
    if (registry.has(tool)) return registry.get(tool);
    const overlay = document.createElement("div");
    overlay.className = "alignment-guide-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = '<i class="alignment-guide alignment-guide-vertical"></i><i class="alignment-guide alignment-guide-horizontal"></i>';
    shell.appendChild(overlay);
    const instance = {
      shell,
      width,
      height,
      overlay,
      vertical: overlay.querySelector(".alignment-guide-vertical"),
      horizontal: overlay.querySelector(".alignment-guide-horizontal"),
    };
    registry.set(tool, instance);
    return instance;
  }

  function show(tool, options = {}) {
    const instance = registry.get(tool);
    if (!instance) return;
    const region = options.region || { x: 0, y: 0, width: instance.width, height: instance.height };
    const verticalActive = Number.isFinite(options.vertical);
    const horizontalActive = Number.isFinite(options.horizontal);
    instance.vertical.style.left = (options.vertical || 0) / instance.width * 100 + "%";
    instance.vertical.style.top = region.y / instance.height * 100 + "%";
    instance.vertical.style.height = region.height / instance.height * 100 + "%";
    instance.horizontal.style.left = region.x / instance.width * 100 + "%";
    instance.horizontal.style.top = (options.horizontal || 0) / instance.height * 100 + "%";
    instance.horizontal.style.width = region.width / instance.width * 100 + "%";
    instance.vertical.classList.toggle("active", verticalActive);
    instance.horizontal.classList.toggle("active", horizontalActive);
    instance.overlay.classList.toggle("active", verticalActive || horizontalActive);
  }

  function hide(tool) {
    const instance = registry.get(tool);
    if (!instance) return;
    instance.overlay.classList.remove("active");
    instance.vertical.classList.remove("active");
    instance.horizontal.classList.remove("active");
  }

  function snap(value, target, threshold) {
    return Math.abs(value - target) <= threshold
      ? { value: target, aligned: true }
      : { value, aligned: false };
  }

  window.alignmentGuides = { register, show, hide, snap };
})();
