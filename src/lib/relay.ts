import { ADMIN_HOST, LOG_HOST } from '../api/adminClient';
import type { AdminFetchReq, AdminFetchRes, ProbeLogReq } from './messages';
import type { TokenResult } from './ims';

export interface RelayDeps {
  /** Ask da.live tab(s) for a fresh token. Resolves null when no tab could answer. */
  getToken: () => Promise<TokenResult | null>;
  fetchImpl: typeof fetch;
}

const STATUS_PATH = /^\/status\/[A-Za-z0-9_.~-]+\/[A-Za-z0-9_.~-]+\/main\/$/; // read-only site existence probe
const SEG = '[\\w.%~-]+';
const PREFIX = `^/config/${SEG}/sites/${SEG}`;
const MUTATE_COLLECTION = new RegExp(`${PREFIX}/(?:apiKeys|secrets|webhooks)\\.json$`);
const MUTATE_ITEM = new RegExp(`${PREFIX}/(?:apiKeys|secrets|webhooks)/${SEG}\\.json$`);

// Item-level update (POST) is allowed ONLY for secrets and webhooks (verified against the real API 2026-11-24, see adminClient.updateSecret/updateWebhook).
const UPDATE_ITEM = new RegExp(`${PREFIX}/(?:secrets|webhooks)/${SEG}\\.json$`);

/** GET: any /config/ path. POST: collection endpoints, plus secrets/webhooks item endpoints (update). DELETE: item endpoints only. Nothing else. */
export function isAllowedRequest(method: string | undefined, path: string): boolean {
  if (path.includes('..')) return false;
  if (path === '/profile') return (method ?? 'GET').toUpperCase() === 'GET'; // read-only identity lookup
  if (STATUS_PATH.test(path)) return (method ?? 'GET').toUpperCase() === 'GET';
  if (!path.startsWith('/config/') || /[?#\\\s]/.test(path)) return false;
  switch ((method ?? 'GET').toUpperCase()) {
    case 'GET': return true;
    case 'POST': return MUTATE_COLLECTION.test(path) || UPDATE_ITEM.test(path);
    case 'DELETE': return MUTATE_ITEM.test(path);
    default: return false;
  }
}

/** Perform an admin fetch with a Bearer token; retries once on 401 with a re-read token. */
export async function adminFetch(req: AdminFetchReq, d: RelayDeps): Promise<AdminFetchRes> {
  if (!isAllowedRequest(req.method, req.path)) return { ok: false, error: 'network', message: 'Request not allowed' };
  const attempt = async (): Promise<AdminFetchRes> => {
    const t = await d.getToken();
    if (!t) return { ok: false, error: 'no-tab' };
    if ('error' in t) return { ok: false, error: t.error };
    try {
      const res = await d.fetchImpl(`${ADMIN_HOST}${req.path}`, {
        method: (req.method ?? 'GET').toUpperCase(),
        headers: { Authorization: `Bearer ${t.token}`, ...(req.body ? { 'content-type': 'application/json' } : {}) },
        body: req.body,
      });
      const text = await res.text();
      let json: unknown;
      try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
      return { ok: true, status: res.status, statusText: res.statusText, json };
    } catch (e) {
      return { ok: false, error: 'network', message: e instanceof Error ? e.message : 'fetch failed' };
    }
  };
  const first = await attempt();
  if (first.ok && first.status === 401) return attempt();
  return first;
}

const SEG_STRICT = /^[\w.~-]{1,128}$/;
const KEY_RE = /^[\w.~+/=-]{8,2048}$/;

/** Validate a probeLog request; returns the fixed target URL or null. Only GET .../log?since=15m on api.aem.live. */
export function probeLogUrl(req: ProbeLogReq): string | null {
  if (req?.type !== 'PROBE_LOG') return null;
  if (typeof req.org !== 'string' || typeof req.site !== 'string' || typeof req.key !== 'string') return null;
  if (!SEG_STRICT.test(req.org) || !SEG_STRICT.test(req.site) || req.org === '..' || req.site === '..' || !KEY_RE.test(req.key)) return null;
  return `${LOG_HOST}/${encodeURIComponent(req.org)}/sites/${encodeURIComponent(req.site)}/log?since=15m`;
}

/**
 * Narrow log probe: GET only, fixed host/path, key sent solely in x-auth-token. The key is never
 * stored or logged, and is not echoed back in any response/error.
 */
export async function probeLogFetch(req: ProbeLogReq, fetchImpl: typeof fetch): Promise<AdminFetchRes> {
  const url = probeLogUrl(req);
  if (!url) return { ok: false, error: 'network', message: 'Request not allowed' };
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { 'x-auth-token': req.key } });
    const text = await res.text();
    let json: unknown;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { ok: true, status: res.status, statusText: res.statusText, json };
  } catch (e) {
    return { ok: false, error: 'network', message: e instanceof Error ? e.message.split(req.key).join('***') : 'fetch failed' };
  }
}
