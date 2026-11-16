import * as THREE from 'three';

// Batching changes only how spheres are drawn. Model records and selection IDs
// remain independent, so all editor operations still act on individual spheres.
export function createSphereBatches({group,outlines,geometry,outlineMaterial,styleKey,materialFor}){
  let batches=[],outlineMesh=null;
  const references=new Map(),outlineReferences=new Map();
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),rotation=new THREE.Quaternion();
  function transform(mesh,index,item,outline=false){
    position.set(item.x,item.y,item.z);scale.setScalar(outline?item.r*1.08+.012:item.r);
    matrix.compose(position,rotation,scale);mesh.setMatrixAt(index,matrix);
  }
  function ready(mesh){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
  function clear(){
    for(const mesh of batches){mesh.removeFromParent();mesh.material.dispose();mesh.dispose();}
    if(outlineMesh){outlineMesh.removeFromParent();outlineMesh.dispose();}
    batches=[];outlineMesh=null;references.clear();outlineReferences.clear();
  }
  function build(items,selection=new Set()){
    clear();const styles=new Map(),selected=[];
    for(const item of items){
      if(item.visible===false)continue;
      const key=styleKey(item);if(!styles.has(key))styles.set(key,[]);styles.get(key).push(item);
      if(selection.has(item.id))selected.push(item);
    }
    for(const list of styles.values()){
      const mesh=new THREE.InstancedMesh(geometry,materialFor(list[0]),list.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.userData.sphereIds=list.map(item=>item.id);
      list.forEach((item,index)=>{transform(mesh,index,item);references.set(item.id,{mesh,index});});
      ready(mesh);group.add(mesh);batches.push(mesh);
    }
    if(selected.length){
      outlineMesh=new THREE.InstancedMesh(geometry,outlineMaterial,selected.length);
      outlineMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      selected.forEach((item,index)=>{transform(outlineMesh,index,item,true);outlineReferences.set(item.id,index);});
      ready(outlineMesh);outlines.add(outlineMesh);
    }
  }
  function move(items){
    const changed=new Set();let changedOutline=false;
    for(const item of items){
      const reference=references.get(item.id);
      if(reference){transform(reference.mesh,reference.index,item);changed.add(reference.mesh);}
      const outlineIndex=outlineReferences.get(item.id);
      if(outlineIndex!==undefined){transform(outlineMesh,outlineIndex,item,true);changedOutline=true;}
    }
    for(const mesh of changed)ready(mesh);
    if(changedOutline)ready(outlineMesh);
  }
  return {build,clear,move};
}

export function pickedObjectId(hit){
  return hit.instanceId===undefined?hit.object.userData.id:hit.object.userData.sphereIds?.[hit.instanceId];
}
