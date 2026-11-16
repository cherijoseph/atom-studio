import * as THREE from 'three';

export const IMAGE_RESIZE_HANDLES=Object.freeze([
  {key:'nw',x:-1,y:1,label:'top left corner'},
  {key:'n',x:0,y:1,label:'top edge'},
  {key:'ne',x:1,y:1,label:'top right corner'},
  {key:'e',x:1,y:0,label:'right edge'},
  {key:'se',x:1,y:-1,label:'bottom right corner'},
  {key:'s',x:0,y:-1,label:'bottom edge'},
  {key:'sw',x:-1,y:-1,label:'bottom left corner'},
  {key:'w',x:-1,y:0,label:'left edge'}
].map(Object.freeze));

const cursors=['ew-resize','nwse-resize','ns-resize','nesw-resize'];
const finitePosition=value=>Number.isFinite(value);

// CSS pixels, independent of the renderer's pixel ratio. The same XYZ rotation
// and local image coordinates as the plane renderer keep handles on its edges.
export function projectImageResizeHandles(camera,image,width,height){
  if(!camera||!image||image.visible===false||!(image.opacity>0)||!(width>0&&height>0))return null;
  if(![image.x,image.y,image.z,image.width,image.height,...(image.rotation||[])].every(finitePosition)||image.rotation?.length!==3||image.width<=0||image.height<=0)return null;
  camera.updateMatrixWorld();
  const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(...image.rotation.map(THREE.MathUtils.degToRad),'XYZ'));
  const centre=new THREE.Vector3(image.x,image.y,image.z);
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(rotation);
  const view=camera.isPerspectiveCamera?camera.getWorldPosition(new THREE.Vector3()).sub(centre).normalize():camera.getWorldDirection(new THREE.Vector3()).negate();
  if(Math.abs(normal.dot(view))<.08)return null;
  const project=(x,y)=>{
    const world=new THREE.Vector3(x*image.width/2,y*image.height/2,0).applyQuaternion(rotation).add(centre);
    const eye=world.clone().applyMatrix4(camera.matrixWorldInverse);
    const clip=world.project(camera);
    return {left:(clip.x+1)*width/2,top:(1-clip.y)*height/2,depth:clip.z,eyeZ:eye.z};
  };
  const points=IMAGE_RESIZE_HANDLES.map(handle=>({...handle,...project(handle.x,handle.y)}));
  const corners=points.filter(handle=>handle.x&&handle.y);
  if(corners.some(point=>!Number.isFinite(point.left)||!Number.isFinite(point.top)||point.eyeZ>=-camera.near||point.depth< -1||point.depth>1))return null;
  const twiceArea=Math.abs(corners.reduce((sum,point,index)=>{
    const next=corners[(index+1)%corners.length];return sum+point.left*next.top-next.left*point.top;
  },0));
  // Tiny or nearly edge-on panels are easier to resize using the numeric fields
  // or after choosing Face current view, rather than overlapping controls.
  if(twiceArea<128)return null;
  const origin=project(0,0);
  return points.map(point=>{
    const angle=Math.atan2(point.top-origin.top,point.left-origin.left);
    const direction=((Math.round(angle/(Math.PI/4))%4)+4)%4;
    return {...point,cursor:cursors[direction],visible:point.left>=0&&point.left<=width&&point.top>=0&&point.top<=height};
  });
}

export function createImageResizeHandles({viewport,onPointerDown=()=>{}}){
  const document=viewport.ownerDocument,overlay=document.createElement('div');
  overlay.className='image-resize-handles';overlay.hidden=true;
  overlay.setAttribute('role','group');overlay.setAttribute('aria-label','Resize selected image');
  let disposed=false;
  const buttons=IMAGE_RESIZE_HANDLES.map(handle=>{
    const button=document.createElement('button');
    button.type='button';button.tabIndex=-1;button.className='image-resize-handle';button.dataset.imageResize=handle.key;
    button.setAttribute('aria-label','Resize image '+handle.label);
    button.title='Drag to resize image. Keep aspect ratio preserves proportions; hold Shift to switch it temporarily.';
    button.addEventListener('pointerdown',event=>{
      if(disposed||overlay.hidden||button.hidden)return;
      onPointerDown(event,handle);
    },true);
    overlay.append(button);return button;
  });
  viewport.append(overlay);
  function hide(){overlay.hidden=true;}
  function update(camera,image,enabled=true,activeHandle=null){
    if(disposed)return;
    const points=enabled?projectImageResizeHandles(camera,image,viewport.clientWidth,viewport.clientHeight):null;
    if(!points||!points.some(point=>point.visible)){hide();return;}
    overlay.hidden=false;
    points.forEach((point,index)=>{
      const button=buttons[index];button.hidden=!point.visible;
      button.style.left=point.left+'px';button.style.top=point.top+'px';button.style.cursor=point.cursor;
      const active=activeHandle&&(activeHandle===point.key||(activeHandle.x===point.x&&activeHandle.y===point.y));
      button.classList.toggle('is-active',!!active);
    });
  }
  function dispose(){if(disposed)return;disposed=true;overlay.remove();}
  return {update,hide,dispose};
}
