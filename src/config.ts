// Every tunable number and color for the sandbox lives here.
// The in-game Tuning panel edits this object live; "Save" stores it in localStorage.
// Values marked (restart) only take effect after pressing Restart.

export const defaultConfig = {
  sim: {
    /** 1 = real time. Lower to study a rush in slow motion, raise to fast-forward. */
    timeScale: 1,
  },
  controls: {
    /**
     * 'queue' = tap a car, then tap where it goes: that's one numbered order. Tap a queued car to cancel it.
     * 'draw'  = drag a path from a valet to a car, then drag the car to a spot.
     * 'tap'   = tap a car (nearest free valet runs there), then drag the car to a spot.
     */
    valetMode: 'queue' as 'queue' | 'draw' | 'tap',
    /** In queue mode, how close a tap must be to an empty stall or curb spot to pick it. */
    destTapRadius: 3.2,
    /** How close (world units) a drawn line must pass to a lane node to snap onto it. */
    snapRadius: 3.2,
    /** How close the end of a drive line must be to a stall/curb spot to target it. */
    destSnapRadius: 4.5,
    /** How close a touch must be to grab a car or valet. */
    pickRadius: 2.6,
    /** Shorter drags than this count as a tap. */
    minDragDistance: 0.8,
  },
  valet: {
    count: 2, // (restart)
    walkSpeed: 5.5,
    boardTime: 0.5,
    keyFailTime: 1.4,
    /** When a valet runs out of orders, walk back to the desk after waiting returnDelay seconds. */
    autoReturnToDesk: true,
    returnDelay: 2.5,
    /** Queue mode: max orders waiting for a free valet. */
    maxPendingOrders: 6,
  },
  car: {
    driveSpeed: 9,
    reverseSpeed: 4.5,
    turnRate: 9,
    yieldDistance: 5.5,
    yieldTimeout: 2.5,
    arrivalSpeed: 10,
  },
  traffic: {
    /** Average seconds between arrivals. */
    spawnInterval: 10,
    spawnJitter: 4,
    startParked: 4, // (restart)
  },
  customers: {
    pickupPatience: 45,
    dropoffPatience: 40,
    /** How long an arriving driver waits on the street for a curb spot before leaving. */
    streetPatience: 30,
    maxTip: 20,
    minTip: 2,
    handoffTime: 0.8,
    /** If every curb spot stays busy this long, the customer walks out to their car in the curb lane. */
    laneHandoffAfter: 4,
  },
  lot: {
    stallsPerRow: 8, // (restart)
    rowPairs: 2, // (restart) each pair = two stall rows sharing one aisle
    stallWidth: 3, // (restart)
    stallDepth: 5.5, // (restart)
    aisleWidth: 7, // (restart)
    sideLaneWidth: 7, // (restart)
    curbSpots: 3, // (restart)
    /** Curb spots (from the exit end) that arrivals never use, so pickups always have somewhere to go. */
    pickupOnlySpots: 0, // (restart)
  },
  view: {
    /** In a portrait window, rotate the lot so its long side runs vertically. */
    rotateInPortrait: true,
    padding: 1.5,
    /** Debug: ring the car a pickup ticket belongs to (turn off to test identification). */
    highlightRequestedCars: false,
    /** Small store-colored dot on parked cars' roofs (off = you have to remember). */
    storeDotOnParked: true,
    /** Store label + stay estimate over cars waiting at the curb. */
    storeLabelAtCurb: true,
    showGraph: false,
  },
  colors: {
    background: '#1f2228',
    asphalt: '#4a4f57',
    stallLine: '#d8d8d0',
    laneMark: '#c9b458',
    sidewalk: '#9a9a94',
    mall: '#c7b8a3',
    mallDoor: '#8fc3d9',
    desk: '#6b4f3a',
    curbSpot: '#5d6a7a',
    pickupSpot: '#4f7a5f',
    valet: '#d9473f',
    valetSelected: '#ffffff',
    rawLine: '#ffffff',
    routeLine: '#5ad1ff',
    routeInvalid: '#ff5a5a',
    walkLine: '#ffd166',
    awaitingRing: '#5ad1ff',
    waitingMarker: '#ffd166',
    requestedRing: '#ff4fd8',
    pendingRing: '#ffffff',
  },
  /**
   * Why customers come. Stay times are in seconds; the ticket shows the min–max range as the estimate.
   * weight = how often this store's customers show up. tipMultiplier scales their tips.
   */
  stores: {
    Gym: { stayMin: 20, stayMax: 40, weight: 3, tipMultiplier: 0.7, color: '#4fc3f7' },
    Diner: { stayMin: 45, stayMax: 80, weight: 3, tipMultiplier: 1, color: '#ffb74d' },
    Steakhouse: { stayMin: 110, stayMax: 170, weight: 2, tipMultiplier: 1.6, color: '#e57373' },
    Movie: { stayMin: 140, stayMax: 200, weight: 2, tipMultiplier: 1.1, color: '#ba68c8' },
  } as Record<string, { stayMin: number; stayMax: number; weight: number; tipMultiplier: number; color: string }>,
  economy: {
    /** Parking fee in $ per minute a car spends parked. */
    parkingRatePerMinute: 2,
  },
  /** One color per valet; their order badges use the same color. */
  valetColors: {
    valet1: '#d9473f',
    valet2: '#3f8fd9',
    valet3: '#e0a030',
    valet4: '#9b59b6',
    valet5: '#2eb872',
  } as Record<string, string>,
  /** Car paint names shown on tickets, and their colors. */
  carPaints: {
    Red: '#d64541',
    Blue: '#3a7bd5',
    Green: '#3fa34d',
    Yellow: '#f2c230',
    White: '#f1f1ee',
    Black: '#222226',
    Orange: '#ee7d2b',
    Purple: '#8e5cc2',
    Silver: '#a9b0b8',
  } as Record<string, string>,
};

export type Config = typeof defaultConfig;

export type BodyType = 'sedan' | 'SUV' | 'pickup' | 'hatchback' | 'van';

/** Footprint and silhouette per body type (length along the car's forward axis). */
export const bodyTypes: Record<BodyType, { length: number; width: number; height: number; cabinLength: number; cabinHeight: number; cabinOffset: number }> = {
  sedan: { length: 4.4, width: 1.8, height: 0.8, cabinLength: 2.2, cabinHeight: 0.55, cabinOffset: -0.2 },
  SUV: { length: 4.7, width: 2.0, height: 1.1, cabinLength: 2.9, cabinHeight: 0.6, cabinOffset: -0.3 },
  pickup: { length: 5.2, width: 2.0, height: 1.0, cabinLength: 1.7, cabinHeight: 0.65, cabinOffset: 0.6 },
  hatchback: { length: 3.8, width: 1.75, height: 0.85, cabinLength: 2.0, cabinHeight: 0.55, cabinOffset: -0.5 },
  van: { length: 5.0, width: 2.0, height: 1.4, cabinLength: 3.8, cabinHeight: 0.45, cabinOffset: -0.4 },
};

const STORAGE_KEY = 'keys-please.config.v1';

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof base !== 'object' || base === null || typeof patch !== 'object' || patch === null) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...(base as any) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const cur = out[k];
    if (typeof cur === 'object' && cur !== null) out[k] = deepMerge(cur, v);
    else if (typeof v === typeof cur) out[k] = v;
  }
  return out;
}

export function loadConfig(): Config {
  const fresh = structuredClone(defaultConfig);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return deepMerge(fresh, JSON.parse(raw));
  } catch {
    /* storage unavailable: use defaults */
  }
  return fresh;
}

export function saveConfig(cfg: Config): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
