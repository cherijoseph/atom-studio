import * as THREE from 'three';
import {makeSurfaceMaterial,appearanceOf,validateAppearance,surfaceOf,shineOf,surfaces} from './appearance-source.js';
import {makeCarbon,disposeMesh} from './carbon-source.js';
import {measureLegendExportLayout} from './legend-export-layout-source.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const corners=['top-left','top-right','bottom-left','bottom-right','custom'];
export const defaultAnnotations=()=>({enabled:false,size:18,position:'bottom-right',x:1,y:1,panel:true,entries:[]});

export function validateAnnotations(raw){
  if(raw===undefined)return defaultAnnotations();
  if(!raw||typeof raw.enabled!=='boolean'||typeof raw.panel!=='boolean'||!corners.includes(raw.position)||!Number.isFinite(raw.size)||raw.size<14||raw.size>30||!Number.isFinite(raw.x)||raw.x<0||raw.x>1||!Number.isFinite(raw.y)||raw.y<0||raw.y>1||!Array.isArray(raw.entries)||raw.entries.length>12)throw new Error('Invalid annotations');
  for(const entry of raw.entries)if((validateAppearance(entry||{}),!entry||typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>48||!['atom','carbon'].includes(entry.kind)||!/^#[0-9a-f]{6}$/i.test(entry.color)))throw new Error('Invalid annotation entry');
  return {enabled:raw.enabled,panel:raw.panel,position:raw.position,size:raw.size,x:raw.x,y:raw.y,entries:raw.entries.map(e=>({label:e.label.trim(),kind:e.kind,color:e.color,...appearanceOf(e)}))};
}

export function createAnnotations({viewport,onChange,onDragStart,onDragEnd}){
  const $=id=>document.getElementById(id),scene=new THREE.Scene(),group=new THREE.Group(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,200);
  camera.position.z=100;scene.add(group,new THREE.HemisphereLight(0xffffff,0x6c7e90,2.3));
  const key=new THREE.DirectionalLight(0xffffff,2.5);key.position.set(-12,20,18);scene.add(key);
  const fill=new THREE.DirectionalLight(0xb8d7ff,.7);fill.position.set(15,5,-10);scene.add(fill);
  const sphereGeometry=new THREE.SphereGeometry(1,28,22);
  let state=defaultAnnotations(),box={width:1,height:1},lastDark=false,needsBuild=true,drag=null,layout=null,lastLayout='screen',lastExportWidth=0;
  const handle=document.createElement('div');handle.id='legend-handle';handle.tabIndex=0;handle.setAttribute('aria-label','Drag to move material legend');handle.title='Drag to move legend';handle.hidden=true;viewport.append(handle);
  function change(next){onChange(validateAnnotations(next));}
  function edit(fn){const next=copy(state);fn(next);change(next);}
  function input(tag,attrs){const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;}
  function fields(){
    $('legend-show').checked=state.enabled;$('legend-panel').checked=state.panel;$('legend-position').value=state.position;$('legend-size').value=state.size;
    $('legend-toggle').classList.toggle('active',state.enabled);$('legend-toggle').setAttribute('aria-pressed',String(state.enabled));
    $('legend-entries').replaceChildren();state.entries.forEach((entry,index)=>{
      const row=document.createElement('div');row.className='legend-entry';
      const label=input('input',{type:'text',maxlength:'48','aria-label':`Legend label ${index+1}`});label.value=entry.label;
      label.onchange=()=>{const value=label.value.trim();if(!value){label.value=entry.label;return;}edit(next=>next.entries[index].label=value);};
      const kind=input('select',{'aria-label':`Legend sample ${index+1}`});for(const [value,text]of[['atom','Sphere'],['carbon','Cube']]){const option=document.createElement('option');option.value=value;option.textContent=text;kind.append(option);}kind.value=entry.kind;kind.onchange=()=>edit(next=>next.entries[index].kind=kind.value);
      const color=input('input',{type:'color','aria-label':`Legend colour ${index+1}`});color.value=entry.color;color.onchange=()=>edit(next=>next.entries[index].color=color.value);
      const remove=input('button',{type:'button','aria-label':`Remove legend entry ${index+1}`});remove.className='legend-remove';remove.textContent='×';remove.onclick=()=>edit(next=>next.entries.splice(index,1));
      const surface=input('select',{'aria-label':`Legend surface ${index+1}`});surface.className='legend-surface';for(const[value,text]of surfaces)surface.add(new Option(text,value));surface.value=surfaceOf(entry);surface.onchange=()=>edit(next=>next.entries[index].surface=surface.value);
      const shine=input('input',{type:'number',min:'0',max:'100',step:'5','aria-label':`Legend shininess ${index+1}`});shine.className='legend-shine';shine.value=shineOf(entry);shine.onchange=()=>edit(next=>next.entries[index].shininess=Math.max(0,Math.min(100,Number(shine.value)||0)));
      row.append(label,kind,color,remove,surface,shine);$('legend-entries').append(row);
    });$('legend-add').disabled=state.entries.length>=12;
  }
  $('legend-show').onchange=e=>edit(next=>next.enabled=e.target.checked);
  $('legend-panel').onchange=e=>edit(next=>next.panel=e.target.checked);
  $('legend-size').onchange=e=>edit(next=>next.size=Math.max(14,Math.min(30,Number(e.target.value)||18)));
  $('legend-position').onchange=e=>edit(next=>{next.position=e.target.value;if(next.position!=='custom'){next.x=next.position.endsWith('right')?1:0;next.y=next.position.startsWith('bottom')?1:0;}});
  $('legend-add').onclick=()=>edit(next=>{next.entries.push({label:'Material',kind:'atom',color:'#3b82f6'});next.enabled=true;});
  $('legend-toggle').onclick=()=>{if(!state.enabled)edit(next=>next.enabled=true);$('legend-section').scrollIntoView({block:'start',behavior:'smooth'});};
  function clear(){for(const child of group.children){if(child.userData.carbon)disposeMesh(child);else{child.material.map?.dispose();child.material.dispose();if(child.geometry!==sphereGeometry)child.geometry?.dispose();}}group.clear();}
  function text(label,color,givenLines){
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font='64px Arial, sans-serif';
    const lines=givenLines||[];if(!givenLines){let line='';for(const char of label){if(line&&ctx.measureText(line+char).width>640){lines.push(line.trim());line=char;}else line+=char;}if(line)lines.push(line.trim());}
    canvas.width=Math.ceil(Math.max(...lines.map(value=>ctx.measureText(value).width)))+8;canvas.height=96*lines.length;ctx.font='64px Arial, sans-serif';ctx.fillStyle=color;ctx.textBaseline='middle';lines.forEach((value,i)=>ctx.fillText(value,4,48+i*96));
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));sprite.scale.set(canvas.width/96*1.5,lines.length*1.5,1);return sprite;
  }
  function build(dark){
    clear();const textColor=dark&&!state.panel?'#ffffff':'#243741';let width=4.5;const rows=[];
    state.entries.forEach(entry=>{const label=text(entry.label,textColor);width=Math.max(width,label.scale.x+3.25);rows.push({entry,label});});
    rows.forEach(row=>row.height=Math.max(1.9,row.label.scale.y+.4));box={width,height:rows.reduce((sum,row)=>sum+row.height,0)+1.1};
    if(state.panel){const panel=new THREE.Mesh(new THREE.PlaneGeometry(box.width,box.height),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthWrite:false}));panel.position.z=-2;group.add(panel);}
    let rowTop=box.height/2-.55;rows.forEach(({entry,label,height})=>{
      const y=rowTop-height/2,x=-box.width/2+1.2;rowTop-=height;
      const sample=entry.kind==='carbon'?makeCarbon({kind:'carbon',x:0,y:0,z:0,r:1,color:entry.color,...appearanceOf(entry)},[]):new THREE.Mesh(sphereGeometry,makeSurfaceMaterial(entry));
      if(entry.kind==='carbon'){sample.rotation.set(.2,-.5,.04);sample.scale.setScalar(1.02);}else sample.scale.setScalar(.62);
      sample.position.set(x,y,0);label.position.set(-box.width/2+2.35+label.scale.x/2,y,2);group.add(sample,label);
    });needsBuild=false;lastDark=dark;lastLayout='screen';
  }
  const measureContext=document.createElement('canvas').getContext('2d');measureContext.font='64px Arial, sans-serif';
  function exportMetrics(width){
    const density=state.size*width/Math.max(viewport.clientWidth,1);
    const metrics=measureLegendExportLayout(state.entries,{availableWidth:width/density,measureText:value=>measureContext.measureText(value).width});
    return {...metrics,density,heightPixels:Math.ceil((metrics.height+metrics.outerMargin*2)*density)};
  }
  function getExportHeight(width){return state.enabled&&state.entries.length?exportMetrics(width).heightPixels:0;}
  function buildExport(dark,metrics){
    clear();box={width:metrics.width,height:metrics.height};const textColor=dark&&!state.panel?'#ffffff':'#243741';
    if(state.panel){const panel=new THREE.Mesh(new THREE.PlaneGeometry(box.width,box.height),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthWrite:false}));panel.position.z=-2;group.add(panel);}
    for(const row of metrics.rows)for(const item of row.items){
      const entry=state.entries[item.index],label=text(entry.label,textColor,item.lines);
      const sample=entry.kind==='carbon'?makeCarbon({kind:'carbon',x:0,y:0,z:0,r:1,color:entry.color,...appearanceOf(entry)},[]):new THREE.Mesh(sphereGeometry,makeSurfaceMaterial(entry));
      if(entry.kind==='carbon'){sample.rotation.set(.2,-.5,.04);sample.scale.setScalar(1.02);}else sample.scale.setScalar(.62);
      sample.position.set(item.sampleX,item.sampleY,0);label.position.set(item.labelX,item.labelY,2);group.add(sample,label);
    }
    needsBuild=false;lastDark=dark;lastLayout='export';lastExportWidth=metrics.density;
  }
  function render(renderer,{dark=false,clean=false,exporting=false}={}){
    const hasLegend=state.enabled&&state.entries.length>0;
    handle.hidden=!hasLegend||clean||exporting;if(!hasLegend)return;
    if(exporting){
      const size=renderer.getSize(new THREE.Vector2()),metrics=exportMetrics(size.x);
      if(needsBuild||dark!==lastDark||lastLayout!=='export'||metrics.density!==lastExportWidth)buildExport(dark,metrics);
      const w=size.x/metrics.density,h=size.y/metrics.density;
      group.position.set(0,-h/2+metrics.outerMargin+box.height/2,0);
      camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();
      const autoClear=renderer.autoClear;try{renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}
      return;
    }
    if(needsBuild||dark!==lastDark||lastLayout!=='screen')build(dark);
    const size=renderer.getSize(new THREE.Vector2()),exportScale=size.x/Math.max(viewport.clientWidth,1);
    const density=Math.max(1,Math.min(state.size,(viewport.clientWidth-48)/box.width,(viewport.clientHeight-110)/box.height))*exportScale;
    const w=size.x/density,h=size.y/density,margin=1.15,top=2.7,bottom=3.5;
    const availX=Math.max(0,w-box.width-margin*2),availY=Math.max(0,h-box.height-top-bottom);
    const px=margin+availX*state.x,py=top+availY*state.y;
    group.position.set(-w/2+px+box.width/2,h/2-py-box.height/2,0);
    camera.left=-w/2;camera.right=w/2;camera.top=h/2;camera.bottom=-h/2;camera.updateProjectionMatrix();
    layout={left:px*density/exportScale,top:py*density/exportScale,width:box.width*density/exportScale,height:box.height*density/exportScale,availX:availX*density/exportScale,availY:availY*density/exportScale};
    Object.assign(handle.style,{left:`${layout.left}px`,top:`${layout.top}px`,width:`${layout.width}px`,height:`${layout.height}px`});
    const autoClear=renderer.autoClear;try{renderer.autoClear=false;renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=autoClear;}
  }
  handle.addEventListener('pointerdown',e=>{if(e.button!==0||!layout)return;e.preventDefault();handle.focus({preventScroll:true});drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,before:copy(state),layout:{...layout},changed:false};onDragStart();handle.setPointerCapture(e.pointerId);});
  handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;state.position='custom';state.x=Math.max(0,Math.min(1,drag.before.x+(e.clientX-drag.startX)/Math.max(1,drag.layout.availX)));state.y=Math.max(0,Math.min(1,drag.before.y+(e.clientY-drag.startY)/Math.max(1,drag.layout.availY)));drag.changed=Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>2;});
  function end(e,cancel=false){if(!drag||e.pointerId!==drag.id)return;const old=drag;drag=null;const next=copy(state);state=old.before;if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);onDragEnd();if(!cancel&&old.changed)change(next);else fields();}
  handle.addEventListener('pointerup',e=>end(e));handle.addEventListener('pointercancel',e=>end(e,true));
  fields();return {getState:()=>copy(state),isDragging:()=>!!drag,setState(next){state=validateAnnotations(next);needsBuild=true;fields();},getExportHeight,render};
}
