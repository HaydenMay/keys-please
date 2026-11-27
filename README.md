# Keys Please

A phone-first browser valet game: draw paths, find the right car from a customer's description, and park smart to keep a growing mall moving.

**Status:** experiment 1, a gray-box sandbox for testing whether directing valets and cars with a finger feels good. There's no economy, no progression and no art yet.

Play: https://haydenmay.github.io/keys-please/ (deployed automatically from `main`)

## How to play the sandbox

- **Career (default):** you start with 8 stalls, 2 curb spots and 1 valet. A shift ends once every customer has arrived and left. Your earnings go into the bank, and you spend them in a shop with fixed upgrades: hire a valet, expand the lot, widen the curb, running shoes. Each shift brings more customers, arriving faster. Progress saves on the device; use Tune → New career to start over. Set `career.enabled` off for the old endless sandbox.

- **Drop-off:** a car with a yellow diamond is waiting at the curb. Its label shows the reason for the visit and an estimated stay (Gym ~20–40s, Diner ~45–80s, Steakhouse ~2–3 min, Movie ~2–3 min; all tunable under `stores`). Quick visits belong near the curb and long ones deep in the lot. Parked cars get a store-colored roof dot, which you can turn off to make it a memory test.
- **Earnings** = tip + parking fee ($2 per minute parked). Tips shrink the longer a pickup waits and are scaled by store, so steakhouse customers tip best.
- **Pickup:** a ticket appears in the Pickups panel. Find that car and send it to the curb. If you pick the wrong car, the keys don't fit.
- **Queue mode (default):** tap a car, then tap where it should go. That adds a numbered order to one shared list, and the nearest free valet takes the next order. A car being worked on shows an arrow badge in that valet's color. Tap a queued car to cancel its order. After a job, valets wait a couple of seconds, then walk back to the desk if nothing's queued.
- **Curb:** any curb spot works for a pickup, even a busy one. If every spot is taken, the valet pulls into the curb lane and waits. After a few seconds, the customer walks out to the car there instead. New arrivals can't take a curb spot that an incoming pickup needs, so they wait on the street, and they give up after 30s.
- **Other valet modes** (top button): **Tap** sends the nearest valet but you drag the car yourself; **Draw** means you drag everything.
- **Tune** opens a panel with every number and color. Settings marked ↻ need a restart. **Save tuning** keeps your settings on that device.
- `?seed=123` in the URL replays a specific shift. Space pauses.

## What we're testing

| Experiment | Question | Status |
| --- | --- | --- |
| 1. Controls | Does directing valets and cars feel good? Queue vs. tap vs. draw? | **In this build** |
| 2. Prediction | Do ticket reasons (gym vs. steakhouse) make parking choices interesting? | **In this build** |
| 3. Aisle stacking | Does blocking and unblocking cars create good decisions? | Later |
| 4. Rush | Does it all combine into fun pressure? | Later |

## Dev

```bash
npm install
npm run dev        # local server (use --host to open on your phone on the same Wi-Fi)
npm run sim        # headless bot shifts: random vs. smart parking, catches stuck cars
npm run sim -- 20 300 4 2 # stress: 20 shifts, 300s each, an arrival every 4s, only 2 curb spots
npm run career-sim -- 10  # bot plays a 10-shift career, buying the cheapest upgrades
npm run build
```

## Code layout

- `src/config.ts`: every tunable value and color
- `src/sim/`: the headless simulation (lot graph, routing, cars, valets, tickets). It has no three.js imports, so it can be tested without rendering.
- `src/render/`: the three.js top-down view, which only reads the sim
- `src/input.ts`: one-finger tap and draw gestures
- `src/ui.ts`: HUD, pickup tickets, toasts
- `tools/headless-sim.ts`: the bot player used by `npm run sim` and CI
