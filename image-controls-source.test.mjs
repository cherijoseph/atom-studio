import test from 'node:test';
import assert from 'node:assert/strict';
import {mountImageControls} from './image-controls-source.js';

const plane=(overrides={})=>({id:'image-1',name:'Reference image',x:1,y:2,z:3,width:8,height:4,rotation:[0,0,0],opacity:1,visible:true,...overrides});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);

function fakeDocument(){
  const nodes=new Map(),document={activeElement:null};
  function element(tagName='input'){
    let value='',text='';
    return {tagName:tagName.toUpperCase(),checked:false,hidden:false,children:[],dataset:{},attributes:{},
      get value(){return value;},set value(next){value=String(next);},
      get textContent(){return text;},set textContent(next){text=String(next);this.children=[];},
      set innerHTML(_){assert.fail('Image names must never be inserted as HTML');},
      append(node){this.children.push(node);},replaceChildren(...next){this.children=next;},
      setAttribute(key,next){this.attributes[key]=String(next);},
      focus(){document.activeElement=this;}
    };
  }
  Object.assign(document,{
    getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},
    createElement:element,
    querySelectorAll(selector){assert.equal(selector,'[data-image-plane]');return presets;}
  });
  const presets=['front','top','side'].map(orientation=>{const button=element('button');button.dataset.imagePlane=orientation;return button;});
  document.getElementById('image-lock-aspect').checked=true;
  return {document,presets};
}

function harness(initial=[plane()]){
  const {document,presets}=fakeDocument(),$=id=>document.getElementById(id),images=structuredClone(initial),history=[],messages=[];
  let activeId=images[0]?.id||null,duplicates=0,deletes=0,controls;
  const active=()=>images.find(image=>image.id===activeId)||null;
  controls=mountImageControls({
    document,getImages:()=>images,getActive:active,
    selectImage:id=>{activeId=id;controls.update();},
    commit(fn,message){history.push({before:structuredClone(images),message});fn();controls.update();},
    onInfo:message=>messages.push(message),
    duplicateImage:()=>{duplicates++;},deleteImage:()=>{deletes++;},faceView:()=>[12,-34,56]
  });
  controls.update();
  function change(id,value){const field=$(id);field.focus();field.value=value;field.onchange();}
  return {document,presets,$,images,active,history,messages,controls,change,
    select(id){activeId=id;controls.update();},get duplicates(){return duplicates;},get deletes(){return deletes;}};
}

test('a locked image ignores field edits without adding an undo entry',()=>{
  const h=harness([plane({locked:true})]),before=structuredClone(h.images);
  for(const [id,value] of [['image-x',14],['image-width',12],['image-rz',90],['image-opacity',10],['image-name','Renamed']])h.change(id,value);
  h.presets[0].onclick();
  assert.deepEqual(h.images,before);
  assert.equal(h.history.length,0);
  assert.ok(h.messages.every(message=>message.includes('Unlock')));
});

test('locked resizing preserves aspect ratio and normalizes the focused field at both bounds',()=>{
  for(const [dimension,input,expectedWidth,expectedHeight] of [
    ['width',500,100,50],['width',0,.2,.1],['height',500,100,50],['height',0,.2,.1]
  ]){
    const h=harness();h.change('image-'+dimension,input);
    close(h.active().width,expectedWidth);close(h.active().height,expectedHeight);
    close(h.active().width/h.active().height,2);
    close(Number(h.$('image-width').value),expectedWidth);close(Number(h.$('image-height').value),expectedHeight);
    assert.equal(h.history.length,1);assert.equal(h.history[0].before[0].width,8);
  }
  // Fractional ratios can otherwise round just outside the accepted dimensions.
  const h=harness([plane({width:8.7,height:3.1})]);h.change('image-height',1000);
  assert.ok(h.active().width<=100&&h.active().height<=100);
  assert.ok(h.active().width>=.1&&h.active().height>=.1);
  close(h.active().width/h.active().height,8.7/3.1);
});

test('unlocked dimensions change independently and invalid input restores the committed value',()=>{
  const h=harness();h.$('image-lock-aspect').checked=false;
  h.change('image-width',200);assert.equal(h.active().width,100);assert.equal(h.active().height,4);assert.equal(h.$('image-width').value,'100');
  h.change('image-height',-5);assert.equal(h.active().height,.1);assert.equal(h.active().width,100);assert.equal(h.$('image-height').value,'0.1');
  h.change('image-width','');assert.equal(h.active().width,100);assert.equal(h.$('image-width').value,'100');
  h.change('image-width','NaN');assert.equal(h.active().width,100);assert.equal(h.$('image-width').value,'100');
});

test('position coordinates clamp independently and display the normalized values while focused',()=>{
  const h=harness();h.change('image-x',999);h.change('image-y',-999);h.change('image-z','invalid');
  assert.deepEqual(['x','y','z'].map(axis=>h.active()[axis]),[100,-100,3]);
  assert.deepEqual(['x','y','z'].map(axis=>h.$('image-'+axis).value),['100','-100','3']);
});

test('rotation controls use degrees, clamp every axis and support presets and facing the view',()=>{
  const h=harness();h.change('image-rx',720);h.change('image-ry',-720);h.change('image-rz',42.5);
  assert.deepEqual(h.active().rotation,[360,-360,42.5]);
  assert.deepEqual(['x','y','z'].map(axis=>h.$('image-r'+axis).value),['360','-360','42.5']);
  for(const [orientation,expected]of [['front',[0,0,0]],['top',[-90,0,0]],['side',[0,90,0]]]){
    h.presets.find(button=>button.dataset.imagePlane===orientation).onclick();
    assert.deepEqual(h.active().rotation,expected);
  }
  h.$('image-face-view').onclick();assert.deepEqual(h.active().rotation,[12,-34,56]);
});

test('opacity percentages clamp to zero through one and visibility remains independently controllable',()=>{
  const h=harness();
  for(const [input,expected,display]of [[200,1,'100'],[-5,0,'0'],[35,.35,'35'],['',1,'100']]){
    h.change('image-opacity',input);assert.equal(h.active().opacity,expected);assert.equal(h.$('image-opacity').value,display);
  }
  h.$('image-visible').checked=false;h.$('image-visible').onchange();assert.equal(h.active().visible,false);
  assert.equal(h.$('image-list').children[0].textContent,'Reference image · hidden');
  h.$('image-visible').checked=true;h.$('image-visible').onchange();assert.equal(h.active().visible,true);
});

test('passive updates preserve a focused name draft but a committed name is normalized as plain text',()=>{
  const h=harness(),field=h.$('image-name'),name='<img src=x onerror=alert(1)>';
  field.focus();field.value='Draft while typing';h.controls.update();assert.equal(field.value,'Draft while typing');assert.equal(h.active().name,'Reference image');
  // A separate committed numeric update must not replace the focused name draft.
  h.$('image-x').value='500';h.$('image-x').onchange();assert.equal(field.value,'Draft while typing');
  field.value='  '+name+'\t  ';field.onchange();
  assert.equal(h.active().name,name);assert.equal(field.value,name);
  const button=h.$('image-list').children[0];assert.equal(button.textContent,name);assert.equal(button.children.length,0);
  field.value=' ';field.onchange();assert.equal(field.value,name);assert.equal(h.active().name,name);assert.equal(h.messages.at(-1),'Enter a name for the image');
  field.value='A'.repeat(130);field.onchange();assert.equal(h.active().name.length,120);assert.equal(field.value.length,120);
});

test('the image list safely selects hidden and visible images, then hides controls when nothing is selected',()=>{
  const h=harness([plane(),plane({id:'image-2',name:'<script>unsafe()</script>',visible:false,x:10})]);
  let buttons=h.$('image-list').children;
  assert.equal(buttons.length,2);assert.equal(buttons[0].attributes['aria-pressed'],'true');assert.equal(buttons[1].attributes['aria-pressed'],'false');
  assert.equal(buttons[1].textContent,'<script>unsafe()</script> · hidden');assert.equal(buttons[1].children.length,0);
  buttons[1].onclick();buttons=h.$('image-list').children;
  assert.equal(h.active().id,'image-2');assert.equal(h.$('image-controls').hidden,false);assert.equal(h.$('image-x').value,'10');assert.equal(h.$('image-visible').checked,false);
  assert.equal(buttons[0].attributes['aria-pressed'],'false');assert.equal(buttons[1].attributes['aria-pressed'],'true');assert.match(buttons[1].className,/active/);
  h.select(null);assert.equal(h.$('image-controls').hidden,true);
});

test('duplicate and delete controls delegate once and empty selection ignores edits',()=>{
  const h=harness();h.$('image-duplicate').onclick();h.$('image-delete').onclick();
  assert.equal(h.duplicates,1);assert.equal(h.deletes,1);
  h.select(null);h.change('image-x',50);h.change('image-width',50);h.change('image-rx',50);
  assert.equal(h.history.length,0);assert.equal(h.images[0].x,1);
});
