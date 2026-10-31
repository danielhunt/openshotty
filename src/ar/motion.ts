/* ============================================================
   Motion tracking.

   iPhone Safari gives us a compass-relative device attitude plus an
   accelerometer. Two things make it feel like real AR:

   1. Attitude is converted to a camera quaternion and re-zeroed at
      calibration, so the virtual world always opens facing where she
      is pointing — no spinning, no drift on start.
   2. Steps are counted from the accelerometer and turned into real
      forward movement, so walking down the hallway closes the distance
      to a monster. This is the difference between a magic window and
      an adventure.
   ============================================================ */

import * as THREE from 'three';

export interface MotionOptions {
  /** 0 = no walking detection, 1 = normal, 2 = keen */
  walkSensitivity: number;
  /** 0 slow, 1 normal, 2 zippy — smoothing strength for the look-around */
  tiltSpeed: number;
}

const _zee = new THREE.Vector3(0, 0, 1);
const _yee = new THREE.Vector3(0, 1, 0);
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const _euler = new THREE.Euler();
const _fwd = new THREE.Vector3();
const _scratch = new THREE.Quaternion();

function clampAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** three.js' classic device-attitude conversion: alpha/beta/gamma + screen angle -> camera quaternion. */
function attitudeFrom(alpha: number, beta: number, gamma: number, screenAngle: number, out: THREE.Quaternion) {
  _zee.set(0, 0, 1);
  _zee.applyQuaternion(_q0.setFromAxisAngle(_zee, alpha));
  out.copy(_q0);

  _yee.set(0, 1, 0);
  _yee.applyQuaternion(_q0.setFromAxisAngle(_yee, beta));
  out.multiply(_q0);

  _zee.set(0, 0, 1);
  _zee.applyQuaternion(_q0.setFromAxisAngle(_zee, gamma));
  out.multiply(_q0);

  out.multiply(_q1);

  _euler.setFromQuaternion(out, 'YXZ');
  _euler.y -= screenAngle;
  _euler.x = clampAngle(Math.PI / 2 - _euler.x);
  _euler.z = clampAngle(_euler.z);
  _euler.order = 'YXZ';
  out.setFromEuler(_euler);
  return out;
}

export class MotionTracker {
  /** live camera quaternion in game-world space */
  readonly quaternion = new THREE.Quaternion();
  /** where she has walked to, in game-world metres */
  readonly position = new THREE.Vector3();
  /** true once real sensor data has arrived */
  haveOrientation = false;
  haveMotion = false;

  yaw = 0;
  pitch = 0;
  roll = 0;

  private alpha = 0;
  private beta = 0;
  private gamma = 0;
  private screenAngle = 0;
  private raw = new THREE.Quaternion();
  private calib = new THREE.Quaternion();
  private target = new THREE.Quaternion();

  // step detection
  private accelAvg = 1;
  private lastStepAt = -10;
  private cooldown = 0.24;
  private armed = true;
  private bobPhase = 0;
  private cadence = 0.55;

  // manual look (touch-drag fallback, also used to nudge the view)
  private manualYaw = 0;
  private manualPitch = 0;

  private handleOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null) return;
    this.haveOrientation = true;
    this.alpha = THREE.MathUtils.degToRad(e.alpha);
    this.beta = THREE.MathUtils.degToRad(e.beta ?? 0);
    this.gamma = THREE.MathUtils.degToRad(e.gamma ?? 0);
    const so = window.screen?.orientation;
    this.screenAngle = THREE.MathUtils.degToRad(so ? so.angle : (window as unknown as { orientation?: number }).orientation ?? 0);
  };

  private handleMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    this.haveMotion = true;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (!isFinite(mag)) return;

    // slow baseline so simply carrying the phone around doesn't count as walking
    this.accelAvg += (mag - this.accelAvg) * 0.055;
    const delta = mag - this.accelAvg;
    const now = performance.now() / 1000;
    const thresh = this.threshold();
    if (thresh <= 0) return;

    if (!this.armed) {
      // wait until the swing settles before allowing the next step
      if (delta < thresh * 0.45 && now - this.lastStepAt > this.cooldown) this.armed = true;
      return;
    }
    if (delta > thresh && now - this.lastStepAt > this.cooldown) {
      const cadence = now - this.lastStepAt;
      this.lastStepAt = now;
      this.armed = false;
      this.registerStep(cadence);
    }
  };

  constructor(private opts: MotionOptions) {
    this.calib.identity();
  }

  private threshold() {
    switch (this.opts.walkSensitivity) {
      case 0:
        return -1;
      case 2:
        return 0.85;
      default:
        return 1.5;
    }
  }

  async requestPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<PermissionState | 'granted' | 'denied'> };
    try {
      if (typeof DOE?.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return 'denied';
      }
    } catch {
      return 'denied';
    }
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<PermissionState | 'granted' | 'denied'> };
    try {
      if (typeof DME?.requestPermission === 'function') await DME.requestPermission();
    } catch {
      /* motion is a bonus; orientation is the must-have */
    }
    window.addEventListener('deviceorientation', this.handleOrientation, true);
    window.addEventListener('devicemotion', this.handleMotion, true);
    // give the sensors a moment to deliver their first event
    for (let i = 0; i < 25 && !this.haveOrientation; i++) await new Promise((r) => setTimeout(r, 40));
    return this.haveOrientation ? 'granted' : 'denied';
  }

  /** Fall back to touch-drag look-around when sensors are unavailable. */
  enableFallbackSensors() {
    this.opts.walkSensitivity = 0;
  }

  addLook(dxPixels: number, dyPixels: number) {
    const k = 0.0038 * [0.55, 1, 1.6][this.opts.tiltSpeed];
    this.manualYaw -= dxPixels * k;
    this.manualPitch -= dyPixels * k;
    // ±35°, not ±70°: monsters live in a band around the horizon, and a drag
    // that overshoots used to leave the screen filled with grass or ceiling.
    // With a real gyroscope the device still decides how far she can look down.
    this.manualPitch = THREE.MathUtils.clamp(this.manualPitch, -0.62, 0.62);
  }

  /** Zero the world so it opens facing whatever she is pointing at. */
  calibrate() {
    this.updateTarget();
    // yaw-only correction keeps the horizon level
    _euler.setFromQuaternion(this.target, 'YXZ');
    this.calib.setFromAxisAngle(_yee, _euler.y);
    this.calib.invert();
    this.manualYaw = 0;
    this.manualPitch = 0;
    this.position.set(0, 0, 0);
    this.accelAvg = 1;
  }

  /** Re-face forward without moving (used by the "face me straight ahead" button). */
  recenter() {
    this.calibrate();
  }

  private updateTarget() {
    if (this.haveOrientation) {
      attitudeFrom(this.alpha, this.beta, this.gamma, this.screenAngle, this.raw);
      this.target.copy(this.raw);
    } else {
      this.target.identity();
    }
    // touch-drag nudges the view on top of the sensors, or is the whole view without them
    if (this.manualYaw !== 0 || this.manualPitch !== 0) {
      this.target.multiply(_q0.setFromEuler(_euler.set(this.manualPitch, this.manualYaw, 0, 'YXZ')));
    }
  }

  /** Smooth toward the sensor pose, then apply calibration. Returns camera quaternion. */
  update(dt: number): THREE.Quaternion {
    this.updateTarget();
    const rate = [0.0042, 0.0016, 0.0007][this.opts.tiltSpeed];
    const k = 1 - Math.exp(-dt / rate);
    _scratch.copy(this.target).premultiply(this.calib);
    this.quaternion.slerp(_scratch, Math.min(1, k));

    // walk the world's forward vector out of the camera
    _fwd.set(0, 0, -1).applyQuaternion(this.quaternion);
    _fwd.y = 0;
    if (_fwd.lengthSq() > 0.0001) _fwd.normalize();
    this._forwardHorizontal.copy(_fwd);

    const e = _euler.setFromQuaternion(this.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.roll = e.z;
    return this.quaternion;
  }

  private _forwardHorizontal = new THREE.Vector3(0, 0, -1);
  onStepDetected: ((stepMeters: number) => void) | null = null;

  private registerStep(secondsSinceLast: number) {
    // a longer stride when she is in a hurry, a shorter one when tiptoeing
    if (isFinite(secondsSinceLast) && secondsSinceLast > 0 && secondsSinceLast < 3) {
      this.cadence += (THREE.MathUtils.clamp(secondsSinceLast, 0.3, 0.9) - this.cadence) * 0.35;
    }
    this.bobPhase += 1;
    const stride = 0.3 + (0.95 - this.cadence) * 0.42;
    this.position.addScaledVector(this._forwardHorizontal, stride);
    this.onStepDetected?.(stride);
  }

  get forward() {
    return this._forwardHorizontal;
  }

  get walking() {
    return performance.now() / 1000 - this.lastStepAt < 0.9;
  }

  /** gentle head-bob so standing still never looks frozen */
  get bob() {
    return Math.sin(this.bobPhase * Math.PI) * 0.004;
  }

  /** Small lateral shift when the phone rolls — fake parallax, big presence win. */
  parallax(out: THREE.Vector3) {
    const right = out.set(1, 0, 0).applyQuaternion(this.quaternion);
    right.y = 0;
    return right.multiplyScalar(-this.roll * 0.16);
  }

  setOptions(opts: Partial<MotionOptions>) {
    Object.assign(this.opts, opts);
  }

  dispose() {
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
    window.removeEventListener('devicemotion', this.handleMotion, true);
  }
}
