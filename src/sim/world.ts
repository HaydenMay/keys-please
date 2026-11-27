// Headless simulation of one valet shift. Rendering reads this state; it never writes to it
// except through the command methods (assignValet, commitDrive, walkValetTo).

import { bodyTypes, type BodyType, type Config } from '../config';
import { buildLot, nearestNode, routeFromDrawing, shortestPath, type LotLayout, type LotNode, type Point } from './graph';
import { makeRng, type Rng } from './rng';

export type CarState = 'arriving' | 'waitingDropoff' | 'awaitingDrive' | 'driving' | 'curbQueue' | 'parked' | 'handoff' | 'leaving';
export type ValetState = 'idle' | 'walking' | 'boarding' | 'inCar' | 'keyFail' | 'returning';

export interface Car {
  id: number;
  paint: string;
  body: BodyType;
  rack: boolean;
  x: number;
  z: number;
  heading: number;
  state: CarState;
  /** Stall or curb node the car is in (or reserved for while arriving). */
  nodeId: number;
  route: Point[];
  routeIdx: number;
  reverseSegment: number;
  destNode: number;
  yieldTimer: number;
  blockedBy: number | null;
  stayLeft: number;
  requested: boolean;
  ticketId: number | null;
  valetId: number | null;
  claimedBy: number | null;
  /** Valet whose order queue includes this car. */
  queuedBy: number | null;
  /** Driving to (or sitting in) the curb lane, waiting for a curb spot to open. */
  waitingForCurb: boolean;
  curbWait: number;
  handoffLeft: number;
}

export interface Order {
  id: number;
  carId: number;
  /** Stall node, or for curb orders the preferred curb spot. */
  dest: number;
  toCurb: boolean;
}

export interface Valet {
  id: number;
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
  state: ValetState;
  path: Point[];
  pathIdx: number;
  targetCar: number | null;
  timer: number;
  /** Queue mode: the order this valet is working on. */
  current: Order | null;
}

export interface Ticket {
  id: number;
  carId: number;
  description: string;
  age: number;
  patience: number;
  angry: boolean;
}

export interface SimEvent {
  type: 'toast';
  text: string;
  tone: 'good' | 'bad' | 'info';
  x?: number;
  z?: number;
}

export interface DrivePlan {
  valid: boolean;
  destNode: number | null;
  nodes: number[];
  points: Point[];
  reason?: string;
}

export const MOVING: ReadonlySet<CarState> = new Set(['arriving', 'driving', 'leaving']);

export function describeCar(car: Pick<Car, 'paint' | 'body' | 'rack'>): string {
  return `${car.paint} ${car.body}${car.rack ? ' with a roof rack' : ''}`;
}

export class World {
  readonly lot: LotLayout;
  readonly cars = new Map<number, Car>();
  readonly valets: Valet[] = [];
  readonly tickets = new Map<number, Ticket>();
  /** Shared queue-mode order list, oldest first. */
  readonly orders: Order[] = [];
  readonly stats = { tips: 0, served: 0, lost: 0, wrongKeys: 0, angry: 0 };
  time = 0;
  queue = 0;
  readonly seed: number;

  private rng: Rng;
  private nextId = 1;
  private spawnTimer: number;
  private listeners: ((e: SimEvent) => void)[] = [];

  constructor(public cfg: Config, seed: number) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.lot = buildLot(cfg);
    this.spawnTimer = 2;

    const count = Math.max(1, Math.round(cfg.valet.count));
    for (let i = 0; i < count; i++) {
      const hx = this.lot.desk.x + (i - (count - 1) / 2) * 1.6;
      const hz = this.lot.desk.z + 0.4;
      this.valets.push({ id: i, x: hx, z: hz, homeX: hx, homeZ: hz, state: 'idle', path: [], pathIdx: 0, targetCar: null, timer: 0, current: null });
    }

    // A few cars already parked so pickups start early.
    const free = [...this.lot.stalls];
    const startParked = Math.min(free.length, Math.max(0, Math.round(cfg.traffic.startParked)));
    for (let i = 0; i < startParked; i++) {
      const idx = this.rng.int(0, free.length - 1);
      const stall = this.lot.nodes[free.splice(idx, 1)[0]];
      const car = this.makeCar(stall.x, stall.z, stall.heading);
      car.state = 'parked';
      car.nodeId = stall.id;
      car.stayLeft = this.rng.range(cfg.traffic.stayMin * 0.5, cfg.traffic.stayMax);
      stall.occupant = car.id;
    }
  }

  on(fn: (e: SimEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: SimEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // ---------- queries ----------

  carAt(p: Point, radius: number, filter: (c: Car) => boolean = () => true): Car | null {
    let best: Car | null = null;
    let bestD = radius;
    for (const car of this.cars.values()) {
      if (!filter(car)) continue;
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  valetAt(p: Point, radius: number): Valet | null {
    let best: Valet | null = null;
    let bestD = radius;
    for (const v of this.valets) {
      if (v.state === 'inCar') continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  nearestFreeValet(p: Point): Valet | null {
    let best: Valet | null = null;
    let bestD = Infinity;
    for (const v of this.valets) {
      if (v.state !== 'idle' && v.state !== 'returning') continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // ---------- commands ----------

  /** Send a valet to a car (optionally along a drawn walking line). */
  assignValet(valet: Valet, car: Car, walk: Point[] = []): { ok: boolean; reason?: string } {
    if (valet.state !== 'idle' && valet.state !== 'returning') return { ok: false, reason: 'That valet is busy' };
    if (!this.cars.has(car.id) || !(car.state === 'waitingDropoff' || car.state === 'parked')) return { ok: false, reason: "Can't grab that car right now" };
    if (car.claimedBy !== null && car.claimedBy !== valet.id) return { ok: false, reason: 'Another valet is on it' };

    // Only real jobs get claimed; a wrong guess is found out when the keys don't fit.
    const isJob = car.state === 'waitingDropoff' || (car.state === 'parked' && car.requested);
    if (isJob) car.claimedBy = valet.id;

    valet.path = [...decimate(walk, 0.6), this.doorPoint(car)];
    valet.pathIdx = 0;
    valet.targetCar = car.id;
    valet.state = 'walking';
    return { ok: true };
  }

  /** Walk a valet somewhere with no car at the end (repositioning). */
  walkValetTo(valet: Valet, walk: Point[]) {
    if (valet.state !== 'idle' && valet.state !== 'returning') return;
    valet.path = decimate(walk, 0.6);
    valet.pathIdx = 0;
    valet.targetCar = null;
    valet.state = 'walking';
  }

  /**
   * Can this spot be the target of a new order?
   * Stalls: must be empty and unclaimed. Curb: any curb spot works for a parked car, even a busy one;
   * the valet drives up and waits for whichever curb spot opens first.
   */
  canQueueDest(car: Car, n: LotNode): boolean {
    if (n.id === car.nodeId) return false;
    if (n.kind === 'stall') return n.occupant === null && n.reservedFor === null;
    if (n.kind === 'curb') return car.state === 'parked';
    return false;
  }

  /** Queue mode: add "get this car, take it there" to the shared list. The next free valet takes it. */
  queueOrder(car: Car, dest: LotNode): { ok: boolean; reason?: string } {
    if (car.queuedBy !== null || this.orders.some((o) => o.carId === car.id)) return { ok: false, reason: 'That car is already queued' };
    if (car.claimedBy !== null) return { ok: false, reason: 'Another valet is on it' };
    if (!(car.state === 'parked' || car.state === 'waitingDropoff')) return { ok: false, reason: "Can't grab that car right now" };
    if (!this.canQueueDest(car, dest)) return { ok: false, reason: car.state === 'waitingDropoff' ? 'New arrivals go to a stall' : 'That spot is taken' };
    if (this.orders.length >= Math.max(1, Math.round(this.cfg.valet.maxPendingOrders))) return { ok: false, reason: 'Order list is full' };
    const toCurb = dest.kind === 'curb';
    this.orders.push({ id: this.nextId++, carId: car.id, dest: dest.id, toCurb });
    if (!toCurb) dest.reservedFor = car.id;
    return { ok: true };
  }

  /** Remove a car's order. If a valet was already heading to it, they stop where they are. */
  cancelOrder(car: Car): boolean {
    const idx = this.orders.findIndex((o) => o.carId === car.id);
    if (idx >= 0) {
      this.releaseDest(this.orders[idx]);
      this.orders.splice(idx, 1);
      return true;
    }
    if (car.queuedBy === null) return false;
    const valet = this.valets[car.queuedBy];
    if (!valet.current || valet.current.carId !== car.id) { car.queuedBy = null; return true; }
    if (valet.state === 'inCar' || car.state === 'driving') return false; // already moving: too late
    this.releaseDest(valet.current);
    valet.current = null;
    if (car.claimedBy === valet.id) car.claimedBy = null;
    valet.targetCar = null;
    valet.path = [];
    valet.state = 'idle';
    valet.timer = this.cfg.valet.returnDelay;
    car.queuedBy = null;
    return true;
  }

  isQueued(car: Car): boolean {
    return car.queuedBy !== null || this.orders.some((o) => o.carId === car.id);
  }

  private releaseDest(o: Order) {
    const n = this.lot.nodes[o.dest];
    if (n.reservedFor === o.carId) n.reservedFor = null;
  }

  /** Hand the oldest orders to the nearest free valets. */
  private dispatchOrders() {
    while (this.orders.length) {
      const o = this.orders[0];
      const car = this.cars.get(o.carId);
      if (!car || !(car.state === 'parked' || car.state === 'waitingDropoff') || car.claimedBy !== null) {
        // Car left, or someone grabbed it another way: drop the order.
        this.orders.shift();
        this.releaseDest(o);
        continue;
      }
      let valet: Valet | null = null;
      let best = Infinity;
      for (const v of this.valets) {
        if (v.state !== 'idle' && v.state !== 'returning') continue;
        const d = Math.hypot(v.x - car.x, v.z - car.z);
        if (d < best) { best = d; valet = v; }
      }
      if (!valet) return;
      this.orders.shift();
      valet.current = o;
      car.queuedBy = valet.id;
      const isJob = car.state === 'waitingDropoff' || car.requested;
      if (isJob) car.claimedBy = valet.id;
      valet.path = [this.doorPoint(car)];
      valet.pathIdx = 0;
      valet.targetCar = car.id;
      valet.state = 'walking';
    }
  }

  /** After a job or a failed key: free for the next order; head back to the desk after a short wait. */
  private afterJob(v: Valet) {
    v.targetCar = null;
    v.current = null;
    v.state = 'idle';
    v.timer = this.cfg.valet.returnDelay;
    this.dispatchOrders();
  }

  /** Preview (and validate) a drive from a drawn finger line. */
  planDrive(car: Car, drawn: Point[]): DrivePlan {
    const end = drawn[drawn.length - 1];
    const empty = { valid: false, destNode: null, nodes: [], points: [] };
    if (car.state !== 'awaitingDrive' || !end) return { ...empty, reason: 'Not ready' };
    const dest = nearestNode(this.lot, end, this.cfg.controls.destSnapRadius, (n) => this.canPark(car, n));
    if (!dest) {
      const reason = car.requested ? 'Drag to an empty stall or a free curb spot' : 'Drag to an empty stall';
      // Still show where the lanes would take them, for feel.
      return { ...empty, reason };
    }
    const nodes = routeFromDrawing(this.lot, car.nodeId, dest.id, drawn, this.cfg.controls.snapRadius);
    if (!nodes) return { ...empty, reason: 'No route' };
    return { valid: true, destNode: dest.id, nodes, points: nodes.map((id) => ({ x: this.lot.nodes[id].x, z: this.lot.nodes[id].z })) };
  }

  commitDrive(car: Car, plan: DrivePlan): boolean {
    if (!plan.valid || plan.destNode === null || car.state !== 'awaitingDrive') return false;
    const dest = this.lot.nodes[plan.destNode];
    if (!this.canPark(car, dest)) return false;
    const start = this.lot.nodes[car.nodeId];
    start.occupant = null;
    dest.occupant = car.id;
    if (dest.reservedFor === car.id) dest.reservedFor = null;
    car.destNode = dest.id;
    car.route = plan.points.slice(1);
    car.routeIdx = 0;
    car.reverseSegment = start.kind === 'stall' ? 0 : -1;
    car.state = 'driving';
    car.yieldTimer = 0;
    return true;
  }

  private canPark(car: Car, n: LotNode): boolean {
    if (n.id === car.nodeId || n.occupant !== null) return false;
    if (n.reservedFor !== null && n.reservedFor !== car.id) return false;
    if (n.kind === 'stall') return true;
    if (n.kind === 'curb') return car.requested;
    return false;
  }

  // ---------- simulation ----------

  update(dt: number) {
    this.time += dt;
    this.updateSpawns(dt);
    this.dispatchOrders();
    this.updateCurbQueue();
    this.updateYield();
    for (const car of [...this.cars.values()]) this.updateCar(car, dt);
    for (const v of this.valets) this.updateValet(v, dt);
    for (const t of this.tickets.values()) {
      t.age += dt;
      if (!t.angry && t.age > t.patience) {
        t.angry = true;
        this.stats.angry++;
        this.emit({ type: 'toast', text: 'A pickup customer is fuming — no tip now', tone: 'bad' });
      }
    }
  }

  private updateSpawns(dt: number) {
    const T = this.cfg.traffic;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.queue++;
      this.spawnTimer = Math.max(1, T.spawnInterval + this.rng.range(-T.spawnJitter, T.spawnJitter));
    }
    // Pickups waiting for the curb go before new arrivals.
    const pickupWaiting = [...this.cars.values()].some((c) => c.waitingForCurb);
    while (this.queue > 0 && !pickupWaiting) {
      const spot = this.lot.dropoffCurbs.map((id) => this.lot.nodes[id]).find((n) => n.occupant === null);
      if (!spot) break;
      this.queue--;
      const entry = this.lot.nodes[this.lot.entry];
      const car = this.makeCar(entry.x, entry.z, 0);
      const path = shortestPath(this.lot, entry.id, spot.id)!;
      car.route = path.slice(1).map((id) => ({ x: this.lot.nodes[id].x, z: this.lot.nodes[id].z }));
      car.state = 'arriving';
      car.nodeId = spot.id;
      car.destNode = spot.id;
      spot.occupant = car.id;
    }
  }

  private makeCar(x: number, z: number, heading: number): Car {
    const paints = Object.keys(this.cfg.carPaints);
    const bodies = Object.keys(bodyTypes) as BodyType[];
    let paint = paints[0];
    let body = bodies[0];
    let rack = false;
    // Every car on the lot must be identifiable: never two identical looks at once.
    for (let tries = 0; tries < 60; tries++) {
      paint = this.rng.pick(paints);
      body = this.rng.pick(bodies);
      rack = this.rng.next() < 0.25;
      const clash = [...this.cars.values()].some((c) => c.paint === paint && c.body === body && c.rack === rack);
      if (!clash) break;
    }
    const car: Car = {
      id: this.nextId++, paint, body, rack, x, z, heading, state: 'arriving', nodeId: -1, route: [], routeIdx: 0,
      reverseSegment: -1, destNode: -1, yieldTimer: 0, blockedBy: null, stayLeft: 0, requested: false, ticketId: null,
      valetId: null, claimedBy: null, queuedBy: null, waitingForCurb: false, curbWait: 0, handoffLeft: 0,
    };
    this.cars.set(car.id, car);
    return car;
  }

  private updateYield() {
    const moving = [...this.cars.values()].filter((c) => MOVING.has(c.state));
    for (const c of moving) {
      c.blockedBy = null;
      const target = c.route[c.routeIdx];
      if (!target) continue;
      const mx = target.x - c.x;
      const mz = target.z - c.z;
      const ml = Math.hypot(mx, mz) || 1;
      for (const o of moving) {
        if (o === c) continue;
        const vx = o.x - c.x;
        const vz = o.z - c.z;
        const d = Math.hypot(vx, vz);
        if (d > this.cfg.car.yieldDistance || d < 1e-3) continue;
        if ((vx * mx + vz * mz) / (d * ml) > 0.6) { c.blockedBy = o.id; break; }
      }
    }
    // Two cars nose to nose: the older one goes first.
    for (const c of moving) {
      if (c.blockedBy === null) continue;
      const o = this.cars.get(c.blockedBy);
      if (o && o.blockedBy === c.id && c.id < o.id) c.blockedBy = null;
    }
  }

  private updateCar(car: Car, dt: number) {
    const C = this.cfg.car;
    switch (car.state) {
      case 'parked': {
        if (!car.requested) {
          car.stayLeft -= dt;
          if (car.stayLeft <= 0) this.requestPickup(car);
        }
        return;
      }
      case 'waitingDropoff': {
        if (car.claimedBy !== null) return;
        car.curbWait += dt;
        if (car.curbWait > this.cfg.customers.dropoffPatience) {
          this.cancelOrder(car);
          this.stats.lost++;
          this.emit({ type: 'toast', text: 'A customer got tired of waiting and drove off', tone: 'bad', x: car.x, z: car.z });
          this.sendToExit(car);
        }
        return;
      }
      case 'handoff': {
        car.handoffLeft -= dt;
        if (car.handoffLeft <= 0) this.sendToExit(car);
        return;
      }
      case 'awaitingDrive':
        return;
    }

    // Moving states
    if (car.blockedBy !== null) {
      car.yieldTimer += dt;
      if (car.yieldTimer < C.yieldTimeout) return;
    } else {
      car.yieldTimer = 0;
    }

    const target = car.route[car.routeIdx];
    if (!target) { this.arrive(car); return; }
    const dx = target.x - car.x;
    const dz = target.z - car.z;
    const dist = Math.hypot(dx, dz);
    const reversing = car.routeIdx === car.reverseSegment;
    const speed = car.state === 'driving' ? (reversing ? C.reverseSpeed : C.driveSpeed) : C.arrivalSpeed;
    if (dist > 1e-3) {
      const moveAngle = Math.atan2(dz, dx);
      const desired = reversing ? moveAngle + Math.PI : moveAngle;
      car.heading = turnToward(car.heading, desired, C.turnRate * dt);
    }
    const step = speed * dt;
    if (step >= dist) {
      car.x = target.x;
      car.z = target.z;
      car.routeIdx++;
      if (car.routeIdx >= car.route.length) this.arrive(car);
    } else {
      car.x += (dx / dist) * step;
      car.z += (dz / dist) * step;
    }
  }

  private arrive(car: Car) {
    if (car.state === 'leaving') {
      this.cars.delete(car.id);
      return;
    }
    const node = this.lot.nodes[car.destNode];
    car.heading = node.heading;
    car.nodeId = node.id;
    if (car.state === 'arriving') {
      car.state = 'waitingDropoff';
      car.curbWait = 0;
      return;
    }
    if (node.kind === 'lane' && car.waitingForCurb) {
      car.state = 'curbQueue'; // valet stays in the car
      return;
    }
    // driving → parked or handed off
    const valet = car.valetId !== null ? this.valets[car.valetId] : null;
    car.valetId = null;
    car.claimedBy = null;
    if (valet) this.exitCar(valet, car);
    if (node.kind === 'stall') {
      car.state = 'parked';
      if (car.stayLeft <= 0 && !car.requested) car.stayLeft = this.rng.range(this.cfg.traffic.stayMin, this.cfg.traffic.stayMax);
    } else if (node.kind === 'curb' && car.requested) {
      car.state = 'handoff';
      car.handoffLeft = this.cfg.customers.handoffTime;
      this.completePickup(car);
    }
  }

  private requestPickup(car: Car) {
    car.requested = true;
    const t: Ticket = { id: this.nextId++, carId: car.id, description: describeCar(car), age: 0, patience: this.cfg.customers.pickupPatience, angry: false };
    car.ticketId = t.id;
    this.tickets.set(t.id, t);
  }

  private completePickup(car: Car) {
    const t = car.ticketId !== null ? this.tickets.get(car.ticketId) : undefined;
    let tip = 0;
    if (t) {
      const K = this.cfg.customers;
      tip = t.angry ? 0 : Math.round(K.minTip + (K.maxTip - K.minTip) * Math.max(0, 1 - t.age / t.patience));
      this.tickets.delete(t.id);
    }
    car.ticketId = null;
    this.stats.tips += tip;
    this.stats.served++;
    this.emit({ type: 'toast', text: tip > 0 ? `+$${tip} tip` : 'No tip', tone: tip > 0 ? 'good' : 'bad', x: car.x, z: car.z });
  }

  private sendToExit(car: Car) {
    const from = car.nodeId;
    if (from >= 0 && this.lot.nodes[from].occupant === car.id) this.lot.nodes[from].occupant = null;
    const path = shortestPath(this.lot, from, this.lot.exit) ?? [this.lot.exit];
    car.route = path.slice(1).map((id) => ({ x: this.lot.nodes[id].x, z: this.lot.nodes[id].z }));
    car.routeIdx = 0;
    car.reverseSegment = -1;
    car.state = 'leaving';
    car.claimedBy = null;
  }

  private exitCar(valet: Valet, car: Car) {
    const door = this.doorPoint(car);
    valet.x = door.x;
    valet.z = door.z;
    car.queuedBy = null;
    this.afterJob(valet);
  }

  private doorPoint(car: Car): Point {
    const side = bodyTypes[car.body].width / 2 + 0.6;
    // Driver's side = left of the car's forward direction.
    return { x: car.x + Math.sin(car.heading) * side, z: car.z - Math.cos(car.heading) * side };
  }

  private updateValet(v: Valet, dt: number) {
    const V = this.cfg.valet;
    if (v.state === 'idle' && V.autoReturnToDesk && Math.hypot(v.x - v.homeX, v.z - v.homeZ) > 0.5) {
      v.timer -= dt;
      if (v.timer <= 0) {
        v.path = [{ x: v.homeX, z: v.homeZ }];
        v.pathIdx = 0;
        v.state = 'returning';
      }
    }
    switch (v.state) {
      case 'inCar': {
        const car = v.targetCar !== null ? this.cars.get(v.targetCar) : undefined;
        if (car) { v.x = car.x; v.z = car.z; }
        return;
      }
      case 'boarding': {
        v.timer -= dt;
        if (v.timer <= 0) this.tryKeys(v);
        return;
      }
      case 'keyFail': {
        v.timer -= dt;
        if (v.timer <= 0) this.afterJob(v);
        return;
      }
      case 'walking':
      case 'returning': {
        // Keep the door point fresh in case the car moved (e.g. it was still pulling up).
        if (v.state === 'walking' && v.targetCar !== null) {
          const car = this.cars.get(v.targetCar);
          if (car) v.path[v.path.length - 1] = this.doorPoint(car);
        }
        const target = v.path[v.pathIdx];
        if (!target) { this.finishWalk(v); return; }
        const dx = target.x - v.x;
        const dz = target.z - v.z;
        const dist = Math.hypot(dx, dz);
        const step = V.walkSpeed * dt;
        if (step >= dist) {
          v.x = target.x;
          v.z = target.z;
          v.pathIdx++;
          if (v.pathIdx >= v.path.length) this.finishWalk(v);
        } else {
          v.x += (dx / dist) * step;
          v.z += (dz / dist) * step;
        }
        return;
      }
    }
  }

  private finishWalk(v: Valet) {
    if (v.state === 'returning' || v.targetCar === null) {
      v.state = 'idle';
      v.timer = this.cfg.valet.returnDelay;
      return;
    }
    v.state = 'boarding';
    v.timer = this.cfg.valet.boardTime;
  }

  /** Queue mode: the valet is in the car, so drive straight to the ordered spot. */
  private autoDrive(car: Car, order: Order) {
    if (order.toCurb) {
      const spot = this.freeCurb(car, order.dest);
      if (spot) this.driveTo(car, spot.id);
      else {
        // Every curb spot is busy: pull into the curb lane and wait for one to open.
        const wait = this.lot.nodes[order.dest].neighbors.find((id) => this.lot.nodes[id].kind === 'lane');
        if (wait === undefined || !this.driveTo(car, wait)) return;
        car.waitingForCurb = true;
      }
      return;
    }
    const dest = this.lot.nodes[order.dest];
    const nodes = this.canPark(car, dest) ? shortestPath(this.lot, car.nodeId, dest.id) : null;
    if (!nodes) {
      this.releaseDest(order);
      this.emit({ type: 'toast', text: 'Spot taken — drag the car somewhere', tone: 'info', x: car.x, z: car.z });
      return;
    }
    const plan: DrivePlan = { valid: true, destNode: dest.id, nodes, points: nodes.map((id) => ({ x: this.lot.nodes[id].x, z: this.lot.nodes[id].z })) };
    this.commitDrive(car, plan);
  }

  /** A free curb spot for this car: the preferred one if open, else the nearest open one. */
  private freeCurb(car: Car, preferred: number): LotNode | null {
    const open = this.lot.curbs.map((id) => this.lot.nodes[id]).filter((n) => n.occupant === null && n.reservedFor === null);
    if (!open.length) return null;
    const pref = open.find((n) => n.id === preferred);
    if (pref) return pref;
    return open.reduce((a, b) => (Math.hypot(a.x - car.x, a.z - car.z) <= Math.hypot(b.x - car.x, b.z - car.z) ? a : b));
  }

  /** Start driving a car (with its valet inside) to any node along lanes. */
  private driveTo(car: Car, destId: number): boolean {
    const nodes = shortestPath(this.lot, car.nodeId, destId);
    if (!nodes) return false;
    const start = this.lot.nodes[car.nodeId];
    const dest = this.lot.nodes[destId];
    if (start.occupant === car.id) start.occupant = null;
    if (dest.kind !== 'lane') dest.occupant = car.id;
    if (dest.reservedFor === car.id) dest.reservedFor = null;
    car.destNode = destId;
    car.route = nodes.slice(1).map((id) => ({ x: this.lot.nodes[id].x, z: this.lot.nodes[id].z }));
    car.routeIdx = 0;
    car.reverseSegment = start.kind === 'stall' ? 0 : -1;
    car.state = 'driving';
    car.yieldTimer = 0;
    return true;
  }

  /** Cars waiting in the curb lane take spots as they open, oldest first. */
  private updateCurbQueue() {
    const waiting = [...this.cars.values()].filter((c) => c.state === 'curbQueue').sort((a, b) => a.id - b.id);
    for (const car of waiting) {
      const spot = this.freeCurb(car, -1);
      if (!spot) return;
      car.waitingForCurb = false;
      this.driveTo(car, spot.id);
    }
  }

  private tryKeys(v: Valet) {
    const car = v.targetCar !== null ? this.cars.get(v.targetCar) : undefined;
    const valid = car && car.claimedBy === v.id && (car.state === 'waitingDropoff' || (car.state === 'parked' && car.requested));
    if (car && valid) {
      car.state = 'awaitingDrive';
      car.valetId = v.id;
      v.state = 'inCar';
      if (v.current && v.current.carId === car.id) this.autoDrive(car, v.current);
      return;
    }
    if (car && car.claimedBy === v.id) car.claimedBy = null;
    if (v.current) {
      this.releaseDest(v.current);
      if (car) car.queuedBy = null;
      v.current = null;
    }
    this.stats.wrongKeys++;
    this.emit({ type: 'toast', text: car ? "Keys don't fit — wrong car!" : 'That car is gone', tone: 'bad', x: v.x, z: v.z });
    v.state = 'keyFail';
    v.timer = this.cfg.valet.keyFailTime;
  }
}

function turnToward(current: number, target: number, maxStep: number): number {
  let diff = target - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (Math.abs(diff) <= maxStep) return current + diff;
  return current + Math.sign(diff) * maxStep;
}

/** Thin out a finger line so valets don't zig-zag on every pixel. */
function decimate(points: Point[], minGap: number): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= minGap) out.push({ x: p.x, z: p.z });
  }
  return out;
}
