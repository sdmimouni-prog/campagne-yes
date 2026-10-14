/**
 * Reporting boundary between the illustrative dashboard and saved campaigns.
 * A saved total belongs to its complete reporting period: it is never prorated
 * into months or synthesized into daily or demographic observations. Audience
 * breakdowns are independent measurements and retain their missing coverage.
 */
import * as demonstration from './dashboard-data.js';
import { getCampaigns } from './portal-service.js';

const PLATFORM_DEFINITIONS = Object.freeze([
  { id: 'meta', name: 'Meta · Facebook & Instagram', shortName: 'Meta', color: '#5C80F4' },
  { id: 'youtube', name: 'YouTube', shortName: 'YouTube', color: '#F06A7A' },
  { id: 'tiktok', name: 'TikTok', shortName: 'TikTok', color: '#58BCAA' },
  { id: 'display', name: 'Display', shortName: 'Display', color: '#E69D53' },
]);
const CHANNEL_PLATFORMS = Object.freeze({ facebook: 'meta', instagram: 'meta', youtube: 'youtube', tiktok: 'tiktok', display: 'display' });
const OPTIONAL_METRICS = ['spend', 'views', 'interactions'];
const AUDIENCE_METRICS = ['impressions', 'clicks', 'reach'];
const AUDIENCE_LABELS = Object.freeze({
  gender: ['Femmes', 'Hommes', 'Non renseigné'],
  ages: ['13–17', '18–24', '25–34', '35–44', '45–54', '55–64', '65+', 'Non renseigné'],
  cities: null,
});
const AUDIENCE_DIMENSIONS = Object.keys(AUDIENCE_LABELS);
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
let reportingState = { mode: 'loading', updatedAt: null };
let reportingGeneration = 0;

export let PLATFORMS = Object.freeze([]);
export let CAMPAIGNS = Object.freeze([]);
export let PERIODS = Object.freeze([]);

const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;
const sumMoney = rows => roundMoney(rows.reduce((sum, row) => sum + Math.round(row.budget * 100), 0) / 100);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validNumber = (value, integer = false) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 9e12 && (!integer || Number.isInteger(value));

function normalizeAudience(input, campaign) {
  const invalid = () => { throw new Error('Les données d’audience enregistrées sont invalides.'); };
  if (input == null) input = {};
  if (typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !AUDIENCE_DIMENSIONS.includes(key))) invalid();
  const audience = {};
  for (const dimension of AUDIENCE_DIMENSIONS) {
    const rows = input[dimension] ?? [];
    if (!Array.isArray(rows) || rows.length > 100) invalid();
    const labels = new Set();
    const totals = Object.fromEntries(AUDIENCE_METRICS.map(metric => [metric, 0]));
    audience[dimension] = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.keys(row).some(key => !['label', ...AUDIENCE_METRICS].includes(key)) || typeof row.label !== 'string') invalid();
      const label = row.label.trim();
      const key = label.toLowerCase();
      if (!label || [...label].length > 80 || labels.has(key) ||
          (AUDIENCE_LABELS[dimension] && !AUDIENCE_LABELS[dimension].includes(label))) invalid();
      labels.add(key);
      const normalized = { label };
      for (const metric of AUDIENCE_METRICS) {
        const value = row[metric] ?? null;
        if (value !== null && !validNumber(value, true)) invalid();
        normalized[metric] = value;
        if (value !== null) totals[metric] += value;
      }
      if (AUDIENCE_METRICS.some(metric => normalized[metric] !== null)) audience[dimension].push(Object.freeze(normalized));
    }
    for (const metric of AUDIENCE_METRICS) {
      if (campaign[metric] !== null && totals[metric] > campaign[metric]) invalid();
    }
    Object.freeze(audience[dimension]);
  }
  return Object.freeze(audience);
}

function normalizeCampaign(record) {
  if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id ||
      typeof record.name !== 'string' || !record.name.trim() || record.name.length > 160 ||
      !Object.hasOwn(CHANNEL_PLATFORMS, record.channel) || !['active', 'archived'].includes(record.status) ||
      !validDate(record.start) || !validDate(record.end) || record.start > record.end ||
      !validNumber(record.budget) || !validNumber(record.impressions, true) || !validNumber(record.clicks, true)) {
    throw new Error('Une campagne enregistrée contient des données invalides.');
  }
  const normalized = { ...record, platform: CHANNEL_PLATFORMS[record.channel], source: 'manual' };
  // Ignore the retired metric if an older API response still includes it.
  delete normalized.trueviews;
  for (const metric of OPTIONAL_METRICS) {
    const value = record[metric] ?? null;
    if (value !== null && !validNumber(value, metric !== 'spend')) {
      throw new Error('Une mesure enregistrée contient une valeur invalide.');
    }
    normalized[metric] = value;
  }
  normalized.reach = record.reach ?? null;
  if (normalized.reach !== null && !validNumber(normalized.reach, true)) {
    throw new Error('Le Reach enregistré contient une valeur invalide.');
  }
  normalized.frequency = normalized.reach > 0 ? record.impressions / normalized.reach : null;
  normalized.ctr = record.impressions > 0 ? record.clicks / record.impressions * 100 : null;
  normalized.audience = normalizeAudience(record.audience, normalized);
  return Object.freeze(normalized);
}

function makePeriods(campaigns) {
  if (!campaigns.length) return Object.freeze([Object.freeze({ id: 'all', label: 'Toutes les périodes', start: null, end: null })]);
  const start = campaigns.reduce((date, campaign) => campaign.start < date ? campaign.start : date, campaigns[0].start);
  const end = campaigns.reduce((date, campaign) => campaign.end > date ? campaign.end : date, campaigns[0].end);
  const periods = [{ id: 'all', label: 'Toutes les périodes', start, end }];
  const firstMonth = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const lastMonth = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  for (let index = firstMonth; index <= lastMonth; index += 1) {
    const year = Math.floor(index / 12);
    const monthIndex = index % 12;
    const id = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
    const monthEnd = new Date(`${id}-01T00:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    periods.push({ id, label: `${MONTH_NAMES[monthIndex]} ${year}`, start: `${id}-01`, end: monthEnd.toISOString().slice(0, 10) });
  }
  return Object.freeze(periods.map(period => Object.freeze(period)));
}

/** Install an entire source atomically. Demonstration and manual data never mix. */
export function setReportingData(payload) {
  if (!payload || !['demo', 'manual'].includes(payload.mode) || !Array.isArray(payload.campaigns)) {
    throw new Error('La source des campagnes a renvoyé une réponse invalide.');
  }
  if (payload.mode === 'demo') {
    PLATFORMS = demonstration.PLATFORMS;
    CAMPAIGNS = demonstration.CAMPAIGNS;
    PERIODS = demonstration.PERIODS;
  } else {
    const normalized = payload.campaigns.map(normalizeCampaign);
    if (new Set(normalized.map(campaign => campaign.id)).size !== normalized.length) {
      throw new Error('La source des campagnes contient des identifiants en double.');
    }
    const campaigns = Object.freeze(normalized.filter(campaign => campaign.status === 'active'));
    const periods = makePeriods(campaigns);
    const platforms = Object.freeze(PLATFORM_DEFINITIONS.map(platform => Object.freeze({
      ...platform,
      budget: sumMoney(campaigns.filter(campaign => campaign.platform === platform.id)),
    })));
    CAMPAIGNS = campaigns;
    PERIODS = periods;
    PLATFORMS = platforms;
  }
  reportingGeneration += 1;
  reportingState = Object.freeze({ mode: payload.mode, updatedAt: payload.updatedAt ?? null });
  return getReportingState();
}

/** A failed refresh rejects; it never installs demonstration data as a fallback. */
export async function loadReportingData(loader = getCampaigns, { isCurrent = () => true } = {}) {
  const generation = ++reportingGeneration;
  const payload = await loader();
  if (generation !== reportingGeneration || !isCurrent()) {
    throw Object.assign(new Error('Cette actualisation a été annulée.'), { code: 'STALE_REPORTING_LOAD' });
  }
  return setReportingData(payload);
}

/** Remove protected data and invalidate every request started before this call. */
export function clearReportingData() {
  reportingGeneration += 1;
  PLATFORMS = Object.freeze([]);
  CAMPAIGNS = Object.freeze([]);
  PERIODS = Object.freeze([]);
  reportingState = Object.freeze({ mode: 'loading', updatedAt: null });
}

export function getReportingState() {
  return { ...reportingState };
}

function aggregateMetrics(rows) {
  const metrics = {
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
  };
  for (const metric of OPTIONAL_METRICS) {
    // Missing values are unknown, not zero. Incomplete aggregates stay unknown.
    metrics[metric] = !rows.length || rows.some(row => row[metric] === null) ? null :
      metric === 'spend'
        ? roundMoney(rows.reduce((sum, row) => sum + Math.round(row.spend * 100), 0) / 100)
        : rows.reduce((sum, row) => sum + row[metric], 0);
  }
  // Unique audiences cannot be added across campaigns without deduplication.
  metrics.reach = rows.length === 1 ? rows[0].reach : null;
  metrics.frequency = metrics.reach > 0 ? metrics.impressions / metrics.reach : null;
  return metrics;
}

export function getSummary({ period, platform = 'all', campaign = 'all' } = {}) {
  if (reportingState.mode === 'loading') throw new Error('Les campagnes ne sont pas encore chargées.');
  if (reportingState.mode === 'demo') {
    const result = demonstration.getSummary({ period, platform, campaign });
    return {
      ...result,
      totals: { ...result.totals, interactions: null },
      byPlatform: result.byPlatform.map(item => ({ ...item, interactions: null })),
      excludedPartialCount: 0,
      timelineUnavailable: false,
    };
  }
  const range = PERIODS.find(item => item.id === period) || PERIODS[0];
  const selected = CAMPAIGNS.filter(item =>
    (platform === 'all' || item.platform === platform) && (campaign === 'all' || item.id === campaign));
  const included = selected.filter(item => item.start >= range.start && item.end <= range.end);
  const excludedPartialCount = selected.filter(item =>
    item.start <= range.end && item.end >= range.start && (item.start < range.start || item.end > range.end)).length;
  const rows = included.map(item => ({ ...item, campaignId: item.id, date: item.end }));
  const totals = { ...aggregateMetrics(rows), activeCampaigns: rows.length };
  const byPlatform = PLATFORMS.filter(item => rows.some(row => row.platform === item.id)).map(item => {
    const platformRows = rows.filter(row => row.platform === item.id);
    return { ...item, ...aggregateMetrics(platformRows), budget: sumMoney(platformRows), campaignCount: platformRows.length };
  });
  const timelineUnavailable = rows.some(row => row.start !== row.end);
  const dailyRows = new Map();
  if (!timelineUnavailable) {
    for (const row of rows) {
      if (!dailyRows.has(row.date)) dailyRows.set(row.date, []);
      dailyRows.get(row.date).push(row);
    }
  }
  const timeline = [...dailyRows].sort(([a], [b]) => a.localeCompare(b)).map(([date, day]) => ({ date, ...aggregateMetrics(day) }));
  return { rows, totals, byPlatform, timeline, budget: sumMoney(rows), excludedPartialCount, timelineUnavailable };
}

export function getAudience(options = {}) {
  if (reportingState.mode === 'loading') throw new Error('Les campagnes ne sont pas encore chargées.');
  const metric = AUDIENCE_METRICS.includes(options.metric) ? options.metric : 'impressions';
  // The same summary selects campaigns and whole reporting periods for both views.
  const summary = getSummary(options);
  const campaignCount = summary.totals.activeCampaigns;
  const reachRequiresSingleCampaign = metric === 'reach' && campaignCount > 1;
  const source = reportingState.mode;
  const total = metric === 'reach' ? summary.totals.reach ?? null : summary.totals[metric];
  const audience = { total, cities: [], gender: [], ages: [], source, dimensions: {}, reachRequiresSingleCampaign };
  if (source === 'demo' && metric !== 'reach') {
    const demo = demonstration.getAudience({ ...options, metric });
    for (const dimension of AUDIENCE_DIMENSIONS) {
      audience[dimension] = demo[dimension];
      audience.dimensions[dimension] = {
        total: demo.total, reportedTotal: demo.total,
        coverage: demo.total > 0 ? 1 : null, partial: false,
        availableCampaigns: campaignCount, campaignCount,
      };
    }
    return audience;
  }
  if (reachRequiresSingleCampaign || source === 'demo') {
    for (const dimension of AUDIENCE_DIMENSIONS) {
      audience.dimensions[dimension] = {
        total: null, reportedTotal: 0, coverage: null, partial: campaignCount > 0,
        availableCampaigns: 0, campaignCount,
      };
    }
    return audience;
  }
  for (const dimension of AUDIENCE_DIMENSIONS) {
    const buckets = new Map();
    let availableCampaigns = 0;
    let missingValues = false;
    for (const campaign of summary.rows) {
      const rows = campaign.audience[dimension];
      if (rows.some(row => row[metric] !== null)) availableCampaigns += 1;
      if (rows.some(row => row[metric] === null)) missingValues = true;
      for (const row of rows) {
        if (row[metric] === null) continue;
        const key = row.label.toLowerCase();
        if (!buckets.has(key)) buckets.set(key, { label: row.label, value: 0 });
        buckets.get(key).value += row[metric];
      }
    }
    const rows = [...buckets.values()];
    if (dimension === 'cities') rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'fr'));
    else rows.sort((a, b) => AUDIENCE_LABELS[dimension].indexOf(a.label) - AUDIENCE_LABELS[dimension].indexOf(b.label));
    const reportedTotal = rows.reduce((sum, row) => sum + row.value, 0);
    audience[dimension] = rows;
    audience.dimensions[dimension] = {
      total: total ?? reportedTotal,
      reportedTotal,
      coverage: total > 0 ? reportedTotal / total : null,
      partial: campaignCount > 0 && (total === null || missingValues || availableCampaigns < campaignCount || reportedTotal < total),
      availableCampaigns,
      campaignCount,
    };
  }
  return audience;
}
