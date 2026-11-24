export const IMS_KEY_PREFIX = 'adobeid_ims_access_token/darkalley/false/';
export const EXPIRY_SKEW_MS = 60_000;

export type TokenResult = { token: string; expiresAt: number } | { error: 'no-token' | 'expired' };

interface StorageLike { length: number; key(i: number): string | null; getItem(k: string): string | null }

/**
 * Injected into da.live tabs via chrome.scripting.executeScript({func}).
 * MUST be self-contained (serialized by toString; no outer references), so the
 * logic is intentionally duplicated from readImsToken; a test asserts they agree.
 */
export function injectedReadToken(): TokenResult {
  const PREFIX = 'adobeid_ims_access_token/darkalley/false/';
  let sawExpired = false;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    try {
      const rec = JSON.parse(localStorage.getItem(k) ?? 'null');
      const token = rec?.tokenValue;
      const expiresAt = Date.parse(rec?.expire);
      if (typeof token !== 'string' || !token || Number.isNaN(expiresAt)) continue;
      if (expiresAt - Date.now() < 60_000) { sawExpired = true; continue; }
      return { token, expiresAt };
    } catch { /* malformed record */ }
  }
  return { error: sawExpired ? 'expired' : 'no-token' };
}

/** Scan storage for the IMS access token record. Never logs the token. */
export function readImsToken(storage: StorageLike, now = Date.now()): TokenResult {
  let sawExpired = false;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !k.startsWith(IMS_KEY_PREFIX)) continue;
    try {
      const rec = JSON.parse(storage.getItem(k) ?? 'null');
      const token = rec?.tokenValue;
      const expiresAt = Date.parse(rec?.expire);
      if (typeof token !== 'string' || !token || Number.isNaN(expiresAt)) continue;
      if (expiresAt - now < EXPIRY_SKEW_MS) { sawExpired = true; continue; }
      return { token, expiresAt };
    } catch { /* malformed record */ }
  }
  return { error: sawExpired ? 'expired' : 'no-token' };
}
