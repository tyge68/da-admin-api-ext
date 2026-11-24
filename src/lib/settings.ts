import { validateHttpsUrl } from './mutations';

/** User settings, stored in chrome.storage.sync under SETTINGS_KEY. No secrets, ever. */
export interface Settings { webhookUrl?: string }

export const SETTINGS_KEY = 'settings';
export const URL_MAX = 2048;

/** Null when valid; empty is invalid (use clear to unset). */
export function validateEndpointUrl(v: string): string | null {
  const t = v.trim();
  if (!t) return 'Enter the webhook endpoint URL';
  if (t.length > URL_MAX) return 'URL is too long';
  return validateHttpsUrl(t);
}

/** Defensive parse of whatever storage returned. Invalid URLs are dropped. */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const u = (raw as Record<string, unknown>).webhookUrl;
  return typeof u === 'string' && validateEndpointUrl(u) === null ? { webhookUrl: u.trim() } : {};
}

export interface SettingsStore {
  load(): Promise<Settings>;
  save(s: Settings): Promise<void>;
}

export function createMemorySettingsStore(initial?: unknown): SettingsStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = initial === undefined ? {} : { [SETTINGS_KEY]: initial };
  return {
    data,
    load: async () => parseSettings(data[SETTINGS_KEY]),
    save: async (s) => { data[SETTINGS_KEY] = JSON.parse(JSON.stringify(s)); },
  };
}

export interface SyncArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export function createChromeSettingsStore(area: SyncArea = chrome.storage.sync as unknown as SyncArea): SettingsStore {
  return {
    load: async () => parseSettings((await area.get(SETTINGS_KEY))[SETTINGS_KEY]),
    save: async (s) => {
      if (!s.webhookUrl) await area.remove(SETTINGS_KEY);
      else await area.set({ [SETTINGS_KEY]: { webhookUrl: s.webhookUrl.trim() } });
    },
  };
}

/** Validate then persist; returns an error message or null. */
export async function saveWebhookUrl(store: SettingsStore, url: string): Promise<string | null> {
  const err = validateEndpointUrl(url);
  if (err) return err;
  await store.save({ webhookUrl: url.trim() });
  return null;
}
