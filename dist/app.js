import { scenes } from './scenes.js';
import { DepthView, loadImage, retainImages } from './depth-view.js';
import { COMPACT_MEDIA, sceneAssets } from './assets.js';
import { journeyAt, loopPosition, LEG_DISTANCE, WheelJourney } from './journey.js';
import { MotionInput } from './motion.js';

const stage = document.querySelector('#world-window'), track = document.querySelector('#world-track');
const status = document.querySelector('#live-status'), scrollSpace = document.querySelector('#scroll-space');
const hint = document.querySelector('#interaction-hint');
const reduced = matchMedia('(prefers-reduced-motion: reduce)'), compact = matchMedia(COMPACT_MEDIA);
const viewScenes = [...scenes, scenes[0]], maximumScroll = scenes.length * LEG_DISTANCE;
const wheelJourney = new WheelJourney(scenes.length);
const target = { x: 0, y: 0 }, pointer = { x: 0, y: 0 }, views = [], connectors = [];
const sceneLoads = new Map(), connectorLoads = new Map(), retryAfter = new Map();
const retainedIndexes = new Set();
let retainedFrom = -1, retainedCompact = null;
let loading = true, depthEnabled = !reduced.matches, current = -1, hasExplored = window.scrollY > 0;
let journey = journeyAt(window.scrollY, viewScenes.length), metrics = [], layoutDirty = true, journeyDirty = true;
let animationFrame = 0, previous = performance.now();
let hintDismissed = false, hintTimer = 0;
const announce = text => { status.textContent = text; };
const motion = new MotionInput(position => {
  if (!depthEnabled || reduced.matches || document.hidden || (position.x === target.x && position.y === target.y)) return;
  Object.assign(target, position); requestRender();
}, state => {
  document.body.dataset.motion = state;
  if (state === 'denied') announce('倾斜感应未获授权，仍可滑动探索场景。');
  updateHint();
  requestRender();
});
const mobile = matchMedia('(pointer:coarse)').matches || navigator.maxTouchPoints > 0;
function updateHint() {
  hint.firstElementChild.textContent = mobile ? '上下滑动探索十二幕世界' : '滚动探索十二幕世界';
  const detail = reduced.matches ? '每幕都有独立的日夜变化' : !mobile ? '移动鼠标感受景深 · 聚焦画面后按 D 切换' :
    motion.state === 'needs-permission' ? '轻触画面后可启用倾斜感应' : motion.listening ? '轻轻倾斜手机感受景深' : '左右轻滑感受景深';
  hint.lastElementChild.textContent = detail;
}
function dismissHint() {
  if (hintDismissed) return;
  hintDismissed = true; clearTimeout(hintTimer); hint.classList.add('is-dismissed');
  hintTimer = setTimeout(() => { hint.hidden = true; }, 400);
}
function showHint() {
  if (hintDismissed) return;
  try {
    if (sessionStorage.getItem('one-world:interaction-hint')) return;
    sessionStorage.setItem('one-world:interaction-hint', 'seen');
  } catch { /* Guidance still works when session storage is unavailable. */ }
  updateHint(); hint.hidden = false; hintTimer = setTimeout(dismissHint, 6500);
}
track.replaceChildren();
viewScenes.forEach((scene, index) => {
  const element = document.createElement('div'); element.className = 'world-scene'; element.id = `${scene.id}${index === scenes.length ? '-return' : ''}-scene`;
  const surface = document.createElement('div'); surface.className = 'scene-surface';
  const image = new Image(); image.decoding = 'async'; image.fetchPriority = index === journey.from ? 'high' : 'low';
  if (index === journey.from) image.src = sceneAssets(scene, compact.matches).image;
  image.alt = scene.description; image.className = 'scene-fallback';
  const canvas = document.createElement('canvas'); canvas.className = 'scene-canvas'; canvas.setAttribute('aria-hidden', 'true');
  const frame = image.cloneNode(); frame.alt = ''; frame.className = 'scene-frame'; frame.setAttribute('aria-hidden', 'true');
  surface.append(image, canvas); element.append(surface, frame); track.append(element); views.push(new DepthView(element, scene));
  if (index < scenes.length) {
    const connector = document.createElement('div'); connector.className = 'connector'; connector.setAttribute('aria-hidden', 'true');
    track.append(connector); connectors.push(connector);
  }
});
function prepareScene(index) {
  const view = views[index]; if (!view) return Promise.resolve();
  const key = `scene:${index}:${sceneAssets(viewScenes[index], compact.matches).image}`;
  if (view.scene.image !== sceneAssets(viewScenes[index], compact.matches).image && view.loadingImage !== sceneAssets(viewScenes[index], compact.matches).image) sceneLoads.delete(key);
  if ((retryAfter.get(key) || 0) > performance.now()) return Promise.resolve();
  if (!sceneLoads.has(key)) sceneLoads.set(key, view.init().catch(error => {
    sceneLoads.delete(key); retryAfter.set(key, performance.now() + 10000);
    console.warn(`Scene ${viewScenes[index].id}:`, error);
    if (index === current) announce('已显示静态画面，仍可滚动探索场景。');
  }).finally(requestRender));
  return sceneLoads.get(key);
}
function prepareConnector(index) {
  if (!connectors[index]) return Promise.resolve();
  const source = sceneAssets(scenes[index], compact.matches).connector || scenes[0].connector;
  const key = `connector:${source}`;
  if ((retryAfter.get(key) || 0) > performance.now()) return Promise.resolve();
  if (!connectorLoads.has(source)) connectorLoads.set(source, loadImage(source).catch(error => {
    connectorLoads.delete(source); retryAfter.set(key, performance.now() + 10000); console.warn('Connector:', error);
  }));
  return connectorLoads.get(source).then(image => {
    if (image && retainedIndexes.has(index) && source === sceneAssets(scenes[index], compact.matches).connector) connectors[index].style.backgroundImage = `url('${source}')`;
  });
}
function trimAssets() {
  if (retainedFrom === journey.from && retainedCompact === compact.matches) return;
  retainedFrom = journey.from; retainedCompact = compact.matches;
  retainedIndexes.clear();
  for (const index of [journey.from, journey.to, (journey.from + scenes.length - 1) % scenes.length]) retainedIndexes.add(index);
  const urls = new Set(), keys = new Set();
  views.forEach((view, index) => {
    const assets = sceneAssets(view.config, compact.matches);
    if (!retainedIndexes.has(index) || (!view.active && view.on && view.scene.image !== assets.image && view.loadingImage !== assets.image)) {
      view.unload();
      return;
    }
    keys.add(`scene:${index}:${assets.image}`);
    for (const url of [assets.image, assets.darkImage, assets.depth, assets.connector]) if (url) urls.add(url);
  });
  for (const key of sceneLoads.keys()) if (!keys.has(key)) sceneLoads.delete(key);
  for (const source of connectorLoads.keys()) if (!urls.has(source)) connectorLoads.delete(source);
  connectors.forEach((connector, index) => { if (!retainedIndexes.has(index)) connector.style.backgroundImage = ''; });
  retainImages(urls);
}
function refreshMetrics() {
  scrollSpace.style.height = `${maximumScroll + window.innerHeight}px`;
  connectors.forEach((connector, index) => { connector.style.width = `${views[index].element.clientWidth}px`; });
  metrics = views.map(view => ({ width: view.element.clientWidth, height: view.element.clientHeight, top: view.element.offsetTop }));
  layoutDirty = false;
}
function applyJourney() {
  if (window.scrollY >= maximumScroll) window.scrollTo(0, loopPosition(window.scrollY, scenes.length));
  const oldFrom = journey.from; journey = journeyAt(window.scrollY, viewScenes.length);
  if (oldFrom !== journey.from) {
    for (const key of retryAfter.keys()) if (key.startsWith(`scene:${journey.from}:`) || key.startsWith('connector:')) retryAfter.delete(key);
  }
  const from = views[journey.from], to = views[journey.to], travel = journey.camera - journey.from;
  from.light = journey.fromLight; to.light = journey.toLight;
  const a = metrics[journey.from], b = metrics[journey.to];
  const width = a.width + (b.width - a.width) * travel, height = a.height + (b.height - a.height) * travel;
  const offset = a.top + a.height / 2 + (b.top + b.height / 2 - a.top - a.height / 2) * travel - height / 2;
  stage.style.width = `${width}px`; stage.style.height = `${height}px`; track.style.transform = `translate3d(0,${-offset}px,0)`;
  const visible = index => (index === journey.from || index === journey.to) && metrics[index].top < offset + height - .5 && metrics[index].top + metrics[index].height > offset + .5;
  // Release departing owners before assigning the two retained rendering contexts.
  views.forEach((view, index) => { if (!visible(index)) view.setActive(false); });
  views.forEach((view, index) => { if (visible(index)) view.setActive(true); });
  prepareScene(journey.from);
  if (hasExplored || travel > 0) { prepareScene(journey.to); prepareConnector(journey.from); }
  trimAssets();
  const nextCurrent = Math.round(journey.camera);
  if (current !== nextCurrent) {
    current = nextCurrent; stage.setAttribute('aria-label', `${viewScenes[current].title}，滚动或上下滑动探索场景，移动鼠标或倾斜手机探索景深。`);
    views.forEach((view, index) => view.element.setAttribute('aria-hidden', index !== current));
    if (!loading) announce(`已进入${viewScenes[current].title}`);
  }
  document.body.dataset.scene = viewScenes[current].id; document.body.dataset.phase = journey.phase;
  document.body.dataset.progress = window.scrollY.toFixed(2);
}
function updateLayout() { layoutDirty = journeyDirty = true; requestRender(); }
function requestRender() {
  if (!animationFrame && !document.hidden) animationFrame = requestAnimationFrame(render);
}
function drawViews() {
  for (const index of new Set([journey.from, journey.to])) {
    const view = views[index]; view.strength = depthEnabled && !reduced.matches ? 1 : 0;
    const peak = Math.max(1.875, Math.min(4.5, metrics[index].width * .0045));
    view.blur = reduced.matches ? 0 : peak * Math.sin(Math.PI * view.light); view.draw(pointer);
  }
  document.body.dataset.tiltX = pointer.x.toFixed(3); document.body.dataset.tiltY = pointer.y.toFixed(3);
}
function render(now) {
  animationFrame = 0; if (document.hidden) return;
  const dt = Math.min(50, now - previous); previous = now;
  if (layoutDirty) { refreshMetrics(); journeyDirty = true; }
  if (journeyDirty) { journeyDirty = false; applyJourney(); }
  const canMove = depthEnabled && !reduced.matches;
  const x = canMove ? target.x : 0, y = canMove ? target.y : 0;
  const smooth = 1 - Math.exp(-dt / 140);
  pointer.x += (x - pointer.x) * smooth; pointer.y += (y - pointer.y) * smooth;
  const moving = Math.abs(x - pointer.x) + Math.abs(y - pointer.y) > .0001;
  if (!moving) { pointer.x = x; pointer.y = y; }
  drawViews();
  if (canMove && moving) requestRender();
}
window.addEventListener('scroll', () => { if (window.scrollY > 0) { hasExplored = true; dismissHint(); } journeyDirty = true; requestRender(); }, { passive: true });
window.addEventListener('wheel', event => {
  if (event.ctrlKey || !event.deltaY) return;
  dismissHint();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
  event.preventDefault(); hasExplored = true; journeyDirty = true; window.scrollTo(0, wheelJourney.advance(window.scrollY, delta, performance.now())); requestRender();
}, { passive: false });
window.addEventListener('resize', updateLayout, { passive: true });
window.addEventListener('online', () => { retryAfter.clear(); journeyDirty = true; requestRender(); });
stage.addEventListener('scene-layout', updateLayout);
stage.addEventListener('depth-updated', requestRender);
stage.addEventListener('depth-restored', requestRender);
stage.addEventListener('depth-unavailable', () => { announce('已切换静态画面，仍可滚动探索场景。'); requestRender(); });
compact.addEventListener('change', updateLayout);
reduced.addEventListener('change', () => { depthEnabled = !reduced.matches; updateHint(); requestRender(); });
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(animationFrame); animationFrame = 0; previous = performance.now();
  if (!document.hidden) requestRender();
});
stage.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' && motion.hasData) return;
  const rect = stage.getBoundingClientRect(); target.x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - .5) * 2));
  target.y = Math.max(-1, Math.min(1, -((event.clientY - rect.top) / rect.height - .5) * 2)); requestRender();
});
function centerPointer() { if (!motion.hasData) { target.x = 0; target.y = 0; requestRender(); } }
stage.addEventListener('pointerleave', centerPointer);
let touch = null;
stage.addEventListener('pointerdown', event => {
  stage.focus({ preventScroll: true }); dismissHint();
  if (event.pointerType === 'touch') touch = { x: event.clientX, y: event.clientY, time: performance.now() };
});
stage.addEventListener('pointerup', event => {
  if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) < 10 && performance.now() - touch.time < 500) motion.enable(true);
  touch = null; centerPointer();
});
stage.addEventListener('pointercancel', () => { touch = null; centerPointer(); });
stage.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest('input,textarea,select,[contenteditable]')) return;
  const key = event.key.toLowerCase();
  if (key === 'd' || key === 'm') { event.preventDefault(); dismissHint(); }
  if (key === 'd') { depthEnabled = !depthEnabled; announce(depthEnabled ? '景深已开启' : '景深已关闭'); requestRender(); }
  if (key === 'm') motion.enable(true);
});
const firstImage = views[journey.from].fallback;
firstImage.addEventListener('load', showHint, { once: true });
if (firstImage.complete && firstImage.naturalWidth > 0) showHint();
requestRender();
if (mobile) motion.enable();
prepareScene(journey.from).then(() => {
  loading = false; updateLayout();
  if (!views[journey.from].ready && !views[journey.from].depth) announce('已显示静态画面，仍可滚动探索灯光与场景。');
});
