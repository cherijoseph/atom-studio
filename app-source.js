import * as THREE from 'three';
import {isLocked,validateLock} from './lock-schema-source.js';
import {mountLockingControls,lockedSets} from './locking-controls-source.js';
import {createLinkedViews} from './linked-views-source.js';
import {createPanelLayout} from './panel-layout-source.js';
import {createImageResize,imageResizePlane} from './image-resize-source.js';
import {createImageResizeHandles} from './image-resize-handles-source.js';
import {createImagePlanes,readImagePlaneFile} from './image-planes-source.js';
import {validateImagePlanes,validateActiveImageId,IMAGE_LIMIT} from './image-plane-schema-source.js';
import {mountImageControls} from './image-controls-source.js';
import {makeSurfaceMaterial,surfaceOf,shineOf,appearanceOf,validateAppearance,presetShine} from './appearance-source.js';
import {sceneColours} from './scene-colours-source.js';
import {normalizeDownloadName,normalizeDownloadNames,defaultDownloadNames} from './download-name-source.js';
import {createBrowserAutosave} from './autosave-source.js';
import {createAnnotations,defaultAnnotations,validateAnnotations} from './legend-source.js';
import {isCarbon,carbonSize,carbonGeometry,extent,makeCarbon,disposeMesh,legacyBlocks} from './carbon-source.js';
import {createMovement} from './movement-source.js';
import {createSphereBatches,pickedObjectId} from './sphere-batches-source.js';
import {SCENE_LIMIT as LIMIT,STRUCTURE_FILE_LIMIT} from './scene-limits-source.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const $=id=>document.getElementById(id), palette=['#3b82f6','#14b8a6','#e2e8f0','#ef6b5c','#f59e0b','#8b5cf6'];
const clone=value=>JSON.parse(JSON.stringify(value)), rnd=value=>Math.round(value*10000)/10000;
let atoms=[],selection=new Set(),clipboard=[],pasteIndex=0,undo=[],redo=[],tool='select',clean=false,activeView='iso',atomId=0,drag=null,toastTimer,dirty=false,exporting=false;
let images=[],activeImageId=null,imageControls=null,imageClipboard=null,imageImporting=false;
function activeImage(){return images.find(image=>image.id===activeImageId)||null;}
function movementItems(){const image=activeImage();return image?(isLocked(image)?[]:[image]):selected();}
function selectImage(id){if(isLocked(images.find(image=>image.id===id))){showLockedMessage();return;}activeImageId=id;selection.clear();setTool('select');if(clean)toggleClean();sync();}
function faceImageView(){camera.updateMatrixWorld();const rotation=new THREE.Euler().setFromQuaternion(camera.quaternion,'XYZ');return[rotation.x,rotation.y,rotation.z].map(THREE.MathUtils.radToDeg);}
let downloadNames=defaultDownloadNames(),pendingDownload=null;
let autosave=null,autosaveSuspended=false,lockingControls=null,linkedViews=null;
const panelLayout=createPanelLayout({document});
function scheduleAutosave(){if(!autosaveSuspended)autosave?.schedule();}
const viewport=$('viewport'),scene=new THREE.Scene();let renderer;
try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});}catch{$('webgl-error').hidden=false;throw new Error('WebGL unavailable');}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);renderer.domElement.tabIndex=0;
renderer.domElement.setAttribute('aria-label','Interactive 3D atomic structure. Use the layer list and position fields for keyboard editing.');viewport.append(renderer.domElement);
const orthographic=new THREE.OrthographicCamera(-20,20,15,-15,.1,1200),perspective=new THREE.PerspectiveCamera(38,1,.1,1200);let camera=orthographic,orbit;
function setupOrbit(target=new THREE.Vector3()){if(orbit)orbit.dispose();orbit=new OrbitControls(camera,renderer.domElement);orbit.target.copy(target);orbit.enableDamping=true;orbit.dampingFactor=.12;orbit.minDistance=1;orbit.maxDistance=400;orbit.minZoom=.1;orbit.maxZoom=30;orbit.addEventListener('end',scheduleAutosave);orbit.update();}
camera.position.set(20,13,32);setupOrbit(new THREE.Vector3(0,2,0));
scene.add(new THREE.HemisphereLight(0xffffff,0x6c7e90,2.3));const keyLight=new THREE.DirectionalLight(0xffffff,2.5);keyLight.position.set(-12,20,18);scene.add(keyLight);
const fillLight=new THREE.DirectionalLight(0xb8d7ff,.7);fillLight.position.set(15,5,-10);scene.add(fillLight);
const atomGroup=new THREE.Group(),outlines=new THREE.Group(),guides=new THREE.Group();scene.add(atomGroup,outlines,guides);
const annotations=createAnnotations({viewport,onChange:next=>commit(()=>annotations.setState(next),'Legend updated'),onDragStart:()=>{orbit.enabled=false;},onDragEnd:()=>{orbit.enabled=true;}});
const movement=createMovement(scene,viewport);
const imageResizeHandles=createImageResizeHandles({viewport,onPointerDown:beginImageResize});
const imagePlanes=createImagePlanes({scene,onReady:()=>{linkedViews?.update();if(!exporting)renderFrame();},onError:message=>info(message)});
function renderFrame(){linkedViews?.setSuspended(clean||exporting);imageResizeHandles.update(camera,activeImage(),!clean&&!exporting&&tool==='select',drag?.kind==='image-resize'?drag.handle:null);outlines.visible=!clean&&!exporting;imagePlanes.setEditingVisible(!clean&&!exporting);movement.update(camera,movementItems().filter(a=>a.visible!==false),!clean&&!exporting&&tool==='select');movement.visibility(!clean&&!exporting);renderer.render(scene,camera);annotations.render(renderer,{dark:$('background').value==='dark',clean});linkedViews?.render();}
const geometry=new THREE.SphereGeometry(1,28,22),outlineMaterial=new THREE.MeshBasicMaterial({color:0x147e68,side:THREE.BackSide}),meshes=new Map();
const carbonEdges=new THREE.EdgesGeometry(carbonGeometry),carbonEdgeMaterial=new THREE.LineBasicMaterial({color:0x46c7aa,transparent:true,opacity:.95,depthTest:false,depthWrite:false});
const sphereBatches=createSphereBatches({group:atomGroup,outlines,geometry,outlineMaterial,styleKey:a=>JSON.stringify([a.color.toLowerCase(),surfaceOf(a),shineOf(a)]),materialFor:makeSurfaceMaterial});
const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2(),pointGeometry=new THREE.BufferGeometry();
const dots=new THREE.Points(pointGeometry,new THREE.PointsMaterial({color:0x8ca6b6,size:2.2,sizeAttenuation:false,transparent:true,opacity:.55}));guides.add(dots);
const axes=new THREE.AxesHelper(2);axes.position.set(-15,-.5,4);guides.add(axes);
function number(id,min,max,fallback=0){const field=$(id),n=Number(field.value),value=Number.isFinite(n)&&field.value.trim()!==''?Math.max(min,Math.min(max,n)):fallback;field.value=value;return value;}
function info(message,show=true){$('status').textContent=message;if(show){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,2600);}}
function projectState(){return{atoms:clone(atoms),images:clone(images),activeImageId,selection:[...selection],annotations:annotations.getState()};}
function snapshot(){return captureWorkspace();}
function remember(){undo.push(snapshot());if(undo.length>60)undo.shift();redo=[];dirty=true;}
function restore(workspace){restoreWorkspace(workspace);}
function commit(fn,message){if(drag?.kind==='linked')linkedViews?.cancel();remember();fn();sync();if(message)info(message);}
function objectSize(a){return isCarbon(a)?(a.dimensions?Math.max(...a.dimensions):a.r):a.r*2;}
function internalSize(size,kind){return kind==='carbon'?size:size/2;}
function creationRadius(){const kind=$('object-kind').value;return internalSize(number('radius',kind==='carbon'?.05:.1,10,1),kind);}
function makeAtom(x,y,z,color=$('colour').value,r=creationRadius(),kind=$('object-kind').value,dimensions,appearance={}){return{id:++atomId,x:rnd(x),y:rnd(y),z:rnd(z),color,r,kind,...(dimensions?{dimensions:[...dimensions]}:{}),...appearance};}
function selected(){return atoms.filter(a=>selection.has(a.id)&&!isLocked(a));}
function canEditScene(){return !drag&&!annotations.isDragging()&&!exporting&&!imageImporting;}
function showLockedMessage(){info('This object is locked. Unlock its set in Locked objects to edit it.');lockingControls?.reveal();}
function lockSelection(label){
  if(!canEditScene())return;const list=movementItems();if(!list.length)return;
  const group=crypto.randomUUID();
  commit(()=>{for(const item of list)Object.assign(item,{locked:true,lockGroup:group,lockLabel:label});selection.clear();activeImageId=null;},`Locked ${list.length} objects as “${label}” · Unlock them in Locked objects`);
}
function unlockSet(key){
  if(!canEditScene())return;const list=lockedSets([...atoms,...images]).filter(set=>key===null||set.key===key).flatMap(set=>set.items);if(!list.length)return;
  commit(()=>{for(const item of list){delete item.locked;delete item.lockGroup;delete item.lockLabel;}selection=new Set(list.filter(item=>typeof item.id==='number').map(item=>item.id));activeImageId=selection.size?null:list.find(item=>typeof item.id==='string')?.id||null;},`Unlocked ${list.length} objects · Undo locks them again`);
}
function centre(list=selected()){const p=new THREE.Vector3();list.forEach(a=>p.add(new THREE.Vector3(a.x,a.y,a.z)));return list.length?p.divideScalar(list.length):p;}
function capacity(count){if(atoms.length+count>LIMIT){info(`This scene supports up to ${LIMIT} objects. Try a smaller layer.`);return false;}return true;}
function paintScene(){
  sphereBatches.clear();for(const mesh of atomGroup.children)disposeMesh(mesh);
  atomGroup.clear();outlines.clear();meshes.clear();
  sphereBatches.build(atoms.filter(a=>!isCarbon(a)),selection);
  for(const a of atoms){
    if(a.visible===false||!isCarbon(a))continue;
    const mesh=makeCarbon(a);mesh.userData.id=a.id;atomGroup.add(mesh);meshes.set(a.id,mesh);
    if(selection.has(a.id)){
      const outline=new THREE.LineSegments(carbonEdges,carbonEdgeMaterial);
      outline.position.copy(mesh.position);outline.scale.copy(mesh.scale);outline.renderOrder=3;outline.userData.id=a.id;outlines.add(outline);
    }
  }
  outlines.visible=!clean;
}
function updateGrid(){const height=number('height',-100,100,1),step=Math.max(Number($('snap').value)||number('spacing',.1,10,1),.1),points=[],plane=$('plane').value;for(let x=-24;x<=24.001;x+=step)for(let t=-12;t<=12.001;t+=step){if(plane==='xy')points.push(rnd(x),rnd(height+t),0);else if(plane==='yz')points.push(0,rnd(height+t),rnd(x));else points.push(rnd(x),height,rnd(t));}pointGeometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));pointGeometry.computeBoundingSphere();guides.visible=$('grid').checked&&!clean;}
function materialName(a){return a.material?.trim()||'';}
let usedColoursKey='';
function updateUsedColourSelection(){
  const list=selected(),colours=new Set(list.map(a=>a.color.toLowerCase()));
  $('selected-colour-hex').textContent=list.length?(colours.size===1?[...colours][0].toUpperCase():'Mixed'):'';
  for(const [id,colour] of [['used-colours',$('colour').value.toLowerCase()],['selected-used-colours',colours.size===1?[...colours][0]:null]]){
    for(const button of $(id).querySelectorAll('button')){const active=button.dataset.color===colour;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  }
}
function updateUsedColours(){
  const colours=sceneColours(atoms),key=JSON.stringify(colours);
  if(key!==usedColoursKey){
    const focused=document.activeElement?.closest('.used-colour'),focusedGroup=focused?.parentElement.id,focusedColour=focused?.dataset.color;
    for(const [id,apply]of [['used-colours',false],['selected-used-colours',true]]){
      const field=$(id);field.replaceChildren();
      if(!colours.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Colours appear here as you build.';field.append(empty);}
      for(const {color,labels,count} of colours){
        const name=labels.join(', '),hex=color.toUpperCase(),button=document.createElement('button');button.type='button';button.className='used-colour';button.dataset.color=color;
        button.title=`${name} · ${hex} · ${count} objects`;button.setAttribute('aria-label',`${apply?'Recolour selection':'Use colour'} ${hex} from ${name}`);
        const sample=document.createElement('span');sample.className='used-colour-dot';sample.style.background=color;sample.setAttribute('aria-hidden','true');
        const label=document.createElement('span');label.className='used-colour-label';const title=document.createElement('span'),code=document.createElement('small');title.textContent=name;code.textContent=hex;label.append(title,code);button.append(sample,label);
        button.onclick=()=>{if(apply)recolour(color);else{setColour(color);scheduleAutosave();}};field.append(button);
      }
    }
    usedColoursKey=key;
    if(focusedGroup&&focusedColour)$(focusedGroup).querySelector(`button[data-color="${focusedColour}"]`)?.focus({preventScroll:true});
  }
  updateUsedColourSelection();
}
function matchesSelection(a){return !isLocked(a)&&($('filter-colour').value==='all'||a.color.toLowerCase()===$('filter-colour').value)&&($('filter-material').value==='all'||materialName(a)===$('filter-material').value);}
function updateFilters(){
  const colours=[...new Set(atoms.map(a=>a.color.toLowerCase()))].sort(),names=[...new Set(atoms.map(materialName).filter(Boolean))].sort();
  for(const[id,values,title]of[['filter-colour',colours,'All colours'],['filter-material',names,'All materials']]){const field=$(id),previous=field.value;field.replaceChildren(new Option(title,'all'));for(const value of values){const labels=id==='filter-colour'?[...new Set(atoms.filter(a=>a.color.toLowerCase()===value).map(materialName).filter(Boolean))].join(', '):'';field.add(new Option(labels?labels+' · '+value.toUpperCase():id==='filter-colour'?value.toUpperCase():value,value));}field.value=values.includes(previous)?previous:'all';}
  $('filter-hint').textContent=$('filter-colour').value==='all'&&$('filter-material').value==='all'?'Applies to rectangle, layer and Select all. Click individual objects to select them directly.':atoms.filter(matchesSelection).length+' matching objects · Rectangle, layer and Select all use this filter.';
}
for(const id of['filter-colour','filter-material'])$(id).onchange=()=>{selection=new Set(selected().filter(matchesSelection).map(a=>a.id));sync();};
function updateLayers(){const layers=new Map();for(const a of atoms){const key=rnd(a.y);if(!layers.has(key))layers.set(key,[]);layers.get(key).push(a);}$('layer-count').textContent=`${layers.size} heights`;$('layers').replaceChildren();for(const[height,list]of[...layers].sort((a,b)=>b[0]-a[0])){const eligible=list.filter(matchesSelection),button=document.createElement('button');button.disabled=!eligible.length;button.className='layer'+(eligible.length&&eligible.every(a=>selection.has(a.id))?' active':'');button.setAttribute('aria-label',`Select layer at height ${height}, ${list.length} objects`);button.innerHTML=`<span class="layer-swatch" style="background:${list[0].color}"></span><span>Y = ${height}</span><span>${eligible.length===list.length?list.length:eligible.length+' / '+list.length} objects</span>`;button.onclick=e=>{if(!e.shiftKey)selection.clear();eligible.forEach(a=>selection.add(a.id));$('height').value=height;sync();info(`Selected ${eligible.length} matching objects at height ${height}`,false);};$('layers').append(button);}}
function updateUI(){updateFilters();updateUsedColours();const list=selected(),p=centre(list);$('scene-count').textContent=$('footer-count').textContent=`${atoms.filter(a=>!isCarbon(a)).length} spheres · ${atoms.filter(isCarbon).length} cubes${images.length?' · '+images.length+' images':''}`;$('selected-count').textContent=activeImage()?'1 IMAGE':`${list.length} SELECTED`;$('selection-empty').hidden=!!list.length;$('selection-controls').hidden=!list.length;$('empty').hidden=!!(atoms.length+images.length);$('stack').disabled=!list.length;$('selection-summary').textContent=list.length===1?(isCarbon(list[0])?'One cube selected':'One sphere selected'):`${list.length} objects selected`;if(list.length){for(const axis of['x','y','z'])if(document.activeElement!==$('pos-'+axis))$('pos-'+axis).value=rnd(p[axis]);$('selected-colour').value=list[0].color;$('selected-radius').min=list.every(isCarbon)?.05:.1;$('selected-radius').max=10;const size=objectSize(list[0]),same=list.every(a=>Math.abs(objectSize(a)-size)<.00001);$('selected-radius').value=same?rnd(size):'';$('selected-radius').placeholder='Mixed';$('selected-size-label').textContent=list.every(isCarbon)?'Size · edge':list.some(isCarbon)?'Size · full width':'Size · diameter';$('selected-kind').value=list.every(isCarbon)?'carbon':list.every(a=>!isCarbon(a))?'atom':'mixed';$('selected-visible').checked=list.every(a=>a.visible!==false);const name=materialName(list[0]);$('selected-material').value=list.every(a=>materialName(a)===name)?name:'';$('selected-surface').value=list.every(a=>surfaceOf(a)===surfaceOf(list[0]))?surfaceOf(list[0]):'mixed';$('selected-shininess').value=list.every(a=>shineOf(a)===shineOf(list[0]))?shineOf(list[0]):'';}$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;$('paste').disabled=!clipboard.length&&!imageClipboard;$('stack').textContent=$('alignment').value==='diagonal'?'Copy diagonally above':'Copy selection above';$('array-count').textContent=`${Math.min(50,Math.max(1,Number($('columns').value)||1))*Math.min(50,Math.max(1,Number($('rows').value)||1))} ${$('object-kind').value==='carbon'?'cubes':'spheres'}`;updateLayers();}
function sync(){selection=new Set(selected().map(a=>a.id));if(isLocked(activeImage()))activeImageId=null;if(selection.size)activeImageId=null;paintScene();imagePlanes.sync(images,activeImageId);updateUI();imageControls?.update();panelLayout.update({image:activeImage(),selectionCount:selection.size});updateGrid();updateMoveHUD();lockingControls?.update();linkedViews?.update();scheduleAutosave();}
function setColour(c){c=c.toLowerCase();$('colour').value=c;$('colour-hex').textContent=c.toUpperCase();document.querySelectorAll('.swatch').forEach(b=>b.classList.toggle('active',b.dataset.color===c));updateUsedColourSelection();}
palette.forEach(c=>{const b=document.createElement('button');b.className='swatch';b.style.background=c;b.dataset.color=c;b.setAttribute('aria-label',`Use ${c}`);b.onclick=()=>setColour(c);$('palette').append(b);});setColour(palette[0]);$('colour').oninput=e=>setColour(e.target.value);
function bounds(){const box=new THREE.Box3();atoms.filter(a=>a.visible!==false).forEach(a=>{const e=extent(a);box.expandByPoint(new THREE.Vector3(a.x-e[0],a.y-e[1],a.z-e[2]));box.expandByPoint(new THREE.Vector3(a.x+e[0],a.y+e[1],a.z+e[2]));});box.union(imagePlanes.bounds());if(box.isEmpty()){box.min.set(-3,-2,-3);box.max.set(3,4,3);}return box;}
function fit(){const box=bounds(),mid=box.getCenter(new THREE.Vector3()),direction=camera.position.clone().sub(orbit.target).normalize();if(direction.length()<.1)direction.set(1,.7,1).normalize();orbit.target.copy(mid);const size=box.getSize(new THREE.Vector3());camera.position.copy(mid).addScaledVector(direction,Math.max(size.length()*1.5,15));orbit.update();camera.updateMatrixWorld();const corners=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])corners.push(new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse));const width=Math.max(...corners.map(v=>v.x))-Math.min(...corners.map(v=>v.x)),height=Math.max(...corners.map(v=>v.y))-Math.min(...corners.map(v=>v.y)),aspect=viewport.clientWidth/viewport.clientHeight;if(camera.isOrthographicCamera)camera.zoom=Math.min((camera.right-camera.left)/(width*1.23||1),(camera.top-camera.bottom)/(height*1.35||1));else{const radius=Math.max(size.length()/2,3),fov=THREE.MathUtils.degToRad(camera.fov),dist=radius/Math.sin(Math.min(fov/2,Math.atan(Math.tan(fov/2)*aspect)))*1.18;camera.position.copy(mid).addScaledVector(direction,dist);}camera.updateProjectionMatrix();orbit.update();}
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);const aspect=w/h;orthographic.left=-12*aspect;orthographic.right=12*aspect;orthographic.top=12;orthographic.bottom=-12;orthographic.updateProjectionMatrix();perspective.aspect=aspect;perspective.updateProjectionMatrix();}new ResizeObserver(resize).observe(viewport);resize();
function view(mode){activeView=mode;const mid=bounds().getCenter(new THREE.Vector3()),directions={iso:[.58,.42,1],front:[0,0,1],top:[0,1,.0001],side:[1,0,0]};camera.up.set(0,1,0);camera.position.copy(mid).add(new THREE.Vector3(...directions[mode]).normalize().multiplyScalar(45));orbit.target.copy(mid);orbit.update();fit();$('scene-view').textContent={iso:'Isometric',front:'Front view',top:'Top view',side:'Side view'}[mode];document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===mode));$('plane').value=mode==='front'?'xy':mode==='side'?'yz':'xz';updateGrid();updateMoveHUD();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));$('fit').onclick=fit;
$('perspective').onchange=()=>{const position=camera.position.clone(),target=orbit.target.clone();camera=$('perspective').checked?perspective:orthographic;camera.position.copy(position);setupOrbit(target);resize();fit();};
const workspaceFields=['object-kind','colour','radius','material-name','surface','shininess','height','spacing','columns','rows','packing','alignment','layer-rise','snap','plane','background','resolution','filter-colour','filter-material'];
function captureWorkspace(){return {downloadNames:{...downloadNames},state:projectState(),fields:Object.fromEntries(workspaceFields.map(id=>[id,$(id).value])),grid:$('grid').checked,styles:clone(creationStyles),lastKind,view:{type:activeView,perspective:!!camera.isPerspectiveCamera,position:camera.position.toArray(),target:orbit.target.toArray(),zoom:camera.zoom,clean}};}
function restoreWorkspace(work){downloadNames=normalizeDownloadNames(work.downloadNames);atoms=clone(work.state.atoms);images=clone(work.state.images||[]);activeImageId=work.state.activeImageId||null;atomId=Math.max(atomId,0,...atoms.map(a=>a.id));annotations.setState(work.state.annotations);selection=new Set(work.state.selection);chooseKind(work.lastKind);creationStyles=clone(work.styles);for(const id of workspaceFields)if(!id.startsWith('filter-'))$(id).value=work.fields[id];setColour(work.fields.colour);$('grid').checked=work.grid;sync();for(const id of['filter-colour','filter-material'])if([...$(id).options].some(o=>o.value===work.fields[id]))$(id).value=work.fields[id];const v=work.view;camera=v.perspective?perspective:orthographic;$('perspective').checked=v.perspective;camera.position.fromArray(v.position);camera.zoom=v.zoom;setupOrbit(new THREE.Vector3(...v.target));activeView=v.type;$('scene-view').textContent={iso:'Isometric',front:'Front view',top:'Top view',side:'Side view'}[v.type];document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v.type));if(clean!==v.clean)toggleClean();resize();applyBackground();sync();}
function deleteImage(){const image=activeImage();if(!image||isLocked(image))return;commit(()=>{images=images.filter(a=>a.id!==image.id);activeImageId=null;},'Image removed · Undo restores it');}
function duplicateImage(source=activeImage()){
  if(!source||isLocked(source))return;if(images.length>=IMAGE_LIMIT){info(`You can add up to ${IMAGE_LIMIT} images per diagram.`);return;}
  const step=Number($('spacing').value)||1,next={...clone(source),id:crypto.randomUUID(),x:rnd(Math.max(-100,Math.min(100,source.x+step))),z:rnd(Math.max(-100,Math.min(100,source.z+step)))};
  delete next.locked;delete next.lockGroup;delete next.lockLabel;
  try{validateImagePlanes([...images,next]);}catch(error){info(error.message);return;}
  commit(()=>{images.push(next);activeImageId=next.id;selection.clear();},'Image duplicated');
}
async function addImageFile(file){
  if(imageImporting||drag||exporting)return;if(images.length>=IMAGE_LIMIT){info(`You can add up to ${IMAGE_LIMIT} images per diagram.`);return;}
  imageImporting=true;$('image-add').disabled=true;$('image-status').textContent='Preparing image…';
  try{
    const imported=await readImagePlaneFile(file),longSide=Math.min(100,Math.max(8,.1*Math.max(imported.aspect,1/imported.aspect))),width=imported.aspect>=1?longSide:longSide*imported.aspect,height=width/imported.aspect;
    camera.updateMatrixWorld();const box=bounds(),mid=box.getCenter(new THREE.Vector3()),right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    if(atoms.length||images.length)mid.addScaledVector(right,box.getSize(new THREE.Vector3()).dot(new THREE.Vector3(Math.abs(right.x),Math.abs(right.y),Math.abs(right.z)))/2+width/2+1);
    else mid.copy(orbit.target);
    const image={id:crypto.randomUUID(),name:imported.name,dataUrl:imported.dataUrl,width,height,x:rnd(Math.max(-100,Math.min(100,mid.x))),y:rnd(Math.max(-100,Math.min(100,mid.y))),z:rnd(Math.max(-100,Math.min(100,mid.z))),rotation:faceImageView(),opacity:1,visible:true};
    const next=validateImagePlanes([...images,image]);
    commit(()=>{images=next;activeImageId=image.id;selection.clear();},'Image added beside structure · Drag axis arrows or use the image controls');
    if(clean)toggleClean();setTool('select');await imagePlanes.ready();fit();scheduleAutosave();
    $('image-status').dataset.state='';$('image-status').textContent='Image added. Resize, rotate or move it with the controls below.';
  }catch(error){$('image-status').dataset.state='error';$('image-status').textContent=error.message;info(error.message);}
  finally{imageImporting=false;$('image-add').disabled=false;$('image-file').value='';}
}
let lastKind='atom',creationStyles={atom:{color:'#3b82f6',material:'',surface:'smooth',shininess:70},carbon:{color:'#353535',material:'',surface:'grain',shininess:0}};
function chooseKind(kind){creationStyles[lastKind]={color:$('colour').value,...creationAppearance()};lastKind=kind;$('object-kind').value=kind;setColour(creationStyles[kind].color);$('material-name').value=creationStyles[kind].material;$('surface').value=creationStyles[kind].surface;$('shininess').value=creationStyles[kind].shininess;$('radius').min=kind==='carbon'?.05:.1;$('radius').max=10;number('radius',kind==='carbon'?.05:.1,10,1);$('creation-size-label').textContent=kind==='carbon'?'Size · edge':'Size · diameter';$('add').textContent=kind==='carbon'?'＋ Add cube':'＋ Add sphere';updateUI();}
$('object-kind').onchange=e=>chooseKind(e.target.value);
$('spacing').onchange=()=>{number('spacing',.1,10,1);updateGrid();};
$('match-block-size').onclick=()=>{$('radius').value=number('spacing',.1,10,1);info('New object width matches spacing. Existing objects keep their size.');};
chooseKind('atom');sync();view('iso');setTool('select');
$('new').onclick=()=>{commit(()=>{atoms=[];images=[];activeImageId=null;selection.clear();annotations.setState(defaultAnnotations());$('filter-colour').value='all';$('filter-material').value='all';},'Empty structure — Undo restores your previous scene');$('height').value=0;view('iso');updateGrid();};
function addAt(p){if(!capacity(1))return;const a=makeAtom(p.x,p.y,p.z,undefined,undefined,undefined,undefined,creationAppearance());commit(()=>{atoms.push(a);selection=new Set([a.id]);},isCarbon(a)?'Cube added':'Sphere added');setTool('select');}
function creationAppearance(){return{material:$('material-name').value.trim(),surface:$('surface').value,shininess:number('shininess',0,100,70)};}
$('surface').onchange=e=>$('shininess').value=presetShine(e.target.value);
function creationSpec(layer=false){return{...creationAppearance(),kind:$('object-kind').value,color:$('colour').value,r:creationRadius(),height:number('height',-100,100,0),spacing:number('spacing',.1,10,1),cols:layer?Math.round(number('columns',1,50,8)):1,rows:layer?Math.round(number('rows',1,50,3)):1,staggered:layer&&$('packing').value==='staggered',plane:$('plane').value,snap:Number($('snap').value)};}
function creationOffsets(spec){const list=[];for(let z=0;z<spec.rows;z++)for(let x=0;x<spec.cols;x++)list.push({x:(x-(spec.cols-1)/2)*spec.spacing+(spec.staggered&&z%2?spec.spacing/2:0),y:0,z:(z-(spec.rows-1)/2)*spec.spacing*(spec.staggered?Math.sqrt(3)/2:1)});const mid=centre(list);return list.map(p=>new THREE.Vector3(p.x,p.y,p.z).sub(mid));}
function creationDraft(spec,anchor){return creationOffsets(spec).map(p=>({x:rnd(anchor.x+p.x),y:rnd(anchor.y+p.y),z:rnd(anchor.z+p.z),color:spec.color,r:spec.r,kind:spec.kind,...appearanceOf(spec)}));}
function draftValid(list){return atoms.length+list.length<=LIMIT&&list.every(a=>['x','y','z'].every(k=>Math.abs(a[k])<=100));}
function stageCreation(spec){
  const origin=new THREE.Vector3(0,spec.height,0);if(!atoms.some(a=>a.visible!==false))return origin;
  camera.updateMatrixWorld();const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),direction=right.clone().setY(0);if(direction.lengthSq()<.001)direction.set(1,0,0);direction.normalize();
  const box=bounds(),mid=box.getCenter(new THREE.Vector3());origin.set(mid.x,spec.height,mid.z);
  let far=-Infinity;for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])far=Math.max(far,new THREE.Vector3(x,y,z).dot(right));
  const drafts=creationDraft(spec,new THREE.Vector3());let near=Infinity;for(const a of drafts){const e=extent(a);near=Math.min(near,new THREE.Vector3(a.x,a.y,a.z).dot(right)-Math.abs(right.x)*e[0]-Math.abs(right.y)*e[1]-Math.abs(right.z)*e[2]);}
  const distance=(far+Math.max(spec.spacing,.5)+spec.snap*Math.SQRT2-origin.dot(right)-near)/Math.max(direction.dot(right),.01);origin.addScaledVector(direction,Math.max(distance,0));origin.x=snapValue(origin.x);origin.z=snapValue(origin.z);
  if(!draftValid(creationDraft(spec,origin))){info('No room beside this structure. Drag the button into the view, or reduce the layer size.');return null;}return origin;
}
function finishCreation(spec,anchor,staged=false){const drafts=creationDraft(spec,anchor);if(!draftValid(drafts)){info(`Keep objects between −100 and 100, within the ${LIMIT.toLocaleString()}-object limit.`);return;}const list=drafts.map(a=>makeAtom(a.x,a.y,a.z,a.color,a.r,a.kind,undefined,appearanceOf(a)));commit(()=>{atoms.push(...list);selection=new Set(list.map(a=>a.id));},`${list.length===1?(spec.kind==='carbon'?'Cube':'Sphere'):`Layer of ${list.length} objects`} added${staged?' beside structure':''} · X ${rnd(anchor.x)}, Y ${rnd(anchor.y)}, Z ${rnd(anchor.z)}`);if(clean)toggleClean();setTool('select');if(staged)fit();}
for(const[id,layer]of[['add',false],['array',true]])$(id).onclick=()=>{const spec=creationSpec(layer);if(!capacity(spec.cols*spec.rows))return;const anchor=stageCreation(spec);if(anchor)finishCreation(spec,anchor,true);};
$('columns').oninput=$('rows').oninput=updateUI;$('height').onchange=()=>{updateGrid();updateMoveHUD();};$('snap').onchange=()=>{updateGrid();updateMoveHUD();};$('grid').onchange=updateGrid;$('plane').onchange=()=>{updateGrid();updateMoveHUD();};$('alignment').onchange=updateUI;
function duplicate(list,offset,message){if(!list.length){info('Select objects to duplicate');return;}if(!capacity(list.length))return;const added=list.map(a=>({...makeAtom(a.x+offset.x,a.y+offset.y,a.z+offset.z,a.color,a.r,a.kind||'atom',a.dimensions,appearanceOf(a)),...(a.visible!==undefined?{visible:a.visible}:{})}));if(added.some(a=>['x','y','z'].some(k=>Math.abs(a[k])>100))){info('Keep object positions between −100 and 100');return;}commit(()=>{atoms.push(...added);selection=new Set(added.map(a=>a.id));},message||`Duplicated ${added.length} objects`);}
$('stack').onclick=()=>{const rise=number('layer-rise',.1,20,1),shift=$('alignment').value==='diagonal'?number('spacing',.1,10,1)/2:0;duplicate(selected(),new THREE.Vector3(shift,rise,shift),shift?'Copied layer with a diagonal offset':'Copied layer directly above');$('height').value=rnd(centre().y);updateGrid();};
$('duplicate').onclick=()=>activeImage()?duplicateImage():duplicate(selected(),new THREE.Vector3(number('spacing',.1,10,1),0,0));
function copy(){if(activeImage()){imageClipboard=clone(activeImage());clipboard=[];updateUI();info('Copied image');return;}imageClipboard=null;const list=selected();if(!list.length){info('Select objects to copy');return;}clipboard=clone(list);pasteIndex=0;updateUI();info(`Copied ${clipboard.length} objects`);}
function paste(){if(imageClipboard){duplicateImage(imageClipboard);return;}if(!clipboard.length){info('Copy a selection first');return;}const step=number('spacing',.1,10,1);pasteIndex++;duplicate(clipboard,new THREE.Vector3(pasteIndex*step,0,pasteIndex*step),`Pasted ${clipboard.length} objects`);}
$('copy').onclick=copy;$('paste').onclick=paste;
function remove(){if(activeImage()){deleteImage();return;}const removable=new Set(selected().map(a=>a.id));if(!removable.size)return;const count=removable.size;commit(()=>{atoms=atoms.filter(a=>!removable.has(a.id));selection.clear();},`Deleted ${count} objects`);}$('delete').onclick=remove;
$('select-all').onclick=()=>{activeImageId=null;selection=new Set(atoms.filter(matchesSelection).map(a=>a.id));sync();info(`Selected ${selection.size} objects`,false);};$('clear-selection').onclick=()=>{activeImageId=null;selection.clear();sync();};
$('selected-surface').onchange=e=>{if(e.target.value!=='mixed')$('selected-shininess').value=presetShine(e.target.value);};
$('apply-appearance').onclick=()=>{const list=selected();if(!list.length)return;const material=$('selected-material').value.trim(),rename=!!material||list.every(a=>materialName(a)===materialName(list[0])),surface=$('selected-surface').value,shininess=$('selected-shininess').value.trim()?number('selected-shininess',0,100,70):null;commit(()=>list.forEach(a=>{if(rename)a.material=material;if(surface!=='mixed')a.surface=surface;if(shininess!==null)a.shininess=shininess;}),'Material and surface applied');};
$('selection-legend').onclick=()=>{const list=selected();if(!list.length)return;const state=annotations.getState(),entries=new Map(state.entries.map(e=>[e.label,e]));for(const a of list){const label=materialName(a)||'Material';entries.set(label,{label,kind:a.kind||'atom',color:a.color,surface:surfaceOf(a),shininess:shineOf(a)});}if(entries.size>12){info('The legend supports 12 entries. Remove an unused label first.');return;}commit(()=>annotations.setState({...state,enabled:true,entries:[...entries.values()]}),'Selection added to legend');};
function recolour(color){if(!selection.size)return;commit(()=>selected().forEach(a=>a.color=color),`Recoloured ${selection.size} objects`);}$('recolour').onclick=()=>recolour($('colour').value);$('selected-colour').onchange=e=>recolour(e.target.value);
$('selected-radius').onchange=()=>{const list=selected();if(!list.length||!$('selected-radius').value.trim()){updateUI();return;}const size=number('selected-radius',list.every(isCarbon)?.05:.1,10,1);commit(()=>list.forEach(a=>{const scale=size/objectSize(a);if(a.dimensions)a.dimensions=a.dimensions.map(v=>Math.min(size,Math.max(1e-8,v*scale)));a.r=internalSize(size,a.kind||'atom');}),'Full object size updated');};
$('selected-kind').onchange=e=>{const kind=e.target.value;if(kind==='mixed')return;const list=selected();if(kind==='atom'&&list.some(a=>objectSize(a)<.1)){info('Spheres need a full size of at least 0.1. Increase the cube size first.');updateUI();return;}commit(()=>list.forEach(a=>{if(kind===(a.kind||'atom'))return;const size=objectSize(a);a.kind=kind;a.r=internalSize(size,kind);delete a.dimensions;}),'Structure type changed at the same full size');};
$('selected-visible').onchange=e=>{const value=e.target.checked;commit(()=>selected().forEach(a=>a.visible=value),value?'Selection shown':'Selection hidden');};
for(const axis of['x','y','z'])$('pos-'+axis).onchange=()=>{const value=number('pos-'+axis,-100,100,0),delta=value-centre()[axis];if(selected().some(a=>Math.abs(a[axis]+delta)>100)){info('Keep object positions between −100 and 100');updateUI();return;}commit(()=>selected().forEach(a=>a[axis]=rnd(a[axis]+delta)),'Position updated');};
function doUndo(){if(drag||annotations.isDragging()||!undo.length)return;redo.push(snapshot());restore(undo.pop());dirty=true;info('Undone',false);}function doRedo(){if(drag||annotations.isDragging()||!redo.length)return;undo.push(snapshot());restore(redo.pop());dirty=true;info('Redone',false);}$('undo').onclick=doUndo;$('redo').onclick=doRedo;
function updateMoveHUD(){if(drag?.kind==='image-resize'){const image=images.find(a=>a.id===drag.imageId);$('move-plane').textContent='Resize in image plane';$('move-snap').textContent=drag.lockAspect?'Keep proportions':'Free proportions';$('move-coordinates').textContent=image?`Width ${rnd(image.width)} · Height ${rnd(image.height)} · Shift switches proportions`:'';return;}const list=movementItems(),p=centre(list),plane=$('plane').value,step=Number($('snap').value),hidden=list.filter(a=>a.visible===false).length;$('move-plane').textContent=drag?.kind==='axis'?`Moving ${drag.axis.toUpperCase()} only`:drag?.kind==='spawn'?`Drop on ${drag.spec.plane==='screen'?'X/Z':drag.spec.plane.toUpperCase().split('').join('/')} grid`:`Body drag: ${plane==='screen'?'screen plane':plane.toUpperCase().split('').join('/')+' plane'}`;$('move-coordinates').textContent=list.length?`X ${rnd(p.x)} · Y ${rnd(p.y)} · Z ${rnd(p.z)}${hidden?` · ${hidden} hidden`:''}`:'Select an object for axis arrows';$('move-snap').textContent=`Step ${step||'free'}`;document.querySelectorAll('[data-nudge]').forEach(b=>b.title=`Move ${b.dataset.nudge.toUpperCase()} by ${step||.25} unit`);}
for(const button of document.querySelectorAll('[data-nudge]'))button.onclick=()=>{if(drag||!movementItems().length)return;const axis=button.dataset.nudge,delta=(Number($('snap').value)||.25)*Number(button.dataset.sign);if(movementItems().some(a=>Math.abs(a[axis]+delta)>100)){info('Keep positions between −100 and 100');return;}commit(()=>movementItems().forEach(a=>a[axis]=rnd(a[axis]+delta)),`Moved ${axis.toUpperCase()} by ${delta}`);};
function setTool(value){tool=value;document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===value));renderer.domElement.style.cursor=value==='place'||value==='box'?'crosshair':value==='orbit'?'grab':'default';$('canvas-tip').textContent={select:'Drag coloured arrows for one axis · Drag a body on the shown plane · Empty space rotates',place:'Click the dots to place the chosen type · Move shows axis arrows',box:'Drag a rectangle to select objects · Shift adds to the selection',orbit:'Drag to rotate · Right-drag to pan · Scroll to zoom'}[value];updateMoveHUD();}document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
function pickRay(e){const rect=renderer.domElement.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(mouse,camera);return rect;}
function dragPlane(point){const value=$('plane').value,normal=value==='xz'?new THREE.Vector3(0,1,0):value==='xy'?new THREE.Vector3(0,0,1):value==='yz'?new THREE.Vector3(1,0,0):camera.getWorldDirection(new THREE.Vector3());return new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point);}
function intersection(plane){if(Math.abs(raycaster.ray.direction.dot(plane.normal))<.04)return null;const p=raycaster.ray.intersectPlane(plane,new THREE.Vector3());return p&&p.length()<180?p:null;}
function snapValue(value){const step=Number($('snap').value);return step?rnd(Math.round(value/step)*step):rnd(value);}
function placementPoint(e,spec){pickRay(e);const plane=spec.plane==='xy'?new THREE.Plane(new THREE.Vector3(0,0,1),0):spec.plane==='yz'?new THREE.Plane(new THREE.Vector3(1,0,0),0):new THREE.Plane(new THREE.Vector3(0,1,0),-spec.height),p=intersection(plane);if(!p)return null;const snapped=v=>spec.snap?rnd(Math.round(v/spec.snap)*spec.snap):rnd(v);if(spec.plane==='xy'){p.x=snapped(p.x);p.y=rnd(spec.height+snapped(p.y-spec.height));}else if(spec.plane==='yz'){p.z=snapped(p.z);p.y=rnd(spec.height+snapped(p.y-spec.height));}else{p.x=snapped(p.x);p.z=snapped(p.z);p.y=spec.height;}return p;}
function freezeOrbit(){const damping=orbit.enableDamping,position=camera.position.clone(),target=orbit.target.clone(),zoom=camera.zoom;orbit.enableDamping=false;orbit.update();camera.position.copy(position);camera.zoom=zoom;orbit.target.copy(target);camera.updateProjectionMatrix();orbit.update();camera.updateMatrixWorld();orbit.enableDamping=damping;orbit.enabled=false;}
function moveBy(delta){
  if(['x','y','z'].some(k=>!Number.isFinite(delta[k])))return;
  if(drag.original.some(a=>['x','y','z'].some(k=>Math.abs(a[k]+delta[k])>100)))return;
  const originals=new Map(drag.original.map(a=>[a.id,a])),moved=[],movedById=new Map();
  for(const a of [...atoms,...images]){
    const original=originals.get(a.id);if(!original||isLocked(a))continue;
    for(const axis of['x','y','z'])a[axis]=rnd(original[axis]+delta[axis]);
    meshes.get(a.id)?.position.set(a.x,a.y,a.z);moved.push(a);movedById.set(a.id,a);
  }
  sphereBatches.move(moved.filter(a=>typeof a.id==='number'));imagePlanes.updateTransforms(images);linkedViews?.update();
  for(const outline of outlines.children){const a=movedById.get(outline.userData.id);if(a)outline.position.set(a.x,a.y,a.z);}
  drag.changed=delta.lengthSq()>.000001;updateMoveHUD();if(activeImage())imageControls?.update();else for(const axis of['x','y','z'])$('pos-'+axis).value=rnd(centre()[axis]);
}
function imageResizeIntersection(plane){
  if(!plane||Math.abs(raycaster.ray.direction.dot(plane.normal))<.06)return null;
  const point=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
  return point&&['x','y','z'].every(axis=>Number.isFinite(point[axis]))?point:null;
}
function beginImageResize(event,handle){
  if(event.button!==0||drag||clean||exporting||imageImporting||tool!=='select'||annotations.isDragging()||!activeImage()?.visible||isLocked(activeImage())||activeImage().opacity<=0)return;
  event.preventDefault();event.stopImmediatePropagation();renderer.domElement.focus({preventScroll:true});
  const image=activeImage();if(!image)return;const before=snapshot();freezeOrbit();pickRay(event);
  const plane=imageResizePlane(image),start=imageResizeIntersection(plane),session=start&&createImageResize(image,handle,start);
  if(!session){orbit.enabled=true;info('The image is nearly edge-on. Rotate the view or use Face current view before resizing.');return;}
  const lockAspect=$('image-lock-aspect').checked!==!!event.shiftKey;
  drag={kind:'image-resize',pointer:event.pointerId,imageId:image.id,handle,session,before,originalImage:{width:image.width,height:image.height,x:image.x,y:image.y,z:image.z},changed:false,lockAspect};
  renderer.domElement.setPointerCapture(event.pointerId);renderer.domElement.style.cursor=event.currentTarget?.style.cursor||'nwse-resize';updateMoveHUD();
}
function resizeImageFromPointer(event){
  pickRay(event);const point=imageResizeIntersection(drag.session.plane);if(!point)return;
  drag.lockAspect=$('image-lock-aspect').checked!==!!event.shiftKey;
  const image=images.find(a=>a.id===drag.imageId),next=drag.session.resize(point,{lockAspect:drag.lockAspect});if(!image||isLocked(image)||!next)return;
  Object.assign(image,next);drag.changed=Object.keys(next).some(key=>Math.abs(next[key]-drag.originalImage[key])>1e-8);
  imagePlanes.updateTransforms(images);linkedViews?.update();imageControls?.update({normalizeNumbers:true});updateMoveHUD();
}
const suppressedClicks=new Set();
for(const[id,layer]of[['add',false],['array',true]]){
  const button=$(id);button.style.touchAction='none';
  button.addEventListener('click',e=>{if(suppressedClicks.has(button)){suppressedClicks.delete(button);e.preventDefault();e.stopImmediatePropagation();}},true);
  button.addEventListener('pointerdown',e=>{if(e.button!==0||drag||annotations.isDragging())return;suppressedClicks.delete(button);const spec=creationSpec(layer);if(!capacity(spec.cols*spec.rows))return;drag={kind:'spawn',pointer:e.pointerId,button,startX:e.clientX,startY:e.clientY,spec,started:false,anchor:null,valid:false};button.setPointerCapture(e.pointerId);});
  button.addEventListener('lostpointercapture',e=>{if(drag?.kind==='spawn'&&drag.pointer===e.pointerId)finishSpawn(e,true);});
}
function finishSpawn(e,cancel=false){if(drag?.kind!=='spawn'||e.pointerId!==drag.pointer)return;const current=drag;drag=null;orbit.enabled=true;movement.hidePreview();if(current.button.hasPointerCapture(e.pointerId))current.button.releasePointerCapture(e.pointerId);if(current.started||cancel){suppressedClicks.add(current.button);setTimeout(()=>suppressedClicks.delete(current.button),500);}if(!cancel&&current.started&&current.valid&&current.anchor)finishCreation(current.spec,current.anchor);else if(!cancel&&current.started)info('Placement cancelled. Release inside a view facing the chosen grid plane.');updateMoveHUD();}
document.addEventListener('pointermove',e=>{if(drag?.kind!=='spawn'||e.pointerId!==drag.pointer)return;if(!drag.started&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<6)return;if(!drag.started){drag.started=true;if(clean)toggleClean();freezeOrbit();}const rect=renderer.domElement.getBoundingClientRect(),inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;drag.anchor=inside?placementPoint(e,drag.spec):null;drag.valid=false;if(drag.anchor){const list=creationDraft(drag.spec,drag.anchor);drag.valid=draftValid(list);movement.showPreview(list,drag.spec.kind==='carbon'?carbonGeometry:geometry,drag.valid);$('move-coordinates').textContent=`Preview X ${rnd(drag.anchor.x)} · Y ${rnd(drag.anchor.y)} · Z ${rnd(drag.anchor.z)}${drag.valid?'':' · Outside workspace'}`;}else{movement.hidePreview();$('move-coordinates').textContent=inside?'Grid plane is edge-on. Change the view before dragging.':'Drag into the view · Escape cancels';}$('move-plane').textContent=`Drop on ${drag.spec.plane==='screen'?'X/Z':drag.spec.plane.toUpperCase().split('').join('/')} grid${drag.spec.plane==='xz'||drag.spec.plane==='screen'?` at Y ${drag.spec.height}`:''}`;},true);
document.addEventListener('pointerup',e=>finishSpawn(e),true);document.addEventListener('pointercancel',e=>finishSpawn(e,true),true);
renderer.domElement.addEventListener('pointerdown',e=>{
  if(e.button!==0||drag||tool==='orbit')return;const rect=pickRay(e);
  if(tool==='select'&&!clean){movement.update(camera,movementItems().filter(a=>a.visible!==false),true);const handle=movement.pick(raycaster);if(handle){e.stopImmediatePropagation();freezeOrbit();pickRay(e);const normal=camera.getWorldDirection(new THREE.Vector3());normal[handle.axis]=0;if(normal.lengthSq()<.001){orbit.enabled=true;info('Use this axis’s − / ＋ buttons, or rotate the view');return;}const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(),handle.origin),start=intersection(plane);if(!start){orbit.enabled=true;info('Use this axis’s − / ＋ buttons, or rotate the view');return;}renderer.domElement.focus({preventScroll:true});renderer.domElement.setPointerCapture(e.pointerId);drag={kind:'axis',axis:handle.axis,plane,start,pointer:e.pointerId,before:snapshot(),original:movementItems().map(a=>({...a})),snap:Number($('snap').value),changed:false};movement.setActive(handle.axis);updateMoveHUD();return;}}
  if(tool==='box'){e.stopImmediatePropagation();orbit.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);drag={kind:'box',pointer:e.pointerId,x:e.clientX-rect.left,y:e.clientY-rect.top,shift:e.shiftKey};$('marquee').hidden=false;Object.assign($('marquee').style,{left:`${drag.x}px`,top:`${drag.y}px`,width:'0px',height:'0px'});return;}
  if(tool==='place'){e.stopImmediatePropagation();const p=placementPoint(e,creationSpec());if(!p){info('Choose a view facing the placement plane');return;}if(['x','y','z'].some(k=>Math.abs(p[k])>100))return;if(atoms.some(a=>Math.abs(a.x-p.x)<.02&&Math.abs(a.y-p.y)<.02&&Math.abs(a.z-p.z)<.02)){info('There is already an object at that point');return;}addAt(p);setTool('place');return;}
  const hit=raycaster.intersectObjects([...atomGroup.children,...imagePlanes.meshes()],false)[0];if(!hit){drag={kind:'empty',pointer:e.pointerId,startX:e.clientX,startY:e.clientY,shift:e.shiftKey};return;}
  e.stopImmediatePropagation();renderer.domElement.focus({preventScroll:true});const imageId=hit.object.userData.imageId,id=pickedObjectId(hit),picked=imageId?images.find(a=>a.id===imageId):atoms.find(a=>a.id===id);if(!picked)return;if(isLocked(picked)){showLockedMessage();return;}if(imageId){activeImageId=imageId;selection.clear();}else activeImageId=null;if(!imageId&&e.shiftKey){selection.has(id)?selection.delete(id):selection.add(id);sync();return;}
  const anchor=new THREE.Vector3(picked.x,picked.y,picked.z);
  if(!imageId&&!selection.has(id))selection=new Set([id]);sync();const plane=dragPlane(anchor),start=intersection(plane);if(!start){info('This plane is edge-on. Change the view or use position fields.');return;}
  freezeOrbit();renderer.domElement.setPointerCapture(e.pointerId);drag={kind:'move',pointer:e.pointerId,start,plane,planeValue:$('plane').value,snap:Number($('snap').value),before:snapshot(),anchor,original:movementItems().map(a=>({...a})),changed:false};updateMoveHUD();
},true);
renderer.domElement.addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pointer)return;if(drag.kind==='image-resize'){resizeImageFromPointer(e);return;}if(drag.kind==='axis'){pickRay(e);const p=intersection(drag.plane);if(!p)return;let amount=p.sub(drag.start)[drag.axis];if(drag.snap)amount=Math.round(amount/drag.snap)*drag.snap;const delta=new THREE.Vector3();delta[drag.axis]=amount;moveBy(delta);return;}if(drag.kind==='box'){const rect=renderer.domElement.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;Object.assign($('marquee').style,{left:`${Math.min(x,drag.x)}px`,top:`${Math.min(y,drag.y)}px`,width:`${Math.abs(x-drag.x)}px`,height:`${Math.abs(y-drag.y)}px`});return;}if(drag.kind!=='move')return;pickRay(e);const p=intersection(drag.plane);if(!p)return;const delta=p.sub(drag.start),plane=drag.planeValue;for(const axis of['x','y','z']){if((plane==='xz'&&axis==='y')||(plane==='xy'&&axis==='z')||(plane==='yz'&&axis==='x'))delta[axis]=0;else if(plane!=='screen'&&drag.snap)delta[axis]=rnd(Math.round((drag.anchor[axis]+delta[axis])/drag.snap)*drag.snap)-drag.anchor[axis];}moveBy(delta);
},true);
function finishPointer(e,cancel=false){if(!drag||e.pointerId!==drag.pointer)return;const current=drag;drag=null;orbit.enabled=true;if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);movement.setActive(null);if(current.kind==='image-resize'){if(cancel){restore(current.before);setTool(tool);return;}if(current.changed){undo.push(current.before);if(undo.length>60)undo.shift();redo=[];dirty=true;info('Image resized · Undo restores the previous size and position',false);}sync();setTool(tool);return;}if(current.kind==='move'||current.kind==='axis'){if(cancel){restore(current.before);return;}if(current.changed){undo.push(current.before);if(undo.length>60)undo.shift();redo=[];dirty=true;info(activeImage()?'Image moved':`Moved ${selection.size} objects`,false);}sync();}else if(current.kind==='box'){$('marquee').hidden=true;if(cancel)return;const rect=renderer.domElement.getBoundingClientRect(),endX=e.clientX-rect.left,endY=e.clientY-rect.top,minX=Math.min(current.x,endX),maxX=Math.max(current.x,endX),minY=Math.min(current.y,endY),maxY=Math.max(current.y,endY);activeImageId=null;if(!current.shift)selection.clear();camera.updateMatrixWorld();for(const a of atoms){const p=new THREE.Vector3(a.x,a.y,a.z).project(camera),x=(p.x+1)/2*rect.width,y=(1-p.y)/2*rect.height;if(a.visible!==false&&matchesSelection(a)&&p.z>=-1&&p.z<=1&&x>=minX&&x<=maxX&&y>=minY&&y<=maxY)selection.add(a.id);}sync();info(`Selected ${selection.size} objects`,false);}else if(current.kind==='empty'&&!cancel&&Math.hypot(e.clientX-current.startX,e.clientY-current.startY)<4&&!current.shift){activeImageId=null;selection.clear();sync();}}
renderer.domElement.addEventListener('pointerup',e=>finishPointer(e),true);renderer.domElement.addEventListener('pointercancel',e=>finishPointer(e,true),true);renderer.domElement.addEventListener('lostpointercapture',e=>{if(drag?.pointer===e.pointerId)finishPointer(e,true);});renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
function toggleClean(){clean=!clean;document.body.classList.toggle('clean',clean);$('clean').classList.toggle('active',clean);$('clean').textContent=clean?'◉ Edit view':'◉ Clean view';outlines.visible=!clean;updateGrid();updateMoveHUD();applyBackground();}$('clean').onclick=toggleClean;
function applyBackground(){scene.background=$('background').value==='dark'?new THREE.Color('#172b38'):clean?new THREE.Color('#ffffff'):null;}$('background').onchange=applyBackground;
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
async function exportSceneImage(fileName){
  $('export').disabled=true;exporting=true;
  const w=viewport.clientWidth,h=viewport.clientHeight,ratio=renderer.getPixelRatio(),oldBackground=scene.background,gridVisible=guides.visible,outlinesVisible=outlines.visible;
  const oldClear=renderer.getClearColor(new THREE.Color()),oldAlpha=renderer.getClearAlpha(),oldAutoClear=renderer.autoClear;
  try{
    imageResizeHandles.hide();await imagePlanes.ready();guides.visible=false;outlines.visible=false;imagePlanes.setEditingVisible(false);movement.visibility(false);
    const width=Number($('resolution').value),sceneHeight=Math.round(width*h/w),footerHeight=annotations.getExportHeight(width),height=sceneHeight+footerHeight;
    const transparent=$('background').value==='transparent',dark=$('background').value==='dark',background=dark?'#172b38':'#ffffff';
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.setViewport(0,0,width,height);renderer.setScissorTest(false);
    renderer.setClearColor(background,transparent?0:1);renderer.autoClear=false;renderer.clear();
    scene.background=transparent?null:new THREE.Color(background);
    renderer.setViewport(0,footerHeight,width,sceneHeight);renderer.setScissor(0,footerHeight,width,sceneHeight);renderer.setScissorTest(true);
    renderer.render(scene,camera);
    renderer.setScissorTest(false);renderer.setViewport(0,0,width,height);
    annotations.render(renderer,{dark,clean:true,exporting:true});
    const blob=await new Promise(resolve=>renderer.domElement.toBlob(resolve,'image/png'));
    if(!blob)throw new Error('Image generation failed');
    download(blob,fileName);info('Saved '+fileName+' · '+width+' × '+height+' px');
  }catch{info('The image could not be exported. Try a smaller width.');}
  finally{
    exporting=false;scene.background=oldBackground;guides.visible=gridVisible;outlines.visible=outlinesVisible;
    renderer.autoClear=oldAutoClear;renderer.setClearColor(oldClear,oldAlpha);renderer.setScissorTest(false);renderer.setPixelRatio(ratio);renderer.setSize(w,h);renderer.setViewport(0,0,w,h);renderFrame();$('export').disabled=false;
  }
}
function saveSceneFile(fileName){const payload={format:'atom-studio',version:7,images:clone(images),atoms:atoms.map(({id,...a})=>a),annotations:annotations.getState(),settings:{...creationAppearance(),objectKind:$('object-kind').value,colour:$('colour').value,radius:creationRadius(),height:Number($('height').value),spacing:Number($('spacing').value),packing:$('packing').value,alignment:$('alignment').value,layerRise:Number($('layer-rise').value),snap:$('snap').value,plane:$('plane').value},view:{type:activeView,perspective:!!camera.isPerspectiveCamera,position:camera.position.toArray(),target:orbit.target.toArray(),zoom:camera.zoom}};let json=JSON.stringify(payload,null,2);if(new Blob([json]).size>STRUCTURE_FILE_LIMIT)json=JSON.stringify(payload);if(new Blob([json]).size>STRUCTURE_FILE_LIMIT){info('This diagram exceeds the 8 MB file limit. Remove an image or reduce the scene before saving.');return;}download(new Blob([json],{type:'application/json'}),fileName);dirty=false;info('Saved '+fileName);}

function showDownloadDialog(kind){
  if(exporting||$('download-dialog').open)return;
  pendingDownload=kind;
  $('download-title').textContent=kind==='scene'?'Save editable structure':'Export image';
  $('download-extension').textContent=kind==='scene'?'.json':'.png';
  $('download-hint').textContent=kind==='scene'?'Save a file you can open and continue editing.':'The exported legend appears below the diagram, with up to five materials per row.';
  $('download-submit').textContent=kind==='scene'?'Save file':'Export PNG';
  $('download-name').value=downloadNames[kind];$('download-dialog').showModal();$('download-name').select();
}
$('save').onclick=()=>showDownloadDialog('scene');
$('export').onclick=()=>showDownloadDialog('image');
$('download-cancel').onclick=()=>$('download-dialog').close();
$('download-dialog').addEventListener('close',()=>pendingDownload=null);
$('download-form').onsubmit=async e=>{
  e.preventDefault();const kind=pendingDownload;if(!kind)return;
  const {baseName,fileName}=normalizeDownloadName($('download-name').value,kind==='scene'?'json':'png');
  if(kind==='scene'&&downloadNames.image===downloadNames.scene)downloadNames.image=baseName;downloadNames[kind]=baseName;$('download-dialog').close();scheduleAutosave();
  if(kind==='scene')saveSceneFile(fileName);else await exportSceneImage(fileName);
};
$('open').onclick=()=>$('file-input').click();
function validateAtom(a){validateAppearance(a||{});validateLock(a||{});if(!a||['x','y','z'].some(k=>typeof a[k]!=='number'||!Number.isFinite(a[k])||Math.abs(a[k])>100)||typeof a.r!=='number'||!Number.isFinite(a.r)||a.r<.05||a.r>(isCarbon(a)?10:5)||!/^#[0-9a-f]{6}$/i.test(a.color))throw new Error('Invalid atom');if(a.kind!==undefined&&!['atom','carbon'].includes(a.kind))throw new Error('Invalid type');if(a.dimensions!==undefined&&(!isCarbon(a)||!Array.isArray(a.dimensions)||a.dimensions.length!==3||a.dimensions.some(v=>!Number.isFinite(v)||v<=0||v>a.r+.00001)))throw new Error('Invalid block dimensions');if(a.visible!==undefined&&typeof a.visible!=='boolean')throw new Error('Invalid visibility');return a;}
$('file-input').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>STRUCTURE_FILE_LIMIT)throw new Error('File too large');const payload=JSON.parse(await file.text());if(payload.format!=='atom-studio'||![1,2,3,4,5,6,7].includes(payload.version)||!Array.isArray(payload.atoms)||payload.atoms.length>LIMIT)throw new Error('Invalid structure');payload.atoms.forEach(validateAtom);const list=payload.atoms.map(a=>({...makeAtom(a.x,a.y,a.z,a.color,a.r,a.kind||'atom',a.dimensions,appearanceOf(a)),...validateLock(a),...(a.visible!==undefined?{visible:a.visible}:{})}));if(payload.version===2&&payload.materials)list.push(...legacyBlocks(payload.materials,makeAtom));if(list.length>LIMIT)throw new Error('Scene exceeds the limit');list.forEach(validateAtom);const importedImages=validateImagePlanes(payload.images),legend=validateAnnotations(payload.annotations),s=payload.settings||{};validateAppearance(s);for(const a of list)if(a.material===undefined){const entry=legend.entries.find(e=>e.kind===(a.kind||'atom')&&e.color.toLowerCase()===a.color.toLowerCase());if(entry)a.material=entry.label;}commit(()=>{atoms=list;images=importedImages;activeImageId=null;annotations.setState(legend);selection.clear();},`Opened ${list.length} objects${images.length?' and '+images.length+' images':''} — Undo restores the previous scene`);chooseKind(s.objectKind==='carbon'?'carbon':'atom');if(/^#[0-9a-f]{6}$/i.test(s.colour))setColour(s.colour);$('material-name').value=s.material||'';$('surface').value=s.surface||(s.objectKind==='carbon'?'grain':'smooth');$('shininess').value=s.shininess??(s.objectKind==='carbon'?0:70);$('filter-colour').value='all';$('filter-material').value='all';if(Number.isFinite(s.radius)){const stored=Math.max(.05,Math.min(s.objectKind==='carbon'?10:5,s.radius));$('radius').value=s.objectKind==='carbon'?stored:rnd(stored*2);}for(const[key,id,min,max]of[['height','height',-100,100],['spacing','spacing',.1,10],['layerRise','layer-rise',.1,20]])if(Number.isFinite(s[key]))$(id).value=Math.max(min,Math.min(max,s[key]));for(const[key,id]of[['packing','packing'],['alignment','alignment'],['snap','snap']])if([...$(id).options].some(o=>o.value===String(s[key])))$(id).value=s[key];const v=payload.view;view(['iso','front','top','side'].includes(v?.type)?v.type:'iso');if(v&&[v.position,v.target].every(a=>Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000))){$('perspective').checked=!!v.perspective;camera=v.perspective?perspective:orthographic;camera.position.fromArray(v.position);camera.zoom=typeof v.zoom==='number'&&Number.isFinite(v.zoom)&&v.zoom>0&&v.zoom<=10000?v.zoom:1;setupOrbit(new THREE.Vector3(...v.target));resize();}if([...$('plane').options].some(o=>o.value===s.plane))$('plane').value=s.plane;updateUI();updateGrid();updateMoveHUD();const openedName=normalizeDownloadName(file.name,'json').baseName;downloadNames={scene:openedName,image:openedName};scheduleAutosave();dirty=false;}catch(error){info(error.message==='File too large'?'This structure file exceeds the 8 MB limit.':'Could not open this Atom Studio JSON file. '+error.message);}finally{e.target.value='';}};
$('help').onclick=()=>$('help-dialog').showModal();document.querySelector('.dialog-close').onclick=()=>$('help-dialog').close();$('help-dialog').onclick=e=>{if(e.target===$('help-dialog')){const r=$('help-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('help-dialog').close();}};
document.addEventListener('keydown',e=>{if(($('download-dialog').open||lockingControls?.isOpen())&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return;}if(e.key==='Escape'&&drag){e.preventDefault();if(drag.kind==='linked'){linkedViews?.cancel();return;}if(drag.kind==='spawn')finishSpawn({pointerId:drag.pointer},true);else finishPointer({pointerId:drag.pointer},true);return;}if(drag||annotations.isDragging()||e.target.matches('input,select,textarea')||$('help-dialog').open||$('download-dialog').open||lockingControls?.isOpen())return;const key=e.key.toLowerCase(),command=e.ctrlKey||e.metaKey;if(command&&['a','c','v','d','z','y','s'].includes(key)){e.preventDefault();if(key==='a')$('select-all').click();if(key==='c')copy();if(key==='v')paste();if(key==='d')$('duplicate').click();if(key==='z')e.shiftKey?doRedo():doUndo();if(key==='y')doRedo();if(key==='s')$('save').click();return;}if(key==='delete'||key==='backspace'){e.preventDefault();remove();}if(key==='escape'){activeImageId=null;selection.clear();sync();setTool('select');}if(key==='v')setTool('select');if(key==='a')setTool('place');if(key==='b')setTool('box');if(key==='o')setTool('orbit');if(key==='f')fit();if(key==='g')toggleClean();if(key==='?')$('help').click();});
window.addEventListener('beforeunload',e=>{const saved=autosave?.flush();if(dirty&&!saved){e.preventDefault();e.returnValue='';}});renderer.setAnimationLoop(()=>{if(exporting)return;if(!drag||drag.kind==='empty'||(drag.kind==='spawn'&&!drag.started))orbit.update();renderFrame();});
function validateBrowserWorkspace(raw){
  if(!raw||!raw.state||!Array.isArray(raw.state.atoms)||raw.state.atoms.length>LIMIT||!Array.isArray(raw.state.selection)||raw.state.selection.length>LIMIT)throw new Error('Invalid saved workspace');
  const ids=new Set();for(const a of raw.state.atoms){validateAtom(a);if(!Number.isSafeInteger(a.id)||a.id<1||ids.has(a.id))throw new Error('Invalid saved object ID');ids.add(a.id);}
  const result=clone(raw);result.state.images=validateImagePlanes(raw.state.images);result.state.activeImageId=validateActiveImageId(raw.state.activeImageId,result.state.images);result.downloadNames=normalizeDownloadNames(raw.downloadNames);result.state.annotations=validateAnnotations(raw.state.annotations);result.state.selection=raw.state.selection.filter(id=>ids.has(id));
  if(!raw.fields||workspaceFields.some(id=>typeof raw.fields[id]!=='string'||raw.fields[id].length>64)||typeof raw.grid!=='boolean'||!['atom','carbon'].includes(raw.lastKind)||!raw.styles)throw new Error('Invalid saved controls');
  for(const kind of['atom','carbon']){const style=raw.styles[kind];if(!style||!/^#[0-9a-f]{6}$/i.test(style.color))throw new Error('Invalid saved colour');validateAppearance(style);}
  for(const id of workspaceFields){const field=$(id),value=raw.fields[id];if(id.startsWith('filter-'))continue;if(field.tagName==='SELECT'&&![...field.options].some(o=>o.value===value))throw new Error('Invalid saved choice');if(field.type==='number'){const min=id==='radius'?(raw.lastKind==='carbon'?.05:.1):Number(field.min),max=Number(field.max),n=value.trim()!==''&&Number.isFinite(Number(value))?Number(value):Number(field.defaultValue)||min;result.fields[id]=String(Math.max(min,Math.min(max,n)));}}
  if(!/^#[0-9a-f]{6}$/i.test(raw.fields.colour)||raw.fields['material-name'].length>48||raw.fields['filter-material'].length>48)throw new Error('Invalid saved material');
  const v=raw.view;if(!v||!['iso','front','top','side'].includes(v.type)||typeof v.perspective!=='boolean'||typeof v.clean!=='boolean'||![v.position,v.target].every(a=>Array.isArray(a)&&a.length===3&&a.every(n=>Number.isFinite(n)&&Math.abs(n)<=1500))||!Number.isFinite(v.zoom)||v.zoom<=0||v.zoom>10000)throw new Error('Invalid saved view');
  return result;
}
autosave=createBrowserAutosave({
  key:JSON.stringify(['atom-studio-standalone-autosave-v1',new URL('.',import.meta.url).pathname]),
  readState:captureWorkspace,
  validateState:saved=>{try{return validateBrowserWorkspace(saved);}catch(error){console.warn('Browser autosave validation:',error.message);throw error;}},
  applyState:workspace=>{autosaveSuspended=true;try{restoreWorkspace(workspace);undo=[];redo=[];dirty=false;}finally{autosaveSuspended=false;}},
  onStatus:(status,savedAt)=>{const field=$('autosave-status');field.dataset.state=status;field.textContent=({saving:'Saving in browser…',saved:'Saved in this browser',restored:'Browser save restored',unavailable:'Autosave unavailable · use Save',invalid:'Browser save could not be restored',conflict:'Autosave paused · another tab saved'})[status]||'Browser autosave on';field.title=status==='conflict'?'Another tab saved newer work. Download Save to keep this tab’s diagram before refreshing.':status==='unavailable'||status==='invalid'?'Browser storage is unavailable or the saved data could not be read. Save downloads a permanent diagram file.':'Stored only in this browser on this device. Clearing browser data removes it. Save downloads a permanent backup.'+(savedAt?' Last saved: '+new Date(savedAt).toLocaleString():'');}
});
lockingControls=mountLockingControls({document,getItems:()=>[...atoms,...images],getSelection:movementItems,canEdit:canEditScene,onLock:lockSelection,onUnlock:unlockSet,onInfo:info});lockingControls.update();
linkedViews=createLinkedViews({document,scene,getBounds:bounds,getPickObjects:()=>[...atomGroup.children,...imagePlanes.meshes()],getAtoms:()=>atoms,getImages:()=>images,getSelection:()=>selection,getActiveImage:activeImage,getSnap:()=>Number($('snap').value),canEdit:()=>canEditScene()&&!lockingControls.isOpen()&&!$('download-dialog').open,onInfo:info,
  onSelect:hit=>{if(!hit){selection.clear();activeImageId=null;sync();return;}if(hit.kind==='image'){selectImage(hit.id);return;}activeImageId=null;if(hit.additive){selection.has(hit.id)?selection.delete(hit.id):selection.add(hit.id);}else if(!hit.preserveSelected||!selection.has(hit.id))selection=new Set([hit.id]);setTool('select');sync();},
  onBeginMove:({view,items})=>{if(!canEditScene()||items.some(isLocked))return false;const before=snapshot();freezeOrbit();drag={kind:'linked',view,before,original:items.map(item=>({...item})),changed:false};return true;},
  onMove:delta=>{if(drag?.kind!=='linked')return false;moveBy(delta);return true;},
  onEndMove:({cancel,changed})=>{if(drag?.kind!=='linked')return;const current=drag;drag=null;orbit.enabled=true;if(cancel){restore(current.before);return;}if(changed&&current.changed){undo.push(current.before);if(undo.length>60)undo.shift();redo=[];dirty=true;info('Moved in linked view · Undo restores the previous position',false);}sync();},
  renderScene:(auxRenderer,auxCamera)=>{const oldGuides=guides.visible;guides.visible=false;imagePlanes.setEditingVisible(false);try{movement.withHidden(()=>auxRenderer.render(scene,auxCamera));}finally{guides.visible=oldGuides;imagePlanes.setEditingVisible(!clean&&!exporting);}}
});
imageControls=mountImageControls({document,getImages:()=>images,getActive:activeImage,selectImage,commit,onInfo:info,duplicateImage:()=>duplicateImage(),deleteImage,faceView:faceImageView});
$('image-add').onclick=()=>$('image-file').click();$('image-file').onchange=event=>{const file=event.target.files[0];if(file)addImageFile(file);};imageControls.update();
if(autosave.restore())info('Restored your browser autosave');
document.addEventListener('input',e=>{if(e.target.matches('input,select'))scheduleAutosave();});
document.addEventListener('change',e=>{if(e.target.matches('input,select'))scheduleAutosave();});
document.addEventListener('click',e=>{if(e.target.closest('button')&&!e.target.closest('#help-dialog'))scheduleAutosave();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')autosave.flush();});
window.addEventListener('pagehide',()=>autosave.flush());
