/* ============================================================
   Capturing.

   The feel of the whole game lives in this file:
   - the orb leaves her phone and arcs across the room
   - the monster she aimed at is chosen on the glass, where her finger is
   - gentle aim assist bends the arc toward that monster (so it never feels
     like the game is playing itself, and never moves her aim somewhere else)
   - a hit turns into a beam, three nervous wobbles and GOTCHA
   Odds reward accurate throws and honour rare friends, but stay
   generous enough that a 7-year-old always finishes a catch.

   Why the tap picks the target instead of the camera centre: a phone shows
   maybe a 35° slice of a room at a time, so a centre lock spends most of the
   game pointing at blank wall while a monster sits at the edge of the
   picture. To a seven-year-old that reads as the game ignoring her. So
   pointing is her job, and helping is ours — ballistically, after the throw.
   ============================================================ */

import * as THREE from 'three';
import { makeBeam, makeOrb } from '../core/art';
import type { Particles } from '../fx/particles';
import type { Monster } from './monster';
import { RARITY, type Rarity } from './species';

const GRAVITY = 4.4; // m/s^2 — a floaty, readable arc on a phone
const MAX_FLIGHT = 2.4;
/**
 * How much of the ballistic correction to apply at assist 0/1/2. Never zero:
 * even with assist off the orb needs *some* lift, or it sails over every
 * monster's head and every throw feels like it was hurled at the floor.
 */
const ASSIST_PULL = [0.6, 0.85, 0.96];
/** Nothing further than this is worth aiming at. */
const THROW_RANGE = 11;
/**
 * Fingertip slop in CSS pixels, scaled by how big the monster appears and kept
 * between these two: a thumbnail on the far wall still needs a real tap, a
 * monster filling the picture forgives a lot.
 */
const TAP_MIN = 56;
const TAP_MAX = 150;
/** A nearer monster is worth this many pixels of fingertip offset when two
 *  silhouettes overlap, so a pair resolves the way the picture reads. */
const NEAR_BIAS = 2.2;

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
  /** where it was last frame — fast orbs tunnel through snapshot hit tests */
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  from: THREE.Vector3;
  reach: number;
  t: number;
  spin: THREE.Vector3;
  /** the monster she chose; the orb is allowed to finish aiming at it */
  lock: Monster | null;
  /** launch speed, kept so the arc can be re-solved while it flies */
  speed: number;
}

/** Per-species nerves: the shyer it is, the harder the wiggle. */
const RARITY_BASE: Record<Rarity, number> = {
  common: 0.92,
  rare: 0.74,
  epic: 0.58,
  legend: 0.44,
};

/** Shortest distance from `p` to the segment `a`→`b`. */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  let k = 0;
  if (len > 1e-9) k = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len, 0, 1);
  out.set(a.x + abx * k, a.y + aby * k, a.z + abz * k);
  return p.distanceTo(out);
}

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
  private readonly _d = new THREE.Vector3();
  /** throw-origin scratch: never one of the aiming temporaries (see throwOrb) */
  private readonly _e = new THREE.Vector3();
  private readonly _f = new THREE.Vector3();

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

  /** Live enough to aim at, throw at and be hit by. */
  isLive(m: Monster) {
    return m.state !== 'captured' && m.state !== 'poofed' && !this.capturing.has(m);
  }

  /* ---------------------------------------------------------------- */
  /* aiming                                                            */
  /* ---------------------------------------------------------------- */

  /** Pixels across for one metre of world at `dist` — how big things look. */
  pixelsPerMetre(dist: number) {
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    return window.innerHeight / 2 / Math.tan(half) / Math.max(0.25, dist);
  }

  /**
   * The monster whose body sits under her finger. Everything is measured on the
   * screen, in the same pixels the pointer event arrived in, and the allowed
   * slop grows with the monster's apparent size — a big close one forgives a
   * lot, a small far one takes a real tap. Ties go to the nearer monster, with
   * a bias so a precise tap near the edge of two overlapping silhouettes still
   * resolves to the one she can actually see.
   */
  pickAt(clientX: number, clientY: number, monsters: Monster[]): Monster | null {
    let best: Monster | null = null;
    let bestScore = Infinity;
    const fwd = this._a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);

    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const dist = m.pos.distanceTo(this.camera.position);
      if (dist > THROW_RANGE || dist < 0.3) continue;
      // in front of the eye only: projecting a point behind the camera mirrors it
      if (this._b.copy(m.center).sub(this.camera.position).dot(fwd) <= 0) continue;

      const p = this._b.copy(m.center).project(this.camera);
      if (p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-p.y * 0.5 + 0.5) * window.innerHeight;
      const size = m.radius * this.pixelsPerMetre(dist);
      const reach = THREE.MathUtils.clamp(size * 1.15, TAP_MIN, TAP_MAX);
      const off = Math.hypot(clientX - sx, clientY - sy);
      if (off > reach) continue;

      const score = off - dist * NEAR_BIAS;
      if (score < bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  /** Anything at all in the picture worth an orb? Used to spare her one. */
  anyInView(monsters: Monster[]): boolean {
    const fwd = this._a.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const dist = m.pos.distanceTo(this.camera.position);
      if (dist > THROW_RANGE || dist < 0.3) continue;
      if (this._b.copy(m.center).sub(this.camera.position).dot(fwd) <= 0) continue;
      const p = this._b.copy(m.center).project(this.camera);
      if (p.z > 1) continue;
      const sx = (p.x * 0.5 + 0.5) * w;
      const sy = (-p.y * 0.5 + 0.5) * h;
      const size = m.radius * this.pixelsPerMetre(dist);
      // a fingertip's worth of slop, so a monster peeking in at the very edge
      // still counts as "in the picture" rather than an invisible target
      const reach = THREE.MathUtils.clamp(size * 1.15, TAP_MIN, TAP_MAX) + 20;
      if (sx > -reach && sx < w + reach && sy > -reach && sy < h + reach) return true;
    }
    return false;
  }

  /** The monster she is roughly pointing at, within throwing range. */
  aimTarget(monsters: Monster[], maxDistance = THROW_RANGE): Monster | null {
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
   * Hurl an orb along a world-space ray (`dir` from the tap position) at the
   * monster she tapped. `picked` comes from the screen-space pick, or from her
   * tapping the monster's name tag; without it falls back to the centre aim.
   * Returns false if a capture animation is mid-play.
   */
  throwOrb(
    dir: THREE.Vector3,
    monsters: Monster[],
    golden: boolean,
    hooks: CaptureHooks,
    picked: Monster | null = null,
  ): boolean {
    if (this.phase === 'beam' || this.phase === 'wobble') return false;

    // Chosen first, because aimTarget borrows the aiming temporaries.
    const target = picked ?? this.aimTarget(monsters);

    // The orb leaves her hand: 34 cm in front of the eye, 16 cm below it. This
    // used to write into `_a`, which aimTarget had just used, so the spawn point
    // was whatever the last aiming calculation left behind — an orb appearing a
    // metre ahead at ankle height, which reads as the throw going nowhere.
    const origin = this._e.set(0, -0.16, -0.34).applyQuaternion(this.camera.quaternion).add(this.camera.position);

    const range = target ? target.center.distanceTo(this.camera.position) : 5;
    const speed = THREE.MathUtils.clamp(5.6 + range * 0.95, 6, 12.5);

    let velocity: THREE.Vector3;
    let reach = 6;

    const raw = this._f.copy(dir).normalize().multiplyScalar(speed);
    if (target) {
      const center = target.center;
      const solved = this.solveArc(origin, center, speed, new THREE.Vector3());
      // Full control when she is actually aiming, gentle help when flailing.
      const off = THREE.MathUtils.clamp(raw.angleTo(solved.clone().normalize()) / 0.4, 0, 1);
      velocity = raw.lerp(solved, ASSIST_PULL[THREE.MathUtils.clamp(this.assist, 0, 2)] * off).clone();
      reach = center.distanceTo(origin);
    } else {
      velocity = raw.clone();
    }

    const group = makeOrb(golden ? '#fff0bf' : '#fff3c9', golden ? '#ffa62e' : '#ff5f7e');
    group.position.copy(origin);
    group.scale.setScalar(1.3);
    this.scene.add(group);

    this.orbs.push({
      group,
      pos: origin.clone(),
      prev: origin.clone(),
      vel: velocity,
      from: origin.clone(),
      reach,
      t: 0,
      spin: new THREE.Vector3(6 + Math.random() * 7, Math.random() * 6 - 3, 6 + Math.random() * 7),
      lock: target,
      speed,
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

  /**
   * Aim assist after release. Once she has committed to a monster the orb
   * finishes the job: re-solving the arc from wherever the orb actually is keeps
   * the curve smooth and still lands when the monster wanders, and blending it
   * frame by frame reads as the orb correcting, not as a missile on rails.
   */
  private homeOrb(o: FlyingOrb, dt: number, pull: number) {
    const lock = o.lock;
    if (!lock || o.t < 0.05 || !this.isLive(lock)) return;
    const want = this.solveArc(o.pos, lock.center, o.speed, this._d);
    o.vel.lerp(want, Math.min(1, dt * 7 * pull));
  }

  private updateOrbs(dt: number, monsters: Monster[], hooks: CaptureHooks) {
    const pull = ASSIST_PULL[THREE.MathUtils.clamp(this.assist, 0, 2)];
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.t += dt;
      o.prev.copy(o.pos);
      this.homeOrb(o, dt, pull);
      o.vel.y -= GRAVITY * dt;
      o.pos.addScaledVector(o.vel, dt);
      o.group.position.copy(o.pos);
      o.group.rotation.x += o.spin.x * dt;
      o.group.rotation.y += o.spin.y * dt;
      o.group.rotation.z += o.spin.z * dt;
      o.group.scale.setScalar(1.3 - Math.min(0.6, o.t * 0.32));
      this.particles.trail(o.pos, this.golden ? '#ffd93d' : '#ff9e6b', 1);

      const hit = this.testHit(o.prev, o.pos, monsters);
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

  /**
   * Swept hit test over the path the orb actually took this frame. At 12 m/s a
   * 60 fps step is 20 cm, so a point-in-space test lets a fast orb sit
   * *behind* a monster it clearly went through, and the throw reads as a miss.
   */
  private testHit(
    from: THREE.Vector3,
    to: THREE.Vector3,
    monsters: Monster[],
  ): { monster: Monster; accuracy: number } | null {
    for (const m of monsters) {
      if (!this.isLive(m)) continue;
      const center = m.center;
      // generous: a little kid is flicking at a moving target on a phone
      const reach = Math.max(0.22, m.radius * 1.55 + 0.1);
      const d = distanceToSegment(center, from, to, this._d);
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
