import { describe, it, expect } from 'vitest';
import { accessMessage } from './access';

const ref = { org: 'aemxsc', site: 'citizens' };
describe('accessMessage', () => {
  it('admin has no message', () => expect(accessMessage({ state: 'admin', detail: '' }, ref)).toBeNull());
  it('no-admin shows status', () => expect(accessMessage({ state: 'no-admin', detail: '404' }, ref)?.body).toContain('Admin API returned 404'));
  it('no-admin mentions author role and permissions', () => { const b = accessMessage({ state: 'no-admin', detail: '401', permissions: ['preview:write'] }, ref)!.body; expect(b).toContain('author role'); expect(b).toContain('preview:write'); });
  it('no-admin names org/site', () => expect(accessMessage({ state: 'no-admin', detail: '' }, ref)?.body).toContain("You don't have admin access on aemxsc/citizens"));
  it.each(['not-found', 'no-auth', 'error'] as const)('%s has a message', (state) => expect(accessMessage({ state, detail: 'd' }, ref)?.title).toBeTruthy());
});

import { decideAccess, rolesFor, matchesEntry, identityFromProfile } from './access';
import { checkAccess, setTransport } from '../api/adminClient';
import { isAllowedRequest } from './relay';

const me = { email: 'Me@Adobe.com' };
const roleCfg = (role: Record<string, unknown>) => ({ access: { admin: { role } } });
describe('role matching', () => {
  it('case-insensitive email, wildcard and glob', () => {
    expect(matchesEntry('me@adobe.com', me)).toBe(true);
    expect(matchesEntry('*@ADOBE.com', me)).toBe(true);
    expect(matchesEntry('*', me)).toBe(true);
    expect(matchesEntry('x@adobe.com', me)).toBe(false);
    expect(matchesEntry('*@adobe.com.evil.io', me)).toBe(false);
  });
  it('rolesFor lists matching roles sorted; [] without identity or map', () => {
    expect(rolesFor(roleCfg({ basic_author: ['me@adobe.com'], author: ['*@adobe.com'], admin: ['boss@adobe.com'] }), me)).toEqual(['author', 'basic_author']);
    expect(rolesFor(roleCfg({ admin: ['me@adobe.com'] }), null)).toEqual([]);
    expect(rolesFor({}, me)).toEqual([]);
  });
  it('identityFromProfile accepts nested and bare', () => {
    expect(identityFromProfile({ profile: { email: 'a@b.c' } })).toEqual({ email: 'a@b.c', userId: undefined });
    expect(identityFromProfile({ email: 'a@b.c' })?.email).toBe('a@b.c');
    expect(identityFromProfile({})).toBeNull();
  });
});
describe('decideAccess precedence (config 200)', () => {
  it('3: admin-only fields win even if role list says author', () => expect(decideAccess({ config: { secrets: [], ...roleCfg({ author: ['me@adobe.com'] }) }, identity: me })).toMatchObject({ state: 'admin', roles: ['author'] }));
  it('4: admin role match => admin', () => expect(decideAccess({ config: roleCfg({ admin: ['me@adobe.com'] }), identity: me })).toMatchObject({ state: 'admin', roles: ['admin'] }));
  it('4: author role => no-admin listing roles, apiKeys 404 ignored', () => expect(decideAccess({ config: roleCfg({ basic_author: ['*@adobe.com'] }), identity: me, keysStatus: 404 })).toMatchObject({ state: 'no-admin', roles: ['basic_author'] }));
  it('4: config_admin alone is not manage-capable', () => expect(decideAccess({ config: roleCfg({ config_admin: ['me@adobe.com'] }), identity: me }).state).toBe('no-admin'));
  it('5: undeterminable + apiKeys 200 => admin', () => expect(decideAccess({ config: {}, identity: null, keysStatus: 200 }).state).toBe('admin'));
  it('5: undeterminable + apiKeys 404 => inconclusive no-admin', () => expect(decideAccess({ config: {}, identity: me, keysStatus: 404 })).toMatchObject({ state: 'no-admin', inconclusive: true }));
  it('5: undeterminable + apiKeys 403 => no-admin', () => expect(decideAccess({ config: {}, identity: me, keysStatus: 403 })).toMatchObject({ state: 'no-admin', detail: '403' }));
});
describe('messages', () => {
  it('roles message', () => expect(accessMessage({ state: 'no-admin', detail: 'roles', roles: ['author', 'basic_author'] }, ref)?.body).toContain('Your roles: author, basic_author'));
  it('inconclusive message', () => expect(accessMessage({ state: 'no-admin', detail: 'inconclusive', inconclusive: true }, ref)?.title).toBe('Could not confirm admin access'));
});
describe('checkAccess end to end (mock transport)', () => {
  const mk = (routes: Record<string, [number, unknown]>) => async (url: string) => {
    const path = url.replace('https://admin.hlx.page', '');
    const [status, body] = routes[path] ?? [404, undefined];
    return { ok: status >= 200 && status < 300, status, statusText: '', text: async () => (body === undefined ? '' : JSON.stringify(body)) };
  };
  const J = '/config/o/sites/s.json', K = '/config/o/sites/s/apiKeys.json', P = '/profile', S = '/status/o/s/main/';
  const run = async (routes: Record<string, [number, unknown]>) => { setTransport(mk(routes)); try { return await checkAccess({ org: 'o', site: 's' }); } finally { setTransport(null); } };
  it('author: config 200 without fields, apiKeys 404 => no-admin with roles', async () =>
    expect(await run({ [J]: [200, { access: { admin: { role: { basic_author: ['me@adobe.com'] } } } }], [P]: [200, { profile: { email: 'me@adobe.com' } }] })).toMatchObject({ state: 'no-admin', roles: ['basic_author'] }));
  it('admin with fields', async () => expect((await run({ [J]: [200, { secrets: [], webhooks: [] }] })).state).toBe('admin'));
  it('no roles, apiKeys 404 => inconclusive', async () => expect(await run({ [J]: [200, {}], [P]: [404, undefined] })).toMatchObject({ inconclusive: true }));
  it('no roles, apiKeys 200 => admin', async () => expect((await run({ [J]: [200, {}], [K]: [200, {}] })).state).toBe('admin'));
  it('config 403 + status 404 => not-found', async () => expect((await run({ [J]: [403, undefined] })).state).toBe('not-found'));
  it('config 404 + status 200 => no-admin', async () => expect((await run({ [J]: [404, undefined], [S]: [200, {}] })).state).toBe('no-admin'));
  it('no token => no-auth', async () => {
    setTransport(async () => { const { AdminApiError } = await import('../api/adminClient'); throw new AdminApiError(401, 'x', true); });
    try { expect((await checkAccess({ org: 'o', site: 's' })).state).toBe('no-auth'); } finally { setTransport(null); }
  });
});
describe('relay allows GET /profile only', () => {
  it('allow', () => { expect(isAllowedRequest('GET', '/profile')).toBe(true); expect(isAllowedRequest('POST', '/profile')).toBe(false); expect(isAllowedRequest('DELETE', '/profile')).toBe(false); });
});
