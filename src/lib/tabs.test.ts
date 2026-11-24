import { describe, it, expect } from 'vitest';
import { orderDaTabs, orgSiteFromUrl } from './tabs';
import { readImsToken, injectedReadToken } from './ims';

describe('orgSiteFromUrl', () => {
  it('parses da.live hash', () =>
    expect(orgSiteFromUrl('https://da.live/#/tyge68/experience-workspace-demo')).toEqual({ org: 'tyge68', site: 'experience-workspace-demo' }));
  it('null for other hosts', () => {
    expect(orgSiteFromUrl('https://example.com/#/a/b')).toBeNull();
    expect(orgSiteFromUrl('https://da.live.evil.com/#/a/b')).toBeNull();
    expect(orgSiteFromUrl(undefined)).toBeNull();
  });
});

describe('orderDaTabs', () => {
  const t = [
    { id: 1, url: 'https://da.live/#/a/b', active: false, windowId: 1 },
    { id: 2, url: 'https://da.live/#/c/d', active: true, windowId: 2 },
    { id: 3, url: 'https://da.live/#/e/f', active: true, windowId: 1 },
    { id: 4, url: 'https://other.com/', active: true, windowId: 1 },
  ];
  it('prefers active tab of focused window', () => expect(orderDaTabs(t, 1).map((x) => x.id)).toEqual([3, 2, 1]));
  it('falls back to any da.live tab', () => expect(orderDaTabs([t[0]], 9).map((x) => x.id)).toEqual([1]));
  it('empty when none', () => expect(orderDaTabs([t[3]], 1)).toEqual([]));
});

describe('injectedReadToken', () => {
  const mk = (rec: unknown) => {
    const data: Record<string, string> = { 'adobeid_ims_access_token/darkalley/false/x': JSON.stringify(rec) };
    return { length: 1, key: (i: number) => Object.keys(data)[i] ?? null, getItem: (k: string) => data[k] ?? null };
  };
  it('agrees with readImsToken (valid, expired, missing)', () => {
    const cases = [
      { tokenValue: 'T', expire: new Date(Date.now() + 3600e3).toISOString() },
      { tokenValue: 'T', expire: new Date(Date.now() - 3600e3).toISOString() },
      { nope: 1 },
    ];
    for (const c of cases) {
      const ls = mk(c);
      (globalThis as unknown as { localStorage: unknown }).localStorage = ls;
      expect(injectedReadToken()).toEqual(readImsToken(ls));
    }
  });
  it('is self-contained', () => {
    const ls = mk({ tokenValue: 'T', expire: new Date(Date.now() + 3600e3).toISOString() });
    const iso = new Function('localStorage', `return (${injectedReadToken.toString()})()`);
    expect(iso(ls)).toMatchObject({ token: 'T' });
  });
});
