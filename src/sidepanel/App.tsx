import { useEffect, useMemo, useState } from 'react';
import {
  Provider, TextField, Switch, Tabs, TabList, Tab, TabPanel, ToastContainer, InlineAlert, Heading, Content, Button, Link, ProgressCircle, Text,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { orgSiteFromUrl } from '../lib/tabs';
import { installRelayTransport } from '../api/relayTransport';
import { checkAccess, ACCESS_DOCS_URL, type AccessResult } from '../api/adminClient';
import { accessMessage } from '../lib/access';
import { ApiKeysTab, SecretsTab, WebhooksTab } from './Tabs';
import { Wizard } from './Wizard';
import { SettingsProvider, useSettings } from './settings';

const column = style({ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 });
const row = style({ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'end' });

function SettingsButton() {
  const { openSettings } = useSettings();
  return <Button variant="secondary" size="S" aria-label="Settings" onPress={openSettings}>Settings</Button>;
}

export function App() {
  const [org, setOrg] = useState('');
  const [site, setSite] = useState('');
  const [follow, setFollow] = useState(true);
  const ref = useMemo(() => ({ org, site }), [org, site]);

  useEffect(() => { installRelayTransport(); }, []);

  // Upfront access check: runs on org/site change and on Re-check; guards against stale responses.
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!org || !site) { setAccess(null); return undefined; }
    let live = true;
    setAccess(null);
    void checkAccess({ org, site }).then((r) => { if (live) setAccess(r); });
    return () => { live = false; };
  }, [org, site, nonce]);
  const checking = !!org && !!site && access === null;
  const allowed = access?.state === 'admin';
  const msg = access && !allowed ? accessMessage(access, { org, site }) : null;

  useEffect(() => {
    if (!follow) return undefined;
    let last = '';
    const refresh = async () => {
      const win = await chrome.windows.getLastFocused().catch(() => undefined);
      const [tab] = await chrome.tabs.query({ active: true, windowId: win?.id });
      const d = orgSiteFromUrl(tab?.url);
      if (!d) return; // not da.live: keep last values
      const key = `${d.org}/${d.site}`;
      if (key === last) return; // override only when the detected org/site changes
      last = key;
      if (d.org) setOrg(d.org);
      if (d.site) setSite(d.site);
    };
    const onUpdated = (_id: number, info: { url?: string; status?: string }) => {
      if (info.url || info.status === 'complete') void refresh();
    };
    const onChange = () => { void refresh(); };
    chrome.tabs.onActivated.addListener(onChange);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onChange);
    void refresh();
    return () => {
      chrome.tabs.onActivated.removeListener(onChange);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onChange);
    };
  }, [follow]);

  // Provider without colorScheme follows the system (light-dark) setting.
  return (
    <Provider background="base">
      <SettingsProvider>
      <ToastContainer />
      <div className={column}>
        <div className={row}>
          <TextField label="Org" value={org} onChange={setOrg} />
          <TextField label="Site" value={site} onChange={setSite} />
        </div>
        <div className={row}><Switch isSelected={follow} onChange={setFollow}>Follow active da.live tab</Switch><SettingsButton /></div>
        {checking && <ProgressCircle isIndeterminate aria-label="Checking access" size="S" />}
        {allowed && access?.roles?.length ? <Text>Your roles: {access.roles.join(', ')}</Text> : null}
        {msg && (
          <InlineAlert variant={msg.variant}>
            <Heading>{msg.title}</Heading>
            <Content>
              <div className={column}>
                <Text>{msg.body}</Text>
                {access?.state === 'no-admin' && <Link href={ACCESS_DOCS_URL} target="_blank">About roles and permissions</Link>}
                <div><Button variant="secondary" onPress={() => setNonce((n) => n + 1)}>Re-check</Button></div>
              </div>
            </Content>
          </InlineAlert>
        )}
        <Tabs aria-label="Admin API sections" isDisabled={!allowed}>
          <TabList>
            <Tab id="keys">API Keys</Tab>
            <Tab id="secrets">Secrets</Tab>
            <Tab id="webhooks">Webhooks</Tab>
            <Tab id="wizard">Wizard</Tab>
          </TabList>
          <TabPanel id="keys">{allowed && <ApiKeysTab site={ref} />}</TabPanel>
          <TabPanel id="secrets">{allowed && <SecretsTab site={ref} />}</TabPanel>
          <TabPanel id="webhooks">{allowed && <WebhooksTab site={ref} />}</TabPanel>
          <TabPanel id="wizard">{allowed && <Wizard site={ref} />}</TabPanel>
        </Tabs>
      </div>
      </SettingsProvider>
    </Provider>
  );
}
