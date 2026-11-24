import { Text } from '@react-spectrum/s2';
import type { SiteRef } from '../api/adminClient';
import { expiryState, type ApiKeyRow, type SecretRow, type WebhookRow } from '../lib/normalize';
import { secretDisplay, type Label, type LabelMap } from '../lib/labels';
import { loadKeyList, loadSnapshot } from './siteData';
import { DataTab, ExpiryBadge, type ColumnDef } from './DataTab';
import {
  AddWebhookButton, ChangeWebhookSecretButton, EditLabelButton, UpdateSecretButton, CreateKeyButton, CreateSecretButton, DeleteKeyButton, DeleteSecretButton, DeleteWebhookButton,
} from './Mutations';
import { useCallback, useMemo, useState } from 'react';

const act = 'actions';
const keyCols = (site: SiteRef): ColumnDef<ApiKeyRow>[] => [
  { id: 'id', name: 'ID', isRowHeader: true, render: (r) => <Text>{r.id}</Text> },
  { id: 'description', name: 'Description', render: (r) => <Text>{r.description || '—'}</Text> },
  { id: 'roles', name: 'Roles', render: (r) => <Text>{r.roles.join(', ') || '—'}</Text> },
  {
    id: 'expiration', name: 'Expiration',
    render: (r) => <ExpiryBadge state={expiryState(r.expiresAt)} label={r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : ''} />,
  },
  { id: act, name: '', render: (r, c) => <DeleteKeyButton site={site} row={r} rows={c.rows} onDone={c.refresh} /> },
];
type SecretView = SecretRow & { label?: Label; usedBy: string[] };
const fmtDate = (v: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toLocaleDateString() : v || '—');
const secretCols = (site: SiteRef): ColumnDef<SecretView>[] => [
  { id: 'label', name: 'Label', isRowHeader: true, render: (r) => <Text>{r.label ? (r.label.note ? `${r.label.name} — ${r.label.note}` : r.label.name) : '—'}</Text> },
  { id: 'id', name: 'Secret ID', render: (r) => <Text>{r.id}</Text> },
  { id: 'usedBy', name: 'Used by', render: (r) => <Text>{r.usedBy.length ? r.usedBy.join(', ') : 'unused'}</Text> },
  { id: 'type', name: 'Type', render: (r) => <Text>{r.type || '—'}</Text> },
  { id: 'created', name: 'Created', render: (r) => <Text>{fmtDate(r.created)}</Text> },
  { id: 'lastModified', name: 'Modified', render: (r) => <Text>{fmtDate(r.lastModified)}</Text> },
  { id: act, name: '', render: (r, c) => <><EditLabelButton site={site} row={r} label={r.label} onDone={c.refresh} /><UpdateSecretButton site={site} row={r} onDone={c.refresh} /><DeleteSecretButton site={site} row={r} label={r.label} usedBy={r.usedBy} onDone={c.refresh} /></> },
];
const hookCols = (site: SiteRef, secrets: SecretRow[], labels: LabelMap): ColumnDef<WebhookRow>[] => [
  { id: 'id', name: 'ID', isRowHeader: true, render: (r) => <Text>{r.id}</Text> },
  { id: 'url', name: 'URL', render: (r) => <Text>{r.url || '—'}</Text> },
  { id: 'secretId', name: 'Secret', render: (r) => <Text>{r.secretId ? secretDisplay(r.secretId, labels[r.secretId]) : '—'}</Text> },
  { id: act, name: '', render: (r, c) => <><ChangeWebhookSecretButton site={site} row={r} secrets={secrets} labels={labels} onDone={c.refresh} /><DeleteWebhookButton site={site} id={r.id} onDone={c.refresh} /></> },
];

const loadKeys = loadKeyList;

export const ApiKeysTab = ({ site }: { site: SiteRef }) => {
  const cols = useMemo(() => keyCols(site), [site]);
  return <DataTab label="API keys" site={site} load={loadKeys} columns={cols} emptyText="No API keys."
    toolbar={(c) => <CreateKeyButton site={site} onDone={c.refresh} />} />;
};
export const SecretsTab = ({ site }: { site: SiteRef }) => {
  const cols = useMemo(() => secretCols(site), [site]);
  const [pruned, setPruned] = useState(0);
  const load = useCallback(async (s: SiteRef): Promise<SecretView[]> => {
    const snap = await loadSnapshot(s);
    setPruned(snap.prunedLabels.length);
    return snap.secrets.map((x) => ({ ...x, label: snap.labels[x.id], usedBy: snap.usage[x.id] ?? [] }));
  }, []);
  return <DataTab label="secrets" site={site} load={load} columns={cols} emptyText="No secrets. (Values are never returned by the API.)"
    toolbar={(c) => <><CreateSecretButton site={site} onDone={c.refresh} />{pruned > 0 && <Text>Removed {pruned} orphan label{pruned > 1 ? 's' : ''} (secret no longer exists).</Text>}</>} />;
};
export const WebhooksTab = ({ site }: { site: SiteRef }) => {
  // Secrets + labels for the pickers come from the same snapshot as the webhooks list.
  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [labels, setLabels] = useState<LabelMap>({});
  const cols = useMemo(() => hookCols(site, secrets, labels), [site, secrets, labels]);
  const load = useCallback(async (s: SiteRef) => { const snap = await loadSnapshot(s); setSecrets(snap.secrets); setLabels(snap.labels); return snap.webhooks; }, []);
  return <DataTab label="webhooks" site={site} load={load} columns={cols} emptyText="No webhooks."
    toolbar={(c) => <AddWebhookButton site={site} secrets={secrets} labels={labels} onDone={c.refresh} />} />;
};
