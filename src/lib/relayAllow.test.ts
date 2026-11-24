import { describe, it, expect, vi } from 'vitest';
import { adminFetch, isAllowedRequest } from './relay';

const b = '/config/o/sites/s';
const tok = async () => ({ token: 'T', expiresAt: 1 });

describe('relay allow-list', () => {
  it.each([
    ['GET', `${b}.json`], ['GET', `${b}/apiKeys.json`], [undefined, `${b}/apiKeys.json`],
    ['POST', `${b}/apiKeys.json`], ['POST', `${b}/secrets.json`], ['POST', `${b}/webhooks.json`],
    ['DELETE', `${b}/apiKeys/abc_-123.json`], ['DELETE', `${b}/secrets/abc.json`], ['DELETE', `${b}/webhooks/abc.json`],
    ['delete', `${b}/webhooks/abc.json`],
    ['POST', `${b}/secrets/abc_-1%3D.json`], ['POST', `${b}/webhooks/abc.json`],
  ])('allows %s %s', (m, p) => expect(isAllowedRequest(m, p)).toBe(true));

  it.each([
    ['PUT', `${b}/apiKeys.json`], ['PATCH', `${b}/secrets.json`], ['HEAD', `${b}.json`],
    ['POST', `${b}.json`], ['POST', `${b}/apiKeys/abc.json`], ['PUT', `${b}/secrets/abc.json`], ['PUT', `${b}/webhooks/abc.json`],
    ['PATCH', `${b}/webhooks/abc.json`], ['POST', `${b}/secrets/a/b.json`], ['POST', `${b}/secrets/../x.json`],
    ['POST', `${b}/webhooks/abc.json?x=1`], ['POST', '/config/o/secrets/abc.json'], ['POST', `${b}/other/abc.json`], ['DELETE', `${b}/apiKeys.json`],
    ['DELETE', `${b}.json`], ['POST', `${b}/other.json`], ['DELETE', `${b}/other/abc.json`],
    ['DELETE', `${b}/apiKeys/../x.json`], ['DELETE', `${b}/apiKeys/a/b.json`], ['POST', `${b}/apiKeys.json?x=1`],
    ['POST', '/config/o/apiKeys.json'], ['GET', '/live/o/s/main/x'], ['POST', '/evil'], ['DELETE', `${b}/apiKeys/a\\b.json`],
  ])('rejects %s %s', (m, p) => expect(isAllowedRequest(m, p)).toBe(false));

  it('adminFetch does not fetch for disallowed method', async () => {
    const f = vi.fn();
    const r = await adminFetch({ method: 'PUT', path: `${b}/apiKeys.json` }, { getToken: tok, fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('adminFetch forwards DELETE with bearer', async () => {
    const f = vi.fn().mockResolvedValue({ status: 204, statusText: 'No Content', text: async () => '' });
    await adminFetch({ method: 'DELETE', path: `${b}/secrets/x.json` }, { getToken: tok, fetchImpl: f });
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer T' } });
  });
});

import { probeLogFetch, probeLogUrl } from './relay';
describe('probeLog allow-list', () => {
  const ok = { type: 'PROBE_LOG', org: 'o', site: 's', key: 'abcdefgh12345' } as const;
  it('builds only the fixed log URL', () => expect(probeLogUrl(ok)).toBe('https://api.aem.live/o/sites/s/log?since=15m'));
  it.each([
    { ...ok, org: '../x' }, { ...ok, site: 'a/b' }, { ...ok, org: 'a?b=1' }, { ...ok, site: '' }, { ...ok, key: 'short' },
    { ...ok, key: 'abc def ghijk' }, { ...ok, key: 'abc\r\nx-evil: 1' }, { ...ok, type: 'ADMIN_FETCH' }, { ...ok, org: 5 },
  ])('rejects %j', (r) => expect(probeLogUrl(r as never)).toBeNull());
  it('does not fetch when rejected', async () => {
    const f = vi.fn();
    const r = await probeLogFetch({ ...ok, org: '..' } as never, f as never);
    expect(r.ok).toBe(false); expect(f).not.toHaveBeenCalled();
  });
  it('GETs api.aem.live with x-auth-token only and never echoes the key', async () => {
    const f = vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', text: async () => '{"entries":[1]}' });
    const r = await probeLogFetch(ok as never, f as never);
    expect(f.mock.calls[0][0]).toBe('https://api.aem.live/o/sites/s/log?since=15m');
    expect(f.mock.calls[0][1]).toEqual({ method: 'GET', headers: { 'x-auth-token': 'abcdefgh12345' } });
    expect(r).toMatchObject({ ok: true, status: 200 });
    const g = vi.fn().mockRejectedValue(new Error('failed abcdefgh12345'));
    expect(JSON.stringify(await probeLogFetch(ok as never, g as never))).not.toContain('abcdefgh12345');
  });
  it('adminFetch refuses PROBE-style paths on admin host', () => expect(isAllowedRequest('GET', '/o/sites/s/log')).toBe(false));
  it('allows only GET on the status probe path', () => {
    expect(isAllowedRequest('GET', '/status/o/s/main/')).toBe(true);
    expect(isAllowedRequest('POST', '/status/o/s/main/')).toBe(false);
    expect(isAllowedRequest('GET', '/status/o/s/main/x')).toBe(false);
    expect(isAllowedRequest('GET', '/status/../s/main/')).toBe(false);
  });
});
