/* Richmedia reporting charts. Values are supplied by the dashboard data layer. */
const COLORS = ['#7635ef', '#bf9df8', '#e8e3ee', '#a877f0', '#8c57d7', '#6a5094'];
const NUMBER = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const METRICS = {
  impressions: { label: 'Impressions', unit: 'impressions' },
  clicks: { label: 'Clics', unit: 'clics' },
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
const safeRows = (rows) => Array.isArray(rows) ? rows.map((row) => ({ label: String(row?.label ?? 'Non renseigné'), value: amount(row?.value) })) : [];
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
  return `<div class="audience-card-heading"><div><h3>${escape(title)}</h3><p>Répartition des ${escape(metricInfo(metric).label.toLowerCase())}</p></div><span class="audience-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[dimension]}</svg></span></div>`;
}

function cardFooter(rows, total, label) {
  const sum = rows.reduce((count, row) => count + row.value, 0);
  const percent = ratio(sum, total);
  return `<div class="audience-card-footer"><span class="audience-footer-dot" aria-hidden="true"></span>${escape(percent < 99.95 ? `${PERCENT.format(percent)} % des résultats renseignés` : label)}</div>`;
}

function renderCities(input, total, metric) {
  const rows = [...input].sort((a, b) => b.value - a.value);
  const max = Math.max(0, ...rows.map((row) => row.value));
  const content = !rows.length || !max ? emptyChart() : `<ol class="audience-city-list">${rows.map((row, index) => `<li><div class="city-row-label"><span><small>${String(index + 1).padStart(2, '0')}</small>${escape(row.label)}</span><strong>${escape(COMPACT.format(row.value))}<em>${escape(PERCENT.format(ratio(row.value, total)))} %</em></strong></div><div class="audience-city-track" role="img" aria-label="${escape(`${row.label} : ${format(row.value, metric)}, ${PERCENT.format(ratio(row.value, total))} %`)}"><span style="width:${ratio(row.value, max).toFixed(3)}%;opacity:${Math.max(0.4, 1 - index * 0.12)}"></span></div></li>`).join('')}</ol>`;
  return `<article class="audience-card audience-cities">${cardHeader('Par ville', 'cities', metric)}${content}${rows.length && max ? cardFooter(rows, total, 'Villes • répartition de démonstration') : ''}</article>`;
}

function renderGender(rows, total, metric) {
  const sum = rows.reduce((count, row) => count + row.value, 0);
  let content = emptyChart();
  if (sum > 0) {
    const radius = 61, circumference = 2 * Math.PI * radius;
    let offset = 0;
    const segments = rows.map((row, index) => {
      const fraction = ratio(row.value, total) / 100;
      const segment = `<circle cx="90" cy="90" r="${radius}" fill="none" stroke="${COLORS[index % COLORS.length]}" stroke-width="22" stroke-dasharray="${Math.max(0, fraction * circumference - (fraction > .01 ? 2 : 0))} ${circumference}" stroke-dashoffset="${-offset * circumference}" transform="rotate(-90 90 90)"/>`;
      offset += fraction;
      return segment;
    }).join('');
    const main = rows.reduce((best, row) => row.value > best.value ? row : best, rows[0]);
    const description = rows.map((row) => `${row.label} : ${format(row.value, metric)}, ${PERCENT.format(ratio(row.value, total))} %`).join('. ');
    content = `<div class="audience-donut-wrap"><svg class="audience-donut" viewBox="0 0 180 180" role="img" aria-label="${escape(description)}"><circle cx="90" cy="90" r="${radius}" fill="none" stroke="#f2eff6" stroke-width="22"/>${segments}<text x="90" y="90" text-anchor="middle" class="audience-donut-value">${escape(PERCENT.format(ratio(main.value, total)))} %</text><text x="90" y="110" text-anchor="middle" class="audience-donut-label">${escape(main.label)}</text></svg></div><ul class="audience-gender-legend">${rows.map((row, index) => `<li><span><i style="background:${COLORS[index % COLORS.length]}" aria-hidden="true"></i>${escape(row.label)}</span><span><small>${escape(COMPACT.format(row.value))}</small><strong>${escape(PERCENT.format(ratio(row.value, total)))} %</strong></span></li>`).join('')}</ul>`;
  }
  return `<article class="audience-card audience-gender">${cardHeader('Par sexe', 'gender', metric)}${content}${sum ? cardFooter(rows, total, 'Profils • données de démonstration') : ''}</article>`;
}

function renderAges(rows, total, metric) {
  const maximum = Math.max(0, ...rows.map((row) => row.value));
  let content = emptyChart();
  if (maximum > 0) {
    const winningIndex = rows.findIndex((row) => row.value === maximum);
    content = `<div class="audience-age-chart" role="group" aria-label="Répartition par tranche d’âge"><div class="age-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="age-columns">${rows.map((row, index) => `<div class="age-column ${index === winningIndex ? 'age-column-leading' : ''}" tabindex="0" role="img" aria-label="${escape(`${row.label} : ${format(row.value, metric)}, ${PERCENT.format(ratio(row.value, total))} %`)}"><div class="age-column-bar-space"><div class="age-column-bar" style="height:${Math.max(1, row.value / maximum * 83).toFixed(3)}%"><span class="age-column-value">${escape(PERCENT.format(ratio(row.value, total)))}<small>%</small></span></div></div><span class="age-column-label">${escape(row.label)}</span><span class="age-column-tooltip">${escape(format(row.value, metric))}</span></div>`).join('')}</div></div><div class="audience-age-insight"><span class="age-insight-icon" aria-hidden="true">↗</span><p><strong>${escape(rows[winningIndex].label)}</strong><span>La tranche d’âge la plus représentée</span></p><b>${escape(PERCENT.format(ratio(maximum, total)))} %</b></div>`;
  }
  return `<article class="audience-card audience-ages">${cardHeader('Par tranche d’âge', 'ages', metric)}${content}${maximum ? cardFooter(rows, total, 'Tranches d’âge • données de démonstration') : ''}</article>`;
}

/** Render the three audience cards using only supplied, nonnegative numbers. */
export function renderAudience(container, audience = {}, { metric = 'impressions' } = {}) {
  const target = resolve(container);
  if (!target) return;
  const cities = safeRows(audience?.cities), gender = safeRows(audience?.gender), ages = safeRows(audience?.ages);
  const totalFor = (rows) => Math.max(amount(audience?.total), rows.reduce((sum, row) => sum + row.value, 0));
  target.classList.add('audience-grid');
  target.innerHTML = renderCities(cities, totalFor(cities), metric) + renderGender(gender, totalFor(gender), metric) + renderAges(ages, totalFor(ages), metric);
}
