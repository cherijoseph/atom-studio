import * as THREE from 'three';

export const IMAGE_FILE_BYTE_LIMIT = 20_000_000;
export const IMAGE_SOURCE_PIXEL_LIMIT = 64_000_000;
export const IMAGE_SOURCE_EDGE_LIMIT = 16_384;
export const IMAGE_OUTPUT_EDGE_LIMIT = 1_600;
const DATA_URL_LIMIT = 2_000_000;
const LOAD_TIMEOUT = 30_000;

export function normalizedImageDimensions(width,height,maxEdge=IMAGE_OUTPUT_EDGE_LIMIT){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('This image has invalid dimensions.');
  if(width>IMAGE_SOURCE_EDGE_LIMIT||height>IMAGE_SOURCE_EDGE_LIMIT||width*height>IMAGE_SOURCE_PIXEL_LIMIT)throw new Error('This image is too large to decode safely. Use an image below 64 megapixels and 16,384 pixels per side.');
  if(!Number.isFinite(maxEdge)||maxEdge<1)throw new Error('The image size limit is invalid.');
  const scale=Math.min(1,maxEdge/Math.max(width,height));
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

function loadBrowserImage(src){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    const timer=setTimeout(()=>finish(new Error('The image took too long to open. Try a smaller PNG, JPEG or WebP image.')),LOAD_TIMEOUT);
    timer.unref?.();
    function finish(error){clearTimeout(timer);image.onload=null;image.onerror=null;error?reject(error):resolve(image);}
    image.onload=()=>finish();
    image.onerror=()=>finish(new Error('This image could not be opened. Try saving it as PNG, JPEG or WebP.'));
    image.src=src;
  });
}

function canonicalCanvasData(canvas,type,quality){
  let data;
  try{data=canvas.toDataURL(type,quality);}catch{throw new Error('This image could not be converted for the 3D scene. Try a PNG or JPEG image.');}
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)?data:null;
}

// Normalize local raster files rather than retaining file URLs or external references.
// PNG/WebP retain transparency, including after a large image is resampled.
export async function readImagePlaneFile(file){
  if(!file||!Number.isFinite(file.size)||file.size<=0)throw new Error('Choose a non-empty image file.');
  if(file.size>IMAGE_FILE_BYTE_LIMIT)throw new Error('Choose an image smaller than 20 MB.');
  const name=String(file.name||'Image'),type=String(file.type||'').toLowerCase();
  if(type.includes('svg')||/\.svgz?$/i.test(name))throw new Error('SVG files are not supported. Export the image as PNG, JPEG or WebP first.');
  if(type&&!type.startsWith('image/'))throw new Error('Choose an image file such as PNG, JPEG or WebP.');
  if(!type&&!/\.(?:png|jpe?g|webp|gif|bmp|avif|ico|heic|heif|tiff?)$/i.test(name))throw new Error('Choose an image file such as PNG, JPEG or WebP.');
  if(file.slice){
    const prefix=new TextDecoder().decode(await file.slice(0,1_024).arrayBuffer()).trimStart();
    if(prefix.startsWith('<'))throw new Error('Vector or document files are not supported. Export this image as PNG, JPEG or WebP first.');
  }
  const sourceUrl=URL.createObjectURL(file);
  let image;
  try{image=await loadBrowserImage(sourceUrl);}finally{URL.revokeObjectURL(sourceUrl);}
  const sourceWidth=image.naturalWidth||image.width,sourceHeight=image.naturalHeight||image.height;
  let dimensions=normalizedImageDimensions(sourceWidth,sourceHeight);
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');
  if(!context)throw new Error('Your browser could not prepare this image. Try reloading the page.');
  let dataUrl;
  for(let attempt=0;attempt<9;attempt++){
    canvas.width=dimensions.width;canvas.height=dimensions.height;
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.clearRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    const png=canonicalCanvasData(canvas,'image/png');
    const webp=canonicalCanvasData(canvas,'image/webp',.92);
    const candidates=[png,webp].filter(Boolean).sort((a,b)=>a.length-b.length);
    dataUrl=candidates.find(value=>value.length<=DATA_URL_LIMIT);
    if(dataUrl)break;
    for(const quality of [.82,.7,.55]){
      const compressed=canonicalCanvasData(canvas,'image/webp',quality);
      if(compressed&&compressed.length<=DATA_URL_LIMIT){dataUrl=compressed;break;}
    }
    if(dataUrl)break;
    const nextEdge=Math.floor(Math.max(dimensions.width,dimensions.height)*.75);
    dimensions=normalizedImageDimensions(sourceWidth,sourceHeight,Math.max(1,nextEdge));
  }
  if(!dataUrl)throw new Error('This image could not be reduced below the 2 MB scene image limit. Try a smaller image.');
  return {
    name:name.replace(/\.[^.]+$/,'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120)||'Image',
    dataUrl,
    aspect:sourceWidth/sourceHeight
  };
}

export function applyImagePlaneTransform(object,image){
  object.position.set(image.x,image.y,image.z);
  object.scale.set(image.width,image.height,1);
  object.rotation.set(...image.rotation.map(THREE.MathUtils.degToRad),'XYZ');
  object.updateMatrix();
}

export function createImagePlanes({scene,onReady=()=>{},onError=()=>{}}){
  const group=new THREE.Group(),outlines=new THREE.Group();
  group.name='Image planes';outlines.name='Image selection';scene.add(group,outlines);
  const geometry=new THREE.PlaneGeometry(1,1);
  const edgeGeometry=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-.5,-.5,0),new THREE.Vector3(.5,-.5,0),new THREE.Vector3(.5,.5,0),new THREE.Vector3(-.5,.5,0)
  ]);
  const edgeMaterial=new THREE.LineBasicMaterial({color:0x14a58c,depthTest:false,depthWrite:false,transparent:true});
  const entries=new Map();
  const waiters=new Set();
  let activeId=null,editingVisible=true,disposed=false,revision=0;

  function changed(){revision++;for(const resolve of waiters)resolve();waiters.clear();}

  function refresh(record){
    const image=record.image;
    const wantedVisible=image.visible!==false&&image.opacity>0;
    if(record.wantedVisible!==undefined&&record.wantedVisible!==wantedVisible)changed();
    record.wantedVisible=wantedVisible;
    applyImagePlaneTransform(record.mesh,image);applyImagePlaneTransform(record.outline,image);
    record.mesh.material.opacity=image.opacity;
    record.mesh.visible=wantedVisible&&!!record.texture;
    record.outline.visible=record.mesh.visible&&image.id===activeId;
  }

  function remove(record){
    record.disposed=true;
    record.cancel?.();
    record.texture?.dispose();record.mesh.material.dispose();
    record.mesh.removeFromParent();record.outline.removeFromParent();
  }

  function make(image){
    const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide,transparent:true,opacity:image.opacity,alphaTest:.01,depthTest:true,depthWrite:true,toneMapped:false});
    const mesh=new THREE.Mesh(geometry,material),outline=new THREE.LineLoop(edgeGeometry,edgeMaterial);
    mesh.userData.imageId=image.id;outline.renderOrder=1_000;
    group.add(mesh);outlines.add(outline);
    const record={image,dataUrl:image.dataUrl,mesh,outline,texture:null,error:null,disposed:false,cancel:null,promise:null};
    refresh(record);
    record.promise=new Promise((resolve,reject)=>{
      const source=new Image();let finished=false;
      const timer=setTimeout(()=>finish(new Error('The scene image took too long to load. Reload or replace this image.')),LOAD_TIMEOUT);
      timer.unref?.();
      function finish(error,cancelled=false){
        if(finished)return;finished=true;clearTimeout(timer);source.onload=null;source.onerror=null;
        if(cancelled||record.disposed||disposed){resolve(null);return;}
        if(error){record.error=error;reject(error);onError(error,image.id);return;}
        const texture=new THREE.Texture(source);texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
        record.texture=texture;record.mesh.material.map=texture;record.mesh.material.needsUpdate=true;refresh(record);
        resolve(texture);onReady(image.id);
      }
      record.cancel=()=>{finish(null,true);try{source.src='';}catch{}};
      source.onload=()=>finish();
      source.onerror=()=>finish(new Error(`Could not load the scene image “${image.name||'Image'}”. Hide, replace or remove it before exporting.`));
      source.src=image.dataUrl;
    });
    // A failed texture is reported immediately and again by ready() before export.
    record.promise.catch(()=>{});
    return record;
  }

  function sync(images,selectedId=null){
    if(disposed)return;
    activeId=selectedId;
    const wanted=new Set(images.map(image=>image.id));
    for(const [id,record] of entries){
      if(!wanted.has(id)){remove(record);entries.delete(id);changed();}
    }
    for(const image of images){
      let record=entries.get(image.id);
      if(record&&record.dataUrl!==image.dataUrl){remove(record);entries.delete(image.id);record=null;changed();}
      if(!record){record=make(image);entries.set(image.id,record);changed();}
      record.image=image;refresh(record);
    }
    outlines.visible=editingVisible;
  }

  function updateTransforms(images){
    if(disposed)return;
    for(const image of images){const record=entries.get(image.id);if(record){record.image=image;refresh(record);}}
  }

  function meshes(){return [...entries.values()].filter(record=>record.mesh.visible).map(record=>record.mesh);}

  function bounds(){
    const box=new THREE.Box3();
    for(const record of entries.values()){
      if(!record.wantedVisible||record.error)continue;
      record.mesh.updateWorldMatrix(true,false);box.expandByObject(record.mesh);
    }
    return box;
  }

  async function ready(){
    while(!disposed){
      const version=revision,records=[...entries.values()].filter(record=>record.wantedVisible);
      let notifyChanged;
      const nextChange=new Promise(resolve=>{notifyChanged=resolve;waiters.add(resolve);});
      try{await Promise.race([Promise.allSettled(records.map(record=>record.promise)),nextChange]);}
      finally{waiters.delete(notifyChanged);}
      if(disposed)break;
      if(revision!==version)continue;
      const failed=records.find(record=>record.error);
      if(failed)throw failed.error;
      return;
    }
    throw new Error('The image renderer is no longer available.');
  }

  function dispose(){
    if(disposed)return;disposed=true;changed();
    for(const record of entries.values())remove(record);
    entries.clear();group.removeFromParent();outlines.removeFromParent();
    geometry.dispose();edgeGeometry.dispose();edgeMaterial.dispose();
  }

  return {sync,updateTransforms,meshes,bounds,ready,dispose,setEditingVisible(value){editingVisible=!!value;outlines.visible=editingVisible;}};
}
