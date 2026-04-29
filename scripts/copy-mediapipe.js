#!/usr/bin/env node
// Copies @mediapipe/tasks-vision/wasm files into the Plasmo build dirs so the
// extension can load them locally. The default extension CSP (script-src 'self')
// blocks MediaPipe's CDN script-tag injection, so we host the WASM JS loader
// from the extension origin instead.

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");

const targets = [
  path.join(root, "build/chrome-mv3-dev/mediapipe"),
  path.join(root, "build/chrome-mv3-prod/mediapipe")
];

if (!fs.existsSync(src)) {
  console.error("[copy-mediapipe] source not found:", src);
  process.exit(1);
}

const files = fs.readdirSync(src);

let copied = 0;
for (const target of targets) {
  const buildDir = path.dirname(target);
  if (!fs.existsSync(buildDir)) continue;
  fs.mkdirSync(target, { recursive: true });
  for (const file of files) {
    fs.copyFileSync(path.join(src, file), path.join(target, file));
  }
  console.log(`[copy-mediapipe] copied ${files.length} files to ${path.relative(root, target)}`);
  copied++;
}

if (copied === 0) {
  console.warn("[copy-mediapipe] no build dirs exist yet — run plasmo build first");
  process.exit(1);
}
