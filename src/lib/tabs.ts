import { parseHash, type OrgSite } from './hash';

export interface TabLike { id?: number; url?: string; active?: boolean; windowId?: number }

export const isDaLive = (url?: string): boolean => {
  try { return new URL(url ?? '').origin === 'https://da.live'; } catch { return false; }
};

/** Org/site from a da.live tab URL; null when the URL is not da.live. */
export function orgSiteFromUrl(url?: string): OrgSite | null {
  if (!isDaLive(url)) return null;
  return parseHash(new URL(url as string).hash);
}

/** Order da.live tabs: active tab of the focused window first, then other active tabs, then the rest. */
export function orderDaTabs(tabs: TabLike[], focusedWindowId?: number): TabLike[] {
  const score = (t: TabLike) => (t.active ? (t.windowId === focusedWindowId ? 2 : 1) : 0);
  return tabs.filter((t) => t.id != null && isDaLive(t.url)).sort((a, b) => score(b) - score(a));
}
