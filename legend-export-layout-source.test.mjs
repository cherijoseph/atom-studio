import assert from 'node:assert/strict';
import {measureLegendExportLayout,wrapLegendLabel} from './legend-export-layout-source.js';

const measureText=value=>[...value].reduce((sum,char)=>sum+(char==='W'?64:char===' '?16:32),0);
const layout=(labels,availableWidth=774/18)=>measureLegendExportLayout(labels.map(label=>({label})),{availableWidth,measureText});

for(let count=1;count<=12;count++){
  const result=layout(Array.from({length:count},(_,i)=>`Material ${i+1}`));
  assert.equal(result.rows.length,Math.ceil(count/5));
  assert.deepEqual(result.rows.map(row=>row.items.length),Array.from({length:Math.ceil(count/5)},(_,i)=>Math.min(5,count-i*5)));
  assert.deepEqual(result.rows.flatMap(row=>row.items.map(item=>item.index)),Array.from({length:count},(_,i)=>i));
  for(const row of result.rows){
    assert.ok(row.width<=774/18-result.outerMargin*2+1e-8);
    assert.equal(new Set(row.items.map(item=>item.sampleY)).size,1);
  }
}

for(const availableWidth of [774/18,320/30,1200/14]){
  const result=layout(Array.from({length:12},(_,i)=>'W'.repeat(46)+String(i).padStart(2,'0')),availableWidth);
  assert.equal(result.rows.length,3);
  for(const row of result.rows)for(const item of row.items){
    assert.ok(item.lines.length>1,'Long labels must wrap within a cell.');
    assert.ok(item.labelX-item.labelWidth/2>=-result.width/2-1e-8,'Label starts inside the panel.');
    assert.ok(item.labelX+item.labelWidth/2<=result.width/2+1e-8,'Label ends inside the panel.');
    assert.ok(item.labelY-item.labelHeight/2>=-result.height/2-1e-8,'Label bottom is inside the panel.');
    assert.ok(item.labelY+item.labelHeight/2<=result.height/2+1e-8,'Label top is inside the panel.');
  }
  for(let index=1;index<result.rows.length;index++){
    const previousBottom=Math.min(...result.rows[index-1].items.map(item=>item.labelY-item.labelHeight/2));
    const nextTop=Math.max(...result.rows[index].items.map(item=>item.labelY+item.labelHeight/2));
    assert.ok(previousBottom>nextTop,'Adjacent legend rows must not overlap.');
  }
}

const entries=[{label:'Red finish'},{label:'Teal finish'},{label:'Base'},{label:'Carbon'},{label:'Gold finish'}],original=JSON.stringify(entries);
measureLegendExportLayout(entries,{availableWidth:774/18,measureText});
assert.equal(JSON.stringify(entries),original,'Layout must leave saved annotation entries unchanged.');
const exampleLabels=['Base','Red finish','Teal finish','Violet finish','Carbon'],exampleRow=layout(exampleLabels).rows[0];
assert.deepEqual(exampleRow.items.map(item=>item.lines),exampleLabels.map(label=>[label]),'Five normal material names must use one line when their combined natural widths fit.');
assert.ok(exampleRow.cellWidths[3]>exampleRow.cellWidths[0],'Long names receive more horizontal space than short names.');
const crowdedLabels=['Base','Red finish','Teal finish','W'.repeat(48),'Carbon'],crowdedRow=layout(crowdedLabels).rows[0];
assert.ok(crowdedRow.items[3].lines.length>1,'The widest label wraps when the complete row exceeds the width.');
assert.deepEqual(crowdedRow.items.filter((_,index)=>index!==3).map(item=>item.lines),crowdedLabels.filter((_,index)=>index!==3).map(label=>[label]),'Capping a long label should preserve short labels without wrapping.');
for(let index=1;index<exampleRow.items.length;index++){
  const previous=exampleRow.items[index-1],current=exampleRow.items[index];
  assert.ok(previous.labelX+previous.labelWidth/2<current.sampleX-.62,'Unequal-width cells keep each label clear of the next material sample.');
}
assert.deepEqual(wrapLegendLabel( 'Red\nTeal',20,measureText),['Red','Teal']);
assert.ok(layout(['Red finish','Teal finish','Base','Carbon','Gold finish'],320/30).rows[0].stacked,'Narrow exports stack each sample above its label without reducing the font.');
console.log('Export legend layout checks passed (1–12 entries, adaptive five-column rows, natural material names, long labels, narrow exports and immutable state).');
