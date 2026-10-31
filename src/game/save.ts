/* ============================================================
   Progression + save data. Everything lives in localStorage — the
   game never talks to a server, so it works offline and keeps her
   collection private on the phone.
   ============================================================ */

import { RARITY, SPECIES, type Rarity, type Species } from './species';

const KEY = 'monsterhunt.save.v1';

export interface CaughtEntry {
  /** times caught */
  n: number;
  shiny: boolean;
  fav: boolean;
  level: number;
  cm: number;
  firstAt: number;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
  voice: boolean;
  roar: boolean;
  /** 1..3 */
  density: number;
  /** 0..2 walking detection */
  walk: number;
  /** 0..2 look-around speed */
  tilt: number;
  /** 0..2 throw assist */
  assist: number;
}

export interface SaveData {
  v: number;
  caught: Record<string, CaughtEntry>;
  seen: string[];
  xp: number;
  level: number;
  orbs: number;
  settings: Settings;
  stats: { throws: number; catches: number; bestStreak: number; newBest: number; steps: number };
  milestones: string[];
  startedAt: number;
  lastPlay: number;
  orbTimer: number;
}

/** Orb pouch limits. Generous on purpose: this is for a kid with a phone. */
export const ORB_MAX = 30;
const ORB_URGENT = 12;

export const RANKS = [
  'Tiny Scout',
  'Brave Tracker',
  'Monster Buddy',
  'Rumble Ranger',
  'Spark Keeper',
  'Cloud Captain',
  'Grotto Guardian',
  'Star Guardian',
  'Legend of the Living Room',
];

export function xpForLevel(level: number) {
  return 28 + level * 20;
}

export function rankFor(level: number) {
  return RANKS[Math.min(RANKS.length - 1, level - 1)];
}

const DEFAULT_SETTINGS: Settings = {
  sfx: true,
  music: true,
  voice: true,
  roar: false,
  density: 2,
  walk: 1,
  tilt: 1,
  assist: 2,
};

function fresh(): SaveData {
  return {
    v: 1,
    caught: {},
    seen: [],
    xp: 0,
    level: 1,
    orbs: 25,
    settings: { ...DEFAULT_SETTINGS },
    stats: { throws: 0, catches: 0, bestStreak: 0, newBest: 0, steps: 0 },
    milestones: [],
    startedAt: Date.now(),
    lastPlay: Date.now(),
    orbTimer: 0,
  };
}

const num = (v: unknown, fallback: number) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const KNOWN = new Set(SPECIES.map((s) => s.id));

/**
 * Repairs the caught map on the way in. A save that was written by an older
 * build, half-written when Mobile Safari killed the tab, or edited by a curious
 * grown-up must never print "undefined" on a seven-year-old's monster card, and
 * must never crash the album. Unknown ids are dropped, missing fields are filled.
 */
function fixCaught(raw: unknown): Record<string, CaughtEntry> {
  const out: Record<string, CaughtEntry> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KNOWN.has(id)) continue;
    const sp = SPECIES.find((s) => s.id === id)!;
    const o = (value && typeof value === 'object' ? value : { n: value }) as Partial<CaughtEntry>;
    out[id] = {
      n: Math.max(1, Math.round(num(o.n, 1))),
      shiny: !!o.shiny,
      fav: !!o.fav,
      level: Math.max(1, Math.round(num(o.level, 1))),
      cm: Math.max(1, Math.round(num(o.cm, sp.heightCm))),
      firstAt: Math.round(num(o.firstAt, Date.now())),
    };
  }
  return out;
}

export class Progress {
  data: SaveData;
  private dirtyTimer: number | null = null;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      const base = fresh();
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        stats: { ...base.stats, ...(parsed.stats ?? {}) },
        caught: fixCaught(parsed.caught),
        seen: (parsed.seen ?? []).filter((id) => KNOWN.has(id)),
        milestones: parsed.milestones ?? [],
        xp: Math.max(0, Math.round(num(parsed.xp, 0))),
        level: Math.max(1, Math.round(num(parsed.level, 1))),
        orbs: Math.max(0, Math.round(num(parsed.orbs, base.orbs))),
      };
    } catch {
      return fresh();
    }
  }

  save() {
    this.data.lastPlay = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* private mode / full storage: the game still plays, it just forgets */
    }
  }

  /** Coalesced save so we are not writing JSON every second. */
  saveSoon(dt = 0) {
    if (this.dirtyTimer !== null && dt > 0) return;
    if (this.dirtyTimer !== null) window.clearTimeout(this.dirtyTimer);
    this.dirtyTimer = window.setTimeout(() => {
      this.dirtyTimer = null;
      this.save();
    }, 900);
  }

  reset() {
    this.data = fresh();
    this.save();
  }

  // ------------------------------------------------------------ collection

  get ownedCount() {
    return Object.keys(this.data.caught).length;
  }

  get totalCount() {
    return SPECIES.length;
  }

  owns(id: string) {
    return !!this.data.caught[id];
  }

  entry(id: string) {
    return this.data.caught[id];
  }

  isFav(id: string) {
    return !!this.data.caught[id]?.fav;
  }

  toggleFav(id: string) {
    const e = this.data.caught[id];
    if (!e) return false;
    if (!e.fav) {
      for (const k of Object.keys(this.data.caught)) this.data.caught[k].fav = false;
    }
    e.fav = !e.fav;
    this.saveSoon();
    return e.fav;
  }

  markSeen(sp: Species) {
    if (!this.data.seen.includes(sp.id)) {
      this.data.seen.push(sp.id);
      this.saveSoon();
    }
  }

  /** Records a catch and returns what the player earned. */
  recordCatch(sp: Species, shiny: boolean, level: number, streak: number) {
    const d = this.data;
    const existing = d.caught[sp.id];
    const isNew = !existing;
    if (existing) {
      existing.n += 1;
      existing.shiny = existing.shiny || shiny;
      existing.level = Math.max(existing.level, level);
      existing.cm = Math.round((existing.cm + sp.heightCm * (shiny ? 1.14 : 1)) / 2);
    } else {
      d.caught[sp.id] = {
        n: 1,
        shiny,
        fav: Object.keys(d.caught).length === 0,
        level,
        cm: Math.round(sp.heightCm * (shiny ? 1.14 : 1)),
        firstAt: Date.now(),
      };
    }
    d.stats.catches += 1;
    d.stats.bestStreak = Math.max(d.stats.bestStreak, streak);
    if (isNew) d.stats.newBest += 1;

    const rarityXp = RARITY[sp.rarity as Rarity].xp;
    const gained = Math.round(rarityXp * (shiny ? 3 : 1) * (isNew ? 1.6 : 0.6) + streak * 3);
    const orbsBack = isNew ? 3 : 2;
    d.orbs = Math.min(60, d.orbs + orbsBack);
    d.xp += gained;

    let leveled = 0;
    while (d.xp >= xpForLevel(d.level)) {
      d.xp -= xpForLevel(d.level);
      d.level += 1;
      d.orbs = Math.min(60, d.orbs + 6);
      leveled = d.level;
    }
    this.save();
    return { isNew, gained, orbsBack, leveled };
  }

  spendOrb() {
    if (this.data.orbs <= 0) return false;
    this.data.orbs -= 1;
    this.data.stats.throws += 1;
    this.saveSoon();
    return true;
  }

  /**
   * Orbs trickle back so a kid never hits a dead end. The trickle speeds up
   * when the pouch is nearly empty, because an empty pouch in front of a
   * seven-year-old is a meltdown, not a game.
   */
  tickOrbs(dt: number) {
    const d = this.data;
    if (d.orbs >= ORB_MAX) {
      d.orbTimer = 0;
      return 0;
    }
    d.orbTimer += dt;
    if (d.orbTimer < (d.orbs <= ORB_URGENT ? 11 : 18)) return 0;
    d.orbTimer = 0;
    d.orbs += 1;
    this.saveSoon();
    return 1;
  }

  /** Rough "how long until the next orb", for honest messaging. */
  secondsToNextOrb() {
    const d = this.data;
    if (d.orbs >= ORB_MAX) return 0;
    return Math.max(0, Math.ceil((d.orbs <= ORB_URGENT ? 11 : 18) - d.orbTimer));
  }

  addStep() {
    this.data.stats.steps += 1;
  }

  /** Bonus orb for a dead-on throw. */
  addOrbs(n: number) {
    this.data.orbs = Math.min(60, this.data.orbs + n);
    this.saveSoon();
  }

  // ------------------------------------------------------------ rewards

  /** Unclaimed milestone rewards, in display order. */
  pendingMilestone(): { id: string; text: string } | null {
    const owned = this.ownedCount;
    const goals: { at: number; id: string; text: string }[] = [
      { at: 1, id: 'first', text: 'First friend! +10 Capture Orbs' },
      { at: 3, id: 'three', text: 'Three friends! Golden Orbs unlocked' },
      { at: 6, id: 'six', text: 'Six friends! You can call monsters to you' },
      { at: 10, id: 'ten', text: 'Ten friends! The Roar gets stronger' },
      { at: this.totalCount, id: 'all', text: 'ALL OF THEM! You are a Star Guardian' },
    ];
    for (const g of goals) {
      if (owned >= g.at && !this.data.milestones.includes(g.id)) {
        this.data.milestones.push(g.id);
        if (g.id === 'first' || g.id === 'ten') this.data.orbs = Math.min(60, this.data.orbs + 10);
        this.save();
        return { id: g.id, text: g.text };
      }
    }
    return null;
  }

  /** True once she has caught enough to unlock the "call me here" button. */
  get canSummon() {
    return this.ownedCount >= 6;
  }

  get luckyShinyOdds() {
    // every 10 throws with no shiny nudges the odds up a little
    return 1 / Math.max(14, 46 - this.data.level * 2);
  }
}
