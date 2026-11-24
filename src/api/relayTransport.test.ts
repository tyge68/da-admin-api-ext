import { describe, it, expect } from 'vitest';
import { makeRelayTransport } from './relayTransport';

describe('relay transport', () => {
  it('sends path relative to admin host and returns json text', async () => {
    let sent: any;
    const t = makeRelayTransport(async (m) => { sent = m; return { ok: true, status: 200, statusText: 'OK', json: { a: 1 } }; });
    const r = await t('https://admin.hlx.page/config/o/sites/s/apiKeys.json', {});
    expect(sent).toEqual({ type: 'ADMIN_FETCH', method: 'GET', path: '/config/o/sites/s/apiKeys.json', body: undefined });
    expect(JSON.parse(await r.text())).toEqual({ a: 1 });
  });
  it.each([['no-tab', /No da\.live tab/], ['expired', /reload da\.live/i]] as const)('maps %s', async (error, re) => {
    const t = makeRelayTransport(async () => ({ ok: false, error }));
    await expect(t('https://admin.hlx.page/config/x', {})).rejects.toThrow(re);
  });
});
