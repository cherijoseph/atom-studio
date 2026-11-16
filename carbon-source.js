import * as THREE from 'three';
import {makeSurfaceMaterial} from './appearance-source.js';
import {SCENE_LIMIT} from './scene-limits-source.js';

// Exact box boundaries join on the placement lattice. Grain changes shading,
// rather than displacing edges inward and opening seams between cells.
export const carbonGeometry = new THREE.BoxGeometry(1.001,1.001,1.001);
export const isCarbon = item => item.kind === 'carbon';
export const carbonSize = item => item.dimensions || [item.r,item.r,item.r];
export const extent = item => isCarbon(item) ? carbonSize(item).map(v=>v/2+.001) : [item.r,item.r,item.r];

export function makeCarbon(item,items=[],outline=false){
  const material=outline?new THREE.MeshBasicMaterial({color:0x147e68,side:THREE.BackSide}):makeSurfaceMaterial(item);
  const mesh=new THREE.Mesh(carbonGeometry,material);mesh.userData.carbon=true;
  mesh.position.set(item.x,item.y,item.z);mesh.scale.fromArray(carbonSize(item));
  if(outline)mesh.scale.multiplyScalar(1.04);
  return mesh;
}

export function disposeMesh(mesh){mesh.material.dispose();}

// Older region saves become independently controllable blocks on import.
export function legacyBlocks(regions,make){
  if(!Array.isArray(regions)||regions.length>40)throw new Error('Invalid materials');
  const result=[];
  for(const r of regions){
    if(!r||['x','y','z'].some(k=>!Number.isFinite(r[k])||Math.abs(r[k])>100)||['w','h','d'].some(k=>!Number.isFinite(r[k])||r[k]<.2||r[k]>100)||!/^#[0-9a-f]{6}$/i.test(r.color)||!['block','mound'].includes(r.shape)||typeof r.visible!=='boolean')throw new Error('Invalid material');
    const counts=[r.w,r.h,r.d].map(Math.ceil),dims=[r.w,r.h,r.d].map((v,i)=>v/counts[i]);
    if(counts[0]*counts[1]*counts[2]+result.length>SCENE_LIMIT)throw new Error('Scene exceeds the block limit');
    for(let x=0;x<counts[0];x++)for(let y=0;y<counts[1];y++)for(let z=0;z<counts[2];z++){
      const n=[x,y,z].map((v,i)=>(v+.5)/counts[i]*2-1);if(r.shape==='mound'&&n.reduce((sum,v)=>sum+v*v,0)>1)continue;
      const item=make(r.x+n[0]*r.w/2,r.y+n[1]*r.h/2,r.z+n[2]*r.d/2,r.color,Math.max(...dims),'carbon',dims);
      item.visible=r.visible;result.push(item);
    }
  }
  return result;
}
