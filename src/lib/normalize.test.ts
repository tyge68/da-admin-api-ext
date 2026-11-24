import { describe, it, expect } from 'vitest';
import { normalizeApiKeys, normalizeSecrets, normalizeWebhooks, expiryState, DAY_MS } from './normalize';

describe('normalize', () => {
  it('api keys from id-keyed object', () => {
    const r = normalizeApiKeys({ k1: { description: 'd', roles: ['publish'], expiration: '2030-01-01T00:00:00Z' }, k2: {} });
    expect(r[0]).toMatchObject({ id: 'k1', description: 'd', roles: ['publish'] });
    expect(r[0].expiresAt).toBe(Date.parse('2030-01-01T00:00:00Z'));
    expect(r[1]).toMatchObject({ id: 'k2', roles: [], expiresAt: null });
  });
  it('api keys from array / wrapper / garbage', () => {
    expect(normalizeApiKeys([{ id: 'a' }])[0].id).toBe('a');
    expect(normalizeApiKeys({ keys: { z: {} } })[0].id).toBe('z');
    expect(normalizeApiKeys(null)).toEqual([]);
    expect(normalizeApiKeys('x')).toEqual([]);
  });
  it('secrets: ids only', () => {
    expect(normalizeSecrets({ s1: { value: 'hidden' }, s2: {} })).toMatchObject([{ id: 's1' }, { id: 's2' }]);
    expect(normalizeSecrets({ secrets: ['a', 'b'] })).toMatchObject([{ id: 'a' }, { id: 'b' }]);
    expect(Object.keys(normalizeSecrets({ s1: { value: 'v' } })[0])).toEqual(['id', 'type', 'created', 'lastModified']);
  });
  it('webhooks from site config', () => {
    expect(normalizeWebhooks({ webhooks: { w1: { url: 'https://x', secretId: 's' } } })).toEqual([{ id: 'w1', url: 'https://x', secretId: 's' }]);
    expect(normalizeWebhooks({ webhooks: [{ id: 'w', url: 'u' }] })).toEqual([{ id: 'w', url: 'u', secretId: '' }]);
    expect(normalizeWebhooks({})).toEqual([]);
  });
  it('real Admin API shapes', () => {
    const keys = normalizeApiKeys({ K1: { description: 'd', roles: ['admin'], id: 'I1', subject: 'u@x', expiration: '2030-01-01T00:00:00.000Z', created: '2025-01-01T00:00:00.000Z' } });
    expect(keys[0]).toMatchObject({ id: 'I1', roles: ['admin'], subject: 'u@x', created: '2025-01-01T00:00:00.000Z' });
    const cfg = { secrets: [{ id: 'S1', type: 'hashed', created: 'c', lastModified: 'm' }], webhooks: [{ id: 'W1', secretId: 'S1', url: 'https://h/webhook' }] };
    expect(normalizeSecrets(cfg.secrets)).toEqual([{ id: 'S1', type: 'hashed', created: 'c', lastModified: 'm' }]);
    expect(normalizeWebhooks(cfg)).toEqual([{ id: 'W1', url: 'https://h/webhook', secretId: 'S1' }]);
  });
  it('expiryState', () => {
    const now = 1_000_000_000_000;
    expect(expiryState(null, now)).toBe('none');
    expect(expiryState(now - 1, now)).toBe('expired');
    expect(expiryState(now + 29 * DAY_MS, now)).toBe('soon');
    expect(expiryState(now + 31 * DAY_MS, now)).toBe('ok');
  });
});

describe('site config without webhooks/secrets', () => {
  const cfg = { version: 1, content: {}, code: {}, access: {}, created: '2026-07-22T19:56:06.924Z', lastModified: '2026-11-05T15:36:37.430Z' };
  it('returns no webhooks', () => { expect(normalizeWebhooks(cfg)).toEqual([]); });
  it('returns no secrets', () => { expect(normalizeSecrets(cfg)).toEqual([]); });
});
