import { distance, type Point } from "./mappings";

// Returns the cosine of the angle between vectors (b-a) and (c-b). When the
// joint at b is "straight" (a, b, c collinear in the same direction) this is
// ~1; when the joint folds back the value goes toward -1.
function jointStraightness(a: Point, b: Point, c: Point): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const bcx = c.x - b.x, bcy = c.y - b.y;
  const lenAb = Math.sqrt(abx * abx + aby * aby) || 1e-6;
  const lenBc = Math.sqrt(bcx * bcx + bcy * bcy) || 1e-6;
  return (abx * bcx + aby * bcy) / (lenAb * lenBc);
}

export type FingerStates = {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
};

const STRAIGHT_THRESHOLD = 0.6;

export function fingerStates(landmarks: Point[]): FingerStates {
  // Each finger: MCP -> PIP -> TIP. Straight if the PIP joint is mostly
  // unflexed.
  return {
    index: jointStraightness(landmarks[5], landmarks[6], landmarks[8]) > STRAIGHT_THRESHOLD,
    middle: jointStraightness(landmarks[9], landmarks[10], landmarks[12]) > STRAIGHT_THRESHOLD,
    ring: jointStraightness(landmarks[13], landmarks[14], landmarks[16]) > STRAIGHT_THRESHOLD,
    pinky: jointStraightness(landmarks[17], landmarks[18], landmarks[20]) > STRAIGHT_THRESHOLD
  };
}

export type Mode = "idle" | "pointing" | "scroll" | "palm";

// Average of wrist (0) and the four MCP joints (5, 9, 13, 17). Much more
// stable than the wrist alone — a single landmark jitters easily, the
// centroid averages it out.
export function palmCenter(landmarks: Point[]): Point {
  const idxs = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of idxs) {
    x += landmarks[i].x;
    y += landmarks[i].y;
  }
  return { x: x / idxs.length, y: y / idxs.length };
}

export type SwipeParams = {
  windowMs: number;          // how far back we look
  minFrames: number;         // minimum frame count to evaluate
  dxThreshold: number;       // total horizontal displacement needed (normalized)
  velocityThreshold: number; // peak |dx|/sec in normalized units
  diagonalRatio: number;     // |dx| must be > ratio * |dy|
  monotonicFraction: number; // share of inter-frame steps moving the dominant direction
  cooldownMs: number;
};

export type SwipeResult = "left" | "right" | null;

export class SwipeDetector {
  private history: { t: number; x: number; y: number }[] = [];
  private cooldownUntil = 0;
  params: SwipeParams;

  constructor(params: SwipeParams) {
    this.params = params;
  }

  reset() {
    this.history = [];
  }

  push(center: Point, now: number) {
    this.history.push({ t: now, x: center.x, y: center.y });
    while (this.history.length && now - this.history[0].t > this.params.windowMs) {
      this.history.shift();
    }
  }

  detect(now: number): SwipeResult {
    if (now < this.cooldownUntil) return null;
    if (this.history.length < this.params.minFrames) return null;

    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const dx = last.x - first.x;
    const dy = last.y - first.y;

    // Diagonal rejection: horizontal motion must dominate vertical.
    if (Math.abs(dx) < this.params.diagonalRatio * Math.abs(dy)) return null;

    // Total displacement must clear the threshold.
    if (Math.abs(dx) < this.params.dxThreshold) return null;

    // Peak inter-frame velocity must clear the threshold (in units/sec).
    let peakVel = 0;
    let monotonic = 0;
    let totalSteps = 0;
    const sign = Math.sign(dx);
    for (let i = 1; i < this.history.length; i++) {
      const a = this.history[i - 1];
      const b = this.history[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const v = Math.abs(b.x - a.x) / dt;
      if (v > peakVel) peakVel = v;
      totalSteps++;
      if (Math.sign(b.x - a.x) === sign) monotonic++;
    }
    if (peakVel < this.params.velocityThreshold) return null;

    // Most frames must move in the dominant direction (rejects flutter).
    if (totalSteps === 0 || monotonic / totalSteps < this.params.monotonicFraction) {
      return null;
    }

    this.cooldownUntil = now + this.params.cooldownMs;
    this.history = [];
    return dx > 0 ? "right" : "left";
  }
}

export function detectMode(landmarks: Point[]): Mode {
  const f = fingerStates(landmarks);
  const extendedCount = +f.index + +f.middle + +f.ring + +f.pinky;
  // Open palm: at least 3 of the 4 fingers extended (thumb ignored).
  if (extendedCount >= 3) return "palm";
  // Peace / scroll: index + middle extended, ring + pinky NOT extended.
  if (f.index && f.middle && !f.ring && !f.pinky) return "scroll";
  // Pointing: index extended, middle/ring/pinky NOT extended.
  if (f.index && !f.middle && !f.ring && !f.pinky) return "pointing";
  return "idle";
}

type PinchResult = {
  state: "idle" | "open" | "closed";
  ratio: number | null;
  justClosed: boolean;
  justOpened: boolean;
};

export class PinchDetector {
  private closed = false;
  private armed = false;
  private lastClosedAt = -Infinity;
  closeThreshold: number;
  openThreshold: number;
  minInterval: number;

  constructor({
    closeThreshold = 0.45,
    openThreshold = 0.7,
    minInterval = 0
  }: { closeThreshold?: number; openThreshold?: number; minInterval?: number } = {}) {
    this.closeThreshold = closeThreshold;
    this.openThreshold = openThreshold;
    this.minInterval = minInterval;
  }

  update(landmarks: Point[] | null | undefined): PinchResult {
    if (!landmarks) {
      const justOpened = this.closed;
      this.closed = false;
      this.armed = false;
      return { state: "idle", ratio: null, justClosed: false, justOpened };
    }
    const palm = distance(landmarks[0], landmarks[9]) || 1e-6;
    const pinch = distance(landmarks[4], landmarks[8]);
    const ratio = pinch / palm;

    let justClosed = false;
    let justOpened = false;

    if (!this.armed) {
      if (ratio > this.openThreshold) this.armed = true;
      return { state: this.closed ? "closed" : "open", ratio, justClosed, justOpened };
    }

    if (!this.closed && ratio < this.closeThreshold) {
      this.closed = true;
      const now = performance.now();
      if (now - this.lastClosedAt > this.minInterval) {
        justClosed = true;
        this.lastClosedAt = now;
      }
    } else if (this.closed && ratio > this.openThreshold) {
      this.closed = false;
      justOpened = true;
    }
    return { state: this.closed ? "closed" : "open", ratio, justClosed, justOpened };
  }
}
