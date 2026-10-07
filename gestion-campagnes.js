import { getCampaigns, saveCampaign, requireAccess, getPortalMode, signOut, onSessionChange } from './portal-service.js';

const $ = id => document.getElementById(id);
const form = $('campaign-form');
const names = {facebook:'Facebook',instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok',display:'Display'};
const integers = ['impressions','clicks','views','trueviews','interactions'];
const numeric = ['budget','spend',...integers];
const fields = ['channel','name','start','end',...numeric];
const number = new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2});
const percent = new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2});
const ctrValue = (clicks,impressions) => Number.isFinite(clicks)&&clicks>=0&&Number.isFinite(impressions)&&impressions>=0 ? (impressions>0?clicks/impressions*100:clicks===0?0:null) : null;
const ctr = (clicks,impressions) => {const value=ctrValue(clicks,impressions);return value==null?'—':`${percent.format(value)} %`;};
const date = value => new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${value}T12:00:00`));
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const channel = typeof BroadcastChannel==='function' ? new BroadcastChannel('richmedia-campaigns') : null;
let campaigns = [], editing = null, pendingArchive = null, dirty = false, busy = false, ready = false;
let accessGeneration=0, loggingOut=false;
const canApply=generation=>generation===accessGeneration&&!loggingOut;

async function request(path='/api/campaigns',method='GET',payload) {
  if(method==='GET')return getCampaigns();
  const id=path.split('/')[3]||null;
  return saveCampaign(payload,{id,archive:path.endsWith('/archive')});
}
function notice(message,error=false) {
  $('form-message').textContent=message;
  $('form-message').classList.toggle('error',error);
  $('form-message').hidden=!message;
}
function setBusy(value) {
  busy=value;
  $('form-fields').disabled=value||!ready;
  $('save-button').disabled=value||!ready;
  $('reset-form').disabled=value||!ready;
  $('save-button').innerHTML=value?'Enregistrement…':`${editing?'Mettre à jour les chiffres':'Enregistrer la campagne'} <span aria-hidden="true">↗</span>`;
  document.querySelectorAll('[data-edit],[data-archive],[data-restore]').forEach(el=>el.disabled=value||!ready);
}
function updateCTR() {
  const impressions=$('impressions').valueAsNumber, clicks=$('clicks').valueAsNumber;
  $('ctr').value=ctr(clicks,impressions);
}
function clearValidation() {fields.forEach(name=>form.elements.namedItem(name).setCustomValidity(''));}
function resetForm() {
  editing=null;form.reset();clearValidation();dirty=false;
  const today=new Date(), localDate=new Date(today.getTime()-today.getTimezoneOffset()*60000).toISOString().slice(0,10);
  $('start').value=localDate.slice(0,8)+'01';$('end').value=localDate;
  $('form-title').innerHTML='Nouvelle campagne<span>.</span>';
  $('form-intro').textContent='Renseignez les résultats cumulés sur la période choisie.';
  notice('');updateCTR();setBusy(false);
}
function canDiscard() {return !dirty||window.confirm('Abandonner les modifications non enregistrées ?');}
function edit(record) {
  if(!canDiscard())return;
  editing={...record};clearValidation();
  fields.forEach(name=>{form.elements.namedItem(name).value=record[name]??'';});
  dirty=false;
  $('form-title').innerHTML='Actualiser les chiffres<span>.</span>';
  $('form-intro').textContent='Les nouveaux totaux remplaceront ceux de cette campagne.';
  notice('');updateCTR();setBusy(false);
  $('campaign-name').focus({preventScroll:true});
  document.querySelector('.editor-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function renderList(updatedAt) {
  const active=campaigns.filter(c=>c.status==='active');
  const visible=campaigns.filter(c=>$('show-archived').checked||c.status==='active');
  $('campaign-count').textContent=active.length;
  $('total-budget').textContent=`${number.format(active.reduce((sum,c)=>sum+c.budget,0))} MAD`;
  if(updatedAt!==undefined)$('last-saved').textContent=updatedAt?new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(updatedAt)):'Aucune saisie';
  $('list-count').textContent=visible.length;
  $('list-empty').hidden=visible.length>0;
  $('campaign-list').innerHTML=visible.map(c=>`<tr class="${c.status==='archived'?'archived-row':''}"><td>${escape(c.name)}${c.status==='archived'?'<small>Archivée · hors dashboard</small>':''}</td><td><span class="channel-pill">${names[c.channel]}</span></td><td>${date(c.start)}<small>au ${date(c.end)}</small></td><td class="numeric">${number.format(c.budget)}</td><td class="numeric">${number.format(c.impressions)}</td><td class="numeric">${c.reach==null?'—':number.format(c.reach)}</td><td class="numeric">${c.reach>0?percent.format(c.impressions/c.reach):'—'}</td><td class="numeric">${number.format(c.clicks)}</td><td class="numeric">${ctr(c.clicks,c.impressions)}</td><td><div class="row-actions">${c.status==='active'?`<button class="row-action" data-edit="${c.id}" aria-label="Modifier ${escape(c.name)}">Modifier</button><button class="row-action archive" data-archive="${c.id}" aria-label="Archiver ${escape(c.name)}">Archiver</button>`:`<button class="row-action" data-restore="${c.id}" aria-label="Restaurer ${escape(c.name)}">Restaurer</button>`}</div></td></tr>`).join('');
}
function acceptSaved(data,generation) {
  if(!canApply(generation))return false;
  const index=campaigns.findIndex(c=>c.id===data.campaign.id);
  if(index<0)campaigns.unshift(data.campaign);else campaigns[index]=data.campaign;
  renderList(data.updatedAt);
  channel?.postMessage({type:'updated'});
  return true;
}
form.addEventListener('input',event=>{
  dirty=true;notice('');
  if(event.target.setCustomValidity)event.target.setCustomValidity('');
  if(['start','end'].includes(event.target.name))$('end').setCustomValidity('');
  updateCTR();
});
form.addEventListener('change',()=>{dirty=true;});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!ready||loggingOut)return;
  const generation=accessGeneration;
  clearValidation();
  if($('end').value<$('start').value)$('end').setCustomValidity('La date de fin doit être égale ou postérieure à la date de début.');
  $('campaign-name').value=$('campaign-name').value.trim();
  if(!form.reportValidity())return;
  const payload=Object.fromEntries(fields.map(name=>{const value=form.elements.namedItem(name).value;return [name,numeric.includes(name)?(value===''?null:Number(value)):value];}));
  if(editing)payload.revision=editing.revision;
  const wasEditing=Boolean(editing);setBusy(true);notice('');
  try {
    const data=await request(editing?`/api/campaigns/${editing.id}`:'/api/campaigns',editing?'PUT':'POST',payload);
    if(!acceptSaved(data,generation))return;
    editing={...data.campaign};dirty=false;
    $('form-title').innerHTML='Actualiser les chiffres<span>.</span>';
    $('form-intro').textContent='Les nouveaux totaux remplaceront ceux de cette campagne.';
    notice(wasEditing?'Chiffres mis à jour. Le dashboard affiche les nouveaux totaux.':'Campagne enregistrée. Ses chiffres sont maintenant disponibles dans le dashboard.');
  } catch(error) {
    if(!canApply(generation))return;
    if(error.status===401||error.status===403){denyAccess(error);return;}
    notice(error.status===409?'Cette campagne a été modifiée dans une autre fenêtre. Votre saisie est conservée. Copiez vos changements puis rechargez la page pour repartir de la dernière version.':error.message,true);
    if(error.fields)Object.entries(error.fields).forEach(([name,message])=>{const control=form.elements.namedItem(name);control?.setCustomValidity(message);});
  } finally {if(canApply(generation))setBusy(false);}
});
$('reset-form').addEventListener('click',()=>{if(canDiscard()){resetForm();$('channel').focus();}});
$('show-archived').addEventListener('change',()=>renderList());
$('campaign-list').addEventListener('click',async event=>{
  if(busy||!ready||loggingOut)return;
  const generation=accessGeneration;
  const button=event.target.closest('[data-edit],[data-archive],[data-restore]');if(!button)return;
  const id=button.dataset.edit||button.dataset.archive||button.dataset.restore;
  const record=campaigns.find(c=>c.id===id);if(!record)return;
  if(button.dataset.edit){edit(record);return;}
  if(button.dataset.archive){
    if(editing?.id===id&&!canDiscard())return;
    pendingArchive=record;$('archive-copy').textContent=record.name;$('archive-error').hidden=true;$('archive-dialog').showModal();return;
  }
  setBusy(true);
  try {const data=await request(`/api/campaigns/${id}`,'PUT',{...record,status:'active'});if(!acceptSaved(data,generation))return;notice('Campagne restaurée. Ses résultats sont à nouveau visibles dans le dashboard.');}
  catch(error){if(!canApply(generation))return;if(error.status===401||error.status===403)denyAccess(error);else{notice(error.message,true);$('form-message').scrollIntoView({block:'center'});}}
  finally{if(canApply(generation))setBusy(false);}
});
$('cancel-archive').addEventListener('click',()=>$('archive-dialog').close());
$('confirm-archive').addEventListener('click',async()=>{
  if(!pendingArchive||busy||!ready||loggingOut)return;
  const generation=accessGeneration;
  setBusy(true);$('confirm-archive').disabled=true;$('cancel-archive').disabled=true;
  try {
    const data=await request(`/api/campaigns/${pendingArchive.id}/archive`,'POST',{revision:pendingArchive.revision});
    if(!acceptSaved(data,generation))return;
    if(editing?.id===pendingArchive.id)resetForm();
    $('archive-dialog').close();notice('Campagne archivée. Ses chiffres ont été retirés du dashboard.');pendingArchive=null;
  } catch(error){if(!canApply(generation))return;if(error.status===401||error.status===403)denyAccess(error);else{$('archive-error').textContent=error.message;$('archive-error').hidden=false;}}
  finally{if(canApply(generation)){setBusy(false);$('confirm-archive').disabled=false;$('cancel-archive').disabled=false;}}
});
$('archive-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
window.addEventListener('beforeunload',event=>{if(dirty||busy){event.preventDefault();event.returnValue='';}});
function denyAccess(error) {
  accessGeneration+=1;
  ready=false;campaigns=[];editing=null;pendingArchive=null;dirty=false;
  form.reset();updateCTR();renderList(null);setBusy(false);
  $('archive-dialog').close();
  document.querySelector('.editor-card').hidden=true;
  document.querySelector('.campaigns-card').hidden=true;
  $('load-error').textContent=error.status===403?'Cet espace est réservé à l’équipe Richmedia. Votre accès permet de consulter le dashboard.':'Votre session a expiré. Reconnectez-vous pour continuer.';
  $('load-error').hidden=false;
}
async function loadPage() {
  if(loggingOut)return;
  const generation=accessGeneration;
  try {
    await requireAccess({admin:true});
    if(!canApply(generation))return;
    const data=await request();
    if(!canApply(generation))return;
    campaigns=data.campaigns;ready=true;renderList(data.updatedAt);setBusy(false);
    document.querySelector('.editor-card').hidden=false;document.querySelector('.campaigns-card').hidden=false;$('load-error').hidden=true;
  } catch(error) {
    if(!canApply(generation))return;
    if(error.status===401||error.status===403)denyAccess(error);
    else{$('load-error').textContent=error.message;$('load-error').hidden=false;ready=false;setBusy(false);}
  }
}
resetForm();
if(getPortalMode()==='supabase') {
  document.querySelector('.access-mode').textContent='Accès Richmedia · Données Supabase';
  $('admin-signout').hidden=false;
  $('admin-signout').addEventListener('click',async()=>{
    if(loggingOut||busy||!canDiscard())return;
    loggingOut=true;$('admin-signout').disabled=true;
    denyAccess({status:401});
    try{await signOut();}catch{/* Local session is cleared even when the server is unavailable. */}finally{location.assign('index.html');}
  });
  onSessionChange(event=>{
    if(event==='SIGNED_OUT'){loggingOut=true;$('admin-signout').disabled=true;denyAccess({status:401});location.replace('index.html?next=gestion-campagnes.html');}
  });
  window.addEventListener('focus',async()=>{
    if(loggingOut)return;
    const generation=accessGeneration;
    try{await requireAccess({admin:true});}catch(error){if(canApply(generation)&&[401,403].includes(error.status))denyAccess(error);}
  });
}
await loadPage();
