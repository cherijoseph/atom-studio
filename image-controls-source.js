/** Image controls share the editor's undo history; image pixels never enter HTML. */
export function mountImageControls({document,getImages,getActive,selectImage,commit,onInfo,duplicateImage,deleteImage,faceView}){
  const $=id=>document.getElementById(id);
  let listKey='';
  function change(fn,message='Image updated',normalizeName=false){
    const image=getActive();if(!image)return;if(image.locked===true){onInfo('Unlock this image in Locked objects before editing.');update({normalizeNumbers:true,normalizeName:true});return;}
    commit(()=>fn(image),message);
    // The editor's sync preserves focused drafts. Once a change is committed,
    // show its actual bounds even while that numeric field still has focus.
    update({normalizeNumbers:true,normalizeName});
  }
  function value(id,min,max,fallback){const n=Number($(id).value);return $(id).value.trim()&&Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
  function update({normalizeNumbers=false,normalizeName=false}={}){
    const images=getImages(),image=getActive(),key=JSON.stringify(images.map(a=>[a.id,a.name,a.visible,a.locked,a.id===image?.id]));
    if(key!==listKey){
      $('image-list').replaceChildren();
      for(const item of images){
        const button=document.createElement('button');button.type='button';button.className='secondary full image-list-item'+(item.id===image?.id?' active':'');
        button.textContent=item.name+(item.locked===true?' · locked':'')+(item.visible?'':' · hidden');button.setAttribute('aria-pressed',String(item.id===image?.id));
        button.onclick=()=>selectImage(item.id);$('image-list').append(button);
      }
      listKey=key;
    }
    $('image-controls').hidden=!image;
    if(!image)return;
    for(const [id,v]of [['image-name',image.name],...['x','y','z','width','height'].map(k=>['image-'+k,image[k]]),...['x','y','z'].map((k,i)=>['image-r'+k,image.rotation[i]]),['image-opacity',Math.round(image.opacity*100)]])if(document.activeElement!==$(id)||(id==='image-name'?normalizeName:normalizeNumbers))$(id).value=typeof v==='number'?Math.round(v*10000)/10000:v;
    $('image-visible').checked=image.visible;
  }
  $('image-name').onchange=()=>{const name=$('image-name').value.replace(/[\u0000-\u001f\u007f]/g,'').trim();if(!name){onInfo('Enter a name for the image');update({normalizeName:true});return;}change(a=>a.name=name.slice(0,120),'Image renamed',true);};
  for(const axis of['x','y','z'])$('image-'+axis).onchange=()=>change(a=>a[axis]=value('image-'+axis,-100,100,a[axis]),'Image position updated');
  for(const dimension of['width','height'])$('image-'+dimension).onchange=()=>{
    const a=getActive();if(!a)return;const other=dimension==='width'?'height':'width',ratio=a[other]/a[dimension];let size=value('image-'+dimension,.1,100,a[dimension]);
    if($('image-lock-aspect').checked)size=Math.max(.1,.1/ratio,Math.min(100,100/ratio,size));
    change(image=>{image[dimension]=size;if($('image-lock-aspect').checked)image[other]=Math.max(.1,Math.min(100,size*ratio));},'Image resized');
  };
  for(const [i,axis]of['x','y','z'].entries())$('image-r'+axis).onchange=()=>change(a=>a.rotation[i]=value('image-r'+axis,-360,360,a.rotation[i]),'Image rotated');
  for(const button of document.querySelectorAll('[data-image-plane]'))button.onclick=()=>change(a=>a.rotation=({front:[0,0,0],top:[-90,0,0],side:[0,90,0]})[button.dataset.imagePlane].slice(),'Image orientation updated');
  $('image-face-view').onclick=()=>change(a=>a.rotation=faceView(),'Image faces the current view');
  $('image-opacity').onchange=()=>change(a=>a.opacity=value('image-opacity',0,100,100)/100,'Image opacity updated');
  $('image-visible').onchange=()=>change(a=>a.visible=$('image-visible').checked,$('image-visible').checked?'Image shown':'Image hidden');
  $('image-duplicate').onclick=duplicateImage;$('image-delete').onclick=deleteImage;
  return{update};
}
