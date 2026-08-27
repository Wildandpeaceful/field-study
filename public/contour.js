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
  const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
  const MAX_GIF_BYTES = 50 * 1024 * 1024;
  const MAX_GIF_PIXELS = 16_000_000;
  const MAX_GIF_FRAMES = 2_000;
  const MAX_CLIP_DURATION = 60;
  const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime,video/x-m4v,image/gif";
  const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
  const SOURCE_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`;

  let videoFrameHandle = null;
  let fallbackFrameHandle = null;
  let videoFrameDriver = null;
  let lastMaskFrameTime = -1;
  let lastMaskCellCount = -1;
  let canvasVisible = true;
  const maskSampleCanvas = document.createElement("canvas");
  const maskSampleContext = maskSampleCanvas.getContext("2d", { willReadFrequently: true });

  const defaultTextTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, color: null, locked: false });

  const state = {
    textureImage: null,
    textureUrl: null,
    textureFile: null,
    textureKind: "image",
    textureGif: null,
    textureSound: false,
    clipDuration: 10,
    recording: false,
    recordingProgress: 0,
    maskImage: null,
    maskUrl: null,
    maskFile: null,
    maskKind: "image",
    maskGif: null,
    maskSound: false,
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
    upperTreatment: "woven",
    lowerEcho: true,
    textureTone: "#7d745f",
    symmetry: "none",
    layout: "orbit",
    activeLayer: "motif",
    motif: { x: 0.5, y: 0.47, scale: 1 },
    echo: { x: 0.5, y: 0.47, scale: 1 },
    linkContours: true,
    photo: { x: 0.5, y: 0.5, scale: 1 },
    showDots: true,
    fieldColor: "#f5f3ee",
    textColor: "#171914",
    motifColor: "#171914",
    maskColor: "#f5f3ee",
    leftTitle: "Chromatic Field Study",
    leftNote: "a quiet geometry gathered from light",
    rightTitle: "Woven Contour Motif",
    rightNote: "Colorway: Moss · Ochre · Alabaster",
    showPhotoWords: false,
    photoWords: "Contour Study · by Field Studio · Moving Texture",
    photoWordTone: "auto",
    textLayers: {
      left: defaultTextTransform(),
      right: defaultTextTransform(),
      rail: defaultTextTransform(),
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
    if (typeof GifDecoder !== "function") {
      throw new Error("The local GIF decoder is unavailable. Reload the app and try again.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const reader = new GifDecoder(bytes);
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
    const frameDelays = Array.from({ length: frameCount }, (_, index) => {
      const delay = reader.frameInfo(index).delay * 10;
      return clamp(delay || 100, 20, 10_000);
    });
    const duration = frameDelays.reduce((sum, delay) => sum + delay, 0) / 1000;
    let currentFrame = -1;
    let nextFrameAt = 0;
    let restorePixels = null;

    function paintFrame(index, now) {
      const wrapped = index === 0 && currentFrame >= 0;
      if (wrapped) {
        pixels.fill(0);
        restorePixels = null;
      } else if (currentFrame >= 0) {
        const previous = reader.frameInfo(currentFrame);
        if (previous.disposal === 2) {
          clearPixelRect(pixels, width, previous.x, previous.y, previous.width, previous.height);
        } else if (previous.disposal === 3 && restorePixels) {
          pixels.set(restorePixels);
        }
        restorePixels = null;
      }

      const frame = reader.frameInfo(index);
      if (frame.disposal === 3) restorePixels = pixels.slice();
      reader.decodeAndBlitFrameRGBA(index, pixels);
      frameContext.putImageData(imageData, 0, 0);
      currentFrame = index;
      nextFrameAt = now + frameDelays[index];
    }

    const player = {
      canvas: frameCanvas,
      width,
      height,
      frameCount,
      duration,
      get currentFrame() { return currentFrame; },
      advance(now = performance.now()) {
        if (currentFrame < 0) {
          paintFrame(0, now);
          return true;
        }
        if (frameCount < 2 || now < nextFrameAt) return false;
        let changed = false;
        let steps = 0;
        while (now >= nextFrameAt && steps < 12) {
          paintFrame((currentFrame + 1) % frameCount, nextFrameAt);
          changed = true;
          steps += 1;
        }
        if (steps === 12 && now >= nextFrameAt) nextFrameAt = now + frameDelays[currentFrame];
        return changed;
      },
    };
    player.advance(performance.now());
    return player;
  }

  function loadVideo(video, url) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolve(video);
      };
      const onError = () => {
        cleanup();
        reject(new Error("The video could not be decoded in this browser."));
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      video.src = url;
      video.load();
    });
  }

  function validateImageFile(file) {
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

  function validateTextureFile(file) {
    const gif = isGifFile(file);
    if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/") && !gif)) {
      showToast("Choose a JPG, PNG, WebP, GIF, MP4, WebM, or MOV source.");
      return false;
    }
    const isGif = gif;
    const isMotion = file.type.startsWith("video/") || isGif;
    const limit = isGif ? MAX_GIF_BYTES : isMotion ? MAX_VIDEO_BYTES : 30 * 1024 * 1024;
    if (file.size > limit) {
      showToast(isGif
        ? "That GIF is larger than the 50 MB local limit."
        : isMotion
        ? "That video is larger than the 250 MB local limit."
        : "That image is larger than the 30 MB local limit.");
      return false;
    }
    return true;
  }

  function isGifFile(file) {
    return Boolean(file && (file.type === "image/gif" || /\.gif$/i.test(file.name || "")));
  }

  function setStatus(kind, message) {
    $("#contourProcessStatus").className = "process-status" + (kind ? " " + kind : "");
    $("#contourProcessStatusText").textContent = message;
  }

  function textureVideo() {
    return state.textureKind === "video" && state.textureImage instanceof HTMLVideoElement
      ? state.textureImage
      : null;
  }

  function maskVideo() {
    return state.maskKind === "video" && state.maskImage instanceof HTMLVideoElement
      ? state.maskImage
      : null;
  }

  function motionVideos() {
    return [textureVideo(), maskVideo()].filter(Boolean);
  }

  function activeSoundVideo() {
    if (state.textureSound && textureVideo()) return textureVideo();
    if (state.maskSound && maskVideo()) return maskVideo();
    return null;
  }

  function videoCaptureStream(video) {
    const capture = video?.captureStream || video?.mozCaptureStream;
    return typeof capture === "function" ? capture.call(video) : null;
  }

  function hasAnimatedGif() {
    return [state.textureGif, state.maskGif].some((player) => player?.frameCount > 1);
  }

  function advanceGifFrames(now = performance.now()) {
    return {
      texture: Boolean(state.textureGif?.advance(now)),
      mask: Boolean(state.maskGif?.advance(now)),
    };
  }

  function hasMotionSource() {
    return motionVideos().length > 0 || hasAnimatedGif();
  }

  function textureDimensions() {
    const video = textureVideo();
    return video
      ? { width: video.videoWidth, height: video.videoHeight }
      : { width: state.textureImage?.width || 0, height: state.textureImage?.height || 0 };
  }

  function maskDimensions() {
    const video = maskVideo();
    return video
      ? { width: video.videoWidth, height: video.videoHeight }
      : {
          width: state.maskImage?.naturalWidth || state.maskImage?.width || 0,
          height: state.maskImage?.naturalHeight || state.maskImage?.height || 0,
        };
  }

  function formatTime(value) {
    const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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

  function syncVideoTimeline() {
    const video = textureVideo();
    const playhead = $("#contourVideoPlayhead");
    if (!video) {
      playhead.max = "1";
      playhead.value = "0";
      $("#contourVideoTime").textContent = "00:00 / 00:00";
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    playhead.max = String(Math.max(0.01, duration));
    playhead.value = String(Math.min(duration || 0, video.currentTime || 0));
    $("#contourVideoTime").textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  }

  function syncMaskVideoTimeline() {
    const video = maskVideo();
    const playhead = $("#contourMaskVideoPlayhead");
    if (!video) {
      playhead.max = "1";
      playhead.value = "0";
      $("#contourMaskVideoTime").textContent = "00:00 / 00:00";
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    playhead.max = String(Math.max(0.01, duration));
    playhead.value = String(Math.min(duration || 0, video.currentTime || 0));
    $("#contourMaskVideoTime").textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  }

  function refreshAnimatedMaskFrame(force = false, gifFrameChanged = false) {
    const video = maskVideo();
    const animatedGif = state.maskGif?.frameCount > 1;
    if (!video && !animatedGif) return;
    if (animatedGif && !force && !gifFrameChanged) return;
    const frameTime = animatedGif ? state.maskGif.currentFrame : Number(video.currentTime) || 0;
    const minimumFrameInterval = animatedGif ? 0 : 1 / 240;
    if (!force && Math.abs(frameTime - lastMaskFrameTime) < minimumFrameInterval) return;
    lastMaskFrameTime = frameTime;
    rebuildContour();
    if (state.cells.length !== lastMaskCellCount) {
      lastMaskCellCount = state.cells.length;
      updateReadyState();
      updateLayerStatus();
    }
  }

  function stopVideoRenderLoop() {
    if (videoFrameHandle !== null && videoFrameDriver?.cancelVideoFrameCallback) {
      videoFrameDriver.cancelVideoFrameCallback(videoFrameHandle);
    }
    if (fallbackFrameHandle !== null) cancelAnimationFrame(fallbackFrameHandle);
    videoFrameHandle = null;
    fallbackFrameHandle = null;
    videoFrameDriver = null;
  }

  function shouldRenderVideo() {
    const moving = hasAnimatedGif() || motionVideos().some((video) => !video.paused && !video.ended);
    if (!moving || document.hidden) return false;
    if (state.recording) return true;
    return document.body.dataset.activeTool === "contour" && canvasVisible;
  }

  function scheduleVideoRender() {
    const driver = motionVideos().find((video) => !video.paused && !video.ended);
    if (!shouldRenderVideo() || videoFrameHandle !== null || fallbackFrameHandle !== null) return;
    if (driver?.requestVideoFrameCallback) {
      videoFrameDriver = driver;
      videoFrameHandle = driver.requestVideoFrameCallback(() => {
        videoFrameHandle = null;
        videoFrameDriver = null;
        const gifFrames = advanceGifFrames();
        refreshAnimatedMaskFrame(false, gifFrames.mask);
        render({ refreshOverlays: false });
        syncVideoTimeline();
        syncMaskVideoTimeline();
        scheduleVideoRender();
      });
    } else {
      fallbackFrameHandle = requestAnimationFrame(() => {
        fallbackFrameHandle = null;
        const gifFrames = advanceGifFrames();
        refreshAnimatedMaskFrame(false, gifFrames.mask);
        if (gifFrames.texture || gifFrames.mask || motionVideos().some((video) => !video.paused && !video.ended)) {
          render({ refreshOverlays: false });
        }
        syncVideoTimeline();
        syncMaskVideoTimeline();
        scheduleVideoRender();
      });
    }
  }

  async function playTextureVideo(showMessage = true) {
    const video = textureVideo();
    if (!video) return false;
    try {
      video.muted = !state.textureSound;
      await video.play();
      scheduleVideoRender();
      syncControls();
      if (showMessage) showToast(`Video texture playing · sound ${state.textureSound ? "on" : "off"}.`);
      return true;
    } catch (error) {
      syncControls();
      if (showMessage) showToast("Press Play to start the video texture.");
      return false;
    }
  }

  function pauseTextureVideo(showMessage = true) {
    const video = textureVideo();
    if (!video) return;
    video.pause();
    stopVideoRenderLoop();
    render();
    syncControls();
    scheduleVideoRender();
    if (showMessage) showToast("Video texture paused on the current frame.");
  }

  function disposeTextureVideo() {
    const video = $("#contourTextureVideoThumb");
    stopVideoRenderLoop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
    scheduleVideoRender();
  }

  async function playMaskVideo(showMessage = true) {
    const video = maskVideo();
    if (!video) return false;
    try {
      video.muted = !state.maskSound;
      await video.play();
      refreshAnimatedMaskFrame(true);
      scheduleVideoRender();
      syncControls();
      if (showMessage) showToast("Contour video playing · alpha or image contrast drives the moving mask.");
      return true;
    } catch {
      syncControls();
      if (showMessage) showToast("Press Play to start the contour video.");
      return false;
    }
  }

  function pauseMaskVideo(showMessage = true) {
    const video = maskVideo();
    if (!video) return;
    video.pause();
    stopVideoRenderLoop();
    refreshAnimatedMaskFrame(true);
    render();
    syncControls();
    scheduleVideoRender();
    if (showMessage) showToast("Contour video paused on the current shape frame.");
  }

  function disposeMaskVideo() {
    const video = $("#contourMaskVideoThumb");
    stopVideoRenderLoop();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.hidden = true;
    lastMaskFrameTime = -1;
    scheduleVideoRender();
  }

  function setVideoSound(source, enabled) {
    const isTexture = source === "texture";
    const video = isTexture ? textureVideo() : maskVideo();
    if (!video || state.recording) return;
    const stateKey = isTexture ? "textureSound" : "maskSound";
    const otherStateKey = isTexture ? "maskSound" : "textureSound";
    const otherVideo = isTexture ? maskVideo() : textureVideo();
    state[stateKey] = Boolean(enabled);
    video.muted = !state[stateKey];
    if (state[stateKey]) {
      state[otherStateKey] = false;
      if (otherVideo) otherVideo.muted = true;
    }
    syncControls();
    const sourceLabel = isTexture ? "Texture" : "Contour";
    showToast(state[stateKey]
      ? `${sourceLabel} video sound on · the other video stays muted.`
      : `${sourceLabel} video sound off.`);
  }

  function updateReadyState() {
    $("#contourEmptyOverlay").hidden = Boolean(state.textureImage || state.maskImage);
    if (state.textureImage && state.maskImage && !state.cells.length) {
      setStatus("error", "No contour cells detected · raise sensitivity or invert the selection");
    } else if (state.textureImage && state.maskImage) {
      const movingSources = [
        textureVideo() ? `texture ${textureVideo().paused ? "paused" : "playing"}` : "",
        maskVideo() ? `contour ${maskVideo().paused ? "paused" : "playing"}` : "",
        state.textureKind === "gif" ? "texture GIF looping" : "",
        state.maskKind === "gif" ? "contour GIF looping" : "",
      ].filter(Boolean);
      const motion = movingSources.length ? ` · ${movingSources.join(" · ")}` : "";
      setStatus("ready", state.cells.length + " contour cells woven locally" + motion + " · ready to compose");
    } else if (state.textureImage) {
      setStatus("working", "Texture ready · add a contour image, video, or icon to build the motif");
    } else if (state.maskImage) {
      setStatus("working", "Contour ready · add a texture image, GIF, or video to complete the composition");
    } else {
      setStatus("", "Waiting for a texture source and contour shape");
    }
  }

  async function handleTextureFile(file) {
    if (!validateTextureFile(file)) return false;
    if (state.recording) {
      showToast("Finish the animated export before replacing its source.");
      return false;
    }
    const nextKind = file.type.startsWith("video/") ? "video" : isGifFile(file) ? "gif" : "image";
    const previousUrl = state.textureUrl;
    const nextUrl = URL.createObjectURL(file);
    stopVideoRenderLoop();
    try {
      const media = nextKind === "video"
        ? await loadVideo($("#contourTextureVideoThumb"), nextUrl)
        : nextKind === "gif"
          ? await createGifPlayer(file)
          : await loadImage(nextUrl);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      if (nextKind !== "video") disposeTextureVideo();
      state.textureUrl = nextUrl;
      state.textureGif = nextKind === "gif" ? media : null;
      state.textureImage = nextKind === "gif" ? media.canvas : media;
      state.textureFile = file;
      state.textureKind = nextKind;
      state.textureSound = false;
      if (nextKind === "video") media.muted = true;
      state.fileBase = safeFileBase(file.name);
      state.photo = { x: 0.5, y: 0.5, scale: 1 };
      state.textureTone = averageTextureColor();
      const imageThumb = $("#contourTextureThumb");
      const videoThumb = $("#contourTextureVideoThumb");
      if (nextKind === "video") {
        imageThumb.hidden = true;
        imageThumb.removeAttribute("src");
        videoThumb.hidden = false;
      } else {
        imageThumb.src = nextUrl;
        imageThumb.hidden = false;
        videoThumb.hidden = true;
      }
      $("#contourTextureName").textContent = file.name;
      $("#contourTextureMeta").textContent = nextKind === "video"
        ? `${fileMeta(file)} · ${formatTime(media.duration)}`
        : nextKind === "gif"
          ? `${fileMeta(file)} · ${media.frameCount} FRAMES · ${media.duration.toFixed(1)}S · AUTO LOOP`
        : fileMeta(file);
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
      if (nextKind === "video") {
        await playTextureVideo(false);
        updateReadyState();
        syncControls();
        showToast("Video texture added · playing locally in a muted loop. Use the sound control to listen.");
      } else if (nextKind === "gif") {
        scheduleVideoRender();
        updateReadyState();
        syncControls();
        showToast("Animated GIF texture added · looping locally.");
      } else {
        showToast("Texture image added. Now add a contour source.");
      }
      return true;
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      if (nextKind === "video") disposeTextureVideo();
      state.textureImage = null;
      state.textureFile = null;
      state.textureUrl = null;
      state.textureKind = "image";
      state.textureGif = null;
      state.textureSound = false;
      setStatus("error", error.message);
      syncControls();
      render();
      showToast(error.message);
      return false;
    }
  }

  async function handleMaskFile(file, options = {}) {
    if (!validateTextureFile(file)) return false;
    if (state.recording) {
      showToast("Finish the animated export before replacing its contour source.");
      return false;
    }
    const nextKind = file.type.startsWith("video/") ? "video" : isGifFile(file) ? "gif" : "image";
    const previousUrl = state.maskUrl;
    const nextUrl = URL.createObjectURL(file);
    stopVideoRenderLoop();
    try {
      const media = nextKind === "video"
        ? await loadVideo($("#contourMaskVideoThumb"), nextUrl)
        : nextKind === "gif"
          ? await createGifPlayer(file)
          : await loadImage(nextUrl);
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      if (nextKind !== "video") disposeMaskVideo();
      state.maskUrl = nextUrl;
      state.maskGif = nextKind === "gif" ? media : null;
      state.maskImage = nextKind === "gif" ? media.canvas : media;
      state.maskFile = file;
      state.maskKind = nextKind;
      state.maskSound = false;
      if (nextKind === "video") media.muted = true;
      state.maskSource = options.source || "upload";
      state.lucideIcon = options.icon || null;
      lastMaskFrameTime = -1;
      lastMaskCellCount = -1;
      const imageThumb = $("#contourMaskThumb");
      const videoThumb = $("#contourMaskVideoThumb");
      if (nextKind === "video") {
        imageThumb.hidden = true;
        imageThumb.removeAttribute("src");
        videoThumb.hidden = false;
      } else {
        imageThumb.src = nextUrl;
        imageThumb.hidden = false;
        videoThumb.hidden = true;
      }
      $("#contourMaskName").textContent = options.label || file.name;
      $("#contourMaskMeta").textContent = state.maskSource === "lucide"
        ? "LUCIDE ICON · LOCAL SVG"
        : nextKind === "video"
          ? `${fileMeta(file)} · ${formatTime(media.duration)} · ANIMATED MASK`
          : nextKind === "gif"
            ? `${fileMeta(file)} · ${media.frameCount} FRAMES · ${media.duration.toFixed(1)}S · ANIMATED MASK`
          : fileMeta(file);
      $("#contourMaskIdle").hidden = true;
      $("#contourMaskPreview").hidden = false;
      $("#contourMaskActions").hidden = false;
      rebuildContour();
      suggestCopy(false);
      updateReadyState();
      syncControls();
      render();
      if (nextKind === "video") {
        await playMaskVideo(false);
        updateReadyState();
        syncControls();
        showToast("Contour video added · transparent alpha or image contrast now drives the moving shape.");
      } else if (nextKind === "gif") {
        scheduleVideoRender();
        updateReadyState();
        syncControls();
        showToast("Animated GIF added · each frame now drives the contour shape.");
      } else {
        showToast(state.maskSource === "lucide"
          ? `${options.label || "Lucide icon"} translated into a contour.`
          : "Contour translated into a pixel matrix.");
      }
      return true;
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      if (nextKind === "video") disposeMaskVideo();
      state.maskImage = null;
      state.maskFile = null;
      state.maskUrl = null;
      state.maskKind = "image";
      state.maskGif = null;
      state.maskSound = false;
      setStatus("error", error.message);
      syncControls();
      render();
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
    if (state.recording) {
      showToast("Finish the animated export before clearing its source.");
      return;
    }
    disposeTextureVideo();
    if (state.textureUrl) URL.revokeObjectURL(state.textureUrl);
    state.textureImage = null;
    state.textureFile = null;
    state.textureUrl = null;
    state.textureKind = "image";
    state.textureGif = null;
    state.textureSound = false;
    state.fileBase = "contour-loom";
    $("#contourTextureInput").value = "";
    $("#contourTextureInput").accept = SOURCE_ACCEPT;
    $("#contourTextureThumb").removeAttribute("src");
    $("#contourTextureThumb").hidden = false;
    $("#contourTextureIdle").hidden = false;
    $("#contourTexturePreview").hidden = true;
    $("#contourTextureActions").hidden = true;
    if (document.body.dataset.activeTool === "contour") $("#fileNameHeader").textContent = "CONTOUR LOOM";
    updateReadyState();
    syncControls();
    render();
    showToast("Texture source removed.");
  }

  function clearMask() {
    if (state.recording) {
      showToast("Finish the animated export before clearing its contour source.");
      return;
    }
    disposeMaskVideo();
    if (state.maskUrl) URL.revokeObjectURL(state.maskUrl);
    state.maskImage = null;
    state.maskFile = null;
    state.maskUrl = null;
    state.maskKind = "image";
    state.maskGif = null;
    state.maskSound = false;
    state.maskSource = "upload";
    state.lucideIcon = null;
    state.cells = [];
    state.bounds = null;
    lastMaskFrameTime = -1;
    lastMaskCellCount = -1;
    $("#contourMaskInput").value = "";
    $("#contourMaskInput").accept = SOURCE_ACCEPT;
    $("#contourMaskThumb").removeAttribute("src");
    $("#contourMaskThumb").hidden = false;
    $("#contourMaskIdle").hidden = false;
    $("#contourMaskPreview").hidden = true;
    $("#contourMaskActions").hidden = true;
    updateReadyState();
    syncControls();
    render();
    showToast("Contour source removed.");
  }

  function resetPhotoPosition(showMessage = true) {
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    if (state.activeLayer === "photo") syncControls();
    render();
    if (showMessage) showToast("Lower photo position reset.");
  }

  function resetMotifPosition(showMessage = true) {
    state.motif = { x: 0.5, y: 0.47, scale: 1 };
    if (state.linkContours) state.echo = { ...state.motif };
    if (state.activeLayer === "motif" || (state.linkContours && state.activeLayer === "echo")) syncControls();
    render();
    if (showMessage) showToast(state.linkContours ? "Linked contour placements reset." : "Upper motif placement reset.");
  }

  function resetEchoPosition(showMessage = true) {
    state.echo = { x: 0.5, y: 0.47, scale: 1 };
    if (state.linkContours) state.motif = { ...state.echo };
    if (state.activeLayer === "echo" || (state.linkContours && state.activeLayer === "motif")) syncControls();
    render();
    if (showMessage) showToast(state.linkContours ? "Linked contour placements reset." : "Lower echo placement reset.");
  }

  function resetSelectedPosition() {
    if (state.activeLayer === "motif") resetMotifPosition(false);
    else if (state.activeLayer === "echo") resetEchoPosition(false);
    else resetPhotoPosition(false);
    const labels = { motif: "Upper motif", echo: "Lower echo", photo: "Lower photo" };
    showToast(`${labels[state.activeLayer]} placement reset.`);
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
    const dimensions = textureDimensions();
    if (!dimensions.width || !dimensions.height) return layer;
    const geometry = coverGeometry(
      dimensions.width,
      dimensions.height,
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
    if (!state.maskImage) return Array.from({ length: n }, () => Array(n).fill(false));
    const dimensions = maskDimensions();
    if (!dimensions.width || !dimensions.height) return Array.from({ length: n }, () => Array(n).fill(false));

    maskSampleCanvas.width = n;
    maskSampleCanvas.height = n;
    const geometry = containGeometry(dimensions.width, dimensions.height, n);
    maskSampleContext.clearRect(0, 0, n, n);
    maskSampleContext.imageSmoothingEnabled = true;
    maskSampleContext.drawImage(state.maskImage, geometry.x, geometry.y, geometry.width, geometry.height);
    let pixels = maskSampleContext.getImageData(0, 0, n, n).data;
    const matrix = Array.from({ length: n }, () => Array(n).fill(false));

    const minX = Math.max(0, Math.floor(geometry.x));
    const maxX = Math.min(n - 1, Math.ceil(geometry.x + geometry.width));
    const minY = Math.max(0, Math.floor(geometry.y));
    const maxY = Math.min(n - 1, Math.ceil(geometry.y + geometry.height));
    let transparentPixels = 0;
    let sampledPixels = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        sampledPixels += 1;
        if (pixels[(y * n + x) * 4 + 3] < 245) transparentPixels += 1;
      }
    }

    // Alpha-channel footage is the cleanest contour source: the visible subject
    // becomes the matrix while transparent pixels remain empty. Sensitivity still
    // provides a useful edge threshold for soft mattes and antialiased logos.
    if (transparentPixels > sampledPixels * 0.01) {
      const alphaCutoff = clamp(Math.round(230 - state.sensitivity * 2), 16, 230);
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          const withinSource = x >= minX && x <= maxX && y >= minY && y <= maxY;
          let selected = withinSource && pixels[(y * n + x) * 4 + 3] > alphaCutoff;
          if (state.invert) selected = !selected;
          matrix[y][x] = selected;
        }
      }
      return matrix;
    }

    // Opaque footage and stills use the existing contrast/luminance extraction.
    maskSampleContext.clearRect(0, 0, n, n);
    maskSampleContext.fillStyle = "#ffffff";
    maskSampleContext.fillRect(0, 0, n, n);
    maskSampleContext.drawImage(state.maskImage, geometry.x, geometry.y, geometry.width, geometry.height);
    pixels = maskSampleContext.getImageData(0, 0, n, n).data;
    const cornerIndexes = [0, n - 1, n * (n - 1), n * n - 1];
    const background = cornerIndexes.reduce((sum, pixelIndex) => {
      const index = pixelIndex * 4;
      sum[0] += pixels[index];
      sum[1] += pixels[index + 1];
      sum[2] += pixels[index + 2];
      return sum;
    }, [0, 0, 0]).map((value) => value / cornerIndexes.length);
    const cutoff = 0.34 - state.sensitivity / 100 * 0.27;
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

  function motifGeometry(transform = state.motif) {
    if (!state.bounds) return null;
    const targetSize = 300 * transform.scale;
    const cellSize = targetSize / Math.max(state.bounds.width, state.bounds.height);
    const width = state.bounds.width * cellSize;
    const height = state.bounds.height * cellSize;
    return {
      cellSize,
      x: transform.x * WIDTH - width / 2,
      y: transform.y * SPLIT_Y - height / 2,
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
    const geometry = motifGeometry(lower ? state.echo : state.motif);
    if (!geometry || !state.cells.length) return;
    const gap = geometry.cellSize * state.cellGap;
    state.cells.forEach((cell) => {
      const localX = cell.x - state.bounds.minX;
      const localY = cell.y - state.bounds.minY;
      const x = geometry.x + localX * geometry.cellSize + gap / 2;
      const y = (lower ? SPLIT_Y : 0) + geometry.y + localY * geometry.cellSize + gap / 2;
      const size = Math.max(1, geometry.cellSize - gap);
      if (lower) {
        fillCell(x, y, size, state.maskColor);
        return;
      }
      if (state.upperTreatment === "solid") {
        fillCell(x, y, size, state.motifColor);
        return;
      }
      if (!state.textureImage) {
        fillCell(x, y, size, "#4b69ff");
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

  function drawOriginalMotif() {
    if (!state.maskImage) return;
    const { width, height } = maskDimensions();
    if (!width || !height) return;
    const targetSize = 300 * state.motif.scale;
    const scale = targetSize / Math.max(width, height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      state.maskImage,
      state.motif.x * WIDTH - drawWidth / 2,
      state.motif.y * SPLIT_Y - drawHeight / 2,
      drawWidth,
      drawHeight
    );
  }

  function drawUpperMotif(photoLayer) {
    if (state.upperTreatment === "original") drawOriginalMotif();
    else drawMotif(photoLayer, false);
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

  function photoRailBounds() {
    return { x: 36, y: SPLIT_Y + 7, width: WIDTH - 72, height: 40 };
  }

  function sampledPhotoRailColor() {
    try {
      const scale = ctx.getTransform().a || 1;
      const x = Math.max(0, Math.round(20 * scale));
      const y = Math.max(0, Math.round((SPLIT_Y + 8) * scale));
      const width = Math.min(ctx.canvas.width - x, Math.round((WIDTH - 40) * scale));
      const height = Math.min(ctx.canvas.height - y, Math.max(1, Math.round(42 * scale)));
      const pixels = ctx.getImageData(x, y, width, height).data;
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

  function drawPhotoWordRail() {
    if (!state.textureImage || !state.showPhotoWords || !state.photoWords.trim()) return;
    const words = state.photoWords.trim().split(/\s+/).filter(Boolean).slice(0, 14);
    if (!words.length) return;

    const margin = 46;
    const availableWidth = WIDTH - margin * 2;
    const fontSize = words.length > 11 ? 13 : words.length > 8 ? 15 : 17;
    let fallbackColor;
    if (state.photoWordTone === "light") fallbackColor = "#ffffff";
    else if (state.photoWordTone === "dark") fallbackColor = "#171914";
    else fallbackColor = sampledPhotoRailColor();
    const color = state.textLayers.rail.color || fallbackColor;
    const bounds = photoRailBounds();

    window.editorialText.transformContext(ctx, bounds, state.textLayers.rail, () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, SPLIT_Y, WIDTH, PHOTO_HEIGHT);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.font = `700 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.shadowColor = color === "#ffffff" ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.24)";
      ctx.shadowBlur = 1.5;
      ctx.shadowOffsetY = 1;
      words.forEach((word, index) => {
        const x = words.length === 1 ? WIDTH / 2 : margin + availableWidth * index / (words.length - 1);
        ctx.textAlign = words.length === 1 ? "center" : index === 0 ? "left" : index === words.length - 1 ? "right" : "center";
        ctx.fillText(word, x, SPLIT_Y + 27);
      });
      ctx.restore();
    });
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
    ctx.fillStyle = state.fieldColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawDotField();
    const photoLayer = buildPhotoLayer();
    if (state.textureImage) ctx.drawImage(photoLayer, 0, SPLIT_Y);
    drawUpperMotif(photoLayer);
    if (state.lowerEcho) drawMotif(photoLayer, true);
    drawPhotoWordRail();
    drawCopy();
    ctx.fillStyle = state.textColor;
    ctx.globalAlpha = 0.24;
    ctx.fillRect(0, SPLIT_Y - 1, WIDTH, 2);
    ctx.globalAlpha = 1;
    ctx.restore();
    if (options.refreshOverlays !== false) window.editorialText?.refresh("contour");
  }

  function selectLayer(layer, openControls = false) {
    if (layer === "echo" && !state.lowerEcho) {
      showToast("Turn on Lower contour echo before selecting that layer.");
      return;
    }
    state.activeLayer = layer;
    $$('[data-contour-layer]').forEach((button) => {
      const selected = button.dataset.contourLayer === layer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    if (openControls) $("#contourPositionControls").open = true;
    syncControls();
  }

  function updateLayerStatus() {
    const treatmentLabels = { woven: "WOVEN MOTIF", solid: "SOLID MOTIF", original: "ORIGINAL MARK" };
    $("#contourLayerStatus").textContent = state.activeLayer === "motif"
      ? treatmentLabels[state.upperTreatment] + " · " + state.cells.length + " CELLS"
      : state.activeLayer === "echo"
        ? `LOWER ECHO · ${state.linkContours ? "LINKED" : "INDEPENDENT"}`
        : "LOWER PHOTO ACTIVE";
  }

  function syncControls() {
    const video = textureVideo();
    const hasVideo = Boolean(video);
    const contourVideo = maskVideo();
    const hasContourVideo = Boolean(contourVideo);
    const hasMotionVideo = hasMotionSource() && Boolean(state.textureImage && state.maskImage);
    $("#contourVideoPlayback").hidden = !hasVideo;
    $("#contourMaskVideoPlayback").hidden = !hasContourVideo;
    $("#animatedExportControls").hidden = !hasMotionVideo;
    $("#animatedExport").hidden = !hasMotionVideo;
    const playButton = $("#contourVideoPlayToggle");
    const playing = hasVideo && !video.paused && !video.ended;
    playButton.classList.toggle("playing", playing);
    playButton.setAttribute("aria-pressed", String(playing));
    $("span", playButton).textContent = playing ? "Pause" : "Play";
    const textureSoundButton = $("#contourVideoSoundToggle");
    textureSoundButton.disabled = !hasVideo || state.recording;
    textureSoundButton.setAttribute("aria-pressed", String(hasVideo && state.textureSound));
    textureSoundButton.setAttribute("aria-label", `Turn texture video sound ${state.textureSound ? "off" : "on"}`);
    textureSoundButton.title = state.textureSound ? "Sound on" : "Sound off";
    $("#contourVideoSoundStatus").textContent = `LOOP · SOUND ${state.textureSound ? "ON" : "OFF"}`;
    if (video) video.muted = !state.textureSound;
    syncVideoTimeline();
    const maskPlayButton = $("#contourMaskVideoPlayToggle");
    const maskPlaying = hasContourVideo && !contourVideo.paused && !contourVideo.ended;
    maskPlayButton.classList.toggle("playing", maskPlaying);
    maskPlayButton.setAttribute("aria-pressed", String(maskPlaying));
    $("span", maskPlayButton).textContent = maskPlaying ? "Pause" : "Play";
    const maskSoundButton = $("#contourMaskVideoSoundToggle");
    maskSoundButton.disabled = !hasContourVideo || state.recording;
    maskSoundButton.setAttribute("aria-pressed", String(hasContourVideo && state.maskSound));
    maskSoundButton.setAttribute("aria-label", `Turn contour video sound ${state.maskSound ? "off" : "on"}`);
    maskSoundButton.title = state.maskSound ? "Sound on" : "Sound off";
    $("#contourMaskVideoSoundStatus").textContent = `ANIMATED MASK · LOOP · SOUND ${state.maskSound ? "ON" : "OFF"}`;
    if (contourVideo) contourVideo.muted = !state.maskSound;
    syncMaskVideoTimeline();
    state.clipDuration = clamp(Number(state.clipDuration) || 10, 3, MAX_CLIP_DURATION);
    $("#animatedClipDuration").value = state.clipDuration;
    $("#animatedClipDurationOutput").textContent = `${state.clipDuration}s`;
    const recordingFormat = preferredRecordingFormat();
    const animatedExport = $("#animatedExport");
    animatedExport.disabled = !hasMotionVideo || !state.textureImage || !state.maskImage || !recordingFormat || state.recording;
    $("strong", animatedExport).textContent = state.recording
      ? `Recording ${Math.min(state.clipDuration, state.recordingProgress).toFixed(1)}s`
      : `Export ${state.clipDuration}s video`;
    $("#animatedExportFormat").textContent = recordingFormat
      ? `Records locally as ${recordingFormat.label} · ${activeSoundVideo() ? "sound on" : "silent"} · current playheads`
      : "Animated export is unavailable in this browser";
    $("#contourClearTexture").disabled = state.recording;
    $("#contourTextureInput").disabled = state.recording;
    $("#contourClearMask").disabled = state.recording;
    $("#contourMaskInput").disabled = state.recording;
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
    $("#contourLowerEcho").checked = state.lowerEcho;
    $("#contourShowPhotoWords").checked = state.showPhotoWords;
    $("#contourPhotoWordFields").hidden = !state.showPhotoWords;
    $("#contourPhotoWords").value = state.photoWords;
    $("#contourPhotoWordTone").value = state.photoWordTone;
    $("#contourLinkPositions").checked = state.linkContours;
    $("#contourFieldColor").value = state.fieldColor;
    $("#contourFieldValue").textContent = state.fieldColor.toUpperCase();
    $("#contourTextColor").value = state.textColor;
    $("#contourTextValue").textContent = state.textColor.toUpperCase();
    $("#contourMotifColor").value = state.motifColor;
    $("#contourMotifValue").textContent = state.motifColor.toUpperCase();
    $("#contourMaskColor").value = state.maskColor;
    $("#contourMaskValue").textContent = state.maskColor.toUpperCase();
    const layerScaleControl = $("#contourLayerScale");
    layerScaleControl.min = state.activeLayer === "photo" ? "65" : "40";
    layerScaleControl.max = state.activeLayer === "photo" ? "250" : "500";
    layerScaleControl.value = Math.round(state[state.activeLayer].scale * 100);
    $("#contourLayerScaleOutput").textContent = Math.round(state[state.activeLayer].scale * 100) + "%";
    $("#contourCanvasDimensions").textContent = state.outputWidth + " × " + Math.round(state.outputWidth * 4 / 3) + " PX";
    updateLayerStatus();
    $("#contourDragHintText").textContent = state.linkContours
      ? "Upper and lower contours are linked"
      : state.activeLayer === "echo"
        ? "Drag the lower half to move only the echo"
        : state.activeLayer === "motif"
          ? "Drag the upper half to move only the motif"
          : "Drag the lower half to reframe the media";
    $("#contourLowerCanvasLayerLabel").textContent = state.activeLayer === "echo" && state.lowerEcho
      ? "Lower echo"
      : "Lower photo";
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
      button.disabled = state.upperTreatment !== "woven";
    });
    $$('[data-contour-upper-treatment]').forEach((button) => {
      const selected = button.dataset.contourUpperTreatment === state.upperTreatment;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const treatmentNotes = {
      woven: "Texture-filled pixels use the lower image or current animation frame.",
      solid: "Contour pixels use the solid motif color while the field stays independent.",
      original: "The uploaded logo or icon stays intact, including its original colors.",
    };
    $("#contourUpperTreatmentNote").textContent = treatmentNotes[state.upperTreatment];
    $$('[data-contour-layer]').forEach((button) => {
      const selected = button.dataset.contourLayer === state.activeLayer;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = button.dataset.contourLayer === "echo" && !state.lowerEcho;
    });
    $$('[data-contour-canvas-layer]').forEach((zone) => {
      const selected = zone.dataset.contourCanvasLayer === "motif"
        ? state.activeLayer === "motif"
        : ["photo", "echo"].includes(state.activeLayer);
      zone.classList.toggle("selected", selected);
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
    state.upperTreatment = "woven";
    state.lowerEcho = true;
    state.symmetry = "none";
    state.layout = "orbit";
    state.activeLayer = "motif";
    state.motif = { x: 0.5, y: 0.47, scale: 1 };
    state.echo = { x: 0.5, y: 0.47, scale: 1 };
    state.linkContours = true;
    state.photo = { x: 0.5, y: 0.5, scale: 1 };
    state.showDots = true;
    state.fieldColor = "#f5f3ee";
    state.textColor = "#171914";
    state.motifColor = "#171914";
    state.maskColor = "#f5f3ee";
    state.leftTitle = "Chromatic Field Study";
    state.leftNote = "a quiet geometry gathered from light";
    state.rightTitle = "Woven Contour Motif";
    state.rightNote = "Colorway: Moss · Ochre · Alabaster";
    state.showPhotoWords = false;
    state.photoWords = "Contour Study · by Field Studio · Moving Texture";
    state.photoWordTone = "auto";
    state.textureSound = false;
    state.maskSound = false;
    if (textureVideo()) textureVideo().muted = true;
    if (maskVideo()) maskVideo().muted = true;
    state.textLayers = { left: defaultTextTransform(), right: defaultTextTransform(), rail: defaultTextTransform() };
    syncCopyFields();
    rebuildContour();
    updateReadyState();
    syncControls();
    render();
    showToast("Contour Loom reset.");
  }

  function exportPng() {
    if (!state.textureImage || !state.maskImage) {
      showToast("Add both a texture and contour source before exporting.");
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
    const videos = motionVideos();
    if (!hasMotionSource() || !state.textureImage || !state.maskImage) {
      showToast("Add an animated GIF or video source before exporting motion.");
      return;
    }
    const format = preferredRecordingFormat();
    if (!format || !canvas.captureStream || !window.MediaRecorder) {
      showToast("Animated export is not supported by this browser. Still PNG remains available.");
      return;
    }

    const duration = clamp(Math.round(Number(state.clipDuration) || 10), 3, MAX_CLIP_DURATION);
    const playbackSnapshots = videos.map((video) => ({
      video,
      startTime: video.currentTime,
      wasPaused: video.paused,
    }));
    let stream = null;
    let sourceAudioStream = null;
    let includedAudio = false;
    let recorder = null;
    let progressTimer = null;
    let stopTimer = null;

    try {
      state.recording = true;
      state.recordingProgress = 0;
      syncControls();
      showToast(`Recording ${duration}s locally · keep this tab open.`);

      await Promise.all(videos.map((video) => video.play()));
      refreshAnimatedMaskFrame(true);
      scheduleVideoRender();
      render({ refreshOverlays: false });
      stream = canvas.captureStream(30);
      const soundVideo = activeSoundVideo();
      if (soundVideo) {
        sourceAudioStream = videoCaptureStream(soundVideo);
        const audioTrack = sourceAudioStream?.getAudioTracks?.()[0];
        if (audioTrack) {
          stream.addTrack(audioTrack);
          includedAudio = true;
        }
        else showToast("This browser could not capture the selected sound; the moving export will be silent.");
      }
      recorder = new MediaRecorder(stream, {
        mimeType: format.mimeType,
        videoBitsPerSecond: 6_000_000,
      });
      const chunks = [];
      const completed = new Promise((resolve, reject) => {
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data?.size) chunks.push(event.data);
        });
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: format.mimeType })), { once: true });
        recorder.addEventListener("error", () => reject(recorder.error || new Error("Animated recording failed.")), { once: true });
      });

      const startedAt = performance.now();
      recorder.start(250);
      progressTimer = window.setInterval(() => {
        state.recordingProgress = Math.min(duration, (performance.now() - startedAt) / 1000);
        syncControls();
      }, 250);
      stopTimer = window.setTimeout(() => {
        if (recorder?.state === "recording") recorder.stop();
      }, duration * 1000);

      const blob = await completed;
      if (!blob.size) throw new Error("The browser returned an empty animated export.");
      const filename = `${state.fileBase}-contour-loom-${duration}s.${format.extension}`;
      downloadBlob(blob, filename);
      showToast(`${duration}s Contour Loom ${format.label} exported${includedAudio ? " with sound" : ""}.`);
    } catch (error) {
      if (recorder?.state === "recording") recorder.stop();
      showToast(error?.message || "Animated export could not be created.");
    } finally {
      if (progressTimer) window.clearInterval(progressTimer);
      if (stopTimer) window.clearTimeout(stopTimer);
      stream?.getTracks().forEach((track) => track.stop());
      sourceAudioStream?.getTracks().forEach((track) => {
        if (!stream?.getTracks().includes(track)) track.stop();
      });
      state.recording = false;
      state.recordingProgress = 0;
      stopVideoRenderLoop();
      playbackSnapshots.forEach(({ video, startTime, wasPaused }) => {
        if (wasPaused) video.pause();
        video.currentTime = Math.min(startTime, Number.isFinite(video.duration) ? video.duration : startTime);
      });
      refreshAnimatedMaskFrame(true);
      render();
      if (hasAnimatedGif() || playbackSnapshots.some(({ wasPaused }) => !wasPaused)) scheduleVideoRender();
      updateReadyState();
      syncControls();
    }
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width * WIDTH,
      y: (event.clientY - rect.top) / rect.height * HEIGHT,
    };
  }

  function canvasLayerForZone(zoneLayer) {
    if (zoneLayer === "photo" && state.activeLayer === "echo" && state.lowerEcho) return "echo";
    return zoneLayer;
  }

  function syncLinkedContourTransform(sourceLayer) {
    if (!state.linkContours || !["motif", "echo"].includes(sourceLayer)) return;
    const targetLayer = sourceLayer === "motif" ? "echo" : "motif";
    state[targetLayer] = { ...state[sourceLayer] };
  }

  function startDrag(event) {
    if (!state.textureImage && !state.maskImage) return;
    const layer = canvasLayerForZone(event.currentTarget.dataset.contourCanvasLayer);
    selectLayer(layer, true);
    state.dragging = { layer, point: canvasPoint(event), pointerId: event.pointerId, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!state.dragging || state.dragging.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    const deltaX = point.x - state.dragging.point.x;
    const deltaY = point.y - state.dragging.point.y;
    if (["motif", "echo"].includes(state.dragging.layer)) {
      const transform = state[state.dragging.layer];
      transform.x = clamp(transform.x + deltaX / WIDTH, -0.5, 1.5);
      transform.y = clamp(transform.y + deltaY / SPLIT_Y, -0.5, 1.5);
      syncLinkedContourTransform(state.dragging.layer);
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
  $("#contourEmptyChooseButton").addEventListener("click", () => {
    $("#contourTextureInput").value = "";
    $("#contourTextureInput").click();
  });
  $("#contourResetPhoto").addEventListener("click", () => resetPhotoPosition());
  $("#contourResetMotif").addEventListener("click", () => resetMotifPosition());
  $("#contourResetSelectedLayer").addEventListener("click", resetSelectedPosition);
  $("#contourClearTexture").addEventListener("click", clearTexture);
  $("#contourClearMask").addEventListener("click", clearMask);
  $("#contourVideoPlayToggle").addEventListener("click", () => {
    const video = textureVideo();
    if (!video) return;
    if (video.paused) playTextureVideo();
    else pauseTextureVideo();
  });
  $("#contourVideoSoundToggle").addEventListener("click", () => {
    setVideoSound("texture", !state.textureSound);
  });
  $("#contourVideoPlayhead").addEventListener("input", (event) => {
    const video = textureVideo();
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = clamp(Number(event.target.value), 0, video.duration);
    render();
    syncVideoTimeline();
  });
  $("#contourMaskVideoPlayToggle").addEventListener("click", () => {
    const video = maskVideo();
    if (!video) return;
    if (video.paused) playMaskVideo();
    else pauseMaskVideo();
  });
  $("#contourMaskVideoSoundToggle").addEventListener("click", () => {
    setVideoSound("mask", !state.maskSound);
  });
  $("#contourMaskVideoPlayhead").addEventListener("input", (event) => {
    const video = maskVideo();
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = clamp(Number(event.target.value), 0, video.duration);
    refreshAnimatedMaskFrame(true);
    render();
    syncMaskVideoTimeline();
  });

  const videoPreview = $("#contourTextureVideoThumb");
  videoPreview.addEventListener("play", () => {
    scheduleVideoRender();
    updateReadyState();
    syncControls();
  });
  videoPreview.addEventListener("pause", () => {
    if (!state.recording) stopVideoRenderLoop();
    render();
    updateReadyState();
    syncControls();
    scheduleVideoRender();
  });
  videoPreview.addEventListener("timeupdate", syncVideoTimeline);
  videoPreview.addEventListener("loadedmetadata", syncVideoTimeline);

  const maskVideoPreview = $("#contourMaskVideoThumb");
  maskVideoPreview.addEventListener("play", () => {
    refreshAnimatedMaskFrame(true);
    scheduleVideoRender();
    updateReadyState();
    syncControls();
  });
  maskVideoPreview.addEventListener("pause", () => {
    if (!state.recording) stopVideoRenderLoop();
    refreshAnimatedMaskFrame(true);
    render();
    updateReadyState();
    syncControls();
    scheduleVideoRender();
  });
  maskVideoPreview.addEventListener("timeupdate", syncMaskVideoTimeline);
  maskVideoPreview.addEventListener("loadedmetadata", syncMaskVideoTimeline);
  maskVideoPreview.addEventListener("seeked", () => {
    refreshAnimatedMaskFrame(true);
    render();
    syncMaskVideoTimeline();
  });

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
  $$('[data-contour-upper-treatment]').forEach((button) => button.addEventListener("click", () => {
    state.upperTreatment = button.dataset.contourUpperTreatment;
    syncControls();
    render();
    const labels = { woven: "Woven texture", solid: "Solid motif", original: "Original mark" };
    showToast(`${labels[state.upperTreatment]} active in the upper field.`);
  }));
  $$('[data-contour-layer]').forEach((button) => button.addEventListener("click", () => selectLayer(button.dataset.contourLayer)));
  $("#contourLinkPositions").addEventListener("change", (event) => {
    state.linkContours = event.target.checked;
    if (state.linkContours) state.echo = { ...state.motif };
    syncControls();
    render();
    showToast(state.linkContours
      ? "Contour placements linked · lower echo aligned to upper motif."
      : "Contour placements unlinked · each can now move independently.");
  });
  $("#contourLayerScale").addEventListener("input", (event) => {
    state[state.activeLayer].scale = Number(event.target.value) / 100;
    syncLinkedContourTransform(state.activeLayer);
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
  $("#contourShowPhotoWords").addEventListener("change", (event) => {
    state.showPhotoWords = event.target.checked;
    $("#contourPhotoWordFields").hidden = !state.showPhotoWords;
    render();
  });
  $("#contourPhotoWords").addEventListener("input", (event) => {
    state.photoWords = event.target.value;
    render();
  });
  $("#contourPhotoWordTone").addEventListener("change", (event) => {
    state.photoWordTone = event.target.value;
    render();
  });
  $("#contourShowDots").addEventListener("change", (event) => {
    state.showDots = event.target.checked;
    render();
  });
  $("#contourLowerEcho").addEventListener("change", (event) => {
    state.lowerEcho = event.target.checked;
    if (!state.lowerEcho && state.activeLayer === "echo") state.activeLayer = "motif";
    syncControls();
    render();
    showToast(state.lowerEcho ? "Lower contour echo visible." : "Lower contour echo hidden · upper motif preserved.");
  });
  [["#contourFieldColor", "fieldColor"], ["#contourTextColor", "textColor"], ["#contourMotifColor", "motifColor"], ["#contourMaskColor", "maskColor"]]
    .forEach(([selector, key]) => $(selector).addEventListener("input", (event) => {
      state[key] = event.target.value;
      syncControls();
      render();
    }));
  $$('[data-contour-canvas-layer]').forEach((zone) => {
    zone.addEventListener("pointerdown", startDrag);
    zone.addEventListener("pointermove", moveDrag);
    zone.addEventListener("pointerup", stopDrag);
    zone.addEventListener("pointercancel", stopDrag);
    zone.addEventListener("click", () => selectLayer(canvasLayerForZone(zone.dataset.contourCanvasLayer), true));
  });

  if ("IntersectionObserver" in window) {
    const canvasObserver = new IntersectionObserver(([entry]) => {
      canvasVisible = Boolean(entry?.isIntersecting);
      if (canvasVisible) scheduleVideoRender();
      else stopVideoRenderLoop();
    }, { threshold: 0.01 });
    canvasObserver.observe(canvas);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopVideoRenderLoop();
    else scheduleVideoRender();
  });
  new MutationObserver(() => {
    if (document.body.dataset.activeTool === "contour") scheduleVideoRender();
    else stopVideoRenderLoop();
  }).observe(document.body, { attributes: true, attributeFilter: ["data-active-tool"] });

  function activate() {
    $("#fileNameHeader").textContent = state.textureImage
      ? state.fileBase.replace(/-/g, " ").toUpperCase()
      : "CONTOUR LOOM";
    updateReadyState();
    syncControls();
    render();
    scheduleVideoRender();
  }

  window.editorialText.register("contour", {
    canvas,
    shell: $("#contourArtboardShell"),
    panel: "#contourEditorialPanel",
    width: WIDTH,
    height: HEIGHT,
    getLayers: () => [
      { id: "left", label: "Left editorial label", bounds: copyLayerBounds("left"), enabled: true },
      { id: "right", label: "Right editorial label", bounds: copyLayerBounds("right"), enabled: true },
      { id: "rail", label: "Photo word rail", bounds: photoRailBounds(), enabled: Boolean(state.textureImage && state.showPhotoWords) },
    ].map((layer) => ({
      ...layer,
      transform: state.textLayers[layer.id],
      color: state.textLayers[layer.id].color || (layer.id === "rail" && state.photoWordTone === "dark" ? "#171914" : layer.id === "rail" ? "#ffffff" : state.textColor),
    })),
    updateLayer: (id, patch) => Object.assign(state.textLayers[id], patch),
    resetLayer: (id) => { state.textLayers[id] = defaultTextTransform(); },
    getAlignment: (layer) => layer.id === "rail"
      ? { x: WIDTH / 2, y: SPLIT_Y + PHOTO_HEIGHT / 2, threshold: 12, region: { x: 0, y: SPLIT_Y, width: WIDTH, height: PHOTO_HEIGHT } }
      : { x: WIDTH / 2, y: SPLIT_Y / 2, threshold: 12, region: { x: 0, y: 0, width: WIDTH, height: SPLIT_Y } },
    render,
  });

  window.contourLoom = {
    activate,
    reset,
    exportPng,
    exportAnimated,
    getExportOptions: () => ({
      canExport: Boolean(state.textureImage && state.maskImage),
      motionAvailable: hasMotionSource() && Boolean(state.textureImage && state.maskImage && preferredRecordingFormat()),
      outputWidth: state.outputWidth,
      clipDuration: state.clipDuration,
      recording: state.recording,
      audioEnabled: Boolean(activeSoundVideo()),
      soundAvailable: Boolean(textureVideo() || maskVideo()),
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
    useLucideIcon,
    getCurrentLucideIcon: () => state.lucideIcon,
  };
  updateReadyState();
  syncControls();
  render();
})();
