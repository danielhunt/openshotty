/* ============================================================
   Monster Hunt AR — the game host.

   Order of business each frame:
   sensors -> camera -> world -> orbs -> effects -> labels -> draw
   ============================================================ */

import * as THREE from 'three';
import { AudioEngine } from './core/audio';
import { makeRing, timeUniform } from './core/art';
import { MotionTracker } from './ar/motion';
import { buildDreamland, buildLighting, RoomBackdrop } from './ar/room';
import { Particles } from './fx/particles';
import { OrbThrower, type CaptureHooks } from './game/capture';
import { Monster, type MonsterHooks } from './game/monster';
import { ELEMENTS, RARITY, SPECIES_BY_ID, type Rarity, type Species } from './game/species';
import { rankFor, xpForLevel, Progress } from './game/save';
import { World, type WorldHooks } from './game/world';
import { $, Ui } from './ui/ui';

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function vibrate(ms: number | number[]) {
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  nav.vibrate?.(ms);
}

function speak(text: string) {
  const synth = window.speechSynthesis;
  if (!synth || !progress.data.settings.voice) return;
  if (synth.speaking) return;
  const u = new SpeechSynthesisUtterance(text);
  u.pitch = 1.45;
  u.rate = 0.94;
  u.volume = 0.95;
  synth.speak(u);
}

/* ------------------------------------------------------------------ */
/* core objects                                                        */
/* ------------------------------------------------------------------ */

const ui = new Ui();
const progress = new Progress();
// `?fresh` (documented in the README, and used by the dev phone frame) starts a
// clean adventure instead of loading the save on this phone.
if (new URLSearchParams(location.search).has('fresh')) {
  progress.reset();
}
const audio = new AudioEngine();
const canvas = $<HTMLCanvasElement>('gl');
const video = $<HTMLVideoElement>('camera-feed');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
let baseDpr = Math.min(window.devicePixelRatio || 1, 2); // may drop for weak GPUs
renderer.setPixelRatio(baseDpr);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearAlpha(0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.set(0, 1.32, 0);
scene.add(buildLighting());

const dream = buildDreamland();
dream.group.visible = false;
scene.add(dream.group);

const particles = new Particles(scene);
const world = new World(scene, progress);
const thrower = new OrbThrower(scene, particles, camera);
const room = new RoomBackdrop(video);
const motion = new MotionTracker({ walkSensitivity: progress.data.settings.walk, tiltSpeed: progress.data.settings.tilt });

/** Hoop on the floor under whichever monster the lock plate is naming, so the
 *  "who did the game pick" answer is drawn in the world instead of only in a
 *  reticle that lives in the middle of the screen. */
const lockRing = makeRing('#ffd93d');
lockRing.visible = false;
scene.add(lockRing);

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

let mode: 'boot' | 'perms' | 'calibrate' | 'play' = 'boot';
let dreamMode = false;
let time = 0;
let streak = 0;
let throwsSinceGolden = 0;
let shakeVec = new THREE.Vector3();
let calTimer = 0;
let hudTick = 0;
let monsterCalls = 0;
let lastSpawnPuff = 0;
let roarLevel = 0;
const seenThisRun = new Set<string>();

/* ------------------------------------------------------------------ */
/* audio + world hooks                                                 */
/* ------------------------------------------------------------------ */

const silence = {
  call: () => undefined,
  puff: () => undefined,
  sparkle: () => undefined,
};

const monsterHooks: MonsterHooks = {
  call(m) {
    monsterCalls += 1;
    if (monsterCalls % 2 === 0 || m.species.voice.kind === 'wow') {
      audio.call(m.species.voice.kind, m.species.voice.base, (m.uid % 3) - 1);
    }
  },
  puff(m) {
    const now = performance.now() / 1000;
    if (now - lastSpawnPuff < 0.35) return;
    lastSpawnPuff = now;
    const c = m.center;
    particles.burst(c, { color: ['#ffffff', ELEMENTS[m.species.element]?.color ?? '#ffffff'], count: 7, speed: 0.9, life: 0.5, size: 0.06, gravity: -0.6 });
  },
  sparkle(m) {
    const c = m.center;
    particles.burst(c, { color: ['#fff6a8', '#ffffff'], count: 12, speed: 1.1, life: 0.7, size: 0.075, gravity: -0.4, drag: 2.2 });
    particles.ring(new THREE.Vector3(m.pos.x, 0.02, m.pos.z), ELEMENTS[m.species.element]?.glow ?? '#ffd93d', 0.1, 0.9, 0.5);
    if (!seenThisRun.has(m.species.id) && progress.data.seen.includes(m.species.id)) {
      seenThisRun.add(m.species.id);
      ui.hint(`${m.species.name} spotted that look!`, 2.6);
    }
  },
};

const worldHooks: WorldHooks = {
  ...silence,
  ...monsterHooks,
  fxPuff(pos, color) {
    particles.burst(pos, { color: [color], count: 6, speed: 0.5, life: 0.45, size: 0.05, gravity: -0.3 });
  },
  onSpawned(m) {
    audio.popIn();
    particles.ring(new THREE.Vector3(m.pos.x, 0.02, m.pos.z), m.shiny ? '#fff2a8' : '#ffffff', 0.08, m.radius * 4, 0.55);
    if (m.shiny) {
      particles.burst(m.center, { color: ['#fff6a8', '#ffd93d', '#ff6b9d'], count: 22, speed: 1.5, life: 1, size: 0.09, gravity: -0.8 });
      ui.toast('Something sparkly appeared!', 'big');
      audio.roarReady();
    }
  },
  onRemoved(m, reason) {
    if (reason === 'escaped') particles.burst(m.center, { color: ['#ffffff', '#d7c7ff'], count: 16, speed: 1.6, life: 0.6, size: 0.08 });
  },
};

const captureHooks: CaptureHooks = {
  orbLaunched(target) {
    if (!progress.spendOrb()) return;
    audio.throwOrb();
    vibrate(8);
    streak = target ? streak + 1 : 0;
    throwsSinceGolden += 1;
    if (target) ui.hint('Nice throw!', 1.4);
  },
  orbMissed() {
    audio.bounce();
  },
  orbHit(m, accuracy) {
    audio.hit();
    audio.zap();
    vibrate([6, 22, 6]);
    particles.shake(0.02 + accuracy * 0.02);
    ui.shakeHud();
    const c = m.center;
    particles.burst(c, { color: ['#ffffff', '#9fdcff', '#ffd93d'], count: 24, speed: 2.1, life: 0.55, size: 0.085, gravity: -1.4 });
    particles.ring(c, '#ffffff', 0.1, m.radius * 5, 0.4);
  },
  beamStart() {
    audio.zap();
    ui.flash(0.4);
  },
  wobble(m, index) {
    audio.wobble();
    vibrate(index === 2 ? [10, 40, 10] : 12);
    particles.shake(0.008);
    const c = m.center;
    particles.ring(c, m.shiny ? '#ffd93d' : '#9fdcff', 0.06, 0.55, 0.4);
    ui.hint(index === 0 ? 'One wobble…' : index === 1 ? 'Two wobbles…' : 'Almost there…', 1.2);
  },
  caught(m, accuracy) {
    audio.captureJingle();
    vibrate([14, 40, 14, 40, 30]);
    ui.flash(0.85);
    ui.confetti(m.shiny ? 130 : 80);
    particles.shake(0.045);
    const c = m.center;
    particles.burst(c, {
      color: m.shiny ? ['#fff6a8', '#ffd93d', '#ff6b9d', '#2de1c2'] : ['#ffd93d', '#ffffff', ELEMENTS[m.species.element]?.glow ?? '#2de1c2'],
      count: 46,
      speed: 2.7,
      life: 1.25,
      size: 0.11,
      gravity: -2.4,
    });
    particles.ring(c, m.shiny ? '#ffd93d' : '#ffffff', 0.1, 2.4, 0.75);
    void finishCatch(m, accuracy);
  },
  escaped(m) {
    audio.escape();
    audio.failJingle();
    vibrate(30);
    m.endCapture(true);
    particles.burst(m.center, { color: ['#ffffff', '#d7c7ff'], count: 22, speed: 2, life: 0.7, size: 0.09 });
    ui.toast(`${m.species.name} wiggle-wobbled away!`, 'missing');
    ui.hint('Almost! Try a closer, steadier throw.', 3.4);
    world.remove(m, 'escaped', worldHooks);
    thrower.finish();
  },
};

/* ------------------------------------------------------------------ */
/* catch rewards                                                       */
/* ------------------------------------------------------------------ */

async function finishCatch(m: Monster, accuracy: number) {
  const sp = m.species;
  const res = progress.recordCatch(sp, m.shiny, m.level, streak);
  progress.markSeen(sp);
  world.remove(m, 'caught', worldHooks);
  thrower.finish();
  mode = 'boot'; // freeze the hunt while the card is up

  // throwing well matters on its own, so a dead-on aim gets its own little win
  if (accuracy > 0.85) {
    progress.addOrbs(1);
    ui.toast('Dead-on throw! Here is an orb back');
    audio.popIn();
  } else if (accuracy > 0.5) {
    ui.toast('Great throw!');
  } else {
    ui.toast('Phew — that was close!');
  }
  syncHud();

  ui.showReward(sp, m.shiny, res.isNew, res.gained);
  ui.show('reward');
  showPreview('reward', sp, m.shiny, ui.rewardStage, 300);
  ui.clearLabels();
  speak(sp.name);

  const pendingLevel = res.leveled;
  const close = () => {
    ui.show('play');
    mode = 'play';
    clearPreview('reward');
    ui.hint('Another monster must be nearby — look around!', 4);
    const ms = progress.pendingMilestone();
    if (ms) {
      ui.toast(ms.text, 'big');
      ui.confetti(60);
      audio.levelUp();
    }
    if (pendingLevel > 0) {
      window.setTimeout(() => {
        ui.showLevelUp(pendingLevel, rankFor(pendingLevel), '+6 Capture Orbs');
        ui.show('levelup');
        audio.levelUp();
        ui.confetti(90);
        window.setTimeout(() => {
          ui.show('play');
          mode = 'play';
        }, 2300);
      }, 320);
    }
    syncHud();
    $('btn-reward-close').removeEventListener('click', close);
  };
  $('btn-reward-close').addEventListener('click', close, { once: true });
}

function syncHud() {
  const d = progress.data;
  ui.setHud({ level: d.level, rank: rankFor(d.level), xp: d.xp, xpNeed: xpForLevel(d.level), orbs: d.orbs });
}

/* ------------------------------------------------------------------ */
/* 3D previews (album cards, detail stage, reward card)                */
/* ------------------------------------------------------------------ */

const previewScene = new THREE.Scene();
previewScene.add(buildLighting());
const previewBackdrop = buildDreamland({ props: false });
previewScene.add(previewBackdrop.group);
const previewCam = new THREE.PerspectiveCamera(30, 1, 0.02, 200);
const previewProbe = { pos: new THREE.Vector3(), lookScore: 0, dist: 99 };

interface PreviewEntry {
  key: string;
  monster: Monster;
  host: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  size: number;
  spin: number;
  persistent: boolean;
  pad: THREE.Mesh;
  /** measured silhouette: height of the middle, and how tall/wide the art really is */
  frame: { y: number; tall: number; wide: number };
}

const previews = new Map<string, PreviewEntry>();

/**
 * Renders the preview scene with the one real WebGL context and copies the
 * pixels into a small 2D canvas. iOS only allows a handful of GL contexts, so
 * every thumbnail, stage and reward image in the game shares this path.
 */
function renderTo(target: HTMLCanvasElement, w: number, h: number) {
  const px = Math.max(1, Math.round(w * baseDpr));
  const py = Math.max(1, Math.round(h * baseDpr));
  renderer.setPixelRatio(1);
  renderer.setSize(px, py, false);
  renderer.render(previewScene, previewCam);

  const ctx = target.getContext('2d');
  if (ctx) {
    if (target.width !== px) target.width = px;
    if (target.height !== py) target.height = py;
    ctx.clearRect(0, 0, px, py);
    ctx.drawImage(renderer.domElement, 0, 0, px, py);
  }

  renderer.setPixelRatio(baseDpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

function clearPreview(key: string) {
  const p = previews.get(key);
  if (!p) return;
  previewScene.remove(p.monster.creature.root);
  if (p.pad) {
    p.pad.geometry.dispose();
    (p.pad.material as THREE.Material).dispose();
  }
  p.monster.dispose();
  previews.delete(key);
}

function showPreview(key: string, sp: Species, shiny: boolean, host: HTMLElement | null, size: number, spin = 0.45, persistent = false) {
  clearPreview(key);
  const monster = new Monster(sp, shiny, 1, new THREE.Vector3(), 9000 + previews.size);
  const root = monster.creature.root;
  const radius = monster.creature.radius;
  previewScene.add(root);

  // Measure the artwork instead of trusting the spec sheet. Guessing from `height`
  // and `radius` was wrong twice over: parts hang *below* the origin (Danglo's tail
  // reaches down 25 cm) and the animated float happens on an inner node, so the old
  // frame was fitted to a silhouette that is not the one on screen. That is how a
  // 43 cm Danglo ended up a 20-pixel speck in a 116-pixel card.
  monster.creature.lift.position.y = Math.max(0, sp.behaviour.hover);
  // Every creature is authored at an arbitrary size and scaled into metres on
  // `root`, and nothing has rendered it yet, so its world matrix is still the
  // identity. Measuring without refreshing that measures the unscaled model: the
  // camera then sits inside the artwork and the head leaves the top of the card.
  root.updateMatrixWorld(true);
  const body = new THREE.Box3().setFromObject(monster.creature.body);
  const middle = body.getCenter(new THREE.Vector3());
  const span = body.getSize(new THREE.Vector3());
  const frame = { y: middle.y, tall: Math.max(span.y, 0.05), wide: Math.max(span.x, span.z, 0.05) };

  // The element glow under the feet. Deliberately no wider than the body, and left
  // out of the frame maths: a camera pulled back to fit a flat ellipse leaves a very
  // small monster in the card.
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(Math.min(radius * 1.05, frame.wide * 0.55), 24),
    new THREE.MeshToonMaterial({ color: shiny ? '#ffe98a' : ELEMENTS[sp.element]?.color ?? '#bfe6ff' }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.004;
  root.add(pad);

  // the host may already *be* the canvas (album thumbnails) or hold one
  let cv: HTMLCanvasElement;
  if (host instanceof HTMLCanvasElement) cv = host;
  else {
    const found = host ? host.querySelector('canvas') : null;
    if (found) cv = found;
    else {
      cv = document.createElement('canvas');
      host?.appendChild(cv);
    }
  }

  // A detached thumbnail canvas has no layout yet, so fall back to the pixel ratio
  // the caller asked for: album badges are 3:4 (see `.card`), and rendering them
  // square then letting CSS stretch the picture vertically shoved every head out of
  // the top of the card.
  const aspect =
    cv.clientWidth > 0 && cv.clientHeight > 0 ? cv.clientWidth / cv.clientHeight : cv.width / Math.max(1, cv.height);
  previews.set(key, { key, monster, host, canvas: cv, size, spin, persistent, pad, frame });
  framePreview(previewCam, frame, aspect, size);
  if (!persistent) {
    renderTo(cv, size, Math.max(1, Math.round(size / Math.max(0.25, aspect))));
    clearPreview(key);
  }
}

/**
 * Pulls the preview camera back until the whole silhouette sits inside the card with
 * a little air around it. Both axes are fitted, so a flat wide Bloop and a tall thin
 * Mossbert end up looking equally "full" next to each other in the grid, which is
 * what makes the album feel like a collection rather than a list.
 */
function framePreview(cam: THREE.PerspectiveCamera, frame: PreviewEntry['frame'], aspect: number, size: number) {
  const ar = THREE.MathUtils.clamp(aspect || 1, 0.35, 2.6);
  cam.aspect = ar;
  cam.fov = ar < 0.85 ? 31 : size > 200 ? 21 : 24; // wider lens for tall panels
  cam.updateProjectionMatrix();
  const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const tanH = tanV * ar;
  const fill = size > 200 ? 0.74 : 0.68; // share of the frame the creature should own
  const dist = THREE.MathUtils.clamp(
    Math.max(frame.tall / (2 * tanV * fill), frame.wide / (2 * tanH * fill)),
    0.12,
    40,
  );
  cam.position.set(0, frame.y + dist * 0.06, dist); // a hint of height, keeps it cute
  cam.lookAt(0, frame.y, 0);
}

function drawPreviews(dt: number) {
  for (const p of previews.values()) {
    if (!p.persistent || !p.canvas) continue;
    if (!p.host || !p.host.isConnected || p.host.offsetParent === null) continue;
    p.monster.yaw += p.spin * dt;
    p.monster.update(dt, time, previewProbe, silence);
    p.canvas.style.width = '100%';
    p.canvas.style.height = '100%';
    const cw = p.host.clientWidth || p.size;
    const ch = p.host.clientHeight || p.size;
    const cap = Math.min(1, (p.size * 2) / Math.max(cw, ch));
    framePreview(previewCam, p.frame, cw / Math.max(1, ch), p.size);
    renderTo(p.canvas, Math.max(1, Math.round(cw * cap)), Math.max(1, Math.round(ch * cap)));
  }
}

function makeThumb(sp: Species, shiny: boolean, size: number) {
  const cv = document.createElement('canvas');
  cv.width = size;
  // Match the album badge (aspect-ratio 3/4) so nothing gets stretched or cut.
  cv.height = Math.round(size * (4 / 3));
  showPreview(`thumb-${sp.id}`, sp, shiny, cv, size, 0, false);
  return cv;
}

let detailSpecies: Species | null = null;
let detailShiny = false;

function openDetail(sp: Species) {
  const mine = progress.entry(sp.id);
  detailSpecies = sp;
  detailShiny = !!mine?.shiny;
  ui.setDetail(sp, detailShiny, mine ? { level: mine.level, cm: mine.cm, n: mine.n } : { level: 0, cm: sp.heightCm, n: 0 }, progress.isFav(sp.id));
  ui.show('detail');
  audio.tap();
  if (mine) {
    showPreview('detail', sp, detailShiny, ui.detailStage, 264, 0.5, true);
  } else {
    ui.detailStage.replaceChildren();
    const q = document.createElement('div');
    q.textContent = `Not found yet — it likes ${sp.habitat.toLowerCase()}.`;
    q.style.cssText = 'opacity:.75;font-size:14px;text-align:center;padding:8px';
    ui.detailStage.appendChild(q);
  }
}

/* spin me */
let stageDragX = 0;
let stageDragging = false;
ui.detailStage.addEventListener(
  'pointerdown',
  (e) => {
    stageDragging = true;
    stageDragX = e.clientX;
  },
  { passive: true },
);
window.addEventListener(
  'pointermove',
  (e) => {
    if (!stageDragging) return;
    const p = previews.get('detail');
    if (p) p.monster.yaw += (e.clientX - stageDragX) * 0.012;
    stageDragX = e.clientX;
  },
  { passive: true },
);
window.addEventListener(
  'pointerup',
  () => {
    stageDragging = false;
  },
  { passive: true },
);

/* ------------------------------------------------------------------ */
/* input                                                               */
/* ------------------------------------------------------------------ */

const keys = new Set<string>();
let pointerDown = false;
let pointerMoved = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let pointerDownAt = 0;
let pointerTarget: EventTarget | null = null;

function throwRay(clientX: number, clientY: number, out: THREE.Vector3) {
  const nx = (clientX / window.innerWidth) * 2 - 1;
  const ny = -((clientY / window.innerHeight) * 2 - 1);
  // unproject a point on the near plane into the world, then aim from the eye
  // through it; without unproject this ignored where the phone is pointing.
  out.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
  return out;
}

/** The monster a tapped name tag belongs to; 0 when the tap was not a tag. */
function tagUid(t: EventTarget | null) {
  const raw = (t as HTMLElement | null)?.closest?.('.mon-label')?.getAttribute('data-uid');
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function wantThrow(clientX: number, clientY: number, pickedUid = 0) {
  if (mode !== 'play') return;
  if (thrower.busy) return;
  if (progress.data.orbs <= 0) {
    ui.toast(`No orbs left — one lands in ${progress.secondsToNextOrb()}s!`, 'missing');
    ui.hint('Orbs come back on their own. Have a look around!', 3);
    audio.back();
    return;
  }

  // A name tag is a tap target like the monster itself: it is the one part of a
  // monster that is never hidden behind the buttons along the bottom.
  const tagged = pickedUid
    ? world.monsters.find((m) => m.uid === pickedUid && thrower.isLive(m)) ?? null
    : null;
  const target = tagged ?? thrower.pickAt(clientX, clientY, world.monsters);

  if (!target && !thrower.anyInView(world.monsters)) {
    // She tapped a blank wall. Do not charge her for the camera moving: an orb
    // costs real time to regrow, and "the room was empty" is not a throw.
    ui.hint('Nobody is in the picture — swing the phone around!', 2.4);
    audio.back();
    return;
  }

  const dir = throwRay(clientX, clientY, new THREE.Vector3());
  const golden = goldenReady();
  thrower.throwOrb(dir, world.monsters, golden, captureHooks, target);
}

function goldenReady() {
  return progress.ownedCount >= 3 && throwsSinceGolden >= 2;
}

const hitButton = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('button, input, .card, .panel, .page-head');

window.addEventListener(
  'pointerdown',
  (e) => {
    pointerTarget = e.target;
    if (hitButton(e.target)) return;
    pointerDown = true;
    pointerMoved = 0;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    pointerDownAt = performance.now();
  },
  { passive: true },
);

window.addEventListener(
  'pointermove',
  (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - lastPointerX;
    const dy = e.clientY - lastPointerY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    pointerMoved += Math.abs(dx) + Math.abs(dy);
    // Dragging is only a stand-in for a gyroscope (desktop, or an iPhone where
    // motion was declined). When the real sensors are live the phone *is* the
    // camera, so panning under her finger as she swings the device would double
    // the motion and make the room swim. A tap still throws either way.
    if (!motion.haveOrientation && mode === 'play') motion.addLook(dx, dy);
  },
  { passive: true },
);

window.addEventListener(
  'pointerup',
  (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    const quick = performance.now() - pointerDownAt < 340;
    if (quick && pointerMoved < 26 && !hitButton(pointerTarget)) wantThrow(e.clientX, e.clientY, tagUid(pointerTarget));
  },
  { passive: true },
);

window.addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.key === ' ') wantThrow(window.innerWidth / 2, window.innerHeight * 0.5);
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

/* ------------------------------------------------------------------ */
/* buttons                                                             */
/* ------------------------------------------------------------------ */

function tap(el: HTMLElement, fn: () => void) {
  el.addEventListener('click', () => {
    audio.unlock();
    audio.tap();
    fn();
  });
}

tap($('btn-play'), () => {
  syncHud();
  ui.show('perms');
  mode = 'perms';
});

tap($('btn-title-settings'), () => {
  ui.syncSettings(progress.data.settings);
  ui.show('settings');
});

tap($('btn-deny'), () => {
  dreamMode = true;
  dream.group.visible = true;
  room.dream();
  motion.enableFallbackSensors();
  startCalibrate('Dreamland mode! Drag to look around.');
});

tap($('btn-allow'), async () => {
  const motionResult = await motion.requestPermission();
  const camResult = await room.start();
  dreamMode = camResult === 'dream';
  dream.group.visible = dreamMode;
  if (dreamMode) ui.toast('No camera — welcome to Dreamland!');
  if (motionResult !== 'granted' && !motion.haveOrientation) {
    motion.enableFallbackSensors();
    ui.toast('Drag to look around');
  }
  audio.roomTone(dreamMode ? 0.2 : 0.6);
  startCalibrate();
});

function startCalibrate(note?: string) {
  mode = 'calibrate';
  calTimer = 0;
  ui.setCalProgress(0);
  ui.show('calibrate');
  if (note) ui.hint(note, 5);
}

tap($('btn-calibrate'), () => {
  motion.calibrate();
  world.begin();
  mode = 'play';
  ui.show('play');
  ui.hint('Look around — monsters hide in corners!', 5);
  audio.roomTone(dreamMode ? 0.25 : 0.7);
  window.setTimeout(() => speak('Monsters are hiding in your house'), 900);
});

tap($('btn-throw'), () => wantThrow(window.innerWidth / 2, window.innerHeight * 0.56));

tap($('btn-sound'), () => {
  const s = progress.data.settings;
  s.sfx = !s.sfx;
  s.music = !s.music;
  audio.sfxOn = s.sfx;
  audio.setMusic(s.music);
  ui.setSoundIcon(s.sfx);
  ui.syncSettings(s);
  ui.toast(s.sfx ? 'Sound on' : 'Quiet mode');
});

tap($('btn-book'), () => {
  ui.buildCollection(progress.data.caught, openDetail, makeThumb);
  ui.show('collection');
});

tap($('btn-close-collection'), () => {
  ui.show('play');
  mode = 'play';
});

tap($('btn-close-detail'), () => {
  clearPreview('detail');
  ui.buildCollection(progress.data.caught, openDetail, makeThumb);
  ui.show('collection');
});

tap($('btn-fav'), () => {
  if (!detailSpecies) return;
  if (!progress.entry(detailSpecies.id)) {
    ui.toast('Catch one first!', 'missing');
    return;
  }
  const on = progress.toggleFav(detailSpecies.id);
  ui.setDetail(detailSpecies, detailShiny, snapshotStats(detailSpecies), on);
  audio.popIn();
  ui.toast(on ? `${detailSpecies.name} is your star friend!` : 'Unstarred');
});

function snapshotStats(sp: Species) {
  const e = progress.entry(sp.id);
  return e ? { level: e.level, cm: e.cm, n: e.n } : { level: 0, cm: sp.heightCm, n: 0 };
}

tap($('btn-detail-call'), () => {
  if (!detailSpecies) return;
  doSummon(detailSpecies.id);
});

tap($('btn-settings'), () => {
  ui.syncSettings(progress.data.settings);
  ui.show('settings');
});

tap($('btn-close-settings'), () => {
  ui.show(mode === 'boot' ? 'title' : 'play');
  if (mode !== 'boot') mode = 'play';
});

tap($('btn-recenter'), () => {
  motion.recenter();
  ui.toast('Facing straight ahead');
});

tap($('btn-reset'), () => {
  if (!window.confirm('Start a new adventure? Your monsters will be forgotten.')) return;
  progress.reset();
  world.clear();
  thrower.abort();
  streak = 0;
  syncHud();
  ui.syncSettings(progress.data.settings);
  ui.show('title');
  mode = 'boot';
});

$('btn-roar').addEventListener('click', () => {
  audio.unlock();
  if (progress.data.settings.roar) {
    void toggleRoarMic();
  } else {
    doSummon();
  }
});

/* ------------------------------------------------------------------ */
/* settings wiring                                                     */
/* ------------------------------------------------------------------ */

function bindToggle(id: string, get: () => boolean, set: (v: boolean) => void) {
  const btn = $(id);
  btn.addEventListener('click', () => {
    const next = !get();
    set(next);
    btn.setAttribute('aria-checked', next ? 'true' : 'false');
    audio.unlock();
    audio.tap();
  });
}

const settings = progress.data.settings;
bindToggle('set-sfx', () => settings.sfx, (v) => ((settings.sfx = v), (audio.sfxOn = v), ui.setSoundIcon(v)));
bindToggle('set-music', () => settings.music, (v) => ((settings.music = v), audio.setMusic(v)));
bindToggle('set-voice', () => settings.voice, (v) => ((settings.voice = v), void (v && speak('I can talk!'))));
bindToggle('set-roar', () => settings.roar, (v) => {
  settings.roar = v;
  if (v) {
    void startRoarMic();
  } else {
    stopRoarMic();
  }
});

function bindRange(id: string, get: () => number, set: (v: number) => void) {
  const input = $(id) as unknown as HTMLInputElement;
  input.value = String(get());
  input.addEventListener('input', () => {
    set(Number(input.value));
    progress.saveSoon();
    audio.tap();
  });
}

bindRange('set-density', () => settings.density, (v) => (settings.density = v));
bindRange('set-sensitivity', () => settings.walk, (v) => ((settings.walk = v), motion.setOptions({ walkSensitivity: v })));
bindRange('set-tilt', () => settings.tilt, (v) => ((settings.tilt = v), motion.setOptions({ tiltSpeed: v })));
bindRange('set-assist', () => settings.assist, (v) => ((settings.assist = v), (thrower.assist = v)));

thrower.assist = settings.assist;
audio.sfxOn = settings.sfx;
audio.musicOn = settings.music;
ui.setSoundIcon(settings.sfx);
ui.syncSettings(settings);
syncHud();

/* ------------------------------------------------------------------ */
/* roar microphone                                                     */
/* ------------------------------------------------------------------ */

let roarCtx: AudioContext | null = null;
let roarAnalyser: AnalyserNode | null = null;
let roarStream: MediaStream | null = null;
let roarData: Uint8Array<ArrayBuffer> | null = null;
let roarArmed = true;
let roarCoolUntil = 0;
let listening = false;

async function startRoarMic() {
  if (roarAnalyser) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    ui.toast('Microphone not available here', 'missing');
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    roarCtx = ctx;
    roarAnalyser = an;
    roarStream = stream;
    roarData = new Uint8Array(an.frequencyBinCount);
    listening = true;
    ui.setRoaring(true);
    ui.toast('Roar as loud as you can!');
    return true;
  } catch {
    ui.toast('Microphone was declined', 'missing');
    settings.roar = false;
    ui.syncSettings(settings);
    return false;
  }
}

function stopRoarMic() {
  listening = false;
  ui.setRoaring(false);
  roarStream?.getTracks().forEach((t) => t.stop());
  roarStream = null;
  roarCtx?.close().catch(() => undefined);
  roarCtx = null;
  roarAnalyser = null;
}

async function toggleRoarMic() {
  if (listening) {
    stopRoarMic();
    settings.roar = false;
    ui.syncSettings(settings);
    return;
  }
  settings.roar = await startRoarMic();
  ui.syncSettings(settings);
}

function sampleRoar() {
  if (!listening || !roarAnalyser || !roarData) return;
  roarAnalyser.getByteFrequencyData(roarData);
  let sum = 0;
  for (let i = 0; i < roarData.length; i++) sum += roarData[i];
  const level = sum / roarData.length / 255;
  roarLevel += (level - roarLevel) * 0.35;
  const now = time;
  if (roarLevel > 0.32 && roarArmed && now > roarCoolUntil) {
    roarArmed = false;
    roarCoolUntil = now + 4.5;
    audio.roarReady();
    doSummon();
  }
  if (roarLevel < 0.14) roarArmed = true;
}

/* ------------------------------------------------------------------ */
/* summon                                                              */
/* ------------------------------------------------------------------ */

function doSummon(speciesId?: string) {
  if (mode !== 'play') return;
  if (!progress.canSummon && !speciesId) {
    ui.toast('Make 6 friends first!', 'missing');
    ui.hint('Roar power unlocks after 6 friends. Keep hunting!', 3.5);
    audio.back();
    return;
  }
  const sp: Species | undefined = speciesId ? SPECIES_BY_ID[speciesId] : undefined;
  if (speciesId && !progress.owns(speciesId)) {
    ui.toast(`You have not met ${sp?.name ?? 'that monster'} yet`, 'missing');
    audio.back();
    return;
  }
  const m = world.summon(camera.quaternion, camera.position, worldHooks, speciesId);
  particles.ring(new THREE.Vector3(m.pos.x, 0.02, m.pos.z), '#ffd93d', 0.1, 1.8, 0.7);
  particles.burst(m.center, { color: ['#ffd93d', '#fff6a8', '#ffffff'], count: 26, speed: 1.8, life: 0.9, size: 0.1 });
  particles.shake(0.02);
  ui.flash(0.35);
  audio.roarReady();
  ui.hint(`${m.species.name} heard you!`, 3);
  speak(m.species.name);
  if (ui.visible('detail')) {
    ui.show('play');
    mode = 'play';
    clearPreview('detail');
  }
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

motion.onStepDetected = (stride) => {
  if (mode !== 'play') return;
  progress.addStep();
  audio.step();
  const at = new THREE.Vector3(camera.position.x, 0.04, camera.position.z).addScaledVector(motion.forward, -0.45);
  particles.burst(at, { color: dreamMode ? ['#bfe6ff', '#ffffff'] : ['#ffffff'], count: 3, speed: 0.4, life: 0.4, size: 0.04, gravity: -0.5, drag: 3 });
  if (progress.data.stats.steps % 100 === 0) ui.toast(`${progress.data.stats.steps} steps walked!`, 'big');
  void stride;
};

/* ------------------------------------------------------------------ */
/* HUD helpers                                                         */
/* ------------------------------------------------------------------ */

const projected = new THREE.Vector3();
const fwdFlat = new THREE.Vector3();

/**
 * Signed horizontal angle from where she is looking to a floor point, in
 * radians: 0 is straight ahead and positive is to HER RIGHT. The obvious
 * `atan2(x, z) - yaw` is a compass bearing, which grows the other way, and that
 * mirror is exactly what made the radar feel backwards.
 */
function sideAngle(x: number, z: number, from: THREE.Vector3, fwd: THREE.Vector3) {
  const dx = x - from.x;
  const dz = z - from.z;
  // right-hand direction in the floor plane: forward turned a quarter turn
  return Math.atan2(dx * -fwd.z + dz * fwd.x, dx * fwd.x + dz * fwd.z);
}

/** Half of the horizontal field of view, in radians: how wide the picture is. */
function halfViewAngle() {
  return Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
}

/** Gold hoop under the monster the lock plate is naming. */
function updateLockRing() {
  const target = thrower.aimTarget(world.monsters);
  if (!target) {
    lockRing.visible = false;
    return;
  }
  const c = target.center;
  lockRing.visible = true;
  lockRing.position.set(c.x, 0.035, c.z);
  // a gentle pulse reads as "this one is mine to throw at" without hiding it
  const r = Math.max(0.3, target.radius * 1.85) * (1 + Math.sin(time * 4.5) * 0.06);
  lockRing.scale.setScalar(r);
}

function updateLabels() {
  const items: { uid: number; x: number; y: number; name: string; icon: string; color: string; spotted: boolean; isNew: boolean }[] = [];
  const radar: { angle: number; dist: number; inView: boolean; icon: string; rarity: Rarity; shiny: boolean }[] = [];
  fwdFlat.set(0, 0, -1).applyQuaternion(camera.quaternion);
  fwdFlat.y = 0;
  if (fwdFlat.lengthSq() < 1e-6) fwdFlat.set(0, 0, -1);
  fwdFlat.normalize();

  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfView = halfViewAngle();

  const scored = world.monsters
    .map((m) => ({ m, dist: Math.hypot(m.pos.x - camera.position.x, m.pos.z - camera.position.z) }))
    .filter((e) => e.dist < 14 && e.m.state !== 'captured' && e.m.state !== 'poofed')
    .sort((a, b) => a.dist - b.dist);

  for (const { m, dist } of scored) {
    const angle = sideAngle(m.pos.x, m.pos.z, camera.position, fwdFlat);
    // is she actually looking at it? the radar says so, and so does the ring
    const inView = dist > 0.3 && dist < 12 && Math.abs(angle) < halfView + 0.1 && camera.position.distanceTo(m.center) < 12;
    radar.push({
      angle,
      dist,
      inView,
      icon: ELEMENTS[m.species.element]?.icon ?? '⭐️',
      rarity: m.species.rarity,
      shiny: m.shiny,
    });
    if (Math.abs(angle) > 0.85 || dist > 9 || dist < 0.35) continue;

    // tag above the head, where it never covers the monster's face
    projected.set(m.pos.x, m.pos.y + m.creature.height + m.hover + 0.14, m.pos.z);
    projected.project(camera);
    if (projected.z > 1) continue;
    const rawX = (projected.x * 0.5 + 0.5) * w;
    const rawY = (-projected.y * 0.5 + 0.5) * h;
    // A tag is a tap target now, so it is nudged into the safe band instead of
    // being dropped: a monster at the very edge of the picture used to get no
    // tag at all, and one low in the frame lost its tag behind the buttons.
    // Only while it is genuinely in the picture, not once the camera swings off.
    if (rawX < -72 || rawX > w + 72 || rawY < -40 || rawY > h + 40) continue;
    const x = THREE.MathUtils.clamp(rawX, 66, w - 66);
    const y = THREE.MathUtils.clamp(rawY, 104, h - 214);
    items.push({
      uid: m.uid,
      x,
      y,
      name: m.species.name,
      icon: ELEMENTS[m.species.element]?.icon ?? '⭐️',
      color: m.shiny ? '#ffd93d' : RARITY[m.species.rarity as Rarity].color,
      spotted: false,
      isNew: !progress.owns(m.species.id),
    });
  }

  ui.labels(items);
  ui.radar(radar.slice(0, 6));
  updateLockRing();
}

function ambientHint() {
  // never talk over a hint she just earned; the next beat is plenty
  if (ui.hintBusy()) return;
  const { monster, dist } = world.nearest(camera.position);
  if (!monster) {
    ui.expireHint('Look around — monsters hide in corners!');
    return;
  }
  const angle = sideAngle(monster.pos.x, monster.pos.z, camera.position, fwdFlat);
  if (Math.abs(angle) > 1) {
    ui.hint(angle > 0 ? 'Something is that way →' : '← Something is that way', 1.6);
  } else if (dist > 6) {
    ui.hint('Walk closer — take real steps!', 2.2);
  } else {
    ui.expireHint('Tap a monster to throw an orb');
  }
}

/* ------------------------------------------------------------------ */
/* loop                                                                */
/* ------------------------------------------------------------------ */

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(baseDpr);
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 260));
resize();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') progress.save();
  else audio.unlock();
});

let last = performance.now();
let lowFrames = 0;

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  time += dt;
  timeUniform.value = time;

  if (mode === 'calibrate') {
    calTimer += dt;
    ui.setCalProgress(calTimer / 1.25);
  }

  const playing = mode === 'play' && !ui.paused;

  // keyboard nudge (desktop testing / accessibility)
  if (keys.size) {
    const kx = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    const ky = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
    if (kx || ky) motion.addLook(kx * 9, ky * 9);
  }

  motion.update(dt);
  particles.update(dt);
  particles.shakeOffset(shakeVec, time);
  baseQuat.copy(motion.quaternion);
  if (particles.shakeAmount > 0) {
    shakeEuler.set(shakeVec.y, shakeVec.x, shakeVec.z * 0.6);
    camera.quaternion.copy(baseQuat.multiply(shakeQuat.setFromEuler(shakeEuler)));
  } else {
    camera.quaternion.copy(baseQuat);
  }
  camera.position.copy(motion.position);
  camera.position.y = EYE_HEIGHT + motion.bob + shakeVec.y * 0.4;
  motion.parallax(parallaxVec);
  camera.position.add(parallaxVec);

  if (playing) {
    world.update(dt, time, camera.position, camera.quaternion, camera.position, worldHooks);
    thrower.update(dt, world.monsters, captureHooks);
    if (progress.tickOrbs(dt)) {
      audio.popIn();
      ui.toast('+1 Capture Orb');
    }
    sampleRoar();
    hudTick += dt;
    if (hudTick > 0.25) {
      hudTick = 0;
      syncHud();
      ambientHint();
      ui.setReticleReady(thrower.aimAngle(world.monsters) < 0.22);
      const target = thrower.aimTarget(world.monsters);
      ui.setLock(target ? target.species : null, target ? target.pos.distanceTo(camera.position) : null);
    }
    updateLabels();

    const intensity = thrower.busy ? 0.95 : Math.min(0.8, world.monsters.length * 0.16);
    audio.tickMusic(intensity);
  } else {
    lockRing.visible = false;
  }

  if (dreamMode && dream.group.visible) dream.update(time);
  room.matchLens(camera, window.innerWidth, window.innerHeight);
  drawPreviews(dt);
  renderer.render(scene, camera);

  // back off resolution if the phone is struggling
  const fps = 1 / dt;
  if (fps < 42) lowFrames++;
  else if (fps > 55) lowFrames = Math.max(0, lowFrames - 2);
  if (lowFrames > 60 && baseDpr > 1) {
    baseDpr = 1;
    lowFrames = 0;
    renderer.setPixelRatio(1);
  }

  requestAnimationFrame(frame);
}

/**
 * Eye height in metres. This is her height, not an adult's: the world is
 * authored to be seen from about 1.32 m, which is what it feels like to hold a
 * phone up at a monster when you are seven.
 */
const EYE_HEIGHT = 1.32;
const baseQuat = new THREE.Quaternion();
const shakeQuat = new THREE.Quaternion();
const shakeEuler = new THREE.Euler();
const parallaxVec = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

ui.show('title');
syncHud();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => undefined);
  });
}

window.addEventListener('pagehide', () => progress.save());

/**
 * Debug helper for tuning on a real phone: window.__hunt.card('pufflo') puts the
 * catch card up without needing a catch, so artwork and framing can be checked at
 * the kitchen table. Harmless, unused by the game itself.
 */
function debugCard(id: string, shiny = false) {
  const sp = SPECIES_BY_ID[id];
  if (!sp) return false;
  mode = 'boot';
  ui.showReward(sp, shiny, true, 40);
  ui.show('reward');
  showPreview('reward', sp, shiny, ui.rewardStage, 300);
  return true;
}

// handy for debugging on a phone: window.__hunt
(window as unknown as { __hunt?: unknown }).__hunt = {
  ui,
  progress,
  audio,
  world,
  thrower,
  motion,
  room,
  scene,
  camera,
  renderer,
  SPECIES_BY_ID,
  card: debugCard,
};
