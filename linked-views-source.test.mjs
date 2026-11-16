import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LINKED_VIEW_AXES,linkedViewFit,linkedDragDelta,linkedViewHit} from './linked-views-source.js';

const frame={width:200,height:100,spanX:20,spanY:10,zoom:1};
const start={x:50,y:50},anchor={x:.1,y:.2,z:.3};
test('front dragging follows screen axes and preserves original depth',()=>{
  const delta=linkedDragDelta('front',start,{x:70,y:40},frame,anchor);
  assert.deepEqual(delta.toArray(),[2,1,0]);
  assert.equal(anchor.z+delta.z,.3);
});
test('top and side movement match the existing camera orientation',()=>{
  assert.deepEqual(linkedDragDelta('top',start,{x:70,y:40},frame,anchor).toArray(),[2,0,-1]);
  assert.deepEqual(linkedDragDelta('side',start,{x:70,y:40},frame,anchor).toArray(),[0,1,-2]);
});
test('snapping aligns the anchor in its two editable axes without changing depth',()=>{
  assert.deepEqual(linkedDragDelta('front',start,{x:63,y:42},frame,anchor,.5).toArray(),[1.4,.8,0]);
  assert.deepEqual(linkedDragDelta('side',start,{x:63,y:42},frame,anchor,.5).toArray(),[0,.8,-1.3]);
});
test('zoomed dragging covers fewer world units and a round trip returns to zero',()=>{
  assert.deepEqual(linkedDragDelta('top',start,{x:70,y:40},{...frame,zoom:2},anchor).toArray(),[1,0,-.5]);
  assert.deepEqual(linkedDragDelta('front',start,start,frame,anchor).toArray(),[0,0,0]);
  assert.equal(linkedDragDelta('front',start,start,{...frame,width:0},anchor),null);
});
test('each camera basis is orthonormal and agrees with screen right/up',()=>{
  for(const axes of Object.values(LINKED_VIEW_AXES)){
    const right=new THREE.Vector3(...axes.right),up=new THREE.Vector3(...axes.up),normal=new THREE.Vector3(...axes.normal);
    assert.equal(right.dot(up),0);assert.equal(right.dot(normal),0);assert.equal(up.dot(normal),0);
    assert.ok(right.clone().cross(up).distanceTo(normal)<1e-12);
    const camera=new THREE.OrthographicCamera(-10,10,5,-5,.1,2000);camera.position.copy(normal).multiplyScalar(600);camera.up.copy(up);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    const screenRight=right.clone().project(camera),screenUp=up.clone().project(camera);
    assert.ok(screenRight.x>0);assert.ok(screenUp.y>0);
  }
});
test('fit includes all box corners for every view and narrow pane aspect',()=>{
  const box=new THREE.Box3(new THREE.Vector3(-15,-3,-8),new THREE.Vector3(21,14,5));
  for(const name of Object.keys(LINKED_VIEW_AXES))for(const aspect of [.4,1,3]){
    const fit=linkedViewFit(box,name,aspect),axes=LINKED_VIEW_AXES[name];
    const camera=new THREE.OrthographicCamera(-fit.height*aspect/2,fit.height*aspect/2,fit.height/2,-fit.height/2,.1,2000);camera.up.set(...axes.up);camera.position.copy(fit.centre).addScaledVector(new THREE.Vector3(...axes.normal),600);camera.lookAt(fit.centre);camera.updateMatrixWorld();
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=new THREE.Vector3(x,y,z).project(camera);assert.ok(Math.abs(p.x)<1&&Math.abs(p.y)<1);
    }
  }
});
test('instanced atom picking resolves the correct ID',()=>{
  const atom={id:28,visible:true};
  const hit=linkedViewHit([{object:{visible:true,userData:{sphereIds:[14,28]}},instanceId:1}],[atom],[]);
  assert.equal(hit.item,atom);assert.equal(hit.id,28);assert.equal(hit.kind,'atom');
});
test('a locked foreground object blocks selection through to the one behind',()=>{
  const foreground={id:1,locked:true},background={id:2};
  const hit=linkedViewHit([{object:{visible:true,userData:{id:1}}},{object:{visible:true,userData:{id:2}}}],[foreground,background],[]);
  assert.equal(hit.id,1);assert.equal(hit.locked,true);
});
test('hidden records are skipped and image locks use the same occlusion guard',()=>{
  const hidden={id:1,visible:false},image={id:'image-id',visible:true,opacity:1,locked:true};
  const hit=linkedViewHit([{object:{visible:true,userData:{id:1}}},{object:{visible:true,userData:{imageId:'image-id'}}}],[hidden],[image]);
  assert.equal(hit.item,image);assert.equal(hit.kind,'image');assert.equal(hit.locked,true);
  assert.equal(linkedViewHit([{object:{visible:true,userData:{imageId:'image-id'}}}],[],[{...image,opacity:0}]),null);
});
