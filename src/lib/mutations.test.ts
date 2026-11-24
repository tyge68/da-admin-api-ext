import { describe, it, expect } from 'vitest';
import { AdminApiError } from '../api/adminClient';
import { DEFAULT_ROLES, ROLE_OPTIONS, extractKeyValue, isLastAdminKey, mutationError, revealReducer, secretChoices, secretDraftReducer, emptySecretDraft, validateHttpsUrl } from './mutations';
import type { ApiKeyRow } from './normalize';

const k = (id: string, roles: string[]): ApiKeyRow => ({ id, roles, description: '', expiration: '', expiresAt: null, subject: '', created: '' });

describe('mutations logic', () => {
  it('one-time reveal: shown then cleared, nothing retained', () => {
    const shown = revealReducer({ value: null }, { type: 'show', value: 'SECRET' });
    expect(shown.value).toBe('SECRET');
    const cleared = revealReducer(shown, { type: 'clear' });
    expect(cleared).toEqual({ value: null });
    expect(JSON.stringify(cleared)).not.toContain('SECRET');
  });
  it('extractKeyValue', () => {
    expect(extractKeyValue({ id: 'i', value: 'v' })).toBe('v');
    expect(extractKeyValue({ id: 'i' })).toBeNull();
    expect(extractKeyValue(undefined)).toBeNull();
  });
  it('last admin key detection', () => {
    expect(isLastAdminKey([k('a', ['admin']), k('b', ['view'])], 'a')).toBe(true);
    expect(isLastAdminKey([k('a', ['admin']), k('b', ['admin'])], 'a')).toBe(false);
    expect(isLastAdminKey([k('a', ['view'])], 'a')).toBe(false);
  });
  it('validates https url', () => {
    expect(validateHttpsUrl('https://example.com/webhook')).toBeNull();
    expect(validateHttpsUrl('http://x.io')).not.toBeNull();
    expect(validateHttpsUrl('nope')).not.toBeNull();
    expect(validateHttpsUrl('javascript:alert(1)')).not.toBeNull();
  });
  it('roles default view and include admin', () => {
    expect(DEFAULT_ROLES).toEqual(['view']);
    expect(ROLE_OPTIONS.map((r) => r.id)).toContain('admin');
  });
  it('friendly errors', () => {
    expect(mutationError(new AdminApiError(403, 'Forbidden (403)'), 'delete')).toMatch(/403/);
    expect(mutationError(new AdminApiError(400, 'x'), 'create')).toMatch(/400/);
    expect(mutationError(new Error('boom'), 'create')).toMatch(/boom/);
  });
  it('secret draft is cleared and retains nothing', () => {
    const d = secretDraftReducer(emptySecretDraft(), { type: 'set', value: 'KEYVAL' });
    expect(d.value).toBe('KEYVAL');
    const cleared = secretDraftReducer(d, { type: 'clear' });
    expect(cleared).toEqual({ value: '' });
    expect(JSON.stringify(cleared)).not.toContain('KEYVAL');
  });
  it('secretChoices shows label + id prefix', () => {
    expect(secretChoices([{ id: 'ABCDEFGHIJ' }, { id: 'zz' }], 'zz', { ABCDEFGHIJ: { name: 'log reader' } })).toEqual([
      { id: 'ABCDEFGHIJ', label: 'log reader (ABCDEFGH…)' }, { id: 'zz', label: 'zz (current)' }]);
  });
  it('secretChoices marks current; 405 mapped friendly without body', () => {
    expect(secretChoices([{ id: 'a' }, { id: 'b' }], 'b')).toEqual([{ id: 'a', label: 'a' }, { id: 'b', label: 'b (current)' }]);
    expect(mutationError(new AdminApiError(405, 'x'), 'update the secret')).toMatch(/does not support/);
  });
});
