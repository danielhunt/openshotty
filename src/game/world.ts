/* ============================================================
   The world: who is hiding where, who needs to respawn, and what
   appears when she roars. Monsters are always placed ahead of her
   so walking actually leads somewhere.
   ============================================================ */

import * as THREE from 'three';
import { Monster, type MonsterHooks } from './monster';
import { pickSpecies, SPECIES, SPECIES_BY_ID, type Species } from './species';
import type { Progress } from './save';

export interface WorldHooks extends MonsterHooks {
  onSpawned(m: Monster): void;
  onRemoved(m: Monster, reason: 'escaped' | 'caught' | 'far'): void;
  fxPuff(pos: THREE.Vector3, color: string): void;
}

const MAX_LIVE = 6;
const FAR = 17;

export class World {
  monsters: Monster[] = [];
  private queue: { at: number; speciesId?: string; shiny?: boolean }[] = [];
  private uid = 1;
  private spawnCool = 0;
  private tmp = new THREE.Vector3();
  private forwardTmp = new THREE.Vector3();
  private toTmp = new THREE.Vector3();
  private probeFor = { pos: new THREE.Vector3(), lookScore: 0, dist: 0 };
  private lastPlayer = new THREE.Vector3();
  private headTmp = new THREE.Vector3();
  private lastHeading = 0;
  private energy = 0;
  private everSpawned = false;

  constructor(private scene: THREE.Scene, private progress: Progress) {}

  private get density() {
    const table = [2, 3, 5] as const;
    return table[this.progress.data.settings.density - 1];
  }

  /** Point in the horizontal direction the phone is facing. */
  private heading(camQuat: THREE.Quaternion, out: THREE.Vector3) {
    return out.set(0, 0, -1).applyQuaternion(camQuat).setY(0).normalize();
  }

  /** A friendly spot on the floor ahead of the player. */
  private spotAhead(camQuat: THREE.Quaternion, player: THREE.Vector3, min: number, max: number, arc = 1.15, out = new THREE.Vector3()) {
    const h = this.heading(camQuat, this.tmp);
    const base = Math.atan2(h.x, h.z);
    const ang = base + (Math.random() - 0.5) * arc * 2;
    const d = min + Math.random() * (max - min);
    return out.set(player.x + Math.sin(ang) * d, 0, player.z + Math.cos(ang) * d);
  }

  private makeMonster(species: Species, shiny: boolean, pos: THREE.Vector3) {
    const level = 1 + Math.floor(Math.random() * (2 + this.progress.data.level));
    const m = new Monster(species, shiny, level, pos, this.uid++);
    this.scene.add(m.creature.root);
    this.monsters.push(m);
    return m;
  }

  rollShiny(species: Species) {
    const base = this.progress.luckyShinyOdds;
    const boost = species.rarity === 'legend' ? 4 : species.rarity === 'epic' ? 2 : 1;
    return Math.random() < base * boost;
  }

  /** How keen she is right now: walking and sweeping the phone around pulls
   *  monsters in sooner and closer, which quietly rewards exploring. */
  private eagerness() {
    return Math.max(0, Math.min(1, this.energy));
  }

  private senseEnergy(dt: number, player: THREE.Vector3, camQuat: THREE.Quaternion) {
    if (dt <= 0) return;
    const walk = Math.min(1, player.distanceTo(this.lastPlayer) / dt / 1.6);
    this.lastPlayer.copy(player);

    const head = this.heading(camQuat, this.headTmp);
    let turn = Math.abs(Math.atan2(head.x, head.z) - this.lastHeading);
    turn = Math.min(turn, Math.PI * 2 - turn);
    this.lastHeading = Math.atan2(head.x, head.z);
    const sweep = Math.min(1, turn / dt / 1.4);

    const want = Math.max(walk, sweep * 0.75);
    this.energy += (want - this.energy) * Math.min(1, dt * 0.8);
  }

  /** Called every frame: keeps the right number of monsters hiding nearby. */
  update(dt: number, time: number, player: THREE.Vector3, camQuat: THREE.Quaternion, camPos: THREE.Vector3, hooks: WorldHooks) {
    this.spawnCool -= dt;
    this.senseEnergy(dt, player, camQuat);
    const keen = this.eagerness();

    // recycle monsters that walked out of the play area
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      const dist = Math.hypot(m.pos.x - player.x, m.pos.z - player.z);
      if (dist > FAR || (m.escaped && m.finishPoof())) {
        this.remove(m, m.escaped ? 'escaped' : 'far', hooks);
        continue;
      }
      if (m.state === 'poofed') {
        m.update(dt, time, this.probeFor, hooks);
        continue;
      }
      if (m.state === 'captured') continue;

      // how visible is it to her right now?
      const dx = m.pos.x - camPos.x;
      const dy = m.pos.y + m.creature.height * 0.6 - camPos.y;
      const dz = m.pos.z - camPos.z;
      const d = Math.max(0.001, Math.hypot(dx, dy, dz));
      const fwd = this.forwardTmp.set(0, 0, -1).applyQuaternion(camQuat);
      const to = this.toTmp.set(dx / d, dy / d, dz / d);
      const probe = this.probeFor;
      probe.pos.copy(player);
      probe.dist = Math.hypot(dx, dz);
      probe.lookScore = fwd.dot(to);
      m.update(dt, time, probe, hooks);
    }

    // respawn queue
    const now = performance.now() / 1000;
    while (this.queue.length && this.queue[0].at <= now && this.monsters.length < Math.min(MAX_LIVE, this.density)) {
      const item = this.queue.shift()!;
      // the very first monster appears straight ahead and close: she has to see
      // it within a couple of seconds or the magic never lands
      const first = !this.everSpawned;
      const pos = first
        ? this.spotAhead(camQuat, player, 1.9, 2.9, 0.2)
        : this.spotAhead(camQuat, player, Math.max(1.5, 2.0 - keen), 5.4 - keen * 1.8);
      const species = item.speciesId ? this.byId(item.speciesId) : first ? this.chooseCommon() : this.chooseSpecies();
      if (!species) continue;
      const shiny = item.shiny ?? this.rollShiny(species);
      const m = this.makeMonster(species, shiny, pos);
      this.everSpawned = true;
      hooks.onSpawned(m);
      break;
    }

    // top up the area
    if (this.monsters.length < Math.min(MAX_LIVE, this.density) && !this.queue.length && this.spawnCool <= 0) {
      this.queue.push({ at: now + (1.6 + Math.random() * 3.4) * (1 - keen * 0.5) });
      this.spawnCool = (4 + Math.random() * 4) * (1 - keen * 0.35);
    }

    // Never leave an empty room. She may have just closed the album or wiped her
    // save, and an empty room in a game about finding monsters reads as broken.
    // Something appears in front of her inside a second.
    if (!this.monsters.length && !this.queue.length) {
      this.queue.push({ at: now + 0.8 });
      this.spawnCool = 0;
    }
  }

  private chooseSpecies(): Species {
    return pickSpecies({
      allowSeen: true,
      seen: this.progress.data.seen,
      luck: 1 + this.progress.data.level * 0.06,
    });
  }

  private byId(id: string): Species | undefined {
    return SPECIES_BY_ID[id];
  }

  /** First-visit friendly: an easy, common monster. */
  private chooseCommon(): Species {
    const pool = SPECIES.filter((s) => s.rarity === 'common');
    return pool[Math.floor(Math.random() * pool.length)] ?? SPECIES[0];
  }

  /** Remove one and schedule a replacement. */
  remove(m: Monster, reason: 'escaped' | 'caught' | 'far', hooks: WorldHooks) {
    const i = this.monsters.indexOf(m);
    if (i >= 0) this.monsters.splice(i, 1);
    this.scene.remove(m.creature.root);
    hooks.onRemoved(m, reason);
    const now = performance.now() / 1000;
    const wait = reason === 'caught' ? 5 + Math.random() * 6 : reason === 'escaped' ? 7 + Math.random() * 8 : 3 + Math.random() * 4;
    this.queue.push({ at: now + wait });
    this.queue.sort((a, b) => a.at - b.at);
  }

  /** Roar / "call me here": a monster shows up close and personal. */
  summon(camQuat: THREE.Quaternion, player: THREE.Vector3, hooks: WorldHooks, speciesId?: string) {
    if (this.monsters.length >= MAX_LIVE) {
      const oldest = this.monsters.find((m) => m.state !== 'captured');
      if (oldest) this.remove(oldest, 'far', hooks);
    }
    // Dead ahead and close: she asked to see this one, so it shows up where she
    // is already looking rather than behind the sofa.
    const pos = this.spotAhead(camQuat, player, 1.7, 3.1, 0.2);
    const species = (speciesId && this.byId(speciesId)) || this.chooseSpecies();
    const shiny = this.rollShiny(species);
    const m = this.makeMonster(species, shiny, pos);
    hooks.onSpawned(m);
    return m;
  }

  /** Closest monster, used for the hint text and haptics. */
  nearest(player: THREE.Vector3) {
    let best: Monster | null = null;
    let bd = Infinity;
    for (const m of this.monsters) {
      if (m.state === 'captured' || m.state === 'poofed') continue;
      const d = Math.hypot(m.pos.x - player.x, m.pos.z - player.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return { monster: best, dist: bd };
  }

  clear() {
    for (const m of this.monsters) this.scene.remove(m.creature.root);
    this.monsters = [];
    this.queue = [];
    this.everSpawned = false;
    this.spawnCool = 0;
    this.energy = 0;
  }

  /**
   * Called the moment she steps into the room. Puts one guaranteed-easy monster
   * on the clock almost immediately: the whole promise of the app is "there is
   * a creature in my house", and that has to be true within about two seconds.
   */
  begin() {
    this.clear();
    this.queue.push({ at: performance.now() / 1000 + 0.6 });
  }
}
