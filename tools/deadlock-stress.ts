// Deadlock stress test. Pass = every shift finishes (all customers served or lost) and the lot
// never sits with requests waiting while nothing moves for longer than STALL_LIMIT seconds.
// Usage: npm run stress
//
// Matrix: 1–4 valets × 1–3 curb spots × small/large lot × slow/fast/flood arrivals,
// played by three bots: tidy (sensible orders), chaotic (random spots, random curb spots,
// wrong cars, cancellations) and lazy (only acts every few seconds).
// Plus a scripted scenario: the curb is full of drop-offs while every valet brings a pickup.

import { applyCareer, newCareer, setupWorld } from '../src/career';
import { defaultConfig, type Config } from '../src/config';
import { World } from '../src/sim/world';

declare const process: { argv: string[]; exitCode?: number };

const DT = 1 / 30;
const STALL_LIMIT = 10;
const MAX_SIM = 1500;

type Bot = 'tidy' | 'chaotic' | 'lazy';

function rngFrom(seed: number) {
  let r = seed >>> 0 || 1;
  return () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function step(w: World, bot: Bot, rand: () => number) {
  const cars = [...w.cars.values()];
  const free = (n: { occupant: number | null }) => n.occupant === null;
  for (const car of cars) {
    if (w.isQueued(car) || car.claimedBy !== null) {
      if (bot === 'chaotic' && rand() < 0.002) w.cancelOrder(car);
      continue;
    }
    if (bot === 'lazy' && rand() < 0.97) continue;
    if (car.state === 'waitingDropoff') {
      const stalls = w.lot.stalls.map((id) => w.lot.nodes[id]).filter((n) => w.canQueueDest(car, n) && free(n));
      if (!stalls.length) continue;
      const dest = bot === 'chaotic' ? stalls[Math.floor(rand() * stalls.length)] : stalls[0];
      w.queueOrder(car, dest);
    } else if (car.state === 'parked') {
      const wantsIt = car.requested || (bot === 'chaotic' && rand() < 0.0005); // chaotic sometimes grabs a wrong car
      if (!wantsIt) continue;
      const curbs = w.lot.curbs.map((id) => w.lot.nodes[id]);
      const dest = bot === 'chaotic' ? curbs[Math.floor(rand() * curbs.length)] : curbs[0];
      w.queueOrder(car, dest);
    }
  }
}

interface Result { finished: boolean; worstStall: number; simTime: number; served: number; lost: number }

function runShift(cfg: Config, seed: number, bot: Bot, customers: number): Result {
  const career = newCareer();
  applyCareer(cfg, career);
  const w = new World(cfg, seed);
  setupWorld(w, cfg, career);
  w.maxArrivals = customers;
  const rand = rngFrom(seed * 7 + 3);
  let sim = 0, last = 0, worst = 0;
  while (!w.shiftOver && sim < MAX_SIM) {
    step(w, bot, rand);
    w.update(DT);
    sim += DT;
    // Only count requests that could be acted on: a pickup ticket, or a drop-off with a free stall.
    const freeStall = w.lot.stalls.some((id) => w.lot.nodes[id].occupant === null && w.lot.nodes[id].reservedFor === null);
    const waiting = w.tickets.size + (freeStall ? [...w.cars.values()].filter((c) => c.state === 'waitingDropoff').length : 0);
    const moving = [...w.cars.values()].some((c) => ['driving', 'arriving', 'leaving', 'handoff'].includes(c.state))
      || w.valets.some((v) => ['walking', 'boarding', 'keyFail', 'returning'].includes(v.state));
    if (waiting === 0 || moving) last = sim;
    worst = Math.max(worst, sim - last);
  }
  return { finished: w.shiftOver, worstStall: worst, simTime: sim, served: w.stats.served, lost: w.stats.lost };
}

function matrixConfig(valets: number, curb: number, lotLevel: number, spawn: number): Config {
  const cfg = structuredClone(defaultConfig);
  cfg.career.startValets = valets;
  cfg.career.startCurbSpots = curb;
  cfg.career.baseSpawnInterval = spawn;
  cfg.career.minSpawnInterval = spawn;
  const lv = cfg.career.lotLevels[lotLevel];
  cfg.career.lotLevels = [lv];
  return cfg;
}

let runs = 0, failures = 0, worstStall = 0;
const fails: string[] = [];
for (const valets of [1, 2, 3, 4]) {
  for (const curb of [1, 2, 3]) {
    for (const lotLevel of [0, 4]) {
      for (const spawn of [8, 4, 1.5]) {
        for (const bot of ['tidy', 'chaotic', 'lazy'] as Bot[]) {
          for (let seed = 1; seed <= 3; seed++) {
            const cfg = matrixConfig(valets, curb, lotLevel, spawn);
            const r = runShift(cfg, seed * 1000 + valets * 100 + curb * 10 + lotLevel, bot, 30);
            runs++;
            worstStall = Math.max(worstStall, r.worstStall);
            if (!r.finished || r.worstStall > STALL_LIMIT) {
              failures++;
              fails.push(`valets ${valets} curb ${curb} lot ${lotLevel} spawn ${spawn}s bot ${bot} seed ${seed}: ${r.finished ? 'finished' : 'DID NOT FINISH'} after ${r.simTime.toFixed(0)}s, worst stall ${r.worstStall.toFixed(1)}s, served ${r.served}, lost ${r.lost}`);
            }
          }
        }
      }
    }
  }
}

// Scripted: fill every curb spot with drop-offs, then have every valet fetch a pickup at once.
let scripted = 'n/a';
{
  const cfg = matrixConfig(3, 2, 0, 1000);
  cfg.career.lotLevels = [[4, 1]];
  const career = newCareer();
  applyCareer(cfg, career);
  cfg.traffic.startParked = 6;
  const w = new World(cfg, 77);
  setupWorld(w, cfg, career);
  w.maxArrivals = 2;
  // Force arrivals now, and make three parked cars request pickup.
  (w as any).spawnTimer = 0;
  for (let t = 0; t < 1; t += DT) w.update(DT);
  (w as any).spawnTimer = 0;
  let sim = 0;
  const parked = [...w.cars.values()].filter((c) => c.state === 'parked').slice(0, 3);
  for (const c of parked) c.stayLeft = 0;
  while (sim < 30) { w.update(DT); sim += DT; }
  const atCurb = [...w.cars.values()].filter((c) => c.state === 'waitingDropoff').length;
  for (const c of [...w.cars.values()].filter((c) => c.state === 'parked' && c.requested)) w.queueOrder(c, w.lot.nodes[w.lot.curbs[0]]);
  const servedBefore = w.stats.served;
  while (sim < 120) { w.update(DT); sim += DT; }
  scripted = `curb had ${atCurb}/2 drop-offs waiting (nobody parking them); all ${parked.length} pickups delivered within 90s: ${parked.every((c) => !w.cars.has(c.id) || c.state === 'leaving')}`;
  if (!parked.every((c) => !w.cars.has(c.id) || c.state === 'leaving')) failures++;
  void servedBefore;
}

console.log(`${runs} stress shifts (30 customers each) + 1 scripted curb-jam scenario`);
console.log(`worst "requests waiting, nothing moving" stretch: ${worstStall.toFixed(1)}s (limit ${STALL_LIMIT}s)`);
console.log(`scripted: ${scripted}`);
console.log(failures ? `FAILURES: ${failures}\n${fails.slice(0, 15).join('\n')}` : 'no deadlocks: every shift finished');
if (failures) process.exitCode = 1;
