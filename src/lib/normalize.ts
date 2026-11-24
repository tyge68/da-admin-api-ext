export const DAY_MS = 86_400_000;
export const EXPIRY_WARN_DAYS = 30;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export interface ApiKeyRow { id: string; description: string; roles: string[]; expiration: string; expiresAt: number | null; subject: string; created: string }
export interface SecretRow { id: string; type: string; created: string; lastModified: string }
export interface WebhookRow { id: string; url: string; secretId: string }

/** Turn `{id: {...}}`, `[{id,...}]`, `[ids]` or `{ items/keys: ... }` into [id, value] entries. */
function entries(raw: unknown, wrappers: string[]): [string, unknown][] {
  if (Array.isArray(raw)) {
    return raw.map((v, i) => [isObj(v) ? str(v.id ?? v.name ?? i) : str(v), v]);
  }
  if (isObj(raw)) {
    for (const w of wrappers) if (w in raw && (isObj(raw[w]) || Array.isArray(raw[w]))) return entries(raw[w], []);
    return Object.entries(raw);
  }
  return [];
}

export function parseExpiration(v: unknown): number | null {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(str(v));
  return Number.isNaN(t) ? null : t;
}

export function normalizeApiKeys(raw: unknown): ApiKeyRow[] {
  return entries(raw, ['apiKeys', 'keys', 'items']).map(([id, v]) => {
    const o = isObj(v) ? v : {};
    const exp = o.expiration ?? o.expires ?? o.expiry;
    return {
      id: str(o.id ?? id),
      description: str(o.description),
      roles: Array.isArray(o.roles) ? o.roles.map(str) : typeof o.roles === 'string' ? [o.roles] : [],
      expiration: str(exp),
      expiresAt: parseExpiration(exp),
      subject: str(o.subject),
      created: str(o.created),
    };
  });
}

export function normalizeSecrets(raw: unknown): SecretRow[] {
  // A site config without a `secrets` key means "no secrets", not "the config is the list".
  const src = isObj(raw) && 'access' in raw ? raw.secrets : isObj(raw) && 'secrets' in raw ? raw.secrets : raw;
  return entries(src, ['secrets', 'items']).map(([id, v]) => ({ id: str(isObj(v) && v.id ? v.id : id), type: str(isObj(v) ? v.type : ''), created: str(isObj(v) ? v.created : ''), lastModified: str(isObj(v) ? v.lastModified : '') }));
}

export function normalizeWebhooks(siteConfig: unknown): WebhookRow[] {
  // A site config without a `webhooks` key means "no webhooks", not "the config is the list".
  const src = isObj(siteConfig) && ('webhooks' in siteConfig || 'version' in siteConfig || 'access' in siteConfig || 'content' in siteConfig) ? siteConfig.webhooks : siteConfig;
  return entries(src, ['webhooks', 'items']).map(([id, v]) => {
    const o = isObj(v) ? v : {};
    return { id: str(o.id ?? id), url: str(o.url ?? (typeof v === 'string' ? v : '')), secretId: str(o.secretId ?? o.secret) };
  });
}

export type ExpiryState = 'none' | 'ok' | 'soon' | 'expired';
export function expiryState(expiresAt: number | null, now = Date.now()): ExpiryState {
  if (expiresAt == null) return 'none';
  if (expiresAt <= now) return 'expired';
  return expiresAt - now <= EXPIRY_WARN_DAYS * DAY_MS ? 'soon' : 'ok';
}
