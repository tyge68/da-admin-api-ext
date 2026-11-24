# da-admin-api-ext

Chrome MV3 side-panel extension to manage AEM (aem.live) Admin API keys, secrets and webhooks for a da.live site (org/site detected from `https://da.live/#/{org}/{site}`).

## Build
```
npm install
npm run build     # typecheck + builds into dist/
npm test          # vitest
```
Stack: Vite, React 19, TypeScript, [React Spectrum S2](https://react-spectrum.adobe.com/) (`@react-spectrum/s2`, style macros via `unplugin-parcel-macros`).
Build = Vite (side panel) + two IIFE builds (content script, service worker).

Requires Node 18+.

## Concept
EDS (aem.live) can call a **webhook** on publish events ([docs](https://www.aem.live/developer/webhook)). A typical use is a *webhook endpoint* (e.g. a Content AI reindex service) that receives these events and reads the site's log from the Admin API with the caller's `view` API key, sent as the webhook secret. Setting that up by hand means creating an API key, copying its value into a secret, and creating a webhook. This extension does it from the da.live side panel:

- **Quick setup**: `view` key → secret holding it → webhook pointing at your endpoint (all rolled back on failure).
- **Rotation** (blue/green): new key + new secret, repoint the webhook; old items stay until you clean them up.
- **Cleanup**: delete unused secrets together with their key, and expired keys, each after confirmation.

## Settings: webhook endpoint URL
Open **Settings** in the panel header and enter your **Webhook endpoint URL** (https only, validated). It is stored in `chrome.storage.sync` under `settings` (`{webhookUrl}`) and is used by Quick setup, as the default URL for new webhooks, and for "Already configured" detection (any webhook whose URL equals it). If it is empty, Quick setup shows "Set your webhook endpoint URL first" with a Settings button and is disabled; the Setup wizard asks for the URL inline and saves it. Logic: `src/lib/settings.ts`.

## Secret labels
The Admin API returns only `{id, type, created, lastModified}` for secrets (no description). The extension keeps a local label `{name, note?, keyId?}` per secret in `chrome.storage.sync` under `labels:{org}/{site}` (labels only, never secret values or keys; `keyId` = id of the API key whose value the secret holds, set when the wizard/rotation create both). Labels of secrets that no longer exist are dropped on refresh. Logic: `src/lib/labels.ts` (pure + `LabelStore` interface, chrome adapter).

## Wizard tab
**Quick setup** (top of the Content AI setup tab): shown when no webhook points at the configured endpoint URL; one confirmation, then view key → secret (labelled `webhook log reader (key <id prefix>)`) → webhook → verify, with the same rollback. Shows key expiration and points to Rotate. Otherwise shows "Already configured". Implemented as `WizardRun` with `{quick: true}`.

- **Content AI setup**: create `view` key → probe `GET api.aem.live/{org}/sites/{site}/log?since=15m` with it → create labelled secret `{value: key}` → register webhook → verify in site config. Max 2 webhooks per site. On failure it stops, lists created ids and offers *Roll back created items* (reverse order).
- **Rotate** (blue/green): new key → probe → NEW secret + label → switch webhook to it (`POST webhooks/{id}.json`) → verify. Old secret/key are untouched. On failure the webhook is repointed to the old secret before the new secret and key are deleted.
- **Cleanup**: unused secrets (no webhook) with linked key, delete secret + key together after confirmation; expired keys. Nothing is deleted automatically.
- The new key value lives only in memory during a run (cleared at end/failure/cancel) and reaches the log endpoint only via the background `PROBE_LOG` message (fixed URL, GET, `x-auth-token`; never stored/logged).

## Verification status
Verified against the real Admin API (2026-11-24, by the user): create/delete of keys, secrets, webhooks; `POST secrets/{id}.json {value}`; `POST webhooks/{id}.json {url, secretId}`. The wizard/rotation/cleanup flows and label UI are verified only against a mocked Admin API. Roles: no `basic_author`/`basic_publish` exist in https://www.aem.live/docs/roles-permissions (roles: admin, author, config, config_admin, develop, publish, view).

## Install
- **Release zip**: download the zip from the GitHub Releases page, unzip it, then follow *Load unpacked* below and select the unzipped folder.
- **From source**: `npm install && npm run build`, then load `dist/`.

### Load unpacked
1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the folder containing `manifest.json` (`dist/` when built from source).
3. Open a da.live site, click the extension icon, then open **Settings** and set the webhook endpoint URL.

## Security notes
- An API key value is shown once (on creation) and held in memory only; it is never written to storage or logged. It is sent only to the secrets endpoint and to the log probe (`GET api.aem.live/.../log`).
- `chrome.storage.sync` holds only labels (`labels:{org}/{site}`: name, note, linked key id) and the `settings` endpoint URL. No tokens, key values or secret values.
- The IMS token is read from da.live and stays in the background service worker.

## Permissions
- `sidePanel`: the UI. `storage`: labels and settings. `tabs`: follow the active da.live tab to pick org/site. `scripting`: read the da.live sign-in token from the page.
- Hosts: `admin.hlx.page` and `api.aem.live` (Admin API), `da.live` (token and org/site).

## Notes
- Admin client: `src/api/adminClient.ts`.
