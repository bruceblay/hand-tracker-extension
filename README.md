# Hand Tracker

A Chrome extension that uses your webcam to control any web page with hand gestures. Point with your index finger to move a cursor, pinch to click, peace-sign to scroll, open-palm swipe to navigate back/forward.

Built with [Plasmo](https://plasmo.com) (Manifest V3) + [MediaPipe HandLandmarker](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker). Runs entirely on-device — nothing leaves your machine.

## Features

- **Point + pinch** — index finger drives a cursor, thumb-to-index pinch dispatches a click.
- **Two-finger scroll** — peace sign engages position-based scrolling (hand below anchor scrolls down, return to anchor stops).
- **Back / forward** — open-palm horizontal swipe.
- **Two-hand mode** — when both hands are visible, one positions the cursor and the other clicks (configurable).
- **Skeleton overlay** — optional debug visualization of all 21 hand landmarks.
- **Tunable** — pinch sensitivity, motion smoothing, scroll speed, swipe sensitivity, cursor hand.

See [`docs/gestures.md`](docs/gestures.md) for the full reference.

## Install locally (unpacked)

1. Clone and install dependencies:
   ```sh
   git clone https://github.com/bruceblay/hand-tracker-extension.git
   cd hand-tracker-extension
   npm install
   ```
2. Build the extension:
   ```sh
   npm run build
   ```
   This runs `plasmo build` and copies MediaPipe's WASM files into the build dir. Output goes to `build/chrome-mv3-prod/`.
3. Open `chrome://extensions` in Chrome.
4. Enable **Developer mode** (top right).
5. Click **Load unpacked** and select `build/chrome-mv3-prod/`.
6. Pin the extension. Click the icon → **enable**. The first time you'll be sent to a setup tab to grant camera permission.

## Development

```sh
npm run dev
```

This runs `plasmo dev` (with hot reload) and copies the MediaPipe assets into `build/chrome-mv3-dev/`. Load that directory as the unpacked extension instead of `chrome-mv3-prod/`.

> **Plasmo gotcha:** `plasmo dev` doesn't auto-detect *new* entry-point files (a fresh `content.ts`, a new `tabs/foo.tsx`, etc.). When you add one, kill and restart the dev server.

> **`src/` is the source root.** Plasmo treats `src/` as the project root when it exists, so all entry points (`popup.tsx`, `background.ts`, `content.ts`, `tabs/*.tsx`) must live under `src/`. Files at the project root are ignored.

### Manual rebuild loop

```sh
npm run build         # plasmo build + copy mediapipe
```

Then click the **refresh** icon on the Hand Tracker card in `chrome://extensions`. No tab reload is needed — the background re-injects content scripts on the next enable.

## Debugging

The popup includes a live debug pane:

- **content: alive / no ping** — content script registered in the active tab.
- **cursor rx / tx / fails** — counts of cursor messages from the offscreen tracker, and successful forwards to the content script.
- **tracker: frames / hand / video / size** — heartbeat from the MediaPipe loop. If `frames` doesn't climb, the loop is stuck. If `hand=0`, no hand is being detected.
- **mode → pointing / scroll / palm / idle** — gesture mode transitions.

For deeper inspection:

- `chrome://extensions` → Hand Tracker → **service worker** — background logs.
- `chrome://extensions` → **Inspect views: tabs/offscreen.html** — camera + MediaPipe internals.
- DevTools on the actual page — content script (cursor + skeleton) errors.

## Project structure

```
src/
  background.ts       MV3 service worker — state, messages, content-script injection
  content.ts          page-side cursor + skeleton + click dispatch
  offscreen.ts        camera + MediaPipe loop, gesture recognition
  popup.tsx           toolbar popup UI
  tabs/
    offscreen.tsx     hosts offscreen.ts (Plasmo bundles tabs/*.tsx)
    setup.tsx         first-run camera permission grant
  gestures.ts         PinchDetector, SwipeDetector, mode classifier
  mappings.ts         OnePole smoother, mirrorX, distance helper
  tracking.ts         HandLandmarker factory (loads local WASM)
scripts/
  copy-mediapipe.js   copies @mediapipe/tasks-vision/wasm into build/
docs/
  gestures.md         user-facing gesture reference
  implementation.md   original implementation plan
  ideas.md            backlog
  todos.md            scratch
```

## Architecture

Manifest V3 split:

```
[user pinches]
  offscreen.html → background          { type: 'pinch', x, y }
  background    → active tab content   { type: 'pinch', x, y }
  content                              elementFromPoint(x, y) → dispatch click
```

The offscreen document is the only place an MV3 extension can run a continuous webcam + heavy WASM. The service worker forwards events from offscreen to the active tab's content script. The content script renders the cursor + skeleton (in the browser's *top layer* via the Popover API, so they sit above modals).

## Notes

- Synthetic clicks have `isTrusted: false`, so anything that requires a real user gesture (entering fullscreen, unblocking autoplay, opening popups, clipboard write) won't work via pinch. This is a browser security restriction.
- The extension can't run on `chrome://`, the Chrome Web Store, the new-tab page, or PDF viewers — Chrome blocks all extension access there.
- Camera permission must be granted once in the setup tab; the popup itself can't show the prompt because it loses focus when the prompt opens.

## License

ISC.
