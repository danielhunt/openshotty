/* ============================================================
   Juice: GPU point particles, shockwave rings and screen shake.
   One draw call for up to 900 particles.
   ============================================================ */

import * as THREE from 'three';
import { glowTexture, makeRing } from '../core/art';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / max(0.15, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`;

const MAX = 900;

interface BurstOpts {
  color?: string | string[];
  count?: number;
  speed?: number;
  spread?: number;
  size?: number;
  life?: number;
  gravity?: number;
  up?: number;
  drag?: number;
}

export class Particles {
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private rings: { mesh: THREE.Mesh; t: number; dur: number; from: number; to: number }[] = [];
  private ringPool: THREE.Mesh[] = [];

  /** screen shake, in radians of camera wobble */
  shakeAmount = 0;

  private tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.alpha = new Float32Array(MAX);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.drag = new Float32Array(MAX);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setDrawRange(0, MAX);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowTexture() } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    for (let i = 0; i < 6; i++) {
      const r = makeRing('#ffffff');
      r.visible = false;
      scene.add(r);
      this.ringPool.push(r);
    }
  }

  burst(at: THREE.Vector3, opts: BurstOpts = {}) {
    const colors = opts.color ?? ['#ffd93d'];
    const list = Array.isArray(colors) ? colors : [colors];
    const count = opts.count ?? 18;
    const speed = opts.speed ?? 1.6;
    const life = opts.life ?? 0.85;
    const size = opts.size ?? 0.1;
    const gravity = opts.gravity ?? -1.6;
    const spread = opts.spread ?? 1;
    const up = opts.up ?? 0;
    const drag = opts.drag ?? 1.6;

    for (let i = 0; i < count; i++) {
      const i3 = this.cursor * 3;
      this.pos[i3] = at.x + (Math.random() - 0.5) * 0.05;
      this.pos[i3 + 1] = at.y + (Math.random() - 0.5) * 0.05;
      this.pos[i3 + 2] = at.z + (Math.random() - 0.5) * 0.05;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 2 * spread);
      const s = speed * (0.45 + Math.random() * 0.9);
      this.vel[i3] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[i3 + 1] = Math.cos(phi) * s * (phi < Math.PI ? 1 : 0.6) + up;
      this.vel[i3 + 2] = Math.sin(phi) * Math.sin(theta) * s;

      this.tmpColor.set(list[(Math.random() * list.length) | 0]);
      const boost = 1 + Math.random() * 0.55;
      this.col[i3] = this.tmpColor.r * boost;
      this.col[i3 + 1] = this.tmpColor.g * boost;
      this.col[i3 + 2] = this.tmpColor.b * boost;

      this.size[this.cursor] = size * (0.55 + Math.random() * 0.9);
      this.alpha[this.cursor] = 1;
      const l = life * (0.7 + Math.random() * 0.6);
      this.life[this.cursor] = l;
      this.maxLife[this.cursor] = l;
      this.grav[this.cursor] = gravity;
      this.drag[this.cursor] = drag;
      this.cursor = (this.cursor + 1) % MAX;
    }
  }

  /** Twinkle trail behind the flying orb. */
  trail(at: THREE.Vector3, color: string, n = 2) {
    this.burst(at, { color, count: n, speed: 0.16, life: 0.4, size: 0.055, gravity: 0.15, drag: 3 });
  }

  ring(at: THREE.Vector3, color: string, from = 0.1, to = 1.2, dur = 0.5) {
    const mesh = this.ringPool.find((m) => !m.visible);
    if (!mesh) return;
    mesh.visible = true;
    (mesh.material as THREE.MeshBasicMaterial).color.set(color);
    mesh.position.copy(at);
    this.rings.push({ mesh, t: 0, dur, from, to });
  }

  shake(amount: number) {
    this.shakeAmount = Math.min(0.09, this.shakeAmount + amount);
  }

  update(dt: number) {
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    const col = this.geo.attributes.aColor as THREE.BufferAttribute;
    const alpha = this.geo.attributes.aAlpha as THREE.BufferAttribute;
    let anyAlive = false;

    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          anyAlive = true;
        }
        continue;
      }
      anyAlive = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.01) {
        this.pos[i3 + 1] = 0.01;
        this.vel[i3 + 1] *= -0.32;
        this.vel[i3] *= 0.7;
        this.vel[i3 + 2] *= 0.7;
      }
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = k * k;
    }

    if (anyAlive) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
      alpha.needsUpdate = true;
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      const s = r.from + (r.to - r.from) * (1 - Math.pow(1 - k, 2.4));
      r.mesh.scale.setScalar(s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) {
        r.mesh.visible = false;
        this.rings.splice(i, 1);
      }
    }

    this.shakeAmount *= Math.pow(0.0025, dt);
    if (this.shakeAmount < 0.0002) this.shakeAmount = 0;
  }

  /** Random unit vector*position for the camera wobble. */
  shakeOffset(out: THREE.Vector3, time: number) {
    const a = this.shakeAmount;
    if (a === 0) return out.set(0, 0, 0);
    return out.set(Math.sin(time * 61.3) * a, Math.sin(time * 47.7) * a * 0.8, Math.sin(time * 71.1) * a * 0.4);
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.points, ...this.ringPool);
    this.geo.dispose();
    this.mat.dispose();
  }
}
