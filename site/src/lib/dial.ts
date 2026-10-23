/** 0° = down (+y), 90° = right (+x), clockwise; any angle (wraps). */
export function dialVector(angleDeg: number): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}
