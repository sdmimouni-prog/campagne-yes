import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reporting from './reporting-data.js';

const record = (id, changes = {}) => ({
  id, name: `Campagne ${id}`, channel: 'facebook', status: 'active',
  start: '2026-10-01', end: '2026-10-31', budget: 1000.25, spend: 120.2,
  impressions: 1000, clicks: 10, views: 500, interactions: 20,
  revision: 1, source: 'manual', ...changes,
});
const install = campaigns => reporting.setReportingData({ mode: 'manual', campaigns, updatedAt: '2026-10-04T12:00:00Z' });
const audienceRow = (label, values = {}) => ({ label, impressions: null, clicks: null, reach: null, ...values });

test('manual source replaces all demo campaigns and groups Facebook + Instagram as Meta', () => {
  reporting.setReportingData({ mode: 'demo', campaigns: [], updatedAt: null });
  assert.equal(reporting.getSummary().totals.activeCampaigns, 3);
  install([record('fb'), record('ig', { channel: 'instagram', impressions: 3000, clicks: 90, budget: 3000.55, spend: 240.35 }), record('display', { channel: 'display', budget: 200 })]);
  const meta = reporting.getSummary({ platform: 'meta' });
  assert.equal(meta.rows.length, 2);
  assert.deepEqual(meta.rows.map(item => item.channel), ['facebook', 'instagram']);
  assert.equal(meta.byPlatform.length, 1);
  assert.equal(meta.byPlatform[0].campaignCount, 2);
  assert.equal(meta.budget, 4000.8);
  assert.equal(meta.totals.spend, 360.55);
  assert.equal(meta.totals.impressions, 4000);
  assert.equal(meta.totals.clicks, 100);
  assert.equal(meta.totals.clicks / meta.totals.impressions * 100, 2.5);
  assert.equal(reporting.getSummary().totals.activeCampaigns, 3);
  assert.equal(reporting.getSummary({ platform: 'display' }).totals.activeCampaigns, 1);
  assert.equal(reporting.CAMPAIGNS.some(item => item.id === 'yes-meta'), false);
});

test('cumulative records are counted once, wholly within their period; partial months are excluded', () => {
  install([
    record('october'),
    record('crossing', { start: '2026-10-20', end: '2026-11-05', impressions: 6000 }),
    record('november', { start: '2026-11-01', end: '2026-11-30' }),
  ]);
  assert.deepEqual(reporting.PERIODS.map(period => period.id), ['all', '2026-10', '2026-11']);
  const october = reporting.getSummary({ period: '2026-10' });
  assert.deepEqual(october.rows.map(row => row.campaignId), ['october']);
  assert.equal(october.excludedPartialCount, 1);
  assert.equal(october.totals.impressions, 1000);
  assert.equal(october.budget, 1000.25);
  assert.equal(reporting.getSummary({ period: 'all' }).totals.impressions, 8000);
  assert.equal(reporting.getSummary({ period: 'all' }).excludedPartialCount, 0);
  assert.equal(reporting.getSummary({ period: '2026-10', campaign: 'crossing' }).rows.length, 0);
  assert.equal(reporting.getSummary({ period: 'all', campaign: 'crossing' }).totals.impressions, 6000);
});

test('missing optional metrics remain unknown; a recorded zero remains zero', () => {
  install([record('known', { interactions: 0 }), record('missing', { views: null, spend: null, interactions: null })]);
  const mixed = reporting.getSummary();
  for (const key of ['spend', 'views', 'interactions']) {
    assert.equal(mixed.totals[key], null);
    assert.equal(mixed.byPlatform[0][key], null);
  }
  assert.equal(reporting.getSummary({ campaign: 'known' }).totals.interactions, 0);
  assert.equal(reporting.getSummary({ campaign: 'known' }).totals.views, 500);
  install([record('zero', { impressions: 0, clicks: 0, budget: 0, spend: 0, views: 0, interactions: 0 })]);
  const zero = reporting.getSummary();
  assert.equal(zero.rows[0].ctr, null);
  assert.equal(zero.totals.spend, 0);
  assert.equal(zero.budget, 0);
});

test('legacy TrueViews data is omitted from campaigns, results and aggregates', () => {
  const legacy = record('legacy', { start: '2026-10-04', end: '2026-10-04', trueviews: 275 });
  install([legacy]);
  const summary = reporting.getSummary();
  for (const output of [...reporting.CAMPAIGNS, ...summary.rows, summary.totals, ...summary.byPlatform, ...summary.timeline]) {
    assert.equal(Object.hasOwn(output, 'trueviews'), false);
  }
  assert.equal(summary.rows[0].views, 500);
  assert.equal(summary.totals.views, 500);
  assert.equal(legacy.trueviews, 275);
  reporting.setReportingData({ mode: 'demo', campaigns: [], updatedAt: null });
  const demo = reporting.getSummary();
  assert.equal(Object.hasOwn(demo.totals, 'trueviews'), false);
  assert.ok(demo.byPlatform.every(platform => !Object.hasOwn(platform, 'trueviews')));
});

test('manual totals do not produce invented daily or audience measurements', () => {
  install([record('total')]);
  assert.deepEqual(reporting.getSummary().timeline, []);
  assert.equal(reporting.getSummary().timelineUnavailable, true);
  const audience = reporting.getAudience({ metric: 'clicks' });
  assert.equal(audience.total, 10);
  assert.equal(audience.source, 'manual');
  for (const dimension of ['cities', 'gender', 'ages']) {
    assert.deepEqual(audience[dimension], []);
    assert.equal(audience.dimensions[dimension].reportedTotal, 0);
    assert.equal(audience.dimensions[dimension].availableCampaigns, 0);
    assert.equal(audience.dimensions[dimension].partial, true);
  }
  install([
    record('later', { start: '2026-10-04', end: '2026-10-04', impressions: 300 }),
    record('early1', { start: '2026-10-02', end: '2026-10-02', impressions: 100 }),
    record('early2', { channel: 'youtube', start: '2026-10-02', end: '2026-10-02', impressions: 200, spend: null }),
  ]);
  const daily = reporting.getSummary();
  assert.equal(daily.timelineUnavailable, false);
  assert.deepEqual(daily.timeline.map(item => [item.date, item.impressions]), [['2026-10-02', 300], ['2026-10-04', 300]]);
  assert.equal(daily.timeline[0].spend, null);
});

test('archived records are excluded without reverting an empty manual source to demo', () => {
  install([record('archived', { status: 'archived' })]);
  assert.equal(reporting.getReportingState().mode, 'manual');
  assert.equal(reporting.CAMPAIGNS.length, 0);
  assert.equal(reporting.PERIODS[0].id, 'all');
  const summary = reporting.getSummary();
  assert.deepEqual(summary.rows, []);
  assert.deepEqual(summary.byPlatform, []);
  assert.equal(summary.totals.impressions, 0);
  assert.equal(summary.totals.spend, null);
  assert.equal(summary.budget, 0);
});

test('period generation includes leap days and exact end boundaries', () => {
  install([record('leap', { start: '2028-02-01', end: '2028-02-29' })]);
  assert.equal(reporting.PERIODS.find(period => period.id === '2028-02').end, '2028-02-29');
  assert.equal(reporting.getSummary({ period: '2028-02' }).rows.length, 1);
});

test('invalid payload installation is atomic and cannot erase known data', () => {
  install([record('existing')]);
  assert.throws(() => install([record('bad', { impressions: -1 })]), /invalides/);
  assert.throws(() => install([record('a'), record('a')]), /double/);
  assert.throws(() => install([record('date', { start: '2026-02-30' })]), /invalides/);
  assert.equal(reporting.CAMPAIGNS[0].id, 'existing');
});

test('source failures reject without a fictional-data fallback', async () => {
  install([record('real')]);
  await assert.rejects(reporting.loadReportingData(async()=>{throw new Error('Offline');}), /Offline/);
  assert.equal(reporting.getReportingState().mode, 'manual');
  assert.equal(reporting.CAMPAIGNS[0].id, 'real');
  await assert.rejects(reporting.loadReportingData(async()=>{throw new Error('Accès refusé');}), /Accès refusé/);
  await reporting.loadReportingData(async()=>({mode:'manual',campaigns:[record('loaded')],updatedAt:'fresh'}));
  assert.equal(reporting.CAMPAIGNS[0].id, 'loaded');
  assert.equal(reporting.getReportingState().updatedAt, 'fresh');
});

test('sign-out invalidates a response already in flight before it can reinstall protected data', async () => {
  install([record('visible-before-sign-out')]);
  let finish;
  const request = reporting.loadReportingData(() => new Promise(resolve => { finish = resolve; }));
  reporting.clearReportingData();
  finish({ mode: 'manual', campaigns: [record('late-response')], updatedAt: 'late' });
  await assert.rejects(request, { code: 'STALE_REPORTING_LOAD' });
  assert.deepEqual(reporting.CAMPAIGNS, []);
  assert.deepEqual(reporting.PERIODS, []);
  assert.equal(reporting.getReportingState().mode, 'loading');
  assert.throws(() => reporting.getSummary(), /pas encore chargées/);
});

test('a newer refresh wins and an invalidated page guard prevents installation', async () => {
  let finishOlder;
  const older = reporting.loadReportingData(() => new Promise(resolve => { finishOlder = resolve; }));
  await reporting.loadReportingData(async () => ({ mode: 'manual', campaigns: [record('latest')], updatedAt: 'latest' }));
  finishOlder({ mode: 'manual', campaigns: [record('old')], updatedAt: 'old' });
  await assert.rejects(older, { code: 'STALE_REPORTING_LOAD' });
  assert.equal(reporting.CAMPAIGNS[0].id, 'latest');
  await assert.rejects(reporting.loadReportingData(async () => ({ mode: 'manual', campaigns: [record('denied')] }), { isCurrent: () => false }), { code: 'STALE_REPORTING_LOAD' });
  assert.equal(reporting.CAMPAIGNS[0].id, 'latest');
});

test('reach and frequency preserve missing data and avoid adding unique audiences', () => {
  install([record('a', { reach: 400 })]);
  assert.equal(reporting.getSummary().byPlatform[0].reach, 400);
  assert.equal(reporting.getSummary().byPlatform[0].frequency, 2.5);
  install([record('a', { reach: 400 }), record('b', { reach: 200 })]);
  assert.equal(reporting.getSummary().byPlatform[0].reach, null);
  assert.equal(reporting.getSummary().byPlatform[0].frequency, null);
  install([record('missing')]);
  assert.equal(reporting.getSummary().totals.reach, null);
  install([record('zero', { reach: 0 })]);
  assert.equal(reporting.getSummary().totals.reach, 0);
  assert.equal(reporting.getSummary().totals.frequency, null);
});

test('frequency follows the latest impressions and reach instead of a supplied frequency', () => {
  install([record('updated', { reach: 400, frequency: 999 })]);
  assert.equal(reporting.CAMPAIGNS[0].frequency, 2.5);
  assert.equal(reporting.getSummary().rows[0].frequency, 2.5);
  install([record('updated', { impressions: 1200, reach: 300, frequency: 999 })]);
  const updated = reporting.getSummary();
  assert.equal(updated.rows[0].frequency, 4);
  assert.equal(updated.totals.frequency, 4);
  assert.equal(updated.byPlatform[0].frequency, 4);
  install([record('updated', { reach: null, frequency: 999 })]);
  assert.equal(reporting.getSummary().rows[0].frequency, null);
  assert.equal(reporting.getSummary().totals.frequency, null);
});

test('selecting one campaign restores its unique reach without combining other campaigns', () => {
  install([
    record('fb', { reach: 400 }),
    record('ig', { channel: 'instagram', impressions: 1800, reach: 600 }),
    record('youtube', { channel: 'youtube', reach: 500 }),
  ]);
  assert.equal(reporting.getSummary().totals.reach, null);
  assert.equal(reporting.getSummary({ platform: 'meta' }).totals.frequency, null);
  const selected = reporting.getSummary({ platform: 'meta', campaign: 'ig' });
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].reach, 600);
  assert.equal(selected.rows[0].frequency, 3);
  assert.equal(selected.totals.reach, 600);
  assert.equal(selected.totals.frequency, 3);
  assert.equal(selected.byPlatform[0].reach, 600);
  assert.equal(selected.byPlatform[0].frequency, 3);
});

test('invalid reach cannot partially replace previously loaded campaign data', () => {
  install([record('known', { reach: 400 })]);
  for (const reach of [-1, 0.5, '400', Infinity, 9000000000001]) {
    assert.throws(() => install([record('valid-first'), record('invalid', { reach })]), /Reach.*invalide/);
    assert.deepEqual(reporting.CAMPAIGNS.map(campaign => campaign.id), ['known']);
    assert.equal(reporting.getSummary().totals.reach, 400);
    assert.equal(reporting.getSummary().totals.frequency, 2.5);
  }
});

test('audience merges known categories while coverage includes campaigns without breakdowns', () => {
  install([
    record('fb', { audience: {
      cities: [audienceRow(' Rabat ', { impressions: 100, clicks: 1 }), audienceRow('Casablanca', { impressions: 500, clicks: 5 })],
      gender: [audienceRow('Hommes', { impressions: 300 }), audienceRow('Femmes', { impressions: 600 })],
      ages: [audienceRow('35–44', { impressions: 100 }), audienceRow('18–24', { impressions: 200 })],
    } }),
    record('ig', { channel: 'instagram', impressions: 2000, clicks: 20, audience: {
      cities: [audienceRow('rabat', { impressions: 500, clicks: 4 }), audienceRow('CASABLANCA', { impressions: 1000, clicks: 10 })],
      gender: [audienceRow('Femmes', { impressions: 1000 }), audienceRow('Hommes', { impressions: 500 })],
      ages: [audienceRow('65+', { impressions: 100 }), audienceRow('18–24', { impressions: 500 })],
    } }),
    record('no-breakdown'),
  ]);
  const audience = reporting.getAudience({ metric: 'impressions' });
  assert.equal(audience.total, 4000);
  assert.deepEqual(audience.cities, [{ label: 'Casablanca', value: 1500 }, { label: 'Rabat', value: 600 }]);
  assert.deepEqual(audience.gender, [{ label: 'Femmes', value: 1600 }, { label: 'Hommes', value: 800 }]);
  assert.deepEqual(audience.ages, [{ label: '18–24', value: 700 }, { label: '35–44', value: 100 }, { label: '65+', value: 100 }]);
  assert.deepEqual(audience.dimensions.cities, {
    total: 4000, reportedTotal: 2100, coverage: 0.525, partial: true, availableCampaigns: 2, campaignCount: 3,
  });
  const clicks = reporting.getAudience({ metric: 'clicks' });
  assert.equal(clicks.total, 40);
  assert.equal(clicks.dimensions.cities.reportedTotal, 20);
  assert.equal(clicks.dimensions.cities.coverage, 0.5);
  assert.deepEqual(clicks.gender, []);
  assert.equal(clicks.dimensions.gender.availableCampaigns, 0);
});

test('audience uses exactly the summary campaign, platform, archive and whole-period filters', () => {
  const city = label => ({ cities: [audienceRow(label, { impressions: 100 })] });
  install([
    record('october', { audience: city('Octobre') }),
    record('crossing', { start: '2026-10-20', end: '2026-11-05', audience: city('Chevauchement') }),
    record('november', { channel: 'youtube', start: '2026-11-01', end: '2026-11-30', audience: city('Novembre') }),
    record('archived', { status: 'archived', audience: city('Archivée') }),
  ]);
  const options = { period: '2026-10', platform: 'meta' };
  const october = reporting.getAudience(options);
  assert.deepEqual(october.cities, [{ label: 'Octobre', value: 100 }]);
  assert.equal(october.total, reporting.getSummary(options).totals.impressions);
  assert.equal(october.dimensions.cities.campaignCount, 1);
  assert.deepEqual(reporting.getAudience({ ...options, campaign: 'crossing' }).cities, []);
  assert.equal(reporting.getAudience({ ...options, campaign: 'crossing' }).dimensions.cities.campaignCount, 0);
  assert.deepEqual(reporting.getAudience({ period: 'all', campaign: 'crossing' }).cities, [{ label: 'Chevauchement', value: 100 }]);
  assert.deepEqual(reporting.getAudience({ period: 'all', platform: 'youtube' }).cities, [{ label: 'Novembre', value: 100 }]);
});

test('audience preserves explicit zeros, omits unknown rows and never fills absent categories', () => {
  install([record('zero', { impressions: 0, clicks: 0, reach: 0, audience: {
    gender: [audienceRow('Hommes'), audienceRow('Femmes', { impressions: 0, clicks: 0, reach: 0 })],
    ages: null,
  } })]);
  assert.deepEqual(reporting.CAMPAIGNS[0].audience.gender, [audienceRow('Femmes', { impressions: 0, clicks: 0, reach: 0 })]);
  const zero = reporting.getAudience();
  assert.deepEqual(zero.gender, [{ label: 'Femmes', value: 0 }]);
  assert.deepEqual(zero.ages, []);
  assert.deepEqual(zero.cities, []);
  assert.equal(zero.dimensions.gender.total, 0);
  assert.equal(zero.dimensions.gender.coverage, null);
  assert.equal(zero.dimensions.gender.partial, false);
  assert.equal(zero.dimensions.ages.partial, true);
  assert.deepEqual(reporting.getAudience({ metric: 'reach' }).gender, [{ label: 'Femmes', value: 0 }]);
  install([record('old'), record('null', { audience: null })]);
  for (const campaign of reporting.CAMPAIGNS) assert.deepEqual(campaign.audience, { gender: [], ages: [], cities: [] });
  assert.deepEqual(reporting.getAudience().gender, []);
});

test('reach audience is available per campaign but cannot be added across campaigns', () => {
  install([
    record('fb', { reach: 600, audience: { gender: [audienceRow('Femmes', { reach: 300 }), audienceRow('Hommes', { reach: 200 })] } }),
    record('ig', { channel: 'instagram', reach: 400, audience: { gender: [audienceRow('Femmes', { reach: 400 })] } }),
  ]);
  const combined = reporting.getAudience({ metric: 'reach', platform: 'meta' });
  assert.equal(combined.reachRequiresSingleCampaign, true);
  assert.equal(combined.total, null);
  assert.deepEqual(combined.gender, []);
  assert.equal(combined.dimensions.gender.total, null);
  const selected = reporting.getAudience({ metric: 'reach', campaign: 'fb' });
  assert.equal(selected.reachRequiresSingleCampaign, false);
  assert.equal(selected.total, 600);
  assert.deepEqual(selected.gender, [{ label: 'Femmes', value: 300 }, { label: 'Hommes', value: 200 }]);
  assert.equal(selected.dimensions.gender.reportedTotal, 500);
  assert.equal(selected.dimensions.gender.coverage, 500 / 600);
  assert.equal(selected.dimensions.gender.partial, true);
});

test('unknown overall reach uses each dimension reported total without claiming full coverage', () => {
  install([record('unknown-reach', { audience: {
    gender: [audienceRow('Femmes', { reach: 200 }), audienceRow('Hommes', { reach: 100 })],
    cities: [audienceRow('Rabat', { reach: 120 })],
  } })]);
  const audience = reporting.getAudience({ metric: 'reach' });
  assert.equal(audience.total, null);
  assert.equal(audience.dimensions.gender.total, 300);
  assert.equal(audience.dimensions.cities.total, 120);
  assert.equal(audience.dimensions.gender.coverage, null);
  assert.equal(audience.dimensions.gender.partial, true);
  assert.equal(audience.dimensions.gender.availableCampaigns, 1);
  assert.equal(audience.reachRequiresSingleCampaign, false);
});

test('audience validation rejects malformed or excessive breakdowns atomically', () => {
  install([record('known', { audience: { cities: [audienceRow('Rabat', { impressions: 50 })] } })]);
  const invalidAudiences = [
    [], 'invalid', { countries: [] }, { gender: {} }, { cities: [null] },
    { cities: [{ label: 'Rabat', other: 1 }] }, { cities: [{ label: 42 }] },
    { gender: [audienceRow('Autre', { impressions: 1 })] },
    { ages: [audienceRow('18-24', { impressions: 1 })] },
    { cities: [audienceRow('  ', { impressions: 1 })] },
    { cities: [audienceRow('A'.repeat(81), { impressions: 1 })] },
    { cities: [audienceRow(' Rabat '), audienceRow('rabat', { impressions: 1 })] },
    { cities: Array.from({ length: 101 }, (_, index) => audienceRow(`Ville ${index}`, { impressions: 0 })) },
    ...[-1, 0.5, '5', true, Infinity, 9000000000001].map(impressions => ({ cities: [audienceRow('Rabat', { impressions })] })),
    { cities: [audienceRow('Rabat', { impressions: 600 }), audienceRow('Fès', { impressions: 500 })] },
    { gender: [audienceRow('Femmes', { clicks: 11 })] },
  ];
  for (const audience of invalidAudiences) {
    assert.throws(() => install([record('valid-first'), record('bad', { audience })]), /audience.*invalides/);
    assert.deepEqual(reporting.CAMPAIGNS.map(campaign => campaign.id), ['known']);
    assert.deepEqual(reporting.getAudience().cities, [{ label: 'Rabat', value: 50 }]);
  }
  assert.throws(() => install([record('bad-reach', { reach: 5, audience: { cities: [audienceRow('Rabat', { reach: 6 })] } })]), /audience.*invalides/);
});

test('demonstration retains simulated breakdowns but never invents reach or leaks into manual data', () => {
  reporting.setReportingData({ mode: 'demo', campaigns: [], updatedAt: null });
  const demo = reporting.getAudience({ metric: 'clicks' });
  assert.equal(demo.source, 'demo');
  assert.ok(demo.cities.length > 0);
  assert.equal(demo.gender.reduce((sum, row) => sum + row.value, 0), demo.total);
  assert.equal(demo.dimensions.gender.coverage, 1);
  for (const options of [{ metric: 'reach' }, { metric: 'reach', campaign: reporting.CAMPAIGNS[0].id }]) {
    const reach = reporting.getAudience(options);
    assert.equal(reach.total, null);
    assert.deepEqual(reach.cities, []);
    assert.deepEqual(reach.gender, []);
    assert.deepEqual(reach.ages, []);
  }
  install([record('real')]);
  assert.equal(reporting.getAudience().source, 'manual');
  assert.deepEqual(reporting.getAudience().cities, []);
});
