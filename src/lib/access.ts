import type { AccessResult } from '../api/adminClient';

export interface Identity { email?: string; userId?: string }

/** Roles that may manage API keys, secrets and webhooks (config:write). Only `admin` is documented as holding all permissions;
 *  `config_admin`/`config` are read-oriented (config:read-redacted) and deliberately NOT included. */
export const MANAGE_ROLES = ['admin'];

export function identityFromProfile(json: unknown): Identity | null {
  const o = json as { profile?: Record<string, unknown> } & Record<string, unknown> | null | undefined;
  const p = (o && typeof o === 'object' && o.profile && typeof o.profile === 'object' ? o.profile : o) as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object') return null;
  const email = typeof p.email === 'string' && p.email ? p.email : undefined;
  const userId = typeof p.user_id === 'string' && p.user_id ? p.user_id : undefined;
  return email || userId ? { email, userId } : null;
}

/** Case-insensitive match of one role-list entry: exact, '*' (anyone) or a glob such as '*@adobe.com'. */
export function matchesEntry(entry: unknown, id: Identity): boolean {
  if (typeof entry !== 'string' || !entry) return false;
  const e = entry.trim().toLowerCase();
  const subjects = [id.email, id.userId].filter((x): x is string => !!x).map((x) => x.toLowerCase());
  if (e === '*') return true;
  if (!e.includes('*')) return subjects.includes(e);
  const re = new RegExp(`^${e.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return subjects.some((s) => re.test(s));
}

/** Role names (sorted) from `access.admin.role` whose list matches the identity. [] when undeterminable. */
export function rolesFor(config: unknown, id: Identity | null): string[] {
  if (!id) return [];
  const map = (config as { access?: { admin?: { role?: unknown } } } | null)?.access?.admin?.role;
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map as Record<string, unknown>)
    .filter(([, list]) => (Array.isArray(list) ? list : [list]).some((x) => matchesEntry(x, id)))
    .map(([r]) => r).sort();
}

/** Admin-only view: the full site config carries secrets/apiKeys/webhooks fields; redacted views do not. */
export function hasAdminOnlyFields(config: unknown): boolean {
  const c = config as Record<string, unknown> | null;
  return !!c && typeof c === 'object' && ['secrets', 'apiKeys', 'webhooks'].some((k) => k in c);
}

/**
 * Pure decision for a site whose config GET returned 200 (steps 1-2 are handled by the caller: no token / config denied).
 * 3 admin-only fields present => admin; 4 role list match: MANAGE_ROLES => admin, else no-admin listing roles;
 * 5 no roles determinable => apiKeys probe status: 200 => admin, anything else (incl. inconclusive 404) => no-admin.
 */
export function decideAccess(i: { config: unknown; identity: Identity | null; keysStatus?: number }): AccessResult {
  const roles = rolesFor(i.config, i.identity);
  const r = roles.length ? { roles } : {};
  if (hasAdminOnlyFields(i.config)) return { state: 'admin', detail: 'OK', ...r };
  if (roles.length) {
    return roles.some((x) => MANAGE_ROLES.includes(x)) ? { state: 'admin', detail: 'OK', roles } : { state: 'no-admin', detail: 'roles', roles };
  }
  if (i.keysStatus === 200) return { state: 'admin', detail: 'OK' };
  if (i.keysStatus === 404) return { state: 'no-admin', detail: 'inconclusive', inconclusive: true };
  return { state: 'no-admin', detail: String(i.keysStatus ?? 'unknown') };
}

export interface AccessMessage { variant: 'informative' | 'notice' | 'negative'; title: string; body: string }

/** User-facing copy for a non-admin access state (null for 'admin'). */
export function accessMessage(a: AccessResult, ref: { org: string; site: string }): AccessMessage | null {
  const name = `${ref.org}/${ref.site}`;
  switch (a.state) {
    case 'admin': return null;
    case 'no-admin':
      if (a.inconclusive) return { variant: 'notice', title: 'Could not confirm admin access', body: `Could not confirm admin access on ${name}: your roles couldn't be determined and the API gave no proof of admin rights. Managing API keys, secrets and webhooks needs the admin role. Re-check, or ask a site admin.` };
      if (a.roles?.length) return { variant: 'notice', title: `No admin access on ${name}`, body: `Your roles: ${a.roles.join(', ')}. Managing API keys, secrets and webhooks requires the admin role.${a.permissions?.length ? ` Your content permissions: ${a.permissions.join(', ')}.` : ''}` };
      return { variant: 'notice', title: `No admin access on ${name}`, body: `You don't have admin access on ${name}${/^\d+$/.test(a.detail) ? ` (Admin API returned ${a.detail})` : ''}. With the author role you can't manage API keys, secrets or webhooks. Ask a site admin or request admin access.${a.permissions?.length ? ` Your content permissions: ${a.permissions.join(', ')}.` : ''}` };
    case 'not-found': return { variant: 'notice', title: 'Site not found', body: `No site configuration exists for ${name}. Check the org and site names.` };
    case 'no-auth': return { variant: 'notice', title: 'Not signed in to da.live', body: 'No valid da.live sign-in found. Open da.live, sign in (reload the tab if you just did), then Re-check.' };
    default: return { variant: 'negative', title: 'Could not check access', body: a.detail };
  }
}
