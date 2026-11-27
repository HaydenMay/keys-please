// The lot as a logic graph: lanes, stalls, curb spots. No rendering here.
// World axes: x runs left→right along the mall, z runs from the mall (z≈0) away into the lot.

import type { Config } from '../config';

export type NodeKind = 'lane' | 'stall' | 'curb' | 'entry' | 'exit';

export interface LotNode {
  id: number;
  x: number;
  z: number;
  kind: NodeKind;
  /** For stalls and curb spots: the heading a car faces when parked there (radians, forward = (cos h, sin h)). */
  heading: number;
  /** Car id occupying or reserved for this spot. */
  occupant: number | null;
  neighbors: number[];
}

export interface LotLayout {
  nodes: LotNode[];
  stalls: number[];
  curbs: number[];
  /** Curb spots arrivals may pull into (the rest are pickup-only). */
  dropoffCurbs: number[];
  entry: number;
  exit: number;
  /** Bounds of the drawable lot (including mall + sidewalk). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  desk: { x: number; z: number };
  mallFront: number;
  sidewalkZ: [number, number];
  curbLaneZ: number;
  laneLeftX: number;
  laneRightX: number;
  aisles: { z: number }[];
  stallRects: { x: number; z: number; w: number; d: number; heading: number }[];
}

export function buildLot(cfg: Config): LotLayout {
  const L = cfg.lot;
  const nodes: LotNode[] = [];
  const add = (x: number, z: number, kind: NodeKind, heading = 0): number => {
    const id = nodes.length;
    nodes.push({ id, x, z, kind, heading, occupant: null, neighbors: [] });
    return id;
  };
  const link = (a: number, b: number) => {
    nodes[a].neighbors.push(b);
    nodes[b].neighbors.push(a);
  };

  const n = Math.max(2, Math.round(L.stallsPerRow));
  const pairs = Math.max(1, Math.round(L.rowPairs));
  const x0 = L.sideLaneWidth;
  const laneLeftX = L.sideLaneWidth / 2;
  const laneRightX = x0 + n * L.stallWidth + L.sideLaneWidth / 2;
  const W = x0 + n * L.stallWidth + L.sideLaneWidth;
  const colX = (i: number) => x0 + L.stallWidth * (i + 0.5);

  const mallFront = 0;
  const sidewalkZ: [number, number] = [0, 2];
  const curbSpotZ = 3.4;
  const curbLaneZ = 7.2;
  const lotStartZ = curbLaneZ + L.sideLaneWidth / 2 + 0.5;

  // Curb lane: entry → left lane top → … → right lane top → exit
  const entry = add(-7, curbLaneZ, 'entry');
  const leftTop = add(laneLeftX, curbLaneZ, 'lane');
  link(entry, leftTop);

  const curbs: number[] = [];
  const spots = Math.max(1, Math.round(L.curbSpots));
  const curbStart = x0 + L.stallWidth;
  const curbEnd = W - L.sideLaneWidth - L.stallWidth;
  let prevLane = leftTop;
  for (let i = 0; i < spots; i++) {
    const x = spots === 1 ? (curbStart + curbEnd) / 2 : curbStart + ((curbEnd - curbStart) * i) / (spots - 1);
    const laneNode = add(x, curbLaneZ, 'lane');
    link(prevLane, laneNode);
    prevLane = laneNode;
    const spot = add(x, curbSpotZ, 'curb', 0);
    link(laneNode, spot);
    curbs.push(spot);
  }
  const rightTop = add(laneRightX, curbLaneZ, 'lane');
  link(prevLane, rightTop);
  const exit = add(W + 7, curbLaneZ, 'exit');
  link(rightTop, exit);

  const stalls: number[] = [];
  const stallRects: LotLayout['stallRects'] = [];
  const aisles: { z: number }[] = [];
  let prevLeft = leftTop;
  let prevRight = rightTop;
  const pairDepth = 2 * L.stallDepth + L.aisleWidth;

  for (let p = 0; p < pairs; p++) {
    const zTop = lotStartZ + p * pairDepth;
    const aisleZ = zTop + L.stallDepth + L.aisleWidth / 2;
    aisles.push({ z: aisleZ });
    const left = add(laneLeftX, aisleZ, 'lane');
    const right = add(laneRightX, aisleZ, 'lane');
    link(prevLeft, left);
    link(prevRight, right);
    prevLeft = left;
    prevRight = right;

    let prev = left;
    for (let i = 0; i < n; i++) {
      const a = add(colX(i), aisleZ, 'lane');
      link(prev, a);
      prev = a;
      // Row above the aisle: cars nose toward the mall (−z).
      const topZ = zTop + L.stallDepth / 2;
      const s1 = add(colX(i), topZ, 'stall', -Math.PI / 2);
      link(a, s1);
      stalls.push(s1);
      stallRects.push({ x: colX(i), z: topZ, w: L.stallWidth, d: L.stallDepth, heading: -Math.PI / 2 });
      // Row below the aisle: cars nose away from the mall (+z).
      const botZ = aisleZ + L.aisleWidth / 2 + L.stallDepth / 2;
      const s2 = add(colX(i), botZ, 'stall', Math.PI / 2);
      link(a, s2);
      stalls.push(s2);
      stallRects.push({ x: colX(i), z: botZ, w: L.stallWidth, d: L.stallDepth, heading: Math.PI / 2 });
    }
    link(prev, right);
  }

  const pickupOnly = Math.min(curbs.length - 1, Math.max(0, Math.round(L.pickupOnlySpots)));
  const dropoffCurbs = curbs.slice(0, curbs.length - pickupOnly);

  const maxZ = lotStartZ + pairs * pairDepth + 0.5;
  return {
    nodes,
    stalls,
    curbs,
    dropoffCurbs,
    entry,
    exit,
    bounds: { minX: 0, maxX: W, minZ: -5, maxZ },
    desk: { x: W / 2, z: 1.1 },
    mallFront,
    sidewalkZ,
    curbLaneZ,
    laneLeftX,
    laneRightX,
    aisles,
    stallRects,
  };
}

/** Parking spots (stalls, curbs, entry/exit) can only be route endpoints, never passed through. */
function passable(node: LotNode, start: number, goal: number): boolean {
  return node.kind === 'lane' || node.id === start || node.id === goal;
}

/** Dijkstra shortest path between two nodes. Returns node ids including both ends, or null. */
export function shortestPath(lot: LotLayout, start: number, goal: number): number[] | null {
  if (start === goal) return [start];
  const N = lot.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  dist[start] = 0;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u === -1) return null;
    if (u === goal) break;
    done[u] = 1;
    const nu = lot.nodes[u];
    for (const v of nu.neighbors) {
      const nv = lot.nodes[v];
      if (!passable(nv, start, goal)) continue;
      const d = best + Math.hypot(nv.x - nu.x, nv.z - nu.z);
      if (d < dist[v]) { dist[v] = d; prev[v] = u; }
    }
  }
  const path: number[] = [];
  for (let c = goal; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}

export interface Point { x: number; z: number }

/**
 * Turn a rough finger line into a clean lane route.
 * Lane nodes the line passes near become waypoints (in drawing order), so the route follows
 * the player's intent; gaps between waypoints are filled with shortest paths.
 */
export function routeFromDrawing(lot: LotLayout, start: number, goal: number, drawn: Point[], snapRadius: number): number[] | null {
  const waypoints: number[] = [start];
  for (const p of drawn) {
    let bestId = -1;
    let bestD = snapRadius;
    for (const node of lot.nodes) {
      if (node.kind !== 'lane') continue;
      const d = Math.hypot(node.x - p.x, node.z - p.z);
      if (d < bestD) { bestD = d; bestId = node.id; }
    }
    if (bestId === -1) continue;
    const last = waypoints[waypoints.length - 1];
    if (bestId === last) continue;
    // Finger wobbled back: undo instead of adding a back-and-forth.
    if (waypoints.length >= 2 && waypoints[waypoints.length - 2] === bestId) { waypoints.pop(); continue; }
    waypoints.push(bestId);
  }
  if (waypoints[waypoints.length - 1] !== goal) waypoints.push(goal);

  const route: number[] = [start];
  for (let i = 1; i < waypoints.length; i++) {
    const seg = shortestPath(lot, waypoints[i - 1], waypoints[i]);
    if (!seg) return null;
    for (let j = 1; j < seg.length; j++) route.push(seg[j]);
  }
  // Remove any immediate A→B→A reversals the stitching created.
  for (let i = 2; i < route.length; i++) {
    if (route[i] === route[i - 2]) { route.splice(i - 1, 2); i = Math.max(1, i - 3); }
  }
  // A route must never pass through a parking spot mid-way.
  for (let i = 1; i < route.length - 1; i++) if (lot.nodes[route[i]].kind !== 'lane') return shortestPath(lot, start, goal);
  return route;
}

export function nearestNode(lot: LotLayout, p: Point, maxDist: number, filter: (n: LotNode) => boolean): LotNode | null {
  let best: LotNode | null = null;
  let bestD = maxDist;
  for (const node of lot.nodes) {
    if (!filter(node)) continue;
    const d = Math.hypot(node.x - p.x, node.z - p.z);
    if (d < bestD) { bestD = d; best = node; }
  }
  return best;
}
