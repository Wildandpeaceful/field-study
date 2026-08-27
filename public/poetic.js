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
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const MAX_GIF_BYTES = 50 * 1024 * 1024;
  const MAX_GIF_PIXELS = 16_000_000;
  const MAX_GIF_FRAMES = 2_000;
  const MAX_CLIP_DURATION = 60;
  let motionFrameHandle = null;
  let videoFrameHandle = null;
  let videoFrameDriver = null;
  const photoLayer = document.createElement("canvas");
  photoLayer.width = WIDTH;
  photoLayer.height = PHOTO_HEIGHT;
  const photoContext = photoLayer.getContext("2d");
  const defaultCaptionTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, locked: false });

  const state = {
    image: null,
    sourceUrl: null,
    file: null,
    sourceKind: "image",
    gif: null,
    gifPlaying: false,
    playbackRate: 1,
    sound: false,
    clipDuration: 10,
    recording: false,
    recordingProgress: 0,
    resumeVideoOnActivate: false,
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
    captionTransform: defaultCaptionTransform(),
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
      image.onerror = () => reject(new Error("The image could not be decoded."));
      image.src = url;
    });
  }

  function sourceVideo() {
    return state.sourceKind === "video" && state.image instanceof HTMLVideoElement
      ? state.image
      : null;
  }

  function isGifFile(file) {
    return Boolean(file && (file.type === "image/gif" || /\.gif$/i.test(file.name || "")));
  }

  function hasMotionSource() {
    return Boolean(sourceVideo() || state.gif?.frameCount > 1);
  }

  function sourceDimensions() {
    const video = sourceVideo();
    return video
      ? { width: video.videoWidth, height: video.videoHeight }
      : { width: state.image?.width || 0, height: state.image?.height || 0 };
  }

  function formatFileMeta(file, duration = 0) {
    const size = file.size > 1024 * 1024
      ? (file.size / 1024 / 1024).toFixed(1) + " MB"
      : Math.max(1, Math.round(file.size / 1024)) + " KB";
    const type = isGifFile(file) ? "GIF" : (file.type.split("/")[1] || "MEDIA").toUpperCase();
    return `${size} · ${type}${duration ? ` · ${formatTime(duration)}` : ""}`;
  }

  function formatTime(value) {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function clearPixelRect(pixels, canvasWidth, x, y, width, height) {
    const left = clamp(Math.floor(x), 0, canvasWidth);
    const right = clamp(Math.ceil(x + width), 0, canvasWidth);
    const top = Math.max(0, Math.floor(y));
    const bottom = Math.max(top, Math.ceil(y + height));
    for (let row = top; row < bottom; row += 1) {
      pixels.fill(0, (row * canvasWidth + left) * 4, (row * canvasWidth + right) * 4);
    }
  }

  async function createGifPlayer(file) {
    const GifDecoder = typeof GifReader === "function" ? GifReader : window.GifReader;
    if (typeof GifDecoder !== "function") throw new Error("The local GIF decoder is unavailable. Reload the app and try again.");
    const reader = new GifDecoder(new Uint8Array(await file.arrayBuffer()));
    const width = reader.width;
    const height = reader.height;
    const frameCount = reader.numFrames();
    if (!width || !height || !frameCount) throw new Error("The GIF does not contain a usable image frame.");
    if (width * height > MAX_GIF_PIXELS) throw new Error("That GIF is too large to animate locally. Keep it below 16 megapixels.");
    if (frameCount > MAX_GIF_FRAMES) throw new Error("That GIF contains too many frames. Keep it below 2,000 frames.");

    const frameCanvas = document.createElement("canvas");
    frameCanvas.width = width;
    frameCanvas.height = height;
    const frameContext = frameCanvas.getContext("2d", { alpha: true });
    const pixels = new Uint8ClampedArray(width * height * 4);
    const imageData = new ImageData(pixels, width, height);
    const frameDelays = Array.from({ length: frameCount }, (_, index) => clamp(reader.frameInfo(index).delay * 10 || 100, 20, 10_000));
    const duration = frameDelays.reduce((sum, delay) => sum + delay, 0) / 1000;
    let currentFrame = -1;
    let nextFrameAt = 0;
    let restorePixels = null;

    function paintFrame(index, now, rate) {
      const wrapped = index === 0 && currentFrame >= 0;
      if (wrapped) {
        pixels.fill(0);
        restorePixels = null;
      } else if (currentFrame >= 0) {
        const previous = reader.frameInfo(currentFrame);
        if (previous.disposal === 2) clearPixelRect(pixels, width, previous.x, previous.y, previous.width, previous.height);
        else if (previous.disposal === 3 && restorePixels) pixels.set(restorePixels);
        restorePixels = null;
      }
      const frame = reader.frameInfo(index);
      if (frame.disposal === 3) restorePixels = pixels.slice();
      reader.decodeAndBlitFrameRGBA(index, pixels);
      frameContext.putImageData(imageData, 0, 0);
      currentFrame = index;
      nextFrameAt = now + frameDelays[index] / Math.max(0.25, rate);
    }

    const player = {
      canvas: frameCanvas,
      width,
      height,
      frameCount,
      duration,
      resetClock(now = performance.now(), rate = 1) {
        nextFrameAt = now + frameDelays[Math.max(0, currentFrame)] / Math.max(0.25, rate);
      },
      advance(now = performance.now(), rate = 1) {
        if (currentFrame < 0) {
          paintFrame(0, now, rate);
          return true;
        }
        if (frameCount < 2 || now < nextFrameAt) return false;
        let changed = false;
        let steps = 0;
        while (now >= nextFrameAt && steps < 12) {
          paintFrame((currentFrame + 1) % frameCount, nextFrameAt, rate);
          changed = true;
          steps += 1;
        }
        if (steps === 12 && now >= nextFrameAt) player.resetClock(now, rate);
        return changed;
      },
    };
    player.advance(performance.now(), state.playbackRate);
    return player;
  }

  function loadVideo(video, url) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      const onReady = () => { cleanup(); resolve(video); };
      const onError = () => { cleanup(); reject(new Error("The video could not be decoded in this browser.")); };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = url;
      video.load();
    });
  }

  function preferredRecordingFormat() {
    if (!window.MediaRecorder) return null;
    const candidates = [
      { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4", label: "MP4" },
      { mimeType: "video/mp4", extension: "mp4", label: "MP4" },
      { mimeType: "video/webm;codecs=vp9", extension: "webm", label: "WebM" },
      { mimeType: "video/webm;codecs=vp8", extension: "webm", label: "WebM" },
      { mimeType: "video/webm", extension: "webm", label: "WebM" },
    ];
    return candidates.find((candidate) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(candidate.mimeType)) || null;
  }

  function videoCaptureStream(video) {
    const capture = video?.captureStream || video?.mozCaptureStream;
    return typeof capture === "function" ? capture.call(video) : null;
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

  function stopMotionRender() {
    if (motionFrameHandle !== null) cancelAnimationFrame(motionFrameHandle);
    if (videoFrameHandle !== null && videoFrameDriver?.cancelVideoFrameCallback) {
      videoFrameDriver.cancelVideoFrameCallback(videoFrameHandle);
    }
    motionFrameHandle = null;
    videoFrameHandle = null;
    videoFrameDriver = null;
  }

  function motionIsPlaying() {
    const video = sourceVideo();
    return video ? !video.paused && !video.ended : Boolean(state.gif && state.gifPlaying);
  }

  function shouldRenderMotion() {
    return hasMotionSource()
      && (state.recording || (document.body.dataset.activeTool === "poetic" && !document.hidden))
      && (state.recording || motionIsPlaying());
  }

  function scheduleMotionRender() {
    if (!shouldRenderMotion() || motionFrameHandle !== null || videoFrameHandle !== null) return;
    const video = sourceVideo();
    if (video && !video.paused && video.requestVideoFrameCallback) {
      videoFrameDriver = video;
      videoFrameHandle = video.requestVideoFrameCallback(() => {
        videoFrameHandle = null;
        videoFrameDriver = null;
        render({ refreshOverlays: false });
        syncControls();
        scheduleMotionRender();
      });
      return;
    }
    motionFrameHandle = requestAnimationFrame((now) => {
      motionFrameHandle = null;
      const changed = state.gif && state.gifPlaying
        ? state.gif.advance(now, state.playbackRate)
        : Boolean(video && !video.paused);
      if (changed || state.recording) render({ refreshOverlays: false });
      syncControls();
      scheduleMotionRender();
    });
  }

  function disposeSourceVideo() {
    const video = $("#poeticSourceVideoThumb");
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
  }

  async function playMotion(showMessage = true) {
    const video = sourceVideo();
    if (video) {
      try {
        video.muted = !state.sound;
        video.playbackRate = state.playbackRate;
        await video.play();
      } catch {
        if (showMessage) showToast("Press Play to start the source video.");
        syncControls();
        return false;
      }
    } else if (state.gif) {
      state.gifPlaying = true;
      state.gif.resetClock(performance.now(), state.playbackRate);
    } else {
      return false;
    }
    scheduleMotionRender();
    syncControls();
    if (showMessage) showToast(`${state.sourceKind === "gif" ? "GIF" : "Video"} playing at ${formatRate(state.playbackRate)}.`);
    return true;
  }

  function pauseMotion(showMessage = true) {
    const video = sourceVideo();
    if (video) video.pause();
    if (state.gif) state.gifPlaying = false;
    stopMotionRender();
    render();
    syncControls();
    if (showMessage) showToast(`${state.sourceKind === "gif" ? "GIF" : "Video"} paused on the current frame.`);
  }

  function formatRate(rate) {
    return `${Number(rate).toFixed(Number(rate) % 1 ? 2 : 0).replace(/0$/, "")}×`;
  }

  async function handleFile(file) {
    if (!file) return;
    const gif = isGifFile(file);
    const videoFile = file.type.startsWith("video/");
    const imageFile = file.type.startsWith("image/");
    if (!imageFile && !videoFile && !gif) {
      showToast("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV source.");
      return;
    }
    const limit = gif ? MAX_GIF_BYTES : videoFile ? MAX_VIDEO_BYTES : 30 * 1024 * 1024;
    if (file.size > limit) {
      showToast(gif
        ? "That GIF is larger than the 50 MB local limit."
        : videoFile
          ? "That video is larger than the 250 MB local limit."
          : "That image is larger than the 30 MB local limit.");
      return;
    }
    if (state.recording) {
      showToast("Finish the animated export before replacing its source.");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    stopMotionRender();
    try {
      let media;
      let gifPlayer = null;
      let duration = 0;
      if (gif) {
        gifPlayer = await createGifPlayer(file);
        media = gifPlayer.canvas;
        duration = gifPlayer.duration;
      } else if (videoFile) {
        media = await loadVideo($("#poeticSourceVideoThumb"), nextUrl);
        duration = Number.isFinite(media.duration) ? media.duration : 0;
      } else {
        media = await loadImage(nextUrl);
      }

      if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
      if (state.sourceKind === "video" && media !== $("#poeticSourceVideoThumb")) disposeSourceVideo();
      state.sourceUrl = nextUrl;
      state.image = media;
      state.file = file;
      state.fileBase = safeFileBase(file.name);
      state.sourceKind = gif ? "gif" : videoFile ? "video" : "image";
      state.gif = gifPlayer;
      state.gifPlaying = Boolean(gifPlayer?.frameCount > 1);
      state.playbackRate = 1;
      state.sound = false;
      state.photo = { x: 0.5, y: 0.5, scale: 1 };
      state.activeFragment = -1;

      const imageThumb = $("#poeticSourceThumb");
      const videoThumb = $("#poeticSourceVideoThumb");
      imageThumb.hidden = videoFile;
      videoThumb.hidden = !videoFile;
      if (!videoFile) imageThumb.src = nextUrl;
      if (videoFile) {
        videoThumb.loop = true;
        videoThumb.muted = true;
        videoThumb.playbackRate = 1;
      }
      $("#poeticSourceName").textContent = file.name;
      $("#poeticSourceMeta").textContent = formatFileMeta(file, duration);
      $("#poeticDropIdle").hidden = true;
      $("#poeticSourcePreview").hidden = false;
      $("#poeticEmptyOverlay").hidden = true;
      if (document.body.dataset.activeTool === "poetic") {
        $("#fileNameHeader").textContent = state.fileBase.replace(/-/g, " ").toUpperCase();
      }
      setStatus("success", hasMotionSource()
        ? `Moving crop windows ready · ${state.sourceKind.toUpperCase()} · ${formatRate(state.playbackRate)}`
        : "Crop windows ready · drag them directly on the artwork");
      suggestCaption(false);
      generateFragments();
      syncControls();
      render();
      if (hasMotionSource()) await playMotion(false);
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      state.image = null;
      state.gif = null;
      state.gifPlaying = false;
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
    const dimensions = sourceDimensions();
    const cover = coverGeometry(dimensions.width, dimensions.height, 48, 48, 0.5, 0.5, 1);
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
    return {
      x: boxWidth * positionX - width / 2,
      y: boxHeight * positionY - height / 2,
      width,
      height,
    };
  }

  function buildPhotoLayer() {
    const dimensions = sourceDimensions();
    const geometry = coverGeometry(
      dimensions.width,
      dimensions.height,
      WIDTH,
      PHOTO_HEIGHT,
      state.photo.x,
      state.photo.y,
      state.photo.scale
    );
    photoContext.imageSmoothingEnabled = true;
    photoContext.imageSmoothingQuality = "high";
    photoContext.clearRect(0, 0, WIDTH, PHOTO_HEIGHT);
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

  function captionBounds(layout = null) {
    const nextLayout = layout || layoutCaptionItems(captionItems(null));
    if (!nextLayout.lines.length) return { x: 70, y: 170, width: 760, height: 180 };
    const totalHeight = nextLayout.lines.reduce((sum, line) => sum + line.height, 0);
    const width = Math.max(120, ...nextLayout.lines.map((line) => line.width));
    const y = Math.max(38, (SPLIT_Y - totalHeight) / 2);
    return { x: (WIDTH - width) / 2, y, width, height: totalHeight };
  }

  function drawCaption(photoLayer) {
    const items = captionItems(photoLayer);
    if (!items.length) return;
    const layout = layoutCaptionItems(items);
    const totalHeight = layout.lines.reduce((sum, line) => sum + line.height, 0);
    const bounds = captionBounds(layout);
    window.editorialText.transformContext(ctx, bounds, state.captionTransform, () => {
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

  function render(options = {}) {
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
    if (options.refreshOverlays !== false) window.editorialText?.refresh("poetic");
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
    $("#poeticCanvasDimensions").textContent = state.outputWidth + " × " + Math.round(state.outputWidth * 4 / 3) + " PX";
    $("#poeticFragmentStatus").textContent = state.fragmentCount + (state.fragmentCount === 1 ? " FRAGMENT" : " FRAGMENTS");
    const moving = hasMotionSource();
    const playing = moving && motionIsPlaying();
    const motionControls = $("#poeticMotionControls");
    motionControls.hidden = !moving;
    motionControls.classList.toggle("gif-source", state.sourceKind === "gif");
    const playButton = $("#poeticPlayToggle");
    playButton.disabled = !moving || state.recording;
    playButton.classList.toggle("playing", playing);
    playButton.setAttribute("aria-pressed", String(playing));
    $("span", playButton).textContent = playing ? "Pause" : "Play";
    $("#poeticPlaybackSpeed").value = Math.round(state.playbackRate * 100);
    $("#poeticPlaybackSpeed").disabled = !moving || state.recording;
    $("#poeticPlaybackSpeedOutput").textContent = formatRate(state.playbackRate);
    const soundButton = $("#poeticSoundToggle");
    const video = sourceVideo();
    soundButton.hidden = !video;
    soundButton.disabled = !video || state.recording;
    soundButton.setAttribute("aria-pressed", String(Boolean(video && state.sound)));
    soundButton.setAttribute("aria-label", `Turn source video sound ${state.sound ? "off" : "on"}`);
    soundButton.title = state.sound ? "Sound on" : "Sound off";
    if (video) {
      video.playbackRate = state.playbackRate;
      video.muted = !state.sound;
    }
    $("#poeticMotionStatus").textContent = state.sourceKind === "gif"
      ? `GIF · LOOP · ${formatRate(state.playbackRate)}`
      : `VIDEO · LOOP · ${formatRate(state.playbackRate)} · SOUND ${state.sound ? "ON" : "OFF"}`;
    if (moving && state.image && !state.recording) {
      setStatus("success", `Moving crop windows ready · ${state.sourceKind.toUpperCase()} · ${formatRate(state.playbackRate)}`);
    }
    state.clipDuration = clamp(Number(state.clipDuration) || 10, 3, MAX_CLIP_DURATION);
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
    state.captionTransform = defaultCaptionTransform();
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    state.activeFragment = -1;
    state.playbackRate = 1;
    state.sound = false;
    if (sourceVideo()) {
      sourceVideo().playbackRate = 1;
      sourceVideo().muted = true;
    }
    state.gif?.resetClock(performance.now(), 1);
    $("#poeticCaptionInput").value = state.caption;
    if (state.image) generateFragments();
    syncControls();
    render();
    showToast("Poetic Fragments reset.");
  }

  function exportPng() {
    if (!state.image) {
      showToast("Add source media before exporting.");
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

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  async function exportAnimated() {
    if (state.recording) return;
    if (!state.image || !hasMotionSource()) {
      showToast("Add a GIF or video source before exporting motion.");
      return;
    }
    const format = preferredRecordingFormat();
    if (!format || !canvas.captureStream || !window.MediaRecorder) {
      showToast("Animated export is unavailable in this browser. PNG export remains available.");
      return;
    }

    const duration = clamp(Math.round(Number(state.clipDuration) || 10), 3, MAX_CLIP_DURATION);
    const video = sourceVideo();
    const videoSnapshot = video ? { startTime: video.currentTime, wasPaused: video.paused } : null;
    const gifWasPlaying = state.gifPlaying;
    let stream = null;
    let sourceAudioStream = null;
    let includedAudio = false;
    let recorder = null;
    let stopTimer = null;

    try {
      state.recording = true;
      state.recordingProgress = 0;
      if (video) await video.play();
      if (state.gif) {
        state.gifPlaying = true;
        state.gif.resetClock(performance.now(), state.playbackRate);
      }
      scheduleMotionRender();
      render({ refreshOverlays: false });
      syncControls();
      showToast(`Recording ${duration}s locally at ${formatRate(state.playbackRate)} · keep this tab open.`);

      stream = canvas.captureStream(30);
      if (video && state.sound) {
        sourceAudioStream = videoCaptureStream(video);
        const audioTrack = sourceAudioStream?.getAudioTracks?.()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          includedAudio = true;
        }
      }
      recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: 6_000_000 });
      const chunks = [];
      const completed = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: format.mimeType })), { once: true });
        recorder.addEventListener("error", () => reject(recorder.error || new Error("Animated recording failed.")), { once: true });
      });
      recorder.start(250);
      stopTimer = window.setTimeout(() => {
        if (recorder?.state === "recording") recorder.stop();
      }, duration * 1000);

      const blob = await completed;
      if (!blob.size) throw new Error("The browser returned an empty animated export.");
      downloadBlob(blob, `${state.fileBase}-poetic-fragments-${duration}s.${format.extension}`);
      showToast(`${duration}s Poetic Fragments ${format.label} exported${includedAudio ? " with sound" : ""}.`);
    } catch (error) {
      if (recorder?.state === "recording") recorder.stop();
      showToast(error?.message || "Animated export could not be created.");
    } finally {
      if (stopTimer) window.clearTimeout(stopTimer);
      stream?.getTracks().forEach((track) => track.stop());
      sourceAudioStream?.getTracks().forEach((track) => {
        if (!stream?.getTracks().includes(track)) track.stop();
      });
      state.recording = false;
      state.recordingProgress = 0;
      if (videoSnapshot) {
        if (videoSnapshot.wasPaused) video.pause();
        video.currentTime = Math.min(videoSnapshot.startTime, Number.isFinite(video.duration) ? video.duration : videoSnapshot.startTime);
      }
      state.gifPlaying = gifWasPlaying;
      stopMotionRender();
      render();
      syncControls();
      scheduleMotionRender();
    }
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
      state.photo.x = clamp(state.photo.x + deltaX / WIDTH, -0.15, 1.15);
      state.photo.y = clamp(state.photo.y + deltaY / PHOTO_HEIGHT, -0.15, 1.15);
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

  $("#poeticPlayToggle").addEventListener("click", () => {
    if (motionIsPlaying()) pauseMotion(true);
    else playMotion(true);
  });
  $("#poeticPlaybackSpeed").addEventListener("input", (event) => {
    state.playbackRate = clamp(Number(event.target.value) / 100, 0.25, 2);
    if (sourceVideo()) sourceVideo().playbackRate = state.playbackRate;
    state.gif?.resetClock(performance.now(), state.playbackRate);
    syncControls();
    scheduleMotionRender();
  });
  $("#poeticSoundToggle").addEventListener("click", () => {
    const video = sourceVideo();
    if (!video || state.recording) return;
    state.sound = !state.sound;
    video.muted = !state.sound;
    syncControls();
    showToast(`Poetic Fragments video sound ${state.sound ? "on" : "off"}.`);
  });
  const poeticVideoPreview = $("#poeticSourceVideoThumb");
  poeticVideoPreview.addEventListener("play", () => { syncControls(); scheduleMotionRender(); });
  poeticVideoPreview.addEventListener("pause", () => { stopMotionRender(); render(); syncControls(); });
  poeticVideoPreview.addEventListener("ended", () => syncControls());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopMotionRender();
    else scheduleMotionRender();
  });

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
      showToast("Add source media before shuffling crop windows.");
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
  function activate() {
    $("#fileNameHeader").textContent = state.image
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "POETIC FRAGMENTS";
    syncControls();
    render();
    if (state.resumeVideoOnActivate && sourceVideo()) {
      state.resumeVideoOnActivate = false;
      playMotion(false);
    } else {
      scheduleMotionRender();
    }
  }

  function deactivate() {
    const video = sourceVideo();
    state.resumeVideoOnActivate = Boolean(video && !video.paused);
    if (video) video.pause();
    stopMotionRender();
  }

  window.editorialText.register("poetic", {
    canvas,
    shell: $("#poeticArtboardShell"),
    panel: "#poeticEditorialPanel",
    width: WIDTH,
    height: HEIGHT,
    getLayers: () => [{
      id: "caption",
      label: "Caption + fragments",
      bounds: captionBounds(),
      transform: state.captionTransform,
      color: state.textColor,
      enabled: Boolean(state.image && state.caption.trim()),
    }],
    updateLayer: (id, patch) => {
      if (patch.color) {
        state.textColor = patch.color;
        delete patch.color;
        syncControls();
      }
      Object.assign(state.captionTransform, patch);
    },
    resetLayer: () => { state.captionTransform = defaultCaptionTransform(); },
    getAlignment: () => ({ x: 450, y: SPLIT_Y / 2, threshold: 12, region: { x: 0, y: 0, width: WIDTH, height: SPLIT_Y } }),
    render,
  });

  window.poeticFragments = {
    activate,
    deactivate,
    reset,
    exportPng,
    exportAnimated,
    getExportOptions: () => ({
      canExport: Boolean(state.image),
      motionAvailable: hasMotionSource() && Boolean(state.image && preferredRecordingFormat()),
      outputWidth: state.outputWidth,
      clipDuration: state.clipDuration,
      recording: state.recording,
      audioEnabled: Boolean(sourceVideo() && state.sound),
      soundAvailable: Boolean(sourceVideo()),
      format: preferredRecordingFormat(),
    }),
    setClipDuration: (duration) => {
      state.clipDuration = clamp(Number(duration) || 10, 3, MAX_CLIP_DURATION);
      syncControls();
    },
    setOutputWidth: (width) => {
      state.outputWidth = [900, 1350].includes(Number(width)) ? Number(width) : 900;
      syncControls();
      render();
    },
  };
  ensureFragments();
  syncControls();
  render();
})();
