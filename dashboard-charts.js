/* Richmedia reporting charts. Values are supplied by the dashboard data layer. */
const COLORS = ['#7635ef', '#bf9df8', '#e8e3ee', '#a877f0', '#8c57d7', '#6a5094'];
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const METRICS = {
  impressions: { label: 'Impressions', unit: 'impressions' },
  clicks: { label: 'Clics', unit: 'clics' },
  reach: { label: 'Reach', unit: 'personnes' },
  views: { label: 'Vues vidéo', unit: 'vues vidéo' },
  spend: { label: 'Dépenses', unit: 'DH' },
};
let chartSequence = 0;

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const amount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const format = (value, metric) => `${NUMBER.format(amount(value))}${metric === 'spend' ? ' DH' : ''}`;
const metricInfo = (metric) => METRICS[metric] || METRICS.impressions;
const resolve = (container) => typeof container === 'string' ? document.querySelector(container) : container;
const ratio = (value, total) => total > 0 ? Math.min(100, amount(value) / total * 100) : 0;
const safeRows = (rows) => Array.isArray(rows) ? rows.filter(row => Number.isFinite(row?.value) && row.value >= 0).map(row => ({ label: String(row.label ?? 'Non renseigné'), value: row.value })) : [];
const dateLabel = (value, full = false) => {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: full ? 'long' : 'short' }).format(date).replace('.', '');
};

function niceMaximum(maximum) {
  if (maximum <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const upper = [1, 2, 2.5, 4, 5, 8, 10].find((value) => value >= normalized) || 10;
  return upper * magnitude;
}

function emptyChart(message = 'Données non disponibles') {
  return `<div class="chart-empty"><span class="chart-empty-symbol" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>${escape(message)}</strong><p>La visualisation apparaîtra dès l’ajout de résultats.</p></div>`;
}

/** Render a responsive daily time series. The chart can be explored with Tab. */
export function renderTrend(container, timeline, metric = 'impressions') {
  const target = resolve(container);
  if (!target) return;
  const data = Array.isArray(timeline) ? timeline.map((row) => ({ date: row?.date, value: amount(row?.[metric]) })) : [];
  const info = metricInfo(metric);
  if (!data.length) {
    target.innerHTML = emptyChart();
    return;
  }
  const id = `rm-trend-${++chartSequence}`;
  const width = Math.max(320, Math.min(900, target.clientWidth || 760));
  const height = width < 440 ? 240 : 257, left = 48, right = 20, top = 18, bottom = 40;
  const plotWidth = width - left - right, plotHeight = height - top - bottom, baseline = height - bottom;
  const maximum = niceMaximum(Math.max(...data.map((row) => row.value)));
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const points = data.map((row, index) => ({ ...row, x: left + (data.length > 1 ? index / (data.length - 1) : 0.5) * plotWidth, y: baseline - row.value / maximum * plotHeight }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L ${points.at(-1).x.toFixed(2)} ${baseline} L ${points[0].x.toFixed(2)} ${baseline} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const value = maximum / 4 * index, y = baseline - plotHeight / 4 * index;
    return `<g><line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="trend-grid"/><text x="${left - 13}" y="${y + 3.5}" text-anchor="end" class="trend-label">${escape(COMPACT.format(value))}</text></g>`;
  }).join('');
  const labelCount = Math.min(width < 440 ? 4 : 6, data.length);
  const labelIndexes = [...new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (data.length - 1) / Math.max(1, labelCount - 1))))];
  const labels = labelIndexes.map((index) => `<text x="${points[index].x}" y="${height - 13}" text-anchor="${index === 0 && data.length > 1 ? 'start' : index === data.length - 1 && data.length > 1 ? 'end' : 'middle'}" class="trend-label">${escape(dateLabel(data[index].date))}</text>`).join('');
  const summary = `${info.label} du ${dateLabel(data[0].date, true)} au ${dateLabel(data.at(-1).date, true)} : ${format(total, metric)}${metric === 'spend' ? '' : ` ${info.unit}`}.`;

  target.innerHTML = `<div class="trend-visual">
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="group" aria-labelledby="${id}-title" aria-describedby="${id}-description">
      <title id="${id}-title">Évolution des ${escape(info.label.toLowerCase())}</title>
      <desc id="${id}-description">${escape(summary)} Utilisez la touche Tab pour explorer les valeurs quotidiennes.</desc>
      <defs><linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7635ef" stop-opacity=".16"/><stop offset="100%" stop-color="#7635ef" stop-opacity=".005"/></linearGradient></defs>
      ${ticks}<path d="${area}" fill="url(#${id}-fill)"/><path d="${line}" fill="none" stroke="#7635ef" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      ${labels}
      ${points.map((point, index) => `<g class="trend-point${points.length === 1 ? ' trend-point-single' : ''}" tabindex="0" role="img" data-index="${index}" aria-label="${escape(`${dateLabel(point.date, true)} : ${format(point.value, metric)} ${metric === 'spend' ? '' : info.unit}`)}"><line class="trend-guide" x1="${point.x}" y1="${top}" x2="${point.x}" y2="${baseline}"/><circle class="trend-hit" cx="${point.x}" cy="${point.y}" r="12"/><circle class="trend-dot" cx="${point.x}" cy="${point.y}" r="4.5"/><title>${escape(`${dateLabel(point.date, true)} : ${format(point.value, metric)}`)}</title></g>`).join('')}
    </svg>
    <div class="trend-tooltip" role="status" aria-live="off" hidden></div>
  </div>
  <div class="trend-footnote"><span><i aria-hidden="true"></i>${escape(info.label)}</span><span>Évolution quotidienne</span></div>`;

  const tooltip = target.querySelector('.trend-tooltip');
  const reveal = (element) => {
    const point = points[Number(element.dataset.index)];
    tooltip.innerHTML = `<span>${escape(dateLabel(point.date, true))}</span><strong>${escape(format(point.value, metric))}</strong>`;
    tooltip.style.left = `${Math.max(14, Math.min(86, point.x / width * 100))}%`;
    tooltip.style.top = `${Math.max(21, point.y / height * 100 - 3)}%`;
    tooltip.hidden = false;
  };
  target.querySelectorAll('.trend-point').forEach((element) => {
    element.addEventListener('mouseenter', () => reveal(element));
    element.addEventListener('focus', () => reveal(element));
    element.addEventListener('click', () => reveal(element));
    element.addEventListener('mouseleave', () => { tooltip.hidden = true; });
    element.addEventListener('blur', () => { tooltip.hidden = true; });
    element.addEventListener('keydown', (event) => { if (event.key === 'Escape') tooltip.hidden = true; });
  });
}

const ICONS = {
  cities: '<path d="M18 9c0 5-6 10-6 10S6 14 6 9a6 6 0 1 1 12 0Z"/><circle cx="12" cy="9" r="2"/>',
  gender: '<circle cx="9" cy="8" r="3"/><path d="M3 19v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 5"/>',
  ages: '<path d="M4 19V9M10 19V4M16 19v-7M22 19V7"/>',
};

function cardHeader(title, dimension, metric) {
  const description = metric === 'reach' ? 'Personnes uniques touchées' : `Répartition des ${metricInfo(metric).label.toLowerCase()}`;
  return `<div class="audience-card-heading"><div><h3>${escape(title)}</h3><p>${escape(description)}</p></div><span class="audience-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[dimension]}</svg></span></div>`;
}

function audienceContext(audience, dimension, rows) {
  const details = audience.dimensions?.[dimension];
  const reportedTotal = rows.reduce((sum, row) => sum + row.value, 0);
  const total = details ? amount(details.total) : Math.max(amount(audience.total), reportedTotal);
  return {
    ...details, total, reportedTotal,
    source: audience.source === 'manual' ? 'manual' : 'demo',
    partial: details?.partial ?? reportedTotal < total,
    reportedBasis: audience.total == null,
    needsCampaign: Boolean(audience.reachRequiresSingleCampaign),
  };
}
const share = (value, context) => context.total > 0 ? `${PERCENT.format(ratio(value, context.total))} %` : '—';

function cardFooter(context) {
  const source = context.source === 'manual' ? 'Saisie manuelle' : 'Démonstration';
  const coverage = context.reportedBasis ? '% des données renseignées' : context.total > 0 ? `Détail sur ${share(context.reportedTotal, context)} du total` : 'Valeurs renseignées à zéro';
  const campaigns = context.campaignCount > 1 ? ` · ${context.availableCampaigns}/${context.campaignCount} campagnes renseignées` : '';
  return `<div class="audience-card-footer${context.partial ? ' audience-partial' : ''}"><span class="audience-footer-dot" aria-hidden="true"></span><span>${escape(`${source} · ${context.partial ? 'Données partielles · ' : ''}${coverage}${campaigns}`)}</span></div>`;
}

function emptyAudience(context, metric) {
  const title = context.needsCampaign ? 'Sélectionnez une campagne' : metric === 'reach' && context.source === 'demo' ? 'Reach non disponible' : 'Aucune audience renseignée';
  const description = context.needsCampaign ? 'Le Reach ne s’additionne pas entre campagnes. Choisissez une campagne dans le filtre pour consulter sa répartition.' : context.source === 'manual' ? 'Les répartitions saisies dans le back-office apparaîtront ici pour cette mesure et cette sélection.' : 'Aucune répartition disponible pour cette mesure et cette sélection.';
  return `<div class="chart-empty"><span class="chart-empty-symbol" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>${escape(title)}</strong><p>${escape(description)}</p></div>`;
}

function renderAudienceTable(rows, context, metric, title) {
  return `<div class="audience-table-scroll"><table class="audience-table"><caption class="sr-only">${escape(`${title} · ${metricInfo(metric).label}`)}</caption><thead><tr><th scope="col">Catégorie</th><th scope="col" class="numeric">${escape(metricInfo(metric).label)}</th><th scope="col" class="numeric">Part</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${escape(row.label)}</th><td class="numeric">${escape(NUMBER.format(row.value))}</td><td class="numeric">${escape(share(row.value, context))}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Total renseigné</th><td class="numeric">${escape(NUMBER.format(context.reportedTotal))}</td><td class="numeric">${escape(share(context.reportedTotal, context))}</td></tr></tfoot></table></div>`;
}

function renderCities(rows, context, metric) {
  const max = Math.max(0, ...rows.map(row => row.value));
  return `<ol class="audience-city-list">${rows.map((row, index) => `<li><div class="city-row-label"><span><small>${String(index + 1).padStart(2, '0')}</small>${escape(row.label)}</span><strong title="${escape(NUMBER.format(row.value))}">${escape(COMPACT.format(row.value))}<em>${escape(share(row.value, context))}</em></strong></div><div class="audience-city-track" role="img" aria-label="${escape(`${row.label} : ${format(row.value, metric)}, ${share(row.value, context)}`)}"><span style="width:${ratio(row.value, max).toFixed(3)}%;opacity:${Math.max(0.4, 1 - index * 0.12)}"></span></div></li>`).join('')}</ol>`;
}

function renderGender(rows, context, metric) {
  const radius = 61, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = rows.map((row, index) => {
    const fraction = ratio(row.value, context.total) / 100;
    const segment = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${COLORS[index % COLORS.length]}" stroke-width="22" stroke-dasharray="${Math.max(0, fraction * circumference - (fraction > .01 ? 2 : 0))} ${circumference}" stroke-dashoffset="${-offset * circumference}" transform="rotate(-90 90 90)"/>`;
    offset += fraction;
    return segment;
  }).join('');
  const main = context.reportedTotal > 0 ? rows.reduce((best, row) => row.value > best.value ? row : best, rows[0]) : null;
  const description = rows.map(row => `${row.label} : ${format(row.value, metric)}, ${share(row.value, context)}`).join('. ');
  return `<div class="audience-donut-wrap"><svg class="audience-donut" viewBox="0 0 180 180" role="img" aria-label="${escape(description)}"><circle cx="90" cy="90" r="${radius}" fill="none" stroke="#f2eff6" stroke-width="22"/>${segments}<text x="90" y="90" text-anchor="middle" class="audience-donut-value">${escape(main ? share(main.value, context) : '0')}</text><text x="90" y="110" text-anchor="middle" class="audience-donut-label">${escape(main ? main.label : metricInfo(metric).unit)}</text></svg></div><ul class="audience-gender-legend">${rows.map((row, index) => `<li><span><i style="background:${COLORS[index % COLORS.length]}" aria-hidden="true"></i>${escape(row.label)}</span><span><small title="${escape(NUMBER.format(row.value))}">${escape(COMPACT.format(row.value))}</small><strong>${escape(share(row.value, context))}</strong></span></li>`).join('')}</ul>`;
}

function renderAges(rows, context, metric) {
  const maximum = Math.max(0, ...rows.map(row => row.value));
  const winningIndex = maximum > 0 ? rows.findIndex(row => row.value === maximum) : -1;
  const winners = rows.filter(row => maximum > 0 && row.value === maximum);
  const chart = `<div class="audience-age-chart" role="group" aria-label="Répartition par tranche d’âge"><div class="age-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="age-columns">${rows.map((row, index) => `<div class="age-column ${index === winningIndex ? 'age-column-leading' : ''}" tabindex="0" role="img" aria-label="${escape(`${row.label} : ${format(row.value, metric)}, ${share(row.value, context)}`)}"><div class="age-column-bar-space"><div class="age-column-bar" style="height:${(maximum > 0 ? row.value / maximum * 83 : 0).toFixed(3)}%"><span class="age-column-value">${escape(share(row.value, context))}</span></div></div><span class="age-column-label">${escape(row.label)}</span><span class="age-column-tooltip">${escape(format(row.value, metric))}</span></div>`).join('')}</div></div>`;
  const insight = winners.length === 1 ? `<div class="audience-age-insight"><span class="age-insight-icon" aria-hidden="true">↗</span><p><strong>${escape(winners[0].label)}</strong><span>En tête des données renseignées</span></p><b>${escape(share(maximum, context))}</b></div>` : '';
  return chart + insight;
}

/** Render supplied audience results as charts or accessible numeric tables. */
export function renderAudience(container, audience = {}, { metric = 'impressions', view = 'charts' } = {}) {
  const target = resolve(container);
  if (!target) return;
  const cards = [
    { dimension: 'gender', title: 'Par sexe', chart: renderGender },
    { dimension: 'ages', title: 'Par tranche d’âge', chart: renderAges },
    { dimension: 'cities', title: 'Par ville', chart: renderCities },
  ];
  target.classList.add('audience-grid');
  target.innerHTML = cards.map(({ dimension, title, chart }) => {
    const rows = audience.reachRequiresSingleCampaign ? [] : safeRows(audience[dimension]);
    if (dimension === 'cities') rows.sort((a, b) => b.value - a.value);
    const context = audienceContext(audience, dimension, rows);
    const content = !rows.length ? emptyAudience(context, metric) : view === 'tables' ? renderAudienceTable(rows, context, metric, title) : chart(rows, context, metric);
    return `<article class="audience-card audience-${dimension}">${cardHeader(title, dimension, metric)}${content}${rows.length ? cardFooter(context) : ''}</article>`;
  }).join('');
}
