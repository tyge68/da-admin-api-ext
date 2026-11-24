import { describe, it, expect } from 'vitest';
import { readImsToken, IMS_KEY_PREFIX } from './ims';

const mk = (o: Record<string, string>) => {
  const k = Object.keys(o);
  return { length: k.length, key: (i: number) => k[i] ?? null, getItem: (x: string) => o[x] ?? null };
};
const now = Date.parse('2026-01-01T00:00:00Z');
const rec = (expire: string) => JSON.stringify({ tokenValue: 'T', expire });

describe('readImsToken', () => {
  it('returns token and expiry', () => {
    const r = readImsToken(mk({ other: 'x', [IMS_KEY_PREFIX + 'a,b']: rec('2026-01-01T01:00:00Z') }), now);
    expect(r).toEqual({ token: 'T', expiresAt: Date.parse('2026-01-01T01:00:00Z') });
  });
  it('no-token when missing or malformed', () => {
    expect(readImsToken(mk({}), now)).toEqual({ error: 'no-token' });
    expect(readImsToken(mk({ [IMS_KEY_PREFIX + 'a']: '{bad' }), now)).toEqual({ error: 'no-token' });
  });
  it('expired when past or within 60s', () => {
    expect(readImsToken(mk({ [IMS_KEY_PREFIX + 'a']: rec('2025-12-31T00:00:00Z') }), now)).toEqual({ error: 'expired' });
    expect(readImsToken(mk({ [IMS_KEY_PREFIX + 'a']: rec('2026-01-01T00:00:30Z') }), now)).toEqual({ error: 'expired' });
  });
  it('prefers a valid record over an expired one', () => {
    const r = readImsToken(mk({ [IMS_KEY_PREFIX + 'a']: rec('2025-01-01T00:00:00Z'), [IMS_KEY_PREFIX + 'b']: rec('2026-01-01T02:00:00Z') }), now);
    expect('token' in r).toBe(true);
  });
});
