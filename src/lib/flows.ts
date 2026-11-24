import { extractKeyValue } from './mutations';
import { normalizeApiKeys, normalizeWebhooks, type ApiKeyRow, type SecretRow, type WebhookRow } from './normalize';
import { isoDay, secretUsage, type Label, type LabelMap } from './labels';
import type { SiteRef } from '../api/adminClient';

export const MAX_WEBHOOKS = 2;
export const KEY_DESCRIPTION_PRESET = 'webhook log reader';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface StepState { id: string; label: string; status: StepStatus; detail?: string }
export type CreatedKind = 'apiKey' | 'secret' | 'webhook';
export interface CreatedItem { kind: CreatedKind; id: string }
export interface RunState { steps: StepState[]; created: CreatedItem[]; error?: string; finished: boolean; ok: boolean }
export interface RollbackResult { deleted: CreatedItem[]; failed: { item: CreatedItem; error: string }[] }

/** Admin client surface the flows need; inject a fake in tests. */
export interface FlowClient {
  createApiKey(ref: SiteRef, description: string, roles: string[]): Promise<unknown>;
  deleteApiKey(ref: SiteRef, id: string): Promise<unknown>;
  createSecret(ref: SiteRef, value?: string): Promise<unknown>;
  deleteSecret(ref: SiteRef, id: string): Promise<unknown>;
  updateSecret(ref: SiteRef, id: string, value: string): Promise<unknown>;
  addWebhook(ref: SiteRef, secretId: string, url: string): Promise<unknown>;
  updateWebhook(ref: SiteRef, id: string, body: { secretId: string; url: string }): Promise<unknown>;
  deleteWebhook(ref: SiteRef, id: string): Promise<unknown>;
  getSiteConfig(ref: SiteRef): Promise<unknown>;
  probeLog(ref: SiteRef, key: string): Promise<unknown>;
}
/** Local label persistence hooks (labels only, never values). */
export interface LabelHooks {
  setLabel?: (secretId: string, label: Label) => Promise<void>;
  removeLabel?: (secretId: string) => Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error');
const idOf = (res: unknown): string | null => {
  const id = typeof res === 'object' && res !== null ? (res as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id ? id : null;
};

export const webhookLimitReached = (count: number) => count >= MAX_WEBHOOKS;

/** Count entries in a log probe response (best effort; shape not guaranteed). */
export function countLogEntries(res: unknown): number | null {
  if (Array.isArray(res)) return res.length;
  if (typeof res === 'object' && res !== null) {
    const o = res as Record<string, unknown>;
    for (const k of ['entries', 'log', 'logs', 'items']) if (Array.isArray(o[k])) return (o[k] as unknown[]).length;
  }
  return null;
}

/** Shared step runner. The new key value is held ONLY in this closure and dropped by clear(). */
abstract class BaseRun {
  protected key: string | null = null;
  protected created: CreatedItem[] = [];
  protected steps: StepState[];
  protected error?: string;
  protected finished = false;
  protected ok = false;
  constructor(protected client: FlowClient, protected site: SiteRef, defs: [string, string][], private onUpdate: (s: RunState) => void = () => {}) {
    this.steps = defs.map(([id, label]) => ({ id, label, status: 'pending' }));
  }
  /** Immutable snapshot for the UI; never contains the key. */
  snapshot(): RunState {
    return { steps: this.steps.map((s) => ({ ...s })), created: this.created.map((c) => ({ ...c })), error: this.error, finished: this.finished, ok: this.ok };
  }
  protected emit() { this.onUpdate(this.snapshot()); }
  /** Drop the in-memory key value. Called at end, on failure and on cancel. */
  clear() { this.key = null; }
  hasKeyInMemory() { return this.key !== null; }
  protected set(id: string, status: StepStatus, detail?: string) {
    const s = this.steps.find((x) => x.id === id)!;
    s.status = status; s.detail = detail; this.emit();
  }
  protected async step<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.set(id, 'running');
    try { const r = await fn(); if (this.steps.find((x) => x.id === id)!.status === 'running') this.set(id, 'done'); return r; }
    catch (e) { this.set(id, 'failed', msg(e)); throw e; }
  }
  protected fail(e: unknown) {
    this.error = msg(e);
    this.finished = true; this.ok = false;
    for (const s of this.steps) if (s.status === 'pending') s.status = 'skipped';
    this.clear(); this.emit();
  }
  protected succeed() { this.finished = true; this.ok = true; this.clear(); this.emit(); }
  cancel() { this.clear(); if (!this.finished) { this.finished = true; this.ok = false; this.error ??= 'Cancelled'; for (const s of this.steps) if (s.status === 'pending') s.status = 'skipped'; this.emit(); } }

  protected async resolveWebhookId(item: CreatedItem, secretId?: string, url?: string): Promise<string | null> {
    if (item.id) return item.id;
    const hooks = normalizeWebhooks(await this.client.getSiteConfig(this.site));
    return hooks.find((w) => w.secretId === secretId && w.url === url)?.id ?? null;
  }

  /** Delete everything created so far, in reverse order. Items that fail to delete stay in `created`. */
  async rollback(extra: { webhookLookup?: { secretId: string; url: string }; removeLabel?: LabelHooks['removeLabel'] } = {}): Promise<RollbackResult> {
    const result: RollbackResult = { deleted: [], failed: [] };
    const remaining: CreatedItem[] = [];
    for (const item of [...this.created].reverse()) {
      try {
        if (item.kind === 'webhook') {
          const id = await this.resolveWebhookId(item, extra.webhookLookup?.secretId, extra.webhookLookup?.url);
          if (id) await this.client.deleteWebhook(this.site, id);
        } else if (item.kind === 'secret') {
          await this.client.deleteSecret(this.site, item.id);
          await extra.removeLabel?.(item.id).catch(() => undefined);
        } else await this.client.deleteApiKey(this.site, item.id);
        result.deleted.push(item);
      } catch (e) { result.failed.push({ item, error: msg(e) }); remaining.unshift(item); }
    }
    this.created = remaining;
    this.emit();
    return result;
  }
}

export interface WizardInput { keyDescription: string; label: string; url: string }

export const QUICK_LABEL_BASE = 'webhook log reader';
/** Label for quick setup: includes the key id prefix so the secret can be tied to its key. */
export const quickLabel = (keyId: string) => `${QUICK_LABEL_BASE} (key ${keyId.slice(0, 8)})`;
/** Webhook already pointing at the given URL (the configured endpoint), if any. */
export const findConfiguredWebhook = (webhooks: WebhookRow[], url: string) => webhooks.find((w) => w.url === url);

export interface WizardOptions {
  /** Quick mode: no log probe step, label generated from the key id (input.label is ignored). */
  quick?: boolean;
}
const FULL_STEPS: [string, string][] = [
  ['key', 'Create view key'], ['probe', 'Probe log with key'], ['secret', 'Create secret + label'],
  ['webhook', 'Register webhook'], ['verify', 'Verify in site config'],
];
const QUICK_STEPS: [string, string][] = FULL_STEPS.filter(([id]) => id !== 'probe');

export class WizardRun extends BaseRun {
  secretId: string | null = null;
  keyId: string | null = null;
  keyExpiration: string | null = null;
  secretLabel: string | null = null;
  private url = '';
  private quick: boolean;
  constructor(client: FlowClient, site: SiteRef, private hooks: LabelHooks = {}, onUpdate?: (s: RunState) => void, opts: WizardOptions = {}) {
    super(client, site, opts.quick ? QUICK_STEPS : FULL_STEPS, onUpdate);
    this.quick = !!opts.quick;
  }

  async run(input: WizardInput): Promise<RunState> {
    this.url = input.url;
    try {
      const cfg = await this.client.getSiteConfig(this.site);
      if (webhookLimitReached(normalizeWebhooks(cfg).length)) throw new Error(`Site already has ${MAX_WEBHOOKS} webhooks (maximum). Delete one first.`);

      const keyId = await this.step('key', async () => {
        const res = await this.client.createApiKey(this.site, input.keyDescription, ['view']);
        const id = idOf(res); const value = extractKeyValue(res);
        if (id) this.created.push({ kind: 'apiKey', id });
        if (!id || !value) throw new Error('API returned no key id/value');
        this.key = value;
        const exp = (res as { expiration?: unknown }).expiration;
        if (typeof exp === 'string') this.keyExpiration = exp;
        return id;
      });
      this.keyId = keyId;

      if (!this.quick) {
        await this.step('probe', async () => {
          const res = await this.client.probeLog(this.site, this.key as string);
          const n = countLogEntries(res);
          this.set('probe', 'running', n == null ? '200 OK' : `200 OK, ${n} entries`);
        });
        const probe = this.steps.find((s) => s.id === 'probe')!;
        probe.status = 'done'; this.emit();
      }

      await this.step('secret', async () => {
        const res = await this.client.createSecret(this.site, this.key as string);
        const id = idOf(res);
        if (!id) throw new Error('API returned no secret id');
        this.created.push({ kind: 'secret', id });
        this.secretId = id;
        const name = this.quick ? quickLabel(this.keyId as string) : input.label;
        this.secretLabel = name;
        try { await this.hooks.setLabel?.(id, { name, keyId: this.keyId ?? undefined }); } catch { this.set('secret', 'running', 'created; label could not be saved locally'); }
      });
      this.key = null; // no longer needed once the secret holds it

      await this.step('webhook', async () => {
        const res = await this.client.addWebhook(this.site, this.secretId as string, input.url);
        this.created.push({ kind: 'webhook', id: idOf(res) ?? '' });
      });

      await this.step('verify', async () => {
        const hooks = normalizeWebhooks(await this.client.getSiteConfig(this.site));
        const hit = hooks.find((w) => w.secretId === this.secretId && w.url === input.url);
        if (!hit) throw new Error('Webhook not found in site config after creation');
        const c = this.created.find((x) => x.kind === 'webhook');
        if (c && !c.id) c.id = hit.id;
      });
      this.succeed();
    } catch (e) { this.fail(e); }
    return this.snapshot();
  }

  rollbackAll() {
    return this.rollback({ webhookLookup: this.secretId ? { secretId: this.secretId, url: this.url } : undefined, removeLabel: this.hooks.removeLabel });
  }
}

export interface RotationInput {
  webhookId: string; webhookUrl: string; oldSecretId: string; oldSecretName?: string;
  keyDescription: string; label: string;
}

/**
 * Blue/green rotation: new key + new secret are created next to the old ones, then the webhook is
 * repointed (the switch). The OLD secret and OLD key are never touched.
 */
export class RotationRun extends BaseRun {
  newKeyId: string | null = null;
  newSecretId: string | null = null;
  private switchAttempted = false;
  private input: RotationInput | null = null;
  constructor(client: FlowClient, site: SiteRef, private hooks: LabelHooks = {}, onUpdate?: (s: RunState) => void) {
    super(client, site, [
      ['key', 'Create new view key'], ['probe', 'Probe log with new key'], ['secret', 'Create new secret + label'],
      ['switch', 'Switch webhook to new secret'], ['verify', 'Verify in site config'],
    ], onUpdate);
  }

  async run(input: RotationInput): Promise<RunState> {
    this.input = input;
    try {
      await this.step('key', async () => {
        const res = await this.client.createApiKey(this.site, input.keyDescription, ['view']);
        const id = idOf(res); const value = extractKeyValue(res);
        if (id) { this.created.push({ kind: 'apiKey', id }); this.newKeyId = id; }
        if (!id || !value) throw new Error('API returned no key id/value');
        this.key = value;
      });
      await this.step('probe', async () => {
        const n = countLogEntries(await this.client.probeLog(this.site, this.key as string));
        this.set('probe', 'running', n == null ? '200 OK' : `200 OK, ${n} entries`);
      });
      this.steps.find((s) => s.id === 'probe')!.status = 'done';
      await this.step('secret', async () => {
        const id = idOf(await this.client.createSecret(this.site, this.key as string));
        if (!id) throw new Error('API returned no secret id');
        this.created.push({ kind: 'secret', id });
        this.newSecretId = id;
        const note = `rotation of ${input.oldSecretName ? `${input.oldSecretName} (${input.oldSecretId})` : input.oldSecretId}, ${isoDay()}`;
        try { await this.hooks.setLabel?.(id, { name: input.label, note, keyId: this.newKeyId ?? undefined }); } catch { this.set('secret', 'running', 'created; label could not be saved locally'); }
      });
      this.key = null;
      await this.step('switch', async () => {
        this.switchAttempted = true;
        await this.client.updateWebhook(this.site, input.webhookId, { secretId: this.newSecretId as string, url: input.webhookUrl });
      });
      await this.step('verify', async () => {
        const w = normalizeWebhooks(await this.client.getSiteConfig(this.site)).find((x) => x.id === input.webhookId);
        if (!w || w.secretId !== this.newSecretId) throw new Error('Webhook does not reference the new secret in site config');
      });
      this.succeed();
    } catch (e) { this.fail(e); }
    return this.snapshot();
  }

  /**
   * Undo: if the switch was attempted, repoint the webhook to the old secret first. Only when that
   * succeeded are the new secret and key deleted (otherwise the webhook might still use them).
   */
  async rollbackAll(): Promise<RollbackResult> {
    const inp = this.input;
    if (this.switchAttempted && inp) {
      try {
        await this.client.updateWebhook(this.site, inp.webhookId, { secretId: inp.oldSecretId, url: inp.webhookUrl });
      } catch (e) {
        return { deleted: [], failed: [{ item: { kind: 'webhook', id: inp.webhookId }, error: `could not repoint webhook to old secret: ${msg(e)}; new secret/key kept` }] };
      }
      this.switchAttempted = false;
    }
    return this.rollback({ removeLabel: this.hooks.removeLabel });
  }
}

// ---------- Cleanup (never automatic; every deletion is user-confirmed in the UI) ----------

export interface SecretCleanupRow { secret: SecretRow; label?: Label; keyId?: string; key?: ApiKeyRow }

/** Secrets not referenced by any webhook, with their linked key (via label.keyId) when still present. */
export function unusedSecrets(secrets: SecretRow[], webhooks: WebhookRow[], labels: LabelMap, keys: ApiKeyRow[]): SecretCleanupRow[] {
  const used = secretUsage(webhooks);
  return secrets.filter((s) => !used[s.id]?.length).map((secret) => {
    const label = labels[secret.id];
    const keyId = label?.keyId;
    return { secret, label, keyId, key: keyId ? keys.find((k) => k.id === keyId) : undefined };
  });
}

export const expiredKeys = (keys: ApiKeyRow[], now = Date.now()) => keys.filter((k) => k.expiresAt != null && k.expiresAt <= now);

export interface CleanupResult { secretDeleted: boolean; keyDeleted: boolean; error?: string }

/**
 * Delete an unused secret and optionally its key. Re-checks against a fresh site config that no webhook
 * references the secret; the key is only deleted after the secret deletion succeeded.
 */
export async function deleteUnusedSecret(client: FlowClient, site: SiteRef, secretId: string, keyId: string | undefined, hooks: LabelHooks = {}): Promise<CleanupResult> {
  const r: CleanupResult = { secretDeleted: false, keyDeleted: false };
  try {
    const hooksNow = normalizeWebhooks(await client.getSiteConfig(site));
    if (hooksNow.some((w) => w.secretId === secretId)) throw new Error('Secret is referenced by a webhook; not deleted');
    await client.deleteSecret(site, secretId);
    r.secretDeleted = true;
    await hooks.removeLabel?.(secretId).catch(() => undefined);
    if (keyId) { await client.deleteApiKey(site, keyId); r.keyDeleted = true; }
  } catch (e) { r.error = msg(e); }
  return r;
}

export const parseKeys = normalizeApiKeys;
