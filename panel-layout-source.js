/** Presentation state only; saved diagrams and their schemas remain independent. */
export function createPanelLayout({document}){
  const $=id=>document.getElementById(id);
  const openParents=node=>{
    for(let parent=node?.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  };
  const revealInPanel=node=>{
    const panel=node.closest?.('.panel');
    if(!panel||panel.scrollHeight<=panel.clientHeight)return;
    const heading=panel.querySelector('.panel-intro');
    panel.scrollTo({top:Math.max(0,panel.scrollTop+node.getBoundingClientRect().top-panel.getBoundingClientRect().top-(heading?.offsetHeight||0)-12),behavior:'smooth'});
  };
  // Run before the existing legend handler scrolls to its editor.
  $('legend-toggle').addEventListener('click',()=>openParents($('legend-section')),true);
  $('show-library').addEventListener('click',()=>{
    const library=$('library-card');library.open=true;
    library.scrollIntoView({block:'start',behavior:'smooth'});
  });
  let previousImageId=null,previousSelection=false;
  return{
    update({image=null,selectionCount=0}={}){
      const inspector=$('image-inspector-card'),selection=$('selection-section'),stack=$('stack-card');
      inspector.hidden=!image;selection.hidden=!!image;stack.hidden=!!image;
      if(image&&image.id!==previousImageId){inspector.open=true;revealInPanel(inspector);}
      if(selectionCount&&!previousSelection){openParents($('selection-controls'));revealInPanel(selection);}
      previousImageId=image?.id??null;previousSelection=selectionCount>0;
    }
  };
}
