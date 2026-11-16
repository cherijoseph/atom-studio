import {isLocked} from './lock-schema-source.js';

export function lockedSets(items){
  const sets=new Map();
  for(const item of items){
    if(!isLocked(item))continue;
    const key=item.lockGroup||'legacy';
    if(!sets.has(key))sets.set(key,{key,name:item.lockLabel||'Locked objects',items:[]});
    sets.get(key).items.push(item);
  }
  return [...sets.values()];
}

/** Lock batches are editing safeguards, independent of height/material groups. */
export function mountLockingControls({document,getItems,getSelection,canEdit,onLock,onUnlock,onInfo}){
  const $=id=>document.getElementById(id);
  const button=document.createElement('button');button.id='lock-selection';button.className='secondary full';button.textContent='Lock selection';
  $('copy').before(button);
  const imageButton=document.createElement('button');imageButton.id='lock-image';imageButton.className='secondary full';imageButton.textContent='Lock image';
  $('image-delete').parentElement.after(imageButton);
  const card=document.createElement('details');card.id='locked-objects-card';card.className='panel-card';
  card.innerHTML='<summary class="card-heading"><span class="card-icon" aria-hidden="true">▣</span><span class="card-title">Locked objects<small id="locked-count">Nothing locked</small></span><span class="card-chevron" aria-hidden="true"></span></summary><div class="card-body"><p class="hint">Locked objects stay visible and are skipped when selecting or editing. Unlock a set to select it again.</p><div id="locked-list"></div><button id="unlock-all" class="text-button full" disabled>Unlock all objects</button></div>';
  $('image-inspector-card').after(card);
  const dialog=document.createElement('dialog');dialog.id='lock-dialog';dialog.setAttribute('aria-labelledby','lock-dialog-title');
  dialog.innerHTML='<form id="lock-form"><h2 id="lock-dialog-title">Lock selection</h2><p id="lock-dialog-description">Give this set a name so it is easy to unlock later.</p><label for="lock-name">Name</label><input id="lock-name" type="text" maxlength="80" required autocomplete="off"><p class="hint">This prevents accidental edits. It does not change the appearance of your diagram.</p><div class="lock-dialog-actions"><button id="lock-cancel" type="button" class="secondary">Cancel</button><button type="submit" class="primary">Lock objects</button></div></form>';
  document.body.append(dialog);
  let pendingItems=[];
  function open(){
    if(!canEdit()||!getSelection().length)return;
    pendingItems=[...getSelection()];
    $('lock-name').value='Locked selection '+(lockedSets(getItems()).length+1);
    $('lock-dialog-description').textContent=`Protect ${getSelection().length} selected ${getSelection().length===1?'object':'objects'} from accidental edits. Give this set a name to find it later.`;
    dialog.showModal();$('lock-name').select();
  }
  button.onclick=imageButton.onclick=open;
  $('lock-cancel').onclick=()=>dialog.close();
  $('lock-form').onsubmit=event=>{
    event.preventDefault();const current=getSelection();
    if(!canEdit()||current.length!==pendingItems.length||!pendingItems.every(item=>current.includes(item))){dialog.close();onInfo('Selection changed. Select the objects and try locking again.');return;}
    const name=$('lock-name').value.trim().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
    if(!name){onInfo('Enter a name for this locked set.');return;}
    dialog.close();onLock(name);card.open=true;
  };
  $('unlock-all').onclick=()=>{if(canEdit())onUnlock(null);};
  let listKey='';
  function update(){
    const sets=lockedSets(getItems()),count=sets.reduce((sum,set)=>sum+set.items.length,0),key=JSON.stringify(sets.map(set=>[set.key,set.name,set.items.length]));
    button.disabled=imageButton.disabled=!getSelection().length;
    $('locked-count').textContent=count?`${count} ${count===1?'object':'objects'} in ${sets.length} ${sets.length===1?'set':'sets'}`:'Nothing locked';
    $('unlock-all').disabled=!count;
    if(listKey===key)return;listKey=key;$('locked-list').replaceChildren();
    if(!count){const note=document.createElement('p');note.className='hint';note.textContent='Select objects, then choose Lock selection under Actions.';$('locked-list').append(note);}
    for(const set of sets){
      const row=document.createElement('div'),label=document.createElement('span'),name=document.createElement('strong'),count=document.createElement('small'),unlock=document.createElement('button');
      row.className='locked-set';name.textContent=set.name;count.textContent=`${set.items.length} ${set.items.length===1?'object':'objects'}`;label.append(name,count);
      unlock.className='secondary';unlock.textContent='Unlock';unlock.setAttribute('aria-label',`Unlock ${set.name}`);unlock.onclick=()=>{if(canEdit())onUnlock(set.key);};row.append(label,unlock);$('locked-list').append(row);
    }
  }
  return{update,isOpen:()=>dialog.open,reveal(){card.open=true;const panel=card.closest('.panel');if(panel&&panel.scrollHeight>panel.clientHeight){const intro=panel.querySelector('.panel-intro');panel.scrollTo({top:Math.max(0,panel.scrollTop+card.getBoundingClientRect().top-panel.getBoundingClientRect().top-(intro?.offsetHeight||0)-12),behavior:'smooth'});}}};
}
