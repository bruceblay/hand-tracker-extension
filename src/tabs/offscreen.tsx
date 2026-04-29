import { useEffect } from "react";

export default function Offscreen() {
  useEffect(() => {
    import("../offscreen");
  }, []);

  return (
    <>
      <style>{`
        html, body { margin: 0; background: #000; color: #ccc; font-family: system-ui, sans-serif; }
        #status { position: fixed; left: 8px; top: 8px; font-size: 12px; opacity: 0.7; }
        #video { display: none; }
      `}</style>
      <div id="status">hand-tracker offscreen</div>
      <video id="video" autoPlay playsInline muted />
    </>
  );
}
