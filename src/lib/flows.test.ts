import { describe, it, expect, vi } from 'vitest';
import { RotationRun, WizardRun, findConfiguredWebhook, quickLabel, deleteUnusedSecret, expiredKeys, unusedSecrets, type FlowClient } from './flows';
import type { ApiKeyRow, SecretRow } from './normalize';

const site = { org: 'o', site: 's' };
const KEYVAL = 'SUPER-SECRET-KEY-VALUE-123';

function fake(over: Partial<FlowClient> = {}) {
  const calls: string[] = [];
  const hooksState: { id: string; url: string; secretId: string }[] = [];
  const c: FlowClient = {
    createApiKey: vi.fn(async () => { calls.push('createKey'); return { id: 'K1', value: KEYVAL }; }),
    deleteApiKey: vi.fn(async (_r, id) => { calls.push(`deleteKey:${id}`); }),
    createSecret: vi.fn(async (_r, v) => { calls.push(`createSecret:${v === KEYVAL}`); return { id: 'S1' }; }),
    deleteSecret: vi.fn(async (_r, id) => { calls.push(`deleteSecret:${id}`); }),
    updateSecret: vi.fn(async (_r, id, v) => { calls.push(`updateSecret:${id}:${v === KEYVAL}`); }),
    addWebhook: vi.fn(async (_r, secretId, url) => { calls.push('addWebhook'); hooksState.push({ id: 'W1', url, secretId }); return {}; }),
    updateWebhook: vi.fn(async (_r, id, b) => { calls.push(`updateWebhook:${id}:${b.secretId}`); const h = hooksState.find((x) => x.id === id); if (h) h.secretId = b.secretId; }),
    deleteWebhook: vi.fn(async (_r, id) => { calls.push(`deleteWebhook:${id}`); }),
    getSiteConfig: vi.fn(async () => ({ webhooks: hooksState })),
    probeLog: vi.fn(async () => { calls.push('probe'); return { entries: [1, 2] }; }),
    ...over,
  };
  return { c, calls, hooksState };
}

describe('WizardRun', () => {
  it('happy path: order, label saved, key cleared, nothing leaks', async () => {
    const { c, calls } = fake();
    const setLabel = vi.fn(async () => {});
    const w = new WizardRun(c, site, { setLabel });
    const st = await w.run({ keyDescription: 'd', label: 'log reader', url: 'https://x.io/h' });
    expect(st.ok).toBe(true);
    expect(calls).toEqual(['createKey', 'probe', 'createSecret:true', 'addWebhook']);
    expect(setLabel).toHaveBeenCalledWith('S1', { name: 'log reader', keyId: 'K1' });
    expect(st.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }, { kind: 'secret', id: 'S1' }, { kind: 'webhook', id: 'W1' }]);
    expect(w.hasKeyInMemory()).toBe(false);
    expect(JSON.stringify(st)).not.toContain(KEYVAL);
    expect(c.createApiKey).toHaveBeenCalledWith(site, 'd', ['view']);
  });
  it('refuses when 2 webhooks exist; creates nothing', async () => {
    const { c } = fake({ getSiteConfig: vi.fn(async () => ({ webhooks: [{ id: 'a', url: 'u', secretId: 's' }, { id: 'b', url: 'u', secretId: 's' }] })) });
    const st = await new WizardRun(c, site).run({ keyDescription: 'd', label: 'l', url: 'https://x.io' });
    expect(st.ok).toBe(false);
    expect(st.created).toEqual([]);
    expect(c.createApiKey).not.toHaveBeenCalled();
  });
  it('failure at webhook: stops, lists created ids, clears key, rolls back in reverse', async () => {
    const { c, calls } = fake({ addWebhook: vi.fn(async () => { throw new Error('boom'); }) });
    const removeLabel = vi.fn(async () => {});
    const w = new WizardRun(c, site, { removeLabel });
    const st = await w.run({ keyDescription: 'd', label: 'l', url: 'https://x.io' });
    expect(st.ok).toBe(false);
    expect(st.error).toBe('boom');
    expect(st.steps.map((s) => s.status)).toEqual(['done', 'done', 'done', 'failed', 'skipped']);
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }, { kind: 'secret', id: 'S1' }]);
    expect(w.hasKeyInMemory()).toBe(false);
    calls.length = 0;
    const r = await w.rollbackAll();
    expect(calls).toEqual(['deleteSecret:S1', 'deleteKey:K1']);
    expect(removeLabel).toHaveBeenCalledWith('S1');
    expect(r.failed).toEqual([]);
    expect(w.snapshot().created).toEqual([]);
  });
  it('probe failure: only key created; rollback deletes it', async () => {
    const { c, calls } = fake({ probeLog: vi.fn(async () => { throw new Error('403'); }) });
    const w = new WizardRun(c, site);
    const st = await w.run({ keyDescription: 'd', label: 'l', url: 'https://x.io' });
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }]);
    expect(c.createSecret).not.toHaveBeenCalled();
    await w.rollbackAll();
    expect(calls.at(-1)).toBe('deleteKey:K1');
  });
  it('rollback keeps items whose delete failed', async () => {
    const { c } = fake({ addWebhook: vi.fn(async () => { throw new Error('x'); }), deleteSecret: vi.fn(async () => { throw new Error('nope'); }) });
    const w = new WizardRun(c, site);
    await w.run({ keyDescription: 'd', label: 'l', url: 'https://x.io' });
    const r = await w.rollbackAll();
    expect(r.failed.map((f) => f.item.id)).toEqual(['S1']);
    expect(r.deleted.map((d) => d.id)).toEqual(['K1']);
    expect(w.snapshot().created).toEqual([{ kind: 'secret', id: 'S1' }]);
  });
  it('rollback resolves webhook id from config when add response had none', async () => {
    const { c, calls } = fake({ getSiteConfig: undefined });
    let verifyFails = true;
    const hooks: { id: string; url: string; secretId: string }[] = [];
    c.addWebhook = vi.fn(async (_r, secretId, url) => { hooks.push({ id: 'WX', url, secretId }); return {}; });
    c.getSiteConfig = vi.fn(async () => (verifyFails ? { webhooks: [] } : { webhooks: hooks }));
    const w = new WizardRun(c, site);
    const st = await w.run({ keyDescription: 'd', label: 'l', url: 'https://x.io' });
    expect(st.steps.find((s) => s.id === 'verify')!.status).toBe('failed');
    verifyFails = false;
    calls.length = 0;
    await w.rollbackAll();
    expect(calls[0]).toBe('deleteWebhook:WX');
  });
  it('cancel clears key', async () => {
    const { c } = fake();
    const w = new WizardRun(c, site);
    w.cancel();
    expect(w.hasKeyInMemory()).toBe(false);
    expect(w.snapshot().finished).toBe(true);
  });
});

const rin = { webhookId: 'W1', webhookUrl: 'https://x.io/h', oldSecretId: 'OLDS', oldSecretName: 'log reader', keyDescription: 'd', label: 'log reader v2' };
function rotFake(over: Partial<FlowClient> = {}) {
  const f = fake(over);
  f.hooksState.push({ id: 'W1', url: 'https://x.io/h', secretId: 'OLDS' });
  return f;
}

describe('RotationRun (blue/green)', () => {
  it('happy path: new key, probe, NEW secret, switch webhook, verify; old items untouched', async () => {
    const { c, calls, hooksState } = rotFake();
    const setLabel = vi.fn(async () => {});
    const r = new RotationRun(c, site, { setLabel });
    const st = await r.run(rin);
    expect(st.ok).toBe(true);
    expect(calls).toEqual(['createKey', 'probe', 'createSecret:true', 'updateWebhook:W1:S1']);
    expect(hooksState[0].secretId).toBe('S1');
    expect(setLabel).toHaveBeenCalledWith('S1', { name: 'log reader v2', keyId: 'K1', note: expect.stringMatching(/^rotation of log reader \(OLDS\), \d{4}-\d{2}-\d{2}$/) });
    expect(c.updateSecret).not.toHaveBeenCalled();
    expect(c.deleteSecret).not.toHaveBeenCalled();
    expect(c.deleteApiKey).not.toHaveBeenCalled();
    expect(st.steps.every((s) => s.status === 'done')).toBe(true);
    expect(r.hasKeyInMemory()).toBe(false);
    expect(JSON.stringify(st)).not.toContain(KEYVAL);
  });
  it('switch failure: repoints to OLD secret, then deletes new secret then new key', async () => {
    const { c, calls } = rotFake();
    let n = 0;
    c.updateWebhook = vi.fn(async (_r, id, b) => { calls.push(`updateWebhook:${id}:${b.secretId}`); if (++n === 1) throw new Error('500'); });
    const removeLabel = vi.fn(async () => {});
    const r = new RotationRun(c, site, { removeLabel });
    const st = await r.run(rin);
    expect(st.ok).toBe(false);
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }, { kind: 'secret', id: 'S1' }]);
    calls.length = 0;
    const res = await r.rollbackAll();
    expect(calls).toEqual(['updateWebhook:W1:OLDS', 'deleteSecret:S1', 'deleteKey:K1']);
    expect(res.failed).toEqual([]);
    expect(removeLabel).toHaveBeenCalledWith('S1');
  });
  it('verify failure also repoints before deleting', async () => {
    const { c, calls } = rotFake();
    c.getSiteConfig = vi.fn(async () => ({ webhooks: [{ id: 'W1', url: 'u', secretId: 'OLDS' }] }));
    const r = new RotationRun(c, site);
    const st = await r.run(rin);
    expect(st.steps.find((s) => s.id === 'verify')!.status).toBe('failed');
    calls.length = 0;
    await r.rollbackAll();
    expect(calls).toEqual(['updateWebhook:W1:OLDS', 'deleteSecret:S1', 'deleteKey:K1']);
  });
  it('if repoint fails, new secret/key are KEPT (webhook might use them)', async () => {
    const { c } = rotFake();
    c.updateWebhook = vi.fn(async () => { throw new Error('down'); });
    const r = new RotationRun(c, site);
    await r.run(rin);
    const res = await r.rollbackAll();
    expect(res.failed).toHaveLength(1);
    expect(c.deleteSecret).not.toHaveBeenCalled();
    expect(c.deleteApiKey).not.toHaveBeenCalled();
  });
  it('failure before the switch: no repoint, just delete new items', async () => {
    const { c, calls } = rotFake({ createSecret: vi.fn(async () => { throw new Error('x'); }) });
    const r = new RotationRun(c, site);
    const st = await r.run(rin);
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }]);
    calls.length = 0;
    await r.rollbackAll();
    expect(calls).toEqual(['deleteKey:K1']);
    expect(c.updateWebhook).not.toHaveBeenCalled();
  });
  it('probe failure creates no secret', async () => {
    const { c } = rotFake({ probeLog: vi.fn(async () => { throw new Error('401'); }) });
    const st = await new RotationRun(c, site).run(rin);
    expect(st.ok).toBe(false);
    expect(c.createSecret).not.toHaveBeenCalled();
  });
});

const sec = (id: string): SecretRow => ({ id, type: 'hashed', created: 'c', lastModified: 'm' });
const key = (id: string, expiresAt: number | null): ApiKeyRow => ({ id, description: '', roles: ['view'], created: '', expiration: '', expiresAt, subject: '' });

describe('cleanup', () => {
  it('lists only unused secrets with linked key (via keyId) and flags unknown', () => {
    const rows = unusedSecrets([sec('a'), sec('b'), sec('c')], [{ id: 'w', url: 'u', secretId: 'a' }], { b: { name: 'B', keyId: 'K1' }, c: { name: 'C' } }, [key('K1', 5)]);
    expect(rows.map((r) => r.secret.id)).toEqual(['b', 'c']);
    expect(rows[0].key?.id).toBe('K1');
    expect(rows[1].keyId).toBeUndefined();
  });
  it('linked key missing from key list -> keyId kept, key undefined', () => {
    const [r] = unusedSecrets([sec('b')], [], { b: { name: 'B', keyId: 'GONE' } }, []);
    expect(r.keyId).toBe('GONE'); expect(r.key).toBeUndefined();
  });
  it('expiredKeys', () => {
    expect(expiredKeys([key('a', 10), key('b', 1e15), key('c', null)], 100).map((k) => k.id)).toEqual(['a']);
  });
  it('deleteUnusedSecret: secret then key; label removed', async () => {
    const { c, calls } = fake();
    const removeLabel = vi.fn(async () => {});
    const r = await deleteUnusedSecret(c, site, 'S9', 'K9', { removeLabel });
    expect(r).toEqual({ secretDeleted: true, keyDeleted: true });
    expect(calls).toEqual(['deleteSecret:S9', 'deleteKey:K9']);
    expect(removeLabel).toHaveBeenCalledWith('S9');
  });
  it('deleteUnusedSecret without key only deletes secret', async () => {
    const { c, calls } = fake();
    expect(await deleteUnusedSecret(c, site, 'S9', undefined)).toEqual({ secretDeleted: true, keyDeleted: false });
    expect(calls).toEqual(['deleteSecret:S9']);
  });
  it('refuses when a webhook now references the secret (fresh check)', async () => {
    const { c, hooksState } = fake();
    hooksState.push({ id: 'W', url: 'u', secretId: 'S9' });
    const r = await deleteUnusedSecret(c, site, 'S9', 'K9');
    expect(r.secretDeleted).toBe(false); expect(r.error).toMatch(/referenced/);
    expect(c.deleteSecret).not.toHaveBeenCalled(); expect(c.deleteApiKey).not.toHaveBeenCalled();
  });
  it('key not deleted if secret delete fails', async () => {
    const { c } = fake({ deleteSecret: vi.fn(async () => { throw new Error('no'); }) });
    const r = await deleteUnusedSecret(c, site, 'S9', 'K9');
    expect(r.keyDeleted).toBe(false); expect(c.deleteApiKey).not.toHaveBeenCalled();
  });
});

describe('Quick setup (WizardRun quick mode)', () => {
  const input = { keyDescription: 'webhook log reader', label: 'ignored', url: 'https://x.io/h' };
  it('order: key, secret(value=key), webhook, verify; no probe; label has key prefix', async () => {
    const { c, calls } = fake({ createApiKey: vi.fn(async () => { calls.push('createKey'); return { id: 'KEY12345678', value: KEYVAL, expiration: '2027-01-01T00:00:00Z' }; }) });
    const setLabel = vi.fn(async () => {});
    const w = new WizardRun(c, site, { setLabel }, undefined, { quick: true });
    const st = await w.run(input);
    expect(st.ok).toBe(true);
    expect(calls).toEqual(['createKey', 'createSecret:true', 'addWebhook']);
    expect(c.probeLog).not.toHaveBeenCalled();
    expect(c.createApiKey).toHaveBeenCalledWith(site, input.keyDescription, ['view']);
    expect(st.steps.map((s) => s.id)).toEqual(['key', 'secret', 'webhook', 'verify']);
    expect(setLabel).toHaveBeenCalledWith('S1', { name: 'webhook log reader (key KEY12345)', keyId: 'KEY12345678' });
    expect(w.keyExpiration).toBe('2027-01-01T00:00:00Z');
    expect(st.created.map((x) => x.kind)).toEqual(['apiKey', 'secret', 'webhook']);
  });
  it('rollback on webhook failure deletes in reverse and clears key', async () => {
    const { c, calls } = fake({ addWebhook: vi.fn(async () => { throw new Error('boom'); }) });
    const removeLabel = vi.fn(async () => {});
    const w = new WizardRun(c, site, { removeLabel }, undefined, { quick: true });
    const st = await w.run(input);
    expect(st.ok).toBe(false);
    expect(st.created).toEqual([{ kind: 'apiKey', id: 'K1' }, { kind: 'secret', id: 'S1' }]);
    expect(w.hasKeyInMemory()).toBe(false);
    calls.length = 0;
    await w.rollbackAll();
    expect(calls).toEqual(['deleteSecret:S1', 'deleteKey:K1']);
    expect(removeLabel).toHaveBeenCalledWith('S1');
  });
  it('refuses with 2 webhooks; creates nothing', async () => {
    const { c } = fake({ getSiteConfig: vi.fn(async () => ({ webhooks: [{ id: 'a', url: 'u', secretId: 's' }, { id: 'b', url: 'u', secretId: 's' }] })) });
    const st = await new WizardRun(c, site, {}, undefined, { quick: true }).run(input);
    expect(st.ok).toBe(false);
    expect(c.createApiKey).not.toHaveBeenCalled();
  });
  it('secrets cleared after success and failure; never in snapshots', async () => {
    const a = fake(); const w1 = new WizardRun(a.c, site, {}, undefined, { quick: true });
    const s1 = await w1.run(input);
    expect(w1.hasKeyInMemory()).toBe(false); expect(JSON.stringify(s1)).not.toContain(KEYVAL);
    const b = fake({ createSecret: vi.fn(async () => { throw new Error('x'); }) }); const w2 = new WizardRun(b.c, site, {}, undefined, { quick: true });
    const s2 = await w2.run(input);
    expect(w2.hasKeyInMemory()).toBe(false); expect(JSON.stringify(s2)).not.toContain(KEYVAL);
  });
  it('already-configured detection by URL', () => {
    const hooks = [{ id: 'W1', url: 'https://other', secretId: 's' }, { id: 'W2', url: 'https://x.io/h', secretId: 's2' }];
    expect(findConfiguredWebhook(hooks, 'https://x.io/h')?.id).toBe('W2');
    expect(findConfiguredWebhook(hooks, 'https://nope')).toBeUndefined();
    expect(quickLabel('ABCDEFGHIJ')).toBe('webhook log reader (key ABCDEFGH)');
  });
});
