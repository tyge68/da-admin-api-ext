import type { AdminFetchRes, Msg } from '../lib/messages';
import { injectedReadToken, type TokenResult } from '../lib/ims';
import { orderDaTabs } from '../lib/tabs';
import { adminFetch, probeLogFetch } from '../lib/relay';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

/** Read the token straight from a da.live tab via scripting (works without reload). null = no tab. */
async function getToken(): Promise<TokenResult | null> {
  const win = await chrome.windows.getLastFocused().catch(() => undefined);
  const tabs = orderDaTabs(await chrome.tabs.query({ url: 'https://da.live/*' }), win?.id);
  let best: TokenResult | null = null;
  for (const tab of tabs) {
    try {
      const [inj] = await chrome.scripting.executeScript({ target: { tabId: tab.id as number }, func: injectedReadToken });
      const r = inj?.result as TokenResult | undefined;
      if (!r) continue;
      if ('token' in r) return r;
      best = best && 'error' in best && best.error === 'expired' ? best : r;
    } catch { /* tab not scriptable (discarded/loading) */ }
  }
  return best;
}

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg?.type === 'PROBE_LOG') {
    probeLogFetch(msg, (u, i) => fetch(u, i))
      .then(sendResponse)
      .catch((): void => sendResponse({ ok: false, error: 'network', message: 'fetch failed' } satisfies AdminFetchRes));
    return true;
  }
  if (msg?.type !== 'ADMIN_FETCH') return false;
  adminFetch(msg, { getToken, fetchImpl: (u, i) => fetch(u, i) })
    .then(sendResponse)
    .catch((e): void => sendResponse({ ok: false, error: 'network', message: String(e?.message ?? e) } satisfies AdminFetchRes));
  return true;
});
