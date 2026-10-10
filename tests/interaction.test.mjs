import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { scenes } from '../dist/scenes.js';
import { journeyAt, loopPosition, LEG_DISTANCE, LIGHT_OUT_DISTANCE, NIGHT_PAUSE_MS, WheelJourney } from '../dist/journey.js';
import { MotionInput, tiltToPointer, sensorPermission } from '../dist/motion.js';
import { buildDepthMesh, meshResolution } from '../dist/geometry.js';
import { sceneAssets } from '../dist/assets.js';

test('stationary sensors do not emit duplicate moves and hidden readings do not recalibrate', async () => {
  const listeners = new Map(), values = [];
  const environment = { isSecureContext: true, DeviceOrientationEvent: {},
    document: { hidden: false, addEventListener: (name, fn) => listeners.set(`document-${name}`, fn) },
    addEventListener: (name, fn) => listeners.set(name, fn) };
  const input = new MotionInput(value => values.push(value), () => {}, environment);
  await input.enable();
  const orientation = listeners.get('deviceorientation');
  orientation({ beta: 60, gamma: 0 });
  orientation({ beta: 60, gamma: 0 });
  orientation({ beta: 60.009, gamma: .009 });
  assert.equal(values.length, 1, 'Identical readings and tiny noise must not redraw');
  orientation({ beta: 60.09, gamma: .09 });
  assert.equal(values.length, 2, 'Intentional tilt must still emit');
  environment.document.hidden = true;
  orientation({ beta: 90, gamma: 30 });
  assert.equal(values.length, 2);
  environment.document.hidden = false; listeners.get('document-visibilitychange')();
  orientation({ beta: 80, gamma: 20 });
  assert.deepEqual(values.at(-1), { x: 0, y: 0 }, 'Returning to the page must recenter the hold angle');
});

test('every world has two lighting textures, depth and an outgoing connector', () => {
  assert.equal(scenes.length, 12);
  assert.equal(new Set(scenes.map(scene => scene.id)).size, scenes.length, 'Scene IDs must be unique');
  for (const scene of scenes.flatMap(scene => [scene, sceneAssets(scene, true)])) for (const field of ['image', 'darkImage', 'depth', 'connector']) {
    assert.ok(scene[field], `${scene.id}: ${field}`);
    assert.ok(existsSync(new URL(`../dist/${scene[field]}`, import.meta.url)), `${scene.id}: missing ${field}`);
  }
});

test('compact assets preserve scene geometry and share the original depth map', () => {
  for (const scene of scenes) {
    const compact = sceneAssets(scene, true);
    assert.equal(compact.aspectRatio, scene.aspectRatio); assert.equal(compact.depth, scene.depth);
    assert.ok(compact.image.includes('/mobile/')); assert.ok(compact.connector.includes('/mobile/'));
  }
});

test('depth mesh retains corner UVs, samples depth and stays within index capacity', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  const { vertices, indices } = buildDepthMesh({ data, width: 2, height: 2 }, 1, 1);
  assert.deepEqual([...vertices.slice(0, 5)], [-1, 1, 0, 0, 0]);
  assert.deepEqual([...vertices.slice(-5)], [1, -1, 1, 1, 1]);
  assert.ok(Math.abs(vertices[9] - 1 / 3) < 1e-6);
  assert.deepEqual([...indices], [0, 1, 2, 1, 3, 2]);
  assert.throws(() => buildDepthMesh({ data, width: 2, height: 2 }, 256, 256), RangeError);
  for (const width of [390, 600]) {
    const { columns, rows } = meshResolution(width);
    const mesh = buildDepthMesh({ data, width: 2, height: 2 }, columns, rows);
    assert.equal(mesh.indices.length, columns * rows * 6);
    assert.equal(Math.max(...mesh.indices.slice(-6)), (columns + 1) * (rows + 1) - 1);
  }
});

test('only the outgoing world dims, including the last-to-first leg', () => {
  for (let index = 0; index < scenes.length; index++) {
    const half = journeyAt(index * LEG_DISTANCE + LIGHT_OUT_DISTANCE / 2, scenes.length + 1);
    assert.equal(half.fromLight, .5); assert.equal(half.toLight, 1); assert.equal(half.camera, index);
    const travel = journeyAt(index * LEG_DISTANCE + LIGHT_OUT_DISTANCE + 700, scenes.length + 1);
    assert.equal(travel.fromLight, 0); assert.equal(travel.toLight, 1); assert.equal(travel.camera, index + .5);
  }
  const end = journeyAt(scenes.length * LEG_DISTANCE, scenes.length + 1);
  assert.equal(end.camera, scenes.length); assert.equal(end.toLight, 1);
  assert.equal(journeyAt(loopPosition(scenes.length * LEG_DISTANCE, scenes.length), scenes.length + 1).fromLight, 1);
});

test('looping retains forward and backward wheel overshoot', () => {
  const length = scenes.length * LEG_DISTANCE;
  assert.equal(loopPosition(length + 120, scenes.length), 120);
  assert.equal(loopPosition(-120, scenes.length), length - 120);
  assert.equal(loopPosition(length * 3 + 5, scenes.length), 5);
});

test('forward wheel input holds every world at full darkness before travelling', () => {
  const wheel = new WheelJourney(scenes.length);
  for (let index = 0; index < scenes.length; index++) {
    const night = index * LEG_DISTANCE + LIGHT_OUT_DISTANCE, start = index * 2000;
    assert.equal(wheel.advance(night - 100, 10000, start), night, 'Large wheel deltas must stop at the first night');
    for (const elapsed of [100, 500, NIGHT_PAUSE_MS - 1]) {
      assert.equal(wheel.advance(night, 500, start + elapsed), night, 'Continued scrolling must neither skip nor extend the pause');
    }
    const state = journeyAt(night, scenes.length + 1);
    assert.equal(state.phase, 'night'); assert.equal(state.fromLight, 0); assert.equal(state.camera, index);
    assert.equal(wheel.advance(night, 120, start + NIGHT_PAUSE_MS), night + 120, 'Resume using only the new wheel delta');
  }
});

test('night pause allows immediate reverse input and rearms when returning to night', () => {
  const wheel = new WheelJourney(scenes.length);
  assert.equal(wheel.advance(800, 200, 0), 900);
  assert.equal(wheel.advance(900, -120, 100), 780);
  assert.equal(wheel.advance(780, 200, 200), 900);
  assert.equal(wheel.advance(900, 100, 1000), 900);
  assert.equal(wheel.advance(900, 100, 1200), 1000);
});

test('wheel pause preserves looping and catches the first night after wrapping', () => {
  const wheel = new WheelJourney(scenes.length), length = scenes.length * LEG_DISTANCE;
  assert.equal(wheel.advance(length - 100, 220, 0), 120);
  assert.equal(wheel.advance(120, -270, 10), length - 150);
  assert.equal(wheel.advance(length - 150, 2000, 20), LIGHT_OUT_DISTANCE);
  assert.equal(wheel.advance(LIGHT_OUT_DISTANCE, 100, 20 + NIGHT_PAUSE_MS - 1), LIGHT_OUT_DISTANCE);
  assert.equal(wheel.advance(LIGHT_OUT_DISTANCE, 100, 20 + NIGHT_PAUSE_MS), LIGHT_OUT_DISTANCE + 100);
});

test('tilt calibrates relative to the hold angle and follows screen rotation', () => {
  const baseline = { beta: 60, gamma: 5 };
  assert.deepEqual(tiltToPointer(60, 5, baseline), { x: 0, y: 0 });
  assert.deepEqual(tiltToPointer(69, 14, baseline), { x: .5, y: .5 });
  const landscape = tiltToPointer(60, 23, baseline, 90);
  assert.ok(Math.abs(landscape.x) < 1e-6); assert.equal(landscape.y, -1);
  assert.equal(tiltToPointer(-179, 0, { beta: 179, gamma: 0 }).y, 2 / 18);
  assert.deepEqual(tiltToPointer(78, 23, baseline), { x: 1, y: 1 });
  assert.deepEqual(tiltToPointer(90, 35, baseline), { x: 30 / 18, y: 30 / 18 });
  assert.deepEqual(tiltToPointer(100, 100, baseline), { x: 30 / 18, y: 30 / 18 });
  assert.deepEqual(tiltToPointer(20, -90, baseline), { x: -30 / 18, y: -30 / 18 });
  const maximumLandscape = tiltToPointer(60, 35, baseline, 270);
  assert.ok(Math.abs(maximumLandscape.x) < 1e-6); assert.equal(maximumLandscape.y, 30 / 18);
});

test('iOS permission stays deferred until a tap and requests both sensors together', async () => {
  const calls = [], resolvers = [];
  const type = name => ({ requestPermission: () => { calls.push(name); return new Promise(resolve => resolvers.push(resolve)); } });
  const environment = { isSecureContext: true, DeviceOrientationEvent: type('orientation'), DeviceMotionEvent: type('motion') };
  assert.equal(await sensorPermission(environment, false), 'needs-permission'); assert.deepEqual(calls, []);
  const pending = sensorPermission(environment, true);
  assert.deepEqual(calls, ['orientation', 'motion']);
  resolvers.forEach(resolve => resolve('granted')); assert.equal(await pending, 'granted');
  assert.equal(await sensorPermission({ isSecureContext: false, DeviceOrientationEvent: {} }, true), 'unavailable');
  assert.equal(await sensorPermission({ DeviceOrientationEvent: { requestPermission: async () => 'denied' } }, true), 'denied');
});

test('mobile input ignores invalid readings, recenters on rotation and uses motion fallback', async () => {
  const listeners = new Map(), values = [], states = [];
  const environment = { isSecureContext: true, DeviceOrientationEvent: {}, DeviceMotionEvent: {},
    screen: { orientation: { angle: 0, addEventListener: (name, fn) => listeners.set(`screen-${name}`, fn) } },
    addEventListener: (name, fn) => listeners.set(name, fn) };
  const input = new MotionInput(value => values.push(value), state => states.push(state), environment);
  await input.enable();
  listeners.get('deviceorientation')({ beta: null, gamma: null }); assert.equal(input.hasData, false);
  listeners.get('deviceorientation')({ beta: 60, gamma: 0 });
  listeners.get('deviceorientation')({ beta: 69, gamma: 9 }); assert.deepEqual(values.at(-1), { x: .5, y: .5 });
  listeners.get('devicemotion')({ interval: 16, rotationRate: { beta: 100, gamma: 100 } });
  assert.deepEqual(values.at(-1), { x: .5, y: .5 });
  environment.screen.orientation.angle = 90; listeners.get('screen-change')();
  listeners.get('deviceorientation')({ beta: 20, gamma: 2 }); assert.deepEqual(values.at(-1), { x: 0, y: 0 });
  listeners.get('screen-change')();
  listeners.get('devicemotion')({ interval: 100, rotationRate: { beta: 90, gamma: 0 } });
  assert.ok(values.at(-1).x > .49); assert.ok(Math.abs(values.at(-1).y) < 1e-6);
  listeners.get('devicemotion')({ interval: 100, rotationRate: { beta: 1000, gamma: -1000 } });
  assert.deepEqual(values.at(-1), { x: 30 / 18, y: 30 / 18 });
  assert.ok(states.includes('active'));
});
