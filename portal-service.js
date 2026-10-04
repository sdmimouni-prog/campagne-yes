import portalConfig from './portal-config.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CONFIGURATION_MESSAGE = 'La connexion Supabase reste à configurer. Contactez Richmedia.';

function failure(message, status = 503, code = 'SERVICE_ERROR', extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}

function normalizeError(error, fallbackStatus = 503) {
  if (error instanceof Error && error.status && error.code) return error;
  const source = error || {};
  let status = Number(source.status) || fallbackStatus;
  let code = source.code || 'SERVICE_ERROR';
  let message = source.error || source.message || 'Le service est indisponible. Réessayez dans un instant.';
  if (code === '42501') { status = 403; message = 'Votre compte ne dispose pas de cet accès.'; }
  if (['PGRST301', 'PGRST302', 'bad_jwt', 'refresh_token_not_found', 'session_not_found'].includes(code)) {
    status = 401; message = 'Votre session a expiré. Veuillez vous reconnecter.';
  }
  if (code === 'invalid_credentials') {
    status = 401; code = 'AUTH_INVALID_CREDENTIALS'; message = 'L’adresse e-mail ou le mot de passe est incorrect.';
  }
  return failure(String(message), status, code, { fields: source.fields, current: source.current });
}

function publicConfiguration(config) {
  if (config?.backend !== 'supabase' || !config.clientId || typeof config.clientId !== 'string') return false;
  try {
    const url = new URL(config.supabaseUrl);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return false;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return false;
    const key = config.supabasePublishableKey;
    if (typeof key !== 'string' || !key || key !== key.trim()) return false;
    if (key.startsWith('sb_publishable_')) return key.length > 'sb_publishable_'.length;
    if (key.startsWith('sb_secret_')) return false;
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    // Legacy anon keys are public. service_role and every other JWT role are rejected.
    return payload.role === 'anon';
  } catch { return false; }
}

/** Testable service; the default instance below uses the browser and bundled SDK. */
export function createPortalService(config, overrides = {}) {
  const location = overrides.location ?? globalThis.location;
  const events = overrides.eventTarget ?? globalThis.window;
  const fetchImpl = overrides.fetch ?? globalThis.fetch?.bind(globalThis);
  const storage = overrides.storage || {};
  const safeStorage = name => {
    try { return storage[name] ?? (globalThis.window ? globalThis[name] : undefined); } catch { return undefined; }
  };
  const localStore = safeStorage('localStorage');
  const sessionStore = safeStorage('sessionStorage');
  const listeners = new Set();
  const configValid = publicConfiguration(config);
  const mode = config?.backend;
  const namespace = configValid ? `${new URL(config.supabaseUrl).host}-${config.clientId}` : 'unconfigured';
  const storageKey = `richmedia-auth-${namespace}`;
  const preferenceKey = `${storageKey}-remember`;
  const logoutKey = `${storageKey}-logout`;
  const seenLogoutKey = `${storageKey}-seen-logout`;
  const ownedKeys = new Set([storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]);
  let clientPromise;
  let client;
  let authSubscription;
  let broadcast;
  let disposed = false;
  let pendingSignOut = null;

  const read = (store, key) => { try { return store?.getItem(key) ?? null; } catch { return null; } };
  const remove = (store, key) => { try { store?.removeItem(key); } catch { /* Storage may be disabled. */ } };
  const write = (store, key, value) => {
    try {
      if (!store) throw new Error('No storage');
      store.setItem(key, value);
    } catch { throw failure('Autorisez le stockage de ce site pour vous connecter.', 503, 'STORAGE_UNAVAILABLE'); }
  };
  const clearAuthStorage = () => {
    for (const key of ownedKeys) { remove(localStore, key); remove(sessionStore, key); }
    remove(sessionStore, preferenceKey);
  };
  const emit = (event, session) => {
    if (disposed) return;
    // Never await Supabase operations inside its auth callback (the SDK holds a lock).
    queueMicrotask(() => {
      for (const callback of listeners) {
        try { callback(event, session); } catch { /* One subscriber cannot break other guards. */ }
      }
    });
  };
  const selectedStorage = () => {
    const preference = read(sessionStore, preferenceKey);
    if (preference === 'session') return sessionStore;
    if (preference === 'local') return localStore;
    return read(sessionStore, storageKey) !== null ? sessionStore : read(localStore, storageKey) !== null ? localStore : sessionStore;
  };
  const sessionAdapter = {
    getItem(key) { ownedKeys.add(key); return read(selectedStorage(), key); },
    setItem(key, value) {
      ownedKeys.add(key);
      const target = selectedStorage();
      write(target, key, value);
      remove(target === localStore ? sessionStore : localStore, key);
    },
    removeItem(key) { ownedKeys.add(key); remove(localStore, key); remove(sessionStore, key); },
  };
  const receiveSignOut = () => {
    clearAuthStorage();
    const marker = read(localStore, logoutKey);
    if (marker) { try { write(sessionStore, seenLogoutKey, marker); } catch { /* Already signed out. */ } }
    // SDK methods consult the cleared storage; stop background refresh before notifying guards.
    try { client?.auth.stopAutoRefresh?.(); } catch { /* No active refresh timer. */ }
    emit('SIGNED_OUT', null);
  };
  const onStorage = event => {
    if (event.key === logoutKey && event.newValue) receiveSignOut();
  };
  const onResume = () => {
    const current = read(localStore, logoutKey);
    if (current && current !== read(sessionStore, seenLogoutKey)) receiveSignOut();
  };
  function setupSessionEvents() {
    const current = read(localStore, logoutKey);
    const seen = read(sessionStore, seenLogoutKey);
    if (current && seen !== current && read(sessionStore, storageKey)) receiveSignOut();
    if (current) { try { write(sessionStore, seenLogoutKey, current); } catch { /* getUser will fail closed. */ } }
    events?.addEventListener?.('storage', onStorage);
    events?.addEventListener?.('pageshow', onResume);
    events?.addEventListener?.('focus', onResume);
    const Channel = Object.hasOwn(overrides, 'BroadcastChannel') ? overrides.BroadcastChannel : (globalThis.window ? globalThis.BroadcastChannel : null);
    if (Channel) {
      try {
        broadcast = new Channel(`${storageKey}-events`);
        broadcast.onmessage = event => { if (event.data?.type === 'SIGNED_OUT') receiveSignOut(); };
      } catch { /* The storage event remains available. */ }
    }
  }
  function assertMode() {
    if (mode === 'local') {
      if (!LOOPBACK.has(location?.hostname) || !['http:', 'https:'].includes(location?.protocol)) {
        throw failure('Le mode local est réservé à cet ordinateur. Configurez Supabase pour la version en ligne.', 403, 'LOCAL_ONLY');
      }
    } else if (mode !== 'supabase' || !configValid) {
      throw failure(CONFIGURATION_MESSAGE, 503, 'CONFIGURATION');
    }
  }
  async function getClient() {
    assertMode();
    if (mode !== 'supabase') throw failure('Supabase n’est pas activé.', 503, 'CONFIGURATION');
    if (!clientPromise) {
      clientPromise = (async () => {
        const createClient = overrides.createClient || (await import('./vendor/supabase.js')).createClient;
        setupSessionEvents();
        client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey, storage: sessionAdapter },
          global: {
            fetch: (input, init = {}) => {
              const originalSignal = init.signal ?? (typeof input === 'object' ? input?.signal : undefined);
              const deadline = AbortSignal.timeout(12000);
              const signal = originalSignal ? AbortSignal.any([originalSignal, deadline]) : deadline;
              return fetchImpl(input, { ...init, signal });
            },
          },
        });
        const { data } = client.auth.onAuthStateChange((event, session) => emit(event, session));
        authSubscription = data?.subscription;
        return client;
      })().catch(error => {
        clientPromise = undefined;
        throw normalizeError(error);
      });
    }
    return clientPromise;
  }
  function redirectToLogin() {
    const page = location?.pathname?.split('/').pop();
    const next = page === 'gestion-campagnes.html' ? page : 'dashboard.html#overview';
    const target = `index.html?next=${encodeURIComponent(next)}`;
    if (location?.replace) location.replace(target);
    else if (location) location.href = target;
  }
  async function requireAccess({ admin = false, redirect = true } = {}) {
    assertMode();
    if (mode === 'local') return { user: null, role: 'admin', clientId: config.clientId };
    const supabase = await getClient();
    let userResult;
    try { userResult = await supabase.auth.getUser(); }
    catch { throw failure('Impossible de vérifier votre session. Réessayez dans un instant.', 503, 'NETWORK_ERROR'); }
    if (userResult.error || !userResult.data?.user) {
      const error = userResult.error;
      // A network outage is not a successful login and must not expose cached data.
      if (error && (Number(error.status) >= 500 || error.name === 'AuthRetryableFetchError')) throw normalizeError(error);
      if (redirect) redirectToLogin();
      throw failure('Connectez-vous pour accéder à cet espace.', 401, 'AUTH_REQUIRED');
    }
    const user = userResult.data.user;
    let membership;
    try {
      membership = await supabase.from('portal_memberships').select('role,client_id')
        .eq('user_id', user.id).eq('client_id', config.clientId).maybeSingle();
    } catch { throw failure('Impossible de vérifier vos droits d’accès. Réessayez dans un instant.', 503, 'NETWORK_ERROR'); }
    if (membership.error) throw normalizeError(membership.error);
    const role = membership.data?.role;
    if (!['admin', 'viewer'].includes(role) || membership.data.client_id !== config.clientId || (admin && role !== 'admin')) {
      throw failure(admin ? 'La saisie des campagnes est réservée aux administrateurs Richmedia.' : 'Votre compte ne dispose pas d’un accès à cet espace client.', 403, 'ACCESS_DENIED');
    }
    return { user, role, clientId: membership.data.client_id };
  }
  async function signIn(email, password, { remember = false } = {}) {
    assertMode();
    if (mode === 'local') return requireAccess({ redirect: false });
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      throw failure('Renseignez votre adresse e-mail et votre mot de passe.', 400, 'AUTH_INVALID_CREDENTIALS');
    }
    const supabase = await getClient();
    // Finish SDK initialization before changing the storage selected for this sign-in.
    if (supabase.auth.getSession) await supabase.auth.getSession();
    clearAuthStorage();
    write(sessionStore, preferenceKey, remember ? 'local' : 'session');
    let result;
    try { result = await supabase.auth.signInWithPassword({ email: email.trim(), password }); }
    catch { throw failure('La connexion est indisponible. Réessayez dans un instant.', 503, 'NETWORK_ERROR'); }
    if (result.error) throw normalizeError(result.error, 401);
    if (!result.data?.user || !result.data?.session) throw failure('La connexion n’a pas été confirmée.', 401, 'AUTH_REQUIRED');
    const marker = read(localStore, logoutKey);
    if (marker) write(sessionStore, seenLogoutKey, marker);
    try { return await requireAccess({ redirect: false }); }
    catch (error) {
      // Accounts without membership must not retain an authenticated portal session.
      if (error.status === 403) await signOut();
      throw error;
    }
  }
  async function signOut() {
    assertMode();
    if (mode === 'local') return;
    if (pendingSignOut) return pendingSignOut;
    pendingSignOut = (async () => {
      let error;
      try {
        const supabase = await getClient();
        const result = await supabase.auth.signOut({ scope: 'local' });
        error = result?.error;
      } catch (caught) { error = caught; }
      finally {
        clearAuthStorage();
        const marker = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try { write(localStore, logoutKey, marker); write(sessionStore, seenLogoutKey, marker); } catch { /* Channel still signs out open tabs. */ }
        try { broadcast?.postMessage({ type: 'SIGNED_OUT' }); } catch { /* Storage signal remains. */ }
        emit('SIGNED_OUT', null);
        pendingSignOut = null;
      }
      if (error) throw normalizeError(error);
    })();
    return pendingSignOut;
  }
  async function localRequest(path, method = 'GET', payload) {
    assertMode();
    let response;
    try {
      response = await fetchImpl(path, { method, cache: 'no-store', credentials: 'same-origin',
        ...(payload !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(12000) });
    } catch { throw failure('Le serveur local est injoignable. Vérifiez qu’il est démarré, puis réessayez.', 503, 'NETWORK_ERROR'); }
    let data;
    try { data = await response.json(); }
    catch { throw failure('Le service de sauvegarde local n’est pas disponible.', 503, 'INVALID_RESPONSE'); }
    if (!response.ok || data?.error) throw normalizeError({ ...data, status: response.status });
    return data;
  }
  async function rpc(name, args) {
    const supabase = await getClient();
    let result;
    try { result = await supabase.rpc(name, args); }
    catch { throw failure('Supabase est injoignable. Votre saisie est conservée ; réessayez dans un instant.', 503, 'NETWORK_ERROR'); }
    if (result.error) throw normalizeError(result.error, result.status || 503);
    if (result.data?.error) throw normalizeError(result.data);
    return result.data;
  }
  async function getCampaigns() {
    assertMode();
    if (mode === 'local') return localRequest('/api/campaigns');
    await requireAccess();
    const data = await rpc('portal_list_campaigns', { p_client_id: config.clientId });
    if (!data || !Array.isArray(data.campaigns)) throw failure('La réponse du service de campagnes est invalide.', 503, 'INVALID_RESPONSE');
    return { ...data, mode: 'manual' };
  }
  async function saveCampaign(payload, { id = null, archive = false } = {}) {
    assertMode();
    if (id !== null && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) throw failure('La campagne demandée est invalide.', 400, 'INVALID_CAMPAIGN');
    if (archive && !id) throw failure('Sélectionnez une campagne à archiver.', 400, 'INVALID_CAMPAIGN');
    if (mode === 'local') return localRequest(id ? `/api/campaigns/${encodeURIComponent(id)}${archive ? '/archive' : ''}` : '/api/campaigns', id && !archive ? 'PUT' : 'POST', payload);
    await requireAccess({ admin: true });
    const data = await rpc('portal_save_campaign', { p_client_id: config.clientId, p_payload: payload, p_id: id, p_archive: Boolean(archive) });
    if (!data?.campaign) throw failure('Le service n’a pas confirmé la sauvegarde de la campagne.', 503, 'INVALID_RESPONSE');
    return data;
  }
  function onSessionChange(callback) {
    if (mode !== 'supabase') return () => {};
    listeners.add(callback);
    // Do not initialize auth solely for a listener on an unconfigured deployment.
    if (configValid) getClient().catch(() => {});
    return () => listeners.delete(callback);
  }
  function dispose() {
    disposed = true;
    listeners.clear();
    authSubscription?.unsubscribe?.();
    client?.auth.stopAutoRefresh?.();
    broadcast?.close?.();
    events?.removeEventListener?.('storage', onStorage);
    events?.removeEventListener?.('pageshow', onResume);
    events?.removeEventListener?.('focus', onResume);
  }
  return {
    getPortalMode: () => mode,
    isSupabaseConfigured: () => configValid,
    signIn, signOut, requireAccess, getCampaigns, saveCampaign, onSessionChange, dispose,
  };
}

const portal = createPortalService(portalConfig);
export const getPortalMode = portal.getPortalMode;
export const isSupabaseConfigured = portal.isSupabaseConfigured;
export const signIn = portal.signIn;
export const signOut = portal.signOut;
export const requireAccess = portal.requireAccess;
export const getCampaigns = portal.getCampaigns;
export const saveCampaign = portal.saveCampaign;
export const onSessionChange = portal.onSessionChange;
