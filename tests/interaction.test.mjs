import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { scenes } from '../dist/scenes.js';
import { journeyAt, loopPosition, LEG_DISTANCE, LIGHT_OUT_DISTANCE } from '../dist/journey.js';
import { MotionInput, tiltToPointer, sensorPermission } from '../dist/motion.js';

test('every world has two lighting textures, depth and an outgoing connector', () => {
  assert.equal(scenes.length, 8);
  for (const scene of scenes) for (const field of ['image', 'darkImage', 'depth', 'connector']) {
    assert.ok(scene[field], `${scene.id}: ${field}`);
    assert.ok(existsSync(new URL(`../dist/${scene[field]}`, import.meta.url)), `${scene.id}: missing ${field}`);
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
