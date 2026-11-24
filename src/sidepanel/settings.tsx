import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, ButtonGroup, Content, Dialog, DialogContainer, Heading, InlineAlert, Text, TextField } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { createChromeSettingsStore, parseSettings, saveWebhookUrl, SETTINGS_KEY, validateEndpointUrl } from '../lib/settings';

const col = style({ display: 'flex', flexDirection: 'column', gap: 12 });
const store = createChromeSettingsStore();

interface Ctx { webhookUrl: string | undefined; loaded: boolean; openSettings: () => void; save: (url: string) => Promise<string | null> }
const SettingsCtx = createContext<Ctx>({ webhookUrl: undefined, loaded: false, openSettings: () => {}, save: async () => null });
export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [webhookUrl, setUrl] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => { void store.load().then((s) => { setUrl(s.webhookUrl); setLoaded(true); }); }, []);
  useEffect(() => {
    const onChanged = (c: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && SETTINGS_KEY in c) setUrl(parseSettings(c[SETTINGS_KEY].newValue).webhookUrl);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  const save = useCallback(async (url: string) => {
    const err = await saveWebhookUrl(store, url);
    if (!err) setUrl(url.trim());
    return err;
  }, []);
  const value = useMemo(() => ({ webhookUrl, loaded, save, openSettings: () => setOpen(true) }), [webhookUrl, loaded, save]);
  return (
    <SettingsCtx.Provider value={value}>
      {children}
      <DialogContainer onDismiss={() => setOpen(false)}>
        {open && <SettingsDialog current={webhookUrl} save={save} close={() => setOpen(false)} />}
      </DialogContainer>
    </SettingsCtx.Provider>
  );
}

function SettingsDialog({ current, save, close }: { current: string | undefined; save: (u: string) => Promise<string | null>; close: () => void }) {
  const [url, setUrl] = useState(current ?? '');
  const [touched, setTouched] = useState(false);
  const err = validateEndpointUrl(url);
  const submit = async () => { if (!(await save(url))) close(); };
  return (
    <Dialog>
      <Heading slot="title">Settings</Heading>
      <Content>
        <div className={col}>
          <TextField label="Webhook endpoint URL" description="https only. Used by Quick setup and as the default for new webhooks."
            value={url} onChange={(v) => { setUrl(v); setTouched(true); }} isInvalid={touched && !!err} errorMessage={touched ? err ?? undefined : undefined} />
        </div>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={close}>Cancel</Button>
        <Button variant="accent" isDisabled={!!err} onPress={submit}>Save</Button>
      </ButtonGroup>
    </Dialog>
  );
}

/** Notice + button shown wherever an endpoint is required but not set. */
export function EndpointNotice() {
  const { openSettings } = useSettings();
  return (
    <InlineAlert variant="notice" >
      <Heading>Set your webhook endpoint URL first</Heading>
      <Content>
        <div className={col}>
          <Text>Quick setup and the Setup wizard register a webhook that points to your own endpoint.</Text>
          <div><Button variant="secondary" onPress={openSettings}>Settings</Button></div>
        </div>
      </Content>
    </InlineAlert>
  );
}
