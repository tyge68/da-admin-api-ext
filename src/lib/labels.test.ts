import { describe, it, expect, vi } from 'vitest';
import {
  createChromeLabelStore, createMemoryLabelStore, labelsKey, parseLabels, pruneLabels, sanitizeLabel,
  secretDisplay, secretUsage, withLabel, withNote, isoDay, LABEL_NAME_MAX,
} from './labels';

describe('labels (pure)', () => {
  it('sanitizes and clamps; empty name = no label', () => {
    expect(sanitizeLabel({ name: '  ' })).toBeNull();
    expect(sanitizeLabel({ name: ' a ', note: ' ' })).toEqual({ name: 'a' });
    expect(sanitizeLabel({ name: 'x'.repeat(500), note: 'n' })!.name).toHaveLength(LABEL_NAME_MAX);
  });
  it('parseLabels drops garbage', () => {
    expect(parseLabels({ a: { name: 'A' }, b: 'x', c: { name: '' }, d: null })).toEqual({ a: { name: 'A' } });
    expect(parseLabels(undefined)).toEqual({});
  });
  it('withLabel is immutable; null removes', () => {
    const m = { a: { name: 'A' } };
    const n = withLabel(m, 'b', { name: 'B', note: 'n' });
    expect(m).toEqual({ a: { name: 'A' } });
    expect(n.b).toEqual({ name: 'B', note: 'n' });
    expect(withLabel(n, 'a', null)).toEqual({ b: { name: 'B', note: 'n' } });
  });
  it('prunes orphans', () => {
    expect(pruneLabels({ a: { name: 'A' }, z: { name: 'Z' } }, ['a', 'q'])).toEqual({ labels: { a: { name: 'A' } }, removed: ['z'] });
  });
  it('secretDisplay: label + 8-char prefix, else bare id', () => {
    expect(secretDisplay('ABCDEFGHIJKL', { name: 'log reader' })).toBe('log reader (ABCDEFGH…)');
    expect(secretDisplay('ABCDEFGHIJKL')).toBe('ABCDEFGHIJKL');
  });
  it('secretUsage groups webhooks by secret', () => {
    expect(secretUsage([{ id: 'w1', secretId: 's' }, { id: 'w2', secretId: 's' }, { id: 'w3', secretId: '' }])).toEqual({ s: ['w1', 'w2'] });
  });
  it('withNote keeps name and keyId; isoDay format', () => {
    expect(withNote({ s: { name: 'N', keyId: 'K' } }, 's', 'x').s).toEqual({ name: 'N', note: 'x', keyId: 'K' });
    expect(isoDay(new Date('2026-11-24T10:00:00Z'))).toBe('2026-11-24');
  });
  it('keyId is kept by sanitize/parse and optional', () => {
    expect(sanitizeLabel({ name: 'a', keyId: ' K1 ' })).toEqual({ name: 'a', keyId: 'K1' });
    expect(parseLabels({ s: { name: 'a', keyId: 5 } })).toEqual({ s: { name: 'a' } });
  });
});

describe('label stores', () => {
  it('memory store round-trips per org/site', async () => {
    const s = createMemoryLabelStore();
    await s.save('o', 's', { a: { name: 'A' } });
    expect(await s.load('o', 's')).toEqual({ a: { name: 'A' } });
    expect(await s.load('o', 'other')).toEqual({});
  });
  it('chrome adapter uses labels:{org}/{site} and stores only labels', async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: vi.fn(async (k: string) => (k in data ? { [k]: data[k] } : {})),
      set: vi.fn(async (i: Record<string, unknown>) => { Object.assign(data, i); }),
      remove: vi.fn(async (k: string) => { delete data[k]; }),
    };
    const st = createChromeLabelStore(area);
    await st.save('o', 's', { a: { name: 'A', note: 'n' } });
    expect(Object.keys(data)).toEqual([labelsKey('o', 's')]);
    expect(labelsKey('o', 's')).toBe('labels:o/s');
    expect(await st.load('o', 's')).toEqual({ a: { name: 'A', note: 'n' } });
    await st.save('o', 's', {});
    expect(area.remove).toHaveBeenCalledWith('labels:o/s');
  });
});
