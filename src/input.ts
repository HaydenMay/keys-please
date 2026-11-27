import type { Config } from './config';
import { nearestNode, type Point } from './sim/graph';
import type { Car, Valet, World } from './sim/world';
import type { LotRenderer } from './render/renderer';

type Gesture =
  | { kind: 'drive'; car: Car; points: Point[] }
  | { kind: 'walk'; valet: Valet; points: Point[] }
  | { kind: 'tap'; start: Point };

/** One finger: drag from a car with a valet inside to drive it; drag from a valet (draw mode) to walk; tap otherwise. */
export class InputController {
  private gesture: Gesture | null = null;
  private pointerId: number | null = null;

  constructor(
    private el: HTMLElement,
    private world: () => World,
    private view: () => LotRenderer,
    private cfg: Config,
    private toast: (text: string, tone: 'good' | 'bad' | 'info', at?: Point) => void,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private point(e: PointerEvent): Point | null {
    return this.view().screenToWorld(e.clientX, e.clientY);
  }

  private down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    const p = this.point(e);
    if (!p) return;
    this.pointerId = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    const w = this.world();
    const C = this.cfg.controls;

    const car = w.carAt(p, C.pickRadius, (c) => c.state === 'awaitingDrive');
    if (car) {
      this.gesture = { kind: 'drive', car, points: [{ x: car.x, z: car.z }, p] };
      return;
    }
    if (C.valetMode === 'draw') {
      const valet = w.valetAt(p, C.pickRadius);
      if (valet && (valet.state === 'idle' || valet.state === 'returning')) {
        this.gesture = { kind: 'walk', valet, points: [{ x: valet.x, z: valet.z }, p] };
        this.view().selectedValet = valet.id;
        return;
      }
    }
    this.gesture = { kind: 'tap', start: p };
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || !this.gesture || this.gesture.kind === 'tap') return;
    const p = this.point(e);
    if (!p) return;
    const pts = this.gesture.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(p.x - last.x, p.z - last.z) < 0.3) return;
    pts.push(p);
    if (this.gesture.kind === 'drive') {
      const plan = this.world().planDrive(this.gesture.car, pts);
      this.view().setPreview(pts, plan.points, plan.valid, 'drive');
    } else {
      this.view().setPreview(pts, null, true, 'walk');
    }
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const g = this.gesture;
    this.reset(e);
    if (!g) return;
    const w = this.world();
    const C = this.cfg.controls;

    if (g.kind === 'drive') {
      if (pathLength(g.points) < C.minDragDistance + 0.5) {
        this.toast('Drag from the car to where it should go', 'info', g.car);
        return;
      }
      const plan = w.planDrive(g.car, g.points);
      if (!plan.valid || !w.commitDrive(g.car, plan)) this.toast(plan.reason ?? "Can't park there", 'bad', g.points[g.points.length - 1]);
      return;
    }

    if (g.kind === 'walk') {
      const end = g.points[g.points.length - 1];
      if (pathLength(g.points) < C.minDragDistance) return; // just a selection tap
      const car = w.carAt(end, C.pickRadius, (c) => c.state === 'parked' || c.state === 'waitingDropoff');
      if (car) {
        const res = w.assignValet(g.valet, car, g.points.slice(1));
        if (!res.ok) this.toast(res.reason ?? 'Nope', 'bad', end);
      } else {
        w.walkValetTo(g.valet, g.points.slice(1));
      }
      this.view().selectedValet = null;
      return;
    }

    // Tap
    const p = g.start;
    if (C.valetMode === 'queue') {
      this.queueTap(p);
      return;
    }
    const tappedValet = w.valetAt(p, C.pickRadius);
    if (tappedValet) {
      this.view().selectedValet = this.view().selectedValet === tappedValet.id ? null : tappedValet.id;
      return;
    }
    const car = w.carAt(p, C.pickRadius, (c) => c.state === 'parked' || c.state === 'waitingDropoff');
    if (!car) {
      this.view().selectedValet = null;
      return;
    }
    if (C.valetMode === 'draw') {
      this.toast('Draw a line from a valet to the car', 'info', car);
      return;
    }
    const sel = this.view().selectedValet;
    const selected = sel !== null ? w.valets[sel] : null;
    const valet = selected && (selected.state === 'idle' || selected.state === 'returning') ? selected : w.nearestFreeValet(car);
    if (!valet) {
      this.toast('No free valets', 'bad', car);
      return;
    }
    const res = w.assignValet(valet, car);
    if (!res.ok) this.toast(res.reason ?? 'Nope', 'bad', car);
    this.view().selectedValet = null;
  };

  /** Queue mode: tap a car, then tap its spot. Tap a queued car to remove its order. */
  private queueTap(p: Point) {
    const w = this.world();
    const view = this.view();
    const C = this.cfg.controls;
    const car = w.carAt(p, C.pickRadius, (c) => c.state === 'parked' || c.state === 'waitingDropoff');
    if (car) {
      if (w.isQueued(car)) {
        const ok = w.cancelOrder(car);
        this.toast(ok ? 'Order removed' : 'Too late — already moving', 'info', car);
        view.pendingCar = null;
        return;
      }
      if (car.claimedBy !== null) {
        this.toast('Another valet is on it', 'info', car);
        return;
      }
      view.pendingCar = view.pendingCar === car.id ? null : car.id;
      return;
    }
    const pending = view.pendingCar !== null ? w.cars.get(view.pendingCar) : undefined;
    if (!pending || !(pending.state === 'parked' || pending.state === 'waitingDropoff')) {
      view.pendingCar = null;
      return;
    }
    const dest = nearestNode(w.lot, p, C.destTapRadius, (n) => w.canQueueDest(pending, n));
    if (!dest) {
      this.toast(pending.state === 'waitingDropoff' ? 'Tap an empty stall' : 'Tap an empty stall or curb spot', 'info', p);
      return;
    }
    const res = w.queueOrder(pending, dest);
    if (!res.ok) {
      this.toast(res.reason ?? 'Nope', 'bad', p);
      return;
    }
    view.pendingCar = null;
  }

  private cancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.reset(e);
  };

  private reset(e: PointerEvent) {
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    this.pointerId = null;
    this.gesture = null;
    this.view().clearPreview();
  }
}

function pathLength(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return d;
}
