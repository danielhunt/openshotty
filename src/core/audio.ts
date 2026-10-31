/* ============================================================
   Audio — every sound in the game is synthesised at runtime.
   No files to download, and the music never loops noticeably.
   ============================================================ */

type Ctx = AudioContext & { webkitAudioContext?: never };

export type VoiceKind = 'chirp' | 'boop' | 'trill' | 'wow' | 'honk';

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
const CHORDS = [
  [0, 4, 7, 11], // Cmaj7
  [-3, 0, 4, 9], // Am… dreamy
  [-5, 2, 5, 9], // Fmaj7-ish
  [-7, 0, 5, 7],
];

export class AudioEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private roomBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private nextStep = 0;
  private seqStep = 0;
  private chord = 0;
  private started = false;

  sfxOn = true;
  musicOn = true;

  /** Must be called from a user gesture (iOS requirement). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC() as Ctx;
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    // Gentle limiter-ish curve so loud capture moments never crackle.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 1.35) * 0.86;
    }
    shaper.curve = curve;
    shaper.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(shaper);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
    this.musicBus.connect(shaper);

    this.roomBus = ctx.createGain();
    this.roomBus.gain.value = 0;
    this.roomBus.connect(shaper);

    // pre-render a second of white noise, reused by every noisy sound
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startRoomTone();
    this.nextStep = ctx.currentTime + 0.1;
    this.started = true;
  }

  get ready() {
    return this.started && !!this.ctx;
  }

  private now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicBus.gain.linearRampToValueAtTime(on ? 0.5 : 0, this.ctx.currentTime + 0.6);
    }
  }

  /** Quiet "air in the room" bed — sells the AR illusion more than people expect. */
  private startRoomTone() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.roomBus!);
    src.start();
  }

  roomTone(level: number) {
    if (!this.ctx || !this.roomBus) return;
    this.roomBus.gain.setTargetAtTime(level * 0.09, this.ctx.currentTime, 0.5);
  }

  // ---------------------------------------------------------------- voices

  private tone(
    freq: number,
    t0: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'sine',
    glideTo?: number,
    dest?: AudioNode,
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest ?? this.sfxBus!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(t0: number, dur: number, gain: number, freq: number, sweepTo?: number, q = 1, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus!);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  private bell(freq: number, t0: number, dur = 0.9, gain = 0.16) {
    this.tone(freq, t0, dur, gain, 'sine');
    this.tone(freq * 2.01, t0, dur * 0.55, gain * 0.4, 'sine');
    this.tone(freq * 3.02, t0, dur * 0.3, gain * 0.18, 'triangle');
  }

  // ---------------------------------------------------------------- one-shots

  private play(fn: (t: number) => void) {
    if (!this.sfxOn) return;
    this.unlock();
    if (!this.ctx) return;
    fn(this.now() + 0.001);
  }

  tap() {
    this.play((t) => {
      this.tone(720, t, 0.07, 0.12, 'triangle', 1150);
      this.noise(t, 0.03, 0.05, 3000, 5200, 1, 'highpass');
    });
  }

  back() {
    this.play((t) => this.tone(520, t, 0.11, 0.11, 'triangle', 300));
  }

  hover() {
    this.play((t) => this.tone(1180, t, 0.05, 0.06, 'sine', 1500));
  }

  step() {
    this.play((t) => {
      this.noise(t, 0.075, 0.055, 380, 190, 0.7, 'lowpass');
      this.tone(96, t, 0.06, 0.05, 'sine', 70);
    });
  }

  throwOrb() {
    this.play((t) => {
      this.noise(t, 0.3, 0.2, 500, 3400, 1.4);
      this.tone(300, t, 0.26, 0.1, 'sine', 900);
    });
  }

  bounce() {
    this.play((t) => {
      this.tone(220, t, 0.16, 0.13, 'sine', 420);
      this.noise(t, 0.05, 0.05, 1200, 500);
    });
  }

  hit() {
    this.play((t) => {
      this.tone(660, t, 0.12, 0.18, 'square', 240);
      this.noise(t, 0.1, 0.16, 1800, 400);
    });
  }

  zap() {
    this.play((t) => {
      this.tone(1400, t, 0.4, 0.12, 'sawtooth', 180);
      this.noise(t, 0.4, 0.1, 2400, 300, 6);
    });
  }

  wobble() {
    this.play((t) => {
      this.tone(160, t, 0.28, 0.16, 'triangle', 120);
      this.tone(240, t + 0.02, 0.2, 0.07, 'sine', 190);
    });
  }

  popIn() {
    this.play((t) => {
      this.tone(180, t, 0.22, 0.18, 'sine', 780);
      this.noise(t, 0.14, 0.1, 900, 2600);
    });
  }

  poof() {
    this.play((t) => {
      this.noise(t, 0.34, 0.2, 2600, 300, 0.6, 'lowpass');
      this.tone(500, t, 0.3, 0.09, 'sine', 120);
    });
  }

  escape() {
    this.play((t) => {
      this.tone(420, t, 0.18, 0.14, 'triangle', 880);
      this.tone(880, t + 0.16, 0.3, 0.12, 'triangle', 300);
      this.noise(t + 0.16, 0.22, 0.08, 1400, 400);
    });
  }

  captureJingle() {
    if (!this.sfxOn) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.now() + 0.01;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, i) => {
      this.bell(f, t + i * 0.085, 0.9 - i * 0.06, 0.15);
      this.tone(f * 0.5, t + i * 0.085, 0.2, 0.07, 'triangle');
    });
    this.noise(t + 0.05, 0.6, 0.05, 5000, 9000, 1, 'highpass');
    this.tone(130, t, 0.5, 0.14, 'sine');
  }

  failJingle() {
    if (!this.sfxOn) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.now() + 0.01;
    this.tone(392, t, 0.2, 0.13, 'triangle');
    this.tone(349.23, t + 0.18, 0.22, 0.13, 'triangle');
    this.tone(293.66, t + 0.36, 0.5, 0.14, 'triangle', 240);
    this.noise(t + 0.36, 0.3, 0.05, 700, 260, 0.7, 'lowpass');
  }

  levelUp() {
    if (!this.sfxOn) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.now() + 0.01;
    [523.25, 587.33, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
      this.bell(f, t + i * 0.075, 1.1, 0.13);
    });
    this.bell(1567.98, t + 0.5, 1.6, 0.14);
    this.noise(t, 0.9, 0.04, 4000, 9500, 1, 'highpass');
  }

  roarReady() {
    this.play((t) => {
      this.tone(200, t, 0.4, 0.1, 'sawtooth', 700);
      this.noise(t, 0.4, 0.08, 700, 2400, 2);
    });
  }

  /** A monster's own voice. Pitch + waveform give each species a personality. */
  call(kind: VoiceKind, base: number, detune = 0) {
    if (!this.sfxOn) return;
    this.unlock();
    if (!this.ctx) return;
    const t = this.now() + 0.01;
    const f = base * (1 + detune * 0.01);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * 2.6;
    bp.Q.value = 2.2;
    bp.connect(this.sfxBus!);

    switch (kind) {
      case 'chirp':
        this.tone(f, t, 0.1, 0.16, 'sine', f * 1.9, bp);
        this.tone(f * 1.5, t + 0.11, 0.13, 0.14, 'sine', f * 1.05, bp);
        break;
      case 'boop':
        this.tone(f, t, 0.14, 0.2, 'triangle', f * 0.72, bp);
        this.tone(f * 0.5, t + 0.02, 0.18, 0.1, 'sine', f * 0.4, bp);
        break;
      case 'trill':
        for (let i = 0; i < 4; i++) this.tone(f * (1 + (i % 2) * 0.14), t + i * 0.07, 0.075, 0.13, 'sine', undefined, bp);
        break;
      case 'wow':
        this.tone(f, t, 0.24, 0.17, 'sawtooth', f * 2.0, bp);
        this.tone(f * 2.01, t + 0.2, 0.3, 0.11, 'triangle', f * 1.2, bp);
        break;
      case 'honk':
        this.tone(f, t, 0.2, 0.19, 'square', f * 1.25, bp);
        this.tone(f * 0.5, t + 0.14, 0.22, 0.12, 'square', f * 0.75, bp);
        break;
    }
  }

  // ---------------------------------------------------------------- music

  /** Call once per frame; schedules a short horizon of dreamy adventure music. */
  tickMusic(intensity = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn || !this.started) return;
    const ahead = ctx.currentTime + 0.5;
    const spb = 60 / (86 + intensity * 14) / 2;
    let guard = 0;
    while (this.nextStep < ahead && guard++ < 32) {
      const t = Math.max(this.nextStep, ctx.currentTime + 0.02);
      const s = this.seqStep % 8;
      const root = 261.63 * Math.pow(2, -1 / 12 * 5);
      const chord = CHORDS[this.chord % CHORDS.length];
      if (s === 0) this.chordAdvance();

      // bass
      if (s === 0 || s === 4) {
        const bf = root * Math.pow(2, chord[0] / 12) * 0.5;
        this.tone(bf, t, spb * 3.2, 0.075, 'sine', undefined, this.musicBus!);
      }
      // arpeggio
      const n = chord[s % chord.length];
      const f = root * Math.pow(2, (n + PENTA[(this.seqStep * 3) % PENTA.length]) / 12);
      if ((this.seqStep + this.chord) % 3 !== 0) {
        this.tone(f * 2, t, spb * 1.9, 0.035 + intensity * 0.012, 'triangle', undefined, this.musicBus!);
      }
      // chime sparkle
      if (s === 6 && (this.chord % 2 === 1)) {
        this.bell(f * 4, t, 1.2, 0.03);
      }
      // soft shaker
      if (s % 2 === 1) {
        this.noise(t, 0.05, 0.012 + intensity * 0.006, 6000, 9000, 1, 'highpass');
      }
      this.seqStep++;
      this.nextStep += spb;
    }
  }

  private chordAdvance() {
    this.chord++;
  }
}

export const NOTE_KEYS = PENTA;
export type { Ctx };
