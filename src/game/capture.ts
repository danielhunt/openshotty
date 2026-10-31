/* ============================================================
   Capturing.

   The feel of the whole game lives in this file:
   - the orb leaves her phone and arcs across the room
   - gentle aim assist bends it toward the monster she is looking at,
     scaled by how far off-centre her flick was (so it never feels like
     the game is playing itself)
   - a hit turns into a beam, three nervous wobbles and GOTCHA
   Odds reward accurate throws and honour rare friends, but stay
   generous enough that a 7-year-old always finishes a catch.
   ============================================================ */

import * as THREE from 'three';
import { makeBeam, makeOrb } from '../core/art';
import type { Particles } from '../fx/particles';
import type { Monster } from './monster';
import { RARITY, type Rarity } from './species';

const GRAVITY = 5.4;
const MAX_FLIGHT = 2.6;
const ASSIST_PULL = [0, 0.45, 0.85];

export interface CaptureHooks {
  orbLaunched(target: Monster | null): void;
  orbMissed(pos: THREE.Vector3): void;
  orbHit(m: Monster, accuracy: number): void;
  beamStart(m: Monster): void;
  wobble(m: Monster, index: number): void;
  caught(m: Monster, accuracy: number): void;
  escaped(m: Monster): void;
}

type Phase = 'idle' | 'beam' | 'wobble' | 'result';

interface FlyingOrb {
  group: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  from: THREE.Vector3;
  reach: number;
  t: number;
  spin: THREE.Vector3;
}

/** Per-species nerves: the shyer it is, the harder the wiggle. */
const RARITY_BASE: Record<Rarity, number> = {
  common: 0.92,
  rare: 0.74,
  epic: 0.58,
  legend: 0.44,
};

export class OrbThrower {
  /** monsters currently stuck inside an orb */
  readonly capturing = new Set<Monster>();
  /** mirrored from settings: 0 none, 1 gentle, 2 helpful */
  assist = 2;

  private orbs: FlyingOrb[] = [];
  private phase: Phase = 'idle';
  private subject: Monster | null = null;
  private beam: THREE.Mesh | null = null;
  private phaseT = 0;
  private wobbleIndex = 0;
  private wobbleT = 0;
  private wobblePlan = 3;
  private accuracy = 1;
  private golden = false;

  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _c = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private particles: Particles,
    private camera: THREE.PerspectiveCamera,
  ) {}

  get busy() {
    return this.phase !== 'idle';
  }

  get inOrb() {
    return this.subject;
  }

  get currentPhase() {
    return this.phase;
  }

  /* ---------------------------------------------------------------- */
  /* aiming                                                            */
  /* ---------------------------------------------------------------- */

  /** The monster she is roughly pointing at, within throwing range. */
  aimTarget(monsters: Monster[], maxDistance = 9): Monster | null {
    const fwd = this._a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best: Monster | null = null;
    let bestAngle = Infinity;
    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const to = this._b.copy(m.center).sub(this.camera.position);
      const dist = to.length();
      if (dist > maxDistance || dist < 0.35) continue;
      to.divideScalar(dist);
      const ang = Math.acos(THREE.MathUtils.clamp(fwd.dot(to), -1, 1));
      if (ang < bestAngle) {
        bestAngle = ang;
        best = m;
      }
    }
    return bestAngle < 0.5 ? best : null;
  }

  /** Screen-space angle to the best target, for the lock-on reticle. */
  aimAngle(monsters: Monster[]): number {
    const fwd = this._a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best = Infinity;
    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const to = this._b.copy(m.center).sub(this.camera.position);
      const dist = to.length();
      if (dist > 9 || dist < 0.35) continue;
      to.divideScalar(dist);
      best = Math.min(best, Math.acos(THREE.MathUtils.clamp(fwd.dot(to), -1, 1)));
    }
    return best;
  }

  private isLive(m: Monster) {
    return m.state !== 'captured' && m.state !== 'poofed' && !this.capturing.has(m);
  }

  /* ---------------------------------------------------------------- */
  /* ballistics                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Velocity that carries an orb from `origin` to `target` at `speed`.
   * Horizontal distance is covered at vx (t = r / vx), then
   * dy = vy*t - g*t²/2  ->  vy = dy/t + g*t/2.
   * If the target is out of range we lengthen the flight into a lob
   * instead of firing a useless flat shot.
   */
  private solveArc(origin: THREE.Vector3, target: THREE.Vector3, speed: number, out: THREE.Vector3) {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const dy = target.y - origin.y;
    const r = Math.max(0.05, Math.hypot(dx, dz));
    let t = r / speed;
    const minT = Math.sqrt(Math.max(0.01, (2 * (dy + 0.4)) / GRAVITY));
    if (t < minT) t = minT;
    t = THREE.MathUtils.clamp(t, 0.24, 1.4);
    return out.set(dx / t, dy / t + (GRAVITY * t) / 2, dz / t);
  }

  /* ---------------------------------------------------------------- */
  /* throwing                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Hurl an orb along a world-space ray (`dir` from the tap position).
   * Returns false if a capture animation is mid-play.
   */
  throwOrb(dir: THREE.Vector3, monsters: Monster[], golden: boolean, hooks: CaptureHooks): boolean {
    if (this.phase === 'beam' || this.phase === 'wobble') return false;

    const origin = this._a
      .set(0, -0.16, -0.34)
      .applyQuaternion(this.camera.quaternion)
      .add(this.camera.position);

    const target = this.aimTarget(monsters);
    const speed = target
      ? THREE.MathUtils.clamp(3.2 + target.center.distanceTo(this.camera.position) * 0.78, 4, 9.6)
      : 5.4;

    let velocity: THREE.Vector3;
    let reach = 6;

    if (target) {
      const center = target.center;
      const solved = this.solveArc(origin, center, speed, new THREE.Vector3());
      const raw = new THREE.Vector3().copy(dir).normalize().multiplyScalar(speed);
      // Full control when she is actually aiming, gentle help when flailing.
      const off = THREE.MathUtils.clamp(raw.angleTo(solved.clone().normalize()) / 0.4, 0, 1);
      velocity = raw.lerp(solved, ASSIST_PULL[this.assist] * off);
      reach = center.distanceTo(origin);
    } else {
      velocity = new THREE.Vector3().copy(dir).normalize().multiplyScalar(speed);
    }

    const group = makeOrb(golden ? '#fff0bf' : '#fff3c9', golden ? '#ffa62e' : '#ff5f7e');
    group.position.copy(origin);
    group.scale.setScalar(1.3);
    this.scene.add(group);

    this.orbs.push({
      group,
      pos: origin.clone(),
      vel: velocity,
      from: origin.clone(),
      reach,
      t: 0,
      spin: new THREE.Vector3(6 + Math.random() * 7, Math.random() * 6 - 3, 6 + Math.random() * 7),
    });

    this.golden = golden;
    hooks.orbLaunched(target);
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* per frame                                                         */
  /* ---------------------------------------------------------------- */

  update(dt: number, monsters: Monster[], hooks: CaptureHooks) {
    this.updateOrbs(dt, monsters, hooks);
    this.updateShow(dt, hooks);
  }

  private updateOrbs(dt: number, monsters: Monster[], hooks: CaptureHooks) {
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt;
      o.vel.y -= GRAVITY * dt;
      o.pos.addScaledVector(o.vel, dt);
      o.group.position.copy(o.pos);
      o.group.rotation.x += o.spin.x * dt;
      o.group.rotation.y += o.spin.y * dt;
      o.group.rotation.z += o.spin.z * dt;
      o.group.scale.setScalar(1.3 - Math.min(0.6, o.t * 0.32));
      this.particles.trail(o.pos, this.golden ? '#ffd93d' : '#ff9e6b', 1);

      const hit = this.testHit(o.pos, monsters);
      if (hit) {
        this.removeOrb(o);
        this.capturing.add(hit.monster);
        hooks.orbHit(hit.monster, hit.accuracy);
        this.beginCapture(hit.monster, hit.accuracy, hooks);
        continue;
      }

      const flown = o.pos.distanceTo(o.from);
      const grounded = o.pos.y <= 0.05 && o.t > 0.08;
      if (grounded || o.t > MAX_FLIGHT || flown > o.reach + 1.6) {
        this.removeOrb(o);
        const at = this._b.set(o.pos.x, Math.max(0.06, o.pos.y), o.pos.z);
        this.particles.burst(at, { color: ['#ffe9a8', '#fff3c9'], count: 9, speed: 0.75, life: 0.42, size: 0.05, gravity: -1.1 });
        this.particles.ring(this._c.set(o.pos.x, 0.02, o.pos.z), '#ffd93d', 0.05, 0.55, 0.42);
        hooks.orbMissed(o.pos);
      }
    }
  }

  private testHit(pos: THREE.Vector3, monsters: Monster[]): { monster: Monster; accuracy: number } | null {
    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const center = m.center;
      // generous: a little kid is flicking at a moving target on a phone
      const reach = Math.max(0.22, m.radius * 1.55 + 0.1);
      const d = center.distanceTo(pos);
      if (d < reach) return { monster: m, accuracy: THREE.MathUtils.clamp(1 - d / reach, 0.2, 1) };
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* the wobble-wobble-gotcha show                                     */
  /* ---------------------------------------------------------------- */

  /** Rolls the catch odds and starts the beam. */
  beginCapture(m: Monster, accuracy: number, hooks: CaptureHooks) {
    if (this.phase !== 'idle') return;
    this.phase = 'beam';
    this.subject = m;
    this.accuracy = accuracy;
    this.phaseT = 0;
    this.wobbleIndex = 0;
    this.wobbleT = 0;

    const rarity: Rarity = m.species.rarity;
    let odds = RARITY_BASE[rarity];
    odds *= 0.8 + accuracy * 0.38; // rewarding an accurate throw
    if (m.shiny) odds *= 0.7;
    if (this.golden) odds *= 1.35;
    if (RARITY[rarity].weight <= 3) odds *= 1.1; // legends get a brave bonus
    odds = THREE.MathUtils.clamp(odds, 0.3, 0.96);

    // a fail still gets a dramatic near-miss: 1 or 2 wobbles then out
    const success = Math.random() < odds;
    this.wobblePlan = success ? 3 : 1 + Math.floor(Math.random() * 2);
    this.success = success;

    const c = m.center;
    const beam = makeBeam(m.shiny ? '#fff2a8' : '#9fdcff');
    beam.position.set(c.x, c.y + m.creature.height * 0.95, c.z);
    beam.scale.set(1, m.creature.height * 2.2, 1);
    this.scene.add(beam);
    this.beam = beam;
    hooks.beamStart(m);
  }

  private success = true;

  private updateShow(dt: number, hooks: CaptureHooks) {
    const m = this.subject;
    if (!m) return;

    if (this.phase === 'beam') {
      this.phaseT += dt;
      const k = Math.min(1, this.phaseT / 0.5);
      const beam = this.beam!;
      const c = m.center;
      beam.position.set(c.x, c.y + m.creature.height * 0.95 * (1 - k), c.z);
      beam.scale.set(1 - k * 0.72, m.creature.height * 2.2 * (1 - k * 0.5), 1 - k * 0.72);
      (beam.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * 0.35);
      this.particles.burst(c, { color: ['#9fdcff', '#ffffff'], count: 2, speed: 0.45, life: 0.32, size: 0.06, gravity: -0.5, drag: 3.2 });
      if (k >= 1) {
        this.dropBeam();
        this.phase = 'wobble';
        this.phaseT = 0;
        this.wobbleT = 0;
        hooks.wobble(m, 0);
      }
      return;
    }

    if (this.phase === 'wobble') {
      this.phaseT += dt;
      this.wobbleT += dt;
      const step = this.wobbleIndex >= 2 ? 0.82 : 0.6;
      if (this.wobbleT < step) return;
      this.wobbleT = 0;
      this.wobbleIndex += 1;
      if (this.wobbleIndex > this.wobblePlan) {
        this.phase = 'result';
        this.phaseT = 0;
        if (this.success) hooks.caught(m, this.accuracy);
        else hooks.escaped(m);
      } else {
        hooks.wobble(m, this.wobbleIndex);
      }
      return;
    }

    if (this.phase === 'result') {
      this.phaseT += dt;
      if (this.phaseT > 0.45) this.finish();
    }
  }

  private dropBeam() {
    if (!this.beam) return;
    this.scene.remove(this.beam);
    this.beam.geometry.dispose();
    (this.beam.material as THREE.Material).dispose();
    this.beam = null;
  }

  private removeOrb(o: FlyingOrb) {
    this.scene.remove(o.group);
    const i = this.orbs.indexOf(o);
    if (i >= 0) this.orbs.splice(i, 1);
  }

  /** Releases the orb hand back to the player after the reward screen. */
  finish() {
    if (this.subject) this.capturing.delete(this.subject);
    this.subject = null;
    this.phase = 'idle';
    this.phaseT = 0;
    this.wobbleIndex = 0;
    this.wobbleT = 0;
    this.dropBeam();
  }

  /** Leaving play mid-capture. */
  abort() {
    this.capturing.clear();
    this.finish();
    for (const o of [...this.orbs]) this.removeOrb(o);
  }
}
