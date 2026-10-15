import { PLATFORMS, CAMPAIGNS, PERIODS, CAMPAIGN_LAUNCH_DATE, getSummary, getAudience, loadReportingData, getReportingState, clearReportingData } from './reporting-data.js';
import { renderTrend, renderAudience } from './dashboard-charts.js';
import { getPortalMode, signOut, onSessionChange } from './portal-service.js';

const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const reportDate = new Intl.DateTimeFormat('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Africa/Casablanca' });
const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation:'compact', maximumFractionDigits:2 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {meta:'∞',youtube:'▶',tiktok:'♪',display:'▣'};
const channelLabels={facebook:'Facebook',instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok',display:'Display'};
const channelNames = {meta:'Meta · Facebook & Instagram',youtube:'YouTube',tiktok:'TikTok',influence:'Influence',display:'Display',sms:'SMS',whatsapp:'WhatsApp',email:'Emailing'};
const metricNames = {impressions:'Impressions',clicks:'Clics',reach:'Reach',spend:'Dépenses'};
const state = {view:'overview',period:'oct',platform:'all',campaign:'all',trend:'impressions',audience:'impressions',audienceView:'charts'};
let summary, audience, resizeTimer, exportUrl, loading=null, initialized=false;
let accessGeneration=0, loggingOut=false;
const manual = () => getReportingState().mode==='manual';
const inactive = () => ['influence','sms','whatsapp','email'].includes(state.view)||(state.view==='display'&&!manual());
const query = () => ({period:state.period,platform:state.platform,campaign:state.campaign});
const pct = (part,total) => total ? `${percent.format(part/total*100)} %` : '—';
const ctrValue = (clicks,impressions) => Number.isFinite(clicks)&&clicks>=0&&Number.isFinite(impressions)&&impressions>=0 ? (impressions>0?clicks/impressions*100:clicks===0?0:null) : null;
const ctr = (clicks,impressions) => {const value=ctrValue(clicks,impressions);return value==null?'—':`${percent.format(value)} %`;};
const value = (amount,format=number) => amount==null?'—':format.format(amount);
const money = amount => amount==null?'—':`${decimal.format(amount)} MAD`;
const date = input => new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(`${input}T12:00:00`));
const arrow = '<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';

function openDialog(title,content) {
  $('dialog-title').textContent=title;
  $('dialog-content').innerHTML=content;
  $('dashboard-dialog').showModal();
}
function closeNav() {
  $('sidebar').classList.remove('open');
  $('nav-backdrop').hidden=true;
  $('open-nav').setAttribute('aria-expanded','false');
  if(innerWidth<=760) $('sidebar').inert=true;
}
function updateNavAccessibility() {
  $('sidebar').inert=innerWidth<=760&&!$('sidebar').classList.contains('open');
}
function setView(view) {
  state.view=['overview','campaigns',...Object.keys(channelNames)].includes(view)?view:'overview';
  state.platform=channelNames[state.view]?state.view:'all';
  state.campaign='all';
  closeNav();
  render();
  window.scrollTo({top:0,behavior:'instant'});
}

function renderFilters() {
  const selectedPlatform=state.platform;
  const choices=[{id:'all',name:'Toutes les plateformes'},...PLATFORMS];
  if(inactive()&&!choices.some(p=>p.id===state.view)) choices.push({id:state.view,name:channelNames[state.view]});
  $('platform-filter').innerHTML=choices.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('platform-filter').value=selectedPlatform;
  $('platform-filter').disabled=Boolean(channelNames[state.view]);
  $('platform-filter-wrap').hidden=state.view==='campaigns';
  $('campaign-channel-filter-wrap').hidden=state.view!=='campaigns';
  $('campaign-channel-filter').innerHTML='<option value="all">Tous les canaux</option>'+PLATFORMS.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');
  $('campaign-channel-filter').value=state.platform;
  const campaigns=CAMPAIGNS.filter(c=>state.platform==='all'||c.platform===state.platform);
  $('campaign-filter').innerHTML='<option value="all">Toutes les campagnes</option>'+campaigns.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');
  $('campaign-filter').value=state.campaign;
  $('campaign-filter').disabled=inactive();
  $('period-filter').innerHTML=PERIODS.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
  $('period-filter').value=state.period;
}
function renderKpis() {
  const t=summary.totals;
  $('kpi-impressions').textContent=number.format(t.impressions);
  $('kpi-clicks').textContent=number.format(t.clicks);
  $('kpi-reach').textContent=value(t.reach);
  $('kpi-ctr').textContent=summary.rows.length?ctr(t.clicks,t.impressions):'—';
  $('kpi-views').textContent=value(t.views);
  // This miniature follows the same selected data as the full chart.
  const points=summary.timeline.map((r,i,rows)=>`${i/(Math.max(1,rows.length-1))*76+1},${22-r.impressions/Math.max(1,...rows.map(x=>x.impressions))*20}`).join(' ');
  document.querySelector('.sparkline').innerHTML=`<polyline points="${points}"/>`;
}
function renderCharts() {
  const range=PERIODS.find(p=>p.id===state.period);
  $('trend-subtitle').textContent=summary.timelineEstimated
    ? ''
    : `${range.label} · ${manual()?'résultats renseignés':'résultats simulés'}`;
  $('trend-total').textContent=state.trend==='spend'?money(summary.totals.spend):value(summary.totals[state.trend]);
  $('trend-measure').textContent=metricNames[state.trend];
  document.querySelectorAll('[data-trend]').forEach(b=>{
    b.classList.toggle('selected',b.dataset.trend===state.trend);
    b.setAttribute('aria-pressed',String(b.dataset.trend===state.trend));
  });
  const missingMetric=summary.timeline.some(row=>row[state.trend]==null);
  renderTrend($('trend-chart'),missingMetric?[]:summary.timeline,state.trend);
  if(summary.timelineEstimated) {
    const label=$('trend-chart').querySelector('.trend-footnote span:last-child');
    if(label) label.textContent='Estimation depuis le lancement';
  }
  if(manual()&&((summary.timelineUnavailable&&!summary.timelineEstimated)||missingMetric)) {
    $('trend-chart').innerHTML=`<div class="chart-empty"><span class="chart-empty-symbol" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>${summary.timelineUnavailable?'Détail quotidien non renseigné':'Dépenses non renseignées'}</strong><p>${summary.timelineUnavailable?'Les chiffres saisis sont des totaux sur une période. Une courbe nécessite les résultats jour par jour.':'Renseignez les dépenses pour afficher leur évolution.'}</p></div>`;
  }
  renderAudience($('audience-charts'),audience,{metric:state.audience,view:state.audienceView});
  document.querySelectorAll('[data-audience-view]').forEach(button=>{
    const selected=button.dataset.audienceView===state.audienceView;
    button.classList.toggle('selected',selected);
    button.setAttribute('aria-pressed',String(selected));
  });
  const declaredProfile=Object.values(audience.dimensions||{}).some(dimension=>dimension?.profile==='declared');
  document.querySelector('.audience-footnote').textContent=manual()
    ? declaredProfile
      ? ''
      : 'Répartitions renseignées par sexe, âge et ville.'
    : 'Profil d’audience de démonstration.';
}
function platformCell(platform,name,subtitle='') {
  return `<div class="platform-cell"><span class="platform-badge ${platform}">${icons[platform]||'·'}</span><span>${esc(name)}${subtitle?`<small class="platform-sub">${esc(subtitle)}</small>`:''}</span></div>`;
}
function renderTable() {
  const isCampaigns=state.view!=='overview';
  $('results-table').closest('.results-panel').classList.toggle('campaign-list',state.view==='campaigns');
  const empty=inactive()||!summary.rows.length;
  $('empty-state').hidden=!empty;
  $('show-campaigns').hidden=isCampaigns;
  $('results-title').textContent=state.view==='influence'?'Liste des influenceurs':state.view==='campaigns'?'Toutes les campagnes':channelNames[state.view]?`Campagnes ${channelNames[state.view]}`:'Performances par plateforme';
  $('results-description').textContent=empty?'Aucun résultat sur la sélection actuelle.':manual()?`Résultats cumulés du ${reportDate.format(new Date(`${CAMPAIGN_LAUNCH_DATE}T12:00:00Z`))} au ${reportDate.format(new Date())}.`:'Le détail de vos résultats sur la période sélectionnée.';
  $('results-table').querySelector('caption').textContent=state.view==='influence'?'Liste des influenceurs YES':`Résultats ${manual()?'renseignés':'de démonstration'} pour les filtres sélectionnés`;
  $('empty-state').querySelector('h3').textContent=state.view==='influence'?'Aucun influenceur pour le moment':'Aucune campagne en cours';
  if(empty) {
    const headers=state.view==='influence'?['Influenceur','Plateforme','Campagne','Contenus','Statut','Reach','Fréquence']:['sms','whatsapp','email'].includes(state.view)?['Campagne','Période','Statut','Envois','Délivrés',...(state.view==='email'?['Ouvertures']:[]),'Clics','Reach','Fréquence']:['Campagne','Période','Budget MAD','Impressions','Reach','Fréquence','Clics','CTR','Vues vidéo','Interactions'];
    $('results-head').innerHTML=`<tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr>`;
    $('results-body').innerHTML='';
    $('empty-description').textContent=state.view==='influence'?'Les influenceurs et leurs collaborations avec YES apparaîtront ici lorsqu’ils seront ajoutés.':summary.excludedPartialCount?'Sélectionnez « Toutes les périodes » pour consulter les totaux des campagnes qui couvrent plusieurs mois.':`Vos campagnes ${channelNames[state.view]||''} apparaîtront ici lorsqu’elles seront ajoutées et comprises dans la période sélectionnée.`;
    return;
  }
  const headers=[isCampaigns?'Campagne':'Plateforme','Statut',manual()?'Budget MAD':'Budget trimestre','Impressions','Reach','Fréquence','Vues vidéo','Clics','CTR',...(manual()?['Interactions']:[]),''];
  $('results-head').innerHTML=`<tr>${headers.map((h,i)=>`<th scope="col"${i>1&&i<headers.length-1?' class="numeric"':''}>${h||'<span class="sr-only">Détails</span>'}</th>`).join('')}</tr>`;
  const selectedIds=new Set(summary.rows.map(r=>r.campaignId));
  const records=isCampaigns?CAMPAIGNS.filter(c=>selectedIds.has(c.id)).map(c=>({...getSummary({...query(),campaign:c.id}).byPlatform[0],campaign:c})):summary.byPlatform;
  const rowsHtml=records.map(p=>`<tr><td>${platformCell(p.id,p.campaign?p.campaign.name:p.shortName,p.campaign?`${channelLabels[p.campaign.channel]||p.shortName} · ${date(p.campaign.start)} – ${date(p.campaign.end)}`:p.id==='meta'?'Facebook & Instagram':p.name)}</td><td><span class="status-pill"><i></i>Active</span></td><td class="numeric">${money(p.budget)}</td><td class="numeric">${value(p.impressions)}</td><td class="numeric">${value(p.reach)}</td><td class="numeric">${value(p.frequency,decimal)}</td><td class="numeric">${value(p.views)}</td><td class="numeric">${value(p.clicks)}</td><td class="numeric">${ctr(p.clicks,p.impressions)}</td>${manual()?`<td class="numeric">${value(p.interactions)}</td>`:''}<td><button class="row-button" data-detail="${p.campaign?p.campaign.id:p.id}" aria-label="Voir les détails de ${esc(p.campaign?p.campaign.name:p.shortName)}">${arrow}</button></td></tr>`).join('');
  const t=summary.totals;
  const totalRow=`<tr class="total-row"><td><strong>TOTAL</strong></td><td></td><td class="numeric">${money(summary.budget)}</td><td class="numeric">${value(t.impressions)}</td><td class="numeric">${value(t.reach)}</td><td class="numeric">${value(t.frequency,decimal)}</td><td class="numeric">${value(t.views)}</td><td class="numeric">${value(t.clicks)}</td><td class="numeric">${ctr(t.clicks,t.impressions)}</td>${manual()?`<td class="numeric">${value(t.interactions)}</td>`:''}<td></td></tr>`;
  $('results-body').innerHTML=rowsHtml+totalRow;
}
function renderInsight() {
  const firstCity=[...audience.cities].sort((a,b)=>b.value-a.value)[0];
  const topChannel=[...summary.byPlatform].sort((a,b)=>b.impressions-a.impressions)[0];
  document.querySelector('.insight-heading>div>span').textContent=manual()?'LECTURE DES RÉSULTATS RENSEIGNÉS':'LECTURE DES DONNÉES DE DÉMONSTRATION';
  if(manual()) {
    $('insight-text').innerHTML=topChannel?`<strong>${esc(topChannel.shortName)}</strong> totalise ${number.format(topChannel.impressions)} impressions sur la sélection. Le CTR global est de <strong>${ctr(summary.totals.clicks,summary.totals.impressions)}</strong>. Les chiffres correspondent aux totaux renseignés pour ${summary.totals.activeCampaigns} campagne${summary.totals.activeCampaigns>1?'s':''}.`:'Aucun résultat renseigné sur cette sélection.';
    return;
  }
  if(!topChannel||topChannel.impressions<=0){$('insight-text').textContent='Aucun résultat sur cette sélection.';return;}
  const cityInsight=firstCity?.value>0&&audience.total>0?` <strong>${esc(firstCity.label)}</strong> représente ${pct(firstCity.value,audience.total)} des ${state.audience==='clicks'?'clics':'impressions'}.`:'';
  $('insight-text').innerHTML=`Dans cet exemple, <strong>${esc(topChannel.shortName)}</strong> génère le plus d’impressions sur la sélection.${cityInsight} Les analyses de votre équipe accompagneront vos résultats réels.`;
}
function render() {
  summary=getSummary(query());
  audience=getAudience({...query(),metric:state.audience});
  renderFilters();
  document.querySelector('.nav-count').textContent=CAMPAIGNS.length;
  document.querySelector('.demo-pill').innerHTML=`<i></i>${manual()?'Données renseignées':'Démonstration'}`;
  document.querySelector('.source-indicator').innerHTML=`<i></i>Source : ${manual()?'saisie manuelle':'démonstration'}`;
  $('period-notice').hidden=!summary.excludedPartialCount;
  $('period-notice').textContent=`${summary.excludedPartialCount} campagne${summary.excludedPartialCount>1?'s couvrent':' couvre'} une période plus large que ce mois. Pour consulter ${summary.excludedPartialCount>1?'leurs résultats':'ses résultats'}, choisissez « Toutes les périodes ».`;
  document.querySelectorAll('[data-view]').forEach(a=>{
    const selected=a.dataset.view===state.view;a.classList.toggle('active',selected);
    if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
  const title=state.view==='overview'?'Vue d’ensemble':state.view==='campaigns'?'Toutes les campagnes':channelNames[state.view];
  $('page-title').innerHTML=`${esc(title)}<span class="title-dot">.</span>`;
  $('page-description').textContent=state.view==='influence'?'Le suivi de vos collaborations YES.':state.view==='overview'?'Vos campagnes, en un coup d’œil.':state.view==='campaigns'?'Toutes vos activations YES, au même endroit.':`Le suivi de vos campagnes YES sur ${channelNames[state.view]}.`;
  document.title=`${title} · Richmedia × YES`;
  $('overview-content').hidden=inactive()||state.view==='campaigns';
  $('kpi-grid').hidden=inactive();
  $('bottom-content').hidden=inactive()||state.view==='campaigns';
  const resultsPanel=$('results-table').closest('.results-panel');
  const resultsPosition=['meta','tiktok','youtube'].includes(state.view)?$('kpi-grid'):$('bottom-content');
  if(resultsPanel.nextElementSibling!==resultsPosition)resultsPosition.before(resultsPanel);
  renderKpis();renderTable();
  if(!$('overview-content').hidden){renderCharts();renderInsight();}
  $('announcement').textContent=`${title}. ${PERIODS.find(p=>p.id===state.period).label}. ${inactive()?'Aucune campagne.':`${number.format(summary.totals.impressions)} impressions ${manual()?'renseignées':'de démonstration'}.`}`;
}
function showDetail(id) {
  const campaign=CAMPAIGNS.find(c=>c.id===id);
  const p=PLATFORMS.find(p=>p.id===(campaign?.platform||id));
  if(!p)return;
  const data=getSummary({...query(),platform:p.id,campaign:campaign?.id||state.campaign}).totals;
  const range=PERIODS.find(r=>r.id===state.period);
  if(manual()) {
    const selection=getSummary({...query(),platform:p.id,campaign:campaign?.id||state.campaign});
    openDialog(campaign?.name||p.name,`<p><strong>Saisie manuelle · ${esc(campaign?channelLabels[campaign.channel]:p.name)}</strong><br>${campaign?`${date(campaign.start)} – ${date(campaign.end)}`:esc(range.label)}</p><div class="detail-grid">${[['Impressions',value(data.impressions)],['Reach',value(data.reach)],['Fréquence',value(data.frequency,decimal)],['Clics',value(data.clicks)],['CTR',ctr(data.clicks,data.impressions)],['Budget',money(selection.budget)],['Dépenses réelles',money(data.spend)],['Vues de vidéos',value(data.views)],['Interactions',value(data.interactions)]].map(([label,amount])=>`<div><small>${label}</small><strong>${amount}</strong></div>`).join('')}</div><p>Totaux cumulés sur les périodes renseignées. « — » signifie que la donnée n’a pas été renseignée.</p>`);
    return;
  }
  openDialog(campaign?.name||p.name,`<p><strong>Données de démonstration · ${esc(range.label)}</strong><br>Les résultats ci-dessous sont fictifs.</p><div class="detail-grid"><div><small>Impressions</small><strong>${compact.format(data.impressions)}</strong></div><div><small>Vues vidéo · ${esc(p.shortName)}</small><strong>${compact.format(data.views)}</strong></div><div><small>Dépenses simulées</small><strong>${money(data.spend)}</strong></div><div><small>Clics</small><strong>${number.format(data.clicks)}</strong></div></div><p>Budget prévu au plan média pour ce canal : <strong>${money(p.budget)} HT</strong> sur octobre–décembre 2026.<br>CPM simulé : ${data.impressions?decimal.format(data.spend/data.impressions*1000):'—'} DH · CTR : ${ctr(data.clicks,data.impressions)}.</p><p>La portée unique et les placements Facebook / Instagram seront affichés lorsqu’une source permettra de les mesurer séparément.</p>`);
}
function exportReport() {
  const range=PERIODS.find(p=>p.id===state.period);
  const records=[['Type','Période','Plateforme','Campagne','Date','Dimension','Catégorie','Mesure','Valeur','Unité','Source']];
  summary.rows.forEach(r=>{
    const campaign=CAMPAIGNS.find(c=>c.id===r.campaignId);
    for(const metric of ['impressions','reach','frequency','clicks','views','spend',...(manual()?['interactions','ctr']:[])])records.push(['Résultat',manual()?`${r.start} / ${r.end}`:range.label,channelLabels[r.channel]||channelNames[r.platform],campaign.name,manual()?'':r.date,'','',metric,(metric==='ctr'?ctrValue(r.clicks,r.impressions):r[metric])??'',metric==='spend'?'MAD':metric==='ctr'?'%':metric==='frequency'?'fois':'nombre',manual()?'Saisie manuelle — cumul sur la période':'DÉMONSTRATION — fictif']);
  });
  if(manual())summary.rows.forEach(r=>records.push(['Budget',`${r.start} / ${r.end}`,channelLabels[r.channel],CAMPAIGNS.find(c=>c.id===r.campaignId).name,'','','','Budget',r.budget,'MAD','Saisie manuelle']));
  else summary.byPlatform.forEach(p=>records.push(['Budget prévu','Octobre–Décembre 2026',p.name,'','','','','Budget trimestre',p.budget,'MAD HT','Plan média fourni']));
  const effectiveCampaign=CAMPAIGNS.find(c=>c.id===state.campaign);
  const audiencePlatform=summary.byPlatform.length===1?summary.byPlatform[0].name:'Tous les canaux';
  if(summary.rows.length)for(const [key,label]of [['gender','Sexe'],['ages','Âge'],['cities','Ville']]){
    const detail=audience.dimensions?.[key];
    const scope=manual()?`Saisie manuelle — ${detail?.partial?'données partielles — ':''}${detail?.availableCampaigns??0}/${detail?.campaignCount??0} campagnes renseignées — total renseigné : ${detail?.reportedTotal??0} — base des parts : ${detail?.total??audience.total??0}${audience.total==null?' (données renseignées, total Reach inconnu)':' (total sélectionné)'}`:'DÉMONSTRATION — fictif';
    audience[key].forEach(r=>records.push(['Audience',range.label,audiencePlatform,effectiveCampaign?.name||'Toutes les campagnes','',label,r.label,state.audience,r.value,state.audience==='reach'?'personnes':'nombre',scope]));
  }
  if(!summary.rows.length)records.push(['Aucune campagne',range.label,channelNames[state.view]||'','','','','','','','','Aucun résultat renseigné']);
  const csv='\uFEFF'+records.map(r=>r.map(v=>`"${(typeof v==='string'&&/^[\s]*[=+@-]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  if(exportUrl)URL.revokeObjectURL(exportUrl);
  exportUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const filename=`Richmedia-YES-${manual()?'SAISIE':'DEMONSTRATION'}-${state.view}-${state.period}.csv`;
  openDialog('Votre rapport est prêt.',`<p><strong>${esc(range.label)} · ${esc(audiencePlatform)}</strong></p><p>${manual()?`Le fichier reprend les totaux cumulés, les périodes, les budgets et les répartitions d’audience disponibles pour la mesure ${esc(metricNames[state.audience])}. La source précise les données partielles. Les cellules vides correspondent aux données non renseignées.`:'Le fichier reprend les résultats quotidiens, le budget prévu et les répartitions d’audience disponibles. Les résultats fictifs sont identifiés.'}</p><a class="download-link" href="${exportUrl}" download="${filename}">Télécharger le rapport CSV ${arrow}</a>`);
  $('announcement').textContent='Rapport CSV préparé pour les filtres sélectionnés.';
}

$('period-filter').addEventListener('change',e=>{state.period=e.target.value;render();});
$('platform-filter').addEventListener('change',e=>{state.platform=e.target.value;state.campaign='all';render();});
$('campaign-channel-filter').addEventListener('change',e=>{state.platform=e.target.value;state.campaign='all';render();});
$('campaign-filter').addEventListener('change',e=>{state.campaign=e.target.value;render();});
$('audience-metric').addEventListener('change',e=>{state.audience=e.target.value;render();});
document.querySelectorAll('[data-audience-view]').forEach(button=>button.addEventListener('click',()=>{state.audienceView=button.dataset.audienceView;renderCharts();}));
document.querySelectorAll('[data-trend]').forEach(button=>button.addEventListener('click',()=>{state.trend=button.dataset.trend;renderCharts();}));
$('results-body').addEventListener('click',e=>{const button=e.target.closest('[data-detail]');if(button)showDetail(button.dataset.detail);});
$('show-campaigns').addEventListener('click',()=>{location.hash='campaigns';});
$('back-overview').addEventListener('click',()=>{location.hash='overview';});
$('export-report').addEventListener('click',exportReport);
const about=()=>openDialog('Vos données de campagne.',manual()?`<p>Les résultats affichés proviennent des <strong>saisies de l’équipe Richmedia</strong>.</p><ul><li>Chaque campagne contient un total cumulé sur la période indiquée. Une mise à jour remplace le total précédent.</li><li>Un filtre mensuel retient seulement les campagnes dont toute la période de saisie est comprise dans ce mois.</li><li>Les champs inconnus apparaissent avec « — ». Un total incomplet reste non renseigné.</li><li>Le budget est distinct des dépenses réellement saisies.</li><li>Les répartitions par sexe, âge et ville proviennent des détails d’audience renseignés.</li><li>Les courbes quotidiennes nécessitent des résultats jour par jour.</li></ul><p>Les connexions aux plateformes publicitaires ne sont pas encore actives.</p>`:`<p>Cet espace présente le suivi de campagne <strong>Richmedia pour YES Baby Comfort</strong>.</p><ul><li>Les résultats et profils actuels sont simulés.</li><li>Les budgets média de Meta 40 000 MAD, YouTube 53 000 MAD et TikTok 45 000 MAD HT proviennent du plan fourni.</li><li>La première campagne enregistrée par l’équipe remplacera ce jeu de démonstration.</li></ul><p>Les connexions aux plateformes publicitaires ne sont pas encore actives.</p>`);
$('help-button').addEventListener('click',about);
$('contact-agency').addEventListener('click',()=>openDialog('Votre équipe Richmedia.',`<p>Pour échanger sur votre campagne ou votre accès, contactez votre interlocuteur Richmedia.</p><p><a href="mailto:contact@richmedia.ma">contact@richmedia.ma</a></p><p>Ce lien ouvre votre messagerie. Aucun message n’est envoyé automatiquement.</p>`));
$('view-creative').addEventListener('click',()=>openDialog('L’univers de campagne YES.',`<p>Visuel extrait du plan média fourni. Sa présence dans cette bibliothèque ne signifie pas qu’il a été diffusé.</p><img src="assets/yes-campaign.png" alt="Page de présentation de la campagne YES Baby Comfort">`));
$('close-dialog').addEventListener('click',()=>$('dashboard-dialog').close());$('dialog-done').addEventListener('click',()=>$('dashboard-dialog').close());
$('dashboard-dialog').addEventListener('click',e=>{const r=$('dashboard-dialog').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('dashboard-dialog').close();});
$('open-nav').addEventListener('click',()=>{$('sidebar').inert=false;$('sidebar').classList.add('open');$('nav-backdrop').hidden=false;$('open-nav').setAttribute('aria-expanded','true');$('close-nav').focus();});
$('close-nav').addEventListener('click',()=>{closeNav();$('open-nav').focus();});$('nav-backdrop').addEventListener('click',closeNav);
document.addEventListener('keydown',e=>{
  if(!$('sidebar').classList.contains('open'))return;
  if(e.key==='Escape'){closeNav();$('open-nav').focus();}
  if(e.key==='Tab'){
    const focusable=[...$('sidebar').querySelectorAll('a,button')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
});
window.addEventListener('hashchange',()=>{if(initialized&&location.hash!=='#main')setView(location.hash.slice(1));});
window.addEventListener('resize',()=>{updateNavAccessibility();clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(initialized&&!$('overview-content').hidden)renderCharts();},150);});

async function refreshData() {
  if(loggingOut)return;
  if(loading)return loading;
  const generation=accessGeneration;
  const isCurrent=()=>generation===accessGeneration&&!loggingOut;
  const task=(async()=>{
    const oldMode=getReportingState().mode;
    try {
      await loadReportingData(undefined,{isCurrent});
      if(!isCurrent())return;
      if(manual()&&oldMode!=='manual')state.period='all';
      if(!PERIODS.some(p=>p.id===state.period))state.period=PERIODS[0].id;
      if(!CAMPAIGNS.some(c=>c.id===state.campaign&&(state.platform==='all'||c.platform===state.platform)))state.campaign='all';
      $('main').classList.remove('data-loading');$('data-status').hidden=true;$('retry-data').hidden=true;
      document.querySelectorAll('.filters select,#export-report').forEach(el=>el.disabled=false);
      if(!initialized){initialized=true;setView(location.hash.slice(1)||'overview');}else render();
    } catch(error) {
      if(!isCurrent()||error.code==='STALE_REPORTING_LOAD')return;
      if(error.status===401||error.status===403)clearProtectedData();
      $('data-status').hidden=false;$('retry-data').hidden=false;
      $('data-status-text').textContent=error.status===403?'Votre compte n’a pas accès à cet espace client. Contactez Richmedia.':error.status===401?'Votre session a expiré. Reconnectez-vous pour continuer.':initialized?'Actualisation impossible. Les derniers chiffres chargés restent affichés.':getPortalMode()==='supabase'?'Impossible de charger les campagnes. Vérifiez votre connexion et la configuration Supabase.':'Impossible de charger les campagnes. Vérifiez que le serveur de gestion est démarré.';
      $('data-status').classList.add('error');
    } finally {if(loading===task)loading=null;}
  })();
  loading=task;
  return loading;
}
function clearProtectedData() {
  accessGeneration+=1;loading=null;
  initialized=false;summary=null;audience=null;
  clearReportingData();
  $('main').classList.add('data-loading');
  for(const id of ['results-body','audience-charts','trend-chart','insight-text','dialog-content'])$(id).replaceChildren();
  for(const id of ['kpi-impressions','kpi-clicks','kpi-reach','kpi-views','kpi-ctr'])$(id).textContent='—';
  $('campaign-filter').innerHTML='<option value="all">Toutes les campagnes</option>';
  $('dashboard-dialog').close();
  if(exportUrl){URL.revokeObjectURL(exportUrl);exportUrl=null;}
  document.querySelectorAll('.filters select,#export-report').forEach(el=>el.disabled=true);
}
document.querySelectorAll('.filters select,#export-report').forEach(el=>el.disabled=true);
$('retry-data').addEventListener('click',refreshData);
window.addEventListener('focus',refreshData);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshData();});
if(typeof BroadcastChannel==='function') {
  const updates=new BroadcastChannel('richmedia-campaigns');
  updates.addEventListener('message',event=>{if(event.data?.type==='updated')refreshData();});
}
updateNavAccessibility();
if(getPortalMode()==='supabase') {
  const logout=document.querySelector('.return-login');
  logout.innerHTML='<svg class="icon"><use href="#i-logout"/></svg>Se déconnecter';
  logout.addEventListener('click',async event=>{
    event.preventDefault();if(loggingOut)return;
    loggingOut=true;logout.setAttribute('aria-disabled','true');clearProtectedData();
    try{await signOut();}catch{/* Local session is cleared even when the server is unavailable. */}finally{location.replace('index.html');}
  });
  onSessionChange(event=>{
    if(event==='SIGNED_OUT'){loggingOut=true;logout.setAttribute('aria-disabled','true');clearProtectedData();location.replace('index.html');}
    else if(['SIGNED_IN','TOKEN_REFRESHED','USER_UPDATED'].includes(event))setTimeout(refreshData,0);
  });
  window.addEventListener('pageshow',event=>{if(event.persisted){clearProtectedData();if(loggingOut)location.replace('index.html');else refreshData();}});
}
refreshData();
