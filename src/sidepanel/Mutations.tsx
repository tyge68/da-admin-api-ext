import { useReducer, useState, type ReactNode } from 'react';
import {
  AlertDialog, Button, ButtonGroup, Checkbox, CheckboxGroup, Content, Dialog, DialogContainer,
  Heading, InlineAlert, Picker, PickerItem, Text, TextField, ToastQueue,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  addWebhook, createApiKey, createSecret, deleteApiKey, deleteSecret, deleteWebhook, updateSecret, updateWebhook, type SiteRef,
} from '../api/adminClient';
import {
  DEFAULT_ROLES, ROLE_OPTIONS, extractKeyValue, isLastAdminKey, mutationError, revealReducer, secretChoices, secretDraftReducer, emptySecretDraft, validateHttpsUrl,
} from '../lib/mutations';
import type { ApiKeyRow, SecretRow, WebhookRow } from '../lib/normalize';
import { secretDisplay, type LabelMap } from '../lib/labels';
import { saveLabel } from './siteData';
import { useSettings } from './settings';

const col = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const mono = style({ wordBreak: 'break-all', userSelect: 'all' });

const ok = (m: string) => ToastQueue.positive(m, { timeout: 5000 });
const bad = (m: string) => ToastQueue.negative(m, { timeout: 8000 });

/** Run a mutation with toasts; returns true on success. Never logs the error payload. */
async function run(action: string, doneMsg: string, fn: () => Promise<unknown>): Promise<boolean> {
  try { await fn(); ok(doneMsg); return true; } catch (e) { bad(mutationError(e, action)); return false; }
}

export function CreateKeyButton({ site, onDone }: { site: SiteRef; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [roles, setRoles] = useState<string[]>(DEFAULT_ROLES);
  const [busy, setBusy] = useState(false);
  // One-time key value: component state only; cleared on dismiss.
  const [reveal, dispatch] = useReducer(revealReducer, { value: null });

  const close = () => { setOpen(false); setDesc(''); setRoles(DEFAULT_ROLES); };
  const submit = async () => {
    setBusy(true);
    try {
      const res = await createApiKey(site, desc.trim(), roles);
      const value = extractKeyValue(res);
      close();
      if (value) dispatch({ type: 'show', value }); else bad('Key created, but the API returned no key value.');
      ok('API key created');
      await onDone();
    } catch (e) { bad(mutationError(e, 'create the API key')); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(reveal.value ?? ''); ok('Key copied to clipboard'); } catch { bad('Could not copy. Select the key and copy it manually.'); }
  };

  return (
    <>
      <Button variant="accent" onPress={() => setOpen(true)}>Create key</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Create API key</Heading>
            <Content>
              <div className={col}>
                <TextField label="Description" value={desc} onChange={setDesc} autoFocus />
                <CheckboxGroup label="Roles" value={roles} onChange={setRoles}>
                  {ROLE_OPTIONS.map((r) => <Checkbox key={r.id} value={r.id}>{r.label} – {r.hint}</Checkbox>)}
                </CheckboxGroup>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} isDisabled={busy || roles.length === 0} onPress={submit}>Create</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => dispatch({ type: 'clear' })}>
        {reveal.value !== null && (
          <Dialog isDismissible={false} isKeyboardDismissDisabled>
            <Heading slot="title">Copy your new API key</Heading>
            <Content>
              <div className={col}>
                <InlineAlert variant="notice">
                  <Heading>This key cannot be shown again</Heading>
                  <Content>Copy it now and store it safely. After you close this dialog it is gone for good; you would need to create a new key.</Content>
                </InlineAlert>
                <div className={mono} data-testid="one-time-key">{reveal.value}</div>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={copy}>Copy</Button>
              <Button variant="accent" slot="close" onPress={() => dispatch({ type: 'clear' })}>I have copied it, close</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

function ConfirmDelete(props: {
  label: string; title: string; children: ReactNode; warn?: boolean;
  action: () => Promise<boolean>; onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="negative" fillStyle="outline" size="S" onPress={() => setOpen(true)}>Delete</Button>
      <DialogContainer onDismiss={() => setOpen(false)}>
        {open && (
          <AlertDialog
            title={props.title}
            variant="destructive"
            primaryActionLabel="Delete"
            cancelLabel="Cancel"
            onPrimaryAction={async () => { if (await props.action()) await props.onDone(); }}
          >
            {props.children}
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}

export const DeleteKeyButton = ({ site, row, rows, onDone }: { site: SiteRef; row: ApiKeyRow; rows: ApiKeyRow[] | null; onDone: () => Promise<void> }) => {
  const last = isLastAdminKey(rows ?? [], row.id);
  return (
    <ConfirmDelete label="key" title="Delete API key?" action={() => run('delete the API key', 'API key deleted', () => deleteApiKey(site, row.id))} onDone={onDone}>
      {last && <><strong>This is the last API key with the admin role.</strong> Deleting it leaves no admin key for this site. </>}
      Anything using this key ({row.description || row.id.slice(0, 8)}) will stop working. This cannot be undone.
    </ConfirmDelete>
  );
};

export function CreateSecretButton({ site, onDone }: { site: SiteRef; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setValue(''); setLabel(''); };
  const submit = async () => {
    setBusy(true);
    const done = await run('create the secret', 'Secret created', async () => {
      const res = await createSecret(site, value || undefined) as { id?: unknown } | undefined;
      if (label.trim() && typeof res?.id === 'string') await saveLabel(site, res.id, { name: label });
    });
    setBusy(false);
    if (done) { close(); await onDone(); }
  };
  return (
    <>
      <Button variant="accent" onPress={() => setOpen(true)}>Create secret</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Create secret</Heading>
            <Content>
              <div className={col}>
                <TextField label="Label (stored locally, optional)" value={label} onChange={setLabel} autoFocus
                  description="The API returns no description for secrets, so the label is kept in this browser only (never the value)." />
                <TextField label="Value (optional)" type="password" value={value} onChange={setValue}
                  description="Leave empty to have a random secret generated. Values are never shown again." />
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} onPress={submit}>Create</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

export const DeleteSecretButton = ({ site, row, label, usedBy, onDone }: { site: SiteRef; row: SecretRow; label?: LabelMap[string]; usedBy: string[]; onDone: () => Promise<void> }) => (
  <ConfirmDelete label="secret" title="Delete secret?"
    action={() => run('delete the secret', 'Secret deleted', async () => { await deleteSecret(site, row.id); await saveLabel(site, row.id, null).catch(() => undefined); })} onDone={onDone}>
    <strong>{secretDisplay(row.id, label)}</strong>.{' '}
    {usedBy.length > 0 && <><strong>Still used by webhook{usedBy.length > 1 ? 's' : ''} {usedBy.join(', ')}.</strong> Deleting it breaks signature validation for {usedBy.length > 1 ? 'them' : 'it'}. </>}
    This cannot be undone.
  </ConfirmDelete>
);

export function EditLabelButton({ site, row, label, onDone }: { site: SiteRef; row: SecretRow; label?: LabelMap[string]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(false);
  const submit = async () => {
    setBusy(true);
    const done = await run('save the label', 'Label saved', () => saveLabel(site, row.id, name.trim() ? { ...label, name, note } : null));
    setBusy(false);
    if (done) { close(); await onDone(); }
  };
  return (
    <>
      <Button variant="secondary" size="S" onPress={() => { setName(label?.name ?? ''); setNote(label?.note ?? ''); setOpen(true); }}>Edit label</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Edit label</Heading>
            <Content>
              <div className={col}>
                <Text>Secret {row.id}. Labels are stored locally in this browser (chrome.storage.sync); the Admin API has no description for secrets. Empty name removes the label.</Text>
                <TextField label="Name" value={name} onChange={setName} autoFocus />
                <TextField label="Note" value={note} onChange={setNote} />
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} onPress={submit}>Save</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

export function AddWebhookButton({ site, secrets, labels, onDone }: { site: SiteRef; secrets: SecretRow[]; labels: LabelMap; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [secretId, setSecretId] = useState<string | null>(null);
  const { webhookUrl } = useSettings();
  const [url, setUrl] = useState(webhookUrl ?? '');
  const [busy, setBusy] = useState(false);
  const urlError = validateHttpsUrl(url);
  const close = () => { setOpen(false); setSecretId(null); setUrl(webhookUrl ?? ''); };
  const submit = async () => {
    if (!secretId || urlError) return;
    setBusy(true);
    const done = await run('add the webhook', 'Webhook added', () => addWebhook(site, secretId, url.trim()));
    setBusy(false);
    if (done) { close(); await onDone(); }
  };
  return (
    <>
      <Button variant="accent" onPress={() => { setUrl(webhookUrl ?? ''); setOpen(true); }}>Add webhook</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Add webhook</Heading>
            <Content>
              <div className={col}>
                <Picker label="Secret" items={secrets} value={secretId} onChange={(k) => setSecretId(k as string)}
                  placeholder={secrets.length ? 'Select a secret' : 'No secrets: create one first'} isDisabled={secrets.length === 0}>
                  {(s) => <PickerItem id={s.id}>{secretDisplay(s.id, labels[s.id])}</PickerItem>}
                </Picker>
                <TextField label="URL" value={url} onChange={setUrl} isInvalid={!!urlError} errorMessage={urlError ?? undefined} />
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} isDisabled={!secretId || !!urlError} onPress={submit}>Add</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

export const DeleteWebhookButton = ({ site, id, onDone }: { site: SiteRef; id: string; onDone: () => Promise<void> }) => (
  <ConfirmDelete label="webhook" title="Delete webhook?" action={() => run('delete the webhook', 'Webhook deleted', () => deleteWebhook(site, id))} onDone={onDone}>
    The endpoint will stop receiving events. This cannot be undone.
  </ConfirmDelete>
);

export function UpdateSecretButton({ site, row, onDone }: { site: SiteRef; row: SecretRow; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, dispatch] = useReducer(secretDraftReducer, undefined, emptySecretDraft);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); dispatch({ type: 'clear' }); };
  const submit = async () => {
    if (!draft.value) return;
    setBusy(true);
    const done = await run('update the secret', 'Secret value updated', () => updateSecret(site, row.id, draft.value));
    setBusy(false);
    if (done) { close(); await onDone(); }
  };
  return (
    <>
      <Button variant="secondary" size="S" onPress={() => setOpen(true)}>Update value</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Update secret value</Heading>
            <Content>
              <div className={col}>
                <Text>The secret id ({row.id}) stays the same, so webhooks referencing it keep working. Only the stored value is replaced, for example with a newly rotated Admin API key. The old value is overwritten and cannot be recovered.</Text>
                <TextField label="New value" type="password" value={draft.value} autoComplete="off"
                  onChange={(v) => dispatch({ type: 'set', value: v })} autoFocus />
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} isDisabled={busy || !draft.value} onPress={submit}>Update value</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}

export function ChangeWebhookSecretButton({ site, row, secrets, labels, onDone }: { site: SiteRef; row: WebhookRow; secrets: SecretRow[]; labels: LabelMap; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [secretId, setSecretId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(false); setSecretId(null); };
  const choices = secretChoices(secrets, row.secretId, labels);
  const unchanged = !secretId || secretId === row.secretId;
  const submit = async () => {
    if (!secretId || unchanged) return;
    setBusy(true);
    const done = await run('change the webhook secret', 'Webhook secret changed', () => updateWebhook(site, row.id, { secretId, url: row.url }));
    setBusy(false);
    if (done) { close(); await onDone(); }
  };
  return (
    <>
      <Button variant="secondary" size="S" onPress={() => { setSecretId(row.secretId || null); setOpen(true); }}>Change secret</Button>
      <DialogContainer onDismiss={close}>
        {open && (
          <Dialog>
            <Heading slot="title">Change webhook secret</Heading>
            <Content>
              <div className={col}>
                <Text>Webhook {row.id} keeps its id and URL ({row.url}); only the secret it sends changes.</Text>
                <Picker label="Secret" items={choices} value={secretId} onChange={(k) => setSecretId(k as string)}>
                  {(s) => <PickerItem id={s.id}>{s.label}</PickerItem>}
                </Picker>
              </div>
            </Content>
            <ButtonGroup>
              <Button variant="secondary" onPress={close}>Cancel</Button>
              <Button variant="accent" isPending={busy} isDisabled={busy || unchanged} onPress={submit}>Change secret</Button>
            </ButtonGroup>
          </Dialog>
        )}
      </DialogContainer>
    </>
  );
}
