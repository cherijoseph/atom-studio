import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createImageResizeHandles,projectImageResizeHandles,IMAGE_RESIZE_HANDLES} from './image-resize-handles-source.js';

const plane=(extra={})=>({x:0,y:0,z:0,width:4,height:2,rotation:[0,0,0],visible:true,opacity:1,...extra});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} differs from ${expected}`);
function ortho(){const camera=new THREE.OrthographicCamera(-10,10,5,-5,.1,100);camera.position.z=10;camera.lookAt(0,0,0);return camera;}
const point=(points,key)=>points.find(point=>point.key===key);

test('all eight handles follow exact plane corners and edge midpoints in CSS pixels',()=>{
  const camera=ortho(),points=projectImageResizeHandles(camera,plane(),400,200);
  assert.equal(points.length,8);assert.deepEqual(points.map(({x,y})=>[x,y]),[[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1],[-1,0]]);
  for(const [key,left,top]of [['nw',160,80],['n',200,80],['ne',240,80],['e',240,100],['se',240,120],['s',200,120],['sw',160,120],['w',160,100]]){
    near(point(points,key).left,left);near(point(points,key).top,top);assert.equal(point(points,key).visible,true);
  }
  assert.equal(point(points,'e').cursor,'ew-resize');assert.equal(point(points,'n').cursor,'ns-resize');assert.equal(point(points,'nw').cursor,'nwse-resize');assert.equal(point(points,'ne').cursor,'nesw-resize');
  const doubled=projectImageResizeHandles(camera,plane(),800,400);near(point(doubled,'nw').left,320);near(point(doubled,'nw').top,160);
});

test('XYZ rotations and camera pose keep overlay aligned, including views of the back face',()=>{
  const camera=ortho(),turned=projectImageResizeHandles(camera,plane({rotation:[0,0,90]}),400,200);
  near(point(turned,'nw').left,180);near(point(turned,'nw').top,140);assert.equal(point(turned,'e').cursor,'ns-resize');
  const back=projectImageResizeHandles(camera,plane({rotation:[0,180,0]}),400,200);
  near(point(back,'e').left,160);assert.equal(back.every(point=>point.visible),true);
  const image=plane({x:1,y:2,z:3,rotation:[35,25,20]}),expected=new THREE.Vector3(-2,1,0).applyEuler(new THREE.Euler(...image.rotation.map(THREE.MathUtils.degToRad),'XYZ')).add(new THREE.Vector3(1,2,3)).project(camera);
  const points=projectImageResizeHandles(camera,image,400,200);near(point(points,'nw').left,(expected.x+1)*200);near(point(points,'nw').top,(1-expected.y)*100);
});

test('perspective projection and zoom use the active camera matrices',()=>{
  const camera=new THREE.PerspectiveCamera(90,2,.1,100);camera.position.z=10;camera.lookAt(0,0,0);
  const points=projectImageResizeHandles(camera,plane(),400,200);near(point(points,'nw').left,180);near(point(points,'nw').top,90);
  camera.zoom=2;camera.updateProjectionMatrix();const zoomed=projectImageResizeHandles(camera,plane(),400,200);near(point(zoomed,'nw').left,160);near(point(zoomed,'nw').top,80);
});

test('unusable views hide handles instead of leaving misleading controls',()=>{
  const camera=ortho();
  for(const image of [null,plane({visible:false}),plane({opacity:0}),plane({width:NaN}),plane({rotation:[0,90,0]}),plane({rotation:[0,87,0]}),plane({width:.1,height:.1}),plane({z:11}),plane({z:-100}),plane({z:9.5,rotation:[0,60,0]})])assert.equal(projectImageResizeHandles(camera,image,400,200),null);
  assert.equal(projectImageResizeHandles(camera,plane(),0,200),null);
});

test('individual handles outside the viewport are hidden without clamping their positions',()=>{
  const points=projectImageResizeHandles(ortho(),plane({x:9}),400,200);
  assert.equal(point(points,'w').visible,true);near(point(points,'w').left,340);
  assert.equal(point(points,'e').visible,false);near(point(points,'e').left,420);
  assert.equal(point(points,'ne').visible,false);
});

function fakeViewport(){
  const document={createElement(){
    const classes=new Set(),node={children:[],dataset:{},style:{},attributes:{},listeners:{},hidden:false,classList:{toggle(name,on){on?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}},setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,callback,capture){this.listeners[name]={callback,capture};},append(child){this.children.push(child);child.parent=this;},remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}};
    return node;
  }};
  const viewport=document.createElement('div');viewport.ownerDocument=document;viewport.clientWidth=400;viewport.clientHeight=200;return viewport;
}

test('overlay reuses nodes, delegates correct handles, highlights active drag and respects editing visibility',()=>{
  const viewport=fakeViewport(),events=[],manager=createImageResizeHandles({viewport,onPointerDown:(event,handle)=>events.push({event,handle})});
  const overlay=viewport.children[0],buttons=[...overlay.children],camera=ortho();assert.equal(overlay.hidden,true);assert.equal(buttons.length,8);
  for(let index=0;index<buttons.length;index++){
    assert.equal(buttons[index].dataset.imageResize,IMAGE_RESIZE_HANDLES[index].key);assert.equal(buttons[index].tabIndex,-1);assert.match(buttons[index].attributes['aria-label'],/^Resize image /);assert.match(buttons[index].title,/Shift/);assert.equal(buttons[index].listeners.pointerdown.capture,true);
  }
  const event={pointerId:17};buttons[0].listeners.pointerdown.callback(event);assert.equal(events.length,0);
  manager.update(camera,plane(),true,{x:-1,y:1});assert.equal(overlay.hidden,false);assert.equal(buttons[0].classList.contains('is-active'),true);assert.equal(buttons[0].style.left,'160px');assert.equal(buttons[0].style.top,'80px');
  buttons[0].listeners.pointerdown.callback(event);assert.equal(events[0].event,event);assert.equal(events[0].handle,IMAGE_RESIZE_HANDLES[0]);
  manager.update(camera,plane({x:9}),true,'e');assert.deepEqual(overlay.children,buttons);assert.equal(buttons[3].hidden,true);buttons[3].listeners.pointerdown.callback(event);assert.equal(events.length,1);
  manager.update(camera,plane(),false);assert.equal(overlay.hidden,true);
  manager.update(camera,plane(),true);manager.hide();assert.equal(overlay.hidden,true);
  manager.update(camera,plane({x:30}),true);assert.equal(overlay.hidden,true);
  manager.dispose();manager.dispose();assert.equal(viewport.children.length,0);manager.update(camera,plane(),true);buttons[0].listeners.pointerdown.callback(event);assert.equal(events.length,1);
});
