export interface OrgSite { org: string | null; site: string | null }

/** Parse "#/org/site/..." from a location hash. */
export function parseHash(hash: string): OrgSite {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { org: parts[0] ?? null, site: parts[1] ?? null };
}
