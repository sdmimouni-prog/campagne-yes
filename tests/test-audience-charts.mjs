import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAudience } from '../dashboard-charts.js';

const render = (audience, options) => {
  const container = { classList: { add() {} }, innerHTML: '' };
  renderAudience(container, audience, options);
  return container.innerHTML;
};
const dimension = (total, reportedTotal, extra={}) => ({total,reportedTotal,coverage:total?reportedTotal/total:null,partial:reportedTotal<total,availableCampaigns:1,campaignCount:1,...extra});

test('audience tables expose exact values, selected measure and partial coverage', () => {
  const html = render({source:'manual',total:200000,cities:[{label:'Casablanca',value:123456}],gender:[{label:'Femmes',value:120000}],ages:[{label:'25–34',value:90000}],dimensions:{cities:dimension(200000,123456),gender:dimension(200000,120000),ages:dimension(200000,90000)}},{metric:'clicks',view:'tables'});
  assert.equal((html.match(/<table /g)||[]).length,3);
  assert.match(html,/<th scope="col" class="numeric">Clics<\/th>/);
  assert.ok(html.includes(new Intl.NumberFormat('fr-FR').format(123456)));
  assert.match(html,/61,7 %/);
  assert.match(html,/Données partielles/);
  assert.match(html,/Saisie manuelle/);
  assert.doesNotMatch(html,/Démonstration/);
  assert.match(html,/<caption class="sr-only">Par sexe · Clics<\/caption>/);
});

test('explicit zero audience values remain visible without invented leading categories', () => {
  const audience={source:'manual',total:0,cities:[{label:'Rabat',value:0}],gender:[{label:'Femmes',value:0}],ages:[{label:'18–24',value:0}],dimensions:Object.fromEntries(['cities','gender','ages'].map(d=>[d,dimension(0,0)]))};
  const html=render(audience,{metric:'impressions'});
  assert.match(html,/Rabat/);
  assert.match(html,/Femmes/);
  assert.match(html,/18–24/);
  assert.match(html,/height:0\.000%/);
  assert.doesNotMatch(html,/Aucune audience renseignée|En tête des données renseignées|age-column-leading/);
  assert.match(render(audience,{metric:'impressions',view:'tables'}),/<td class="numeric">0<\/td>/);
});

test('unknown audience values do not become zero results', () => {
  const html=render({source:'manual',total:100,cities:[{label:'Inconnue',value:null}],gender:[],ages:[]},{metric:'clicks',view:'tables'});
  assert.equal((html.match(/Aucune audience renseignée/g)||[]).length,3);
  assert.doesNotMatch(html,/<table /);
});

test('Reach asks for one campaign and does not render supplied aggregate figures', () => {
  const html=render({source:'manual',total:null,reachRequiresSingleCampaign:true,cities:[{label:'Casablanca',value:999}],gender:[],ages:[]},{metric:'reach',view:'tables'});
  assert.match(html,/Sélectionnez une campagne/);
  assert.match(html,/Le Reach ne s’additionne pas entre campagnes/);
  assert.doesNotMatch(html,/999|<table /);
});

test('Reach with an unknown campaign total uses reported figures as its labelled basis', () => {
  const html=render({source:'manual',total:null,cities:[{label:'Tanger',value:60}],gender:[],ages:[],dimensions:{cities:dimension(60,60,{partial:true})}},{metric:'reach',view:'tables'});
  assert.match(html,/% des données renseignées/);
  assert.match(html,/<th scope="col" class="numeric">Reach<\/th>/);
  assert.match(html,/100 %/);
});

test('audience category labels are escaped in tables and charts', () => {
  const audience={source:'manual',total:10,cities:[{label:'<img src=x onerror=alert(1)>',value:10}],gender:[],ages:[]};
  for(const view of ['charts','tables']){
    const html=render(audience,{view});
    assert.doesNotMatch(html,/<img/);
    assert.match(html,/&lt;img/);
  }
});
