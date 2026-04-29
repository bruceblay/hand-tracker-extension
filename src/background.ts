/**
 * Background service worker.
 *
 * Owns the global on/off state and the offscreen document. Forwards cursor
 * and pinch events from the offscreen tracker to the content script in the
 * currently-active tab.
 */

const STORAGE_KEY = "handTrackerEnabled";
const SKELETON_KEY = "handTrackerDebugSkeleton";
const SETTINGS_KEY = "handTrackerSettings";

export type Settings = {
  pinch: number;       // 0..1, higher = looser (fires more easily)
  smoothing: number;   // 0..1, higher = smoother but laggier
  scrollSpeed: number; // 0..1, higher = faster scroll for the same hand offset
  swipeSensitivity: number; // 0..1, higher = swipe fires with less hand travel
  cursorHand: "Left" | "Right"; // which hand drives the cursor when both are visible
};

const DEFAULT_SETTINGS: Settings = {
  pinch: 0.5,
  smoothing: 0.25,
  scrollSpeed: 0.4,
  swipeSensitivity: 0.5,
  cursorHand: "Right"
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let enabled = false;
let debugSkeleton = false;
let activeTabId: number | null = null;
let contentScriptAlive = false;

let cursorRx = 0;
let cursorTx = 0;
let cursorTxFails = 0;
let trackerStats: {
  frames: number;
  handFrames: number;
  videoReady: boolean;
  videoSize: { w: number; h: number };
} | null = null;

type LogLevel = "info" | "warn" | "error";
type LogEntry = { t: number; level: LogLevel; msg: string };

const LOG_MAX = 50;
const logs: LogEntry[] = [];

function log(level: LogLevel, msg: string) {
  const entry: LogEntry = { t: Date.now(), level, msg };
  logs.push(entry);
  if (logs.length > LOG_MAX) logs.shift();
  const tag = "[hand-tracker]";
  if (level === "error") console.error(tag, msg);
  else if (level === "warn") console.warn(tag, msg);
  else console.log(tag, msg);
}

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("tabs/offscreen.html")]
  });
  if (existing.length > 0) {
    log("info", "offscreen doc already exists");
    return;
  }
  log("info", "creating offscreen doc…");
  await chrome.offscreen.createDocument({
    url: "tabs/offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Run webcam + MediaPipe HandLandmarker for the hand-tracker extension"
  });
  log("info", "offscreen doc created");
}

async function closeOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL("tabs/offscreen.html")]
  });
  if (existing.length === 0) return;
  await chrome.offscreen.closeDocument();
  log("info", "offscreen doc closed");
}

function isTrackable(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\//.test(url) || url.startsWith("file://");
}

async function getTrackableTab(): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id != null && isTrackable(active.url)) return active;
  const candidates = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*", "file:///*"]
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return candidates[0] ?? null;
}

async function injectContentScript(tabId: number): Promise<boolean> {
  const manifest = chrome.runtime.getManifest();
  const files = manifest.content_scripts?.[0]?.js;
  if (!files || files.length === 0) {
    log("error", "no content_scripts.js in manifest — content script not built");
    return false;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
    log("info", `injected content script into tab ${tabId}`);
    return true;
  } catch (err) {
    log("warn", `inject failed: ${(err as Error).message}`);
    return false;
  }
}

async function sendToActiveTab(message: unknown): Promise<boolean> {
  const tabId = activeTabId;
  if (tabId == null) return false;
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (err) {
    return false;
  }
}

async function forwardCursorToTab(message: unknown) {
  cursorRx++;
  const ok = await sendToActiveTab(message);
  if (ok) cursorTx++;
  else cursorTxFails++;
}

async function setEnabled(next: boolean) {
  if (enabled === next) return;

  if (next) {
    log("info", "enable requested");
    const tab = await getTrackableTab();
    if (!tab?.id) {
      log("error", "no http(s) tab found — open a normal web page first");
      return;
    }
    activeTabId = tab.id;
    log("info", `target tab ${tab.id}: ${tab.url ?? "(unknown url)"}`);

    try {
      await ensureOffscreenDocument();
    } catch (err) {
      log("error", `offscreen create failed: ${(err as Error).message}`);
      return;
    }

    const injected = await injectContentScript(tab.id);
    if (!injected) {
      log("error", "could not inject cursor into the page");
      await closeOffscreenDocument();
      return;
    }

    contentScriptAlive = false;
    broadcastSettings();
    const sent = await sendToActiveTab({ type: "tracker:enable" });
    if (!sent) {
      log("error", "content script didn't respond to enable message");
    }
    if (debugSkeleton) {
      await sendToActiveTab({ type: "tracker:debugSkeleton", show: true });
      chrome.runtime
        .sendMessage({ type: "tracker:debugSkeleton", show: true })
        .catch(() => {});
    }

    enabled = true;
    await chrome.storage.local.set({ [STORAGE_KEY]: true });
    log("info", "enabled ✓");
  } else {
    log("info", "disable requested");
    await sendToActiveTab({ type: "tracker:disable" });
    await closeOffscreenDocument();
    activeTabId = null;
    enabled = false;
    await chrome.storage.local.set({ [STORAGE_KEY]: false });
    log("info", "disabled");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get([STORAGE_KEY, SKELETON_KEY]);
  enabled = !!stored[STORAGE_KEY];
  debugSkeleton = !!stored[SKELETON_KEY];
});

chrome.storage.local.get([SKELETON_KEY, SETTINGS_KEY]).then((stored) => {
  debugSkeleton = !!stored[SKELETON_KEY];
  if (stored[SETTINGS_KEY]) settings = { ...DEFAULT_SETTINGS, ...stored[SETTINGS_KEY] };
});

function broadcastSettings() {
  chrome.runtime.sendMessage({ type: "tracker:settings", settings }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (sender.url?.includes("tabs/offscreen.html")) {
    if (message.type === "tracker:stats") {
      trackerStats = {
        frames: message.frames,
        handFrames: message.handFrames,
        videoReady: message.videoReady,
        videoSize: message.videoSize
      };
      return false;
    }
    if (message.type === "tracker:status") {
      if (message.error) {
        log("error", `offscreen error: ${message.error}`);
      } else if (message.running) {
        log("info", "offscreen: camera + tracker running");
      } else {
        log("warn", `offscreen reported stopped (phase=${message.phase ?? "?"})`);
      }
    }
    if (
      message.type === "cursor" ||
      message.type === "pinch" ||
      message.type === "scroll" ||
      message.type === "navigate"
    ) {
      forwardCursorToTab(message);
    }
    if (message.type === "tracker:mode") {
      log("info", `mode → ${message.mode}`);
    }
    return false;
  }

  if (message.type === "content:alive") {
    contentScriptAlive = true;
    log("info", `content script alive in tab (${message.url ?? "?"})`);
    return false;
  }

  if (message.type === "popup:getState") {
    sendResponse({
      enabled,
      debugSkeleton,
      contentScriptAlive,
      logs,
      cursorRx,
      cursorTx,
      cursorTxFails,
      trackerStats,
      settings
    });
    return true;
  }

  if (message.type === "popup:setSettings") {
    settings = { ...settings, ...message.settings };
    chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    broadcastSettings();
    sendResponse({ settings });
    return true;
  }

  if (message.type === "popup:toggle") {
    setEnabled(!enabled).then(() =>
      sendResponse({ enabled, debugSkeleton, contentScriptAlive, logs })
    );
    return true;
  }

  if (message.type === "popup:setDebugSkeleton") {
    debugSkeleton = !!message.show;
    chrome.storage.local.set({ [SKELETON_KEY]: debugSkeleton });
    chrome.runtime
      .sendMessage({ type: "tracker:debugSkeleton", show: debugSkeleton })
      .catch(() => {});
    sendToActiveTab({ type: "tracker:debugSkeleton", show: debugSkeleton });
    log("info", `skeleton overlay ${debugSkeleton ? "on" : "off"}`);
    sendResponse({ enabled, debugSkeleton, contentScriptAlive, logs });
    return true;
  }

  if (message.type === "popup:clearLogs") {
    logs.length = 0;
    cursorRx = cursorTx = cursorTxFails = 0;
    sendResponse({ enabled, debugSkeleton, contentScriptAlive, logs });
    return true;
  }

  if (message.type === "popup:logError") {
    log("error", String(message.msg ?? "unknown error from popup"));
    sendResponse({ enabled, debugSkeleton, contentScriptAlive, logs });
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-hand-control") {
    setEnabled(!enabled);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!enabled) return;
  if (activeTabId != null && activeTabId !== tabId) {
    try {
      await chrome.tabs.sendMessage(activeTabId, { type: "tracker:disable" });
    } catch {
      // Old tab may be gone.
    }
  }
  activeTabId = tabId;
  await injectContentScript(tabId);
  await sendToActiveTab({ type: "tracker:enable" });
});

export default {};
