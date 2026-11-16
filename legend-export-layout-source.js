// Layout is expressed in legend world units; one unit is one font-size pixel
// after the export scale is applied. Text uses the same metrics as its texture.
const textureScale=1.5/96;
const labelPadding=8*textureScale;

export function wrapLegendLabel(label,maxWidth,measureText){
  const lines=[];let line='';
  const limit=Math.max(.15,maxWidth-labelPadding)/textureScale;
  for(const char of label){
    if(char==='\n'){lines.push(line.trim()||' ');line='';continue;}
    if(line&&measureText(line+char)>limit+1e-6){lines.push(line.trim()||' ');line=char;}
    else line+=char;
  }
  if(line||!lines.length)lines.push(line.trim()||' ');
  return lines;
}

function fitCellWidths(naturalWidths,available){
  if(naturalWidths.reduce((sum,width)=>sum+width,0)<=available)return naturalWidths;
  // Cap only the widest entries. Short labels retain their natural widths,
  // leaving the rest of the row available to longer material names.
  let low=0,high=Math.max(...naturalWidths);
  for(let step=0;step<40;step++){
    const cap=(low+high)/2,total=naturalWidths.reduce((sum,width)=>sum+Math.min(width,cap),0);
    if(total>available)high=cap;else low=cap;
  }
  return naturalWidths.map(width=>Math.min(width,low));
}

export function measureLegendExportLayout(entries,{availableWidth,measureText}){
  const panelPadding=.6,outerMargin=.6,columnGap=.45,rowGap=.45;
  const sampleSpace=1.7,labelGap=.35,cellPadding=.35,rows=[];
  const usable=Math.max(1,availableWidth-outerMargin*2-panelPadding*2);
  for(let start=0;start<entries.length;start+=5){
    const batch=entries.slice(start,start+5),available=usable-columnGap*(batch.length-1),budget=Math.max(.5,available/batch.length);
    const labelWidths=batch.map(entry=>Math.max(...entry.label.split('\n').map(line=>measureText(line)))*textureScale+labelPadding);
    const inlineWidths=labelWidths.map(width=>width+cellPadding*2+sampleSpace+labelGap);
    const inlineFits=inlineWidths.reduce((sum,width)=>sum+width,0)<=available;
    const stacked=!inlineFits&&budget<4.4;
    const cellWidths=fitCellWidths(stacked?labelWidths.map(width=>width+cellPadding*2):inlineWidths,Math.max(.5,available));
    const items=batch.map((entry,index)=>{
      const maxLabelWidth=Math.max(.2,cellWidths[index]-cellPadding*2-(stacked?0:sampleSpace+labelGap));
      const lines=wrapLegendLabel(entry.label,maxLabelWidth,measureText);
      const labelWidth=Math.max(...lines.map(line=>measureText(line)))*textureScale+labelPadding;
      const labelHeight=lines.length*1.5;
      return {index:start+index,lines,labelWidth,labelHeight};
    });
    const width=cellWidths.reduce((sum,value)=>sum+value,0)+columnGap*(items.length-1)+panelPadding*2;
    const height=Math.max(...items.map(item=>stacked?sampleSpace+labelGap+item.labelHeight+cellPadding*2:Math.max(sampleSpace,item.labelHeight)+cellPadding*2));
    rows.push({items,cellWidths,width,height,stacked});
  }
  const box={width:Math.max(1,...rows.map(row=>row.width)),height:rows.reduce((sum,row)=>sum+row.height,0)+rowGap*Math.max(0,rows.length-1)+panelPadding*2};
  let top=box.height/2-panelPadding;
  for(const row of rows){
    const y=top-row.height/2;top-=row.height+rowGap;
    let cellLeft=-row.width/2+panelPadding;
    row.items.forEach((item,index)=>{
      const cellWidth=row.cellWidths[index],centre=cellLeft+cellWidth/2;cellLeft+=cellWidth+columnGap;
      if(row.stacked){
        item.sampleX=centre;item.sampleY=y+row.height/2-cellPadding-sampleSpace/2;
        item.labelX=centre;item.labelY=y-row.height/2+cellPadding+item.labelHeight/2;
      }else{
        const left=centre-cellWidth/2+cellPadding;
        item.sampleX=left+sampleSpace/2;item.sampleY=y;
        item.labelX=left+sampleSpace+labelGap+item.labelWidth/2;item.labelY=y;
      }
    });
  }
  return {...box,outerMargin,rows};
}
