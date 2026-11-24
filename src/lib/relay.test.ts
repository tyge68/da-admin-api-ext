import { describe, it, expect, vi } from 'vitest';
import { adminFetch } from './relay';

const res = (status: number, body: unknown = {}) => ({ status, statusText: 's', text: async () => JSON.stringify(body) }) as unknown as Response;

describe('adminFetch relay', () => {
  it('no tab', async () => {
    expect(await adminFetch({ path: '/config/a' }, { getToken: async () => null, fetchImpl: vi.fn() })).toEqual({ ok: false, error: 'no-tab' });
  });
  it('expired -> no fetch', async () => {
    const f = vi.fn();
    expect(await adminFetch({ path: '/config/a' }, { getToken: async () => ({ error: 'expired' }), fetchImpl: f })).toEqual({ ok: false, error: 'expired' });
    expect(f).not.toHaveBeenCalled();
  });
  it('adds bearer and returns json', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { x: 1 }));
    const r = await adminFetch({ path: '/config/a.json' }, { getToken: async () => ({ token: 'T', expiresAt: 1 }), fetchImpl: f });
    expect(r).toMatchObject({ ok: true, status: 200, json: { x: 1 } });
    expect(f.mock.calls[0][0]).toBe('https://admin.hlx.page/config/a.json');
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer T');
  });
  it('retries once on 401 with re-read token', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const gt = vi.fn().mockResolvedValueOnce({ token: 'old', expiresAt: 1 }).mockResolvedValueOnce({ token: 'new', expiresAt: 1 });
    const r = await adminFetch({ path: '/config/a' }, { getToken: gt, fetchImpl: f });
    expect(r).toMatchObject({ status: 200 });
    expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });
  it('rejects non-config paths', async () => {
    const f = vi.fn();
    const r = await adminFetch({ path: '/evil' }, { getToken: async () => ({ token: 'T', expiresAt: 1 }), fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
