/* ============================================================
   The "room": live camera passthrough behind a transparent WebGL
   canvas, plus a hand-made Dreamland used when the camera is
   declined (and for testing on a desktop).
   ============================================================ */

import * as THREE from 'three';

/** Typical main-lens horizontal field of view on a phone, degrees. */
const FOV_LONG = 68;

export class RoomBackdrop {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement;
  live = false;
  private unsub: (() => void) | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(): Promise<'live' | 'dream'> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.stop();
      return 'dream';
    }
    const tries: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ];
    for (const c of tries) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        this.stream = stream;
        this.video.srcObject = stream;
        this.video.muted = true;
        await this.video.play().catch(() => undefined);
        this.live = true;
        document.body.classList.remove('dream');
        // iOS pauses the feed when the tab is hidden; wake it back up.
        const wake = () => {
          if (document.visibilityState === 'visible' && this.video.paused && this.live) void this.video.play().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', wake);
        this.unsub = () => document.removeEventListener('visibilitychange', wake);
        return 'live';
      } catch {
        /* try the next constraint set */
      }
    }
    this.stop();
    return 'dream';
  }

  dream() {
    this.stop();
    document.body.classList.add('dream');
  }

  /**
   * Sizes the virtual lens so the 3D world is zoomed the same as the video
   * behind it. Without this, monsters look like they are floating through a
   * differently-sized room, and the throw arc feels wrong.
   */
  matchLens(camera: THREE.PerspectiveCamera, width: number, height: number) {
    const vw = this.live && this.video.videoWidth ? this.video.videoWidth : width;
    const vh = this.live && this.video.videoHeight ? this.video.videoHeight : height;
    const aspect = width / height;
    const long = FOV_LONG * (Math.PI / 180);
    const short = 2 * Math.atan(Math.tan(long / 2) * (Math.min(vw, vh) / Math.max(vw, vh)));
    const alongH = vw >= vh ? short : long;

    const scale = Math.max(width / vw, height / vh);
    const fracH = Math.min(1, height / (vh * scale));
    const vFov = 2 * Math.atan(Math.tan(alongH / 2) * fracH);
    // horizontal spread follows automatically from camera.aspect, because
    // fracW/fracH both come from the same cover-scale factor
    const fov = THREE.MathUtils.radToDeg(vFov);
    if (Math.abs(camera.fov - fov) > 0.05 || Math.abs(camera.aspect - aspect) > 0.001) {
      camera.fov = THREE.MathUtils.clamp(fov, 30, 100);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      return true;
    }
    return false;
  }

  stop() {
    this.live = false;
    this.unsub?.();
    this.unsub = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}

/* ------------------------------------------------------------------ */
/* Dreamland                                                           */
/* ------------------------------------------------------------------ */

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 top;
  uniform vec3 mid;
  uniform vec3 bottom;
  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(bottom, mid, smoothstep(0.35, 0.55, h));
    c = mix(c, top, smoothstep(0.55, 0.95, h));
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** A soft toybox world so the game is still fun with no camera at all. */
export function buildDreamland(opts: { props?: boolean } = {}): { group: THREE.Group; sky: THREE.Mesh; update: (t: number) => void } {
  const group = new THREE.Group();
  const props = opts.props !== false;

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#2c6bd8') },
        mid: { value: new THREE.Color('#9fd8ff') },
        bottom: { value: new THREE.Color('#ffe3b8') },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -10;
  group.add(sky);

  const clouds: THREE.Group[] = [];

  if (props) {
    // grass
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(46, 48),
      new THREE.MeshToonMaterial({ color: '#7fd06a' }),
    );
    ground.rotation.x = -Math.PI / 2;
    group.add(ground);

    // path rings so movement is visible
    for (let i = 1; i <= 8; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(i * 2.4 - 0.06, i * 2.4, 48),
        new THREE.MeshBasicMaterial({ color: '#96e07d', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.002;
      group.add(ring);
    }

    const hillGeo = new THREE.SphereGeometry(1, 12, 8);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const r = 18 + Math.random() * 16;
      const s = 3 + Math.random() * 6;
      const hill = new THREE.Mesh(hillGeo, new THREE.MeshToonMaterial({ color: i % 2 ? '#6fc45c' : '#5db454' }));
      hill.position.set(Math.sin(a) * r, -s * 0.35, Math.cos(a) * r);
      hill.scale.set(s, s * (0.45 + Math.random() * 0.35), s);
      group.add(hill);
    }

    // trees: candy lollipops
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 1.2, 6);
    const puffGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 9 + Math.random() * 14;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshToonMaterial({ color: '#8a5a3c' }));
      trunk.position.y = 0.6;
      const puff = new THREE.Mesh(puffGeo, new THREE.MeshToonMaterial({ color: ['#4fae4a', '#68c957', '#8fd06f'][i % 3] }));
      puff.position.y = 1.5 + Math.random() * 0.4;
      puff.scale.setScalar(0.8 + Math.random() * 0.5);
      tree.add(trunk, puff);
      tree.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
      group.add(tree);
    }

    // Low cushions to hide behind, plus a carpet of flowers so the ground has
    // detail at her feet. Everything here is deliberately short and peripheral:
    // a tall prop in the wrong place swallows a 40 cm monster whole, and a
    // monster she cannot see is a monster she cannot catch. Both are one
    // instanced draw call so an older iPhone never blinks.
    const cushion = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.5, 0),
      new THREE.MeshToonMaterial(),
      9,
    );
    const flower = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 6, 5),
      new THREE.MeshToonMaterial(),
      42,
    );
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const CUSHION_COLORS = ['#ffb347', '#ff6b9d', '#59d2ff', '#ffd93d', '#8fd06f'];
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4.5 + Math.random() * 9;
      const w = 0.5 + Math.random() * 0.55;
      const h = 0.18 + Math.random() * 0.16;
      dummy.position.set(Math.sin(a) * r, h * 0.35, Math.cos(a) * r);
      dummy.scale.set(w, h, w * (0.75 + Math.random() * 0.4));
      dummy.rotation.set(0, Math.random() * 3, 0);
      dummy.updateMatrix();
      cushion.setMatrixAt(i, dummy.matrix);
      cushion.setColorAt(i, tint.set(CUSHION_COLORS[i % CUSHION_COLORS.length]));
    }
    group.add(cushion);

    const FLOWER_COLORS = ['#fff3a8', '#ffd0e6', '#ffffff', '#c9e8ff'];
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.6 + Math.random() * 11;
      dummy.position.set(Math.sin(a) * r, 0.035, Math.cos(a) * r);
      dummy.scale.setScalar(0.7 + Math.random() * 0.9);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      flower.setMatrixAt(i, dummy.matrix);
      flower.setColorAt(i, tint.set(FLOWER_COLORS[i % FLOWER_COLORS.length]));
    }
    group.add(flower);
  }

  // clouds
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < (props ? 9 : 3); i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(cloudGeo, new THREE.MeshToonMaterial({ color: '#ffffff' }));
      puff.position.set(j * 0.9 - 0.9, Math.random() * 0.25, Math.random() * 0.4);
      puff.scale.setScalar(0.8 + Math.random() * 0.6);
      c.add(puff);
    }
    c.position.set((Math.random() - 0.5) * 46, 6 + Math.random() * 6, (Math.random() - 0.5) * 46);
    group.add(c);
    clouds.push(c);
  }

  const update = (t: number) => {
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      c.position.x += Math.sin(t * 0.02 + i) * 0.004 + 0.004;
      c.position.y += Math.sin(t * 0.4 + i) * 0.002;
      if (c.position.x > 28) c.position.x = -28;
    }
  };

  return { group, sky, update };
}

/** Warm sun + sky fill: good light is half of "polished" in AR. */
export function buildLighting(): THREE.Group {
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x907060, 1.35);
  g.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sun.position.set(1.2, 3.2, 2.4);
  g.add(sun);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.6);
  rim.position.set(-2.4, 1.6, -2.2);
  g.add(rim);
  return g;
}
