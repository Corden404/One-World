export const LIGHT_OUT_DISTANCE = 900;
export const TRAVEL_DISTANCE = 1400;
export const LEG_DISTANCE = LIGHT_OUT_DISTANCE + TRAVEL_DISTANCE;
export const NIGHT_PAUSE_MS = 1000;

// The track ends with a copy of scene zero; wrapping preserves wheel overshoot.
export function loopPosition(position, sceneCount) {
  const length = sceneCount * LEG_DISTANCE;
  return length > 0 ? ((position % length) + length) % length : 0;
}

// Stop forward wheel input at full darkness, discarding overshoot during the pause.
export class WheelJourney {
  constructor(sceneCount) {
    this.sceneCount = sceneCount;
    this.pausePosition = null;
    this.resumeAt = 0;
  }

  advance(position, delta, now) {
    const current = loopPosition(position, this.sceneCount);
    if (!delta || !this.sceneCount) return current;
    if (delta < 0) {
      this.pausePosition = null;
      return loopPosition(current + delta, this.sceneCount);
    }
    if (current !== this.pausePosition) this.pausePosition = null;
    if (this.pausePosition !== null && now < this.resumeAt) return current;

    let night = Math.floor(current / LEG_DISTANCE) * LEG_DISTANCE + LIGHT_OUT_DISTANCE;
    if (night < current || (night === current && this.pausePosition === current)) night += LEG_DISTANCE;
    if (current + delta >= night) {
      this.pausePosition = loopPosition(night, this.sceneCount);
      this.resumeAt = now + NIGHT_PAUSE_MS;
      return this.pausePosition;
    }
    return loopPosition(current + delta, this.sceneCount);
  }
}

// Scroll position is the sole source of transition progress. No timed tween.
export function journeyAt(scrollPosition, sceneCount) {
  if (sceneCount < 2) return { from: 0, to: 0, camera: 0, fromLight: 1, toLight: 1, phase: 'day' };
  const maximum = (sceneCount - 1) * LEG_DISTANCE;
  const offset = Math.max(0, Math.min(maximum, scrollPosition));
  const from = Math.min(sceneCount - 2, Math.floor(offset / LEG_DISTANCE));
  const local = offset - from * LEG_DISTANCE;
  const to = from + 1;
  if (local <= LIGHT_OUT_DISTANCE) {
    return { from, to, camera: from, fromLight: 1 - local / LIGHT_OUT_DISTANCE, toLight: 1, phase: local === 0 ? 'day' : local === LIGHT_OUT_DISTANCE ? 'night' : 'day-night' };
  }
  const camera = from + (local - LIGHT_OUT_DISTANCE) / TRAVEL_DISTANCE;
  return { from, to, camera, fromLight: 0, toLight: 1, phase: camera === to ? 'day' : 'travelling' };
}
