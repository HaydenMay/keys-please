# Keys Please

A phone-first browser valet game: draw paths, find the right car from a customer's description, and park smart to keep a growing mall moving.

**Status:** experiment 1, a gray-box sandbox for testing whether directing valets and cars with a finger feels good. There's no economy, no progression and no art yet.

Play: https://haydenmay.github.io/keys-please/ (deployed automatically from `main`)

## How to play the sandbox

- **Drop-off:** a car with a yellow diamond is waiting at the curb. Send a valet to it, then drag from the car (blue ring) to an empty stall.
- **Pickup:** a ticket appears in the Pickups panel. Find that car, send a valet, then drag it to a free curb spot. The green spot is kept free for pickups. If you pick the wrong car, the keys don't fit.
- **Valet modes** (top button): in **Draw** mode you drag from a valet to a car; in **Tap** mode you tap a car and the nearest free valet goes. Comparing the two is the point of this experiment.
- **Tune** opens a panel with every number and color. Settings marked ↻ need a restart. **Save tuning** keeps your settings on that device.
- `?seed=123` in the URL replays a specific shift. Space pauses.

## What we're testing

| Experiment | Question | Status |
| --- | --- | --- |
| 1. Path drawing | Does directing valets and cars with a finger feel good? Tap vs. draw for valets? | **In this build** |
| 2. Prediction | Do ticket reasons (gym vs. steakhouse) make parking choices interesting? | Next |
| 3. Aisle stacking | Does blocking and unblocking cars create good decisions? | Later |
| 4. Rush | Does it all combine into fun pressure? | Later |

## Dev

```bash
npm install
npm run dev        # local server (use --host to open on your phone on the same Wi-Fi)
npm run sim        # headless bot-played shifts: catches stuck cars and prints rough numbers
npm run build
```

## Code layout

- `src/config.ts`: every tunable value and color
- `src/sim/`: the headless simulation (lot graph, routing, cars, valets, tickets). It has no three.js imports, so it can be tested without rendering.
- `src/render/`: the three.js top-down view, which only reads the sim
- `src/input.ts`: one-finger tap and draw gestures
- `src/ui.ts`: HUD, pickup tickets, toasts
- `tools/headless-sim.ts`: the bot player used by `npm run sim` and CI
