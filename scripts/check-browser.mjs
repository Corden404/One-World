import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createSiteServer } from './serve.mjs';
import { LIGHT_OUT_DISTANCE, NIGHT_PAUSE_MS, LEG_DISTANCE } from '../dist/journey.js';
import { scenes } from '../dist/scenes.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const server = createSiteServer({ prefix: '/One-World/' });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}/One-World/`;
let browser;
const results = {}, errors = [];
const output = new URL('../output/playwright/', import.meta.url);
await mkdir(output, { recursive: true });
async function instrument(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.renderStats = { draws: 0, frames: 0, contexts: 0, compiles: 0, uploads: 0 };
    const contexts = new WeakSet(), getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const result = getContext.apply(this, args);
      if (args[0] === 'webgl' && result && !contexts.has(result)) { contexts.add(result); window.renderStats.contexts++; }
      return result;
    };
    for (const [method, field] of [['drawElements', 'draws'], ['compileShader', 'compiles'], ['texImage2D', 'uploads']]) {
      const original = WebGLRenderingContext.prototype[method];
      WebGLRenderingContext.prototype[method] = function (...args) { window.renderStats[field]++; return original.apply(this, args); };
    }
    const frame = requestAnimationFrame;
    window.requestAnimationFrame = callback => frame(time => { window.renderStats.frames++; callback(time); });
  });
}
async function ready(page, id) {
  await page.waitForFunction(scene => {
    const element = document.querySelector(`#${scene}-scene`), night = element?.querySelector('.fallback-off');
    return document.body.dataset.scene === scene && element.classList.contains('ready') && night?.complete && night.naturalWidth > 0;
  }, id);
}
async function scroll(page, position, id) {
  await page.evaluate(value => scrollTo(0, value), position); await ready(page, id);
}
async function resources(page) {
  return page.evaluate(() => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/assets/')).map(entry => ({ name: entry.name.split('/One-World/')[1], bytes: entry.encodedBodySize })));
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}), args: ['--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); await instrument(page); await page.goto(url); await ready(page, 'forest');
  await page.waitForTimeout(200);
  results.initialResources = await resources(page);
  assert.equal(new Set(results.initialResources.map(entry => entry.name)).size, 3, 'First visit should load only the current scene');
  const idleBefore = await page.evaluate(() => ({ ...window.renderStats }));
  await page.waitForTimeout(5000);
  const idleAfter = await page.evaluate(() => ({ ...window.renderStats }));
  results.idleDraws = idleAfter.draws - idleBefore.draws;
  results.idleFrames = idleAfter.frames - idleBefore.frames;
  assert.equal(results.idleDraws, 0, 'Default idle scene must stop drawing beyond the former automatic-motion delay');
  assert.equal(results.idleFrames, 0, 'Default idle scene must stop scheduling animation frames');
  await page.mouse.move(800, 550);
  await page.waitForFunction(() => Math.abs(Number(document.body.dataset.tiltX)) > .1);
  const enabledDraws = await page.evaluate(() => window.renderStats.draws);
  await page.keyboard.press('d'); await page.waitForTimeout(400);
  const disabledDraws = await page.evaluate(() => window.renderStats.draws);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.renderStats.draws), disabledDraws, 'Disabling depth should stop drawing a stationary scene');
  assert.ok(disabledDraws > enabledDraws, 'Depth toggle must redraw the centered image');
  await page.keyboard.press('d');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({ ...window.renderStats }));
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => ({ ...window.renderStats }));
  results.reducedMotionDrawsPerSecond = after.draws - before.draws;
  assert.equal(results.reducedMotionDrawsPerSecond, 0, 'A static reduced-motion scene must stop drawing');
  assert.equal(after.frames - before.frames, 0, 'A static scene must stop scheduling animation frames');
  await page.mouse.move(720, 450); await page.mouse.wheel(0, 450);
  await page.waitForFunction(() => document.body.dataset.phase === 'day-night');
  const lighting = await page.evaluate(() => [getComputedStyle(document.querySelector('#forest-scene')).getPropertyValue('--light'), getComputedStyle(document.querySelector('#ocean-scene')).getPropertyValue('--light')]);
  assert.ok(Math.abs(Number(lighting[0]) - .5) < .001); assert.equal(Number(lighting[1]), 1);
  await page.mouse.wheel(0, 5000);
  await page.waitForFunction(() => document.body.dataset.phase === 'night');
  const nightOffset = await page.locator('#world-track').evaluate(element => element.style.transform);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 2000); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => scrollY), LIGHT_OUT_DISTANCE, 'Continued wheel input must hold the fully dark scene');
  }
  assert.equal(await page.locator('#world-track').evaluate(element => element.style.transform), nightOffset, 'Camera must remain still during the night pause');
  assert.equal(await page.locator('#forest-scene').evaluate(element => Number(getComputedStyle(element).getPropertyValue('--light'))), 0);
  await page.screenshot({ path: fileURLToPath(new URL('night-pause.png', output)) });
  await page.waitForTimeout(NIGHT_PAUSE_MS);
  assert.equal(await page.evaluate(() => scrollY), LIGHT_OUT_DISTANCE, 'Finishing the pause must not replay wheel input or advance automatically');
  await page.mouse.wheel(0, LEG_DISTANCE - LIGHT_OUT_DISTANCE);
  await page.waitForFunction(position => scrollY === position, LEG_DISTANCE); await ready(page, 'ocean');
  await scroll(page, 0, 'forest'); await page.mouse.wheel(0, 5000);
  await page.waitForFunction(() => document.body.dataset.phase === 'night');
  await page.mouse.wheel(0, -200);
  await page.waitForFunction(position => scrollY === position, LIGHT_OUT_DISTANCE - 200);
  assert.equal(await page.locator('body').getAttribute('data-phase'), 'day-night', 'Reverse wheel input should work immediately during the pause');
  results.nightPausePassed = true;
  const ids = scenes.map(scene => scene.id), newScenes = scenes.slice(8);
  results.newSceneLighting = [];
  for (let i = 1; i < ids.length; i++) {
    await scroll(page, i * LEG_DISTANCE, ids[i]);
    assert.ok(await page.locator('.scene-fallback[src]').count() <= 3, 'Only the current, next and previous scenes should retain image references');
    assert.ok(await page.locator('.connector').evaluateAll(elements => elements.filter(element => element.style.backgroundImage).length) <= 3, 'Distant connectors must release image references');
    if (!newScenes.includes(scenes[i])) continue;
    const scene = scenes[i];
    await page.screenshot({ path: fileURLToPath(new URL(`${scene.id}-day.png`, output)) });
    await scroll(page, i * LEG_DISTANCE + LIGHT_OUT_DISTANCE, scene.id);
    await page.waitForFunction(() => document.body.dataset.phase === 'night');
    const state = await page.evaluate(id => {
      const element = document.querySelector(`#${id}-scene`);
      const next = element.nextElementSibling.nextElementSibling;
      const textures = [...element.querySelectorAll('img')].filter(image => image.src);
      return { light: Number(getComputedStyle(element).getPropertyValue('--light')), nextLight: Number(getComputedStyle(next).getPropertyValue('--light')), texturesLoaded: textures.every(image => image.complete && image.naturalWidth > 0) };
    }, scene.id);
    assert.equal(state.light, 0, `${scene.id}: night must reach the dark texture`);
    assert.equal(state.nextLight, 1, `${scene.id}: next scene must keep its original lighting`);
    assert.ok(state.texturesLoaded, `${scene.id}: both lighting images must load`);
    await page.screenshot({ path: fileURLToPath(new URL(`${scene.id}-night.png`, output)) });
    results.newSceneLighting.push({ id: scene.id, ...state });
  }
  const loopLength = scenes.length * LEG_DISTANCE;
  // Exercise a transition where both scenes intersect the viewport.
  await page.evaluate(value => scrollTo(0, value), loopLength - LEG_DISTANCE + 1600);
  await page.waitForFunction(() => document.querySelectorAll('.world-scene.ready').length === 2);
  await page.mouse.wheel(0, 900);
  await page.waitForFunction(() => Math.abs(scrollY - 200) < 1);
  await ready(page, 'forest');
  await page.mouse.wheel(0, -350);
  await page.waitForFunction(value => Math.abs(scrollY - value) < 1, loopLength - 150);
  await scroll(page, 0, 'forest');
  const loopStats = await page.evaluate(() => ({ ...window.renderStats }));
  assert.equal(loopStats.contexts, 2, 'Looping must reuse at most two WebGL contexts');
  assert.equal(loopStats.compiles, 4, 'Shaders must compile once for each retained context');
  results.loopStats = loopStats;
  results.sceneCacheBounded = true;
  const beforeReuse = loopStats.uploads;
  await scroll(page, 2300, 'ocean'); await scroll(page, 0, 'forest');
  assert.ok((await page.evaluate(() => window.renderStats.uploads)) - beforeReuse <= 2, 'Returning to a cached adjacent scene should reuse its textures');
  await page.screenshot({ path: fileURLToPath(new URL('desktop.png', output)) });
  const canvasWidth = await page.evaluate(() => document.querySelector('#forest-scene canvas').width);
  await page.evaluate(() => {
    window.lostContext = document.querySelector('#forest-scene canvas').getContext('webgl').getExtension('WEBGL_lose_context');
    window.lostContext.loseContext();
  });
  await page.waitForFunction(() => !document.querySelector('#forest-scene').classList.contains('ready'));
  await page.waitForTimeout(150); await page.evaluate(() => window.lostContext.restoreContext()); await ready(page, 'forest');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.querySelector('#forest-scene canvas').width), canvasWidth);
  results.contextRestored = true;
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, reducedMotion: 'reduce' });
  const mobilePage = await mobile.newPage(); await instrument(mobilePage); await mobilePage.goto(url); await ready(mobilePage, 'forest'); await mobilePage.waitForTimeout(150);
  results.mobileResources = await resources(mobilePage);
  assert.ok(results.mobileResources.filter(entry => entry.name.endsWith('.webp')).every(entry => entry.name.includes('/mobile/')), 'Phones should request compact images only');
  const bounds = await mobilePage.locator('#world-window').boundingBox(); assert.equal(bounds.width, 390); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
  for (const scene of scenes.slice(8)) {
    const index = scenes.indexOf(scene);
    await scroll(mobilePage, index * LEG_DISTANCE, scene.id);
    const images = await mobilePage.locator(`#${scene.id}-scene img`).evaluateAll(elements => elements.filter(image => image.src).map(image => ({ src: image.src, complete: image.complete && image.naturalWidth > 0 })));
    assert.ok(images.every(image => image.src.includes('/mobile/') && image.complete), `${scene.id}: phones must load complete compact lighting images`);
    await scroll(mobilePage, index * LEG_DISTANCE + LIGHT_OUT_DISTANCE, scene.id);
    await mobilePage.waitForFunction(() => document.body.dataset.phase === 'night');
    await mobilePage.screenshot({ path: fileURLToPath(new URL(`${scene.id}-mobile-night.png`, output)) });
  }
  results.newMobileScenesPassed = true;
  await scroll(mobilePage, 2300, 'ocean');
  await mobilePage.setViewportSize({ width: 1024, height: 1366 });
  await mobilePage.waitForFunction(() => document.querySelector('#ocean-scene .scene-fallback').src.endsWith('/assets/ocean-on.webp'));
  await scroll(mobilePage, 0, 'forest');
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.waitForFunction(() => document.querySelector('#forest-scene .scene-fallback').src.includes('/mobile/'));
  await scroll(mobilePage, 2300, 'ocean');
  await mobilePage.waitForFunction(() => document.querySelector('#ocean-scene .scene-fallback').src.includes('/mobile/'));
  await scroll(mobilePage, 0, 'forest');
  await mobilePage.screenshot({ path: fileURLToPath(new URL('mobile.png', output)) });
  results.mobileRotationPassed = true; await mobile.close();

  const progressive = await browser.newContext({ reducedMotion: 'reduce' });
  const progressivePage = await progressive.newPage(); await instrument(progressivePage);
  let releaseDepth, releaseNight;
  const depthGate = new Promise(resolve => { releaseDepth = resolve; });
  const nightGate = new Promise(resolve => { releaseNight = resolve; });
  await progressivePage.route('**/ocean-depth.png', async route => { await depthGate; await route.continue(); });
  await progressivePage.route('**/ocean-off.webp', async route => { await nightGate; await route.continue(); });
  try {
    await progressivePage.goto(url); await ready(progressivePage, 'forest');
    await progressivePage.evaluate(value => scrollTo(0, value), LEG_DISTANCE);
    await progressivePage.waitForFunction(() => {
      const image = document.querySelector('#ocean-scene .scene-fallback');
      return document.body.dataset.scene === 'ocean' && image.complete && image.naturalWidth > 0;
    });
    assert.equal(await progressivePage.locator('#ocean-scene').evaluate(element => element.classList.contains('ready')), false, 'Day image must appear before the delayed depth map');
    assert.equal(await progressivePage.locator('#ocean-scene .fallback-off').count(), 0, 'Day image must appear before the delayed night image');
    await progressivePage.screenshot({ path: fileURLToPath(new URL('progressive-static.png', output)) });
    releaseDepth();
    await progressivePage.waitForFunction(() => document.querySelector('#ocean-scene').classList.contains('ready'));
    assert.equal(await progressivePage.locator('#ocean-scene .fallback-off').count(), 0, 'Depth must activate without waiting for night');
    releaseNight(); await ready(progressivePage, 'ocean');
    results.progressiveLoadingPassed = true;
  } finally { releaseDepth(); releaseNight(); await progressive.close(); }

  const eviction = await browser.newContext({ reducedMotion: 'reduce' });
  const evictionPage = await eviction.newPage(); await instrument(evictionPage);
  let releaseEvictedNight;
  const evictionGate = new Promise(resolve => { releaseEvictedNight = resolve; });
  await evictionPage.route('**/ocean-off.webp', async route => { await evictionGate; await route.continue(); });
  try {
    await evictionPage.goto(url); await ready(evictionPage, 'forest');
    await evictionPage.evaluate(value => scrollTo(0, value), LEG_DISTANCE);
    await evictionPage.waitForFunction(() => document.querySelector('#ocean-scene').classList.contains('ready'));
    await scroll(evictionPage, 4 * LEG_DISTANCE, 'observatory');
    const nightResponse = evictionPage.waitForResponse(response => response.url().endsWith('/ocean-off.webp'));
    releaseEvictedNight(); await (await nightResponse).finished();
    assert.equal(await evictionPage.locator('#ocean-scene .scene-fallback').getAttribute('src'), null, 'Late loads must not repopulate an evicted scene');
    assert.equal(await evictionPage.locator('#ocean-scene .fallback-off').count(), 0);
    await scroll(evictionPage, LEG_DISTANCE, 'ocean');
    results.evictionRecoveryPassed = true;
  } finally { releaseEvictedNight(); await eviction.close(); }

  const failure = await browser.newContext({ reducedMotion: 'reduce' });
  const failurePage = await failure.newPage(); await instrument(failurePage);
  let attempts = 0;
  await failurePage.route('**/ocean-depth.png', route => { attempts++; return route.abort('failed'); });
  await failurePage.goto(url); await ready(failurePage, 'forest'); await failurePage.evaluate(() => scrollTo(0, 2300));
  await failurePage.waitForFunction(() => document.querySelector('#live-status').textContent.includes('静态画面'));
  assert.equal(attempts, 3, 'Image failure should retry three times');
  await failurePage.waitForTimeout(1000); assert.equal(attempts, 3, 'Persistent failure must not create a request loop');
  await failurePage.unroute('**/ocean-depth.png');
  await scroll(failurePage, 4600, 'cloud'); await scroll(failurePage, 2300, 'ocean');
  results.networkRecoveryPassed = true; await failure.close();

  const fallback = await browser.newContext({ reducedMotion: 'reduce' });
  const fallbackPage = await fallback.newPage(); await instrument(fallbackPage);
  await fallbackPage.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl' ? null : original.call(this, type, ...args); }; });
  await fallbackPage.goto(url);
  await fallbackPage.waitForFunction(() => document.querySelector('#forest-scene .fallback-off')?.complete);
  await fallbackPage.evaluate(() => scrollTo(0, 2750));
  await fallbackPage.waitForFunction(() => document.body.dataset.scene === 'ocean' && document.querySelector('#ocean-scene .fallback-off')?.complete);
  assert.equal(await fallbackPage.locator('.world-scene.ready').count(), 0);
  for (const scene of scenes.slice(8)) {
    await fallbackPage.evaluate(value => scrollTo(0, value), scenes.indexOf(scene) * LEG_DISTANCE + LIGHT_OUT_DISTANCE);
    await fallbackPage.waitForFunction(id => document.body.dataset.scene === id && document.querySelector(`#${id}-scene .fallback-off`)?.complete && document.querySelector(`#${id}-scene .fallback-off`)?.naturalWidth > 0, scene.id);
    assert.equal(await fallbackPage.locator(`#${scene.id}-scene`).evaluate(element => Number(getComputedStyle(element).getPropertyValue('--light'))), 0);
  }
  results.staticFallbackPassed = true; await fallback.close();
  assert.deepEqual(errors, [], 'Browser should not produce uncaught errors');
  results.initialBytes = results.initialResources.reduce((sum, entry) => sum + entry.bytes, 0);
  results.mobileInitialBytes = results.mobileResources.reduce((sum, entry) => sum + entry.bytes, 0);
  await writeFile(new URL('browser-results.json', output), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
