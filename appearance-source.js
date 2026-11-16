import * as THREE from 'three';

export const surfaces=[['smooth','Smooth'],['matte','Matte'],['grain','Fine grain'],['coarse','Coarse grain'],['metal','Metallic'],['liquid','Liquid / wet']];
export const surfaceOf=item=>item.surface||((item.kind==='carbon')?'grain':'smooth');
export const shineOf=item=>item.shininess??(item.kind==='carbon'?0:70);
export const presetShine=surface=>({smooth:70,matte:0,grain:0,coarse:0,metal:65,liquid:90}[surface]??70);
export function validateAppearance(item){
  if(item.material!==undefined&&(typeof item.material!=='string'||item.material.length>48))throw new Error('Invalid material name');
  if(item.surface!==undefined&&!surfaces.some(([value])=>value===item.surface))throw new Error('Invalid surface');
  if(item.shininess!==undefined&&(!Number.isFinite(item.shininess)||item.shininess<0||item.shininess>100))throw new Error('Invalid shininess');
  return item;
}
export const appearanceOf=item=>({...(item.material!==undefined?{material:item.material}:{}),...(item.surface!==undefined?{surface:item.surface}:{}),...(item.shininess!==undefined?{shininess:item.shininess}:{})});

const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
const ctx=canvas.getContext('2d');let seed=12345;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
ctx.fillStyle='#777';ctx.fillRect(0,0,256,256);
for(let i=0;i<4200;i++){
  const x=random()*256,y=random()*256,r=1.1+random()*2.3,shade=85+Math.floor(random()*135),gradient=ctx.createLinearGradient(x-r,y-r,x+r,y+r);
  gradient.addColorStop(0,`rgb(${shade},${shade},${shade})`);gradient.addColorStop(1,`rgb(${Math.max(30,shade-75)},${Math.max(30,shade-75)},${Math.max(30,shade-75)})`);
  ctx.beginPath();for(let j=0;j<6;j++){const angle=j*Math.PI/3,rad=r*(.65+random()*.5),px=x+Math.cos(angle)*rad,py=y+Math.sin(angle)*rad;j?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
}
const bump=new THREE.CanvasTexture(canvas);bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.repeat.set(2,2);
const waveCanvas=document.createElement('canvas');waveCanvas.width=waveCanvas.height=128;
const waveCtx=waveCanvas.getContext('2d'),wavePixels=waveCtx.createImageData(128,128);
for(let y=0;y<128;y++)for(let x=0;x<128;x++){const value=128+35*Math.sin(x*Math.PI/16)*Math.cos(y*Math.PI/32)+22*Math.sin((x+y)*Math.PI/32),i=(y*128+x)*4;wavePixels.data.set([value,value,value,255],i);}
waveCtx.putImageData(wavePixels,0,0);const wave=new THREE.CanvasTexture(waveCanvas);wave.wrapS=wave.wrapT=THREE.RepeatWrapping;

function grainMaterial(material,coarse){
  material.customProgramCacheKey=()=>`material-grain-${coarse?'coarse':'fine'}-v1`;
  material.onBeforeCompile=shader=>{
    shader.uniforms.grainTexture={value:bump};
    shader.vertexShader='varying vec3 vGrainWorld;\nvarying vec3 vGrainNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 grainPosition=vec4(transformed,1.0);vec3 grainNormal=normal;
      #ifdef USE_INSTANCING
        grainPosition=instanceMatrix*grainPosition;
        grainNormal=mat3(instanceMatrix)*grainNormal;
      #endif
      vGrainWorld=(modelMatrix*grainPosition).xyz;vGrainNormal=normalize(mat3(modelMatrix)*grainNormal);`);
    shader.fragmentShader='varying vec3 vGrainWorld;\nvarying vec3 vGrainNormal;\nuniform sampler2D grainTexture;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      vec3 blend=pow(abs(normalize(vGrainNormal)),vec3(8.0));blend/=max(dot(blend,vec3(1.0)),0.0001);
      float grainTone=dot(vec3(texture2D(grainTexture,vGrainWorld.zy*${coarse?'0.22':'0.45'}).r,texture2D(grainTexture,vGrainWorld.xz*${coarse?'0.22':'0.45'}).r,texture2D(grainTexture,vGrainWorld.xy*${coarse?'0.22':'0.45'}).r),blend);
      diffuseColor.rgb=max(diffuseColor.rgb,vec3(0.012))*mix(${coarse?'0.12,2.25':'0.25,1.9'},grainTone);`);
  };
}
export function makeSurfaceMaterial(item){
  const surface=surfaceOf(item),shine=shineOf(item),roughness=Math.max(.04,1-Math.sqrt(shine/100)*.94);
  if(surface==='smooth')return new THREE.MeshPhongMaterial({color:item.color,shininess:shine,specular:0x444444});
  const options={color:item.color,roughness,metalness:surface==='metal'?.65:0};
  if(surface==='matte')return new THREE.MeshStandardMaterial(options);
  if(surface==='liquid')return new THREE.MeshPhysicalMaterial({...options,bumpMap:wave,bumpScale:.035,clearcoat:1,clearcoatRoughness:roughness,ior:1.45});
  const material=new THREE.MeshStandardMaterial({...options,...(['grain','coarse'].includes(surface)?{bumpMap:bump,bumpScale:surface==='coarse'?.045:.007}:{})});
  if(surface==='grain'||surface==='coarse')grainMaterial(material,surface==='coarse');
  return material;
}
