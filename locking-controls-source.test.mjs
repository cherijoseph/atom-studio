import test from 'node:test';
import assert from 'node:assert/strict';
import {lockedSets,mountLockingControls} from './locking-controls-source.js';

test('locking batches stay separate even when their names match, and include hidden objects',()=>{
  const first={id:1,locked:true,lockGroup:'a',lockLabel:'Substrate',visible:false};
  const second={id:2,locked:true,lockGroup:'b',lockLabel:'Substrate'};
  const image={id:'image',locked:true,lockGroup:'a',lockLabel:'Substrate'};
  const sets=lockedSets([first,second,image,{id:3},{id:4,locked:false}]);
  assert.equal(sets.length,2);
  assert.deepEqual(sets[0].items,[first,image]);
  assert.deepEqual(sets[1].items,[second]);
});

test('a saved lock without a named set remains reachable for unlocking',()=>{
  assert.deepEqual(lockedSets([{id:1,locked:true}]),[{key:'legacy',name:'Locked objects',items:[{id:1,locked:true}]}]);
});

// Only the dialog's DOM contract is needed here; selection identity and callbacks
// are real so asynchronous scene replacement can be exercised without WebGL.
function lockingDialogHarness(initialSelection){
  const elements=new Map();
  function element(tagName='div'){
    return{
      tagName:tagName.toUpperCase(),open:false,value:'',children:[],
      set id(value){this._id=value;elements.set(value,this);},get id(){return this._id;},
      set innerHTML(value){for(const match of value.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const child=element(match[1]);child.id=match[2];child.parentElement=this;this.children.push(child);}},
      setAttribute(){},before(){},after(){},select(){},scrollIntoView(){},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      showModal(){this.open=true;},close(){this.open=false;},
    };
  }
  for(const id of['copy','image-delete','image-inspector-card']){const node=element();node.id=id;node.parentElement=element();}
  const document={createElement:element,getElementById:id=>elements.get(id),body:element('body')};
  let selection=initialSelection,editable=true;
  const locks=[],messages=[];
  const controls=mountLockingControls({document,getItems:()=>selection,getSelection:()=>selection,canEdit:()=>editable,onLock:name=>locks.push({name,items:[...selection]}),onUnlock(){},onInfo:message=>messages.push(message)});
  return{
    controls,locks,messages,
    open(){elements.get('lock-selection').onclick();},
    submit(name='Protected base'){elements.get('lock-name').value=name;elements.get('lock-form').onsubmit({preventDefault(){}});},
    setSelection(next){selection=next;},setEditable(value){editable=value;},
  };
}

test('a pending scene load cannot lock new objects that replaced the dialog selection',()=>{
  const first={id:1},second={id:2};
  for(const replacement of[[{id:1},{id:2}],[first],[],[first,second,{id:3}]]){
    const ui=lockingDialogHarness([first,second]);
    ui.open();assert.equal(ui.controls.isOpen(),true);
    ui.setSelection(replacement);ui.submit();
    assert.equal(ui.controls.isOpen(),false);
    assert.deepEqual(ui.locks,[]);
    assert.match(ui.messages.at(-1),/Selection changed/);
  }
});

test('the same objects can be locked after selection order changes, and reopening captures the new scene',()=>{
  const first={id:1},second={id:2},ui=lockingDialogHarness([first,second]);
  ui.open();ui.setSelection([second,first]);ui.submit('  Base  ');
  assert.deepEqual(ui.locks,[{name:'Base',items:[second,first]}]);
  assert.equal(ui.controls.isOpen(),false);
  const replacement={id:1};ui.setSelection([replacement]);ui.open();ui.submit('Replacement');
  assert.deepEqual(ui.locks[1],{name:'Replacement',items:[replacement]});
});

test('a scene operation that starts while the lock dialog is open blocks applying the lock',()=>{
  const ui=lockingDialogHarness([{id:1}]);ui.open();ui.setEditable(false);ui.submit();
  assert.equal(ui.controls.isOpen(),false);assert.deepEqual(ui.locks,[]);
});
