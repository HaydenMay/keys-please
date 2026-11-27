import * as THREE from 'three';
import type { Point } from '../sim/graph';

/** Flat ribbon along a polyline, lying on the ground. WebGL lines are always 1px, so paths use this. */
export function ribbonGeometry(points: Point[], width: number, y = 0.06): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  if (points.length < 2) {
    geo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    return geo;
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const hw = width / 2;
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const p = points[i];
    pos.push(p.x - dz * hw, y, p.z + dx * hw, p.x + dz * hw, y, p.z - dx * hw);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  return geo;
}

/** Rounded corners for snapped lane routes so they read as driving lines, not graph edges. */
export function smoothCorners(points: Point[], radius: number, steps = 5): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const d2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r < 1e-3) { out.push(p1); continue; }
    const a = { x: p1.x + ((p0.x - p1.x) / d1) * r, z: p1.z + ((p0.z - p1.z) / d1) * r };
    const b = { x: p1.x + ((p2.x - p1.x) / d2) * r, z: p1.z + ((p2.z - p1.z) / d2) * r };
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * p1.x + t * t * b.x, z: u * u * a.z + 2 * u * t * p1.z + t * t * b.z });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
