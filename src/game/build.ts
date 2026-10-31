/* ============================================================
   Creature builder — turns a Species recipe into meshes.

   Each monster is a tree of "slots" (body, eyes, earL, tail, …).
   Parts that share a slot are merged into one geometry with baked
   vertex colours, so a whole monster costs a handful of draw calls
   and every slot can be animated on its own.
   ============================================================ */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BODY_MAT, EYE_MAT, OUTLINE_MAT, makeGlowPad, makeGroundShadow, makeShinyBodyMaterial } from '../core/art';
import type { Part, Species } from './species';
import { ELEMENTS } from './species';

const INK = '#2a1246';
const WHITE = '#ffffff';
const PUPIL = '#241640';

/** Slots that are tinted with the shiny material instead of the plain one. */
const SHINY_MAT_CACHE = new Map<string, THREE.MeshToonMaterial>();

function shinyMaterialFor(id: string) {
  let m = SHINY_MAT_CACHE.get(id);
  if (!m) {
    m = makeShinyBodyMaterial();
    SHINY_MAT_CACHE.set(id, m);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* shapes                                                              */
/* ------------------------------------------------------------------ */

function shape(kind: Part['geo'], a: number[]): THREE.BufferGeometry {
  switch (kind) {
    case 'icosa':
      return new THREE.IcosahedronGeometry(a[0], a[1] ?? 1);
    case 'sphere':
      return new THREE.SphereGeometry(...(a as [number, number, number]));
    case 'capsule':
      return new THREE.CapsuleGeometry(...(a as [number, number, number, number]));
    case 'cone':
      return new THREE.ConeGeometry(...(a as [number, number, number]));
    case 'box':
      return new THREE.BoxGeometry(...(a as [number, number, number]));
    case 'torus':
      return new THREE.TorusGeometry(...(a as [number, number, number, number]));
    case 'cyl':
      return new THREE.CylinderGeometry(...(a as [number, number, number, number]));
    case 'disc': {
      // a plump petal rather than a flat plane: shades nicely, no double-side cost
      const g = new THREE.SphereGeometry(a[0], 10, 7);
      g.scale(1, 0.26, 1.55);
      return g;
    }
  }
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _c = new THREE.Color();

function paint(geo: THREE.BufferGeometry, hex: string, shade = 1) {
  _c.set(hex);
  if (shade !== 1) _c.multiplyScalar(shade);
  const count = geo.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(geo: THREE.BufferGeometry, p: Part): THREE.BufferGeometry {
  _e.set(p.r?.[0] ?? 0, p.r?.[1] ?? 0, p.r?.[2] ?? 0);
  _q.setFromEuler(_e);
  _v.set(p.s?.[0] ?? 1, p.s?.[1] ?? 1, p.s?.[2] ?? 1);
  _m4.compose(new THREE.Vector3(p.p[0], p.p[1], p.p[2]), _q, _v);
  geo.applyMatrix4(_m4);
  return geo;
}

/* ------------------------------------------------------------------ */
/* face                                                                */
/* ------------------------------------------------------------------ */

function buildFaceParts(sp: Species): { eyeParts: Part[]; faceParts: Part[] } {
  const e = sp.eyes;
  const eyeParts: Part[] = [];
  const faceParts: Part[] = [];
  const style = e.style ?? 'round';
  const pupil = e.pupil ?? 0.55;

  for (const side of [-1, 1]) {
    const x = e.spacing * side;
    if (style === 'happy') {
      eyeParts.push({
        geo: 'torus',
        a: [e.size, e.size * 0.3, 5, 10, Math.PI],
        p: [x, e.y, e.z],
        r: [0, 0, 0],
        s: [1, 0.85, 1],
        c: PUPIL,
        slot: 'eyes',
        smooth: true,
      });
      continue;
    }
    eyeParts.push({ geo: 'sphere', a: [e.size, 12, 10], p: [x, e.y, e.z], s: [1, 1.05, 0.65], c: WHITE, slot: 'eyes', smooth: true });
    eyeParts.push({
      geo: 'sphere',
      a: [e.size * pupil, 10, 8],
      p: [x + side * e.size * 0.05, e.y - e.size * 0.04, e.z + e.size * 0.44],
      s: [1, 1.1, 0.6],
      c: PUPIL,
      slot: 'eyes',
      smooth: true,
    });
    eyeParts.push({
      geo: 'sphere',
      a: [e.size * 0.24, 8, 6],
      p: [x - side * e.size * 0.3, e.y + e.size * 0.34, e.z + e.size * 0.62],
      c: WHITE,
      slot: 'eyes',
      smooth: true,
    });
    if (style === 'sleepy') {
      // a droopy lid over the top of the eye
      const lidColor = sp.parts[0]?.c ?? '#888888';
      eyeParts.push({
        geo: 'sphere',
        a: [e.size * 1.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55],
        p: [x, e.y + e.size * 0.1, e.z],
        s: [1, 1.05, 0.75],
        c: lidColor,
        shade: 0.92,
        slot: 'eyes',
        smooth: true,
      });
    }
    if (style === 'star') {
      eyeParts.push({
        geo: 'torus',
        a: [e.size * 1.35, e.size * 0.12, 4, 12],
        p: [x, e.y, e.z],
        r: [Math.PI / 2, 0, 0],
        c: '#fff6a8',
        slot: 'eyes',
        smooth: true,
      });
    }
  }

  switch (sp.mouth) {
    case 'smile':
      faceParts.push({
        geo: 'torus',
        a: [e.size * 0.95, e.size * 0.24, 5, 12, Math.PI],
        p: [0, e.y - e.size * 1.5, e.z + e.size * 0.34],
        r: [0, 0, Math.PI],
        s: [1, 0.9, 1],
        c: INK,
        slot: 'body',
        smooth: true,
      });
      break;
    case 'cat':
      for (const side of [-1, 1]) {
        faceParts.push({
          geo: 'torus',
          a: [e.size * 0.55, e.size * 0.17, 5, 10, Math.PI],
          p: [side * e.size * 0.52, e.y - e.size * 1.42, e.z + e.size * 0.32],
          s: [1, 0.9, 1],
          c: INK,
          slot: 'body',
          smooth: true,
        });
      }
      break;
    case 'open':
      faceParts.push({
        geo: 'sphere',
        a: [e.size * 0.62, 12, 10],
        p: [0, e.y - e.size * 1.6, e.z + e.size * 0.2],
        s: [1, 0.95, 0.6],
        c: '#4a1f3d',
        slot: 'body',
        smooth: true,
      });
      faceParts.push({
        geo: 'sphere',
        a: [e.size * 0.32, 10, 8],
        p: [0, e.y - e.size * 1.75, e.z + e.size * 0.5],
        s: [1, 0.7, 0.5],
        c: '#ff8fb0',
        slot: 'body',
        smooth: true,
      });
      break;
    case 'fangs':
      faceParts.push({
        geo: 'torus',
        a: [e.size * 0.9, e.size * 0.22, 5, 12, Math.PI],
        p: [0, e.y - e.size * 1.35, e.z + e.size * 0.3],
        r: [0, 0, Math.PI],
        c: INK,
        slot: 'body',
        smooth: true,
      });
      for (const side of [-1, 1]) {
        faceParts.push({
          geo: 'cone',
          a: [e.size * 0.16, e.size * 0.36, 5],
          p: [side * e.size * 0.45, e.y - e.size * 1.35, e.z + e.size * 0.45],
          r: [Math.PI, 0, 0],
          c: WHITE,
          slot: 'body',
          smooth: true,
        });
      }
      break;
    case 'beak':
    default:
      break;
  }

  if (sp.blush) {
    for (const side of [-1, 1]) {
      faceParts.push({
        geo: 'sphere',
        a: [e.size * 0.62, 10, 8],
        p: [side * sp.blush.x, sp.blush.y, sp.blush.z],
        s: [1, 0.6, 0.35],
        c: sp.blush.color,
        slot: 'body',
        smooth: true,
      });
    }
  }

  return { eyeParts, faceParts };
}

/* ------------------------------------------------------------------ */
/* templates                                                           */
/* ------------------------------------------------------------------ */

interface SlotBuild {
  name: string;
  visual: THREE.BufferGeometry;
  hull: THREE.BufferGeometry | null;
  pivot: THREE.Vector3;
  hullThickness: number;
}

interface Template {
  slots: SlotBuild[];
  height: number;
  radius: number;
}

const TEMPLATES = new Map<string, Template>();

/** The primitives disagree about indexing: an icosahedron comes out un-indexed
 *  while spheres, capsules, boxes and cones are indexed. `mergeGeometries`
 *  refuses a mix, so every group is normalised before it is merged. */
function normaliseIndexing(geos: THREE.BufferGeometry[], wantIndex: boolean): THREE.BufferGeometry[] {
  return geos.map((g) => {
    if (!!g.index === wantIndex) return g;
    const next = wantIndex ? mergeVertices(g, 1e-4) : g.toNonIndexed();
    g.dispose();
    return next;
  });
}

function mergeOrThrow(geos: THREE.BufferGeometry[], wantIndex = false): THREE.BufferGeometry | null {
  // Without normalising first, a slot whose first part is an icosahedron merged
  // to nothing and silently lost every part after it.
  const clean = normaliseIndexing(
    geos.filter((g) => g && g.attributes.position && g.attributes.position.count > 0),
    wantIndex,
  );
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  const merged = mergeGeometries(clean, false);
  if (!merged) {
    clean.forEach((g) => g.dispose());
    return clean[0];
  }
  clean.forEach((g) => g.dispose());
  return merged;
}

function buildTemplate(sp: Species): Template {
  const { eyeParts, faceParts } = buildFaceParts(sp);
  const all = [...sp.parts, ...faceParts];

  // group by animation slot
  const bySlot = new Map<string, Part[]>();
  for (const p of all) {
    const key = p.slot ?? 'body';
    const list = bySlot.get(key);
    if (list) list.push(p);
    else bySlot.set(key, [p]);
  }
  for (const p of eyeParts) {
    const list = bySlot.get('eyes');
    if (list) list.push(p);
    else bySlot.set('eyes', [p]);
  }

  const slots: SlotBuild[] = [];
  const box = new THREE.Box3();

  for (const [name, parts] of bySlot) {
    const isEyes = name === 'eyes';
    const visualGeos: THREE.BufferGeometry[] = [];
    const hullGeos: THREE.BufferGeometry[] = [];
    const pivot = new THREE.Vector3();

    for (const p of parts) {
      // visual: non-indexed so we can get chunky faceted normals
      const vis = shape(p.geo, p.a);
      place(vis, p);
      if (!p.smooth) vis.computeVertexNormals();
      paint(vis, p.c, p.shade ?? 1);
      visualGeos.push(vis);

      // hull: indexed + smooth so the outline expands without tearing
      if (!isEyes) {
        const hul = shape(p.geo, p.a);
        place(hul, p);
        paint(hul, '#ffffff');
        hullGeos.push(hul);
      }

      pivot.add(new THREE.Vector3(p.p[0], p.p[1], p.p[2]));
    }
    pivot.divideScalar(parts.length);

    // flat-shaded visuals are merged un-indexed, the outline hull indexed: see
    // normaliseIndexing. A slot that fails to merge would lose parts, so the
    // two groups are never mixed.
    const visual = mergeOrThrow(visualGeos);
    if (!visual) continue;
    visual.computeBoundingSphere();

    let hull: THREE.BufferGeometry | null = null;
    let thickness = 0;
    if (!isEyes && hullGeos.length) {
      const bs = visual.boundingSphere!;
      thickness = Math.min(0.02, Math.max(0.004, bs.radius * 0.085));
      const mergedHull = mergeOrThrow(hullGeos);
      if (mergedHull) {
        mergedHull.computeVertexNormals(); // indexed => smooth, per part
        const pos = mergedHull.attributes.position as THREE.BufferAttribute;
        const nor = mergedHull.attributes.normal as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          pos.setXYZ(
            i,
            pos.getX(i) + nor.getX(i) * thickness,
            pos.getY(i) + nor.getY(i) * thickness,
            pos.getZ(i) + nor.getZ(i) * thickness,
          );
        }
        pos.needsUpdate = true;
        hull = mergedHull;
      }
    }

    slots.push({ name, visual, hull, pivot, hullThickness: thickness });
    box.expandByObject(new THREE.Mesh(visual));
  }

  // height / radius in authored units
  const h = box.max.y - Math.min(0, box.min.y);
  const radius = Math.max(Math.abs(box.max.x), Math.abs(box.min.x), Math.abs(box.max.z), Math.abs(box.min.z), h * 0.4);
  const tpl: Template = { slots, height: Math.max(0.1, h), radius: Math.max(0.08, radius) };
  TEMPLATES.set(sp.id, tpl);
  return tpl;
}

/* ------------------------------------------------------------------ */
/* instances                                                           */
/* ------------------------------------------------------------------ */

export interface Creature {
  root: THREE.Group;
  /** the node that gets squash & stretch */
  body: THREE.Group;
  /** the node that lifts a flying monster off the floor */
  lift: THREE.Group;
  eyes: THREE.Object3D | null;
  slots: Map<string, THREE.Object3D>;
  hulls: THREE.Object3D[];
  shadow: THREE.Mesh;
  pad: THREE.Mesh;
  height: number;
  radius: number;
}

/**
 * Builds a live creature. `scale` is chosen so the monster ends up roughly
 * `heightCm` tall, multiplied by PRESENCE.
 *
 * PRESENCE is the "magic window" allowance: a honest 25cm monster is the size
 * of a tennis ball six metres away, which on a phone screen is a speck she will
 * walk past. Inflating everyone a little makes them read as characters instead
 * of dots, and nobody has ever measured a imaginary monster with a tape.
 */
export const PRESENCE = 1.9;

export function buildCreature(sp: Species, shiny = false): Creature {
  const tpl = TEMPLATES.get(sp.id) ?? buildTemplate(sp);
  const authoredHeight = tpl.height;
  const targetHeight = (sp.heightCm / 100) * PRESENCE * (shiny ? 1.14 : 1);
  const scale = targetHeight / authoredHeight;

  const root = new THREE.Group();
  const lift = new THREE.Group();
  const body = new THREE.Group();
  lift.add(body);
  root.add(lift);

  const mat = shiny ? shinyMaterialFor(sp.id) : BODY_MAT;
  const eyeMat = shiny ? mat : EYE_MAT;

  const slots = new Map<string, THREE.Object3D>();
  const hulls: THREE.Object3D[] = [];

  for (const s of tpl.slots) {
    const node = new THREE.Group();
    node.position.copy(s.pivot);
    const isEyes = s.name === 'eyes';
    const mesh = new THREE.Mesh(s.visual, isEyes ? eyeMat : mat);
    mesh.position.set(-s.pivot.x, -s.pivot.y, -s.pivot.z);
    node.add(mesh);
    if (s.hull) {
      const hull = new THREE.Mesh(s.hull, OUTLINE_MAT);
      hull.position.copy(mesh.position);
      hull.userData.thickness = s.hullThickness;
      node.add(hull);
      hulls.push(hull);
    }
    body.add(node);
    slots.set(s.name, node);
  }

  const el = ELEMENTS[sp.element] ?? ELEMENTS.star;
  const shadow = makeGroundShadow();
  shadow.position.y = 0.001;
  const pad = makeGlowPad(shiny ? '#fff2a8' : el.glow);
  pad.position.y = 0.002;
  const footprint = tpl.radius * scale;
  shadow.scale.setScalar(footprint * 1.25);
  pad.scale.setScalar(footprint * 1.9);
  root.add(shadow, pad);

  root.scale.setScalar(scale);

  return {
    root,
    body,
    lift,
    eyes: slots.get('eyes') ?? null,
    slots,
    hulls,
    shadow,
    pad,
    height: targetHeight,
    radius: tpl.radius * scale,
  };
}

/** Reusable static creature for UI stages (collection cards, reward pop-up). */
export function buildShowCreature(sp: Species, shiny: boolean, opts: { pad?: boolean } = {}): Creature {
  const c = buildCreature(sp, shiny);
  if (opts.pad === false) {
    c.root.remove(c.shadow, c.pad);
  }
  return c;
}
