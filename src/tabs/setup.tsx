import { useState } from "react";

const CAMERA_GRANTED_KEY = "handTrackerCameraGranted";

export default function Setup() {
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);

  const grant = async () => {
    setStatus("requesting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });
      stream.getTracks().forEach((t) => t.stop());
      await chrome.storage.local.set({ [CAMERA_GRANTED_KEY]: true });
      setStatus("granted");
    } catch (err) {
      setStatus("failed");
      setError((err as Error).message);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#eaeaea",
        fontFamily: "system-ui, sans-serif",
        padding: 24
      }}>
      <style>{`html, body { margin: 0; padding: 0; background: #0a0a0a; }`}</style>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>👌</div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Allow camera access</h1>
        <p style={{ fontSize: 13, color: "#999", lineHeight: 1.5, margin: "0 0 20px" }}>
          Hand Tracker needs your webcam so it can map your fingertip to a cursor on the page.
          Nothing leaves your device. The popup can't show this prompt itself, so we have to
          do the first grant from a regular tab.
        </p>
        <button
          onClick={grant}
          disabled={status === "requesting" || status === "granted"}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            borderRadius: 8,
            border: "1px solid #2a4a5a",
            background: status === "granted" ? "#1a3a4a" : "#1a2a3a",
            color: "#eaeaea",
            cursor: status === "requesting" ? "wait" : "pointer"
          }}>
          {status === "granted"
            ? "Granted ✓"
            : status === "requesting"
              ? "Waiting for prompt…"
              : "Allow camera"}
        </button>
        {status === "granted" && (
          <div style={{ marginTop: 16, fontSize: 13, color: "#9bd6ff", lineHeight: 1.5 }}>
            All set. Switch back to the page where you want to use the cursor, then click
            the Hand Tracker icon → enable.
          </div>
        )}
        {error && (
          <div style={{ marginTop: 16, color: "#ff7b7b", fontSize: 12 }}>
            {error}
            <div style={{ color: "#888", marginTop: 6 }}>
              If this keeps failing, open <code>chrome://extensions</code>, click{" "}
              <strong>Details</strong> on Hand Tracker, scroll to <strong>Site access</strong>{" "}
              and ensure camera is allowed.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
