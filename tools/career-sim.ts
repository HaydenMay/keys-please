// Plays a career with a bot: smart parking, and after each shift buys the cheapest
// affordable upgrade(s). Prints how each shift went, to sanity-check the economy curve.
// Usage: npm run career-sim -- [shifts]

import { applyCareer, buy, newCareer, nextCost, setupWorld } from '../src/career';
import { defaultConfig } from '../src/config';
import { World } from '../src/sim/world';

declare const process: { argv: string[] };
const shifts = Number(process.argv[2] ?? 8);
const dt = 1 / 30;
const cfg = structuredClone(defaultConfig);
const career = newCareer();

for (let i = 0; i < shifts; i++) {
  applyCareer(cfg, career);
  const world = new World(cfg, 500 + i);
  setupWorld(world, cfg, career);
  let t = 0;
  while (!world.shiftOver && t < 1800) {
    for (const car of world.cars.values()) {
      if (world.isQueued(car) || car.claimedBy !== null) continue;
      if (car.state === 'waitingDropoff') {
        const free = world.lot.stalls.map((id) => world.lot.nodes[id]).filter((n) => world.canQueueDest(car, n));
        const st = world.storeOf(car);
        const long = (st.stayMin + st.stayMax) / 2 > 90;
        free.sort((a, b) => (a.z - b.z) * (long ? -1 : 1));
        if (free[0]) world.queueOrder(car, free[0]);
      } else if (car.state === 'parked' && car.requested) {
        world.queueOrder(car, world.lot.nodes[world.lot.curbs[0]]);
      }
    }
    world.update(dt);
    t += dt;
  }
  const s = world.stats;
  career.bank += s.earnings;
  const shift = career.shift;
  career.shift++;
  const bought: string[] = [];
  for (;;) {
    const options = Object.keys(cfg.career.upgrades)
      .map((id) => ({ id, cost: nextCost(cfg, career, id) }))
      .filter((o): o is { id: string; cost: number } => o.cost !== null && o.cost <= career.bank)
      .sort((a, b) => a.cost - b.cost);
    if (!options.length) break;
    buy(cfg, career, options[0].id);
    bought.push(options[0].id);
  }
  console.log(
    `shift ${shift}: ${world.maxArrivals} customers, ${(t / 60).toFixed(1)} min, earned $${s.earnings}, served ${s.served}, lost ${s.lost}, angry ${s.angry}` +
      ` | stalls ${cfg.lot.stallsPerRow * cfg.lot.rowPairs * 2}, valets ${cfg.valet.count}, curb ${cfg.lot.curbSpots}` +
      ` | bought ${bought.join(', ') || 'nothing'}, bank $${career.bank}`,
  );
}
