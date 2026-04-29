import type { PlasmoCSConfig } from "plasmo";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  all_frames: false,
  run_at: "document_idle"
};

const CURSOR_ID = "__hand-tracker-cursor__";
const CANVAS_ID = "__hand-tracker-skeleton__";

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

type Landmark = { x: number; y: number; z?: number };

let cursor: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let enabled = false;
let skeletonVisible = false;
let lastX: number | null = null;
let lastY: number | null = null;

function promoteToTopLayer(el: HTMLElement) {
  try {
    if ("popover" in HTMLElement.prototype) {
      el.setAttribute("popover", "manual");
      // Avoid the default popover positioning/sizing.
      Object.assign(el.style, {
        inset: "unset",
        margin: "0",
        padding: "0"
      } as CSSStyleDeclaration);
      // showPopover() must be called after the element is connected to the DOM.
      requestAnimationFrame(() => {
        try {
          (el as HTMLElement & { showPopover(): void }).showPopover();
        } catch {
          // Already-shown or unsupported state — fall back to z-index alone.
        }
      });
    }
  } catch {
    // Old browsers — z-index alone will cover most cases.
  }
}

function ensureCursor(): HTMLDivElement {
  if (cursor && document.documentElement.contains(cursor)) return cursor;
  cursor = document.createElement("div");
  cursor.id = CURSOR_ID;
  Object.assign(cursor.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    border: "2px solid #7cf",
    background: "rgba(124, 204, 255, 0.18)",
    pointerEvents: "none",
    zIndex: "2147483647",
    transition: "background-color 60ms, border-color 60ms",
    // Center the cursor on (left, top) via translate(-50%, -50%).
    transform: "translate(-50%, -50%)",
    visibility: "hidden"
  } as CSSStyleDeclaration);
  document.documentElement.appendChild(cursor);
  promoteToTopLayer(cursor);
  return cursor;
}

function ensureCanvas(): HTMLCanvasElement {
  if (canvas && document.documentElement.contains(canvas)) return canvas;
  canvas = document.createElement("canvas");
  canvas.id = CANVAS_ID;
  Object.assign(canvas.style, {
    position: "fixed",
    left: "0",
    top: "0",
    pointerEvents: "none",
    zIndex: "2147483646",
    background: "transparent",
    border: "none",
    overflow: "visible",
    visibility: "hidden"
  } as CSSStyleDeclaration);
  resizeCanvas();
  document.documentElement.appendChild(canvas);
  promoteToTopLayer(canvas);
  return canvas;
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
}

window.addEventListener("resize", resizeCanvas);

function drawSkeleton(hands: Landmark[][] | null) {
  const c = ensureCanvas();
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, c.width, c.height);
  if (!hands || hands.length === 0) return;

  const w = window.innerWidth * dpr;
  const h = window.innerHeight * dpr;

  for (const landmarks of hands) {
    if (!landmarks || landmarks.length === 0) continue;
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(124, 204, 255, 0.85)";
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb) continue;
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
    }
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function showCursor(visible: boolean) {
  const c = ensureCursor();
  c.style.visibility = visible ? "visible" : "hidden";
}

function moveCursor(x: number, y: number, pinched: boolean) {
  const c = ensureCursor();
  c.style.left = `${x}px`;
  c.style.top = `${y}px`;
  // translate(-50%, -50%) keeps the cursor's center exactly on (x, y).
  c.style.transform = pinched
    ? "translate(-50%, -50%) scale(0.7)"
    : "translate(-50%, -50%)";
}

function setPinchedStyle(pinched: boolean) {
  const c = ensureCursor();
  if (pinched) {
    c.style.background = "rgba(124, 204, 255, 0.55)";
    c.style.borderColor = "#fff";
  } else {
    c.style.background = "rgba(124, 204, 255, 0.18)";
    c.style.borderColor = "#7cf";
  }
}

function dispatchClickAt(x: number, y: number) {
  // Hide our overlays so elementFromPoint sees the real page underneath.
  const cursorEl = ensureCursor();
  const cursorPrev = cursorEl.style.visibility;
  cursorEl.style.visibility = "hidden";
  const canvasPrev = canvas?.style.visibility;
  if (canvas) canvas.style.visibility = "hidden";

  const target = document.elementFromPoint(x, y) as HTMLElement | null;

  cursorEl.style.visibility = cursorPrev;
  if (canvas && canvasPrev !== undefined) canvas.style.visibility = canvasPrev;

  if (!target) return;

  // Composed lets the event cross shadow-DOM boundaries (used by lots of
  // modern web components, including some video player chrome).
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
    buttons: 1
  };
  const pointerInit: PointerEventInit = {
    ...mouseInit,
    pointerType: "mouse",
    pointerId: 1,
    isPrimary: true,
    width: 1,
    height: 1,
    pressure: 0.5
  };
  const upMouseInit: MouseEventInit = { ...mouseInit, buttons: 0 };
  const upPointerInit: PointerEventInit = { ...pointerInit, buttons: 0, pressure: 0 };

  // Pre-hover events: some UI only attaches click handlers after a hover.
  target.dispatchEvent(new PointerEvent("pointerover", pointerInit));
  target.dispatchEvent(new MouseEvent("mouseover", mouseInit));
  target.dispatchEvent(new PointerEvent("pointerenter", pointerInit));
  target.dispatchEvent(new MouseEvent("mouseenter", mouseInit));
  target.dispatchEvent(new PointerEvent("pointermove", pointerInit));
  target.dispatchEvent(new MouseEvent("mousemove", mouseInit));

  // The actual press / release / click.
  target.dispatchEvent(new PointerEvent("pointerdown", pointerInit));
  target.dispatchEvent(new MouseEvent("mousedown", mouseInit));
  target.dispatchEvent(new PointerEvent("pointerup", upPointerInit));
  target.dispatchEvent(new MouseEvent("mouseup", upMouseInit));
  target.dispatchEvent(new MouseEvent("click", upMouseInit));

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    target.focus();
  } else if (target instanceof HTMLElement && target.isContentEditable) {
    target.focus();
  }
}

function enable() {
  if (enabled) return;
  enabled = true;
  ensureCursor();
  ensureCanvas();
  showCursor(true);
  if (skeletonVisible && canvas) canvas.style.visibility = "visible";
}

function disable() {
  enabled = false;
  if (cursor) cursor.style.visibility = "hidden";
  if (canvas) {
    canvas.style.visibility = "hidden";
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  lastX = null;
  lastY = null;
}

function setSkeletonVisible(visible: boolean) {
  skeletonVisible = visible;
  if (!enabled) return;
  ensureCanvas();
  if (canvas) canvas.style.visibility = visible ? "visible" : "hidden";
  if (!visible) drawSkeleton(null);
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "tracker:enable") {
    enable();
    chrome.runtime.sendMessage({ type: "content:alive", url: location.href }).catch(() => {});
    return false;
  }

  if (message.type === "tracker:disable") {
    disable();
    return false;
  }

  if (message.type === "tracker:debugSkeleton") {
    setSkeletonVisible(!!message.show);
    return false;
  }

  if (!enabled) return false;

  if (message.type === "cursor") {
    if (message.x == null || message.y == null) {
      showCursor(false);
      lastX = null;
      lastY = null;
      if (skeletonVisible) drawSkeleton(null);
      return false;
    }
    const px = message.x * window.innerWidth;
    const py = message.y * window.innerHeight;
    lastX = px;
    lastY = py;
    const pinched = !!message.pinched;
    const cursorVisible = message.cursorVisible !== false;
    moveCursor(px, py, pinched);
    setPinchedStyle(pinched);
    showCursor(cursorVisible);
    if (skeletonVisible) drawSkeleton(message.hands ?? null);
    return false;
  }

  if (message.type === "scroll") {
    window.scrollBy({ top: message.dy ?? 0, behavior: "auto" });
    return false;
  }

  if (message.type === "navigate") {
    if (message.direction === "back") history.back();
    else if (message.direction === "forward") history.forward();
    return false;
  }

  if (message.type === "pinch") {
    const px = (message.x ?? 0) * window.innerWidth;
    const py = (message.y ?? 0) * window.innerHeight;
    dispatchClickAt(lastX ?? px, lastY ?? py);
    return false;
  }

  return false;
});

// Tell the background we're alive in this tab on load.
chrome.runtime.sendMessage({ type: "content:alive", url: location.href }).catch(() => {});
chrome.runtime.sendMessage({ type: "popup:getState" }, (resp) => {
  if (resp?.enabled) enable();
  if (resp?.debugSkeleton) setSkeletonVisible(true);
});
