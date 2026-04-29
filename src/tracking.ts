import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// WASM JS/binary files are copied locally by scripts/copy-mediapipe.js so the
// extension's script-src CSP doesn't block MediaPipe's CDN script injection.
const WASM_BASE = chrome.runtime.getURL("mediapipe");
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type HandTracker = {
  detect: (video: HTMLVideoElement, timestampMs: number) => ReturnType<HandLandmarker["detectForVideo"]>;
  close: () => void;
};

export async function createHandTracker({ numHands = 2 }: { numHands?: number } = {}): Promise<HandTracker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL, delegate: "GPU" },
    numHands,
    runningMode: "VIDEO"
  });

  return {
    detect: (video, timestampMs) => landmarker.detectForVideo(video, timestampMs),
    close: () => landmarker.close()
  };
}
