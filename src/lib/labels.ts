/**
 * Local secret labels. The Admin API returns no description for secrets, so a human label
 * {name, note?} is kept per org/site/secretId. ONLY labels are stored here – never secret values or keys.
 */
/** keyId = id of the API key whose value is stored in the secret (unknown for pre-existing secrets). */
export interface Label { name: string; note?: string; keyId?: string }
export type LabelMap = Record<string, Label>;

export const LABEL_NAME_MAX = 60;
export const LABEL_NOTE_MAX = 200;
export const labelsKey = (org: string, site: string) => `labels:${org}/${site}`;

/** Storage backend for labels (chrome.storage.sync adapter in prod, in-memory in tests). */
export interface LabelStore {
  load(org: string, site: string): Promise<LabelMap>;
  save(org: string, site: string, labels: LabelMap): Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trim + clamp; returns null when the name is empty (= no label). */
export function sanitizeLabel(l: { name?: unknown; note?: unknown; keyId?: unknown }): Label | null {
  const name = typeof l.name === 'string' ? l.name.trim().slice(0, LABEL_NAME_MAX) : '';
  if (!name) return null;
  const note = typeof l.note === 'string' ? l.note.trim().slice(0, LABEL_NOTE_MAX) : '';
  const keyId = typeof l.keyId === 'string' ? l.keyId.trim().slice(0, 128) : '';
  return { name, ...(note ? { note } : {}), ...(keyId ? { keyId } : {}) };
}

/** Defensive parse of whatever storage returned (drops anything that is not a valid label). */
export function parseLabels(raw: unknown): LabelMap {
  const out: LabelMap = {};
  if (!isObj(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    const l = isObj(v) ? sanitizeLabel(v) : null;
    if (l) out[id] = l;
  }
  return out;
}

/** Immutable set/remove (empty name removes). */
export function withLabel(map: LabelMap, id: string, label: Label | null): LabelMap {
  const next = { ...map };
  const l = label ? sanitizeLabel(label) : null;
  if (l) next[id] = l; else delete next[id];
  return next;
}

/** Drop labels whose secret no longer exists. */
export function pruneLabels(map: LabelMap, existingIds: string[]): { labels: LabelMap; removed: string[] } {
  const keep = new Set(existingIds);
  const labels: LabelMap = {};
  const removed: string[] = [];
  for (const [id, l] of Object.entries(map)) (keep.has(id) ? (labels[id] = l) : removed.push(id));
  return { labels, removed };
}

export const ID_PREFIX_LEN = 8;
export const idPrefix = (id: string) => `${id.slice(0, ID_PREFIX_LEN)}…`;

/** 'label (id-prefix…)' when labelled, else the bare id. */
export function secretDisplay(id: string, label?: Label): string {
  return label ? `${label.name} (${idPrefix(id)})` : id;
}

/** secretId -> ids of webhooks referencing it. */
export function secretUsage(webhooks: { id: string; secretId: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const w of webhooks) if (w.secretId) (out[w.secretId] ??= []).push(w.id);
  return out;
}

export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

/** Set the note on an existing (or new, named) label without touching the name. */
export function withNote(map: LabelMap, id: string, note: string, fallbackName = 'secret'): LabelMap {
  const cur = map[id];
  return withLabel(map, id, { ...cur, name: cur?.name ?? fallbackName, note });
}

export function createMemoryLabelStore(initial: Record<string, unknown> = {}): LabelStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    load: async (o, s) => parseLabels(data[labelsKey(o, s)]),
    save: async (o, s, l) => { data[labelsKey(o, s)] = JSON.parse(JSON.stringify(l)); },
  };
}

/** Minimal slice of chrome.storage.sync used by the adapter. */
export interface SyncArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export function createChromeLabelStore(area: SyncArea = chrome.storage.sync as unknown as SyncArea): LabelStore {
  return {
    load: async (o, s) => parseLabels((await area.get(labelsKey(o, s)))[labelsKey(o, s)]),
    save: async (o, s, l) => {
      if (Object.keys(l).length === 0) await area.remove(labelsKey(o, s));
      else await area.set({ [labelsKey(o, s)]: l });
    },
  };
}
