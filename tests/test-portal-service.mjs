import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortalService } from '../portal-service.js';

const cloud = { backend: 'supabase', supabaseUrl: 'https://project.supabase.co', supabasePublishableKey: 'sb_publishable_public-test-key', clientId: 'yes-baby' };
const local = { ...cloud, backend: 'local' };
const campaignId = '35379b4f-cf70-439e-a794-6a59af50eff3';
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
}
function fixture(overrides = {}, configuration = cloud) {
  const localStorage = overrides.localStorage || memoryStorage();
  const sessionStorage = overrides.sessionStorage || memoryStorage();
  const redirects = [], rpcCalls = [], filters = [], eventListeners = new Map();
  let options, callback, role = 'admin', user = { id: 'user-1', email: 'admin@example.test', user_metadata: { role: 'admin' } };
  let rpcResult = { data: { campaigns: [], mode: 'manual', updatedAt: null }, error: null };
  let signInError, getUserError, membershipError, remoteSignOutError;
  let localCalls = 0;
  const sdk = {
    auth: {
      onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user }, error: getUserError }),
      signInWithPassword: async input => {
        if (signInError) return { data: {}, error: signInError };
        options.auth.storage.setItem(options.auth.storageKey, JSON.stringify({ token: 'token-for-test', user }));
        callback('SIGNED_IN', { user });
        return { data: { user, session: { access_token: 'token-for-test' } }, error: null };
      },
      signOut: async () => ({ error: remoteSignOutError }),
      stopAutoRefresh() {},
    },
    from(table) {
      assert.equal(table, 'portal_memberships');
      return {
        select(columns) { assert.equal(columns, 'role,client_id'); return this; },
        eq(column, value) { filters.push([column, value]); return this; },
        async maybeSingle() { return { data: role ? { role, client_id: configuration.clientId } : null, error: membershipError }; },
      };
    },
    rpc: async (name, args) => { rpcCalls.push([name, args]); return rpcResult; },
  };
  const service = createPortalService(configuration, {
    storage: { localStorage, sessionStorage },
    location: { hostname: '127.0.0.1', protocol: 'http:', pathname: '/gestion-campagnes.html', replace: url => redirects.push(url), ...overrides.location },
    eventTarget: { addEventListener: (event, handler) => eventListeners.set(event, handler), removeEventListener: event => eventListeners.delete(event) },
    BroadcastChannel: null,
    createClient: (url, key, config) => { options = config; return sdk; },
    fetch: async (path, init) => { localCalls++; return overrides.fetch ? overrides.fetch(path, init) : { ok: true, status: 200, json: async () => ({ mode: 'demo', campaigns: [] }) }; },
  });
  return { service, localStorage, sessionStorage, redirects, rpcCalls, filters, eventListeners, sdk,
    get options() { return options; }, get localCalls() { return localCalls; },
    setRole: value => { role = value; }, setUser: value => { user = value; },
    setRpc: value => { rpcResult = value; }, setSignInError: value => { signInError = value; },
    setUserError: value => { getUserError = value; }, setMembershipError: value => { membershipError = value; },
    setSignOutError: value => { remoteSignOutError = value; },
  };
}

test('missing configuration and server keys fail closed before any client or fetch', async () => {
  const jwt = role => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  for (const config of [
    { ...cloud, supabaseUrl: '' }, { ...cloud, supabasePublishableKey: '' },
    { ...cloud, supabasePublishableKey: 'sb_secret_never-public' },
    { ...cloud, supabasePublishableKey: jwt('service_role') },
    { ...cloud, supabasePublishableKey: jwt('authenticated') },
    { ...cloud, supabaseUrl: 'http://project.supabase.co' },
    { ...cloud, supabaseUrl: 'https://user:password@project.supabase.co' },
    { ...cloud, backend: 'something-else' },
  ]) {
    const f = fixture({}, config);
    assert.equal(f.service.isSupabaseConfigured(), false);
    await assert.rejects(f.service.getCampaigns(), { code: 'CONFIGURATION', status: 503 });
    assert.equal(f.options, undefined);
    assert.equal(f.localCalls, 0);
  }
  assert.equal(fixture({}, { ...cloud, supabasePublishableKey: jwt('anon') }).service.isSupabaseConfigured(), true);
});

test('local backend cannot be used by a public deployment', async () => {
  const f = fixture({ location: { hostname: 'portal.vercel.app', protocol: 'https:' } }, local);
  await assert.rejects(f.service.getCampaigns(), { code: 'LOCAL_ONLY', status: 403 });
  await assert.rejects(f.service.signIn('demo@example.test', 'anything'), { code: 'LOCAL_ONLY' });
  assert.equal(f.localCalls, 0);
});

test('local API maintains response and optimistic conflict fields', async () => {
  const f = fixture({ fetch: async (path, options) => {
    assert.equal(path, `/api/campaigns/${campaignId}`);
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), { revision: 1 });
    return { ok: false, status: 409, json: async () => ({ error: 'Version modifiée', fields: { revision: 'Rechargez' }, current: { revision: 2 } }) };
  } }, local);
  await assert.rejects(f.service.saveCampaign({ revision: 1 }, { id: campaignId }), error => {
    assert.equal(error.status, 409);
    assert.deepEqual(error.fields, { revision: 'Rechargez' });
    assert.equal(error.current.revision, 2);
    return true;
  });
  const plain = fixture({}, local);
  assert.deepEqual(await plain.service.getCampaigns(), { mode: 'demo', campaigns: [] });
  assert.equal(plain.options, undefined);
});

test('a validated user and membership are required and checked again on each operation', async () => {
  const f = fixture();
  const access = await f.service.requireAccess();
  assert.equal(access.role, 'admin');
  assert.deepEqual(f.filters, [['user_id', 'user-1'], ['client_id', 'yes-baby']]);
  f.setRole('viewer');
  await assert.rejects(f.service.saveCampaign({}), { status: 403, code: 'ACCESS_DENIED' });
  assert.equal(f.rpcCalls.length, 0);
  // The user's metadata still says admin; it never grants database permissions.
  const viewed = await f.service.getCampaigns();
  assert.equal(viewed.mode, 'manual');
  f.setRole(null);
  await assert.rejects(f.service.getCampaigns(), { status: 403 });
  assert.equal(f.rpcCalls.length, 1);
  assert.equal(f.redirects.length, 0);
  f.service.dispose();
});

test('expired login redirects to the fixed local page and cannot read data', async () => {
  const f = fixture();
  f.setUser(null);
  await assert.rejects(f.service.getCampaigns(), { status: 401, code: 'AUTH_REQUIRED' });
  assert.deepEqual(f.redirects, ['index.html?next=gestion-campagnes.html']);
  assert.equal(f.rpcCalls.length, 0);
  const withoutRedirect = fixture();
  withoutRedirect.setUser(null);
  await assert.rejects(withoutRedirect.service.requireAccess({ redirect: false }), { status: 401 });
  assert.deepEqual(withoutRedirect.redirects, []);
  f.service.dispose(); withoutRedirect.service.dispose();
});

test('cloud outages and denied membership do not fall back to local or demo data', async () => {
  const f = fixture();
  f.setRpc({ data: null, error: { message: 'Network failed', status: 503 } });
  await assert.rejects(f.service.getCampaigns(), { status: 503 });
  assert.equal(f.localCalls, 0);
  f.setMembershipError({ code: '42501', message: 'Not allowed' });
  await assert.rejects(f.service.getCampaigns(), { status: 403 });
  assert.equal(f.rpcCalls.length, 1);
  f.service.dispose();
});

test('RPC write contract, archive, and conflict envelopes preserve revision data', async () => {
  const f = fixture();
  f.setRpc({ data: { campaign: { id: campaignId, revision: 4 }, updatedAt: '2026-10-04' }, error: null });
  const result = await f.service.saveCampaign({ revision: 3 }, { id: campaignId, archive: true });
  assert.equal(result.campaign.revision, 4);
  assert.deepEqual(f.rpcCalls[0], ['portal_save_campaign', { p_client_id: 'yes-baby', p_payload: { revision: 3 }, p_id: campaignId, p_archive: true }]);
  f.setRpc({ data: { error: 'Conflit', status: 409, fields: { revision: 'Périmée' }, current: { revision: 5 } }, error: null });
  await assert.rejects(f.service.saveCampaign({ revision: 3 }, { id: campaignId }), error => error.status === 409 && error.current.revision === 5);
  assert.equal(f.localCalls, 0);
  f.service.dispose();
});

test('sign-in failure cannot manufacture a session or call campaigns RPC', async () => {
  const f = fixture();
  f.setSignInError({ code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' });
  await assert.rejects(f.service.signIn('admin@example.test', 'wrong'), { status: 401, code: 'AUTH_INVALID_CREDENTIALS' });
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.sessionStorage.getItem(f.options.auth.storageKey), null);
  assert.equal(f.localStorage.getItem(f.options.auth.storageKey), null);
  f.service.dispose();
});

test('remember off stores tokens only for the tab; remember on persists across page instances', async () => {
  const f = fixture();
  await f.service.signIn('admin@example.test', 'valid', { remember: false });
  const key = f.options.auth.storageKey;
  assert.equal(f.localStorage.getItem(key), null);
  assert.ok(f.sessionStorage.getItem(key));
  assert.equal(f.options.auth.persistSession, true);
  assert.equal(f.options.auth.detectSessionInUrl, false);
  assert.equal(f.options.auth.autoRefreshToken, true);
  const nextPage = fixture({ localStorage: f.localStorage, sessionStorage: f.sessionStorage });
  await nextPage.service.requireAccess();
  assert.ok(nextPage.options.auth.storage.getItem(key));
  await f.service.signIn('admin@example.test', 'valid', { remember: true });
  assert.ok(f.localStorage.getItem(key));
  assert.equal(f.sessionStorage.getItem(key), null);
  const newTab = fixture({ localStorage: f.localStorage });
  await newTab.service.requireAccess();
  assert.ok(newTab.options.auth.storage.getItem(key));
  f.service.dispose(); nextPage.service.dispose(); newTab.service.dispose();
});

test('sign-out clears both storage types and signals other open tabs even if remote logout fails', async () => {
  const f = fixture();
  await f.service.signIn('admin@example.test', 'valid');
  const key = f.options.auth.storageKey;
  const other = fixture({ localStorage: f.localStorage });
  await other.service.signIn('admin@example.test', 'valid');
  const events = [];
  other.service.onSessionChange(event => events.push(event));
  f.localStorage.setItem(key, 'stale-token');
  f.setSignOutError({ status: 503, message: 'Offline' });
  await assert.rejects(f.service.signOut(), { status: 503 });
  assert.equal(f.localStorage.getItem(key), null);
  assert.equal(f.sessionStorage.getItem(key), null);
  other.eventListeners.get('storage')({ key: `${key}-logout`, newValue: f.localStorage.getItem(`${key}-logout`) });
  await Promise.resolve();
  assert.equal(other.sessionStorage.getItem(key), null);
  assert.ok(events.includes('SIGNED_OUT'));
  f.service.dispose(); other.service.dispose();
});

test('a cloud response cannot enable demonstration mode', async () => {
  const f = fixture();
  f.setRpc({ data: { mode: 'demo', campaigns: [], updatedAt: null }, error: null });
  assert.equal((await f.service.getCampaigns()).mode, 'manual');
  f.service.dispose();
});

test('concurrent sign-out callers all wait until the shared session has been cleared', async () => {
  const f = fixture();
  await f.service.signIn('admin@example.test', 'valid');
  let finish, started, calls = 0, completed = 0;
  const remote = new Promise(resolve => { finish = resolve; });
  const didStart = new Promise(resolve => { started = resolve; });
  f.sdk.auth.signOut = () => { calls += 1; started(); return remote; };
  const first = f.service.signOut().then(() => { completed += 1; });
  const second = f.service.signOut().then(() => { completed += 1; });
  await didStart;
  assert.equal(completed, 0);
  assert.equal(calls, 1);
  assert.ok(f.sessionStorage.getItem(f.options.auth.storageKey));
  finish({ error: null });
  await Promise.all([first, second]);
  assert.equal(completed, 2);
  assert.equal(f.sessionStorage.getItem(f.options.auth.storageKey), null);
  f.service.dispose();
});

test('SDK requests receive a bounded abort signal and preserve a caller cancellation', async () => {
  let received;
  const f = fixture({ fetch: async (path, options) => { received = options; return new Response('{}'); } });
  await f.service.requireAccess();
  await f.options.global.fetch('https://project.supabase.co/auth/v1/user', { headers: { 'x-test': 'yes' } });
  assert.ok(received.signal instanceof AbortSignal);
  assert.equal(received.signal.aborted, false);
  assert.equal(received.headers['x-test'], 'yes');
  const controller = new AbortController(); controller.abort();
  await f.options.global.fetch('https://project.supabase.co/auth/v1/user', { signal: controller.signal });
  assert.equal(received.signal.aborted, true);
  f.service.dispose();
});

test('bundled SDK contract signs in, rehydrates a page, reads RPC and signs out', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const localStorage = memoryStorage(), sessionStorage = memoryStorage(), calls = [];
  const user = { id: 'f737f90e-33a2-4d23-aea0-153e815a9942', aud: 'authenticated', role: 'authenticated', email: 'admin@example.test' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.test-signature`;
  const fetch = async (input, options) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    let data;
    if (url.pathname === '/auth/v1/token') data = { access_token: token, refresh_token: 'refresh-test', expires_in: 3600, token_type: 'bearer', user };
    else if (url.pathname === '/auth/v1/user') data = user;
    else if (url.pathname === '/auth/v1/logout') data = {};
    else if (url.pathname === '/rest/v1/portal_memberships') data = [{ role: 'admin', client_id: 'yes-baby' }];
    else if (url.pathname === '/rest/v1/rpc/portal_list_campaigns') data = { mode: 'manual', campaigns: [], updatedAt: null };
    else throw new Error(`Unexpected test route: ${url.pathname}`);
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const make = () => createPortalService(cloud, {
    storage: { localStorage, sessionStorage }, location: { hostname: 'localhost', protocol: 'http:' }, BroadcastChannel: null,
    createClient, fetch,
  });
  const first = make();
  try {
    const access = await first.signIn('admin@example.test', 'valid-password');
    assert.equal(access.role, 'admin');
    assert.equal([...localStorage.values.keys()].some(key => key.endsWith('yes-baby')), false);
    const second = make();
    try {
      assert.equal((await second.requireAccess({ redirect: false })).user.id, user.id);
      assert.equal((await second.getCampaigns()).mode, 'manual');
      await second.signOut();
      await assert.rejects(second.requireAccess({ redirect: false }), { status: 401 });
      assert.ok(calls.includes('/auth/v1/logout'));
    } finally { second.dispose(); }
  } finally { first.dispose(); }
});
