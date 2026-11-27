// Career mode: a run of shifts. Money earned in a shift is banked and spent on fixed,
// always-available upgrades between shifts. No randomness in what's offered.

import type { Config } from './config';
import type { World } from './sim/world';

export interface CareerState {
  shift: number;
  bank: number;
  levels: Record<string, number>;
}

const KEY = 'keys-please.career.v1';

export function newCareer(): CareerState {
  return { shift: 1, bank: 0, levels: {} };
}

export function loadCareer(): CareerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (typeof s.shift === 'number' && typeof s.bank === 'number') return { shift: s.shift, bank: s.bank, levels: s.levels ?? {} };
    }
  } catch {
    /* storage unavailable */
  }
  return newCareer();
}

export function saveCareer(state: CareerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function level(state: CareerState, id: string): number {
  return state.levels[id] ?? 0;
}

/** Next price for an upgrade, or null when it's maxed out. */
export function nextCost(cfg: Config, state: CareerState, id: string): number | null {
  const up = cfg.career.upgrades[id];
  if (!up) return null;
  const lv = level(state, id);
  if (id === 'lot') {
    // Lot levels are capped by how many layouts exist.
    if (lv >= cfg.career.lotLevels.length - 1) return null;
  }
  return lv < up.costs.length ? up.costs[lv] : null;
}

export function buy(cfg: Config, state: CareerState, id: string): boolean {
  const cost = nextCost(cfg, state, id);
  if (cost === null || state.bank < cost) return false;
  state.bank -= cost;
  state.levels[id] = level(state, id) + 1;
  saveCareer(state);
  return true;
}

export function customersThisShift(cfg: Config, state: CareerState): number {
  return Math.max(1, Math.round(cfg.career.baseCustomers + cfg.career.customersPerShift * (state.shift - 1)));
}

/** Write the career's lot, valets and pacing into the live config before a shift starts. */
export function applyCareer(cfg: Config, state: CareerState) {
  const C = cfg.career;
  const lotLv = Math.min(level(state, 'lot'), C.lotLevels.length - 1);
  const [perRow, pairs] = C.lotLevels[lotLv];
  cfg.lot.stallsPerRow = perRow;
  cfg.lot.rowPairs = pairs;
  cfg.lot.curbSpots = C.startCurbSpots + level(state, 'curb');
  cfg.lot.pickupOnlySpots = 0;
  cfg.valet.count = C.startValets + level(state, 'valet');
  cfg.traffic.spawnInterval = Math.max(C.minSpawnInterval, C.baseSpawnInterval - C.spawnIntervalStep * (state.shift - 1));
  cfg.traffic.startParked = 0;
}

/** Per-world settings that aren't plain config (shift length, shoe speed). */
export function setupWorld(world: World, cfg: Config, state: CareerState) {
  world.maxArrivals = customersThisShift(cfg, state);
  world.walkMultiplier = 1 + 0.15 * level(state, 'shoes');
}

/** Short "what you have now" text for the shop. */
export function currentLevelText(cfg: Config, state: CareerState, id: string): string {
  switch (id) {
    case 'valet': { const n = cfg.career.startValets + level(state, 'valet'); return `${n} valet${n === 1 ? '' : 's'}`; }
    case 'lot': {
      const [a, b] = cfg.career.lotLevels[Math.min(level(state, 'lot'), cfg.career.lotLevels.length - 1)];
      return `${a * b * 2} stalls`;
    }
    case 'curb': return `${cfg.career.startCurbSpots + level(state, 'curb')} curb spots`;
    case 'shoes': return `+${15 * level(state, 'shoes')}% speed`;
    default: return `level ${level(state, id)}`;
  }
}
