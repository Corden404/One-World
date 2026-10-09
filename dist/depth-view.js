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
const imageCache=new Map();
export function loadImage(url) {
  if(imageCache.has(url))return imageCache.get(url);
  const promise=new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>{imageCache.delete(url);reject(new Error(`Unable to load ${url}`));};
    image.src=url;
  });
  imageCache.set(url,promise);return promise;
}
export class DepthView {
  constructor(element,scene) {
    this.element=element;this.scene=scene;this.config=scene;this.canvas=element.querySelector('canvas');
    this.surface=element.querySelector('.scene-surface') || element;
    this.variant=null;this.serial=0;
    this.media=matchMedia('(min-aspect-ratio: 1/1)');
    this.element.style.setProperty('--scene-aspect',this.media.matches&&scene.wide?scene.wide.aspectRatio:scene.aspectRatio);
    this.onMediaChange=()=>{if(this.config.wide&&this.on)this.init().catch(error=>console.warn('Could not change scene format',error));};
    this.media.addEventListener('change',this.onMediaChange);
    this.light=1;this.strength=1;this.blur=0;this.ready=false;this.active=false;
    this.gl=null;
    this.bindCanvas();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(element);
  }
  bindCanvas() {
    this.canvas.addEventListener('webglcontextlost',event=>{
      if(event.target!==this.canvas)return;
      event.preventDefault();this.ready=false;this.element.classList.remove('ready');
      this.element.dispatchEvent(new CustomEvent('depth-unavailable',{bubbles:true}));
    });
    this.canvas.addEventListener('webglcontextrestored',event=>{
      if(event.target!==this.canvas||!this.active)return;
      try {this.setup();this.element.dispatchEvent(new CustomEvent('depth-restored',{bubbles:true}));}
      catch(error){console.warn('Could not restore depth view',error);}
    });
  }
  async init() {
    const version=++this.serial;
    const variant=this.media.matches&&this.config.wide?'wide':'portrait';
    const scene=variant==='wide'?{...this.config,...this.config.wide}:this.config;
    const results=await Promise.allSettled([loadImage(scene.image),scene.darkImage?loadImage(scene.darkImage):Promise.resolve(null),loadImage(scene.depth)]);
    if(version!==this.serial)return this.ready;
    if(results[0].status==='rejected')throw results[0].reason;
    this.releaseResources();this.ready=false;this.element.classList.remove('ready');
    this.scene=scene;this.variant=variant;
    this.on=results[0].value;this.off=results[1].status==='fulfilled'?results[1].value:null;
    this.depth=results[2].status==='fulfilled'?results[2].value:null;
    this.element.style.setProperty('--scene-aspect',this.on.width/this.on.height);
    this.element.dispatchEvent(new CustomEvent('scene-layout',{bubbles:true}));
    this.element.querySelector('.scene-fallback').src=scene.image;
    this.element.querySelector('.scene-frame').src=scene.image;
    this.element.querySelector('.fallback-off')?.remove();
    if(this.off){const image=this.off.cloneNode();image.alt='';image.className='fallback-off';this.canvas.parentNode.insertBefore(image,this.canvas);}
    if(results[2].status==='rejected')return false;
    if(this.active)this.activate();
    return true;
  }
  activate() {
    if(this.ready||!this.on||!this.depth)return;
    this.gl=this.canvas.getContext('webgl',{alpha:false,antialias:true,powerPreference:'low-power'});
    if(this.gl){
      try{this.setup();}
      catch(error){this.ready=false;this.releaseResources();console.warn('Could not enable depth view',error);this.element.dispatchEvent(new CustomEvent('depth-unavailable',{bubbles:true}));}
    }
  }
  setActive(active) {
    if(this.active===active)return;
    this.active=active;
    if(active){this.activate();return;}
    if(!this.gl)return;
    // Keep decoded assets cached, but only the visible pair holds GPU contexts.
    this.ready=false;this.element.classList.remove('ready');this.releaseResources();
    const oldCanvas=this.canvas;
    this.canvas=oldCanvas.cloneNode();oldCanvas.replaceWith(this.canvas);this.bindCanvas();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();this.gl=null;
  }
  setup() {
    const gl=this.gl;
    const compile=(source,type)=>{
      const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;
    };
    this.program=gl.createProgram();
    const vs=compile(vertexShader,gl.VERTEX_SHADER),fs=compile(fragmentShader,gl.FRAGMENT_SHADER);
    gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(this.program);
    this.uniforms=Object.fromEntries(['uPointer','uStrength','uOn','uOff','uLight','uHasOff','uNightColor','uOffUvScale'].map(name=>[name,gl.getUniformLocation(this.program,name)]));
    const depthCanvas=document.createElement('canvas');depthCanvas.width=this.depth.width;depthCanvas.height=this.depth.height;
    const context=depthCanvas.getContext('2d',{willReadFrequently:true});context.drawImage(this.depth,0,0);
    const {data}=context.getImageData(0,0,depthCanvas.width,depthCanvas.height);
    const columns=160,rows=240,vertices=[],indices=[];
    for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
      const u=x/columns,v=y/rows;
      const dx=Math.min(this.depth.width-1,Math.round(u*(this.depth.width-1))),dy=Math.min(this.depth.height-1,Math.round(v*(this.depth.height-1)));
      vertices.push(u*2-1,1-v*2,u,v,data[(dy*this.depth.width+dx)*4]/255);
    }
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const i=y*(columns+1)+x;indices.push(i,i+1,i+columns+1,i+1,i+columns+2,i+columns+1);
    }
    this.vertexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    for(const [name,count,offset]of[['aPosition',2,0],['aUv',2,8],['aDepth',1,16]]){
      const location=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,count,gl.FLOAT,false,20,offset);
    }
    this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);this.indexCount=indices.length;
    const texture=(image,unit)=>{
      const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);return t;
    };
    this.textures=[texture(this.on,0),texture(this.off||this.on,1)];gl.uniform1i(this.uniforms.uOn,0);gl.uniform1i(this.uniforms.uOff,1);
    gl.uniform1f(this.uniforms.uHasOff,this.off?1:0);gl.uniform3fv(this.uniforms.uNightColor,this.scene.nightColor);
    const onAspect=this.on.width/this.on.height,offAspect=this.off?this.off.width/this.off.height:onAspect;
    gl.uniform2f(this.uniforms.uOffUvScale,Math.max(1,onAspect/offAspect),Math.max(1,offAspect/onAspect));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);this.ready=true;this.resize();this.draw({x:0,y:0});this.element.classList.add('ready');
  }
  resize() {
    if(!this.gl)return;
    const ratio=Math.min(devicePixelRatio||1,1.5),w=Math.round(this.element.clientWidth*ratio),h=Math.round(this.element.clientHeight*ratio);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.gl.viewport(0,0,w,h);
  }
  draw(pointer) {
    this.element.style.setProperty('--light',this.light);
    this.surface.style.filter=this.blur>.01?`blur(${this.blur.toFixed(2)}px)`:'none';
    this.element.querySelector('.scene-frame').style.filter=`brightness(${.6+this.light*.4})`;
    if(!this.ready){this.element.querySelector('.scene-fallback').style.filter=this.off?'none':`brightness(${.23+this.light*.77})`;return;}
    const gl=this.gl;gl.useProgram(this.program);gl.uniform2f(this.uniforms.uPointer,pointer.x,pointer.y);gl.uniform1f(this.uniforms.uStrength,this.strength);gl.uniform1f(this.uniforms.uLight,this.light);
    gl.clearColor(.06,.08,.06,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
  }
  releaseResources(){if(!this.gl)return;this.textures?.forEach(t=>this.gl.deleteTexture(t));if(this.vertexBuffer)this.gl.deleteBuffer(this.vertexBuffer);if(this.indexBuffer)this.gl.deleteBuffer(this.indexBuffer);if(this.program)this.gl.deleteProgram(this.program);this.textures=null;this.vertexBuffer=null;this.indexBuffer=null;this.program=null;}
  destroy(){this.observer.disconnect();this.media.removeEventListener('change',this.onMediaChange);this.releaseResources();}
}
