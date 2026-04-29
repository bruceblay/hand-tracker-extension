import { useEffect, useState } from "react";

const globalCss = `
  html, body { margin: 0; padding: 0; background: #0a0a0a; }
`;

const CAMERA_GRANTED_KEY = "handTrackerCameraGranted";

type LogLevel = "info" | "warn" | "error";
type LogEntry = { t: number; level: LogLevel; msg: string };
type TrackerStats = {
  frames: number;
  handFrames: number;
  videoReady: boolean;
  videoSize: { w: number; h: number };
};

type Settings = {
  pinch: number;
  smoothing: number;
  scrollSpeed: number;
  swipeSensitivity: number;
  cursorHand: "Left" | "Right";
};

type State = {
  enabled?: boolean;
  debugSkeleton?: boolean;
  contentScriptAlive?: boolean;
  logs?: LogEntry[];
  cursorRx?: number;
  cursorTx?: number;
  cursorTxFails?: number;
  trackerStats?: TrackerStats | null;
  settings?: Settings;
};

const DEFAULT_SETTINGS: Settings = {
  pinch: 0.5,
  smoothing: 0.25,
  scrollSpeed: 0.4,
  swipeSensitivity: 0.5,
  cursorHand: "Right"
};

function fmtTime(t: number) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

function levelColor(level: LogLevel) {
  if (level === "error") return "#ff7b7b";
  if (level === "warn") return "#ffd07b";
  return "#9bd6ff";
}

function Popup() {
  const [s, setS] = useState<State>({});
  const [loading, setLoading] = useState<boolean>(true);

  function apply(resp: State | undefined) {
    setS(resp ?? {});
    setLoading(false);
  }

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "popup:getState" }, apply);
    const id = setInterval(() => {
      chrome.runtime.sendMessage({ type: "popup:getState" }, apply);
    }, 300);
    return () => clearInterval(id);
  }, []);

  const toggle = async () => {
    setLoading(true);
    if (!s.enabled) {
      const stored = await chrome.storage.local.get(CAMERA_GRANTED_KEY);
      if (!stored[CAMERA_GRANTED_KEY]) {
        const url = chrome.runtime.getURL("tabs/setup.html");
        await chrome.tabs.create({ url });
        window.close();
        return;
      }
    }
    chrome.runtime.sendMessage({ type: "popup:toggle" }, apply);
  };

  const toggleSkeleton = () => {
    chrome.runtime.sendMessage(
      { type: "popup:setDebugSkeleton", show: !s.debugSkeleton },
      apply
    );
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const nextSettings = { ...(s.settings ?? DEFAULT_SETTINGS), [key]: value };
    setS((prev) => ({ ...prev, settings: nextSettings }));
    chrome.runtime.sendMessage({
      type: "popup:setSettings",
      settings: { [key]: value }
    });
  };

  const clearLogs = () => {
    chrome.runtime.sendMessage({ type: "popup:clearLogs" }, apply);
  };

  const enabled = !!s.enabled;
  const logs = s.logs ?? [];
  const settings = s.settings ?? DEFAULT_SETTINGS;

  const renderSlider = (
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string
  ) => (
    <label style={{ display: "block", fontSize: 11, color: "#bbb" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ color: "#7cf", fontFamily: "ui-monospace, Menlo, monospace" }}>
          {fmt(settings[key])}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key]}
        onChange={(e) => updateSetting(key, parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#7cf" }}
      />
    </label>
  );

  return (
    <div
      style={{
        width: 360,
        padding: 16,
        fontFamily: "system-ui, sans-serif",
        background: "#0a0a0a",
        color: "#eaeaea"
      }}>
      <style>{globalCss}</style>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>hand tracker</div>
      <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>
        pinch (thumb + index) to click on the active tab.
      </div>

      <button
        onClick={toggle}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 13,
          borderRadius: 8,
          border: "1px solid #333",
          background: enabled ? "#1a3a4a" : "#151515",
          color: "#eaeaea",
          cursor: loading ? "default" : "pointer"
        }}>
        {loading ? "…" : enabled ? "disable" : "enable"}
      </button>

      <label
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "#bbb",
          cursor: "pointer",
          userSelect: "none"
        }}>
        <input
          type="checkbox"
          checked={!!s.debugSkeleton}
          onChange={toggleSkeleton}
          style={{ accentColor: "#7cf" }}
        />
        show hand skeleton
      </label>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {renderSlider("pinch", "pinch sensitivity", 0, 1, 0.01, (v) => v.toFixed(2))}
        {renderSlider("smoothing", "motion smoothing", 0, 1, 0.01, (v) => v.toFixed(2))}
        {renderSlider("scrollSpeed", "scroll speed", 0, 1, 0.01, (v) => v.toFixed(2))}
        {renderSlider("swipeSensitivity", "swipe sensitivity", 0, 1, 0.01, (v) => v.toFixed(2))}

        <div>
          <div
            style={{
              fontSize: 11,
              color: "#bbb",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between"
            }}>
            <span>cursor hand</span>
            <span style={{ color: "#666", fontSize: 10 }}>
              other hand pinches to click
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              border: "1px solid #2a2a2a",
              borderRadius: 6,
              overflow: "hidden"
            }}>
            {(["Left", "Right"] as const).map((h) => {
              const active = settings.cursorHand === h;
              return (
                <button
                  key={h}
                  onClick={() => updateSetting("cursorHand", h)}
                  style={{
                    padding: "6px 0",
                    fontSize: 12,
                    border: "none",
                    background: active ? "#1a3a4a" : "#0f0f0f",
                    color: active ? "#eaeaea" : "#888",
                    cursor: "pointer"
                  }}>
                  {h.toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
        <span
          style={{
            fontSize: 11,
            color: "#888",
            textTransform: "uppercase",
            letterSpacing: 0.5
          }}>
          debug
        </span>
        <button
          onClick={clearLogs}
          style={{
            fontSize: 11,
            background: "transparent",
            color: "#888",
            border: "1px solid #2a2a2a",
            borderRadius: 4,
            padding: "2px 8px",
            cursor: "pointer"
          }}>
          clear
        </button>
      </div>

      <div
        style={{
          marginTop: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          color: "#888"
        }}>
        <div>
          content:{" "}
          <span style={{ color: s.contentScriptAlive ? "#7cf" : "#ff7b7b" }}>
            {s.contentScriptAlive ? "alive" : "no ping"}
          </span>
          {"   "}cursor rx={s.cursorRx ?? 0} tx={s.cursorTx ?? 0}
          {(s.cursorTxFails ?? 0) > 0 && (
            <span style={{ color: "#ff7b7b" }}> fails={s.cursorTxFails}</span>
          )}
        </div>
        <div>
          tracker:{" "}
          {s.trackerStats ? (
            <>
              frames={s.trackerStats.frames} hand={s.trackerStats.handFrames} video=
              {s.trackerStats.videoReady ? "ok" : "wait"} {s.trackerStats.videoSize.w}×
              {s.trackerStats.videoSize.h}
            </>
          ) : (
            <span style={{ color: "#ff7b7b" }}>no heartbeat</span>
          )}
        </div>
      </div>

      <div
        style={{
          marginTop: 6,
          background: "#0f0f0f",
          border: "1px solid #1f1f1f",
          borderRadius: 6,
          padding: 8,
          height: 180,
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 11,
          lineHeight: 1.4
        }}>
        {logs.length === 0 ? (
          <div style={{ color: "#555" }}>no events yet — click enable</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, color: "#bbb" }}>
              <span style={{ color: "#555", flexShrink: 0 }}>{fmtTime(l.t)}</span>
              <span style={{ color: levelColor(l.level), flexShrink: 0, width: 36 }}>
                {l.level}
              </span>
              <span style={{ wordBreak: "break-word" }}>{l.msg}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ fontSize: 11, color: "#666", marginTop: 10 }}>
        shortcut: Cmd/Ctrl + Shift + H
      </div>
    </div>
  );
}

export default Popup;
