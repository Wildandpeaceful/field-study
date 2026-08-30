(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $("#motionCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  const video = $("#motionSourceVideo");
  const input = $("#motionSourceInput");
  const dropZone = $("#motionDropZone");
  let WIDTH = 900;
  let HEIGHT = 1200;
  const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
  const MAX_CLIP_DURATION = 60;
  const modes = {
    echo: "ECHO TRAIL",
    strobe: "STROBE STACK",
    grid: "MOTION GRID",
    ribbon: "MOTION RIBBON",
    pose: "POSE TYPE",
    freeze: "FREEZE / FLOW",
  };
  const poseIconSources = ["crosshair", "move-up-right", "circle-dot", "sparkles", "move-down"];
  const poseIcons = poseIconSources.map((name) => {
    const image = new Image();
    image.src = "/vendor/lucide/icons/" + name + ".svg";
    image.addEventListener("load", () => render());
    return image;
  });

  const defaultComposition = () => ({
    subjectScale: 1,
    spread: 1,
    decay: 0.66,
    offsetX: 0,
    offsetY: 0,
    typeSize: 18,
  });

  const state = {
    file: null,
    sourceUrl: null,
    fileBase: "motion-specimen",
    samples: [],
    frozenFrame: null,
    previewFrame: null,
    selecting: false,
    processing: false,
    generation: 0,
    selectionPoint: null,
    sampleCount: 9,
    trackSpan: 6,
    trackStart: 0,
    trackEnd: 0,
    mode: "echo",
    backgroundMode: "frozen",
    ...defaultComposition(),
    labels: ["HEAD / DIRECTION", "LEFT / GESTURE", "BODY / CENTER", "RIGHT / REACH", "GROUND / WEIGHT"],
    poseContent: "labels",
    palette: ["#d6ff45", "#f3f0e8", "#171914", "#4b69ff", "#d24e3e", "#38b878"],
    paletteTarget: "accent",
    accent: "#d6ff45",
    background: "#f3f0e8",
    text: "#171914",
    playbackRate: 1,
    sound: false,
    sourceFraming: "fit",
    outputWidth: 900,
    clipDuration: 10,
    recording: false,
    frameRequest: null,
    canvasVisible: true,
  };

  let pointExtractorPromise = null;

  function showToast(message) {
    window.fieldStudyShell?.showToast(message);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function safeFileBase(name) {
    return (name || "motion-specimen")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "motion-specimen";
  }

  function fileMeta(file) {
    const size = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + " MB"
      : Math.max(1, Math.round(file.size / 1024)) + " KB";
    return size + " · " + ((file.type.split("/")[1] || "VIDEO").toUpperCase());
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remainder = Math.floor(safe % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
  }

  function formatRate(rate) {
    return Number(rate).toFixed(rate % 1 ? 2 : 0).replace(/0+$/, "").replace(/\.$/, "") + "×";
  }

  function setStatus(kind, message) {
    $("#motionProcessStatus").className = "process-status" + (kind ? " " + kind : "");
    $("#motionProcessStatusText").textContent = message;
  }

  function getPointExtractor() {
    if (!pointExtractorPromise) {
      pointExtractorPromise = import("/point-extractor.js").catch((error) => {
        pointExtractorPromise = null;
        throw error;
      });
    }
    return pointExtractorPromise;
  }

  function sourceDimensions(source = video) {
    return {
      width: source?.videoWidth || source?.naturalWidth || source?.width || 0,
      height: source?.videoHeight || source?.naturalHeight || source?.height || 0,
    };
  }

  function sourceTransform(sourceWidth, sourceHeight) {
    const scale = state.sourceFraming === "fill"
      ? Math.max(WIDTH / sourceWidth, HEIGHT / sourceHeight)
      : Math.min(WIDTH / sourceWidth, HEIGHT / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return { scale, x: (WIDTH - width) / 2, y: (HEIGHT - height) / 2, width, height };
  }

  function drawSource(source, alpha = 1) {
    const size = sourceDimensions(source);
    if (!size.width || !size.height) return false;
    const fit = sourceTransform(size.width, size.height);
    ctx.save();
    try {
      ctx.globalAlpha = alpha;
      ctx.drawImage(source, fit.x, fit.y, fit.width, fit.height);
      return true;
    } catch (_) {
      return false;
    } finally {
      ctx.restore();
    }
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width * WIDTH, 0, WIDTH),
      y: clamp((event.clientY - rect.top) / rect.height * HEIGHT, 0, HEIGHT),
    };
  }

  function artboardToSource(point) {
    const size = sourceDimensions();
    if (!size.width || !size.height) return null;
    const fit = sourceTransform(size.width, size.height);
    if (point.x < fit.x || point.x > fit.x + fit.width || point.y < fit.y || point.y > fit.y + fit.height) return null;
    return {
      x: clamp((point.x - fit.x) / fit.width, 0, 1),
      y: clamp((point.y - fit.y) / fit.height, 0, 1),
    };
  }

  function setCanvasSize() {
    const logical = window.outputFormat.logicalDimensions();
    WIDTH = logical.width;
    HEIGHT = logical.height;
    const output = window.outputFormat.dimensions(state.outputWidth);
    if (canvas.width !== output.width || canvas.height !== output.height) {
      canvas.width = output.width;
      canvas.height = output.height;
    }
    ctx.setTransform(output.width / WIDTH, 0, 0, output.height / HEIGHT, 0, 0);
    window.outputFormat.applyShell($("#motionArtboardShell"), false);
    $("#motionCanvasRatio").textContent = window.outputFormat.get().label;
    $("#motionCanvasDimensions").textContent = output.width + " × " + output.height + " PX";
  }

  function findAlphaBounds(source) {
    const width = source.width;
    const height = source.height;
    const pixels = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = pixels[(y * width + x) * 4 + 3];
        if (alpha < 20) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
        count += 1;
      }
    }
    if (right < left || bottom < top) return null;
    return {
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
      centerX: (left + right + 1) / 2,
      centerY: (top + bottom + 1) / 2,
      area: count,
    };
  }

  function cloneCanvas(source) {
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d").drawImage(source, 0, 0);
    return copy;
  }

  function waitForVideoReady() {
    if (video.readyState >= 2 && video.videoWidth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("The video could not be decoded in this browser."));
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", ready);
        video.removeEventListener("error", failed);
      };
      video.addEventListener("loadeddata", ready, { once: true });
      video.addEventListener("error", failed, { once: true });
    });
  }

  function seekVideo(time) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const target = clamp(Number(time) || 0, 0, Math.max(0, duration - 0.01));
    if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.015) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer = null;
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("The video frame could not be read."));
      };
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        video.removeEventListener("seeked", done);
        video.removeEventListener("error", failed);
      };
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", failed, { once: true });
      timer = window.setTimeout(done, 4000);
      video.currentTime = target;
    });
  }

  function captureFrame(identity) {
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
    const frame = document.createElement("canvas");
    frame.width = Math.max(2, Math.round(sourceWidth * scale));
    frame.height = Math.max(2, Math.round(sourceHeight * scale));
    frame.dataset.pointExtractorIdentity = identity;
    frame.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0, frame.width, frame.height);
    return frame;
  }

  function retainPreviewFrame() {
    if (!state.file || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
    try {
      state.previewFrame = captureFrame("motion-preview-" + state.generation + "-" + video.currentTime.toFixed(3));
      return true;
    } catch (_) {
      return false;
    }
  }

  function trackingPreview(frame, maxSide = 128) {
    const scale = Math.min(1, maxSide / Math.max(frame.width, frame.height));
    const sample = document.createElement("canvas");
    sample.width = Math.max(24, Math.round(frame.width * scale));
    sample.height = Math.max(24, Math.round(frame.height * scale));
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(frame, 0, 0, sample.width, sample.height);
    return {
      width: sample.width,
      height: sample.height,
      pixels: context.getImageData(0, 0, sample.width, sample.height).data,
    };
  }

  function estimateTrackedPoint(previousFrame, currentFrame, previousBounds) {
    if (!previousFrame || !previousBounds) {
      return { x: 0.5, y: 0.5 };
    }
    const previous = trackingPreview(previousFrame);
    const current = trackingPreview(currentFrame);
    const scaleX = previous.width / previousFrame.width;
    const scaleY = previous.height / previousFrame.height;
    const centerX = previousBounds.centerX * scaleX;
    const centerY = previousBounds.centerY * scaleY;
    const halfWidth = clamp(previousBounds.width * scaleX * 0.3, 3, 18);
    const halfHeight = clamp(previousBounds.height * scaleY * 0.3, 3, 18);
    const radius = clamp(Math.max(previousBounds.width * scaleX, previousBounds.height * scaleY) * 1.4, 10, 44);
    const sampleOffsets = [];
    for (let py = -1; py <= 1; py += 0.5) {
      for (let px = -1; px <= 1; px += 0.5) sampleOffsets.push([px, py]);
    }

    let best = { score: Infinity, x: centerX, y: centerY };
    for (let candidateY = centerY - radius; candidateY <= centerY + radius; candidateY += 2) {
      for (let candidateX = centerX - radius; candidateX <= centerX + radius; candidateX += 2) {
        if (candidateX < 1 || candidateY < 1 || candidateX >= current.width - 1 || candidateY >= current.height - 1) continue;
        let score = 0;
        let compared = 0;
        for (const [unitX, unitY] of sampleOffsets) {
          const previousX = Math.round(clamp(centerX + unitX * halfWidth, 0, previous.width - 1));
          const previousY = Math.round(clamp(centerY + unitY * halfHeight, 0, previous.height - 1));
          const currentX = Math.round(clamp(candidateX + unitX * halfWidth, 0, current.width - 1));
          const currentY = Math.round(clamp(candidateY + unitY * halfHeight, 0, current.height - 1));
          const previousOffset = (previousY * previous.width + previousX) * 4;
          const currentOffset = (currentY * current.width + currentX) * 4;
          const red = previous.pixels[previousOffset] - current.pixels[currentOffset];
          const green = previous.pixels[previousOffset + 1] - current.pixels[currentOffset + 1];
          const blue = previous.pixels[previousOffset + 2] - current.pixels[currentOffset + 2];
          score += red * red + green * green + blue * blue;
          compared += 1;
        }
        const distancePenalty = Math.hypot(candidateX - centerX, candidateY - centerY) * 65;
        score = score / Math.max(1, compared) + distancePenalty;
        if (score < best.score) best = { score, x: candidateX, y: candidateY };
      }
    }
    return { x: clamp(best.x / current.width, 0, 1), y: clamp(best.y / current.height, 0, 1) };
  }

  function dominantColor(source, bounds) {
    const sample = document.createElement("canvas");
    sample.width = 24;
    sample.height = 24;
    const context = sample.getContext("2d", { willReadFrequently: true });
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, 24, 24);
    const pixels = context.getImageData(0, 0, 24, 24).data;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 40) continue;
      red += pixels[index];
      green += pixels[index + 1];
      blue += pixels[index + 2];
      count += 1;
    }
    if (!count) return state.accent;
    return "#" + [red, green, blue]
      .map((value) => Math.round(value / count).toString(16).padStart(2, "0"))
      .join("");
  }

  function candidateLooksUsable(bounds, frame) {
    if (!bounds) return false;
    const ratio = bounds.area / (frame.width * frame.height);
    return ratio > 0.00035 && ratio < 0.88;
  }

  async function trackAtPoint(point) {
    if (!state.file || state.processing) return;
    const generation = ++state.generation;
    state.processing = true;
    state.selecting = false;
    state.selectionPoint = point;
    state.samples = [];
    state.frozenFrame = null;
    video.pause();
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const latestStart = Math.max(0, duration - Math.min(0.25, duration));
    const start = clamp(video.currentTime, 0, latestStart);
    const end = Math.min(Math.max(start + 0.15, start + state.trackSpan), Math.max(start, duration - 0.01));
    state.trackStart = start;
    state.trackEnd = end;
    const times = Array.from({ length: state.sampleCount }, (_, index) =>
      start + (end - start) * (state.sampleCount === 1 ? 0 : index / (state.sampleCount - 1))
    );
    $("#motionTrackProgress").hidden = false;
    $("#motionPointMarker").hidden = false;
    setStatus("working", "Preparing the local object tracker");
    syncControls();
    render();

    let previousFrame = null;
    let previousBounds = null;
    let trackedPoint = point;
    const tracked = [];

    try {
      const extractor = await getPointExtractor();
      for (let index = 0; index < times.length; index += 1) {
        if (generation !== state.generation) return;
        $("#motionTrackProgressText").textContent = "Tracing moment " + (index + 1) + " of " + times.length;
        $("#motionTrackProgress").style.setProperty("--progress", ((index + 0.25) / times.length * 100) + "%");
        await seekVideo(times[index]);
        const frame = captureFrame(generation + ":" + index + ":" + times[index].toFixed(4));
        if (!state.frozenFrame) state.frozenFrame = cloneCanvas(frame);
        if (previousFrame && previousBounds) {
          trackedPoint = estimateTrackedPoint(previousFrame, frame, previousBounds);
        }

        let cutout = null;
        let bounds = null;
        const attempts = [
          trackedPoint,
          previousBounds ? {
            x: clamp(previousBounds.centerX / previousFrame.width, 0, 1),
            y: clamp(previousBounds.centerY / previousFrame.height, 0, 1),
          } : null,
        ].filter(Boolean);
        for (const attempt of attempts) {
          try {
            frame.dataset.pointExtractorIdentity = generation + ":" + index + ":" + attempt.x.toFixed(4) + ":" + attempt.y.toFixed(4);
            const candidate = await extractor.extract(frame, attempt);
            const candidateBounds = findAlphaBounds(candidate);
            if (!candidateLooksUsable(candidateBounds, frame)) continue;
            cutout = candidate;
            bounds = candidateBounds;
            trackedPoint = {
              x: clamp(bounds.centerX / frame.width, 0, 1),
              y: clamp(bounds.centerY / frame.height, 0, 1),
            };
            break;
          } catch (_) {
            // A missed sample is skipped; the next sample continues from the previous valid track.
          }
        }

        if (cutout && bounds) {
          tracked.push({
            time: times[index],
            cutout,
            bounds,
            center: { ...trackedPoint },
            frameWidth: frame.width,
            frameHeight: frame.height,
            color: dominantColor(cutout, bounds),
          });
          previousBounds = bounds;
        }
        previousFrame = frame;
        state.samples = [...tracked];
        render();
      }

      if (generation !== state.generation) return;
      if (tracked.length < 2) {
        throw new Error("The subject could not be followed across enough frames. Pause on a clearer frame or shorten the sample span.");
      }
      state.samples = tracked;
      state.trackStart = tracked[0].time;
      state.trackEnd = tracked[tracked.length - 1].time;
      await seekVideo(state.trackStart);
      setStatus("ready", tracked.length + " motion moments ready");
      showToast("Motion Specimen tracked " + tracked.length + " moments locally.");
      refreshPalette(false);
    } catch (error) {
      state.samples = [];
      setStatus("error", error?.message || "The subject could not be tracked");
      showToast(error?.message || "The subject could not be tracked.");
    } finally {
      if (generation === state.generation) {
        state.processing = false;
        $("#motionTrackProgress").hidden = true;
        $("#motionPointMarker").hidden = true;
        syncControls();
        render();
      }
    }
  }

  function activeSampleIndex() {
    if (!state.samples.length) return 0;
    const span = Math.max(0.001, state.trackEnd - state.trackStart);
    const progress = clamp((video.currentTime - state.trackStart) / span, 0, 0.999999);
    return clamp(Math.floor(progress * state.samples.length), 0, state.samples.length - 1);
  }

  function sampleRect(sample) {
    const fit = sourceTransform(sample.frameWidth, sample.frameHeight);
    const first = state.samples[0] || sample;
    const firstCenterX = fit.x + first.center.x * fit.width;
    const firstCenterY = fit.y + first.center.y * fit.height;
    const rawCenterX = fit.x + sample.center.x * fit.width;
    const rawCenterY = fit.y + sample.center.y * fit.height;
    const centerX = firstCenterX + (rawCenterX - firstCenterX) * state.spread + state.offsetX * WIDTH;
    const centerY = firstCenterY + (rawCenterY - firstCenterY) * state.spread + state.offsetY * HEIGHT;
    const width = sample.bounds.width * fit.scale * state.subjectScale;
    const height = sample.bounds.height * fit.scale * state.subjectScale;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height, centerX, centerY };
  }

  function drawSample(sample, options = {}) {
    const rect = sampleRect(sample);
    ctx.save();
    ctx.globalAlpha = options.alpha ?? 1;
    ctx.globalCompositeOperation = options.blend || "source-over";
    if (options.glow) {
      ctx.shadowColor = options.glow;
      ctx.shadowBlur = options.blur || 18;
    }
    ctx.drawImage(
      sample.cutout,
      sample.bounds.x,
      sample.bounds.y,
      sample.bounds.width,
      sample.bounds.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height
    );
    ctx.restore();
    return rect;
  }

  function drawContainedSample(sample, cell, alpha = 1) {
    const availableWidth = Math.max(1, cell.width - 24);
    const availableHeight = Math.max(1, cell.height - 54);
    const scale = Math.min(availableWidth / sample.bounds.width, availableHeight / sample.bounds.height);
    const width = sample.bounds.width * scale;
    const height = sample.bounds.height * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      sample.cutout,
      sample.bounds.x,
      sample.bounds.y,
      sample.bounds.width,
      sample.bounds.height,
      cell.x + (cell.width - width) / 2,
      cell.y + 34 + (availableHeight - height) / 2,
      width,
      height
    );
    ctx.restore();
  }

  function drawBackground() {
    const forcedSolid = state.mode === "grid";
    const forcedFrozen = state.mode === "freeze";
    if (!forcedSolid && !forcedFrozen && state.backgroundMode === "live" && video.readyState >= 2) {
      drawSource(video);
      ctx.fillStyle = "rgba(23,25,20,0.08)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    }
    if (!forcedSolid && state.backgroundMode === "frozen" && state.frozenFrame) {
      drawSource(state.frozenFrame);
      ctx.fillStyle = "rgba(243,240,232,0.18)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    }
    if (forcedFrozen && state.frozenFrame) {
      drawSource(state.frozenFrame);
      return;
    }
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawEcho() {
    const count = state.samples.length;
    state.samples.forEach((sample, index) => {
      const age = count <= 1 ? 1 : index / (count - 1);
      const alpha = clamp(1 - state.decay * (1 - age), 0.08, 1);
      drawSample(sample, {
        alpha,
        glow: index === count - 1 ? state.accent : "",
        blur: 12,
      });
    });
  }

  function drawStrobe() {
    state.samples.forEach((sample, index) => {
      const selected = index === activeSampleIndex();
      drawSample(sample, {
        alpha: selected ? 1 : 0.72,
        blend: state.backgroundMode === "solid" ? "multiply" : "source-over",
        glow: selected ? state.accent : "",
        blur: 14,
      });
    });
  }

  function drawGrid() {
    const count = state.samples.length;
    const columns = count <= 6 ? 2 : count <= 12 ? 3 : 4;
    const rows = Math.ceil(count / columns);
    const margin = 38;
    const gap = 12;
    const cellWidth = (WIDTH - margin * 2 - gap * (columns - 1)) / columns;
    const cellHeight = (HEIGHT - margin * 2 - gap * (rows - 1)) / rows;
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    state.samples.forEach((sample, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cell = {
        x: margin + column * (cellWidth + gap),
        y: margin + row * (cellHeight + gap),
        width: cellWidth,
        height: cellHeight,
      };
      ctx.strokeStyle = index === activeSampleIndex() ? state.accent : state.text + "55";
      ctx.lineWidth = index === activeSampleIndex() ? 3 : 1;
      ctx.strokeRect(cell.x, cell.y, cell.width, cell.height);
      ctx.fillStyle = state.text;
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(String(index + 1).padStart(2, "0") + " / " + formatTime(sample.time), cell.x + 10, cell.y + 19);
      drawContainedSample(sample, cell, index === activeSampleIndex() ? 1 : 0.86);
    });
  }

  function drawRibbon() {
    const points = state.samples.map((sample) => sampleRect(sample));
    if (!points.length) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = state.accent;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = clamp(points.reduce((sum, point) => sum + Math.min(point.width, point.height), 0) / points.length * 0.42, 26, 180);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (!index) ctx.moveTo(point.centerX, point.centerY);
      else ctx.lineTo(point.centerX, point.centerY);
    });
    ctx.stroke();
    ctx.restore();

    for (let index = 0; index < state.samples.length - 1; index += 1) {
      const sample = state.samples[index];
      const from = points[index];
      const to = points[index + 1];
      const strips = 10;
      for (let strip = 0; strip < strips; strip += 1) {
        const progress = strip / strips;
        const sourceX = sample.bounds.x + sample.bounds.width * progress;
        const destinationX = from.centerX + (to.centerX - from.centerX) * progress;
        const destinationY = from.centerY + (to.centerY - from.centerY) * progress;
        const stripWidth = Math.max(1, sample.bounds.width / strips);
        ctx.save();
        ctx.globalAlpha = 0.28 + progress * 0.18;
        ctx.drawImage(
          sample.cutout,
          sourceX,
          sample.bounds.y,
          stripWidth,
          sample.bounds.height,
          destinationX - 3,
          destinationY - from.height / 2,
          7,
          from.height
        );
        ctx.restore();
      }
    }
    const active = state.samples[activeSampleIndex()] || state.samples[state.samples.length - 1];
    drawSample(active, { alpha: 1, glow: state.accent, blur: 18 });
  }

  function parsedLabels() {
    return state.labels.map((label) => label.trim()).filter(Boolean);
  }

  function drawPoseType() {
    const sample = state.samples[activeSampleIndex()] || state.samples[0];
    if (!sample) return;
    const rect = drawSample(sample, { alpha: 1, glow: state.accent, blur: 10 });
    const anchors = [
      { x: rect.centerX, y: rect.y + rect.height * 0.12, dx: -rect.width * 0.64, dy: -58 },
      { x: rect.x + rect.width * 0.16, y: rect.y + rect.height * 0.43, dx: -rect.width * 0.52, dy: 0 },
      { x: rect.centerX, y: rect.centerY, dx: rect.width * 0.12, dy: 18 },
      { x: rect.x + rect.width * 0.84, y: rect.y + rect.height * 0.43, dx: rect.width * 0.46, dy: -4 },
      { x: rect.centerX, y: rect.y + rect.height * 0.92, dx: -rect.width * 0.48, dy: 74 },
    ];
    const labels = parsedLabels();
    anchors.forEach((anchor, index) => {
      const label = labels[index % Math.max(1, labels.length)] || "MOTION / " + (index + 1);
      const labelX = clamp(anchor.x + anchor.dx, 34, WIDTH - 250);
      const labelY = clamp(anchor.y + anchor.dy, 36, HEIGHT - 26);
      const showLabels = state.poseContent !== "icons";
      const showIcons = state.poseContent !== "labels";
      if (showLabels) {
        ctx.strokeStyle = state.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(anchor.x, anchor.y);
        ctx.lineTo(labelX - 8, labelY - 5);
        ctx.stroke();
      }
      if (showIcons) {
        const iconSize = clamp(state.typeSize * 2.15, 28, 76);
        ctx.fillStyle = state.accent;
        ctx.fillRect(anchor.x - iconSize / 2, anchor.y - iconSize / 2, iconSize, iconSize);
        const icon = poseIcons[index % poseIcons.length];
        if (icon.complete && icon.naturalWidth) {
          ctx.drawImage(icon, anchor.x - iconSize * 0.29, anchor.y - iconSize * 0.29, iconSize * 0.58, iconSize * 0.58);
        }
      } else {
        ctx.fillStyle = state.accent;
        ctx.fillRect(anchor.x - 3, anchor.y - 3, 6, 6);
      }
      if (showLabels) {
        ctx.fillStyle = state.text;
        ctx.font = "700 " + state.typeSize + "px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(label.toUpperCase(), labelX, labelY);
      }
    });
  }

  function drawFreezeFlow() {
    const current = activeSampleIndex();
    for (let offset = 2; offset >= 0; offset -= 1) {
      const index = current - offset;
      if (index < 0) continue;
      drawSample(state.samples[index], {
        alpha: offset === 0 ? 1 : 0.16 * (3 - offset),
        glow: offset === 0 ? state.accent : "",
        blur: 14,
      });
    }
  }

  function drawSpecimenHeader() {
    if (!state.samples.length) return;
    ctx.save();
    ctx.fillStyle = state.text;
    ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("FIELD/STUDY · MOTION SPECIMEN", 28, 34);
    ctx.textAlign = "right";
    ctx.fillText(modes[state.mode] + " · " + state.samples.length + " MOMENTS", WIDTH - 28, 34);
    ctx.restore();
  }

  function render() {
    setCanvasSize();
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = state.background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const liveFrameReady = video.readyState >= 2 && video.videoWidth && video.videoHeight;
    if (!state.file || (!liveFrameReady && !state.previewFrame)) {
      ctx.fillStyle = "#d9ddd6";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      return;
    }
    drawBackground();
    if (!state.samples.length) {
      const previewSource = video.paused && state.previewFrame ? state.previewFrame : video;
      if (!drawSource(previewSource) && state.previewFrame) drawSource(state.previewFrame);
      ctx.fillStyle = "rgba(23,25,20,0.28)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      if (state.selecting) {
        ctx.strokeStyle = state.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.strokeRect(18, 18, WIDTH - 36, HEIGHT - 36);
        ctx.setLineDash([]);
      }
      return;
    }

    if (state.mode === "echo") drawEcho();
    else if (state.mode === "strobe") drawStrobe();
    else if (state.mode === "grid") drawGrid();
    else if (state.mode === "ribbon") drawRibbon();
    else if (state.mode === "pose") drawPoseType();
    else drawFreezeFlow();
    drawSpecimenHeader();
  }

  function preferredRecordingFormat() {
    if (!window.MediaRecorder) return null;
    const formats = [
      { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4", label: "MP4" },
      { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
      { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM" },
      { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM" },
      { mimeType: "video/webm", extension: "webm", label: "WebM" },
    ];
    return formats.find((format) => MediaRecorder.isTypeSupported(format.mimeType)) || null;
  }

  function videoCaptureStream() {
    const capture = video.captureStream || video.mozCaptureStream;
    return typeof capture === "function" ? capture.call(video) : null;
  }

  function stopRenderLoop() {
    if (state.frameRequest !== null) cancelAnimationFrame(state.frameRequest);
    state.frameRequest = null;
  }

  function scheduleRenderLoop() {
    if (state.frameRequest !== null || video.paused || !state.canvasVisible) return;
    const tick = () => {
      state.frameRequest = null;
      if (video.paused || document.body.dataset.activeTool !== "motion" || !state.canvasVisible) return;
      if (state.samples.length && state.trackEnd > state.trackStart && video.currentTime >= state.trackEnd - 0.01) {
        video.currentTime = state.trackStart;
      }
      syncPlayback();
      render();
      state.frameRequest = requestAnimationFrame(tick);
    };
    state.frameRequest = requestAnimationFrame(tick);
  }

  function syncPlayback() {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    $("#motionPlayhead").max = String(duration || 1);
    $("#motionPlayhead").value = String(clamp(video.currentTime || 0, 0, duration || 0));
    $("#motionVideoTime").textContent = formatTime(video.currentTime) + " / " + formatTime(duration);
    const playing = !video.paused && !video.ended;
    const button = $("#motionPlayToggle");
    button.classList.toggle("playing", playing);
    button.setAttribute("aria-pressed", String(playing));
    $("span", button).textContent = playing ? "Pause" : "Play";
    video.muted = !state.sound;
    video.playbackRate = state.playbackRate;
    const soundButton = $("#motionSoundToggle");
    soundButton.setAttribute("aria-pressed", String(state.sound));
    soundButton.setAttribute("aria-label", "Turn source sound " + (state.sound ? "off" : "on"));
    soundButton.title = "Sound " + (state.sound ? "on" : "off");
  }

  async function togglePlay() {
    if (!state.file || state.processing) return;
    if (video.paused) {
      if (state.samples.length && (video.currentTime < state.trackStart || video.currentTime >= state.trackEnd - 0.01)) {
        await seekVideo(state.trackStart);
      }
      try {
        await video.play();
      } catch (_) {
        showToast("Press Play again to start this video.");
      }
    } else {
      video.pause();
    }
    syncPlayback();
    scheduleRenderLoop();
  }

  function renderPalette() {
    window.projectPalette?.render(
      $("#motionPaletteSwatches"),
      state.palette,
      (color) => {
        if (state.paletteTarget === "background") state.background = color;
        else if (state.paletteTarget === "text") state.text = color;
        else state.accent = color;
        syncControls();
        render();
      },
      state.paletteTarget === "background" ? state.background : state.paletteTarget === "text" ? state.text : state.accent
    );
  }

  function refreshPalette(showMessage = true) {
    if (!state.file || video.readyState < 2) {
      if (showMessage) showToast("Add a video before finding its colors.");
      return;
    }
    state.palette = window.projectPalette?.extract([state.frozenFrame || video], 8) || state.palette;
    renderPalette();
    if (showMessage) showToast("Video colors refreshed from the current specimen frame.");
  }

  function syncControls() {
    const ready = Boolean(state.file && video.readyState >= 2);
    $("#motionDropIdle").hidden = ready;
    $("#motionSourcePreview").hidden = !ready;
    $("#motionPlayback").hidden = !ready;
    $("#motionPlaybackMeta").hidden = !ready;
    $("#motionClearSource").hidden = !ready;
    $("#motionSelectSubject").disabled = !ready || state.processing;
    $("#motionSelectSubject span").textContent = state.samples.length ? "Select another object" : "Select an object on canvas";
    $("#motionSelectOverlay").hidden = !state.selecting;
    $("#motionEmptyOverlay").hidden = Boolean(state.file);
    $("#motionSampleCount").value = state.sampleCount;
    $("#motionSampleCountOutput").textContent = String(state.sampleCount);
    $("#motionTrackSpan").value = state.trackSpan;
    $("#motionTrackSpanOutput").textContent = state.trackSpan + "s";
    $("#motionSubjectScale").value = Math.round(state.subjectScale * 100);
    $("#motionSubjectScaleOutput").textContent = Math.round(state.subjectScale * 100) + "%";
    $("#motionTrailSpread").value = Math.round(state.spread * 100);
    $("#motionTrailSpreadOutput").textContent = Math.round(state.spread * 100) + "%";
    $("#motionOpacityDecay").value = Math.round(state.decay * 100);
    $("#motionOpacityDecayOutput").textContent = Math.round(state.decay * 100) + "%";
    $("#motionOffsetX").value = Math.round(state.offsetX * 100);
    $("#motionOffsetXOutput").textContent = Math.round(state.offsetX * 100) + "%";
    $("#motionOffsetY").value = Math.round(state.offsetY * 100);
    $("#motionOffsetYOutput").textContent = Math.round(state.offsetY * 100) + "%";
    $("#motionPlaybackSpeed").value = Math.round(state.playbackRate * 100);
    $("#motionPlaybackSpeedOutput").textContent = formatRate(state.playbackRate);
    $("#motionSourceFraming").value = state.sourceFraming;
    $("#motionTypeSize").value = state.typeSize;
    $("#motionTypeSizeOutput").textContent = state.typeSize + "px";
    $("#motionAccentColor").value = state.accent;
    $("#motionAccentColorOutput").textContent = state.accent.toUpperCase();
    $("#motionBackgroundColor").value = state.background;
    $("#motionBackgroundColorOutput").textContent = state.background.toUpperCase();
    $("#motionTextColor").value = state.text;
    $("#motionTextColorOutput").textContent = state.text.toUpperCase();
    $("#motionPaletteTarget").value = state.paletteTarget;
    $$("[data-motion-mode]").forEach((button) => {
      const selected = button.dataset.motionMode === state.mode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$("[data-motion-background]").forEach((button) => {
      const selected = button.dataset.motionBackground === state.backgroundMode;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $$("[data-motion-pose-content]").forEach((button) => {
      const selected = button.dataset.motionPoseContent === state.poseContent;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    $("#motionLayerStatus").textContent = state.processing
      ? "TRACKING SUBJECT"
      : state.samples.length
        ? modes[state.mode] + " · " + state.samples.length + " MOMENTS"
        : ready ? "SELECT A SUBJECT" : "WAITING FOR VIDEO";
    syncPlayback();
    renderPalette();
  }

  async function useFile(file) {
    if (!file || !file.type.startsWith("video/")) {
      showToast("Motion Specimen needs a video file.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      showToast("That video is larger than the 500 MB local limit.");
      return;
    }
    state.generation += 1;
    state.processing = false;
    state.selecting = false;
    state.samples = [];
    state.frozenFrame = null;
    state.previewFrame = null;
    video.pause();
    stopRenderLoop();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.file = file;
    state.sourceFraming = "fit";
    state.fileBase = safeFileBase(file.name);
    state.sourceUrl = URL.createObjectURL(file);
    video.src = state.sourceUrl;
    video.loop = false;
    video.muted = true;
    video.load();
    setStatus("working", "Opening the video locally");
    try {
      await waitForVideoReady();
      const firstFrameTime = Math.min(0.04, Math.max(0, (video.duration || 0) - 0.01));
      if (firstFrameTime > 0) await seekVideo(firstFrameTime);
      retainPreviewFrame();
      state.trackSpan = clamp(Math.min(6, Math.max(1, video.duration || 6)), 1, 15);
      $("#motionSourceName").textContent = file.name;
      $("#motionSourceMeta").textContent = fileMeta(file) + " · " + formatTime(video.duration);
      $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
      setStatus("ready", "Video ready · pause, then select a subject");
      refreshPalette(false);
      syncControls();
      render();
      showToast("Video ready. Click Select an object, then choose it on the canvas.");
    } catch (error) {
      setStatus("error", error.message);
      showToast(error.message);
      clearSource();
    }
  }

  function clearSource() {
    state.generation += 1;
    state.processing = false;
    state.selecting = false;
    state.samples = [];
    state.frozenFrame = null;
    state.previewFrame = null;
    state.file = null;
    video.pause();
    stopRenderLoop();
    video.removeAttribute("src");
    video.load();
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    state.sourceUrl = null;
    input.value = "";
    setStatus("", "Waiting for a video");
    $("#fileNameHeader").textContent = "MOTION SPECIMEN";
    syncControls();
    render();
  }

  function resetComposition(showMessage = true) {
    Object.assign(state, defaultComposition());
    state.mode = "echo";
    state.backgroundMode = "frozen";
    state.accent = "#d6ff45";
    state.background = "#f3f0e8";
    state.text = "#171914";
    state.paletteTarget = "accent";
    state.poseContent = "labels";
    state.playbackRate = 1;
    state.sound = false;
    video.playbackRate = 1;
    video.muted = true;
    syncControls();
    render();
    if (showMessage) showToast("Motion Specimen composition reset.");
  }

  function reset() {
    clearSource();
    resetComposition(false);
    state.sampleCount = 9;
    state.trackSpan = 6;
    state.labels = ["HEAD / DIRECTION", "LEFT / GESTURE", "BODY / CENTER", "RIGHT / REACH", "GROUND / WEIGHT"];
    $("#motionLabels").value = state.labels.join("\n");
    showToast("Motion Specimen reset.");
  }

  function exportPng() {
    if (!state.samples.length) {
      showToast("Track a subject before exporting.");
      return;
    }
    render();
    const output = window.outputFormat.dimensions(state.outputWidth);
    const filename = state.fileBase + "-motion-specimen-" + output.width + "x" + output.height + ".png";
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
    showToast("Motion Specimen PNG exported.");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportAnimated() {
    if (state.recording) return;
    if (!state.samples.length) {
      showToast("Track a subject before exporting motion.");
      return;
    }
    const format = preferredRecordingFormat();
    if (!format || !canvas.captureStream || !window.MediaRecorder) {
      showToast("Animated export is unavailable in this browser. PNG export remains available.");
      return;
    }
    const duration = clamp(Math.round(Number(state.clipDuration) || 10), 3, MAX_CLIP_DURATION);
    const snapshot = { time: video.currentTime, paused: video.paused };
    let stream = null;
    let sourceStream = null;
    let recorder = null;
    let stopTimer = null;
    let includedAudio = false;
    try {
      state.recording = true;
      await seekVideo(state.trackStart);
      await video.play();
      scheduleRenderLoop();
      render();
      syncControls();
      showToast("Recording " + duration + "s locally · keep this tab open.");
      stream = canvas.captureStream(30);
      if (state.sound) {
        sourceStream = videoCaptureStream();
        const audioTrack = sourceStream?.getAudioTracks?.()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          includedAudio = true;
        }
      }
      recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: 8_000_000 });
      const chunks = [];
      const completed = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: format.mimeType })), { once: true });
        recorder.addEventListener("error", () => reject(recorder.error || new Error("Motion recording failed.")), { once: true });
      });
      recorder.start(250);
      stopTimer = window.setTimeout(() => {
        if (recorder?.state === "recording") recorder.stop();
      }, duration * 1000);
      const blob = await completed;
      if (!blob.size) throw new Error("The browser returned an empty animated export.");
      downloadBlob(blob, state.fileBase + "-motion-specimen-" + duration + "s." + format.extension);
      showToast(duration + "s Motion Specimen " + format.label + " exported" + (includedAudio ? " with sound." : "."));
    } catch (error) {
      if (recorder?.state === "recording") recorder.stop();
      showToast(error?.message || "Motion export could not be created.");
    } finally {
      if (stopTimer) clearTimeout(stopTimer);
      stream?.getTracks().forEach((track) => track.stop());
      sourceStream?.getTracks().forEach((track) => {
        if (!stream?.getTracks().includes(track)) track.stop();
      });
      state.recording = false;
      if (snapshot.paused) video.pause();
      await seekVideo(snapshot.time).catch(() => {});
      syncControls();
      render();
      if (!video.paused) scheduleRenderLoop();
    }
  }

  input.addEventListener("change", () => useFile(input.files?.[0]));
  $("#motionEmptyChooseButton").addEventListener("click", () => input.click());
  $("#motionClearSource").addEventListener("click", clearSource);
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    useFile(event.dataTransfer?.files?.[0]);
  });

  $("#motionSelectSubject").addEventListener("click", () => {
    if (!state.file || state.processing) return;
    video.pause();
    state.selecting = true;
    syncControls();
    render();
    canvas.focus();
    showToast("Click near the center of the person or object you want to track.");
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!state.selecting || state.processing) return;
    const artboardPoint = canvasPoint(event);
    const sourcePoint = artboardToSource(artboardPoint);
    if (!sourcePoint) return;
    const rect = canvas.getBoundingClientRect();
    const marker = $("#motionPointMarker");
    marker.style.left = ((event.clientX - rect.left) / rect.width * 100) + "%";
    marker.style.top = ((event.clientY - rect.top) / rect.height * 100) + "%";
    trackAtPoint(sourcePoint);
  });

  $("#motionPlayToggle").addEventListener("click", togglePlay);
  $("#motionSoundToggle").addEventListener("click", () => {
    state.sound = !state.sound;
    syncControls();
    showToast("Motion Specimen sound " + (state.sound ? "on." : "off."));
  });
  $("#motionPlayhead").addEventListener("input", async (event) => {
    video.pause();
    await seekVideo(event.target.value);
    syncPlayback();
    render();
  });
  $("#motionPlaybackSpeed").addEventListener("input", (event) => {
    state.playbackRate = Number(event.target.value) / 100;
    video.playbackRate = state.playbackRate;
    syncControls();
  });
  $("#motionSourceFraming").addEventListener("change", (event) => {
    state.sourceFraming = event.target.value === "fill" ? "fill" : "fit";
    render();
    showToast(state.sourceFraming === "fit" ? "The complete video is centered in the canvas." : "The video now fills the canvas and may be cropped.");
  });
  video.addEventListener("play", () => {
    syncPlayback();
    scheduleRenderLoop();
  });
  video.addEventListener("pause", () => {
    stopRenderLoop();
    if (!state.samples.length) retainPreviewFrame();
    syncPlayback();
    render();
  });
  video.addEventListener("seeked", () => {
    if (!state.samples.length) retainPreviewFrame();
    syncPlayback();
    render();
  });
  video.addEventListener("timeupdate", syncPlayback);

  $("#motionSampleCount").addEventListener("input", (event) => {
    state.sampleCount = Number(event.target.value);
    syncControls();
    if (state.samples.length) $("#motionTrackingNote").textContent = "Select the object again to rebuild with " + state.sampleCount + " moments.";
  });
  $("#motionTrackSpan").addEventListener("input", (event) => {
    state.trackSpan = Number(event.target.value);
    syncControls();
    if (state.samples.length) $("#motionTrackingNote").textContent = "Select the object again to rebuild across " + state.trackSpan + " seconds.";
  });
  $$("[data-motion-mode]").forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.motionMode;
    syncControls();
    render();
  }));
  $$("[data-motion-background]").forEach((button) => button.addEventListener("click", () => {
    state.backgroundMode = button.dataset.motionBackground;
    syncControls();
    render();
  }));
  $$("[data-motion-pose-content]").forEach((button) => button.addEventListener("click", () => {
    state.poseContent = button.dataset.motionPoseContent;
    syncControls();
    render();
  }));
  [
    ["#motionSubjectScale", "subjectScale", 100],
    ["#motionTrailSpread", "spread", 100],
    ["#motionOpacityDecay", "decay", 100],
    ["#motionOffsetX", "offsetX", 100],
    ["#motionOffsetY", "offsetY", 100],
  ].forEach(([selector, key, divisor]) => $(selector).addEventListener("input", (event) => {
    state[key] = Number(event.target.value) / divisor;
    syncControls();
    render();
  }));
  $("#motionResetComposition").addEventListener("click", () => resetComposition(true));
  $("#motionLabels").addEventListener("input", (event) => {
    state.labels = event.target.value.split(/\n+/);
    render();
  });
  $("#motionTypeSize").addEventListener("input", (event) => {
    state.typeSize = Number(event.target.value);
    syncControls();
    render();
  });
  $("#motionRefreshPalette").addEventListener("click", () => refreshPalette(true));
  $("#motionPaletteTarget").addEventListener("change", (event) => {
    state.paletteTarget = event.target.value;
    renderPalette();
  });
  [
    ["#motionAccentColor", "accent"],
    ["#motionBackgroundColor", "background"],
    ["#motionTextColor", "text"],
  ].forEach(([selector, key]) => $(selector).addEventListener("input", (event) => {
    state[key] = event.target.value;
    syncControls();
    render();
  }));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.dataset.activeTool === "motion") {
      state.selecting = false;
      syncControls();
      render();
    }
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(([entry]) => {
      state.canvasVisible = Boolean(entry?.isIntersecting);
      if (state.canvasVisible) scheduleRenderLoop();
      else stopRenderLoop();
    }, { threshold: 0.01 });
    observer.observe(canvas);
  }

  function activate() {
    $("#fileNameHeader").textContent = state.file
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "MOTION SPECIMEN";
    syncControls();
    render();
    scheduleRenderLoop();
  }

  function deactivate() {
    video.pause();
    stopRenderLoop();
  }

  window.motionSpecimen = {
    activate,
    deactivate,
    refreshFormat: render,
    reset,
    exportPng,
    exportAnimated,
    getExportOptions: () => ({
      canExport: Boolean(state.samples.length),
      motionAvailable: Boolean(state.samples.length && preferredRecordingFormat()),
      outputWidth: state.outputWidth,
      outputHeight: window.outputFormat.dimensions(state.outputWidth).height,
      clipDuration: state.clipDuration,
      recording: state.recording,
      audioEnabled: Boolean(state.sound),
      soundAvailable: Boolean(state.file),
      format: preferredRecordingFormat(),
    }),
    setClipDuration: (duration) => {
      state.clipDuration = clamp(Number(duration) || 10, 3, MAX_CLIP_DURATION);
      syncControls();
    },
    setOutputWidth: (width) => {
      state.outputWidth = [900, 1350].includes(Number(width)) ? Number(width) : 900;
      render();
    },
  };

  syncControls();
  render();
})();
