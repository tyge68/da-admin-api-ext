import { ADMIN_HOST, AdminApiError, setLogProbe, setTransport, type LogProbe, type Transport } from './adminClient';
import type { AdminFetchRes, Msg } from '../lib/messages';

export const RELAY_MESSAGES = {
  'no-tab': 'No da.live tab found. Open da.live (signed in) and try again.',
  'no-token': 'Could not find a da.live sign-in token. Reload da.live and sign in.',
  expired: 'Your da.live token expired. Reload da.live, then Refresh.',
  network: 'Network error contacting the Admin API.',
} as const;

type Send = (m: Msg) => Promise<AdminFetchRes | undefined>;

/** Transport that relays through the background worker; the token never reaches the side panel. */
export function makeRelayTransport(send: Send = (m) => chrome.runtime.sendMessage(m)): Transport {
  return async (url, init) => {
    const res = await send({
      type: 'ADMIN_FETCH',
      method: init.method ?? 'GET',
      path: url.startsWith(ADMIN_HOST) ? url.slice(ADMIN_HOST.length) : url,
      body: typeof init.body === 'string' ? init.body : undefined,
    });
    if (!res) throw new AdminApiError(0, RELAY_MESSAGES.network);
    if (!res.ok) {
      throw new AdminApiError(res.error === 'expired' || res.error === 'no-token' ? 401 : 0, RELAY_MESSAGES[res.error] ?? RELAY_MESSAGES.network, res.error !== 'network');
    }
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      text: async () => (res.json === undefined ? '' : JSON.stringify(res.json)),
    };
  };
}

/** Log probe via the background worker; the key travels only in this one message. */
export function makeRelayProbe(send: Send = (m) => chrome.runtime.sendMessage(m)): LogProbe {
  return async (ref, key) => {
    const res = await send({ type: 'PROBE_LOG', org: ref.org, site: ref.site, key });
    if (!res) throw new AdminApiError(0, RELAY_MESSAGES.network);
    if (!res.ok) throw new AdminApiError(0, RELAY_MESSAGES.network);
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: res.statusText,
      text: async () => (res.json === undefined ? '' : JSON.stringify(res.json)),
    };
  };
}

export const installRelayTransport = () => { setTransport(makeRelayTransport()); setLogProbe(makeRelayProbe()); };
