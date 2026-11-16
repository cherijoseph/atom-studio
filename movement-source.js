import * as THREE from 'three';

// Editing helpers are separate from model objects and never serialized.
export function createMovement(scene,viewport){
  const group=new THREE.Group(),ghost=new THREE.Group();scene.add(group,ghost);
  const axes=['x','y','z'],colours={x:0xe25862,y:0x24a879,z:0x4388df},handles=[];
  for(const axis of axes){
    const arrow=new THREE.Group(),direction=new THREE.Vector3();direction[axis]=1;
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
    const material=new THREE.MeshBasicMaterial({color:colours[axis],depthTest:false,depthWrite:false,transparent:true});
    const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.65,10),material);shaft.position.y=.48;
    const tip=new THREE.Mesh(new THREE.ConeGeometry(.115,.25,16),material);tip.position.y=.91;
    const picker=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.94,12),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthTest:false,depthWrite:false}));picker.position.y=.55;picker.userData.axis=axis;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');ctx.font='bold 42px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#'+colours[axis].toString(16).padStart(6,'0');ctx.fillText(axis.toUpperCase(),32,32);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false,depthWrite:false}));label.position.y=1.2;label.scale.set(.33,.33,.33);
    arrow.add(shaft,tip,picker,label);arrow.traverse(o=>o.renderOrder=50);group.add(arrow);handles.push({axis,arrow,picker,material});
  }
  let currentCamera,active=null,preview=null,count=0;
  function update(camera,items,enabled){
    currentCamera=camera;group.visible=enabled&&items.length>0;
    if(!group.visible)return;
    const mid=new THREE.Vector3();items.forEach(a=>mid.add(new THREE.Vector3(a.x,a.y,a.z)));mid.divideScalar(items.length);group.position.copy(mid);
    const height=Math.max(viewport.clientHeight,1),distance=mid.distanceTo(camera.position),scale=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom/height*80:2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/height*80;
    group.scale.setScalar(scale);camera.updateMatrixWorld();group.updateMatrixWorld(true);
    const origin=mid.clone().project(camera);
    for(const h of handles){const end=mid.clone();end[h.axis]+=scale;end.project(camera);h.arrow.visible=Math.hypot((end.x-origin.x)*viewport.clientWidth/2,(end.y-origin.y)*height/2)>14;h.material.color.setHex(active===h.axis?0xf2b428:colours[h.axis]);}
  }
  function pick(raycaster){
    if(!group.visible)return null;
    const hits=raycaster.intersectObjects(handles.filter(h=>h.arrow.visible).map(h=>h.picker),false);if(!hits.length)return null;
    const axis=hits[0].object.userData.axis,origin=group.position.clone();return{axis,origin};
  }
  function showPreview(items,geometry,valid){
    if(!preview||count!==items.length||preview.geometry!==geometry){if(preview){ghost.remove(preview);preview.material.dispose();preview.dispose();}count=items.length;preview=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({transparent:true,opacity:.3,depthTest:false,depthWrite:false}),count);preview.renderOrder=40;ghost.add(preview);}
    preview.material.color.setHex(valid?0x159d82:0xe25862);const matrix=new THREE.Matrix4(),scale=new THREE.Vector3();items.forEach((a,i)=>{scale.fromArray(a.kind==='carbon'?(a.dimensions||[a.r,a.r,a.r]):[a.r,a.r,a.r]);matrix.compose(new THREE.Vector3(a.x,a.y,a.z),new THREE.Quaternion(),scale);preview.setMatrixAt(i,matrix);});preview.instanceMatrix.needsUpdate=true;preview.computeBoundingSphere();ghost.visible=true;
  }
  return{update,pick,showPreview,withHidden(fn){const visible=group.visible,previewVisible=ghost.visible;group.visible=ghost.visible=false;try{return fn();}finally{group.visible=visible;ghost.visible=previewVisible;}},setActive:axis=>active=axis,hidePreview:()=>ghost.visible=false,visibility:enabled=>{if(!enabled){group.visible=false;ghost.visible=false;}},isPreviewVisible:()=>ghost.visible};
}
