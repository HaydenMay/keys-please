// Runs shifts with simple bot players and no rendering, to catch stuck states and
// check whether smart parking actually beats careless parking.
// Usage: npm run sim -- [shifts] [secondsPerShift] [spawnInterval]

import { defaultConfig } from '../src/config';
import { shortestPath } from '../src/sim/graph';
import { World, type Car } from '../src/sim/world';

declare const process: { argv: string[]; exitCode?: number };

const shifts = Number(process.argv[2] ?? 20);
const seconds = Number(process.argv[3] ?? 300);
const spawnOverride = process.argv[4] ? Number(process.argv[4]) : null;
const dt = 1 / 30;

type Strategy = 'random' | 'smart';

function run(strategy: Strategy) {
  const totals = { earnings: 0, tips: 0, fees: 0, served: 0, lost: 0, wrongKeys: 0, angry: 0, stuck: 0 };
  for (let s = 0; s < shifts; s++) {
    const cfg = structuredClone(defaultConfig);
    if (spawnOverride) cfg.traffic.spawnInterval = spawnOverride;
    const world = new World(cfg, 1000 + s);
    const stuckTimers = new Map<number, number>();
    let r = 12345 + s;
    const rand = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;

    // Driving distance from the curb lane to each stall, to rank stalls near → far.
    const entryLane = world.lot.nodes[world.lot.curbs[0]].neighbors[0];
    const dist = new Map<number, number>();
    for (const id of world.lot.stalls) {
      const path = shortestPath(world.lot, entryLane, id)!;
      let d = 0;
      for (let i = 1; i < path.length; i++) {
        const a = world.lot.nodes[path[i - 1]];
        const b = world.lot.nodes[path[i]];
        d += Math.hypot(b.x - a.x, b.z - a.z);
      }
      dist.set(id, d);
    }
    const chooseStall = (car: Car) => {
      const free = world.lot.stalls.map((id) => world.lot.nodes[id]).filter((n) => world.canQueueDest(car, n));
      if (!free.length) return undefined;
      if (strategy === 'random') return free[Math.floor(rand() * free.length)];
      // Smart: short visits near the curb, long visits deep in the lot.
      const st = world.storeOf(car);
      const longStay = (st.stayMin + st.stayMax) / 2 > 90;
      free.sort((a, b) => (dist.get(a.id)! - dist.get(b.id)!) * (longStay ? -1 : 1));
      return free[0];
    };

    for (let t = 0; t < seconds; t += dt) {
      for (const car of world.cars.values()) {
        if (world.isQueued(car) || car.claimedBy !== null) continue;
        if (car.state === 'waitingDropoff') {
          const dest = chooseStall(car);
          if (dest) world.queueOrder(car, dest);
        } else if (car.state === 'parked' && car.requested) {
          world.queueOrder(car, world.lot.nodes[world.lot.curbs[0]]);
        }
      }
      world.update(dt);
      for (const car of world.cars.values()) {
        if (car.state === 'driving' || car.state === 'arriving' || car.state === 'leaving') {
          const prev = stuckTimers.get(car.id) ?? 0;
          stuckTimers.set(car.id, car.blockedBy !== null ? prev + dt : 0);
          if (prev > 15) { totals.stuck++; stuckTimers.set(car.id, -1e9); }
        }
      }
    }
    if (world.orders.length && world.valets.some((v) => v.state === 'idle')) totals.stuck++;
    for (const k of Object.keys(world.stats) as (keyof typeof world.stats)[]) totals[k] += world.stats[k];
  }
  const per = (n: number) => (n / shifts).toFixed(1);
  console.log(
    `${strategy.padEnd(6)} earned/shift $${per(totals.earnings)} (tips $${per(totals.tips)} + parking $${per(totals.fees)})  served ${per(totals.served)}  lost ${per(totals.lost)}  angry ${per(totals.angry)}  stuck ${totals.stuck}`,
  );
  return totals.stuck;
}

console.log(`${shifts} shifts × ${seconds}s, queue-mode bot${spawnOverride ? `, spawn every ${spawnOverride}s` : ''}`);
const stuck = run('random') + run('smart');
if (stuck > 0) process.exitCode = 1;
