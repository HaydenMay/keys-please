// Runs shifts with a simple bot player and no rendering, to catch stuck states and
// sanity-check the numbers. Usage: npm run sim -- [shifts] [secondsPerShift]

import { defaultConfig } from '../src/config';
import { World } from '../src/sim/world';

declare const process: { argv: string[]; exitCode?: number };

const shifts = Number(process.argv[2] ?? 20);
const seconds = Number(process.argv[3] ?? 300);
const dt = 1 / 30;

let totals = { tips: 0, served: 0, lost: 0, wrongKeys: 0, angry: 0, stuck: 0 };

for (let s = 0; s < shifts; s++) {
  const cfg = structuredClone(defaultConfig);
  const world = new World(cfg, 1000 + s);
  const stuckTimers = new Map<number, number>();

  for (let t = 0; t < seconds; t += dt) {
    // Bot: send free valets to curb drop-offs first, then requested pickups.
    for (const v of world.valets) {
      if (v.state !== 'idle') continue;
      const jobs = [...world.cars.values()].filter(
        (c) => c.claimedBy === null && (c.state === 'waitingDropoff' || (c.state === 'parked' && c.requested)),
      );
      const job = jobs[0];
      if (job) world.assignValet(v, job);
    }
    // Bot: drive any car waiting for orders to the nearest legal spot.
    for (const car of world.cars.values()) {
      if (car.state !== 'awaitingDrive') continue;
      const targets = car.requested ? world.lot.curbs : world.lot.stalls;
      const free = targets.map((id) => world.lot.nodes[id]).filter((n) => n.occupant === null && n.id !== car.nodeId);
      if (!free.length) continue;
      const dest = free[Math.floor(free.length / 2)];
      const plan = world.planDrive(car, [{ x: car.x, z: car.z }, { x: dest.x, z: dest.z }]);
      if (plan.valid) world.commitDrive(car, plan);
    }
    world.update(dt);

    // Detect cars that stop moving while in a moving state.
    for (const car of world.cars.values()) {
      if (car.state === 'driving' || car.state === 'arriving' || car.state === 'leaving') {
        const key = car.id;
        const prev = stuckTimers.get(key) ?? 0;
        stuckTimers.set(key, car.blockedBy !== null ? prev + dt : 0);
        if (prev > 15) { totals.stuck++; stuckTimers.set(key, -1e9); }
      }
    }
  }
  for (const k of Object.keys(world.stats) as (keyof typeof world.stats)[]) totals[k] += world.stats[k];
}

const per = (n: number) => (n / shifts).toFixed(1);
console.log(`${shifts} shifts × ${seconds}s (bot player)`);
console.log(`served/shift ${per(totals.served)}  tips/shift $${per(totals.tips)}  lost/shift ${per(totals.lost)}  angry/shift ${per(totals.angry)}  wrongKeys ${totals.wrongKeys}  stuck cars ${totals.stuck}`);
if (totals.stuck > 0) process.exitCode = 1;
