import { InteractiveSegmenter } from "/vendor/mediapipe/vision_bundle.mjs";

const WASM_FILESET = {
  wasmLoaderPath: "/vendor/mediapipe/wasm/vision_wasm_internal.js",
  wasmBinaryPath: "/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
};
const MODEL_PATH = "/vendor/mediapipe/models/interactive_segmentation.task";
const POSITIVE_BRUSH = 1;
const maskCanvas = document.createElement("canvas");

let segmenterPromise = null;
let preparedSource = null;

function imageIdentity(image) {
  return [
    image.dataset?.pointExtractorIdentity || "",
    image.currentSrc || image.src || "canvas",
    image.videoWidth || image.naturalWidth || image.width,
    image.videoHeight || image.naturalHeight || image.height,
  ].join("|");
}

async function getSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = InteractiveSegmenter.createFromOptions(WASM_FILESET, {
      baseOptions: {
        modelAssetPath: MODEL_PATH,
        delegate: "CPU",
      },
      canvas: maskCanvas,
    }).catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

export async function prepare(image) {
  const segmenter = await getSegmenter();
  const identity = imageIdentity(image);
  if (preparedSource !== identity) {
    segmenter.setImage(image);
    preparedSource = identity;
  }
  return segmenter;
}

function nearestSelectedPixel(binary, width, height, centerX, centerY) {
  const direct = centerY * width + centerX;
  if (binary[direct]) return direct;
  const maximumRadius = Math.max(8, Math.round(Math.min(width, height) * 0.045));
  for (let radius = 1; radius <= maximumRadius; radius += 1) {
    const left = Math.max(0, centerX - radius);
    const right = Math.min(width - 1, centerX + radius);
    const top = Math.max(0, centerY - radius);
    const bottom = Math.min(height - 1, centerY + radius);
    for (let x = left; x <= right; x += 1) {
      const topIndex = top * width + x;
      if (binary[topIndex]) return topIndex;
      const bottomIndex = bottom * width + x;
      if (binary[bottomIndex]) return bottomIndex;
    }
    for (let y = top + 1; y < bottom; y += 1) {
      const leftIndex = y * width + left;
      if (binary[leftIndex]) return leftIndex;
      const rightIndex = y * width + right;
      if (binary[rightIndex]) return rightIndex;
    }
  }
  return -1;
}

function connectedMask(values, width, height, point) {
  const length = width * height;
  const binary = new Uint8Array(length);
  const threshold = 0.42;
  for (let index = 0; index < length; index += 1) {
    binary[index] = values[index] >= threshold ? 1 : 0;
  }

  const centerX = Math.min(width - 1, Math.max(0, Math.floor(point.x * width)));
  const centerY = Math.min(height - 1, Math.max(0, Math.floor(point.y * height)));
  const seed = nearestSelectedPixel(binary, width, height, centerX, centerY);
  if (seed < 0) throw new Error("The point prompt did not produce a visible object mask");

  const selected = new Uint8Array(length);
  const queue = new Int32Array(length);
  let head = 0;
  let tail = 1;
  let area = 0;
  queue[0] = seed;
  selected[seed] = 1;
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    area += 1;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!binary[next] || selected[next]) continue;
        selected[next] = 1;
        queue[tail++] = next;
      }
    }
  }

  if (area < Math.max(24, length * 0.0002)) {
    throw new Error("The selected object mask was too small to use");
  }
  return selected;
}

function cutoutFromMask(image, mask, width, height) {
  const alphaCanvas = document.createElement("canvas");
  alphaCanvas.width = width;
  alphaCanvas.height = height;
  const alphaContext = alphaCanvas.getContext("2d");
  const alphaFrame = alphaContext.createImageData(width, height);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * 4;
    alphaFrame.data[offset] = 255;
    alphaFrame.data[offset + 1] = 255;
    alphaFrame.data[offset + 2] = 255;
    alphaFrame.data[offset + 3] = 255;
  }
  alphaContext.putImageData(alphaFrame, 0, 0);

  const output = document.createElement("canvas");
  output.width = image.naturalWidth || image.width;
  output.height = image.naturalHeight || image.height;
  const outputContext = output.getContext("2d");
  outputContext.drawImage(image, 0, 0, output.width, output.height);
  outputContext.globalCompositeOperation = "destination-in";
  outputContext.imageSmoothingEnabled = true;
  outputContext.drawImage(alphaCanvas, 0, 0, output.width, output.height);
  outputContext.globalCompositeOperation = "source-over";
  return output;
}

export async function extract(image, point) {
  const segmenter = await prepare(image);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const resultMask = segmenter.segment([{
    brushMode: POSITIVE_BRUSH,
    point: [{ x: point.x, y: point.y }],
    isCompleted: true,
  }]);
  try {
    const values = resultMask.getAsFloat32Array();
    const selected = connectedMask(values, resultMask.width, resultMask.height, point);
    return cutoutFromMask(image, selected, resultMask.width, resultMask.height);
  } finally {
    resultMask.close();
  }
}
