import test from 'node:test';
import assert from 'node:assert/strict';
import {createPanelLayout} from './panel-layout-source.js';

function harness(){
  const nodes=new Map();
  const node=(tagName='DIV',parentElement=null)=>({tagName,parentElement,open:false,hidden:false,listeners:[],scrollIntoView(options){this.scrolled=options;},addEventListener(type,fn,capture){this.listeners.push({type,fn,capture});}});
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);}};
  const legend=node('DETAILS'),selection=node('DETAILS');
  document.getElementById('legend-section').parentElement=legend;
  document.getElementById('selection-controls').parentElement=selection;
  return{document,$:id=>document.getElementById(id),legend,selection,layout:createPanelLayout({document})};
}

test('selecting an image reveals its inspector, then returning to objects restores selection tools',()=>{
  const h=harness();h.layout.update();
  assert.equal(h.$('image-inspector-card').hidden,true);assert.equal(h.$('selection-section').hidden,false);
  h.layout.update({image:{id:'reference'},selectionCount:0});
  assert.equal(h.$('image-inspector-card').hidden,false);assert.equal(h.$('image-inspector-card').open,true);
  assert.equal(h.$('selection-section').hidden,true);assert.equal(h.$('stack-card').hidden,true);
  h.layout.update({selectionCount:3});
  assert.equal(h.$('image-inspector-card').hidden,true);assert.equal(h.$('selection-section').hidden,false);
  assert.equal(h.$('stack-card').hidden,false);assert.equal(h.selection.open,true);
});

test('a manually collapsed image inspector stays collapsed until a different image is selected',()=>{
  const h=harness();h.layout.update({image:{id:'one'}});h.$('image-inspector-card').open=false;
  h.layout.update({image:{id:'one'}});assert.equal(h.$('image-inspector-card').open,false);
  h.layout.update({image:{id:'two'}});assert.equal(h.$('image-inspector-card').open,true);
  h.$('image-inspector-card').open=false;h.layout.update();h.layout.update({image:{id:'two'}});
  assert.equal(h.$('image-inspector-card').open,true);
});

test('the legend toolbar opens nested panels before the original click handler scrolls',()=>{
  const h=harness(),outer={tagName:'DETAILS',parentElement:null,open:false};h.legend.parentElement=outer;
  const listener=h.$('legend-toggle').listeners[0];assert.equal(listener.type,'click');assert.equal(listener.capture,true);
  listener.fn();assert.equal(h.legend.open,true);assert.equal(outer.open,true);
});

test('Workspace opens the controls without replacing the current diagram',()=>{
  const h=harness();h.$('show-library').listeners[0].fn();
  assert.equal(h.$('library-card').open,true);assert.deepEqual(h.$('library-card').scrolled,{block:'start',behavior:'smooth'});
});

test('a newly selected image is revealed within its sidebar without repeatedly moving the panel',()=>{
  const h=harness(),scrolls=[];
  const panel={scrollHeight:1200,clientHeight:600,scrollTop:450,querySelector:()=>({offsetHeight:112}),getBoundingClientRect:()=>({top:64}),scrollTo:value=>scrolls.push(value)};
  h.$('image-inspector-card').closest=()=>panel;h.$('image-inspector-card').getBoundingClientRect=()=>({top:200});
  h.layout.update({image:{id:'one'}});assert.deepEqual(scrolls,[{top:462,behavior:'smooth'}]);
  h.layout.update({image:{id:'one'}});assert.equal(scrolls.length,1);
});
