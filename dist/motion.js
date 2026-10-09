const TILT_RESPONSE_ANGLE = 18;
const MAX_TILT_ANGLE = 30;
const MAX_TILT_POINTER = MAX_TILT_ANGLE / TILT_RESPONSE_ANGLE;
const clamp = value => Math.max(-MAX_TILT_POINTER, Math.min(MAX_TILT_POINTER, value));
const angleDelta = (value, origin) => ((value - origin + 540) % 360) - 180;

export function tiltToPointer(beta, gamma, baseline, screenAngle = 0) {
  const x = angleDelta(gamma, baseline.gamma) / TILT_RESPONSE_ANGLE;
  const y = angleDelta(beta, baseline.beta) / TILT_RESPONSE_ANGLE;
  const angle = screenAngle * Math.PI / 180;
  return { x: clamp(x * Math.cos(angle) + y * Math.sin(angle)),
    y: clamp(-x * Math.sin(angle) + y * Math.cos(angle)) };
}

// Request both permissions synchronously inside the same trusted tap on iOS.
export async function sensorPermission(environment, userGesture) {
  const types = [environment.DeviceOrientationEvent, environment.DeviceMotionEvent].filter(Boolean);
  if (!types.length || environment.isSecureContext === false) return 'unavailable';
  if (!userGesture && types.some(type => typeof type.requestPermission === 'function')) return 'needs-permission';
  const results = await Promise.allSettled(types.map(type =>
    typeof type.requestPermission === 'function' ? type.requestPermission() : Promise.resolve('granted')));
  return results.some(result => result.status === 'fulfilled' && result.value === 'granted') ? 'granted' : 'denied';
}

export class MotionInput {
  constructor(onMove, onState, environment = window) {
    this.environment = environment; this.onMove = onMove; this.onState = onState;
    this.state = 'idle'; this.hasData = false; this.listening = false;
    this.baseline = null; this.lastOrientation = -Infinity; this.rotation = { beta: 0, gamma: 0 };
    this.angle = () => environment.screen?.orientation?.angle ?? environment.orientation ?? 0;
    this.orientation = event => {
      if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      this.lastOrientation = performance.now();
      this.baseline ??= { beta: event.beta, gamma: event.gamma };
      this.emit(tiltToPointer(event.beta, event.gamma, this.baseline, this.angle()));
    };
    this.motion = event => {
      if (performance.now() - this.lastOrientation < 600) return;
      const rate = event.rotationRate;
      if (!rate || !Number.isFinite(rate.beta) || !Number.isFinite(rate.gamma)) return;
      const dt = Math.max(0, Math.min(100, event.interval || 16)) / 1000;
      const decay = Math.exp(-dt * 1.5);
      this.rotation.beta = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, this.rotation.beta * decay + rate.beta * dt));
      this.rotation.gamma = Math.max(-MAX_TILT_ANGLE, Math.min(MAX_TILT_ANGLE, this.rotation.gamma * decay + rate.gamma * dt));
      this.emit(tiltToPointer(this.rotation.beta, this.rotation.gamma, { beta: 0, gamma: 0 }, this.angle()));
    };
    this.recenter = () => {
      this.baseline = null; this.lastOrientation = -Infinity; this.rotation = { beta: 0, gamma: 0 };
      this.onMove({ x: 0, y: 0 });
    };
  }
  emit(pointer) {
    this.hasData = true;
    if (this.state !== 'active') { this.state = 'active'; this.onState(this.state); }
    this.onMove(pointer);
  }
  async enable(userGesture = false) {
    if (this.listening || this.pending || (this.state === 'denied' && !userGesture)) return;
    this.pending = true;
    try {
      const permission = await sensorPermission(this.environment, userGesture);
      this.state = permission === 'granted' ? 'listening' : permission;
      if (permission === 'granted') {
        this.listening = true;
        this.environment.addEventListener('deviceorientation', this.orientation, { passive: true });
        this.environment.addEventListener('devicemotion', this.motion, { passive: true });
        this.environment.screen?.orientation?.addEventListener('change', this.recenter);
        this.environment.addEventListener('orientationchange', this.recenter, { passive: true });
        this.environment.document?.addEventListener('visibilitychange', this.recenter);
      }
      this.onState(this.state);
    } catch { this.state = 'denied'; this.onState(this.state); }
    finally { this.pending = false; }
  }
}
