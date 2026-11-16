import * as THREE from 'three';
import {pickedObjectId} from './sphere-batches-source.js';
import {isLocked} from './lock-schema-source.js';

// These bases match the existing Front, Top and Side camera directions. Top
// looks from +Y, and Side looks from +X, so their screen-up/right signs differ.
export const LINKED_VIEW_AXES = Object.freeze({
  front:Object.freeze({label:'Front',plane:'XY',right:[1,0,0],up:[0,1,0],normal:[0,0,1],axes:'X → · Y ↑'}),
  top:Object.freeze({label:'Top',plane:'XZ',right:[1,0,0],up:[0,0,-1],normal:[0,1,0],axes:'X → · −Z ↑'}),
  side:Object.freeze({label:'Side',plane:'ZY',right:[0,0,-1],up:[0,1,0],normal:[1,0,0],axes:'−Z → · Y ↑'})
});
const names=Object.keys(LINKED_VIEW_AXES),round=value=>Math.round(value*10000)/10000;
const vector=values=>new THREE.Vector3(...values);
function basis(name){const value=LINKED_VIEW_AXES[name];if(!value)throw new TypeError('Unknown linked view');return value;}

export function linkedViewFit(box,name,aspect,padding=1.18){
  const axes=basis(name),centre=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const projected=direction=>Math.abs(direction[0])*size.x+Math.abs(direction[1])*size.y+Math.abs(direction[2])*size.z;
  return {centre,height:Math.max(projected(axes.up),projected(axes.right)/Math.max(aspect,.01),2)*padding};
}

// Orthographic pointer deltas stay in the chosen plane. Snapping uses the
// clicked object's original position and applies the same offset to its group.
export function linkedDragDelta(name,start,current,frame,anchor,snap=0){
  const axes=basis(name);
  if(![start.x,start.y,current.x,current.y,frame.width,frame.height,frame.spanX,frame.spanY,frame.zoom].every(Number.isFinite)||frame.width<=0||frame.height<=0||frame.zoom<=0)return null;
  const delta=vector(axes.right).multiplyScalar((current.x-start.x)*frame.spanX/frame.width/frame.zoom)
    .addScaledVector(vector(axes.up),-(current.y-start.y)*frame.spanY/frame.height/frame.zoom);
  for(const axis of ['x','y','z']){
    const index={x:0,y:1,z:2}[axis];
    if(axes.normal[index])delta[axis]=0;
    else if(Number.isFinite(snap)&&snap>0)delta[axis]=Math.round((anchor[axis]+delta[axis])/snap)*snap-anchor[axis];
    delta[axis]=round(delta[axis]);
  }
  return delta;
}

// Resolve the nearest visible record before checking its lock. Removing locked
// meshes from picking would incorrectly allow selecting an object behind them.
export function linkedViewHit(hits,atoms,images){
  const atomMap=new Map(atoms.map(item=>[item.id,item])),imageMap=new Map(images.map(item=>[item.id,item]));
  for(const hit of hits){
    if(hit.object.visible===false)continue;
    const imageId=hit.object.userData.imageId;
    const kind=imageId?'image':'atom',id=imageId||pickedObjectId(hit),item=(imageId?imageMap:atomMap).get(id);
    if(item&&item.visible!==false&&(kind!=='image'||item.opacity>0))return {kind,id,item,locked:isLocked(item)};
  }
  return null;
}

export function createLinkedViews({document,scene,getBounds,getPickObjects,getAtoms,getImages,getSelection,getActiveImage,getSnap,canEdit=()=>true,onSelect=()=>{},onBeginMove=()=>{},onMove=()=>{},onEndMove=()=>{},onInfo=()=>{},renderScene=(renderer,camera)=>renderer.render(scene,camera)}){
  const viewport=document.getElementById('viewport'),column=viewport.parentElement,viewButtons=document.querySelector('.view-buttons');
  const toggle=document.createElement('button');toggle.id='linked-views-toggle';toggle.type='button';toggle.textContent='Linked views';toggle.setAttribute('aria-pressed','false');toggle.setAttribute('aria-controls','linked-views-dock');toggle.title='Show linked Front, Top and Side views below the 3D view';viewButtons.append(toggle);
  const dock=document.createElement('section');dock.id='linked-views-dock';dock.className='linked-views-dock';dock.hidden=true;dock.setAttribute('aria-label','Linked editing views');
  const heading=document.createElement('div');heading.className='linked-views-heading';
  const title=document.createElement('strong');title.textContent='Linked views';
  const fitButton=document.createElement('button');fitButton.type='button';fitButton.textContent='Fit all';fitButton.setAttribute('aria-label','Fit all linked views');
  const close=document.createElement('button');close.type='button';close.textContent='Close';close.setAttribute('aria-label','Close linked views');heading.append(title,fitButton,close);
  const scroller=document.createElement('div');scroller.className='linked-views-scroll';
  const stage=document.createElement('div');stage.className='linked-views-stage';
  const labels=document.createElement('div');labels.className='linked-views-labels';
  for(const name of names){
    const definition=basis(name),label=document.createElement('div');
    const text=document.createElement('strong');text.textContent=`${definition.label} · ${definition.plane}`;
    const axes=document.createElement('span');axes.textContent=definition.axes;
    const fit=document.createElement('button');fit.type='button';fit.textContent='Fit';fit.setAttribute('aria-label',`Fit ${definition.label.toLowerCase()} linked view`);fit.addEventListener('click',()=>{fitView(name);invalidate();});
    label.append(text,axes,fit);labels.append(label);
  }
  stage.append(labels);scroller.append(stage);
  const help=document.createElement('p');help.className='linked-views-help';help.textContent='Drag objects in each plane · Shift-click adds · Scroll zooms · Right-drag pans';
  dock.append(heading,scroller,help);viewport.insertAdjacentElement('afterend',dock);

  const cameras=Object.fromEntries(names.map(name=>{
    const camera=new THREE.OrthographicCamera(-6,6,6,-6,.1,2000);camera.up.copy(vector(basis(name).up));
    return [name,{camera,target:new THREE.Vector3(),height:12}];
  }));
  const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();
  let renderer=null,enabled=false,suspended=false,dirty=true,lastRender=-Infinity,width=0,height=0,contentCount='',drag=null,disposed=false;
  function invalidate(){dirty=true;}
  function counts(){return `${getAtoms().filter(item=>item.visible!==false).length}:${getImages().filter(item=>item.visible!==false&&item.opacity>0).length}`;}
  function safeBounds(){const box=getBounds().clone();if(box.isEmpty())box.set(new THREE.Vector3(-3,-2,-3),new THREE.Vector3(3,4,3));return box;}
  function paneSize(){return {width:Math.max(1,width/3),height:Math.max(1,height-28)};}
  function positionCamera(name){const entry=cameras[name],camera=entry.camera,{width:paneWidth,height:paneHeight}=paneSize(),aspect=paneWidth/paneHeight;camera.left=-entry.height*aspect/2;camera.right=entry.height*aspect/2;camera.top=entry.height/2;camera.bottom=-entry.height/2;camera.position.copy(entry.target).addScaledVector(vector(basis(name).normal),600);camera.lookAt(entry.target);camera.updateProjectionMatrix();camera.updateMatrixWorld();}
  function resize(){
    if(!renderer||!enabled||suspended)return;
    const rect=stage.getBoundingClientRect(),nextWidth=Math.max(1,Math.round(rect.width)),nextHeight=Math.max(29,Math.round(rect.height));
    if(nextWidth===width&&nextHeight===height)return;
    width=nextWidth;height=nextHeight;renderer.setSize(width,height,false);for(const name of names)positionCamera(name);invalidate();
  }
  function fitView(name){const {width:paneWidth,height:paneHeight}=paneSize(),fit=linkedViewFit(safeBounds(),name,paneWidth/paneHeight),entry=cameras[name];entry.target.copy(fit.centre);entry.height=fit.height;entry.camera.zoom=1;positionCamera(name);invalidate();}
  function fitAll(){for(const name of names)fitView(name);}
  function ensureRenderer(){
    if(renderer)return true;
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});renderer.setPixelRatio(Math.min(document.defaultView?.devicePixelRatio||1,1.5));renderer.setClearColor('#f5f8fa',1);
      const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Linked front, top and side views. Drag selected objects in a view plane. Use position fields for keyboard movement.');stage.prepend(canvas);
      canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointermove',pointerMove);canvas.addEventListener('pointerup',event=>finish(event,false));canvas.addEventListener('pointercancel',event=>finish(event,true));canvas.addEventListener('lostpointercapture',event=>{if(drag?.pointer===event.pointerId)finish(event,true);});canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('contextmenu',event=>event.preventDefault());canvas.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();cancel();}});
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancel();onInfo('Linked views paused because the graphics context was lost. The main editor and your diagram are still available.');});canvas.addEventListener('webglcontextrestored',invalidate);
      return true;
    }catch(error){renderer?.dispose();renderer=null;onInfo('This browser could not open the linked views. You can continue using the main view and position fields.');return false;}
  }
  function setEnabled(value){
    if(disposed)return;cancel();
    enabled=!!value;if(enabled&&!ensureRenderer())enabled=false;
    toggle.classList.toggle('active',enabled);toggle.setAttribute('aria-pressed',String(enabled));
    dock.hidden=!enabled||suspended;column.classList.toggle('linked-views-open',enabled&&!suspended);
    if(enabled&&!suspended){resize();fitAll();contentCount=counts();invalidate();}
  }
  function location(event){
    const rect=stage.getBoundingClientRect(),pane=rect.width/3,index=Math.floor((event.clientX-rect.left)/pane),top=rect.top+28;
    if(index<0||index>2||event.clientY<top||event.clientY>rect.bottom)return null;
    return {name:names[index],rect:{left:rect.left+pane*index,top,width:pane,height:Math.max(1,rect.height-28)}};
  }
  function pick(event,where){
    const camera=cameras[where.name].camera;mouse.set((event.clientX-where.rect.left)/where.rect.width*2-1,-(event.clientY-where.rect.top)/where.rect.height*2+1);scene.updateMatrixWorld();raycaster.setFromCamera(mouse,camera);
    return linkedViewHit(raycaster.intersectObjects(getPickObjects(),false),getAtoms(),getImages());
  }
  function capture(event){renderer.domElement.focus({preventScroll:true});renderer.domElement.setPointerCapture(event.pointerId);event.preventDefault();}
  function pointerDown(event){
    if(!enabled||suspended||drag||![0,1,2].includes(event.button)||!canEdit())return;
    const where=location(event);if(!where)return;
    const camera=cameras[where.name].camera,frame={width:where.rect.width,height:where.rect.height,spanX:camera.right-camera.left,spanY:camera.top-camera.bottom,zoom:camera.zoom};
    if(event.button!==0){drag={mode:'pan',pointer:event.pointerId,name:where.name,start:{x:event.clientX,y:event.clientY},target:cameras[where.name].target.clone(),frame};capture(event);renderer.domElement.style.cursor='grabbing';return;}
    const hit=pick(event,where);
    if(!hit){drag={mode:'empty',pointer:event.pointerId,name:where.name,start:{x:event.clientX,y:event.clientY},shift:event.shiftKey};capture(event);return;}
    if(hit.locked){onInfo('This object is locked. Unlock it in Locked objects before editing.');return;}
    onSelect({kind:hit.kind,id:hit.id,additive:event.shiftKey,preserveSelected:!event.shiftKey});invalidate();
    if(event.shiftKey)return;
    const image=getActiveImage(),ids=new Set(getSelection()),items=image?[image]:getAtoms().filter(item=>ids.has(item.id)&&!isLocked(item));
    if(!items.length||items.some(isLocked))return;
    if(onBeginMove({view:where.name,items})===false)return;
    drag={mode:'move',pointer:event.pointerId,name:where.name,start:{x:event.clientX,y:event.clientY},anchor:{x:hit.item.x,y:hit.item.y,z:hit.item.z},frame,snap:Number(getSnap())||0,items:items.map(item=>({...item})),changed:false,started:false};capture(event);renderer.domElement.style.cursor='move';help.textContent=`Moving in ${basis(where.name).plane} · ${basis(where.name).normal[0]?'X':basis(where.name).normal[1]?'Y':'Z'} depth stays fixed · Escape cancels`;
  }
  function pointerMove(event){
    if(!drag||event.pointerId!==drag.pointer||drag.mode==='empty')return;
    const current={x:event.clientX,y:event.clientY};event.preventDefault();
    if(drag.mode==='pan'){
      const delta=linkedDragDelta(drag.name,drag.start,current,drag.frame,{x:0,y:0,z:0},0);if(!delta)return;
      cameras[drag.name].target.copy(drag.target).sub(delta);positionCamera(drag.name);invalidate();return;
    }
    if(!drag.started&&Math.hypot(current.x-drag.start.x,current.y-drag.start.y)<3)return;
    drag.started=true;const delta=linkedDragDelta(drag.name,drag.start,current,drag.frame,drag.anchor,drag.snap);if(!delta)return;
    if(drag.items.some(item=>['x','y','z'].some(axis=>Math.abs(item[axis]+delta[axis])>100)))return;
    if(onMove(delta)===false)return;
    drag.changed=delta.lengthSq()>.000001;invalidate();
  }
  function finish(event,cancelled){
    if(!drag||event.pointerId!==drag.pointer)return;const current=drag;drag=null;
    const canvas=renderer?.domElement;if(canvas?.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(canvas)canvas.style.cursor='default';
    help.textContent='Drag objects in each plane · Shift-click adds · Scroll zooms · Right-drag pans';
    if(current.mode==='move')onEndMove({cancel:cancelled,changed:current.changed});
    if(current.mode==='empty'&&!cancelled&&!current.shift&&Math.hypot(event.clientX-current.start.x,event.clientY-current.start.y)<4)onSelect(null);
    invalidate();
  }
  function cancel(){if(drag)finish({pointerId:drag.pointer},true);}
  function planePoint(event,where){const entry=cameras[where.name],camera=entry.camera;mouse.set((event.clientX-where.rect.left)/where.rect.width*2-1,-(event.clientY-where.rect.top)/where.rect.height*2+1);raycaster.setFromCamera(mouse,camera);return raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(vector(basis(where.name).normal),entry.target),new THREE.Vector3());}
  function wheel(event){
    if(!enabled||suspended||drag)return;const where=location(event);if(!where)return;event.preventDefault();
    const entry=cameras[where.name],before=planePoint(event,where);entry.camera.zoom=THREE.MathUtils.clamp(entry.camera.zoom*Math.exp(-event.deltaY*(event.deltaMode===1?.025:.0015)),.05,100);positionCamera(where.name);const after=planePoint(event,where);if(before&&after){entry.target.add(before.sub(after));positionCamera(where.name);}invalidate();
  }
  toggle.addEventListener('click',()=>setEnabled(!enabled));close.addEventListener('click',()=>setEnabled(false));fitButton.addEventListener('click',fitAll);
  const ResizeObserverClass=document.defaultView?.ResizeObserver||globalThis.ResizeObserver;
  const observer=ResizeObserverClass?new ResizeObserverClass(resize):null;observer?.observe(stage);
  return {
    update(){invalidate();if(enabled&&!suspended){resize();const next=counts();if(next!==contentCount){contentCount=next;fitAll();}}},
    render(time=globalThis.performance?.now()||Date.now()){
      if(disposed||!enabled||suspended||!renderer||!dirty||time-lastRender<1000/15)return;
      resize();lastRender=time;dirty=false;renderer.setScissorTest(true);const {width:paneWidth,height:paneHeight}=paneSize();
      try{for(let index=0;index<names.length;index++){const left=Math.round(index*paneWidth),right=Math.round((index+1)*paneWidth);renderer.setViewport(left,0,right-left,paneHeight);renderer.setScissor(left,0,right-left,paneHeight);renderScene(renderer,cameras[names[index]].camera);}}
      finally{renderer.setScissorTest(false);}
    },
    setSuspended(value){if(suspended===!!value)return;suspended=!!value;if(suspended)cancel();toggle.disabled=suspended;dock.hidden=!enabled||suspended;column.classList.toggle('linked-views-open',enabled&&!suspended);if(!suspended&&enabled){resize();invalidate();}},
    cancel,
    dispose(){cancel();disposed=true;observer?.disconnect();renderer?.dispose();dock.remove();toggle.remove();column.classList.remove('linked-views-open');}
  };
}
