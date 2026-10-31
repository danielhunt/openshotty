/* ============================================================
   UI wiring: screens, HUD, radar ribbon, floating name tags,
   the collection album and the catch reward card.

   The UI never touches three.js scenes directly — wherever a live
   3D model is needed (album thumbnails, detail stage, reward card)
   the host hands over a finished canvas. Keeps the drawing code in
   one place and the DOM code in another.
   ============================================================ */

import { ELEMENTS, RARITY, SPECIES, type Rarity, type Species } from '../game/species';
import type { Settings } from '../game/save';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const make = <T extends HTMLElement = HTMLElement>(tag: string, cls?: string, text?: string): T => {
  const n = document.createElement(tag) as T;
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

export type ScreenId = 'title' | 'perms' | 'calibrate' | 'collection' | 'detail' | 'reward' | 'settings' | 'levelup' | 'play';

const SCREENS: Record<Exclude<ScreenId, 'play'>, string> = {
  title: 'screen-title',
  perms: 'screen-perms',
  calibrate: 'screen-calibrate',
  collection: 'screen-collection',
  detail: 'screen-detail',
  reward: 'screen-reward',
  settings: 'screen-settings',
  levelup: 'screen-levelup',
};

export interface HudInfo {
  level: number;
  rank: string;
  xp: number;
  xpNeed: number;
  orbs: number;
}

export interface LabelItem {
  uid: number;
  x: number;
  y: number;
  name: string;
  icon: string;
  color: string;
  spotted: boolean;
  isNew: boolean;
}

export interface RadarItem {
  /** 0 = straight ahead, positive = to her right (see `sideAngle` in main). */
  angle: number;
  dist: number;
  /** She is looking straight at it right now. */
  inView: boolean;
  icon: string;
  rarity: Rarity;
  shiny: boolean;
}

export class Ui {
  readonly hud = $('hud');

  private readonly dom = {
    levelNum: $('level-num'),
    rankName: $('rank-name'),
    xpText: $('xp-text'),
    xpRing: $('xp-ring') as unknown as SVGCircleElement,
    orbCount: $('orb-count'),
    reticle: $('reticle'),
    lockPlate: $('lock-plate'),
    lockName: $('lock-name'),
    lockElement: $('lock-element'),
    lockDist: $('lock-dist'),
    radarBlips: $('radar-blips'),
    hint: $('hint-strip'),
    labels: $('labels'),
    toasts: $('toasts'),
    confetti: $('confetti'),
    flash: $('flash'),
    collGrid: $('coll-grid'),
    collCount: $('coll-count'),
    collTotal: $('coll-total'),
    collFill: $('coll-fill'),
    collNote: $('coll-note'),
    detailName: $('detail-name'),
    detailBadges: $('detail-badges'),
    detailFact: $('detail-fact'),
    detailStats: $('detail-stats'),
    detailWrap: $('detail-canvas-wrap'),
    rewardCanvas: $('reward-canvas'),
    rewardRibbon: $('reward-ribbon'),
    rewardName: $('reward-name'),
    rewardElement: $('reward-element'),
    rewardRarity: $('reward-rarity'),
    rewardFact: $('reward-fact'),
    rewardXp: $('reward-xp'),
    rewardCard: $('reward-card'),
    calFill: $('cal-fill'),
    btnFav: $('btn-fav'),
    btnSound: $('btn-sound'),
    btnThrow: $('btn-throw'),
    btnRoar: $('btn-roar'),
    levelupNum: $('levelup-num'),
    levelupRank: $('levelup-rank'),
    levelupPrize: $('levelup-prize'),
  };

  private labelPool = new Map<number, HTMLElement>();
  private labelSpot = new Set<number>();
  private blipPool: HTMLElement[] = [];
  private lastToast = 0;
  private hintUntil = 0;
  private readonly thumbSize: number;

  constructor() {
    this.thumbSize = Math.round(Math.min(window.devicePixelRatio || 1, 2) * 116);
  }

  /* ---------------------------------------------------------------- */
  /* screens                                                           */
  /* ---------------------------------------------------------------- */

  show(screen: ScreenId) {
    for (const [id, domId] of Object.entries(SCREENS)) {
      const node = $(domId);
      const on = id === screen;
      node.classList.toggle('hidden', !on);
      if (on) {
        node.classList.remove('pop');
        void node.offsetWidth; // restart the entrance animation
        node.classList.add('pop');
      }
    }
    // the HUD stays behind the album and detail pages so the world keeps living
    this.hud.classList.toggle('hidden', screen !== 'play' && screen !== 'collection' && screen !== 'detail');
    this.dom.labels.classList.toggle('hidden', screen !== 'play');
  }

  visible(screen: Exclude<ScreenId, 'play'>) {
    return !$(SCREENS[screen]).classList.contains('hidden');
  }

  anyScreenUp() {
    return Object.keys(SCREENS).some((id) => this.visible(id as Exclude<ScreenId, 'play'>));
  }

  /** True when a full-screen panel means the hunt is on hold. */
  get paused() {
    return this.visible('title') || this.visible('perms') || this.visible('calibrate') || this.visible('settings') || this.visible('reward') || this.visible('levelup');
  }

  /* ---------------------------------------------------------------- */
  /* hud                                                               */
  /* ---------------------------------------------------------------- */

  setHud(info: HudInfo) {
    this.dom.levelNum.textContent = String(info.level);
    this.dom.rankName.textContent = info.rank;
    this.dom.xpText.textContent = `${info.xp} / ${info.xpNeed} sparkle`;
    const k = Math.max(0, Math.min(1, info.xp / Math.max(1, info.xpNeed)));
    this.dom.xpRing.style.strokeDashoffset = String(100 - k * 100);
    const orbs = String(info.orbs);
    if (this.dom.orbCount.textContent !== orbs) {
      this.dom.orbCount.textContent = orbs;
      this.dom.btnThrow.classList.toggle('armed', info.orbs > 0);
    }
  }

  setLock(sp: Species | null, dist: number | null) {
    if (!sp || dist === null) {
      this.dom.lockPlate.classList.add('hidden');
      this.dom.reticle.classList.remove('locked');
      return;
    }
    const e = ELEMENTS[sp.element] ?? ELEMENTS.star;
    this.dom.lockName.textContent = sp.name;
    this.dom.lockElement.textContent = e.name;
    this.dom.lockElement.style.background = e.color;
    this.dom.lockDist.textContent = dist < 1 ? 'right here!' : `${Math.max(1, Math.round(dist / 0.6))} steps`;
    this.dom.lockPlate.classList.remove('hidden');
    this.dom.reticle.classList.add('locked');
  }

  setReticleReady(ready: boolean) {
    this.dom.reticle.classList.toggle('ready', ready);
  }

  setRoaring(on: boolean) {
    this.dom.btnRoar.classList.toggle('listening', on);
  }

  setSoundIcon(on: boolean) {
    this.dom.btnSound.querySelector('span')!.textContent = on ? '🔊' : '🔇';
  }

  /** Bottom hint strip. Repeating the same text simply extends the hold. */
  hint(text: string, hold = 3.4) {
    if (this.dom.hint.textContent !== text) this.dom.hint.textContent = text;
    this.hintUntil = performance.now() / 1000 + hold;
  }

  /**
   * True while a hint is deliberately being held up. The ambient chatter runs
   * every quarter second and would otherwise wipe a hint she just earned — the
   * one piece of feedback that says "that thing you did worked".
   */
  hintBusy() {
    return this.hintUntil > performance.now() / 1000;
  }

  expireHint(fallback: string) {
    if (this.hintUntil > 0 && performance.now() / 1000 > this.hintUntil) {
      this.hintUntil = 0;
      this.dom.hint.textContent = fallback;
    }
  }

  toast(text: string, kind: '' | 'big' | 'missing' = '') {
    const now = performance.now() / 1000;
    if (now - this.lastToast < 0.22) return;
    this.lastToast = now;
    const t = make('div', `toast ${kind}`.trim(), text);
    this.dom.toasts.appendChild(t);
    window.setTimeout(() => {
      t.style.opacity = '0';
      window.setTimeout(() => t.remove(), 420);
    }, 1500);
  }

  flash(strength = 0.55) {
    const f = this.dom.flash;
    f.style.opacity = String(strength);
    f.classList.add('go');
    window.setTimeout(() => {
      f.style.opacity = '';
      f.classList.remove('go');
    }, 240);
  }

  shakeHud() {
    this.hud.classList.add('shake');
    window.setTimeout(() => this.hud.classList.remove('shake'), 420);
  }

  confetti(count = 80) {
    const colors = ['#ffd93d', '#ff6b9d', '#2de1c2', '#59d2ff', '#b98cff', '#ff8a5b', '#a7f36a'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const bit = make('i', 'confetto');
      const size = 7 + Math.random() * 9;
      bit.style.width = `${size.toFixed(1)}px`;
      bit.style.height = `${(size * (0.5 + Math.random() * 0.9)).toFixed(1)}px`;
      bit.style.background = colors[(Math.random() * colors.length) | 0];
      bit.style.left = `${(Math.random() * 100).toFixed(1)}vw`;
      bit.style.animationDelay = `${(Math.random() * 0.5).toFixed(2)}s`;
      bit.style.animationDuration = `${(1.5 + Math.random() * 1.4).toFixed(2)}s`;
      frag.appendChild(bit);
    }
    this.dom.confetti.appendChild(frag);
    window.setTimeout(() => this.dom.confetti.replaceChildren(), 3400);
  }

  /* ---------------------------------------------------------------- */
  /* floating name tags                                                */
  /* ---------------------------------------------------------------- */

  /** Tags for the monsters on screen; anything missing here is hidden. */
  labels(items: LabelItem[]) {
    const alive = new Set<number>();
    for (const it of items) {
      alive.add(it.uid);
      let node = this.labelPool.get(it.uid);
      if (!node) {
        node = make('div', 'mon-label');
        // The tag is a tap target, not a caption: the game resolves the monster
        // behind it from this uid. It is also the one part of a monster that is
        // never behind the buttons along the bottom of the screen.
        node.dataset.uid = String(it.uid);
        node.setAttribute('role', 'button');
        node.setAttribute('aria-label', `Throw at ${it.name}`);
        const dot = make('span', 'dot', it.icon);
        dot.style.background = it.color;
        node.appendChild(dot);
        node.appendChild(make('span', undefined, it.name));
        if (it.isNew) node.appendChild(make('span', 'wild', 'new!'));
        this.dom.labels.appendChild(node);
        this.labelPool.set(it.uid, node);
      }
      node.style.left = `${it.x.toFixed(1)}px`;
      node.style.top = `${it.y.toFixed(1)}px`;
      node.classList.add('on');
      if (it.spotted && !this.labelSpot.has(it.uid)) {
        this.labelSpot.add(it.uid);
        node.classList.add('spot');
      }
    }
    for (const [uid, node] of this.labelPool) {
      if (alive.has(uid)) continue;
      node.classList.remove('on');
      this.labelPool.delete(uid);
      if (node.classList.contains('spot')) {
        // a spotted tag is mid pop-out: let the animation finish, then remove
        this.labelSpot.delete(uid);
        window.setTimeout(() => node.remove(), 1700);
      } else {
        node.remove();
      }
    }
  }

  clearLabels() {
    for (const n of this.labelPool.values()) n.remove();
    this.labelPool.clear();
    this.labelSpot.clear();
  }

  /* ---------------------------------------------------------------- */
  /* radar ribbon                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Blips across the strip, where angle 0 is straight ahead and positive is her
   * right. The mapping is deliberately not linear in angle: a phone only shows
   * about 35° of the room at a time, so spreading the full ±180° turn over this
   * strip squeezes everything she can actually see into the middle tenth and the
   * radar reads as empty. A gentle curve gives the middle of the strip as much
   * room as the ends, and a monster behind her still lands on the far side.
   */
  radar(items: RadarItem[]) {
    while (this.blipPool.length < items.length) {
      const b = make('div', 'blip');
      this.dom.radarBlips.appendChild(b);
      this.blipPool.push(b);
    }
    for (let i = 0; i < this.blipPool.length; i++) {
      const b = this.blipPool[i];
      const it = items[i];
      if (!it) {
        b.style.opacity = '0';
        b.classList.remove('view');
        continue;
      }
      const a = Math.max(-Math.PI, Math.min(Math.PI, it.angle));
      const curve = Math.sign(a) * Math.pow(Math.abs(a) / Math.PI, 0.55);
      b.style.left = `${(50 + curve * 46).toFixed(1)}%`;
      const lift = Math.min(1, it.dist / 12) * -13;
      b.style.opacity = String(Math.max(0.3, 1 - it.dist / 15));
      b.style.transform = `translateY(${lift.toFixed(1)}px) scale(${(1.15 - Math.min(0.5, it.dist / 16)).toFixed(2)})`;
      b.classList.toggle('shiny', it.shiny);
      if (!it.shiny) b.style.background = RARITY[it.rarity].color;
      b.classList.toggle('near', it.dist < 2.8);
      b.classList.toggle('view', it.inView);
      if (b.textContent !== it.icon) b.textContent = it.icon;
    }
  }

  /* ---------------------------------------------------------------- */
  /* collection album                                                  */
  /* ---------------------------------------------------------------- */

  buildCollection(
    owned: Record<string, { n: number; shiny: boolean; fav: boolean }>,
    onPick: (sp: Species) => void,
    makeThumb: (sp: Species, shiny: boolean, size: number) => HTMLCanvasElement,
  ) {
    const grid = this.dom.collGrid;
    grid.replaceChildren();
    const count = Object.keys(owned).length;
    this.dom.collCount.textContent = String(count);
    this.dom.collTotal.textContent = String(SPECIES.length);
    this.dom.collFill.style.width = `${(count / SPECIES.length) * 100}%`;
    this.dom.collNote.textContent =
      count >= SPECIES.length
        ? 'You found every single one. Wow.'
        : count >= 10
          ? 'Ten friends! The rare ones are still hiding.'
          : count >= 6
            ? 'Six friends! You can call monsters to you now.'
            : count >= 3
              ? 'Three friends! Golden Orbs unlocked.'
              : count >= 1
                ? 'Find 3 monsters to earn the Golden Orb!'
                : 'Look behind you — someone is hiding!';

    for (const sp of SPECIES) {
      const mine = owned[sp.id];
      const card = make<HTMLButtonElement>('button', 'card');
      if (mine) {
        card.appendChild(makeThumb(sp, mine.shiny, this.thumbSize));
        const corner = make('span', 'corner', RARITY[sp.rarity as Rarity].name);
        card.appendChild(corner);
        if (mine.shiny) {
          card.classList.add('shiny-card');
          corner.style.background = 'rgba(255,217,61,0.85)';
          corner.style.color = '#3a2000';
        }
        if (mine.fav) card.appendChild(make('span', 'star', '⭐️'));
        card.appendChild(make('div', 'card-name', sp.name));
      } else {
        card.classList.add('locked');
        const face = make('div', 'card-face', '?');
        card.appendChild(face);
        card.appendChild(make('div', 'card-name', '???'));
      }
      card.addEventListener('click', () => onPick(sp));
      grid.appendChild(card);
    }
  }

  /* ---------------------------------------------------------------- */
  /* detail page + reward card                                         */
  /* ---------------------------------------------------------------- */

  get detailStage() {
    return this.dom.detailWrap;
  }

  get rewardStage() {
    return this.dom.rewardCanvas;
  }

  setDetail(sp: Species, shiny: boolean, info: { level: number; cm: number; n: number }, fav: boolean) {
    this.dom.detailName.textContent = sp.name;
    this.dom.btnFav.querySelector('span')!.textContent = fav ? '⭐️' : '☆';
    this.dom.btnFav.classList.toggle('on', fav);

    const e = ELEMENTS[sp.element] ?? ELEMENTS.star;
    const rarity = RARITY[sp.rarity as Rarity];
    const b1 = make('span', 'badge', `${e.icon} ${e.name}`);
    b1.style.background = e.color;
    const b2 = make('span', 'badge', rarity.name);
    b2.style.background = rarity.color;
    const badges: HTMLElement[] = [b1, b2];
    if (shiny) {
      const b3 = make('span', 'badge', '✨ shiny');
      b3.style.background = '#ffd93d';
      badges.push(b3);
    }
    this.dom.detailBadges.replaceChildren(...badges);
    this.dom.detailFact.textContent = sp.fact;
    this.dom.detailStats.replaceChildren(
      stat(String(info.level ?? 1), 'level'),
      stat(`${info.cm ?? sp.heightCm}cm`, 'height'),
      stat(String(info.n ?? 0), 'times found'),
      // the habitat line is a whole sentence: it gets the row to itself instead
      // of a third-column cell that would stack it one word per line
      stat(sp.habitat, 'likes to hide', true),
    );
  }

  showReward(sp: Species, shiny: boolean, isNew: boolean, xp: number) {
    const e = ELEMENTS[sp.element] ?? ELEMENTS.star;
    const rarity = RARITY[sp.rarity as Rarity];
    this.dom.rewardRibbon.textContent = shiny ? 'SHINY FRIEND!' : isNew ? 'NEW FRIEND!' : 'BEFRIENDED AGAIN!';
    this.dom.rewardName.textContent = sp.name;
    this.dom.rewardElement.textContent = e.name;
    this.dom.rewardElement.style.background = e.color;
    this.dom.rewardRarity.textContent = rarity.name;
    this.dom.rewardFact.textContent = sp.fact;
    this.dom.rewardXp.textContent = `+${xp} sparkle`;
  }

  showLevelUp(level: number, rank: string, prize: string) {
    this.dom.levelupNum.textContent = String(level);
    this.dom.levelupRank.textContent = rank;
    this.dom.levelupPrize.textContent = prize;
  }

  /* ---------------------------------------------------------------- */
  /* settings                                                          */
  /* ---------------------------------------------------------------- */

  syncSettings(s: Settings) {
    const tog = (id: string, on: boolean) => $(id).setAttribute('aria-checked', on ? 'true' : 'false');
    tog('set-sfx', s.sfx);
    tog('set-music', s.music);
    tog('set-voice', s.voice);
    tog('set-roar', s.roar);
    range('set-density', s.density);
    range('set-sensitivity', s.walk);
    range('set-tilt', s.tilt);
    range('set-assist', s.assist);
  }

  setCalProgress(k: number) {
    this.dom.calFill.style.width = `${Math.min(100, k * 100).toFixed(0)}%`;
  }
}

function stat(value: string, label: string, wide = false) {
  const s = make('div', wide ? 'stat wide' : 'stat');
  s.appendChild(make('b', undefined, value));
  s.appendChild(make('small', undefined, label));
  return s;
}

function range(id: string, value: number) {
  ($(id) as unknown as HTMLInputElement).value = String(value);
}
