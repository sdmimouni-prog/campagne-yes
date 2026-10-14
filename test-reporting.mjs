import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as reporting from './reporting-data.js';

const record = (id, changes = {}) => ({
  id, name: `Campagne ${id}`, channel: 'facebook', status: 'active',
  start: '2026-10-01', end: '2026-10-31', budget: 1000.25, spend: 120.2,
  impressions: 1000, clicks: 10, views: 500, trueviews: null, interactions: 20,
  revision: 1, source: 'manual', ...changes,
});
const install = campaigns => reporting.setReportingData({ mode: 'manual', campaigns, updatedAt: '2026-10-04T12:00:00Z' });

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
  install([record('known', { trueviews: 0 }), record('missing', { views: null, spend: null, trueviews: null, interactions: null })]);
  const mixed = reporting.getSummary();
  for (const key of ['spend', 'views', 'trueviews', 'interactions']) {
    assert.equal(mixed.totals[key], null);
    assert.equal(mixed.byPlatform[0][key], null);
  }
  assert.equal(reporting.getSummary({ campaign: 'known' }).totals.trueviews, 0);
  assert.equal(reporting.getSummary({ campaign: 'known' }).totals.views, 500);
  install([record('zero', { impressions: 0, clicks: 0, budget: 0, spend: 0, views: 0, trueviews: 0, interactions: 0 })]);
  const zero = reporting.getSummary();
  assert.equal(zero.rows[0].ctr, null);
  assert.equal(zero.totals.spend, 0);
  assert.equal(zero.budget, 0);
});

test('manual totals do not produce invented daily or audience measurements', () => {
  install([record('total')]);
  assert.deepEqual(reporting.getSummary().timeline, []);
  assert.equal(reporting.getSummary().timelineUnavailable, true);
  assert.deepEqual(reporting.getAudience({ metric: 'clicks' }), { total: null, cities: [], gender: [], ages: [] });
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
