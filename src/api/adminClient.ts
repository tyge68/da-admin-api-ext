export const ADMIN_HOST = 'https://admin.hlx.page';
export const LOG_HOST = 'https://api.aem.live';

export class AdminApiError extends Error {
  constructor(public status: number, message: string, public noAuth = false) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export interface SiteRef { org: string; site: string }

let token: string | null = null; // memory only; never persisted
export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;

/** Fetch-like result used by transports (e.g. the background relay). */
export interface ResLike { ok: boolean; status: number; statusText: string; text(): Promise<string> }
export type Transport = (url: string, init: RequestInit) => Promise<ResLike>;
let transport: Transport | null = null;
/** When set, admin calls go through the transport (which adds auth itself); no token is held here. */
export const setTransport = (t: Transport | null) => { transport = t; };

function friendly(status: number): string | null {
  if (status === 401) return 'Unauthorized (401): token missing or expired. Sign in again.';
  if (status === 403) return 'Forbidden (403): you lack permission (admin role required) for this site.';
  if (status === 404) return 'Not found (404): check org/site or the item id.';
  return null;
}

async function request<T>(url: string, init: RequestInit = {}, headers: Record<string, string> = {}, send: Transport = (u, i) => fetch(u, i)): Promise<T> {
  const res = await send(url, {
    ...init,
    headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
  if (!res.ok) {
    throw new AdminApiError(res.status, friendly(res.status) ?? `Request failed (${res.status} ${res.statusText})`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const base = ({ org, site }: SiteRef) =>
  `${ADMIN_HOST}/config/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}`;

function admin<T>(ref: SiteRef, path: string, init: RequestInit = {}): Promise<T> {
  if (transport) return request<T>(`${base(ref)}${path}`, init, {}, transport);
  if (!token) return Promise.reject(new AdminApiError(401, friendly(401)!));
  return request<T>(`${base(ref)}${path}`, init, { Authorization: `Bearer ${token}` });
}

/** The API answers 404 ("[AWS] Not Found") for a site that exists but has no API keys yet: treat as empty. */
export const listApiKeys = (ref: SiteRef) =>
  admin<unknown>(ref, '/apiKeys.json').catch((e) => { if (e instanceof AdminApiError && e.status === 404) return {}; throw e; });
export const createApiKey = (ref: SiteRef, description: string, roles: string[]) =>
  admin<unknown>(ref, '/apiKeys.json', { method: 'POST', body: JSON.stringify({ description, roles }) });
export const deleteApiKey = (ref: SiteRef, id: string) =>
  admin<void>(ref, `/apiKeys/${encodeURIComponent(id)}.json`, { method: 'DELETE' });
export const createSecret = (ref: SiteRef, value?: string) =>
  admin<unknown>(ref, '/secrets.json', { method: 'POST', body: JSON.stringify(value ? { value } : {}) });
export const deleteSecret = (ref: SiteRef, id: string) =>
  admin<void>(ref, `/secrets/${encodeURIComponent(id)}.json`, { method: 'DELETE' });
/**
 * Replace the value of an existing secret, keeping its id.
 * Verified against the real Admin API 2026-11-24: POST secrets/{id}.json {value} works.
 * (The published OpenAPI v12.152.0 only lists GET/DELETE for this URL; the spec lags the API.)
 */
export const updateSecret = (ref: SiteRef, id: string, value: string) =>
  admin<unknown>(ref, `/secrets/${encodeURIComponent(id)}.json`, { method: 'POST', body: JSON.stringify({ value }) });
export const getSiteConfig = (ref: SiteRef) => admin<unknown>(ref, ".json");
export const listWebhooks = (ref: SiteRef) => admin<unknown>(ref, '.json');
export const addWebhook = (ref: SiteRef, secretId: string, url: string) =>
  admin<unknown>(ref, '/webhooks.json', { method: 'POST', body: JSON.stringify({ url, secretId }) });
/**
 * Point an existing webhook at another secret, keeping its id and url.
 * Verified against the real Admin API 2026-11-24: POST webhooks/{id}.json {url, secretId} works.
 * (Webhooks live in the site config `webhooks` array, max 2 per site; not in the published OpenAPI.)
 */
export const updateWebhook = (ref: SiteRef, id: string, body: { secretId: string; url: string }) =>
  admin<unknown>(ref, `/webhooks/${encodeURIComponent(id)}.json`, { method: 'POST', body: JSON.stringify({ url: body.url, secretId: body.secretId }) });
export const deleteWebhook = (ref: SiteRef, id: string) =>
  admin<void>(ref, `/webhooks/${encodeURIComponent(id)}.json`, { method: 'DELETE' });

export type LogProbe = (ref: SiteRef, key: string) => Promise<ResLike>;
let prober: LogProbe | null = null;
/** When set (side panel), the log probe goes through the background relay instead of a direct fetch. */
export const setLogProbe = (p: LogProbe | null) => { prober = p; };

/**
 * Probe an API key against the log endpoint (x-auth-token). The key is used for this call only:
 * never stored or logged. Resolves with the parsed JSON (200) or throws AdminApiError.
 */
export async function probeLog(ref: SiteRef, key: string): Promise<unknown> {
  const { org, site } = ref;
  if (prober) {
    const res = await prober(ref, key);
    if (!res.ok) throw new AdminApiError(res.status, friendly(res.status) ?? `Request failed (${res.status} ${res.statusText})`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }
  return request<unknown>(
    `${LOG_HOST}/${encodeURIComponent(org)}/sites/${encodeURIComponent(site)}/log?since=15m`,
    {},
    { 'x-auth-token': key },
  );
}

import { decideAccess, hasAdminOnlyFields, identityFromProfile, rolesFor, type Identity } from '../lib/access';
export type AccessState = 'admin' | 'no-admin' | 'not-found' | 'no-auth' | 'error';
export interface AccessResult { state: AccessState; detail: string; /** Content permissions from the status endpoint (e.g. 'preview:write'), when the site is visible but config is denied. */ permissions?: string[]; /** Roles of the signed-in user on this site, when determinable from the config role lists. */ roles?: string[]; /** True when admin could not be confirmed (apiKeys probe 404, no role match). */ inconclusive?: boolean }

/** Pure mapping of a failed request to an access state. 401/403/404 on config calls = config denied (resolved further by checkAccess). */
export function accessFromError(e: unknown): AccessResult {
  if (e instanceof AdminApiError) {
    if (e.noAuth) return { state: 'no-auth', detail: e.message };
    if (e.status === 401 || e.status === 403 || e.status === 404) return { state: 'no-admin', detail: String(e.status) };
    return { state: 'error', detail: e.message };
  }
  return { state: 'error', detail: e instanceof Error ? e.message : 'Unexpected error' };
}

/** Status probe: does the site exist for this user (any role)? Also returns the caller's content permissions. */
async function probeStatus(ref: SiteRef): Promise<{ exists: 'yes' | 'no' | 'unknown'; permissions?: string[] }> {
  const url = `${ADMIN_HOST}/status/${encodeURIComponent(ref.org)}/${encodeURIComponent(ref.site)}/main/`;
  try {
    const res = transport ? await transport(url, {}) : await fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } });
    if (res.status === 404) return { exists: 'no' };
    if (!res.ok) return { exists: 'unknown' };
    let j: { live?: { permissions?: unknown }; preview?: { permissions?: unknown }; code?: { permissions?: unknown } } = {};
    try { j = JSON.parse(await res.text()); } catch { /* no body */ }
    const perms = new Set<string>();
    for (const part of [j.preview, j.live, j.code]) if (Array.isArray(part?.permissions)) part.permissions.forEach((x) => typeof x === 'string' && perms.add(x));
    return { exists: 'yes', permissions: perms.size ? [...perms].sort() : undefined };
  } catch { return { exists: 'unknown' }; }
}

/** GET an admin-host path without throwing on HTTP errors (transport/network failures resolve null). */
async function rawGet(path: string): Promise<{ status: number; json: unknown } | null> {
  try {
    const url = `${ADMIN_HOST}${path}`;
    const res = transport ? await transport(url, {}) : await fetch(url, { headers: { Authorization: `Bearer ${token ?? ''}` } });
    let json: unknown;
    if (res.ok) { try { const t = await res.text(); json = t ? JSON.parse(t) : undefined; } catch { /* no body */ } }
    return { status: res.status, json };
  } catch { return null; }
}

/** Current user's identity from GET /profile (accepts `{profile:{email}}` or a bare profile). Null when unavailable. */
async function fetchIdentity(): Promise<Identity | null> {
  const r = await rawGet('/profile');
  if (!r || r.status !== 200) return null;
  return identityFromProfile(r.json);
}

/**
 * Upfront access check. Precedence (see decideAccess in lib/access.ts):
 * 1 no token => no-auth; 2 config 401/403/404 => no-admin (status probe distinguishes not-found);
 * 3 config 200 with secrets/apiKeys/webhooks fields (admin-only view) => admin;
 * 4 role lists in access.admin.role matched against /profile identity: admin => admin, other roles => no-admin listing them;
 * 5 roles undeterminable => apiKeys.json probe: 200 => admin, 401/403 => no-admin, 404 => inconclusive => no-admin ("Could not confirm admin access").
 */
export async function checkAccess(ref: SiteRef): Promise<AccessResult> {
  if (!ref.org || !ref.site) return { state: 'error', detail: 'Enter an org and site.' };
  let config: unknown;
  try {
    config = await admin<unknown>(ref, '.json');
  } catch (e) {
    const denied = accessFromError(e);
    if (denied.state !== 'no-admin') return denied;
    // A token WAS sent (no-auth is only reported when none could be obtained), so 401/403/404 = role lacks config access.
    const st = await probeStatus(ref);
    if (st.exists === 'no') return { state: 'not-found', detail: `No config for ${ref.org}/${ref.site}.` };
    return { ...denied, permissions: st.permissions };
  }
  const identity = await fetchIdentity();
  let keysStatus: number | undefined;
  if (!hasAdminOnlyFields(config) && !(identity && rolesFor(config, identity).includes('admin'))) {
    // Only needed when neither fields nor the role list prove admin.
    if (rolesFor(config, identity).length === 0) {
      try { await admin<unknown>(ref, '/apiKeys.json'); keysStatus = 200; } catch (e) {
        if (e instanceof AdminApiError && [401, 403, 404].includes(e.status)) keysStatus = e.status; else return accessFromError(e);
      }
    }
  }
  return decideAccess({ config, identity, keysStatus });
}

export const ACCESS_DOCS_URL = 'https://www.aem.live/docs/roles-permissions';
