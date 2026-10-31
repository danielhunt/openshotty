/* ============================================================
   Species roster — every monster is built from primitive shapes,
   so the whole bestiary ships as a few KB of data.
   ============================================================ */

import type { VoiceKind } from '../core/audio';

export type Rarity = 'common' | 'rare' | 'epic' | 'legend';

export interface ElementInfo {
  key: string;
  name: string;
  icon: string;
  color: string;
  glow: string;
}

export const ELEMENTS: Record<string, ElementInfo> = {
  cloud: { key: 'cloud', name: 'Cloud', icon: '☁️', color: '#bfe6ff', glow: '#8fd0ff' },
  aqua: { key: 'aqua', name: 'Aqua', icon: '💧', color: '#59d2ff', glow: '#2ea8ff' },
  leaf: { key: 'leaf', name: 'Leaf', icon: '🍃', color: '#a7f36a', glow: '#5fd23a' },
  ember: { key: 'ember', name: 'Ember', icon: '🔥', color: '#ff9b5b', glow: '#ff5f2e' },
  spark: { key: 'spark', name: 'Spark', icon: '⚡', color: '#ffd93d', glow: '#ffb300' },
  gummy: { key: 'gummy', name: 'Gummy', icon: '🍬', color: '#ff6b9d', glow: '#ff2f77' },
  moss: { key: 'moss', name: 'Moss', icon: '🌿', color: '#8fd06f', glow: '#4f9e35' },
  spook: { key: 'spook', name: 'Spook', icon: '👻', color: '#d7c7ff', glow: '#a58cff' },
  wind: { key: 'wind', name: 'Wind', icon: '🌬️', color: '#cdf3ff', glow: '#7fd8f5' },
  sweet: { key: 'sweet', name: 'Sweet', icon: '🍫', color: '#d59a6a', glow: '#a86a35' },
  gem: { key: 'gem', name: 'Gem', icon: '💎', color: '#b98cff', glow: '#7b3cff' },
  star: { key: 'star', name: 'Star', icon: '⭐️', color: '#ffe066', glow: '#ffc21f' },
};

export const RARITY: Record<Rarity, { name: string; weight: number; xp: number; color: string }> = {
  common: { name: 'Common', weight: 100, xp: 12, color: '#a7f36a' },
  rare: { name: 'Rare', weight: 34, xp: 26, color: '#59d2ff' },
  epic: { name: 'Epic', weight: 12, xp: 55, color: '#b98cff' },
  legend: { name: 'Legendary', weight: 3, xp: 120, color: '#ffd93d' },
};

export type GeoKind = 'icosa' | 'sphere' | 'capsule' | 'cone' | 'box' | 'torus' | 'disc' | 'cyl';

export interface Part {
  geo: GeoKind;
  /** geometry constructor args */
  a: number[];
  p: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
  c: string;
  /** brightness multiplier applied to the colour */
  shade?: number;
  /** animation slot; parts with the same slot move together */
  slot?: string;
  smooth?: boolean;
}

export interface Eyes {
  y: number;
  z: number;
  size: number;
  spacing: number;
  pupil?: number;
  style?: 'round' | 'happy' | 'sleepy' | 'star';
}

export interface Behaviour {
  /** how restlessly it wanders, 0..1 */
  energy: number;
  /** hops while walking */
  hop: number;
  /** hover height above the floor in metres (0 = walks) */
  hover: number;
  /** how far it runs away when you get close, metres */
  shy: number;
  /** body wobble speed */
  wobble: number;
}

export interface Species {
  id: string;
  name: string;
  element: string;
  rarity: Rarity;
  /** authored so 1 unit ≈ 1 m tall */
  parts: Part[];
  eyes: Eyes;
  mouth?: 'smile' | 'open' | 'cat' | 'fangs' | 'beak';
  blush?: { y: number; z: number; x: number; color: string };
  behaviour: Behaviour;
  voice: { kind: VoiceKind; base: number };
  /** how tall it is, in cm, for the collection card */
  heightCm: number;
  fact: string;
  habitat: string;
}

const D = { x: Math.PI / 2, y: Math.PI / 2, z: Math.PI };

/* ------------------------------------------------------------------ */
/* helpers that keep each species definition short and readable        */
/* ------------------------------------------------------------------ */

const blob = (r: number, c: string, squash = 1, detail = 1, slot = 'body'): Part => ({
  geo: 'icosa',
  a: [r, detail],
  p: [0, r * squash, 0],
  s: [1, squash, 1],
  c,
  slot,
});

const ball = (r: number, x: number, y: number, z: number, c: string, slot = 'body'): Part => ({
  geo: 'sphere',
  a: [r, 12, 9],
  p: [x, y, z],
  c,
  slot,
  smooth: true,
});

const limb = (r: number, len: number, x: number, y: number, z: number, c: string, slot: string, rz = 0): Part => ({
  geo: 'capsule',
  a: [r, len, 4, 8],
  p: [x, y, z],
  r: [0, 0, rz],
  c,
  slot,
  smooth: true,
});

const cone = (r: number, h: number, x: number, y: number, z: number, c: string, slot = 'body', seg = 7): Part => ({
  geo: 'cone',
  a: [r, h, seg],
  p: [x, y, z],
  c,
  slot,
});

const leaf = (r: number, x: number, y: number, z: number, c: string, slot = 'body', ry = 0): Part => ({
  geo: 'disc',
  a: [r, r * 0.28, 5, 1],
  p: [x, y, z],
  r: [D.x, ry, 0],
  s: [1, 1.7, 1],
  c,
  slot,
});

export const SPECIES: Species[] = [
  {
    id: 'pufflo',
    name: 'Pufflo',
    element: 'cloud',
    rarity: 'common',
    heightCm: 34,
    fact: 'Pufflo is made of one very small cloud. It sneezes confetti when it is happy.',
    habitat: 'Likes floating near the ceiling of the bedroom.',
    eyes: { y: 0.3, z: 0.24, size: 0.075, spacing: 0.13, style: 'happy' },
    blush: { y: 0.22, z: 0.22, x: 0.19, color: '#ffb3c8' },
    mouth: 'smile',
    voice: { kind: 'boop', base: 300 },
    behaviour: { energy: 0.35, hop: 0.02, hover: 0.55, shy: 0.6, wobble: 1.1 },
    parts: [
      { geo: 'icosa', a: [0.28, 1], p: [0, 0.3, 0], s: [1.15, 0.86, 1], c: '#f4fbff', slot: 'body' },
      { geo: 'icosa', a: [0.16, 1], p: [-0.22, 0.36, 0.02], c: '#eaf6ff', slot: 'float' },
      { geo: 'icosa', a: [0.13, 1], p: [0.21, 0.4, -0.02], c: '#eaf6ff', slot: 'float' },
      { geo: 'icosa', a: [0.12, 1], p: [0.02, 0.46, -0.12], c: '#e3f2ff', slot: 'float' },
      limb(0.05, 0.07, -0.1, 0.05, 0.03, '#ffd93d', 'legL', 0),
      limb(0.05, 0.07, 0.1, 0.05, 0.03, '#ffd93d', 'legR', 0),
    ],
  },
  {
    id: 'bloop',
    name: 'Bloop',
    element: 'aqua',
    rarity: 'common',
    heightCm: 28,
    fact: 'Bloop is mostly a bubble with opinions. It hums when the bath water is running.',
    habitat: 'Found near sinks, baths and puddles.',
    eyes: { y: 0.3, z: 0.22, size: 0.08, spacing: 0.12 },
    mouth: 'open',
    voice: { kind: 'boop', base: 420 },
    behaviour: { energy: 0.5, hop: 0.03, hover: 0.32, shy: 0.5, wobble: 1.6 },
    parts: [
      { geo: 'sphere', a: [0.26, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62], p: [0, 0.26, 0], s: [1, 1.1, 1], c: '#7fe4ff', slot: 'body', smooth: true },
      { geo: 'sphere', a: [0.19, 14, 10], p: [0, 0.2, 0], s: [1, 0.8, 1], c: '#2ea8ff', slot: 'body', smooth: true },
      { geo: 'torus', a: [0.24, 0.05, 8, 14], p: [0, 0.19, 0], r: [D.x, 0, 0], c: '#59d2ff', slot: 'float' },
      limb(0.032, 0.1, -0.14, 0.08, 0.06, '#9fe9ff', 'tentA'),
      limb(0.032, 0.12, 0.05, 0.07, 0.14, '#9fe9ff', 'tentB'),
      limb(0.032, 0.1, 0.16, 0.08, -0.02, '#9fe9ff', 'tentC'),
      limb(0.032, 0.13, -0.04, 0.06, -0.14, '#9fe9ff', 'tentD'),
    ],
  },
  {
    id: 'sproutle',
    name: 'Sproutle',
    element: 'leaf',
    rarity: 'common',
    heightCm: 30,
    fact: 'Sproutle grows a new leaf every time it hears somebody sing. It is a terrible singer.',
    habitat: 'Hides in plant pots and under chairs.',
    eyes: { y: 0.28, z: 0.2, size: 0.07, spacing: 0.11 },
    blush: { y: 0.2, z: 0.19, x: 0.16, color: '#ff9ec0' },
    mouth: 'cat',
    voice: { kind: 'chirp', base: 620 },
    behaviour: { energy: 0.7, hop: 0.06, hover: 0, shy: 0.9, wobble: 1.4 },
    parts: [
      blob(0.24, '#a7f36a', 1.02, 1),
      { geo: 'sphere', a: [0.15, 12, 9], p: [0, 0.2, 0.1], s: [1, 0.85, 0.6], c: '#e6ffd0', slot: 'body', smooth: true },
      leaf(0.13, -0.16, 0.5, 0, '#7fd94a', 'earL', -0.6),
      leaf(0.13, 0.16, 0.5, 0, '#7fd94a', 'earR', 0.6),
      { geo: 'capsule', a: [0.028, 0.1, 4, 6], p: [0, 0.5, 0], c: '#6bbd3c', slot: 'float', smooth: true },
      limb(0.055, 0.05, -0.1, 0.04, 0.02, '#8fe05a', 'legL'),
      limb(0.055, 0.05, 0.1, 0.04, 0.02, '#8fe05a', 'legR'),
    ],
  },
  {
    id: 'emberkit',
    name: 'Emberkit',
    element: 'ember',
    rarity: 'common',
    heightCm: 36,
    fact: 'Emberkit’s tail is a candle flame that never burns anything. Cuddles included.',
    habitat: 'Sits in warm sunny patches on the floor.',
    eyes: { y: 0.29, z: 0.22, size: 0.068, spacing: 0.11 },
    mouth: 'cat',
    blush: { y: 0.22, z: 0.2, x: 0.15, color: '#ff7a5c' },
    voice: { kind: 'trill', base: 540 },
    behaviour: { energy: 0.9, hop: 0.08, hover: 0, shy: 0.4, wobble: 1.8 },
    parts: [
      { geo: 'icosa', a: [0.23, 1], p: [0, 0.24, 0], s: [1, 0.95, 1.1], c: '#ff9b5b', slot: 'body' },
      { geo: 'sphere', a: [0.14, 12, 9], p: [0, 0.19, 0.12], s: [1, 0.8, 0.7], c: '#ffe4c8', slot: 'body', smooth: true },
      cone(0.07, 0.14, -0.12, 0.44, -0.01, '#ff7a3d', 'earL'),
      cone(0.07, 0.14, 0.12, 0.44, -0.01, '#ff7a3d', 'earR'),
      { geo: 'cone', a: [0.09, 0.24, 6], p: [0, 0.34, -0.24], r: [-D.x * 0.62, 0, 0], c: '#ffd93d', slot: 'tail' },
      { geo: 'cone', a: [0.055, 0.14, 6], p: [0, 0.46, -0.32], r: [-D.x * 0.5, 0, 0], c: '#fff6a8', slot: 'tail' },
      limb(0.05, 0.06, -0.1, 0.05, 0.04, '#ff8a4d', 'legL'),
      limb(0.05, 0.06, 0.1, 0.05, 0.04, '#ff8a4d', 'legR'),
    ],
  },
  {
    id: 'zizzle',
    name: 'Zizzle',
    element: 'spark',
    rarity: 'common',
    heightCm: 25,
    fact: 'Zizzle gives one tiny static shock per day. It saves them for hugs.',
    habitat: 'Zips around carpets and woollies.',
    eyes: { y: 0.28, z: 0.2, size: 0.082, spacing: 0.12 },
    mouth: 'smile',
    voice: { kind: 'chirp', base: 880 },
    behaviour: { energy: 1, hop: 0.11, hover: 0.2, shy: 1.3, wobble: 2.4 },
    parts: [
      blob(0.22, '#ffd93d', 1, 1),
      { geo: 'cone', a: [0.06, 0.14, 4], p: [-0.1, 0.44, 0], r: [0, 0, -0.3], c: '#ffb300', slot: 'float' },
      { geo: 'cone', a: [0.055, 0.12, 4], p: [0.08, 0.45, -0.04], r: [0, 0, 0.4], c: '#ffb300', slot: 'float' },
      { geo: 'cone', a: [0.05, 0.11, 4], p: [0.02, 0.44, 0.1], c: '#ffb300', slot: 'float' },
      limb(0.04, 0.06, -0.14, 0.1, 0.06, '#ffe066', 'armL', 0.9),
      limb(0.04, 0.06, 0.14, 0.1, 0.06, '#ffe066', 'armR', -0.9),
      limb(0.045, 0.05, -0.08, 0.04, 0.02, '#ffc61a', 'legL'),
      limb(0.045, 0.05, 0.08, 0.04, 0.02, '#ffc61a', 'legR'),
    ],
  },
  {
    id: 'snortle',
    name: 'Snortle',
    element: 'moss',
    rarity: 'common',
    heightCm: 40,
    fact: 'Snortle hoards socks under the sofa. It has never once explained why.',
    habitat: 'Under furniture. Always under furniture.',
    eyes: { y: 0.27, z: 0.25, size: 0.06, spacing: 0.1, style: 'sleepy' },
    mouth: 'fangs',
    voice: { kind: 'honk', base: 220 },
    behaviour: { energy: 0.45, hop: 0.02, hover: 0, shy: 0.3, wobble: 0.9 },
    parts: [
      { geo: 'icosa', a: [0.26, 1], p: [0, 0.25, 0], s: [1.15, 0.9, 1], c: '#9ad06f', slot: 'body' },
      { geo: 'sphere', a: [0.11, 12, 9], p: [0, 0.2, 0.22], s: [1.2, 0.9, 0.7], c: '#c9e8a8', slot: 'body', smooth: true },
      { geo: 'torus', a: [0.09, 0.03, 6, 10, Math.PI * 1.4], p: [0.16, 0.24, 0.2], r: [D.x, 0, 0.4], c: '#7bc96f', slot: 'tail' },
      cone(0.05, 0.09, -0.13, 0.44, 0, '#7bc96f', 'earL'),
      cone(0.05, 0.09, 0.13, 0.44, 0, '#7bc96f', 'earR'),
      { geo: 'icosa', a: [0.07, 0], p: [-0.06, 0.48, -0.04], c: '#e0655f', slot: 'float' },
      { geo: 'cyl', a: [0.03, 0.02, 0.06, 6], p: [0.06, 0.47, 0.02], c: '#8a5f3a', slot: 'float' },
      limb(0.06, 0.05, -0.13, 0.05, 0.03, '#87c25f', 'legL'),
      limb(0.06, 0.05, 0.13, 0.05, 0.03, '#87c25f', 'legR'),
    ],
  },
  {
    id: 'gummint',
    name: 'Gummint',
    element: 'gummy',
    rarity: 'rare',
    heightCm: 26,
    fact: 'Gummint is squishy, smells faintly of strawberries, and is 90% wiggle.',
    habitat: 'Near snack places. Follows the smell of jelly.',
    eyes: { y: 0.27, z: 0.19, size: 0.075, spacing: 0.11 },
    mouth: 'smile',
    blush: { y: 0.2, z: 0.18, x: 0.15, color: '#ff3d7f' },
    voice: { kind: 'boop', base: 500 },
    behaviour: { energy: 0.6, hop: 0.05, hover: 0, shy: 0.7, wobble: 2.8 },
    parts: [
      blob(0.21, '#ff6b9d', 0.95, 1),
      ball(0.13, -0.14, 0.36, 0, '#ff8fb4', 'earL'),
      ball(0.13, 0.14, 0.36, 0, '#ff8fb4', 'earR'),
      { geo: 'sphere', a: [0.14, 12, 9], p: [0, 0.18, 0.09], s: [1, 0.8, 0.7], c: '#ffd0e0', slot: 'body', smooth: true },
      limb(0.05, 0.05, -0.16, 0.14, 0.05, '#ff87ae', 'armL', 1.1),
      limb(0.05, 0.05, 0.16, 0.14, 0.05, '#ff87ae', 'armR', -1.1),
      limb(0.055, 0.05, -0.09, 0.04, 0.02, '#ff5f97', 'legL'),
      limb(0.055, 0.05, 0.09, 0.04, 0.02, '#ff5f97', 'legR'),
    ],
  },
  {
    id: 'mossbert',
    name: 'Mossbert',
    element: 'moss',
    rarity: 'rare',
    heightCm: 45,
    fact: 'Mossbert is a very old, very sleepy rock with a moss hat. He naps standing up.',
    habitat: 'Quiet corners, bookshelves, the top of the fridge.',
    eyes: { y: 0.26, z: 0.24, size: 0.062, spacing: 0.12, style: 'sleepy' },
    mouth: 'smile',
    voice: { kind: 'boop', base: 175 },
    behaviour: { energy: 0.18, hop: 0.01, hover: 0, shy: 0.2, wobble: 0.6 },
    parts: [
      { geo: 'icosa', a: [0.28, 0], p: [0, 0.24, 0], s: [1.1, 0.88, 1], c: '#8b8577', slot: 'body' },
      { geo: 'icosa', a: [0.24, 1], p: [0, 0.4, 0], s: [1.1, 0.5, 1.05], c: '#8fd06f', slot: 'float' },
      { geo: 'cyl', a: [0.03, 0.022, 0.1, 6], p: [-0.1, 0.5, 0.04], c: '#e8e0cf', slot: 'float', smooth: true },
      { geo: 'icosa', a: [0.05, 0], p: [-0.1, 0.56, 0.04], c: '#e0655f', slot: 'float' },
      { geo: 'cyl', a: [0.024, 0.018, 0.08, 6], p: [0.12, 0.48, -0.03], c: '#e8e0cf', slot: 'float', smooth: true },
      { geo: 'icosa', a: [0.04, 0], p: [0.12, 0.53, -0.03], c: '#e0655f', slot: 'float' },
      limb(0.07, 0.05, -0.14, 0.05, 0.04, '#7d7768', 'legL'),
      limb(0.07, 0.05, 0.14, 0.05, 0.04, '#7d7768', 'legR'),
    ],
  },
  {
    id: 'wispod',
    name: 'Wispod',
    element: 'spook',
    rarity: 'rare',
    heightCm: 38,
    fact: 'Wispod tries very hard to be a scary ghost. It is actually just a nightlight with manners.',
    habitat: 'Under beds and inside cupboards.',
    eyes: { y: 0.42, z: 0.19, size: 0.072, spacing: 0.11 },
    mouth: 'open',
    voice: { kind: 'wow', base: 330 },
    behaviour: { energy: 0.55, hop: 0, hover: 0.75, shy: 1.5, wobble: 1.2 },
    parts: [
      { geo: 'capsule', a: [0.2, 0.2, 6, 14], p: [0, 0.44, 0], s: [1, 1, 0.9], c: '#efe6ff', slot: 'body', smooth: true },
      { geo: 'cone', a: [0.2, 0.16, 8], p: [0, 0.14, 0], r: [Math.PI, 0, 0], c: '#d7c7ff', slot: 'float' },
      limb(0.05, 0.12, -0.21, 0.42, 0, '#e4d9ff', 'armL', 0.4),
      limb(0.05, 0.12, 0.21, 0.42, 0, '#e4d9ff', 'armR', -0.4),
      { geo: 'icosa', a: [0.07, 0], p: [0, 0.68, 0], c: '#c0aaff', slot: 'float' },
    ],
  },
  {
    id: 'tootwing',
    name: 'Tootwing',
    element: 'wind',
    rarity: 'rare',
    heightCm: 32,
    fact: 'Tootwing inflates itself to float through doorways. Deflating makes a sound nobody mentions.',
    habitat: 'Floating along the ceiling, drifting between rooms.',
    eyes: { y: 0.36, z: 0.24, size: 0.078, spacing: 0.12, style: 'happy' },
    mouth: 'beak',
    voice: { kind: 'trill', base: 720 },
    behaviour: { energy: 0.75, hop: 0, hover: 1.15, shy: 1.1, wobble: 1.5 },
    parts: [
      { geo: 'sphere', a: [0.24, 16, 12], p: [0, 0.4, 0], s: [1, 1.1, 0.95], c: '#e8fbff', slot: 'body', smooth: true },
      { geo: 'sphere', a: [0.15, 12, 9], p: [0, 0.3, 0], s: [1, 0.9, 1], c: '#cdf3ff', slot: 'body', smooth: true },
      { geo: 'cone', a: [0.05, 0.09, 4], p: [0, 0.3, 0.26], r: [D.x, 0, 0], c: '#ffb347', slot: 'body', smooth: true },
      { geo: 'disc', a: [0.16, 0.05, 4, 1], p: [-0.24, 0.46, -0.02], r: [0, 0, 0.5], s: [1, 1.4, 1], c: '#b7ecff', slot: 'wingL' },
      { geo: 'disc', a: [0.16, 0.05, 4, 1], p: [0.24, 0.46, -0.02], r: [0, 0, -0.5], s: [1, 1.4, 1], c: '#b7ecff', slot: 'wingR' },
      { geo: 'cone', a: [0.06, 0.12, 5], p: [0, 0.62, -0.06], c: '#a9e6ff', slot: 'float' },
    ],
  },
  {
    id: 'danglo',
    name: 'Danglo',
    element: 'spark',
    rarity: 'rare',
    heightCm: 30,
    fact: 'Danglo hangs from doorframes like a very friendly lantern. It lights the way to biscuits.',
    habitat: 'Doorways, stair rails, coat hooks.',
    eyes: { y: 0.42, z: 0.2, size: 0.07, spacing: 0.1 },
    mouth: 'smile',
    voice: { kind: 'chirp', base: 760 },
    behaviour: { energy: 0.4, hop: 0, hover: 1.5, shy: 0.8, wobble: 1.9 },
    parts: [
      { geo: 'sphere', a: [0.2, 16, 12], p: [0, 0.42, 0], s: [1, 0.95, 1], c: '#ffe066', slot: 'body', smooth: true },
      { geo: 'cyl', a: [0.02, 0.02, 0.5, 6], p: [0, 0.78, 0], c: '#8a7a4a', slot: 'float', smooth: true },
      { geo: 'cone', a: [0.12, 0.1, 8], p: [0, 0.56, 0], c: '#ffc61a', slot: 'float' },
      { geo: 'torus', a: [0.2, 0.03, 6, 14], p: [0, 0.42, 0], r: [D.x, 0, 0], c: '#ffb300', slot: 'body' },
      limb(0.035, 0.09, -0.13, 0.28, 0.05, '#ffd23d', 'armL', 0.6),
      limb(0.035, 0.09, 0.13, 0.28, 0.05, '#ffd23d', 'armR', -0.6),
    ],
  },
  {
    id: 'cocoa',
    name: 'Cocoa',
    element: 'sweet',
    rarity: 'epic',
    heightCm: 34,
    fact: 'Cocoa is warm on the outside and marshmallow all the way through. Do not lick. She mind.',
    habitat: 'Kitchen counters and the top of the biscuit tin.',
    eyes: { y: 0.29, z: 0.22, size: 0.072, spacing: 0.11 },
    mouth: 'smile',
    blush: { y: 0.22, z: 0.2, x: 0.16, color: '#ff9db0' },
    voice: { kind: 'boop', base: 260 },
    behaviour: { energy: 0.35, hop: 0.03, hover: 0, shy: 0.5, wobble: 1.0 },
    parts: [
      { geo: 'icosa', a: [0.25, 1], p: [0, 0.26, 0], s: [1.05, 0.95, 1], c: '#8a5a3c', slot: 'body' },
      { geo: 'sphere', a: [0.16, 14, 10], p: [0, 0.2, 0.1], s: [1, 0.8, 0.7], c: '#f3e2cf', slot: 'body', smooth: true },
      { geo: 'icosa', a: [0.1, 1], p: [0, 0.5, 0], s: [1, 0.8, 1], c: '#fff6ea', slot: 'float' },
      { geo: 'icosa', a: [0.06, 0], p: [-0.16, 0.44, 0.06], c: '#ff6b9d', slot: 'float' },
      { geo: 'icosa', a: [0.06, 0], p: [0.17, 0.42, -0.03], c: '#a7f36a', slot: 'float' },
      limb(0.055, 0.05, -0.12, 0.05, 0.03, '#7a4c31', 'legL'),
      limb(0.055, 0.05, 0.12, 0.05, 0.03, '#7a4c31', 'legR'),
    ],
  },
  {
    id: 'pebblit',
    name: 'Pebblit',
    element: 'gem',
    rarity: 'epic',
    heightCm: 30,
    fact: 'Pebblit is a living paperweight. It makes rainbows on the wall and is extremely proud of this.',
    habitat: 'Windowsills and shiny places.',
    eyes: { y: 0.27, z: 0.2, size: 0.07, spacing: 0.11, style: 'star' },
    mouth: 'smile',
    voice: { kind: 'trill', base: 980 },
    behaviour: { energy: 0.5, hop: 0.05, hover: 0.1, shy: 0.9, wobble: 1.3 },
    parts: [
      { geo: 'icosa', a: [0.24, 0], p: [0, 0.25, 0], s: [1, 1.05, 1], c: '#b98cff', slot: 'body' },
      cone(0.08, 0.2, -0.12, 0.5, 0, '#d7baff', 'float'),
      cone(0.06, 0.16, 0.1, 0.48, 0.05, '#e9d6ff', 'float'),
      cone(0.05, 0.13, 0.02, 0.5, -0.11, '#d7baff', 'float'),
      { geo: 'icosa', a: [0.07, 0], p: [-0.19, 0.2, 0.06], c: '#9a6bff', slot: 'armL' },
      { geo: 'icosa', a: [0.07, 0], p: [0.19, 0.2, 0.06], c: '#9a6bff', slot: 'armR' },
      limb(0.05, 0.05, -0.09, 0.04, 0.02, '#8f5cff', 'legL'),
      limb(0.05, 0.05, 0.09, 0.04, 0.02, '#8f5cff', 'legR'),
    ],
  },
  {
    id: 'starbeam',
    name: 'Starbeam',
    element: 'star',
    rarity: 'legend',
    heightCm: 42,
    fact: 'Starbeam fell out of the sky because it heard somebody laughing. It stays for exactly that reason.',
    habitat: 'Appears once, in the brightest room in the house.',
    eyes: { y: 0.32, z: 0.22, size: 0.08, spacing: 0.12, style: 'star' },
    mouth: 'smile',
    blush: { y: 0.25, z: 0.2, x: 0.17, color: '#ffa8c8' },
    voice: { kind: 'wow', base: 660 },
    behaviour: { energy: 0.8, hop: 0.06, hover: 0.6, shy: 1.8, wobble: 1.6 },
    parts: [
      { geo: 'icosa', a: [0.26, 1], p: [0, 0.32, 0], s: [1, 1, 1], c: '#ffe066', slot: 'body' },
      { geo: 'cone', a: [0.075, 0.26, 5], p: [0, 0.6, -0.02], c: '#fff6a8', slot: 'float' },
      { geo: 'cone', a: [0.06, 0.2, 5], p: [-0.16, 0.62, 0], r: [0, 0, 0.5], c: '#ffd93d', slot: 'float' },
      { geo: 'cone', a: [0.06, 0.2, 5], p: [0.16, 0.62, 0], r: [0, 0, -0.5], c: '#ffd93d', slot: 'float' },
      { geo: 'torus', a: [0.3, 0.025, 6, 20], p: [0, 0.32, 0], r: [D.x, 0, 0], c: '#fff6a8', slot: 'float' },
      { geo: 'cone', a: [0.1, 0.3, 6], p: [0, 0.3, -0.3], r: [-D.x * 0.7, 0, 0], c: '#ffb347', slot: 'tail' },
      limb(0.05, 0.06, -0.13, 0.09, 0.08, '#ffd93d', 'armL', 1.0),
      limb(0.05, 0.06, 0.13, 0.09, 0.08, '#ffd93d', 'armR', -1.0),
      limb(0.055, 0.06, -0.1, 0.05, 0.02, '#ffc61a', 'legL'),
      limb(0.055, 0.06, 0.1, 0.05, 0.02, '#ffc61a', 'legR'),
    ],
  },
];

export const SPECIES_BY_ID: Record<string, Species> = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

export function pickSpecies(opts: { allowSeen: boolean; seen: string[]; luck?: number }): Species {
  const pool = SPECIES.filter((s) => opts.allowSeen || !opts.seen.includes(s.id));
  const list = pool.length ? pool : SPECIES;
  const luck = opts.luck ?? 1;
  let total = 0;
  const weights = list.map((s) => {
    // commons are the bread and butter; luck only lifts the exciting ones
    const boost = RARITY[s.rarity].weight * (s.rarity === 'common' ? 1 : luck);
    const seenBoost = opts.seen.includes(s.id) ? 0.72 : 1.35; // gently steer toward new monsters
    const w = boost * seenBoost;
    total += w;
    return w;
  });
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}
