import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as c from './adminClient';

const ref = { org: 'o', site: 's' };
const ok = (body: unknown = {}) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) });
const fail = (status: number) => ({ ok: false, status, statusText: 'x', text: async () => '' });
let f: ReturnType<typeof vi.fn>;

beforeEach(() => {
  f = vi.fn();
  vi.stubGlobal('fetch', f);
  c.setToken('tok');
});

describe('adminClient', () => {
  it('listApiKeys sends bearer to correct URL', async () => {
    f.mockResolvedValue(ok({ a: 1 }));
    expect(await c.listApiKeys(ref)).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://admin.hlx.page/config/o/sites/s/apiKeys.json');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
  it('createApiKey POSTs description and roles', async () => {
    f.mockResolvedValue(ok());
    await c.createApiKey(ref, 'd', ['publish']);
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ description: 'd', roles: ['publish'] });
  });
  it('listWebhooks uses base .json', async () => {
    f.mockResolvedValue(ok());
    await c.listWebhooks(ref);
    expect(f.mock.calls[0][0]).toBe('https://admin.hlx.page/config/o/sites/s.json');
  });
  it('addWebhook posts url and secretId to webhooks.json', async () => {
    f.mockResolvedValue(ok());
    await c.addWebhook(ref, 'sid', 'https://x');
    expect(f.mock.calls[0][0]).toMatch(/webhooks\.json$/);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ url: 'https://x', secretId: 'sid' });
  });
  it.each([[401, /401/], [403, /403/], [404, /404/]])('maps %i to friendly error', async (s, re) => {
    f.mockResolvedValue(fail(s));
    await expect(c.getSiteConfig(ref)).rejects.toThrow(re);
  });
  it('rejects without token and does not call fetch', async () => {
    c.setToken(null);
    await expect(c.listApiKeys(ref)).rejects.toThrow(/401/);
    expect(f).not.toHaveBeenCalled();
  });
  it('probeLog uses x-auth-token', async () => {
    f.mockResolvedValue(ok());
    await c.probeLog(ref, 'k');
    expect(f.mock.calls[0][0]).toBe('https://api.aem.live/o/sites/s/log?since=15m');
    expect(f.mock.calls[0][1].headers['x-auth-token']).toBe('k');
  });
});

describe('mutations', () => {
  it('createSecret with and without value', async () => {
    f.mockResolvedValue(ok());
    await c.createSecret(ref, 'v');
    await c.createSecret(ref);
    expect(f.mock.calls[0][0]).toBe('https://admin.hlx.page/config/o/sites/s/secrets.json');
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ value: 'v' });
    expect(f.mock.calls[1][1].body).toBe('{}');
  });
  it.each([
    ['deleteApiKey', 'apiKeys'], ['deleteSecret', 'secrets'], ['deleteWebhook', 'webhooks'],
  ] as const)('%s sends DELETE to item url with encoded id', async (fn, seg) => {
    f.mockResolvedValue({ ok: true, status: 204, statusText: 'No Content', text: async () => '' });
    await expect(c[fn](ref, 'a/b+c')).resolves.toBeUndefined();
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://admin.hlx.page/config/o/sites/s/${seg}/a%2Fb%2Bc.json`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
  it('updateSecret POSTs {value} to the encoded item url', async () => {
    f.mockResolvedValue(ok());
    await c.updateSecret(ref, 'a/b', 'NEWVAL');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://admin.hlx.page/config/o/sites/s/secrets/a%2Fb.json');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ value: 'NEWVAL' });
  });
  it('updateWebhook POSTs {url, secretId} to the item url', async () => {
    f.mockResolvedValue(ok());
    await c.updateWebhook(ref, 'w1', { secretId: 'S2', url: 'https://x.io/h' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://admin.hlx.page/config/o/sites/s/webhooks/w1.json');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://x.io/h', secretId: 'S2' });
  });
});

describe('checkAccess', () => {
  const resp = (status: number) => ({ ok: status < 300, status, statusText: 'x', text: async () => '{}' });
  // sequences of responses: .json, then (config 200) /profile + apiKeys.json, or (config denied) status. Body '{}' = no admin fields/roles.
  it.each([
    [[200, 404, 200], 'admin'], [[200, 404, 404], 'no-admin'],
    [[200, 404, 403], 'no-admin'], [[403, 200], 'no-admin'], [[404, 200], 'no-admin'], [[401, 200], 'no-admin'],
    [[404, 404], 'not-found'], [[403, 404], 'not-found'], [[403, 401], 'no-admin'], [[500], 'error'],
  ] as [number[], string][])('statuses %j -> %s', async (seq, state) => {
    seq.forEach((s) => f.mockResolvedValueOnce(resp(s)));
    expect((await c.checkAccess(ref)).state).toBe(state);
  });
  it('401/403/404 all give the same no-admin state with status in detail', async () => {
    for (const s of [401, 403, 404]) {
      f.mockResolvedValueOnce(resp(s)).mockResolvedValueOnce(resp(200));
      expect(await c.checkAccess(ref)).toEqual({ state: 'no-admin', detail: String(s) });
    }
  });
  it('exposes content permissions from the status probe', async () => {
    f.mockResolvedValueOnce(resp(404));
    f.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ preview: { permissions: ['preview:write', 'preview:read'] }, live: { permissions: ['live:read'] } }) });
    expect(await c.checkAccess(ref)).toEqual({ state: 'no-admin', detail: '404', permissions: ['live:read', 'preview:read', 'preview:write'] });
  });
  it('maps relay no-auth and network errors', () => {
    expect(c.accessFromError(new c.AdminApiError(0, 'no tab', true)).state).toBe('no-auth');
    expect(c.accessFromError(new c.AdminApiError(0, 'net')).state).toBe('error');
    expect(c.accessFromError(new Error('x')).state).toBe('error');
  });
  it('needs org and site; listApiKeys 404 means empty', async () => {
    expect((await c.checkAccess({ org: '', site: 's' })).state).toBe('error');
    f.mockResolvedValue(resp(404));
    expect(await c.listApiKeys(ref)).toEqual({});
  });
});
