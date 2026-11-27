import GUI from 'lil-gui';
import './style.css';
import { clearSavedConfig, defaultConfig, loadConfig, saveConfig } from './config';
import { InputController } from './input';
import { LotRenderer } from './render/renderer';
import { randomSeed } from './sim/rng';
import { World } from './sim/world';
import { Hud } from './ui';

const cfg = loadConfig();
const stage = document.getElementById('stage')!;

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || randomSeed();

let world = new World(cfg, seed);
let view = new LotRenderer(stage, world, cfg);
const hud = new Hud(cfg, () => world, () => view, { restart: () => restart(true), tune: () => toggleGui() });
const toast = hud.toast.bind(hud);
new InputController(stage, () => world, () => view, cfg, toast);
world.on((e) => toast(e.text, e.tone, e.x !== undefined ? { x: e.x, z: e.z! } : undefined));

function restart(newSeed: boolean) {
  if (newSeed) seed = randomSeed();
  view.dispose();
  world = new World(cfg, seed);
  view = new LotRenderer(stage, world, cfg);
  world.on((e) => toast(e.text, e.tone, e.x !== undefined ? { x: e.x, z: e.z! } : undefined));
  hud.reset();
}

new ResizeObserver(() => view.resize()).observe(stage);

// Debug handle for the console and automated play tests.
(window as any).kp = { get world() { return world; }, get view() { return view; }, cfg };

// ---------- tuning panel ----------
const gui = new GUI({ title: 'Tuning' });
gui.hide();
function toggleGui() {
  if (gui._hidden) gui.show();
  else gui.hide();
}
const ranges: Record<string, [number, number, number]> = {
  timeScale: [0.1, 4, 0.1], snapRadius: [0.5, 8, 0.1], destSnapRadius: [1, 10, 0.1], pickRadius: [1, 6, 0.1], destTapRadius: [1, 8, 0.1], maxPendingOrders: [1, 15, 1], minDragDistance: [0, 4, 0.1],
  count: [1, 5, 1], walkSpeed: [1, 15, 0.5], boardTime: [0, 3, 0.1], keyFailTime: [0, 5, 0.1], returnDelay: [0, 15, 0.5],
  driveSpeed: [2, 25, 0.5], reverseSpeed: [1, 15, 0.5], turnRate: [1, 30, 0.5], yieldDistance: [1, 12, 0.5], yieldTimeout: [0.5, 10, 0.5], arrivalSpeed: [2, 25, 0.5],
  spawnInterval: [2, 40, 0.5], spawnJitter: [0, 15, 0.5], startParked: [0, 30, 1],
  pickupPatience: [5, 180, 5], dropoffPatience: [5, 180, 5], streetPatience: [5, 180, 5], maxTip: [0, 100, 1], minTip: [0, 50, 1], handoffTime: [0, 5, 0.1], laneHandoffAfter: [0, 30, 0.5],
  stallsPerRow: [2, 16, 1], rowPairs: [1, 3, 1], stallWidth: [2.4, 4, 0.1], stallDepth: [4.5, 7, 0.1], aisleWidth: [5, 10, 0.5], sideLaneWidth: [5, 10, 0.5], curbSpots: [1, 6, 1], pickupOnlySpots: [0, 3, 1],
  padding: [0, 6, 0.5], stayMin: [5, 400, 5], stayMax: [5, 600, 5], weight: [0, 10, 0.5], tipMultiplier: [0, 4, 0.1], parkingRatePerMinute: [0, 20, 0.5],
};
const needsRestart = new Set(['count', 'startParked', 'stallsPerRow', 'rowPairs', 'stallWidth', 'stallDepth', 'aisleWidth', 'sideLaneWidth', 'curbSpots', 'pickupOnlySpots']);

function addFolder(parent: GUI, name: string, obj: Record<string, any>) {
  const folder = parent.addFolder(name);
  folder.close();
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'object' && val !== null) { addFolder(folder, key, val); continue; }
    let ctrl;
    if (name === 'colors' || name === 'carPaints' || name === 'valetColors' || key === 'color') ctrl = folder.addColor(obj, key);
    else if (key === 'valetMode') ctrl = folder.add(obj, key, ['queue', 'tap', 'draw']);
    else if (typeof val === 'number' && ranges[key]) ctrl = folder.add(obj, key, ...ranges[key]);
    else ctrl = folder.add(obj, key);
    if (needsRestart.has(key)) ctrl.name(`${key} ↻`);
    ctrl.onFinishChange(() => {
      if (name === 'colors' || name === 'carPaints' || name === 'valetColors' || key === 'color' || key === 'showGraph') view.rebuildStatic();
      if (name === 'view') view.resize();
      if (key === 'valetMode') hud.refreshMode();
    });
  }
}
for (const [name, obj] of Object.entries(cfg)) addFolder(gui, name, obj as Record<string, any>);
const actions = {
  'Restart (same seed) ↻': () => restart(false),
  'Restart (new seed)': () => restart(true),
  'Save tuning': () => toast(saveConfig(cfg) ? 'Tuning saved on this device' : "Couldn't save here", 'info'),
  'Reset to defaults': () => {
    clearSavedConfig();
    const fresh = structuredClone(defaultConfig);
    for (const k of Object.keys(fresh) as (keyof typeof fresh)[]) Object.assign(cfg[k], fresh[k]);
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    hud.refreshMode();
    restart(false);
  },
};
for (const k of Object.keys(actions) as (keyof typeof actions)[]) gui.add(actions, k);

// ---------- loop ----------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!hud.paused) {
    acc += dt * cfg.sim.timeScale;
    while (acc >= STEP) { world.update(STEP); acc -= STEP; }
  }
  view.sync(hud.paused ? 0 : dt);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
