import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSphereBatches,pickedObjectId} from './sphere-batches-source.js';

const atom=(id,x,y=0,z=0,extra={})=>({id,x,y,z,r:.25,color:'#ef4444',surface:'smooth',shininess:70,...extra});
function fixture(){
  const group=new THREE.Group(),outlines=new THREE.Group(),geometry=new THREE.SphereGeometry(1,28,22),outlineMaterial=new THREE.MeshBasicMaterial({side:THREE.BackSide});
  const created=[];
  const spheres=createSphereBatches({group,outlines,geometry,outlineMaterial,styleKey:a=>JSON.stringify([a.color,a.surface,a.shininess]),materialFor:a=>{const material=new THREE.MeshPhongMaterial({color:a.color,shininess:a.shininess});created.push(material);return material;}});
  return {group,outlines,geometry,outlineMaterial,created,spheres};
}
function pose(mesh,index){const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();mesh.getMatrixAt(index,matrix);matrix.decompose(position,rotation,scale);return {position:position.toArray(),scale:scale.toArray()};}

test('shared appearances batch together while each visible sphere keeps its ID and pose',()=>{
  const f=fixture(),items=[atom(1,-2),atom(2,4,1,2,{r:.5}),atom(3,8,0,0,{shininess:0}),atom(4,100,0,0,{visible:false})];
  f.spheres.build(items,new Set([2,4]));
  assert.equal(f.group.children.length,2);assert.equal(f.created.length,2);
  assert.deepEqual(f.group.children[0].userData.sphereIds,[1,2]);assert.equal(f.group.children[0].count,2);
  assert.deepEqual(pose(f.group.children[0],1),{position:[4,1,2],scale:[.5,.5,.5]});
  assert.equal(f.outlines.children.length,1);assert.equal(f.outlines.children[0].count,1);
  assert.ok(Math.abs(pose(f.outlines.children[0],0).scale[0]-(.5*1.08+.012))<1e-6);
  assert.equal(items[1].r,.5);f.spheres.clear();
});

test('ray hits identify the independent sphere rather than its batch origin',()=>{
  const f=fixture();f.spheres.build([atom(10,-3),atom(20,4)]);f.group.updateMatrixWorld(true);
  const hits=new THREE.Raycaster(new THREE.Vector3(4,0,5),new THREE.Vector3(0,0,-1)).intersectObjects(f.group.children,false);
  assert.ok(hits.length);assert.equal(hits[0].instanceId,1);assert.equal(pickedObjectId(hits[0]),20);
  assert.equal(pickedObjectId({object:{userData:{id:99}}}),99);f.spheres.clear();
});

test('drag updates sphere and selection outline matrices and refreshes raycasting bounds',()=>{
  const f=fixture(),first=atom(1,0),second=atom(2,2);f.spheres.build([first,second],new Set([1]));
  first.x=40;first.y=3;first.z=-2;f.spheres.move([first]);f.group.updateMatrixWorld(true);
  assert.deepEqual(pose(f.group.children[0],0).position,[40,3,-2]);assert.deepEqual(pose(f.group.children[0],1).position,[2,0,0]);
  assert.deepEqual(pose(f.outlines.children[0],0).position,[40,3,-2]);
  assert.ok(f.group.children[0].boundingSphere.containsPoint(new THREE.Vector3(40.25,3,-2)));
  const hits=new THREE.Raycaster(new THREE.Vector3(40,3,10),new THREE.Vector3(0,0,-1)).intersectObjects(f.group.children,false);
  assert.ok(hits.length);assert.equal(pickedObjectId(hits[0]),1);f.spheres.clear();
});

test('rebuild and clear dispose owned instance resources without disposing shared geometry or outline material',()=>{
  const f=fixture();let geometryDisposed=0,outlineMaterialDisposed=0,materialDisposed=0,instanceDisposed=0,outlineDisposed=0;
  f.geometry.addEventListener('dispose',()=>geometryDisposed++);f.outlineMaterial.addEventListener('dispose',()=>outlineMaterialDisposed++);
  f.spheres.build([atom(1,0)],new Set([1]));f.created[0].addEventListener('dispose',()=>materialDisposed++);
  f.group.children[0].addEventListener('dispose',()=>instanceDisposed++);f.outlines.children[0].addEventListener('dispose',()=>outlineDisposed++);
  f.spheres.build([atom(2,4)],new Set([2]));
  assert.equal(materialDisposed,1);assert.equal(instanceDisposed,1);assert.equal(outlineDisposed,1);
  assert.equal(geometryDisposed,0);assert.equal(outlineMaterialDisposed,0);assert.deepEqual(f.group.children[0].userData.sphereIds,[2]);
  f.spheres.clear();f.spheres.clear();assert.equal(f.group.children.length,0);assert.equal(f.outlines.children.length,0);
  assert.equal(geometryDisposed,0);assert.equal(outlineMaterialDisposed,0);
});

test('dense selection needs one outline batch and few sphere batches',()=>{
  const f=fixture(),items=Array.from({length:10_000},(_,i)=>atom(i+1,(i%100)/2,Math.floor(i/100)/2,0,{color:['#ef4444','#2ba456','#d3dde3','#bd45d4','#ffd43b'][i%5]}));
  f.spheres.build(items,new Set(items.map(a=>a.id)));
  assert.equal(f.group.children.length,5);assert.equal(f.outlines.children.length,1);assert.equal(f.outlines.children[0].count,10_000);
  assert.equal(f.group.children.reduce((sum,mesh)=>sum+mesh.count,0),10_000);f.spheres.clear();
});
