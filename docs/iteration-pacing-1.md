# Pacing iteration 1

This iteration responds to the "Gameplay Findings & Next Prototype Iteration" brief. It makes four changes: shorter shifts, the deadlock fix, the pickup-ticket overflow fix, and an economy retune. The numbers below are experiments, not final balance.

## Summary

| Measure (avg of 8 seeded careers × 6 shifts) | Before | After |
| --- | --- | --- |
| Real time per shift | 211–286 s | 124–161 s |
| Total time for 6 shifts | 25.4 min | 14.2 min |
| Upgrades bought in 6 shifts | 8.1 | 7.9 |
| Upgrades per minute played | 0.32 | 0.56 |
| Average open requests | 1.1–1.4 | 2.0–2.8 |
| Peak open requests | 4.6–6.0 | 5.3–9.1 |
| Shifts with a deadlock / stall | 0 | 0 (stress test: 0 of 648) |

Shifts are about 45% shorter and busier. Upgrades come at the same rate per shift, which makes them almost twice as frequent per minute. The 90–120 s target was **not fully reached**: shifts land at about 2–2.7 min. See "Open questions" for why and what the options are.

## 1. What changed and why

### Pacing (all in `src/config.ts`)

| Value | Before | After | Why |
| --- | --- | --- | --- |
| Gym stay | 20–40 s | 10–20 s | Brief: start with ~50% shorter stays |
| Diner stay | 45–80 s | 22–40 s | ″ |
| Steakhouse stay | 110–170 s | 55–85 s | ″ (still clearly long) |
| Movie stay | 140–200 s | 70–100 s | ″ (still the longest) |
| `career.baseCustomers` | 12 | 8 | One valet can't serve 12 customers in ~2 min at unchanged speed |
| `career.customersPerShift` | +3 | +2 | Keeps later shifts from growing longer faster than capacity |
| `career.baseSpawnInterval` | 14 s | 7.5 s | More overlap between arrivals and departures, less dead start |
| `career.spawnIntervalStep` | 1 s | 0.5 s | Gentler ramp from a faster base |
| `career.minSpawnInterval` | 5 s | 3 s | Room for later shifts with 3+ valets |
| `career.closingMin/Max` | 8–40 s | 3–10 s | Shorter tail once the last customer is parked |

**Left unchanged, as the brief asked:** valet walk and drive speeds, every patience value, key and boarding times, and the 4× idle fast-forward. Each store's relative length is kept: Gym < Diner < Steakhouse < Movie.

### Economy (retuned so shorter shifts don't slow progression)

| Value | Before | After |
| --- | --- | --- |
| `economy.parkingRatePerMinute` | $2 | $4 (stays are half as long) |
| Hire a valet | $180 / 450 / 900 | $100 / 260 / 520 |
| Expand the lot | $120 / 250 / 450 / 700 | $80 / 160 / 280 / 420 |
| Widen the curb | $150 / 300 / 500 | $90 / 180 / 300 |
| Running shoes | $80 / 160 / 300 | $60 / 120 / 200 |

Revenue per shift fell by roughly 35–40%, and prices fell by about the same, so upgrades still come at about 1.3 per shift. The second valet now arrives around shift 2 instead of shift 3.

### Deadlock fix

The **original curb deadlock** happened when valets sat in pickup cars waiting for a curb spot while every spot was taken by drop-offs that only a valet could move. It was fixed in commit `d7cabac`:

- arrivals may only take a curb spot if more spots are free than there are pickups heading for the curb;
- a pickup stuck in the curb lane for `customers.laneHandoffAfter` (4 s) is handed over right there, which frees the valet;
- drivers waiting on the street give up after `customers.streetPatience` (30 s), so the street queue can't grow forever.

A **second, smaller jam** turned up while building this iteration. If a queued car's target stall was taken before the valet got in, the valet sat in the car showing "drag the car somewhere", which a Queue-mode player wouldn't think to do. The valet now drives to the free stall nearest the planned one. If the lot is full, they wait in the car and retry each tick. (`World.autoDrive`, `Car.retryOrder`.)

**How it was verified:** `npm run stress` runs 648 thirty-customer shifts, plus one scripted scenario.

- The matrix covers 1–4 valets × 1–3 curb spots × an 8-stall or 32-stall lot × arrivals every 8 s, 4 s or 1.5 s.
- Three bots play it:
  - **tidy:** sensible orders.
  - **chaotic:** random stalls and curb spots, wrong cars, random cancellations.
  - **lazy:** acts rarely.
- **Pass** means every shift finishes (all customers served or lost), and requests that could be acted on never wait more than 10 s with nothing moving.
- **Result:** every shift finished. The worst stretch was 5.9 s, which is the 4 s lane-handoff timer working as intended.
- **The scripted jam:** the curb is full of drop-offs that nobody parks while three valets bring pickups. All three pickups are delivered.
- **Capacity vs. jam:** when the lot is truly full, drop-offs wait at the curb until a car leaves. That's counted as capacity pressure, not a deadlock.

### Pickup ticket overflow

- **Portrait:** tickets are now a wrapping grid under the lot (up to 34% of screen height) instead of a single row that ran off the right edge.
- **Both orientations:**
  - tickets are more compact (the store name replaces the redundant "PICKUP ·" label);
  - the header shows a count, e.g. "Pickups (7)";
  - a "▼ N more" hint appears whenever any ticket is scrolled out of view;
  - the most urgent tickets are always on top.
- **Tested** with 7 simultaneous pickups at 375×667 portrait and 667×375 landscape. Every ticket is either fully visible or flagged by the hint.

## 2. Test method

- `npm run pacing -- 6 8` plays 8 seeded careers of 6 shifts each, once with the old values and once with the new. Both use the **same seeds**.
- The bot is human-paced. It makes one decision (a car plus a spot) every 1.5 s, and it buys upgrades in a fixed order: valet → lot → curb → shoes.
- "Real time" counts fast-forwarded stretches at their sped-up rate, so it's the time a player actually spends.
- "Nothing to decide" means every request is already queued or being handled.
- "Longest stall" means a request you could act on is waiting and nothing is moving.

### Before

| Shift | Real time | Nothing to decide | Customers | Lost | Angry | Earned | Avg / peak requests | Valets busy | Upgrades | Valets / stalls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 211 s | 90% | 12 | 0.0 | 0.5 | $188 | 1.3 / 4.6 | 69% | 1.0 | 1.0 / 8 |
| 2 | 232 s | 83% | 15 | 0.4 | 0.6 | $256 | 1.3 / 4.9 | 57% | 1.9 | 1.6 / 10 |
| 3 | 243 s | 87% | 18 | 0.0 | 0.0 | $318 | 1.1 / 4.8 | 50% | 1.5 | 2.0 / 12 |
| 4 | 272 s | 86% | 21 | 0.0 | 0.0 | $358 | 1.4 / 5.4 | 58% | 1.5 | 2.0 / 16 |
| 5 | 286 s | 85% | 24 | 0.0 | 0.0 | $432 | 1.4 / 5.8 | 60% | 1.0 | 2.1 / 16 |
| 6 | 283 s | 83% | 27 | 0.0 | 0.0 | $496 | 1.4 / 6.0 | 48% | 1.3 | 3.0 / 17 |

### After

| Shift | Real time | Nothing to decide | Customers | Lost | Angry | Earned | Avg / peak requests | Valets busy | Upgrades | Valets / stalls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 133 s | 90% | 8 | 0.0 | 0.6 | $119 | 2.0 / 5.3 | 89% | 1.0 | 1.0 / 8 |
| 2 | 124 s | 82% | 10 | 0.3 | 0.4 | $146 | 2.0 / 6.1 | 71% | 1.8 | 1.8 / 9 |
| 3 | 138 s | 82% | 12 | 0.0 | 0.3 | $185 | 2.1 / 7.1 | 74% | 1.3 | 1.9 / 12 |
| 4 | 150 s | 82% | 14 | 0.0 | 0.4 | $222 | 2.4 / 7.5 | 79% | 1.3 | 2.0 / 16 |
| 5 | 149 s | 75% | 16 | 0.0 | 0.8 | $252 | 2.8 / 9.1 | 71% | 1.1 | 2.6 / 16 |
| 6 | 161 s | 78% | 18 | 0.1 | 0.1 | $297 | 2.6 / 8.0 | 74% | 1.5 | 2.6 / 20 |

**Caveat:** a bot that decides every 1.5 s and never forgets a car is a strong player. Real players will lose more customers and pick more wrong cars, and the playtest is the real judge. The bot also makes zero identification mistakes, so the memory and organization side of the game isn't measured here at all.

## 3. Findings

1. **Shifts are valet-bound.** In shift 1 the single valet is busy 89% of the time. At unchanged valet speed, one valet serves roughly 4 customers a minute, so a 90–120 s shift-1 can only hold 6–8 customers. That's why shifts land at 2–2.7 min, not 1.5–2.
2. **"Nothing to decide" is 75–90% in both versions.** This is the important design signal. Queue mode lets a player clear every decision in a couple of seconds and then watch the valets work. Shorter shifts make that watching shorter, but they don't change its share of the shift. Requests now pile up about twice as much (average 2–2.8 open vs 1.1–1.4), so there's more to juggle when decisions do come.
3. **Difficulty is gentle for an attentive player.** Losses stay near zero for the bot. Pressure comes from bursts: peak open requests reach 9 by shift 5. That fits the brief's guidance not to make it overwhelming, but the early shifts may still feel easy for a real player.
4. **Progression held up.** It's still about 1.3 upgrades per shift, and the second valet comes a shift earlier.

## 4. Open questions for the next playtest

- **Hitting 90–120 s:** pick one of these, then playtest.
  - (a) `baseCustomers` 6. This keeps everything else and makes the first shift tiny.
  - (b) Valet `walkSpeed` +20%. That's the system the brief asked to hold constant for now.
  - (c) Start with 2 valets. This changes the "1 valet" opening you asked for.
- **Decisions per minute:** if the playtest confirms "set orders, then watch," a few levers could help. These are ideas, not built:
  - a smaller `valet.maxPendingOrders` (e.g. 2–3), so you can't pre-plan everything;
  - customers whose plans change ("actually, I'll be quick");
  - pickups that only show the description once the customer reaches the desk.
- **Is the closing rush still needed** at 3–10 s, or is it now short enough to drop?

## 5. Upgrade ideas (proposed, not built)

These follow the brief's rule that upgrades should make the game more interesting, not just easier. Each one changes *how* you operate:

| Idea | Category | What changes for the player |
| --- | --- | --- |
| **Key board** | Organization | Parked cars show their store-color dot only after you buy this. It turns the existing debug-ish roof dot into an earned tool, so early shifts rely on memory. |
| **Express curb spot** | Infrastructure | One curb spot only for pickups, the old `pickupOnlySpots` idea. It trades drop-off capacity for reliable pickups, so it's a real choice. |
| **Waiting bench** | Customer service | +25% pickup patience, but only for customers at the curb, not while they're still inside. It pairs with curb management. |
| **Head valet** | Employees | Lets you set one valet to auto-handle pickups (or drop-offs). It frees you for the other job, but you give up control. Big change; test carefully. |

I'd start with **Key board** and **Express curb spot**. Both reuse systems that already exist.

## 6. How to re-run

```bash
npm run pacing -- 6 8              # before/after comparison, same seeds
npm run pacing -- 6 8 --after-only # just the current config
npm run stress                     # deadlock matrix + scripted curb jam
npm run career-sim -- 10           # one bot career, shift by shift
```
