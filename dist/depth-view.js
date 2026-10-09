import { COMPACT_MEDIA, sceneAssets } from './assets.js';
import { buildDepthMesh, meshResolution } from './geometry.js';
/** Depth-displaced mesh with fixed frame edges, adapted from Tiefling (MIT).
 * https://github.com/combatwombat/tiefling
 * The two light textures use exactly the same vertices and UVs.
 */
const vertexShader = `
attribute vec2 aPosition;
attribute vec2 aUv;
attribute float aDepth;
uniform vec2 uPointer;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vUv = aUv;
  vec2 edge = smoothstep(vec2(.07),vec2(.14),aUv) *
              (1.0-smoothstep(vec2(.86),vec2(.93),aUv));
  float pinned = edge.x * edge.y;
  vec2 shift = uPointer * (aDepth - .35) * .045 * pinned * uStrength;
  gl_Position = vec4(aPosition + shift, (1.0-aDepth)*.4, 1.0);
}`;
const fragmentShader = `
precision mediump float;
uniform sampler2D uOn;
uniform sampler2D uOff;
uniform float uLight;
uniform float uHasOff;
uniform vec3 uNightColor;
uniform vec2 uOffUvScale;
varying vec2 vUv;
void main() {
  vec3 lit = texture2D(uOn,vUv).rgb;
  vec2 offUv = (vUv - .5) * uOffUvScale + .5;
  float inside = step(0.0,offUv.x)*step(offUv.x,1.0)*step(0.0,offUv.y)*step(offUv.y,1.0);
  vec3 unlit = mix(lit*uNightColor,texture2D(uOff,offUv).rgb*inside,uHasOff);
  vec3 linearColor = mix(pow(unlit,vec3(2.2)),pow(lit,vec3(2.2)),uLight);
  gl_FragColor = vec4(pow(linearColor,vec3(1.0/2.2)),1.0);
}`;
const imageCache = new Map(), meshCache = new WeakMap(), slots = [];
const compactMedia = matchMedia(COMPACT_MEDIA);
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export function loadImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const attempt = () => new Promise((resolve, reject) => {
    const image = new Image(); image.decoding = 'async';
    const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error(`Image timed out: ${url}`)); }, 10000);
    image.onload = async () => { clearTimeout(timer); await image.decode().catch(() => {}); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(new Error(`Unable to load ${url}`)); };
    image.src = url;
  });
  const promise = (async () => {
    for (let index = 0; ; index++) {
      try { return await attempt(); }
      catch (error) { if (index === 2) throw error; await wait(index === 0 ? 200 : 600); }
    }
  })().catch(error => { imageCache.delete(url); throw error; });
  imageCache.set(url, promise);
  return promise;
}
function geometry(image, width) {
  const { columns, rows } = meshResolution(width), key = `${columns}:${rows}`;
  let cache = meshCache.get(image);
  if (!cache) { cache = new Map(); meshCache.set(image, cache); }
  if (!cache.has(key)) {
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    cache.set(key, buildDepthMesh(context.getImageData(0, 0, image.width, image.height), columns, rows));
  }
  return cache.get(key);
}
function buildProgram(slot) {
  const gl = slot.gl;
  const compile = (source, type) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message); }
    return shader;
  };
  const vs = compile(vertexShader, gl.VERTEX_SHADER), fs = compile(fragmentShader, gl.FRAGMENT_SHADER);
  slot.program = gl.createProgram(); gl.attachShader(slot.program, vs); gl.attachShader(slot.program, fs); gl.linkProgram(slot.program);
  gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(slot.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(slot.program));
  slot.uniforms = Object.fromEntries(['uPointer', 'uStrength', 'uOn', 'uOff', 'uLight', 'uHasOff', 'uNightColor', 'uOffUvScale'].map(name => [name, gl.getUniformLocation(slot.program, name)]));
  slot.vertexBuffer = gl.createBuffer(); slot.indexBuffer = gl.createBuffer(); slot.mesh = null;
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
}
function createSlot(template) {
  const canvas = template.cloneNode(), gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const slot = { canvas, gl, owner: null, lost: false, textures: new Map() };
  try { buildProgram(slot); }
  catch (error) { gl.getExtension('WEBGL_lose_context')?.loseContext(); throw error; }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); slot.lost = true; slot.textures.clear(); slot.mesh = null;
    if (slot.owner) { slot.owner.ready = false; slot.owner.element.classList.remove('ready'); slot.owner.notify('depth-unavailable'); }
  });
  canvas.addEventListener('webglcontextrestored', () => {
    slot.lost = false;
    try { buildProgram(slot); if (slot.owner) { slot.owner.setup(); slot.owner.notify('depth-restored'); } }
    catch (error) { slot.lost = true; console.warn('Could not restore depth view', error); }
  });
  slots.push(slot); return slot;
}
function texturePair(slot, on, off) {
  const gl = slot.gl;
  if (slot.textures.has(on)) { const pair = slot.textures.get(on); if (pair.off === off) { slot.textures.delete(on); slot.textures.set(on, pair); return pair.values; } pair.values.forEach(texture => gl.deleteTexture(texture)); slot.textures.delete(on); }
  const values = [on, off || on].map((image, unit) => {
    const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image); return texture;
  });
  slot.textures.set(on, { off, values });
  while (slot.textures.size > 2) { const [key, pair] = slot.textures.entries().next().value; pair.values.forEach(texture => gl.deleteTexture(texture)); slot.textures.delete(key); }
  return values;
}
export class DepthView {
  constructor(element, scene) {
    this.element = element; this.config = this.scene = scene; this.canvas = element.querySelector('canvas');
    this.surface = element.querySelector('.scene-surface'); this.fallback = element.querySelector('.scene-fallback'); this.frame = element.querySelector('.scene-frame');
    this.light = 1; this.strength = 1; this.blur = 0; this.ready = this.active = this.complete = false; this.serial = 0; this.slot = null;
    this.element.style.setProperty('--scene-aspect', scene.aspectRatio);
    this.onMediaChange = () => { if (this.active && this.on) this.init().catch(error => { console.warn('Could not change scene format', error); this.notify('depth-unavailable'); }); };
    compactMedia.addEventListener('change', this.onMediaChange);
    this.observer = new ResizeObserver(() => { if (this.resize()) this.notify('depth-updated'); }); this.observer.observe(element);
  }
  notify(name) { this.element.dispatchEvent(new CustomEvent(name, { bubbles: true })); }
  async init() {
    const version = ++this.serial, scene = sceneAssets(this.config, compactMedia.matches); this.loadingImage = scene.image;
    const results = await Promise.allSettled([loadImage(scene.image), scene.darkImage ? loadImage(scene.darkImage) : Promise.resolve(null), loadImage(scene.depth)]);
    if (version !== this.serial) return this.complete;
    this.loadingImage = null;
    if (results[0].status === 'rejected') throw results[0].reason;
    this.scene = scene; this.on = results[0].value; this.off = results[1].status === 'fulfilled' ? results[1].value : null;
    this.depth = results[2].status === 'fulfilled' ? results[2].value : null; this.complete = results.every(result => result.status === 'fulfilled');
    this.fallback.src = this.frame.src = scene.image;
    let offImage = this.surface.querySelector('.fallback-off');
    if (this.off) { if (!offImage) { offImage = new Image(); offImage.alt = ''; offImage.className = 'fallback-off'; this.surface.insertBefore(offImage, this.canvas); } offImage.src = scene.darkImage; }
    else offImage?.remove();
    this.lastDraw = null; this.styleLight = null;
    if (this.active) { if (this.depth) { if (this.slot) this.setup(); else this.activate(); } else this.release(); }
    this.notify('scene-layout'); this.notify('depth-updated');
    if (!this.complete) throw results.find(result => result.status === 'rejected').reason;
    return true;
  }
  activate() {
    if (this.ready || !this.on || !this.depth) return;
    try {
      const free = slots.filter(slot => !slot.owner && !slot.lost);
      this.slot = free.find(slot => slot.textures.has(this.on)) || free[0] || (slots.length < 2 ? createSlot(this.canvas) : null);
      if (!this.slot) { this.notify('depth-unavailable'); return; }
      this.slot.owner = this; this.canvas.replaceWith(this.slot.canvas); this.canvas = this.slot.canvas; this.setup(); this.notify('depth-updated');
    } catch (error) { this.release(); console.warn('Could not enable depth view', error); this.notify('depth-unavailable'); }
  }
  setActive(active) {
    if (this.active === active) return;
    this.active = active; if (active) this.activate(); else this.release();
  }
  release() {
    this.ready = false; this.lastDraw = null; this.element.classList.remove('ready');
    if (!this.slot) return;
    const placeholder = this.canvas.cloneNode(); this.canvas.replaceWith(placeholder); this.slot.owner = null; this.slot = null; this.canvas = placeholder;
  }
  setup() {
    const slot = this.slot; if (!slot || slot.lost) return;
    const gl = slot.gl, mesh = geometry(this.depth, this.element.clientWidth);
    gl.useProgram(slot.program);
    if (slot.mesh !== mesh) {
      gl.bindBuffer(gl.ARRAY_BUFFER, slot.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, slot.indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW); slot.mesh = mesh;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, slot.vertexBuffer); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, slot.indexBuffer);
    for (const [name, count, offset] of [['aPosition', 2, 0], ['aUv', 2, 8], ['aDepth', 1, 16]]) {
      const location = gl.getAttribLocation(slot.program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, count, gl.FLOAT, false, 20, offset);
    }
    texturePair(slot, this.on, this.off).forEach((texture, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); });
    const u = slot.uniforms; gl.uniform1i(u.uOn, 0); gl.uniform1i(u.uOff, 1); gl.uniform1f(u.uHasOff, this.off ? 1 : 0); gl.uniform3fv(u.uNightColor, this.scene.nightColor);
    const onAspect = this.on.width / this.on.height, offAspect = this.off ? this.off.width / this.off.height : onAspect;
    gl.uniform2f(u.uOffUvScale, Math.max(1, onAspect / offAspect), Math.max(1, offAspect / onAspect));
    this.indexCount = mesh.indices.length; this.ready = true; this.lastDraw = null; this.resize(); this.element.classList.add('ready');
  }
  resize() {
    if (!this.slot || this.slot.lost) return false;
    const ratio = Math.min(devicePixelRatio || 1, 1.5), width = Math.round(this.element.clientWidth * ratio), height = Math.round(this.element.clientHeight * ratio);
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width; this.canvas.height = height; this.slot.gl.viewport(0, 0, width, height); this.lastDraw = null;
    const mesh = this.depth && geometry(this.depth, this.element.clientWidth);
    if (mesh && this.slot.mesh !== mesh) this.setup();
    return true;
  }
  draw(pointer) {
    const blur = this.blur > .01 ? `blur(${this.blur.toFixed(2)}px)` : 'none';
    if (this.styleLight !== this.light) { this.element.style.setProperty('--light', this.light); this.frame.style.filter = `brightness(${.6 + this.light * .4})`; this.fallback.style.filter = this.off ? 'none' : `brightness(${.23 + this.light * .77})`; this.styleLight = this.light; }
    if (this.surface.style.filter !== blur) this.surface.style.filter = blur;
    if (!this.ready || !this.active || this.slot.lost) return;
    const x = this.strength ? pointer.x : 0, y = this.strength ? pointer.y : 0;
    const key = `${x}:${y}:${this.strength}:${this.light}`; if (this.lastDraw === key) return;
    this.lastDraw = key;
    const gl = this.slot.gl, u = this.slot.uniforms; gl.useProgram(this.slot.program); gl.uniform2f(u.uPointer, x, y); gl.uniform1f(u.uStrength, this.strength); gl.uniform1f(u.uLight, this.light);
    gl.clearColor(.06, .08, .06, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  destroy() { this.release(); this.observer.disconnect(); compactMedia.removeEventListener('change', this.onMediaChange); }
}
