import * as client from '../api/adminClient';
import type { SiteRef } from '../api/adminClient';
import { createChromeLabelStore, pruneLabels, secretUsage, withLabel, type Label, type LabelMap } from '../lib/labels';
import { normalizeApiKeys, normalizeSecrets, normalizeWebhooks, type ApiKeyRow, type SecretRow, type WebhookRow } from '../lib/normalize';
import type { FlowClient, LabelHooks } from '../lib/flows';

export const labelStore = createChromeLabelStore();
/** The real admin client, typed as the flow surface (tests inject fakes instead). */
export const flowClient: FlowClient = client;

export const saveLabel = async (s: SiteRef, id: string, label: Label | null) =>
  labelStore.save(s.org, s.site, withLabel(await labelStore.load(s.org, s.site), id, label));
export const labelHooks = (s: SiteRef): LabelHooks => ({
  setLabel: (id, l) => saveLabel(s, id, l),
  removeLabel: (id) => saveLabel(s, id, null),
});

export interface SiteSnapshot {
  secrets: SecretRow[]; webhooks: WebhookRow[]; labels: LabelMap; usage: Record<string, string[]>; prunedLabels: string[];
}
/** Site config (secrets + webhooks) + labels; orphan labels (secret gone) are dropped and persisted. */
export async function loadSnapshot(s: SiteRef): Promise<SiteSnapshot> {
  const cfg = await client.getSiteConfig(s) as { secrets?: unknown } | undefined;
  const secrets = normalizeSecrets(cfg?.secrets);
  const webhooks = normalizeWebhooks(cfg);
  const { labels, removed } = pruneLabels(await labelStore.load(s.org, s.site), secrets.map((x) => x.id));
  if (removed.length) await labelStore.save(s.org, s.site, labels).catch(() => undefined);
  return { secrets, webhooks, labels, usage: secretUsage(webhooks), prunedLabels: removed };
}
export const loadKeyList = async (s: SiteRef): Promise<ApiKeyRow[]> => normalizeApiKeys(await client.listApiKeys(s));
