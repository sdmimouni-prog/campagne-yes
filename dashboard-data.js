/**
 * Demonstration data only. Every performance and audience value is simulated.
 * Budgets are the planned media amounts in MAD, not actual platform spend.
 * No cross-platform unique reach is calculated.
 */
export const PLATFORMS = Object.freeze([
  Object.freeze({ id: 'meta', name: 'Meta · Facebook & Instagram', shortName: 'Meta', budget: 40000, color: '#5C80F4' }),
  Object.freeze({ id: 'youtube', name: 'YouTube', shortName: 'YouTube', budget: 53000, color: '#F06A7A' }),
  Object.freeze({ id: 'tiktok', name: 'TikTok', shortName: 'TikTok', budget: 45000, color: '#58BCAA' }),
]);

export const CAMPAIGNS = Object.freeze([
  Object.freeze({ id: 'yes-meta', platform: 'meta', name: 'YES Baby · Notoriété Meta', status: 'active', start: '2026-10-01', end: '2026-12-31' }),
  Object.freeze({ id: 'yes-youtube', platform: 'youtube', name: 'YES Baby · Vidéo YouTube', status: 'active', start: '2026-10-01', end: '2026-12-31' }),
  Object.freeze({ id: 'yes-tiktok', platform: 'tiktok', name: 'YES Baby · Découverte TikTok', status: 'active', start: '2026-10-01', end: '2026-12-31' }),
]);

export const PERIODS = Object.freeze([
  Object.freeze({ id: 'oct', label: 'Octobre 2026', start: '2026-10-01', end: '2026-10-31' }),
  Object.freeze({ id: 'nov', label: 'Novembre 2026', start: '2026-11-01', end: '2026-11-30' }),
  Object.freeze({ id: 'dec', label: 'Décembre 2026', start: '2026-12-01', end: '2026-12-31' }),
  Object.freeze({ id: 'all', label: 'Oct. – Déc. 2026', start: '2026-10-01', end: '2026-12-31' }),
]);

const DAY_MS = 86400000;
const START_TIME = Date.UTC(2026, 9, 1);
const DATE_LIST = Array.from({ length: 92 }, (_, index) => new Date(START_TIME + index * DAY_MS).toISOString().slice(0, 10));

// Largest remainder allocation keeps each distribution equal to its total.
function allocate(total, weights) {
  const wholeTotal = Math.max(0, Math.round(total));
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map(weight => wholeTotal * weight / sum);
  const result = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const difference = wholeTotal - result.reduce((acc, value) => acc + value, 0);
  for (let index = 0; index < difference; index += 1) result[order[index].index] += 1;
  return result;
}

const DELIVERY = {
  meta: { utilization: 0.845, cpm: 18.2, ctr: 0.0084, viewRate: 0.29, phase: 0.6 },
  youtube: { utilization: 0.868, cpm: 24.6, ctr: 0.0033, viewRate: 0.61, phase: 2.4 },
  tiktok: { utilization: 0.857, cpm: 12.8, ctr: 0.0107, viewRate: 0.48, phase: 4.1 },
};

export const DAILY = Object.freeze(PLATFORMS.flatMap(platform => {
  const config = DELIVERY[platform.id];
  const campaign = CAMPAIGNS.find(item => item.platform === platform.id);
  const weights = DATE_LIST.map((date, index) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const cadence = 1 + 0.2 * Math.sin(index * 0.39 + config.phase) + 0.12 * Math.cos(index * 0.16 + config.phase);
    const ramp = 0.77 + Math.min(index, 50) * 0.006;
    return cadence * ramp * (weekend ? (platform.id === 'tiktok' ? 1.19 : 1.08) : 1);
  });
  const cents = allocate(platform.budget * config.utilization * 100, weights);
  return DATE_LIST.map((date, index) => {
    const spend = cents[index] / 100;
    const dailyCpm = config.cpm * (1 + 0.1 * Math.sin(index * 0.24 + config.phase));
    const impressions = Math.round(spend * 1000 / dailyCpm);
    const clicks = Math.round(impressions * config.ctr * (1 + 0.17 * Math.cos(index * 0.29 + config.phase)));
    const views = Math.round(impressions * config.viewRate * (1 + 0.075 * Math.sin(index * 0.19 + config.phase)));
    return Object.freeze({ date, campaignId: campaign.id, platform: platform.id, impressions, clicks, views, spend });
  });
}).sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform)));

const emptyMetrics = () => ({ spend: 0, impressions: 0, clicks: 0, views: 0 });
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

function addMetrics(target, row) {
  target.spend = roundMoney(target.spend + row.spend);
  target.impressions += row.impressions;
  target.clicks += row.clicks;
  target.views += row.views;
  return target;
}

/**
 * All periods refer to simulated full calendar months.
 * Budget is the full-flight planned allocation of the selected campaigns;
 * it is deliberately not prorated when the selected reporting period changes.
 */
export function getSummary({ period = 'oct', platform = 'all', campaign = 'all' } = {}) {
  const range = PERIODS.find(item => item.id === period) || PERIODS[0];
  const selectedCampaigns = CAMPAIGNS.filter(item =>
    (platform === 'all' || item.platform === platform) &&
    (campaign === 'all' || item.id === campaign));
  const ids = new Set(selectedCampaigns.map(item => item.id));
  const rows = DAILY.filter(row => ids.has(row.campaignId) && row.date >= range.start && row.date <= range.end);
  const totals = rows.reduce(addMetrics, emptyMetrics());
  totals.activeCampaigns = new Set(rows.map(row => row.campaignId)).size;
  const selectedPlatforms = PLATFORMS.filter(item => selectedCampaigns.some(itemCampaign => itemCampaign.platform === item.id));
  const byPlatform = selectedPlatforms.map(item => {
    const platformRows = rows.filter(row => row.platform === item.id);
    return {
      ...item,
      ...platformRows.reduce(addMetrics, emptyMetrics()),
      campaignCount: new Set(platformRows.map(row => row.campaignId)).size,
    };
  });
  const timelineMap = new Map();
  rows.forEach(row => {
    if (!timelineMap.has(row.date)) timelineMap.set(row.date, { date: row.date, ...emptyMetrics() });
    addMetrics(timelineMap.get(row.date), row);
  });
  return {
    rows,
    totals,
    byPlatform,
    timeline: [...timelineMap.values()],
    budget: selectedPlatforms.reduce((sum, item) => sum + item.budget, 0),
  };
}

const AUDIENCE_LABELS = {
  cities: ['Casablanca', 'Rabat', 'Tanger', 'Marrakech', 'Fès', 'Agadir', 'Autres / non renseigné'],
  gender: ['Femmes', 'Hommes', 'Non renseigné'],
  ages: ['18–24 ans', '25–34 ans', '35–44 ans', '45–54 ans', '55 ans et +', 'Non renseigné'],
};

const AUDIENCE_WEIGHTS = {
  meta: {
    cities: [35, 17, 12, 11, 8, 6, 11],
    gender: [69, 27, 4],
    ages: [15, 37, 27, 12, 5, 4],
  },
  youtube: {
    cities: [31, 16, 11, 12, 10, 7, 13],
    gender: [57, 37, 6],
    ages: [20, 31, 24, 13, 6, 6],
  },
  tiktok: {
    cities: [32, 14, 16, 13, 8, 6, 11],
    gender: [64, 31, 5],
    ages: [32, 36, 18, 7, 2, 5],
  },
};

/**
 * Dimensions always add up independently to total. These illustrative audience
 * categories are not a statement about the availability of any platform API.
 * Supported measures: impressions, clicks, views (others use impressions).
 */
export function getAudience({ period = 'oct', platform = 'all', campaign = 'all', metric = 'impressions' } = {}) {
  const selectedMetric = ['impressions', 'clicks', 'views'].includes(metric) ? metric : 'impressions';
  const { rows, totals } = getSummary({ period, platform, campaign });
  const buckets = {};
  Object.entries(AUDIENCE_LABELS).forEach(([dimension, labels]) => {
    buckets[dimension] = labels.map(label => ({ label, value: 0 }));
  });
  rows.forEach(row => {
    const monthOffset = Number(row.date.slice(5, 7)) - 10;
    Object.keys(AUDIENCE_LABELS).forEach(dimension => {
      const weights = AUDIENCE_WEIGHTS[row.platform][dimension].map((weight, index) => {
        const periodShift = 1 + 0.045 * monthOffset * Math.cos(index * 1.1 + DELIVERY[row.platform].phase);
        const metricShift = selectedMetric === 'clicks'
          ? 1 + 0.13 * Math.cos(index * 1.4 + 0.4)
          : selectedMetric === 'views' ? 1 + 0.085 * Math.sin(index * 1.2 + 0.9) : 1;
        return weight * periodShift * metricShift;
      });
      const values = allocate(row[selectedMetric], weights);
      values.forEach((value, index) => { buckets[dimension][index].value += value; });
    });
  });
  return { total: totals[selectedMetric], ...buckets };
}
