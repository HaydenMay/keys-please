import * as THREE from 'three';
import { bodyTypes, type Config } from '../config';
import { shortestPath, type Point } from '../sim/graph';
import type { Car, World } from '../sim/world';
import { ribbonGeometry, smoothCorners } from './ribbon';

interface CarView {
  group: THREE.Group;
  awaitRing: THREE.Mesh;
  marker: THREE.Mesh;
  requestedRing: THREE.Mesh;
  storeDot: THREE.Mesh;
}

interface ValetView {
  group: THREE.Group;
  ring: THREE.Mesh;
  path: THREE.Mesh;
}

/** Draws the World from above. Owns nothing gameplay-related. */
export class LotRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  private staticGroup = new THREE.Group();
  private dynamicGroup = new THREE.Group();
  private cars = new Map<number, CarView>();
  private valets: ValetView[] = [];
  private routeLines = new Map<number, THREE.Mesh>();
  private orderLines = new Map<number, THREE.Mesh>();
  private pendingRing: THREE.Mesh;
  private previewRaw: THREE.Mesh;
  private previewRoute: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private clock = 0;
  portrait = false;
  selectedValet: number | null = null;
  pendingCar: number | null = null;

  constructor(private container: HTMLElement, private world: World, private cfg: Config) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.add(this.staticGroup, this.dynamicGroup);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    const b = world.lot.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    sun.position.set(cx - 12, 40, cz - 18);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.75;
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 120 });
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(hemi, sun, sun.target);

    const mat = (c: string, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false });
    this.previewRaw = new THREE.Mesh(new THREE.BufferGeometry(), mat(cfg.colors.rawLine, 0.45));
    this.previewRoute = new THREE.Mesh(new THREE.BufferGeometry(), mat(cfg.colors.routeLine, 0.9));
    this.previewRaw.renderOrder = 10;
    this.previewRoute.renderOrder = 11;
    this.scene.add(this.previewRaw, this.previewRoute);
    this.pendingRing = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.35, 48), mat(cfg.colors.pendingRing, 0.9));
    this.pendingRing.rotation.x = -Math.PI / 2;
    this.pendingRing.renderOrder = 12;
    this.scene.add(this.pendingRing);

    this.buildStatic();
    this.resize();
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- camera ----------

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(this.cfg.colors.background);
    this.portrait = h > w && this.cfg.view.rotateInPortrait;
    const b = this.world.lot.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const spanX = b.maxX - b.minX;
    const spanZ = b.maxZ - b.minZ;
    // Landscape: x across the screen, mall at the top. Portrait: lot turned so x runs up the screen.
    const worldW = (this.portrait ? spanZ : spanX) + this.cfg.view.padding * 2;
    const worldH = (this.portrait ? spanX : spanZ) + this.cfg.view.padding * 2;
    const aspect = w / h;
    let halfW: number;
    let halfH: number;
    if (worldW / worldH > aspect) { halfW = worldW / 2; halfH = halfW / aspect; }
    else { halfH = worldH / 2; halfW = halfH * aspect; }
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.position.set(cx, 60, cz);
    this.camera.up.set(this.portrait ? 1 : 0, 0, this.portrait ? 0 : -1);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();
  }

  screenToWorld(clientX: number, clientY: number): Point | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  worldToScreen(p: Point): { x: number; y: number } {
    const v = new THREE.Vector3(p.x, 1.5, p.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // ---------- static lot ----------

  rebuildStatic() {
    this.buildStatic();
    for (const id of [...this.cars.keys()]) this.removeCar(id);
    for (const v of this.valets) this.dynamicGroup.remove(v.group, v.path);
    this.valets = [];
    for (const m of this.orderLines.values()) this.dynamicGroup.remove(m);
    this.orderLines.clear();
    (this.pendingRing.material as THREE.MeshBasicMaterial).color.set(this.cfg.colors.pendingRing);
    (this.previewRaw.material as THREE.MeshBasicMaterial).color.set(this.cfg.colors.rawLine);
    this.resize();
  }

  private buildStatic() {
    const g = this.staticGroup;
    g.clear();
    const C = this.cfg.colors;
    const lot = this.world.lot;
    const b = lot.bounds;
    const std = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
    const flat = (c: string) => new THREE.MeshBasicMaterial({ color: c });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.maxX - b.minX + 80, b.maxZ - b.minZ + 80), std(C.asphalt));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    ground.receiveShadow = true;
    g.add(ground);

    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 80, 0.15, lot.sidewalkZ[1] - lot.sidewalkZ[0]), std(C.sidewalk));
    sidewalk.position.set((b.minX + b.maxX) / 2, 0.075, (lot.sidewalkZ[0] + lot.sidewalkZ[1]) / 2);
    sidewalk.receiveShadow = true;
    g.add(sidewalk);

    const mallDepth = 40;
    const mall = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 80, 3, mallDepth), std(C.mall));
    mall.position.set((b.minX + b.maxX) / 2, 1.5, lot.mallFront - mallDepth / 2);
    mall.castShadow = true;
    mall.receiveShadow = true;
    g.add(mall);
    const door = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.2), std(C.mallDoor));
    door.position.set(lot.desk.x, 1.1, lot.mallFront + 0.05);
    g.add(door);
    const doorTop = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.6), flat(C.mallDoor));
    doorTop.rotation.x = -Math.PI / 2;
    doorTop.position.set(lot.desk.x, 3.02, lot.mallFront - 0.3);
    g.add(doorTop);

    const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1, 0.8), std(C.desk));
    desk.position.set(lot.desk.x + 3.2, 0.5, lot.desk.z);
    desk.castShadow = true;
    g.add(desk);

    // Stall lines
    const lineMat = flat(C.stallLine);
    const line = (x: number, z: number, w: number, d: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      g.add(m);
    };
    for (const s of lot.stallRects) {
      line(s.x - s.w / 2, s.z, 0.12, s.d);
      line(s.x + s.w / 2, s.z, 0.12, s.d);
      // Back line on the far side from the aisle
      const back = s.heading < 0 ? s.z - s.d / 2 : s.z + s.d / 2;
      line(s.x, back, s.w, 0.12);
    }
    // Lane centre dashes
    const dashMat = flat(C.laneMark);
    const dashRow = (x0: number, x1: number, z: number) => {
      for (let x = x0; x < x1; x += 2.4) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), dashMat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x + 0.6, 0.02, z);
        g.add(m);
      }
    };
    dashRow(b.minX - 6, b.maxX + 6, lot.curbLaneZ);
    for (const a of lot.aisles) dashRow(lot.laneLeftX, lot.laneRightX, a.z);

    // Curb pickup/drop-off pads
    for (const id of lot.curbs) {
      const n = lot.nodes[id];
      const pickupOnly = !lot.dropoffCurbs.includes(id);
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.8), flat(pickupOnly ? C.pickupSpot : C.curbSpot));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(n.x, 0.015, n.z);
      g.add(pad);
    }

    if (this.cfg.view.showGraph) {
      const pts: THREE.Vector3[] = [];
      for (const n of lot.nodes) for (const m of n.neighbors) if (m > n.id) pts.push(new THREE.Vector3(n.x, 0.1, n.z), new THREE.Vector3(lot.nodes[m].x, 0.1, lot.nodes[m].z));
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x00ff88 })));
    }
  }

  // ---------- dynamic ----------

  setPreview(raw: Point[], route: Point[] | null, valid: boolean, kind: 'drive' | 'walk') {
    this.previewRaw.geometry.dispose();
    this.previewRaw.geometry = ribbonGeometry(raw, 0.35, 0.09);
    const rm = this.previewRoute.material as THREE.MeshBasicMaterial;
    this.previewRoute.geometry.dispose();
    if (kind === 'walk') {
      this.previewRoute.geometry = ribbonGeometry(raw, 0.5, 0.1);
      rm.color.set(this.cfg.colors.walkLine);
    } else {
      this.previewRoute.geometry = route && route.length > 1 ? ribbonGeometry(smoothCorners(route, 2.2), 1.1, 0.1) : new THREE.BufferGeometry();
      rm.color.set(valid ? this.cfg.colors.routeLine : this.cfg.colors.routeInvalid);
    }
  }

  clearPreview() {
    this.setPreview([], null, true, 'drive');
  }

  private makeCar(car: Car): CarView {
    const spec = bodyTypes[car.body];
    const paint = this.cfg.carPaints[car.paint] ?? '#888888';
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.5, metalness: 0.1 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(spec.length, spec.height, spec.width), bodyMat);
    body.position.y = spec.height / 2 + 0.15;
    body.castShadow = true;
    group.add(body);
    const cabinColor = new THREE.Color(paint).lerp(new THREE.Color('#1b2a38'), 0.55);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.cabinLength, spec.cabinHeight, spec.width * 0.86), new THREE.MeshStandardMaterial({ color: cabinColor, roughness: 0.3 }));
    cabin.position.set(spec.cabinOffset, spec.height + 0.15 + spec.cabinHeight / 2, 0);
    cabin.castShadow = true;
    group.add(cabin);
    const lights = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.25, spec.width * 0.8), new THREE.MeshBasicMaterial({ color: '#fff6c8' }));
    lights.position.set(spec.length / 2 + 0.02, spec.height / 2 + 0.2, 0);
    group.add(lights);
    if (car.rack) {
      const rack = new THREE.Mesh(new THREE.BoxGeometry(spec.cabinLength * 0.9, 0.12, spec.width * 0.95), new THREE.MeshStandardMaterial({ color: '#2a2a2a' }));
      rack.position.set(spec.cabinOffset, spec.height + 0.15 + spec.cabinHeight + 0.08, 0);
      group.add(rack);
      for (const side of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(spec.cabinLength * 0.95, 0.1, 0.12), new THREE.MeshStandardMaterial({ color: '#111111' }));
        bar.position.set(spec.cabinOffset, spec.height + 0.15 + spec.cabinHeight + 0.18, side * spec.width * 0.42);
        group.add(bar);
      }
    }
    const ringGeo = new THREE.RingGeometry(Math.max(spec.length, spec.width) * 0.62, Math.max(spec.length, spec.width) * 0.72, 40);
    const ringMat = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    const awaitRing = new THREE.Mesh(ringGeo, ringMat(this.cfg.colors.awaitingRing));
    awaitRing.rotation.x = -Math.PI / 2;
    awaitRing.position.y = 0.05;
    const requestedRing = new THREE.Mesh(ringGeo, ringMat(this.cfg.colors.requestedRing));
    requestedRing.rotation.x = -Math.PI / 2;
    requestedRing.position.y = 0.04;
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshBasicMaterial({ color: this.cfg.colors.waitingMarker }));
    marker.position.y = 3.2;
    const storeColor = this.cfg.stores[car.store]?.color ?? '#ffffff';
    const storeDot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20), new THREE.MeshBasicMaterial({ color: storeColor }));
    storeDot.position.set(spec.cabinOffset, spec.height + 0.15 + spec.cabinHeight + (car.rack ? 0.3 : 0.06), 0);
    group.add(storeDot);
    const view: CarView = { group, awaitRing, marker, requestedRing, storeDot };
    this.dynamicGroup.add(group, awaitRing, requestedRing, marker);
    return view;
  }

  private removeCar(id: number) {
    const v = this.cars.get(id);
    if (!v) return;
    this.dynamicGroup.remove(v.group, v.awaitRing, v.marker, v.requestedRing);
    this.cars.delete(id);
    const r = this.routeLines.get(id);
    if (r) { this.dynamicGroup.remove(r); this.routeLines.delete(id); }
  }

  valetColor(i: number): string {
    const list = Object.values(this.cfg.valetColors);
    return list.length ? list[i % list.length] : this.cfg.colors.valet;
  }

  private makeValet(i: number): ValetView {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.3, 16), new THREE.MeshStandardMaterial({ color: this.valetColor(i) }));
    torso.position.y = 0.8;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), new THREE.MeshStandardMaterial({ color: '#e8c39e' }));
    head.position.y = 1.75;
    head.castShadow = true;
    group.add(torso, head);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32), new THREE.MeshBasicMaterial({ color: this.cfg.colors.valetSelected, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    const path = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: this.cfg.colors.walkLine, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    this.dynamicGroup.add(group, path);
    return { group, ring, path };
  }

  sync(dt: number) {
    this.clock += dt;
    const w = this.world;
    for (const id of [...this.cars.keys()]) if (!w.cars.has(id)) this.removeCar(id);
    for (const car of w.cars.values()) {
      let v = this.cars.get(car.id);
      if (!v) { v = this.makeCar(car); this.cars.set(car.id, v); }
      v.group.position.set(car.x, 0, car.z);
      v.group.rotation.y = -car.heading;
      const awaiting = car.state === 'awaitingDrive';
      v.awaitRing.visible = awaiting;
      if (awaiting) {
        const s = 1 + Math.sin(this.clock * 6) * 0.06;
        v.awaitRing.scale.set(s, s, s);
        v.awaitRing.position.set(car.x, 0.05, car.z);
      }
      v.storeDot.visible = this.cfg.view.storeDotOnParked && (car.state === 'parked' || car.state === 'curbQueue' || car.state === 'driving');
      v.requestedRing.visible = this.cfg.view.highlightRequestedCars && car.requested && car.state === 'parked';
      v.requestedRing.position.set(car.x, 0.04, car.z);
      v.marker.visible = car.state === 'waitingDropoff' && car.claimedBy === null;
      if (v.marker.visible) {
        v.marker.position.set(car.x, 3.2 + Math.sin(this.clock * 4 + car.id) * 0.25, car.z);
        v.marker.rotation.y += dt * 2;
        const urgency = Math.min(1, car.curbWait / this.cfg.customers.dropoffPatience);
        (v.marker.material as THREE.MeshBasicMaterial).color.set(this.cfg.colors.waitingMarker).lerp(new THREE.Color(this.cfg.colors.routeInvalid), urgency);
      }

      // Remaining route for cars the player sent somewhere.
      let line = this.routeLines.get(car.id);
      if (car.state === 'driving') {
        if (!line) {
          line = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: this.cfg.colors.routeLine, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
          this.routeLines.set(car.id, line);
          this.dynamicGroup.add(line);
        }
        line.geometry.dispose();
        line.geometry = ribbonGeometry(smoothCorners([{ x: car.x, z: car.z }, ...car.route.slice(car.routeIdx)], 2.2), 0.8, 0.07);
      } else if (line) {
        this.dynamicGroup.remove(line);
        this.routeLines.delete(car.id);
      }
    }

    while (this.valets.length < w.valets.length) this.valets.push(this.makeValet(this.valets.length));
    w.valets.forEach((valet, i) => {
      const v = this.valets[i];
      v.group.visible = valet.state !== 'inCar';
      v.group.position.set(valet.x, 0, valet.z);
      const bob = valet.state === 'walking' || valet.state === 'returning' ? Math.abs(Math.sin(this.clock * 12)) * 0.12 : 0;
      v.group.children[0].position.y = 0.8 + bob;
      v.group.children[1].position.y = 1.75 + bob;
      const shake = valet.state === 'keyFail' ? Math.sin(this.clock * 40) * 0.12 : 0;
      v.group.position.x += shake;
      v.ring.visible = this.selectedValet === valet.id;
      v.path.geometry.dispose();
      if (valet.state === 'walking') v.path.geometry = ribbonGeometry([{ x: valet.x, z: valet.z }, ...valet.path.slice(valet.pathIdx)], 0.3, 0.08);
      else v.path.geometry = new THREE.BufferGeometry();
    });

    // Pending (tapped, waiting for a destination) car
    const pending = this.pendingCar !== null ? w.cars.get(this.pendingCar) : undefined;
    this.pendingRing.visible = !!pending;
    if (pending) {
      const s = 1 + Math.sin(this.clock * 8) * 0.05;
      this.pendingRing.scale.set(s, s, s);
      this.pendingRing.position.set(pending.x, 0.12, pending.z);
    }

    // Queued orders: faint route from each queued car to its spot, in its valet's color.
    const live = new Set<number>();
    const neutral = this.cfg.colors.pendingRing;
    const all: { o: { carId: number; dest: number }; color: string }[] = [
      ...w.valets.filter((v) => v.current && v.state !== 'inCar').map((v) => ({ o: v.current!, color: this.valetColor(v.id) })),
      ...w.orders.map((o) => ({ o, color: neutral })),
    ];
    {
      for (const { o, color } of all) {
        const car = w.cars.get(o.carId);
        if (!car) continue;
        live.add(o.carId);
        let m = this.orderLines.get(o.carId);
        if (!m) {
          m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
          this.orderLines.set(o.carId, m);
          this.dynamicGroup.add(m);
        }
        (m.material as THREE.MeshBasicMaterial).color.set(color);
        const nodes = shortestPath(w.lot, car.nodeId, o.dest);
        m.geometry.dispose();
        m.geometry = nodes ? ribbonGeometry(smoothCorners(nodes.map((id) => ({ x: w.lot.nodes[id].x, z: w.lot.nodes[id].z })), 2.2), 0.45, 0.065) : new THREE.BufferGeometry();
      }
    }
    for (const [id, m] of this.orderLines) if (!live.has(id)) { this.dynamicGroup.remove(m); m.geometry.dispose(); this.orderLines.delete(id); }

    this.renderer.render(this.scene, this.camera);
  }
}
