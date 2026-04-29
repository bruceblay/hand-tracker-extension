export type Point = { x: number; y: number; z?: number };

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class OnePole {
  y: number;
  coeff: number;
  constructor(coeff = 0.25, init = 0) {
    this.y = init;
    this.coeff = coeff;
  }
  process(x: number): number {
    return (this.y = this.y + this.coeff * (x - this.y));
  }
  reset(value: number): void {
    this.y = value;
  }
}

export function mirrorX(landmarks: Point[]): Point[] {
  return landmarks.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}
