export const LIGHT_OUT_DISTANCE = 900;
export const TRAVEL_DISTANCE = 1400;
export const LEG_DISTANCE = LIGHT_OUT_DISTANCE + TRAVEL_DISTANCE;

// The track ends with a copy of scene zero; wrapping preserves wheel overshoot.
export function loopPosition(position, sceneCount) {
  const length = sceneCount * LEG_DISTANCE;
  return length > 0 ? ((position % length) + length) % length : 0;
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
    return { from, to, camera: from, fromLight: 1 - local / LIGHT_OUT_DISTANCE, toLight: 1, phase: local === 0 ? 'day' : 'day-night' };
  }
  const camera = from + (local - LIGHT_OUT_DISTANCE) / TRAVEL_DISTANCE;
  return { from, to, camera, fromLight: 0, toLight: 1, phase: camera === to ? 'day' : 'travelling' };
}
