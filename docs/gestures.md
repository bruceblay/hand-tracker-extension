# Hand Tracker Gestures

Reference for every gesture the extension recognizes and what it does. Keep this in sync with `src/gestures.ts` and `src/offscreen.ts` whenever a gesture is added or changed.

## Quick reference

| Gesture | Hand shape | Action |
|---|---|---|
| Point | Index extended, others curled | Cursor follows fingertip |
| Pinch | Thumb tip touches index tip (while pointing) | Click |
| Peace | Index + middle extended, ring + pinky curled | Scroll |
| Open palm + horizontal swipe | 3+ fingers extended, sweep left or right | Back / forward navigation |

## Single-hand mode

The extension uses one hand by default. The same hand positions the cursor *and* pinches to click.

### Point — move the cursor

- **Shape**: only the index finger extended; middle, ring, and pinky curled.
- **Effect**: a small cyan circle follows your index fingertip.
- The cursor only appears in this shape.

### Pinch — click

- **Shape**: while pointing, bring thumb tip and index tip together.
- **Effect**: a click is dispatched at the cursor position.
- Click only fires while in pointing mode (so peace + pinch won't accidentally click).
- Tunable in the popup via **pinch sensitivity** — lower = strict pinch, higher = looser.

### Peace — scroll

- **Shape**: index + middle extended, ring + pinky curled.
- **Effect**: scroll the page.
- Position-based: when you enter peace, that hand-y becomes the *anchor*.
  - Hand below anchor → scroll down (continuously while held).
  - Hand above anchor → scroll up.
  - Hand at anchor → no scroll.
- 5% deadzone around the anchor prevents micro-jitter from drifting.
- Acceleration is squared — small offsets nudge gently, larger offsets blast.
- Tunable via **scroll speed** in the popup.

### Open palm + swipe — back / forward

- **Shape**: 3 or more fingers extended (open hand).
- **Trigger**: sweep horizontally across ~12% of camera FOV within 500ms.
  - Swipe left → browser **back**.
  - Swipe right → browser **forward**.
- 700ms debounce — one swipe = one navigation.

## Two-hand mode

If both hands are visible, the work splits:

- **Cursor hand** (default = right) — positions the cursor and runs all gesture detection (point / peace / open-palm).
- **Click hand** — only fires the pinch click. Pointing hand stays still while the other hand clicks.

Switch which hand is the cursor in the popup → **cursor hand** toggle.

## Mode display

The popup's debug pane logs every mode transition (`mode → pointing` / `scroll` / `palm` / `idle`). Useful when tuning the recognizer or debugging a gesture that won't engage.

## Tuning knobs (popup sliders)

| Setting | Range | Default | Effect |
|---|---|---|---|
| pinch sensitivity | 0–1 | 0.50 | Higher = pinch fires with less finger contact |
| motion smoothing | 0–1 | 0.25 | Higher = smoother cursor, more lag |
| scroll speed | 0–1 | 0.40 | Higher = faster scroll for the same hand offset |
| swipe sensitivity | 0–1 | 0.50 | Higher = back/forward swipe fires with less hand travel and a longer detection window |
| cursor hand | left / right | right | Which hand drives the cursor in two-hand mode |

## Notes for onboarding

When we build the first-run flow, the order to introduce gestures (most → least essential):

1. Point + pinch (cursor + click).
2. Two-hand mode (mention only if a second hand is detected during onboarding).
3. Peace + scroll.
4. Open palm + swipe for back/forward.

Keep wording short. Every gesture should be teachable in one sentence and demonstrable in five seconds.
