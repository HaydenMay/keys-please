// Pacing report: plays the same seeded careers under two configs ("before" = the previous
// pacing values, "after" = current defaults) with a human-paced bot, and prints per-shift metrics.
// Usage: npm run pacing -- [shifts] [careers]
//
// The bot is not a perfect player: it only acts every `think` seconds and makes one tap pair
// (car → spot) per decision, which is closer to a person on a phone than an instant bot.

import { applyCareer, buy, newCareer, nextCost, setupWorld } from '../src/career';
import { defaultConfig, type Config } from '../src/config';
import { World } from '../src/sim/world';

declare const process: { argv: string[]; exitCode?: number };

const SHIFTS = Number(process.argv[2] ?? 6);
const CAREERS = Number(process.argv[3] ?? 5);
const DT = 1 / 30;

/** Pacing values before this iteration (commit 6e3e032), applied on top of current defaults. */
function beforeConfig(): Config {
  const c = structuredClone(defaultConfig);
  c.stores.Gym.stayMin = 20; c.stores.Gym.stayMax = 40;
  c.stores.Diner.stayMin = 45; c.stores.Diner.stayMax = 80;
  c.stores.Steakhouse.stayMin = 110; c.stores.Steakhouse.stayMax = 170;
  c.stores.Movie.stayMin = 140; c.stores.Movie.stayMax = 200;
  Object.assign(c.career, { baseCustomers: 12, customersPerShift: 3, baseSpawnInterval: 14, spawnIntervalStep: 1, minSpawnInterval: 5, closingMin: 8, closingMax: 40 });
  c.economy.parkingRatePerMinute = 2;
  c.career.upgrades.valet.costs = [180, 450, 900];
  c.career.upgrades.lot.costs = [120, 250, 450, 700];
  c.career.upgrades.curb.costs = [150, 300, 500];
  c.career.upgrades.shoes.costs = [80, 160, 300];
  return c;
}

interface ShiftResult {
  realSec: number;
  idleSec: number;
  noDecisionSec: number;
  customers: number;
  served: number;
  lost: number;
  angry: number;
  wrongKeys: number;
  earnings: number;
  avgRequests: number;
  peakRequests: number;
  utilization: number;
  longestStallSec: number;
  bought: number;
  valets: number;
  stalls: number;
}

const BUY_ORDER = ['valet', 'lot', 'curb', 'shoes'];

function playCareer(cfg: Config, seedBase: number, think: number): ShiftResult[] {
  const career = newCareer();
  const out: ShiftResult[] = [];
  for (let i = 0; i < SHIFTS; i++) {
    applyCareer(cfg, career);
    const w = new World(cfg, seedBase + i);
    setupWorld(w, cfg, career);
    let real = 0, idle = 0, noDecision = 0, sim = 0, reqSum = 0, reqPeak = 0, busy = 0, nextThink = 0;
    let lastProgress = 0, served = 0, longest = 0;
    while (!w.shiftOver && sim < 1800) {
      if (sim >= nextThink) {
        nextThink = sim + think;
        // One decision: oldest pickup first (if found), else oldest drop-off.
        const cars = [...w.cars.values()].filter((c) => !w.isQueued(c) && c.claimedBy === null);
        const pickup = cars.find((c) => c.state === 'parked' && c.requested);
        const drop = cars.find((c) => c.state === 'waitingDropoff');
        if (pickup) w.queueOrder(pickup, w.lot.nodes[w.lot.curbs[0]]);
        else if (drop) {
          const free = w.lot.stalls.map((id) => w.lot.nodes[id]).filter((n) => w.canQueueDest(drop, n));
          const st = w.storeOf(drop);
          const long = (st.stayMin + st.stayMax) / 2 > (cfg.stores.Diner.stayMax + cfg.stores.Steakhouse.stayMin) / 2;
          free.sort((a, b) => (a.z - b.z) * (long ? -1 : 1));
          if (free[0]) w.queueOrder(drop, free[0]);
        }
      }
      const ff = w.idle ? Math.max(1, cfg.career.idleFastForward) : 1;
      const requests = w.tickets.size + [...w.cars.values()].filter((c) => c.state === 'waitingDropoff').length + w.streetQueue.length;
      w.update(DT);
      sim += DT;
      real += DT / ff;
      if (w.idle) idle += DT / ff;
      const decisions = [...w.cars.values()].some((c) => !w.isQueued(c) && c.claimedBy === null && (c.state === 'waitingDropoff' || (c.state === 'parked' && c.requested)));
      if (!decisions) noDecision += DT / ff;
      reqSum += requests * (DT / ff);
      reqPeak = Math.max(reqPeak, requests);
      busy += w.valets.filter((v) => v.state !== 'idle' && v.state !== 'returning').length / w.valets.length * DT;
      // A stall = requests are waiting but nothing is moving: no car driving and no valet walking.
      const moving = [...w.cars.values()].some((c) => c.state === 'driving' || c.state === 'arriving' || c.state === 'leaving' || c.state === 'handoff')
        || w.valets.some((v) => v.state === 'walking' || v.state === 'boarding' || v.state === 'keyFail');
      if (w.stats.served !== served) { served = w.stats.served; lastProgress = sim; }
      // Only actionable requests count (a pickup ticket, or a drop-off with a free stall); a full lot is capacity, not a jam.
      const freeStall = w.lot.stalls.some((id) => w.lot.nodes[id].occupant === null && w.lot.nodes[id].reservedFor === null);
      const actionable = w.tickets.size + (freeStall ? [...w.cars.values()].filter((c) => c.state === 'waitingDropoff').length : 0);
      if (actionable === 0 || moving) lastProgress = sim;
      longest = Math.max(longest, sim - lastProgress);
    }
    const s = w.stats;
    career.bank += s.earnings;
    career.shift++;
    let bought = 0;
    for (let guard = 0; guard < 10; guard++) {
      const id = BUY_ORDER.find((u) => { const c = nextCost(cfg, career, u); return c !== null && c <= career.bank; });
      if (!id || !buy(cfg, career, id)) break;
      bought++;
    }
    out.push({
      realSec: real, idleSec: idle, noDecisionSec: noDecision, customers: w.maxArrivals ?? 0, served: s.served, lost: s.lost, angry: s.angry, wrongKeys: s.wrongKeys,
      earnings: s.earnings, avgRequests: reqSum / Math.max(1e-6, real), peakRequests: reqPeak, utilization: busy / Math.max(1e-6, sim),
      longestStallSec: longest, bought, valets: cfg.valet.count, stalls: cfg.lot.stallsPerRow * cfg.lot.rowPairs * 2,
    });
  }
  return out;
}

function report(name: string, mk: () => Config, think: number) {
  const runs: ShiftResult[][] = [];
  for (let c = 0; c < CAREERS; c++) runs.push(playCareer(mk(), 9000 + c * 100, think));
  console.log(`\n${name}  (${CAREERS} careers × ${SHIFTS} shifts, bot thinks every ${think}s)`);
  console.log('shift | real time | idle | nothing to decide | customers | served | lost | angry | earned | avg/peak requests | valet busy | longest stall | upgrades | valets/stalls');
  let totalReal = 0, totalBought = 0, deadlocks = 0;
  for (let i = 0; i < SHIFTS; i++) {
    const r = runs.map((x) => x[i]);
    const avg = (f: (x: ShiftResult) => number) => r.reduce((a, x) => a + f(x), 0) / r.length;
    totalReal += avg((x) => x.realSec);
    totalBought += avg((x) => x.bought);
    deadlocks += r.filter((x) => x.longestStallSec > 10).length;
    console.log(
      `${String(i + 1).padStart(5)} | ${avg((x) => x.realSec).toFixed(0).padStart(7)}s | ${(100 * avg((x) => x.idleSec / x.realSec)).toFixed(0).padStart(3)}% | ${(100 * avg((x) => x.noDecisionSec / x.realSec)).toFixed(0).padStart(16)}% | ${avg((x) => x.customers).toFixed(0).padStart(9)} | ${avg((x) => x.served).toFixed(1).padStart(6)} | ${avg((x) => x.lost).toFixed(1).padStart(4)} | ${avg((x) => x.angry).toFixed(1).padStart(5)} | $${avg((x) => x.earnings).toFixed(0).padStart(5)} | ${avg((x) => x.avgRequests).toFixed(1).padStart(8)} / ${avg((x) => x.peakRequests).toFixed(1).padEnd(6)} | ${(100 * avg((x) => x.utilization)).toFixed(0).padStart(9)}% | ${Math.max(...r.map((x) => x.longestStallSec)).toFixed(0).padStart(12)}s | ${avg((x) => x.bought).toFixed(1).padStart(8)} | ${avg((x) => x.valets).toFixed(1)}/${avg((x) => x.stalls).toFixed(0)}`,
    );
  }
  console.log(`total real time ${(totalReal / 60).toFixed(1)} min, upgrades bought ${totalBought.toFixed(1)}, shifts where requests waited >10s with nothing moving: ${deadlocks}`);
  return deadlocks;
}

let bad = 0;
for (const think of [1.5]) {
  if (!process.argv.includes('--after-only')) bad += report('BEFORE', beforeConfig, think);
  bad += report('AFTER ', () => structuredClone(defaultConfig), think);
}
if (bad > 0) process.exitCode = 1;
