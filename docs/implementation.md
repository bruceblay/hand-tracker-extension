# Hand Tracker Extension - Implementation Plan

## Overview
A Chrome extension that uses the webcam to track the user's hand and inject a virtual cursor into any web page. Pinch to click. Built on top of the gesture stack already proven out in `../../side-stuff/hand-tracker` (referred to below as the *hand-tracker repo*).

## Goals
1. Camera + MediaPipe hand tracking running in the background as long as the extension is enabled.
2. A cursor element overlaid on the active tab that follows the user's index fingertip.
3. Pinch (thumb + index) to click on whatever element the cursor is over.
4. Toggleable per-tab via the extension popup (and a keyboard shortcut).
5. Reasonable accessibility-tool ergonomics: low latency, no false fires, can navigate normal web pages.

## Architecture (Manifest V3)

### Why each piece exists
- **Service worker (`background.ts`)** — orchestration. Owns the on/off state, tells the offscreen document to start/stop, broadcasts pinch events and cursor positions to the active content script. Service workers can't access `getUserMedia` themselves, so they delegate.
- **Offscreen document (`offscreen.html` + script)** — the only place a Manifest V3 extension can run a continuous webcam + heavy WASM. Owns the `<video>` element, the `HandLandmarker` instance, and the per-frame loop. Sends `cursor` and `pinch` messages to the background via `chrome.runtime.sendMessage`. (See `../browser-kaoss/offscreen.html` for an existing offscreen pattern in this codebase.)
- **Content script** — injected into every page (or just the active tab on toggle). Renders the cursor div (high `z-index`, `pointer-events: none`), maps incoming normalized coordinates to viewport pixels, dispatches synthetic events to the element under the cursor on pinch.
- **Popup** — minimal UI: enable/disable toggle, calibration button, sensitivity slider(s), camera permission status.

### Message flow
```
[user pinches]
  offscreen → background    { type: 'pinch', x, y }
  background → content      { type: 'pinch', x, y }
  content                   document.elementFromPoint(x, y) → element.click()
```

Cursor position is broadcast each frame the same way (`type: 'cursor'`). Background filters: only forwards to the active tab.

## Stack

- **[Plasmo](https://plasmo.com)** — extension framework, matching the rest of `../`. Handles MV3 manifest, build, hot reload.
- **TypeScript + React** — match existing extensions.
- **[@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision)** — `HandLandmarker`. Same WASM/GPU approach as the hand-tracker repo.
- **`chrome.offscreen` API** — required for the camera/WASM in MV3.

## Code to reuse from the hand-tracker repo

Most of the gesture work is already done. We can import directly from those files (or copy them in):

- `src/tracking.js` → `createHandTracker` (HandLandmarker setup + WASM URL).
- `src/gestures.js` → `PinchDetector` (threshold + arm-first behavior — the arm-first fix is exactly what we want so a hand entering frame already pinched doesn't fire instantly).
- `src/mappings.js` → `mirrorX`, `OnePole` smoother.
- `experiments/pdf-annotator/main.js` → the `viewportToCanvas` math and `getVideoDisplayBounds` for the aspect-ratio-aware cursor mapping.
- The cursor styling and pinched-state animation from the hand-tracker landing page (`main.js` + `index.html`) is a near-perfect starting point.

The webcam → MediaPipe → pinch detection pipeline is the same as the landing page's "enable hand control" feature; this extension is essentially that, scoped to "any page in the browser."

## Phase 1: Hello world

- [ ] `plasmo init` based on doorman / browser-kaoss conventions.
- [ ] Manifest V3 with `permissions`: `offscreen`, `activeTab`, `storage`. `host_permissions`: `<all_urls>` (eventually narrowed).
- [ ] Background service worker creates an offscreen document on extension enable; tears it down on disable.
- [ ] Offscreen document opens the camera (selfie) and runs `HandLandmarker`. Logs landmarks to console.
- [ ] Content script injects a div, listens for messages, draws the cursor at a fixed position (no real coords yet).

Goal of phase 1: extension is installable, camera runs, cursor visible on any page.

## Phase 2: Cursor + click

- [ ] Coordinate pipeline: offscreen sends normalized index-fingertip x/y → background → content. Content maps to viewport pixels accounting for `object-fit: cover` cropping (port `getVideoDisplayBounds`).
- [ ] Smooth cursor with `OnePole` (~0.3 coefficient). Snap on hand re-entry (same fix as in tetris/paint).
- [ ] Pinch detection in offscreen using `PinchDetector` (arm-first). On `justClosed`, send a `pinch` message.
- [ ] Content script handles `pinch`:
  - Hide cursor briefly, run `document.elementFromPoint(x, y)` to find target.
  - Dispatch a full `mousedown` / `mouseup` / `click` sequence (some sites listen to one or the other).
  - For inputs, also `focus()`.
- [ ] Visual feedback: cursor scales/colors on pinch like the landing page.

Goal of phase 2: navigate a real site (links, buttons) by pinching.

## Phase 3: Polish + ergonomics

- [ ] Popup with enable/disable, sensitivity slider, calibration shortcut.
- [ ] Chrome command (keyboard shortcut) to toggle.
- [ ] Persistence (`chrome.storage.sync`) for user preferences.
- [ ] Per-tab enable: only the active tab gets cursor + clicks; tab switch hands off.
- [ ] Pinch deadzone / stability gate (similar to the finger-counter's frame stability) to suppress flicker fires.
- [ ] Optional: scroll mode (e.g. open palm + move = scroll), drag (pinch + hold), middle-click via a different gesture.
- [ ] Disable on form fields where typing is happening, or near focused inputs, to avoid hijacking text entry.

## Phase 4: Edge cases / robustness

- [ ] Cross-origin iframes: detect when the cursor is over an iframe and either (a) inject a child content script into same-origin frames or (b) gracefully no-op on cross-origin frames with a visual hint.
- [ ] Strict CSP sites: confirm `web_accessible_resources` and content-script CSP behavior on banks / Gmail / etc.
- [ ] Camera permission lifecycle: handle deny, revoke, and "device in use" errors. Surface clearly in the popup.
- [ ] Performance budget: target 30+ FPS on the offscreen tracker without spiking the active tab. Worker delegate (`'GPU'`) helps.
- [ ] Privacy: nothing leaves the device. Clearly state in the popup.

## Open questions

- **One offscreen document or one per tab?** One shared document is much cheaper (single camera, single tracker) but means we must broadcast to whichever tab is active. Probably go shared.
- **Click vs. dwell?** Pinch is the primary action, but for accessibility cases a dwell-to-click (hover N ms = click) may be easier. Could be a setting.
- **Does it work alongside other extensions that inject overlays?** Z-index war. Pick a high value and document.
- **Mobile?** Out of scope. Chrome on mobile doesn't support extensions in the same way.

## Layout (proposed)

```
hand-tracker-extension/
  package.json              Plasmo project
  manifest config in package.json (Plasmo convention)
  background.ts             service worker
  offscreen.html            offscreen document host
  offscreen.ts              camera + MediaPipe loop
  content.ts                cursor injection + click dispatch
  popup.tsx                 React popup UI
  src/
    tracking.ts             HandLandmarker factory (port from hand-tracker)
    gestures.ts             PinchDetector (port)
    mappings.ts             OnePole / mirrorX (port)
  docs/
    implementation.md       this file
    todos.md
```
