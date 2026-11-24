import { describe, it, expect, vi } from 'vitest';
import { createChromeSettingsStore, createMemorySettingsStore, parseSettings, saveWebhookUrl, validateEndpointUrl, SETTINGS_KEY } from './settings';

describe('settings', () => {
  it('validates https only', () => {
    expect(validateEndpointUrl('https://example.com/webhook')).toBeNull();
    expect(validateEndpointUrl(' https://example.com/webhook ')).toBeNull();
    for (const bad of ['', '  ', 'http://example.com', 'example.com', 'javascript:alert(1)', 'https://']) expect(validateEndpointUrl(bad)).not.toBeNull();
    expect(validateEndpointUrl('https://example.com/' + 'a'.repeat(3000))).not.toBeNull();
  });
  it('parseSettings is defensive', () => {
    expect(parseSettings(undefined)).toEqual({});
    expect(parseSettings([])).toEqual({});
    expect(parseSettings({ webhookUrl: 'http://x.io' })).toEqual({});
    expect(parseSettings({ webhookUrl: 42 })).toEqual({});
    expect(parseSettings({ webhookUrl: ' https://example.com/webhook ', extra: 1 })).toEqual({ webhookUrl: 'https://example.com/webhook' });
  });
  it('saveWebhookUrl rejects invalid and stores trimmed valid', async () => {
    const s = createMemorySettingsStore();
    expect(await saveWebhookUrl(s, 'http://example.com')).not.toBeNull();
    expect(await s.load()).toEqual({});
    expect(await saveWebhookUrl(s, ' https://example.com/webhook ')).toBeNull();
    expect(await s.load()).toEqual({ webhookUrl: 'https://example.com/webhook' });
  });
  it('chrome adapter uses key "settings" and removes when empty', async () => {
    const area = { get: vi.fn(async () => ({ [SETTINGS_KEY]: { webhookUrl: 'https://example.com/webhook' } })), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
    const s = createChromeSettingsStore(area);
    expect(await s.load()).toEqual({ webhookUrl: 'https://example.com/webhook' });
    await s.save({ webhookUrl: 'https://example.com/h' });
    expect(area.set).toHaveBeenCalledWith({ settings: { webhookUrl: 'https://example.com/h' } });
    await s.save({});
    expect(area.remove).toHaveBeenCalledWith('settings');
  });
  it('not configured = no webhookUrl', async () => {
    expect((await createMemorySettingsStore().load()).webhookUrl).toBeUndefined();
  });
});
