import { scenes } from './scenes.js';
import { DepthView, loadImage } from './depth-view.js';
import { journeyAt, loopPosition, LEG_DISTANCE } from './journey.js';
import { MotionInput } from './motion.js';

const stage=document.querySelector('#world-window'),track=document.querySelector('#world-track');
const status=document.querySelector('#live-status'),scrollSpace=document.querySelector('#scroll-space');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const viewScenes=[...scenes,scenes[0]];
const maximumScroll=scenes.length*LEG_DISTANCE;
const target={x:0,y:0},pointer={x:0,y:0},views=[],connectors=[];
const sceneLoads=new Map(),connectorLoads=new Map();
let loading=true,depthEnabled=!reduced.matches,lastInput=0,current=-1;
let journey=journeyAt(window.scrollY,viewScenes.length);
const announce=text=>{status.textContent=text;};
const motion=new MotionInput(position=>{Object.assign(target,position);lastInput=performance.now();},state=>{
  document.body.dataset.motion=state;
  if(state==='denied')announce('倾斜感应未获授权，仍可滑动探索场景。');
});
const mobile=matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
track.replaceChildren();
viewScenes.forEach((scene,index)=>{
  const element=document.createElement('div');element.className='world-scene';element.id=`${scene.id}${index===scenes.length?'-return':''}-scene`;
  const surface=document.createElement('div');surface.className='scene-surface';
  const image=new Image();image.loading=index===0?'eager':'lazy';image.decoding='async';image.fetchPriority=index===0?'high':'low';
  image.src=scene.image;image.alt=scene.description;image.className='scene-fallback';
  const canvas=document.createElement('canvas');canvas.className='scene-canvas';canvas.setAttribute('aria-hidden','true');
  const frame=image.cloneNode();frame.alt='';frame.className='scene-frame';frame.setAttribute('aria-hidden','true');
  surface.append(image,canvas);element.append(surface,frame);track.append(element);views.push(new DepthView(element,scene));
  if(index<scenes.length){
    const connector=document.createElement('div');connector.className='connector';connector.setAttribute('aria-hidden','true');
    track.append(connector);connectors.push(connector);
  }
});
function prepareScene(index){
  if(!views[index])return Promise.resolve();
  if(!sceneLoads.has(index))sceneLoads.set(index,views[index].init().catch(error=>{
    console.warn(`Scene ${viewScenes[index].id}:`,error);
    if(index===current)announce('已显示静态画面，仍可滚动探索场景。');
  }));
  return sceneLoads.get(index);
}
function prepareConnector(index){
  if(!connectors[index])return Promise.resolve();
  if(!connectorLoads.has(index)){
    const source=scenes[index].connector||scenes[0].connector;
    connectors[index].style.backgroundImage=`url('${source}')`;
    connectorLoads.set(index,loadImage(source).catch(error=>console.warn('Connector:',error)));
  }
  return connectorLoads.get(index);
}
function applyJourney(){
  // The return copy matches scene zero exactly before the track is rebased.
  if(window.scrollY>=maximumScroll)window.scrollTo(0,loopPosition(window.scrollY,scenes.length));
  journey=journeyAt(window.scrollY,viewScenes.length);
  const from=views[journey.from],to=views[journey.to],travel=journey.camera-journey.from;
  from.light=journey.fromLight;to.light=journey.toLight;
  views.forEach((view,index)=>view.setActive(index===journey.from||index===journey.to));
  prepareScene(journey.from);prepareScene(journey.to);prepareConnector(journey.from);
  if(!loading){prepareScene(journey.to+1);prepareConnector(journey.to);}
  const width=from.element.clientWidth+(to.element.clientWidth-from.element.clientWidth)*travel;
  const height=from.element.clientHeight+(to.element.clientHeight-from.element.clientHeight)*travel;
  stage.style.width=`${width}px`;stage.style.height=`${height}px`;
  const fromCenter=from.element.offsetTop+from.element.clientHeight/2;
  const toCenter=to.element.offsetTop+to.element.clientHeight/2;
  const offset=fromCenter+(toCenter-fromCenter)*travel-height/2;
  track.style.transform=`translate3d(0,${-offset}px,0)`;
  const nextCurrent=Math.round(journey.camera);
  if(current!==nextCurrent){
    current=nextCurrent;stage.setAttribute('aria-label',`${viewScenes[current].title}，滚动或上下滑动探索场景，移动鼠标或倾斜手机探索景深。`);
    views.forEach((view,index)=>view.element.setAttribute('aria-hidden',index!==current));
    if(!loading)announce(`已进入${viewScenes[current].title}`);
  }
  document.body.dataset.scene=viewScenes[current].id;
  document.body.dataset.phase=journey.phase;
  document.body.dataset.progress=Math.max(0,Math.min(maximumScroll,window.scrollY)).toFixed(2);
  drawViews();
}
function updateLayout(){
  scrollSpace.style.height=`${maximumScroll+window.innerHeight}px`;
  connectors.forEach((connector,index)=>{connector.style.width=`${views[index].element.clientWidth}px`;});
  applyJourney();
}
window.addEventListener('scroll',applyJourney,{passive:true});
window.addEventListener('wheel',event=>{
  if(event.ctrlKey||!event.deltaY)return;
  const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1);
  event.preventDefault();
  window.scrollTo(0,loopPosition(window.scrollY+delta,scenes.length));
  applyJourney();
},{passive:false});
window.addEventListener('resize',updateLayout,{passive:true});
stage.addEventListener('scene-layout',updateLayout);
updateLayout();

stage.addEventListener('pointermove',event=>{
  if(event.pointerType==='touch'&&motion.hasData)return;
  const rect=stage.getBoundingClientRect();target.x=Math.max(-1,Math.min(1,((event.clientX-rect.left)/rect.width-.5)*2));
  target.y=Math.max(-1,Math.min(1,-((event.clientY-rect.top)/rect.height-.5)*2));lastInput=performance.now();
});
stage.addEventListener('pointerleave',()=>{if(!motion.hasData){target.x=0;target.y=0;}});
let touch=null;
stage.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')touch={x:event.clientX,y:event.clientY,time:performance.now()};});
stage.addEventListener('pointerup',event=>{
  if(touch&&Math.hypot(event.clientX-touch.x,event.clientY-touch.y)<10&&performance.now()-touch.time<500)motion.enable(true);
  touch=null;if(!motion.hasData){target.x=0;target.y=0;}
});
stage.addEventListener('pointercancel',()=>{touch=null;if(!motion.hasData){target.x=0;target.y=0;}});
document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  if(event.key.toLowerCase()==='d'){depthEnabled=!depthEnabled;announce(depthEnabled?'景深已开启':'景深已关闭');}
  if(event.key.toLowerCase()==='m')motion.enable(true);
});
stage.addEventListener('depth-unavailable',()=>announce('已切换静态画面，仍可滚动探索场景。'));
reduced.addEventListener('change',()=>{depthEnabled=!reduced.matches;});
if(mobile)motion.enable();
function drawViews(){
  views.forEach((view,index)=>{
    if(index!==journey.from&&index!==journey.to)return;
    view.strength=depthEnabled&&!reduced.matches?1:0;
    const peak=Math.max(1.875,Math.min(4.5,view.element.clientWidth*.0045));
    view.blur=reduced.matches?0:peak*Math.sin(Math.PI*view.light);
    view.draw(pointer);
  });
  document.body.dataset.tiltX=pointer.x.toFixed(3);
  document.body.dataset.tiltY=pointer.y.toFixed(3);
}
let previous=performance.now();
function render(now){
  const dt=Math.min(50,now-previous);previous=now;
  if(!document.hidden){
    const smooth=1-Math.exp(-dt/140),idle=!loading&&journey.phase==='day'&&depthEnabled&&!reduced.matches&&!motion.hasData&&now-lastInput>4500;
    const x=idle?Math.sin(now*.00023)*.13:target.x,y=idle?Math.cos(now*.00019)*.10:target.y;
    pointer.x+=(x-pointer.x)*smooth;pointer.y+=(y-pointer.y)*smooth;
    drawViews();
  }
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
async function init(){
  await Promise.all([prepareScene(journey.from),prepareScene(journey.to),prepareConnector(journey.from)]);
  loading=false;updateLayout();
  if(!views[current].ready)announce('已显示静态画面，仍可滚动探索灯光与场景。');
}
init().catch(error=>{console.error(error);loading=false;updateLayout();announce('部分场景资源未能加载，请刷新后重试。');});
