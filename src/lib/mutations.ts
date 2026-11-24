import { AdminApiError } from '../api/adminClient';
import type { ApiKeyRow } from './normalize';
import { secretDisplay, type LabelMap } from './labels';

/** Roles selectable for new API keys (https://www.aem.live/docs/roles-permissions). */
export const ROLE_OPTIONS = [
  { id: 'view', label: 'view', hint: 'Read-only' },
  { id: 'author', label: 'author', hint: 'Preview, edit, index, jobs' },
  { id: 'publish', label: 'publish', hint: 'Publish live content' },
  { id: 'develop', label: 'develop', hint: 'Code sync' },
  { id: 'config', label: 'config', hint: 'Read redacted config' },
  { id: 'config_admin', label: 'config_admin', hint: 'Manage config' },
  { id: 'admin', label: 'admin', hint: 'All permissions' },
] as const;
export const DEFAULT_ROLES = ['view'];

/** True if deleting `id` would remove the only key that has the admin role. */
export function isLastAdminKey(rows: ApiKeyRow[], id: string): boolean {
  const target = rows.find((r) => r.id === id);
  if (!target?.roles.includes('admin')) return false;
  return !rows.some((r) => r.id !== id && r.roles.includes('admin'));
}

export function validateHttpsUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || !u.hostname) return 'URL must start with https://';
    return null;
  } catch {
    return 'Enter a valid https:// URL';
  }
}

/** Friendly message for a failed mutation; never includes request bodies or secrets. */
export function mutationError(e: unknown, action: string): string {
  if (e instanceof AdminApiError) {
    if (e.status === 400) return `Could not ${action}: the Admin API rejected the request (400). Check the values.`;
    if (e.status === 409) return `Could not ${action}: it conflicts with existing config (409).`;
    if (e.status === 405 || e.status === 501) return `Could not ${action}: the Admin API does not support this update (${e.status}).`;
    if (e.status === 429) return `Could not ${action}: rate limited (429). Try again shortly.`;
    return `Could not ${action}. ${e.message}`;
  }
  return `Could not ${action}. ${e instanceof Error ? e.message : 'Unknown error'}`;
}

/** Pull the one-time key value out of a create response. */
export function extractKeyValue(res: unknown): string | null {
  if (typeof res !== 'object' || res === null) return null;
  const o = res as Record<string, unknown>;
  return typeof o.value === 'string' && o.value ? o.value : null;
}

/**
 * One-time secret holder: the value lives only here (React state), is returned
 * once via `take`, and is dropped on `clear`. Never logged or persisted.
 */
export interface RevealState { value: string | null }
export const revealReducer = (_s: RevealState, a: { type: 'show'; value: string } | { type: 'clear' }): RevealState =>
  a.type === 'show' ? { value: a.value } : { value: null };

/** Secret-value dialog state: the value lives only in React state and is dropped on close. */
export interface SecretDraft { value: string }
export const emptySecretDraft = (): SecretDraft => ({ value: '' });
export const secretDraftReducer = (_s: SecretDraft, a: { type: 'set'; value: string } | { type: 'clear' }): SecretDraft =>
  a.type === 'set' ? { value: a.value } : emptySecretDraft();

/** Picker options for webhook secrets: 'label (id-prefix…)' when labelled; current secret is marked. */
export function secretChoices(secrets: { id: string }[], currentId: string, labels: LabelMap = {}): { id: string; label: string }[] {
  return secrets.map((s) => {
    const d = secretDisplay(s.id, labels[s.id]);
    return { id: s.id, label: s.id === currentId ? `${d} (current)` : d };
  });
}
