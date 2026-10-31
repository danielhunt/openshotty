/* ============================================================
   Monster behaviour + animation. Everything is procedural:
   breathing, blinking, hopping, tail wags, shying away.
   ============================================================ */

import * as THREE from 'three';
import { buildCreature, type Creature } from './build';
import type { Species } from './species';
import { ELEMENTS } from './species';

export type MonsterState = 'spawn' | 'idle' | 'walk' | 'flee' | 'approach' | 'poofed' | 'captured';

export interface PlayerProbe {
  pos: THREE.Vector3;
  /** dot(cameraForward, dirToMonster) — 1 means she is looking straight at it */
  lookScore: number;
  /** metres */
  dist: number;
}

export interface MonsterHooks {
  call(monster: Monster): void;
  puff(monster: Monster): void;
  sparkle(monster: Monster): void;
}

const WOBBLE_SLOTS = new Set(['float', 'tail', 'earL', 'earR', 'armL', 'armR', 'legL', 'legR', 'wingL', 'wingR', 'tentA', 'tentB', 'tentC', 'tentD']);

export class Monster {
  readonly species: Species;
  readonly shiny: boolean;
  readonly level: number;
  readonly creature: Creature;
  readonly uid: number;

  pos = new THREE.Vector3();
  yaw = 0;
  state: MonsterState = 'spawn';
  /** set when it ran away and should come back later */
  escaped = false;
  spiedAt = 0;
  seenThisSession = false;

  private home = new THREE.Vector3();
  private target = new THREE.Vector3();
  private timer = 0;
  private phase = Math.random() * 100;
  private walkSpeed = 0;
  private blinkAt = 1.5 + Math.random() * 4;
  private blink = 0;
  private callAt = 1 + Math.random() * 6;
  private spawnT = 0;
  private poofT = 0;
  private spotGlow = 0;
  private bobSeed = Math.random() * 10;
  /** The scale the builder authored the creature at; animation multiplies onto it. */
  private baseScale = 1;
  private slotPhase = new Map<string, number>();
  private tmp = new THREE.Vector3();

  constructor(species: Species, shiny: boolean, level: number, pos: THREE.Vector3, uid: number) {
    this.species = species;
    this.shiny = shiny;
    this.level = level;
    this.uid = uid;
    this.pos.copy(pos);
    this.home.copy(pos);
    this.target.copy(pos);
    this.creature = buildCreature(species, shiny);
    this.creature.root.position.copy(pos);
    this.baseScale = this.creature.root.scale.x || 1;
    this.yaw = Math.random() * Math.PI * 2;
    for (const name of this.creature.slots.keys()) this.slotPhase.set(name, Math.random() * 6.28);
  }

  get radius() {
    return this.creature.radius;
  }

  get center(): THREE.Vector3 {
    return this.tmp.set(this.pos.x, this.pos.y + this.creature.height * 0.55 + this.species.behaviour.hover, this.pos.z).clone();
  }

  get hover() {
    return this.species.behaviour.hover;
  }

  /** Pop-in when it appears, shrink-out when it is captured. */
  private scaleCurve(): number {
    if (this.state === 'spawn') {
      const t = Math.min(1, this.spawnT / 0.55);
      return t < 0.7 ? (t / 0.7) * 1.16 : 1.16 - ((t - 0.7) / 0.3) * 0.16;
    }
    if (this.state === 'poofed') return Math.max(0, 1 - this.poofT / 0.35);
    return 1;
  }

  update(dt: number, time: number, probe: PlayerProbe, hooks: MonsterHooks) {
    const b = this.species.behaviour;
    this.timer -= dt;

    switch (this.state) {
      case 'spawn':
        this.spawnT += dt;
        if (this.spawnT > 0.55) this.state = 'idle';
        break;

      case 'poofed':
        this.poofT += dt;
        break;

      case 'captured':
        break;

      default: {
        // ---------------- decide what to do next
        if (this.timer <= 0) {
          const r = Math.random();
          if (this.state === 'flee') {
            this.state = 'idle';
            this.timer = 0.6 + Math.random();
          } else if (probe.dist < b.shy * 0.72 && r < 0.75) {
            this.state = 'flee';
            this.timer = 1.1 + Math.random() * 0.8;
            this.pickTarget(false);
          } else if (r < 0.22 + b.energy * 0.3) {
            this.state = 'walk';
            this.timer = 1.2 + Math.random() * 2.2;
            this.pickTarget(true);
          } else if (r < 0.34 && probe.dist > 1.6 && probe.dist < 6 && probe.lookScore > 0.9) {
            // it notices her looking and comes over to say hello
            this.state = 'approach';
            this.timer = 1.4 + Math.random() * 1.4;
            this.target.copy(probe.pos);
          } else {
            this.state = 'idle';
            this.timer = 0.8 + Math.random() * 2.4;
          }
        }

        // ---------------- move
        const moveTo = this.state === 'walk' ? this.target : this.state === 'flee' ? this.target : this.state === 'approach' ? this.target : null;
        let speed = 0;
        if (moveTo) {
          const dx = moveTo.x - this.pos.x;
          const dz = moveTo.z - this.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.06) {
            const base = 0.24 + b.energy * 0.4;
            speed = this.state === 'flee' ? base * 3.1 : this.state === 'approach' ? base * 1.5 : base;
            const step = Math.min(speed * dt, d);
            this.pos.x += (dx / d) * step;
            this.pos.z += (dz / d) * step;
            this.faceTo(this.tmp.set(moveTo.x, 0, moveTo.z), dt, 6);
          } else if (this.state === 'walk') {
            this.state = 'idle';
            this.timer = 0.6 + Math.random() * 1.6;
          } else if (this.state === 'approach') {
            this.state = 'idle';
            this.timer = 1 + Math.random();
          }
        }
        this.walkSpeed += (speed - this.walkSpeed) * Math.min(1, dt * 8);

        // if she walks right into it, it bolts
        if (probe.dist < 0.42 && this.state !== 'flee' && b.shy > 0.25) {
          this.state = 'flee';
          this.timer = 1.4;
          this.pickTarget(false);
        }

        // ---------------- voice
        this.callAt -= dt;
        if (this.callAt <= 0) {
          this.callAt = 5 + Math.random() * 12 - (probe.dist < 3 ? 3 : 0);
          if (probe.dist < 8 && probe.lookScore > 0.5) hooks.call(this);
        }
        if (probe.lookScore > 0.93 && probe.dist < 9) {
          if (!this.seenThisSession) {
            this.seenThisSession = true;
            this.spiedAt = time;
            hooks.sparkle(this);
          }
          this.spotGlow = Math.min(1, this.spotGlow + dt * 3);
        } else {
          this.spotGlow = Math.max(0, this.spotGlow - dt * 1.5);
          if (probe.lookScore < 0.6) this.seenThisSession = false;
        }
      }
    }

    // ---------------- transform + animation
    const root = this.creature.root;
    root.position.copy(this.pos);
    const s = this.scaleCurve() * (this.state === 'captured' ? 0.001 : 1);
    if (s > 0.0005) {
      root.visible = true;
      root.scale.setScalar(s * this.baseScale);
    } else {
      root.visible = false;
    }

    // squash & stretch breathing; stronger when hopping
    const wob = b.wobble;
    const breath = Math.sin(time * 2.1 * wob + this.phase) * 0.045;
    const gait = this.walkSpeed * 3.4;
    const hopT = time * (6 + b.energy * 5) + this.phase;
    const hop = b.hop > 0 && gait > 0.15 ? Math.abs(Math.sin(hopT)) * b.hop * (1 + gait) : 0;
    const squash = 1 + breath + (b.hop > 0 ? -Math.cos(hopT * 2) * 0.03 * gait : 0);
    const body = this.creature.body;
    body.scale.set(1 / Math.sqrt(Math.max(0.4, squash)), squash, 1 / Math.sqrt(Math.max(0.4, squash)));
    body.rotation.z = Math.sin(time * 1.1 + this.phase) * 0.05 * (b.hover > 0 ? 1.6 : 0.5);
    body.rotation.x = Math.min(0.25, gait * 0.16);

    // hover + hop
    const bobSpeed = 1.1 + b.wobble * 0.5;
    this.creature.lift.position.y = b.hover + Math.sin(time * bobSpeed + this.bobSeed) * (b.hover > 0 ? 0.055 : 0.006) + hop;

    // idle turning toward the player when curious
    if (this.state === 'idle' && probe.lookScore > 0.9 && probe.dist < 4) this.faceTo(this.tmp.set(probe.pos.x, 0, probe.pos.z), dt, 2.2);
    root.rotation.y = this.yaw;

    // slot wiggle
    for (const [name, node] of this.creature.slots) {
      if (!WOBBLE_SLOTS.has(name)) continue;
      const ph = this.slotPhase.get(name) ?? 0;
      const walk = Math.sin(time * (7 + b.energy * 6) + ph) * Math.min(1, gait * 1.6);
      switch (name) {
        case 'tail':
          node.rotation.y = Math.sin(time * 4.2 * wob + ph) * 0.5;
          node.rotation.z = Math.sin(time * 2.1 + ph) * 0.14;
          break;
        case 'earL':
        case 'earR': {
          const dir = name === 'earL' ? 1 : -1;
          node.rotation.z = dir * (0.06 + Math.sin(time * 3.1 * wob + ph) * 0.16 + walk * 0.12 * dir);
          node.rotation.x = Math.sin(time * 2.4 + ph) * 0.1;
          break;
        }
        case 'armL':
        case 'armR': {
          const dir = name === 'armL' ? 1 : -1;
          node.rotation.x = Math.sin(time * (7 + b.energy * 6) + ph + (dir > 0 ? 0 : Math.PI)) * (0.25 + gait * 0.7);
          node.rotation.z = dir * (0.1 + Math.sin(time * 2 + ph) * 0.08);
          break;
        }
        case 'legL':
        case 'legR': {
          const dir = name === 'legL' ? 1 : -1;
          node.rotation.x = Math.sin(time * (7 + b.energy * 6) + ph + (dir > 0 ? 0 : Math.PI)) * 0.55 * Math.min(1, gait * 1.8);
          break;
        }
        case 'wingL':
        case 'wingR': {
          const dir = name === 'wingL' ? 1 : -1;
          node.rotation.z = dir * (0.2 + Math.sin(time * 11 + ph) * 0.75);
          break;
        }
        default:
          node.rotation.x = Math.sin(time * 2.6 * wob + ph) * 0.16;
          node.rotation.z = Math.cos(time * 2.1 * wob + ph) * 0.16;
          node.position.y = (node.userData.baseY ?? (node.userData.baseY = node.position.y)) + Math.sin(time * 2.8 + ph) * 0.012;
      }
    }

    // blink
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) {
      this.blinkAt = 2 + Math.random() * 5;
      this.blink = 0.16;
    }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt);
    if (this.creature.eyes) {
      const closed = this.blink > 0 ? 1 - Math.abs(this.blink / 0.16 - 0.5) * 2 : 0;
      this.creature.eyes.scale.y = 1 - closed * 0.88;
    }

    // ground contact: shadow tightens as it descends, pad brightens when spotted
    const airY = this.creature.lift.position.y;
    const groundMix = THREE.MathUtils.clamp(1 - airY / 1.2, 0.15, 1);
    const sh = this.creature.shadow;
    const footprint = this.creature.radius * (0.9 + groundMix * 0.4);
    sh.scale.setScalar(footprint * 1.3);
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.16 + groundMix * 0.5;
    const pad = this.creature.pad;
    pad.scale.setScalar(this.creature.radius * (1.6 + this.spotGlow * 0.5));
    (pad.material as THREE.MeshBasicMaterial).opacity = 0.16 + this.spotGlow * 0.4 + (this.shiny ? 0.25 : 0);
    if (this.shiny) {
      pad.rotation.z = time * 0.6;
    }
  }

  private faceTo(point: THREE.Vector3, dt: number, speed: number) {
    const want = Math.atan2(point.x - this.pos.x, point.z - this.pos.z);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * speed);
  }

  private pickTarget(aroundHome: boolean) {
    if (this.state === 'flee') {
      // run away from where we are standing, but don't wander off the play area
      const ang = Math.atan2(this.pos.x - this.home.x, this.pos.z - this.home.z) + (Math.random() - 0.5) * 1.2;
      this.target.set(this.home.x + Math.sin(ang) * 2.2, 0, this.home.z + Math.cos(ang) * 2.2);
      return;
    }
    const r = aroundHome ? 0.9 + Math.random() * 1.1 : Math.random() * 1.6;
    const ang = Math.random() * Math.PI * 2;
    this.target.set(this.home.x + Math.sin(ang) * r, 0, this.home.z + Math.cos(ang) * r);
  }

  /** Instant pop, used at spawn and when a summoned monster arrives. */
  appear(at: THREE.Vector3) {
    this.pos.copy(at);
    this.home.copy(at);
    this.state = 'spawn';
    this.spawnT = 0;
  }

  startCapture() {
    this.state = 'captured';
  }

  endCapture(hide = false) {
    if (hide) {
      this.state = 'poofed';
      this.poofT = 0;
      this.escaped = true;
    } else {
      this.state = 'flee';
      this.timer = 1.6;
      this.pickTarget(false);
    }
  }

  finishPoof() {
    return this.state === 'poofed' && this.poofT > 0.4;
  }

  dispose() {
    this.creature.root.removeFromParent();
  }
}

export function monsterLabel(sp: Species) {
  const el = ELEMENTS[sp.element];
  return `${el.icon} ${sp.name}`;
}
