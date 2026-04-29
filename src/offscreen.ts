/**
 * Offscreen document: owns the camera + MediaPipe loop, sends cursor and
 * pinch events back to the background service worker.
 */

import { createHandTracker, type HandTracker } from "./tracking";
import {
  PinchDetector,
  SwipeDetector,
  detectMode,
  palmCenter,
  type Mode
} from "./gestures";
import { OnePole, mirrorX } from "./mappings";

const video = document.getElementById("video") as HTMLVideoElement;
const status = document.getElementById("status") as HTMLDivElement;

let stream: MediaStream | null = null;
let tracker: HandTracker | null = null;
let running = false;
let intervalId: number | null = null;

const pinch = new PinchDetector({ closeThreshold: 0.42, openThreshold: 0.62 });
const smoothX = new OnePole(0.35);
const smoothY = new OnePole(0.35);
let hadHandLastFrame = false;
let frames = 0;
let handFrames = 0;
let lastStatsAt = 0;

let currentMode: Mode = "idle";
let scrollAnchorY = 0;
let scrollSensitivity = 30; // pixels per frame at full deflection

const SCROLL_DEADZONE = 0.05; // ignore tiny offsets to avoid jitter

const swipeDetector = new SwipeDetector({
  windowMs: 600,
  minFrames: 5,
  dxThreshold: 0.12,
  velocityThreshold: 0.6,    // normalized units per second
  diagonalRatio: 1.4,        // |dx| must be > 1.4 * |dy|
  monotonicFraction: 0.7,    // 70% of frames must move the dominant direction
  cooldownMs: 700
});

let cursorHand: "Left" | "Right" = "Right";

function applySettings(s: {
  pinch: number;
  smoothing: number;
  scrollSpeed?: number;
  swipeSensitivity?: number;
  cursorHand?: "Left" | "Right";
}) {
  // Pinch slider 0..1 -> close 0.30..0.55, open 0.50..0.75
  pinch.closeThreshold = 0.30 + s.pinch * 0.25;
  pinch.openThreshold = 0.50 + s.pinch * 0.25;
  // Smoothing slider 0..1 -> coeff 1..0.05 (higher slider = more smoothing = smaller coeff)
  const coeff = Math.max(0.05, 1 - s.smoothing);
  smoothX.coeff = coeff;
  smoothY.coeff = coeff;
  // scrollSpeed slider 0..1 -> 5..120 px per frame at full deflection.
  if (typeof s.scrollSpeed === "number") {
    scrollSensitivity = 5 + s.scrollSpeed * 115;
  }
  // swipeSensitivity slider 0..1 -> scale all the swipe thresholds together.
  // Higher slider = easier to trigger (smaller displacement, lower velocity,
  // more lenient diagonal & monotonicity).
  if (typeof s.swipeSensitivity === "number") {
    const k = s.swipeSensitivity; // 0..1
    swipeDetector.params.dxThreshold = 0.18 - k * 0.13;     // 0.18..0.05
    swipeDetector.params.velocityThreshold = 1.0 - k * 0.7; // 1.0..0.3 normalized/sec
    swipeDetector.params.diagonalRatio = 1.6 - k * 0.6;     // 1.6..1.0
    swipeDetector.params.monotonicFraction = 0.85 - k * 0.25; // 0.85..0.60
    swipeDetector.params.windowMs = 350 + k * 450;          // 350..800ms
  }
  if (s.cursorHand === "Left" || s.cursorHand === "Right") {
    cursorHand = s.cursorHand;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "tracker:settings" && message.settings) {
    applySettings(message.settings);
  }
  return false;
});

function setStatus(text: string) {
  if (status) status.textContent = text;
}

async function startCamera() {
  if (stream) return;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
}

async function start() {
  if (running) return;
  let phase = "starting";
  try {
    phase = "camera";
    setStatus("starting camera…");
    await startCamera();
    phase = "model";
    setStatus("loading hand model…");
    if (!tracker) tracker = await createHandTracker({ numHands: 2 });
    running = true;
    setStatus("running");
    // requestAnimationFrame doesn't fire in offscreen documents (they're never
    // rendered), so drive the loop with setInterval at ~30fps.
    intervalId = setInterval(loop, 33) as unknown as number;
    chrome.runtime.sendMessage({ type: "tracker:status", running: true }).catch(() => {});
  } catch (err) {
    const e = err as Error;
    const msg = `${e.name ?? "Error"}: ${e.message ?? String(err)}`;
    setStatus(`error in ${phase}: ${msg}`);
    chrome.runtime.sendMessage({
      type: "tracker:status",
      running: false,
      phase,
      error: msg
    }).catch(() => {});
  }
}

function stop() {
  running = false;
  if (intervalId != null) clearInterval(intervalId);
  intervalId = null;
  stopCamera();
  setStatus("stopped");
  chrome.runtime.sendMessage({ type: "tracker:status", running: false }).catch(() => {});
}

function loop() {
  if (!running || !tracker) return;
  frames++;
  const now = performance.now();
  if (now - lastStatsAt > 500) {
    lastStatsAt = now;
    chrome.runtime
      .sendMessage({
        type: "tracker:stats",
        frames,
        handFrames,
        videoReady: video.readyState >= 2,
        videoSize: { w: video.videoWidth, h: video.videoHeight }
      })
      .catch(() => {});
  }
  if (video.readyState >= 2) {
    let result;
    try {
      result = tracker.detect(video, performance.now());
    } catch (err) {
      chrome.runtime
        .sendMessage({
          type: "tracker:status",
          running: false,
          phase: "detect",
          error: `${(err as Error).name}: ${(err as Error).message}`
        })
        .catch(() => {});
      return;
    }
    const allHandsRaw = result?.landmarks ?? [];
    const handednesses = result?.handednesses ?? [];
    const allHands = allHandsRaw.map((h) => mirrorX(h));

    // Pick which detected hand is the cursor and which (if any) is the click hand.
    let cursorIdx = -1;
    let clickIdx = -1;
    if (allHands.length === 1) {
      cursorIdx = 0;
      clickIdx = 0; // single-hand mode: same hand cursors and clicks
    } else if (allHands.length >= 2) {
      const labels = handednesses.map((h) => h?.[0]?.categoryName ?? "");
      cursorIdx = labels.findIndex((l) => l === cursorHand);
      if (cursorIdx === -1) cursorIdx = 0;
      clickIdx = labels.findIndex((_, i) => i !== cursorIdx);
      if (clickIdx === -1) clickIdx = cursorIdx === 0 ? 1 : 0;
    }

    const landmarks = cursorIdx >= 0 ? allHands[cursorIdx] : null;
    const clickLandmarks = clickIdx >= 0 ? allHands[clickIdx] : null;

    // Pinch detection runs on the click hand. In single-hand mode that's the
    // same as the cursor hand; in two-hand mode it's the other one.
    const pinchResult = pinch.update(clickLandmarks);

    if (landmarks) {
      handFrames++;

      const newMode = detectMode(landmarks);
      const modeChanged = newMode !== currentMode;
      if (modeChanged) {
        currentMode = newMode;
        // Anchor the scroll origin at the hand's y when scroll mode begins —
        // hand position relative to anchor drives scroll velocity.
        if (newMode === "scroll") scrollAnchorY = landmarks[8].y;
        if (newMode !== "palm") swipeDetector.reset();
        chrome.runtime.sendMessage({ type: "tracker:mode", mode: newMode }).catch(() => {});
      }

      const tip = landmarks[8];
      if (!hadHandLastFrame) {
        smoothX.reset(tip.x);
        smoothY.reset(tip.y);
      }
      const x = smoothX.process(tip.x);
      const y = smoothY.process(tip.y);
      hadHandLastFrame = true;

      // Always send the cursor message so the content script can draw the
      // skeleton even outside pointing mode. We mark cursorVisible separately
      // so the content script knows whether to show the dot.
      chrome.runtime.sendMessage({
        type: "cursor",
        x,
        y,
        pinched: pinchResult.state === "closed",
        cursorVisible: currentMode === "pointing",
        mode: currentMode,
        hands: allHands.map((h) => h.map((l) => ({ x: l.x, y: l.y })))
      }).catch(() => {});

      if (currentMode === "pointing" && pinchResult.justClosed) {
        chrome.runtime.sendMessage({ type: "pinch", x, y }).catch(() => {});
      }

      if (currentMode === "scroll") {
        const offset = landmarks[8].y - scrollAnchorY;
        const sign = Math.sign(offset);
        const magnitude = Math.max(0, Math.abs(offset) - SCROLL_DEADZONE);
        if (magnitude > 0) {
          // Square the magnitude so small offsets nudge gently, larger offsets
          // accelerate.
          const dy = sign * magnitude * magnitude * scrollSensitivity * 40;
          chrome.runtime.sendMessage({ type: "scroll", dy }).catch(() => {});
        }
      }

      if (currentMode === "palm") {
        const now = performance.now();
        swipeDetector.push(palmCenter(landmarks), now);
        const swipe = swipeDetector.detect(now);
        if (swipe) {
          // Swipe left = back, swipe right = forward.
          chrome.runtime
            .sendMessage({
              type: "navigate",
              direction: swipe === "left" ? "back" : "forward"
            })
            .catch(() => {});
        }
      }
    } else if (hadHandLastFrame) {
      hadHandLastFrame = false;
      currentMode = "idle";
      swipeDetector.reset();
      chrome.runtime
        .sendMessage({
          type: "cursor",
          x: null,
          y: null,
          pinched: false,
          cursorVisible: false,
          mode: "idle",
          hands: []
        })
        .catch(() => {});
    }
  }
}

// Auto-start on load — the background only creates this document when enabled,
// and closing the document tears everything down.
start();
