import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, InlineAlert, Picker, PickerItem,
  Tab, TabList, TabPanel, Tabs, Text, TextField, ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { SiteRef } from '../api/adminClient';
import { validateHttpsUrl, mutationError } from '../lib/mutations';
import { isoDay, secretDisplay } from '../lib/labels';
import type { ApiKeyRow } from '../lib/normalize';
import { findConfiguredWebhook, expiredKeys, deleteUnusedSecret, unusedSecrets, KEY_DESCRIPTION_PRESET, MAX_WEBHOOKS, RotationRun, WizardRun, webhookLimitReached, type RollbackResult, type RunState } from '../lib/flows';
import { flowClient, labelHooks, loadKeyList, loadSnapshot, type SiteSnapshot } from './siteData';
import { DeleteKeyButton } from './Mutations';
import { EndpointNotice, useSettings } from './settings';

const col = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const panel = style({ paddingTop: 16 });
const rowS = style({ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' });
const ok = (m: string) => ToastQueue.positive(m, { timeout: 5000 });
const bad = (m: string) => ToastQueue.negative(m, { timeout: 8000 });

const ICON = { pending: '○', running: '…', done: '✓', failed: '✗', skipped: '–' } as const;
const describeItem = (i: { kind: string; id: string }) => `${i.kind === 'apiKey' ? 'API key' : i.kind} ${i.id || '(id unknown, looked up on rollback)'}`;

function Stepper({ state }: { state: RunState }) {
  return (
    <div className={col} data-testid="stepper">
      {state.steps.map((s) => (
        <div key={s.id} data-testid={`step-${s.id}`} data-status={s.status}>
          <Text>{ICON[s.status]} {s.label}{s.detail ? ` — ${s.detail}` : ''}</Text>
        </div>
      ))}
    </div>
  );
}

function Outcome({ state, rollback, rolled, busy, okText }: { state: RunState; rollback: () => void; rolled: RollbackResult | null; busy: boolean; okText: string }) {
  if (!state.finished) return null;
  if (state.ok) return <InlineAlert variant="positive"><Heading>Done</Heading><Content>{okText}</Content></InlineAlert>;
  return (
    <InlineAlert variant="negative">
      <Heading>Stopped: {state.error}</Heading>
      <Content>
        <div className={col}>
          {state.created.length > 0
            ? <Text data-testid="created-list">Already created: {state.created.map(describeItem).join('; ')}.</Text>
            : <Text>Nothing was created.</Text>}
          {rolled && <Text data-testid="rollback-result">Rolled back: {rolled.deleted.length} deleted{rolled.failed.length ? `; FAILED: ${rolled.failed.map((f) => `${describeItem(f.item)} (${f.error})`).join('; ')}` : ''}.</Text>}
          {state.created.length > 0 && <Button variant="negative" isPending={busy} onPress={rollback}>Roll back created items</Button>}
        </div>
      </Content>
    </InlineAlert>
  );
}

function useSnapshot(site: SiteRef) {
  const [snap, setSnap] = useState<SiteSnapshot | null>(null);
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!site.org || !site.site) return;
    try { setError(null); const [s, k] = await Promise.all([loadSnapshot(site), loadKeyList(site)]); setSnap(s); setKeys(k); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unknown error'); }
  }, [site]);
  useEffect(() => { void reload(); }, [reload]);
  return { snap, keys, error, reload };
}

function QuickSetup({ site }: { site: SiteRef }) {
  const { snap, error, reload } = useSnapshot(site);
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState<RunState | null>(null);
  const [rolled, setRolled] = useState<RollbackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ keyId: string; exp: string | null; secretId: string; webhookId: string } | null>(null);
  const run = useRef<WizardRun | null>(null);
  useEffect(() => () => run.current?.cancel(), []);
  const { webhookUrl, loaded } = useSettings();
  const existing = snap && webhookUrl ? findConfiguredWebhook(snap.webhooks, webhookUrl) : undefined;
  const limit = snap ? webhookLimitReached(snap.webhooks.length) : false;
  const running = !!state && !state.finished;

  const start = async () => {
    if (!webhookUrl) return;
    setConfirm(false); setRolled(null); setSummary(null);
    const r = new WizardRun(flowClient, site, labelHooks(site), setState, { quick: true });
    run.current = r;
    const st = await r.run({ keyDescription: KEY_DESCRIPTION_PRESET, label: '', url: webhookUrl ?? '' });
    if (st.ok) setSummary({ keyId: r.keyId ?? '', exp: r.keyExpiration, secretId: r.secretId ?? '', webhookId: st.created.find((c) => c.kind === 'webhook')?.id ?? '' });
    void reload();
  };
  const rollback = async () => {
    setBusy(true);
    try { setRolled(await run.current!.rollbackAll()); } catch (e) { bad(mutationError(e, 'roll back')); } finally { setBusy(false); void reload(); }
  };
  const reset = () => { run.current?.cancel(); run.current = null; setState(null); setRolled(null); setSummary(null); };
  const expText = summary?.exp ? new Date(summary.exp).toLocaleDateString() : 'unknown (check the API keys tab)';

  return (
    <div className={col} data-testid="quick-setup">
      {error && <InlineAlert variant="negative"><Heading>Could not load site</Heading><Content>{error}</Content></InlineAlert>}
      {!state && existing && (
        <InlineAlert variant="positive" ><Heading>Already configured</Heading>
          <Content><span data-testid="quick-configured">Webhook {existing.id} → secret {secretDisplay(existing.secretId, snap?.labels[existing.secretId])}. Use Rotate to renew the key; the full Setup below stays available.</span></Content></InlineAlert>
      )}
      {!state && snap && !existing && (
        <>
          <Heading level={3}>Quick setup</Heading>
          {loaded && !webhookUrl && <EndpointNotice />}
          <Text>One click: creates a view key, a secret holding it and the Content AI reindex webhook for {site.org}/{site.site}.</Text>
          {limit && <InlineAlert variant="notice"><Heading>Webhook limit reached</Heading><Content>This site already has {MAX_WEBHOOKS} webhooks (maximum). Delete one first.</Content></InlineAlert>}
          <div className={rowS}><Button variant="accent" isDisabled={!webhookUrl || !site.org || !site.site || limit} onPress={() => setConfirm(true)}>Quick setup</Button></div>
        </>
      )}
      <DialogContainer onDismiss={() => setConfirm(false)}>
        {confirm && (
          <Dialog>
            <Heading slot="title">Run quick setup?</Heading>
            <Content>
              <div className={col}>
                <Text>Site: {site.org}/{site.site}</Text>
                <Text>Will create: (1) API key, role view, “{KEY_DESCRIPTION_PRESET}”; (2) a secret holding the key value, labelled “webhook log reader (key …)”; (3) a webhook to {webhookUrl}.</Text>
                <Text>On failure everything created is rolled back.</Text>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={() => setConfirm(false)}>Cancel</Button>
              <Button variant="accent" onPress={start}>Create</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
      {state && <Stepper state={state} />}
      {state && <Outcome state={state} rollback={rollback} rolled={rolled} busy={busy} okText="Quick setup complete." />}
      {summary && (
        <div className={col} data-testid="quick-summary">
          <Text>API key {summary.keyId} (expires {expText}); secret {summary.secretId}; webhook {summary.webhookId}.</Text>
          <Text>Reminder: the key expires on {expText}. Use the Rotate tab to renew it before then.</Text>
        </div>
      )}
      {state && <div className={rowS}>
        {running && <Button variant="secondary" onPress={() => run.current?.cancel()}>Cancel</Button>}
        {state.finished && <Button variant="secondary" onPress={reset}>Done</Button>}
      </div>}
    </div>
  );
}

function SetupWizard({ site }: { site: SiteRef }) {
  const { snap, error, reload } = useSnapshot(site);
  const [desc, setDesc] = useState(KEY_DESCRIPTION_PRESET);
  const [label, setLabel] = useState('webhook log reader');
  const { webhookUrl: configured, loaded, save: saveEndpoint } = useSettings();
  const [url, setUrl] = useState('');
  useEffect(() => { if (configured) setUrl((u) => u || configured); }, [configured]);
  const [state, setState] = useState<RunState | null>(null);
  const [rolled, setRolled] = useState<RollbackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef<WizardRun | null>(null);
  useEffect(() => () => run.current?.cancel(), []); // key value is cleared when the wizard goes away
  const urlError = validateHttpsUrl(url);
  const limit = snap ? webhookLimitReached(snap.webhooks.length) : false;
  const running = !!state && !state.finished;

  const start = async () => {
    const r = new WizardRun(flowClient, site, labelHooks(site), setState);
    run.current = r; setRolled(null);
    await r.run({ keyDescription: desc.trim(), label: label.trim() || 'webhook log reader', url: url.trim() });
    if (!configured) await saveEndpoint(url);
    void reload();
  };
  const rollback = async () => {
    setBusy(true);
    try { setRolled(await run.current!.rollbackAll()); } catch (e) { bad(mutationError(e, 'roll back')); } finally { setBusy(false); void reload(); }
  };
  const reset = () => { run.current?.cancel(); run.current = null; setState(null); setRolled(null); };

  return (
    <div className={col}>
      <Heading level={3}>Full setup</Heading>
      <Text>Creates a view key, probes the log with it, stores it as a labelled secret and registers the Content AI reindex webhook. The key value stays in memory only for this run.</Text>
      {error && <InlineAlert variant="negative"><Heading>Could not load site</Heading><Content>{error}</Content></InlineAlert>}
      {limit && <InlineAlert variant="notice"><Heading>Webhook limit reached</Heading><Content>This site already has {MAX_WEBHOOKS} webhooks (maximum). Delete one before running the wizard.</Content></InlineAlert>}
      {!state && (
        <>
          <TextField label="Key description" value={desc} onChange={setDesc} />
          <TextField label="Secret label (stored locally)" value={label} onChange={setLabel} />
          <TextField label="Webhook endpoint URL" description={configured ? undefined : 'Saved to Settings when you start.'} value={url} onChange={setUrl} isInvalid={!!urlError} errorMessage={urlError ?? undefined} />
          <div className={rowS}><Button variant="accent" isDisabled={!site.org || !site.site || limit || !!urlError || !desc.trim() || !snap} onPress={start}>Start setup</Button></div>
        </>
      )}
      {state && <Stepper state={state} />}
      {state && <Outcome state={state} rollback={rollback} rolled={rolled} busy={busy} okText={`Webhook registered. Created: ${state.created.map(describeItem).join('; ')}.`} />}
      {state && <div className={rowS}>
        {running && <Button variant="secondary" onPress={() => run.current?.cancel()}>Cancel</Button>}
        {state.finished && <Button variant="secondary" onPress={reset}>Start over</Button>}
      </div>}
    </div>
  );
}

function RotateSection({ site }: { site: SiteRef }) {
  const { snap, error, reload } = useSnapshot(site);
  const [webhookId, setWebhookId] = useState<string | null>(null);
  const [desc, setDesc] = useState(KEY_DESCRIPTION_PRESET);
  const [label, setLabel] = useState('');
  const [state, setState] = useState<RunState | null>(null);
  const [rolled, setRolled] = useState<RollbackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef<RotationRun | null>(null);
  useEffect(() => () => run.current?.cancel(), []);
  const hook = snap?.webhooks.find((w) => w.id === webhookId);
  const oldLabel = hook ? snap?.labels[hook.secretId] : undefined;

  const pick = (id: string) => {
    setWebhookId(id);
    const h = snap?.webhooks.find((w) => w.id === id);
    const l = h ? snap?.labels[h.secretId] : undefined;
    setLabel(`${l?.name ?? 'log reader'} ${isoDay()}`);
  };
  const start = async () => {
    if (!hook) return;
    const r = new RotationRun(flowClient, site, labelHooks(site), setState);
    run.current = r; setRolled(null);
    await r.run({ webhookId: hook.id, webhookUrl: hook.url, oldSecretId: hook.secretId, oldSecretName: oldLabel?.name, keyDescription: desc.trim(), label: label.trim() });
    void reload();
  };
  const rollback = async () => {
    setBusy(true);
    try { setRolled(await run.current!.rollbackAll()); } catch (e) { bad(mutationError(e, 'roll back')); } finally { setBusy(false); void reload(); }
  };
  const reset = () => { run.current?.cancel(); run.current = null; setState(null); setRolled(null); setWebhookId(null); };

  return (
    <div className={col}>
      <Text>Blue/green rotation: a new view key and a NEW secret are created, then the webhook is switched to it. The old secret and old key are not touched; remove them later in Cleanup.</Text>
      {error && <InlineAlert variant="negative"><Heading>Could not load site</Heading><Content>{error}</Content></InlineAlert>}
      {!state && (
        <>
          <Picker label="Webhook to rotate" items={snap?.webhooks ?? []} value={webhookId} onChange={(k) => pick(k as string)}
            placeholder={snap?.webhooks.length === 0 ? 'No webhooks' : 'Select a webhook'} isDisabled={!snap?.webhooks.length}>
            {(w) => <PickerItem id={w.id}>{`${w.id} → ${w.secretId ? secretDisplay(w.secretId, snap?.labels[w.secretId]) : 'no secret'}`}</PickerItem>}
          </Picker>
          {hook && <Text data-testid="rotate-current">Current: {hook.url} using secret {secretDisplay(hook.secretId, oldLabel)}{oldLabel?.keyId ? `, key ${oldLabel.keyId}` : ' (linked key unknown)'}</Text>}
          <TextField label="New key description" value={desc} onChange={setDesc} />
          <TextField label="New secret label" value={label} onChange={setLabel} />
          <div className={rowS}><Button variant="accent" isDisabled={!hook?.secretId || !desc.trim() || !label.trim()} onPress={start}>Start rotation</Button></div>
        </>
      )}
      {state && <Stepper state={state} />}
      {state && <Outcome state={state} rollback={rollback} rolled={rolled} busy={busy} okText="Webhook now uses the new secret. Old secret and key are untouched: delete them in Cleanup once you are happy." />}
      {state?.finished && <Button variant="secondary" onPress={reset}>Start over</Button>}
    </div>
  );
}

function CleanupSecret({ site, row, keys, onDone }: { site: SiteRef; row: ReturnType<typeof unusedSecrets>[number]; keys: ApiKeyRow[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [extraKey, setExtraKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linked = row.key;
  const keyIdToDelete = linked?.id ?? extraKey ?? undefined;
  const close = () => { setOpen(false); setExtraKey(null); };
  const submit = async () => {
    setBusy(true);
    const r = await deleteUnusedSecret(flowClient, site, row.secret.id, keyIdToDelete, labelHooks(site));
    setBusy(false);
    if (r.error) bad(`Cleanup incomplete: ${r.error}${r.secretDeleted ? ' (secret was deleted, key was not)' : ''}`); else ok(r.keyDeleted ? 'Secret and key deleted' : 'Secret deleted');
    close(); await onDone();
  };
  return (
    <>
      <Button variant="negative" fillStyle="outline" size="S" onPress={() => setOpen(true)}>Delete…</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Delete unused secret{keyIdToDelete ? ' and key' : ''}?</Heading>
            <Content>
              <div className={col}>
                <Text>Secret: {secretDisplay(row.secret.id, row.label)}</Text>
                {linked && <Text>Linked key: {linked.id} ({linked.description || 'no description'}){linked.expiration ? `, expires ${new Date(linked.expiration).toLocaleDateString()}` : ''} — will be deleted too.</Text>}
                {row.keyId && !linked && <Text>Linked key {row.keyId} no longer exists.</Text>}
                {!row.keyId && (
                  <Picker label="Also delete a key (optional; link unknown)" items={keys} value={extraKey} onChange={(k) => setExtraKey(k as string)} placeholder="Delete secret only">
                    {(k) => <PickerItem id={k.id}>{`${k.description || 'no description'} (${k.id.slice(0, 8)}…, ${k.roles.join('/')})`}</PickerItem>}
                  </Picker>
                )}
                <Text>This cannot be undone.</Text>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="negative" isPending={busy} onPress={submit}>Delete</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

function CleanupSection({ site }: { site: SiteRef }) {
  const { snap, keys, error, reload } = useSnapshot(site);
  const unused = snap && keys ? unusedSecrets(snap.secrets, snap.webhooks, snap.labels, keys) : [];
  const expired = keys ? expiredKeys(keys) : [];
  return (
    <div className={col}>
      <Text>Nothing is deleted automatically; every deletion asks for confirmation.</Text>
      <div className={rowS}><Button variant="secondary" onPress={reload}>Refresh</Button></div>
      {error && <InlineAlert variant="negative"><Heading>Could not load site</Heading><Content>{error}</Content></InlineAlert>}
      <Heading level={3}>Unused secrets (no webhook references them)</Heading>
      {snap && unused.length === 0 && <Text>None.</Text>}
      {unused.map((r) => (
        <div key={r.secret.id} className={rowS} data-testid="unused-secret">
          <Text>{secretDisplay(r.secret.id, r.label)} · created {r.secret.created ? new Date(r.secret.created).toLocaleDateString() : '—'} · key: {r.key ? `${r.key.id.slice(0, 8)}… ${r.key.expiration ? `(expires ${new Date(r.key.expiration).toLocaleDateString()})` : '(no expiry)'}` : r.keyId ? `${r.keyId.slice(0, 8)}… (gone)` : 'unknown'}</Text>
          <CleanupSecret site={site} row={r} keys={keys ?? []} onDone={reload} />
        </div>
      ))}
      <Heading level={3}>Expired API keys</Heading>
      {keys && expired.length === 0 && <Text>None.</Text>}
      {expired.map((k) => (
        <div key={k.id} className={rowS} data-testid="expired-key">
          <Text>{k.description || 'no description'} ({k.id.slice(0, 8)}…) · expired {new Date(k.expiresAt as number).toLocaleDateString()}</Text>
          <DeleteKeyButton site={site} row={k} rows={keys} onDone={reload} />
        </div>
      ))}
    </div>
  );
}

export function Wizard({ site }: { site: SiteRef }) {
  return (
    <Tabs aria-label="Wizard sections">
      <TabList>
        <Tab id="setup">Content AI setup</Tab>
        <Tab id="rotate">Rotate</Tab>
        <Tab id="cleanup">Cleanup</Tab>
      </TabList>
      <TabPanel id="setup"><div className={col + ' ' + panel}><QuickSetup site={site} /><SetupWizard site={site} /></div></TabPanel>
      <TabPanel id="rotate"><div className={panel}><RotateSection site={site} /></div></TabPanel>
      <TabPanel id="cleanup"><div className={panel}><CleanupSection site={site} /></div></TabPanel>
    </Tabs>
  );
}
