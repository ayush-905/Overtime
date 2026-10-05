// Settings in the browser (storage.ts): the prefix, reading back what was saved,
// a value that doesn't parse or isn't allowed, the bus, and the settings sync
// told at once. Then the sync itself (@shared/settings.js): a change goes to the
// server straight away, and nothing goes once the page is starting again.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@shared/settings.js', () => ({ settingsChanged: vi.fn(), stopSettingsSync: vi.fn() }));

import { settingsChanged, stopSettingsSync } from '@shared/settings.js';
import {
  forgetAllSettings,
  onOtherTab,
  readJson,
  readSetting,
  removeSetting,
  writeJson,
  writeSetting,
} from './storage';
import { onChange } from './bus';

beforeEach(() => {
  localStorage.clear();
  vi.mocked(settingsChanged).mockClear();
});

describe('settings in the browser', () => {
  test('a key is saved under overtime-, and reads back', () => {
    writeSetting('clock', '24');
    expect(localStorage.getItem('overtime-clock')).toBe('24');
    expect(readSetting('clock')).toBe('24');
    expect(readSetting('nothing')).toBeNull();
    writeSetting('clock', null);
    expect(localStorage.getItem('overtime-clock')).toBeNull();
    writeSetting('clock', '12');
    removeSetting('clock');
    expect(readSetting('clock')).toBeNull();
  });

  test('a value that isn’t allowed, or isn’t there, gives the usual one', () => {
    localStorage.setItem('overtime-theme', 'purple');
    expect(readSetting('theme', 'auto', ['light', 'dark'])).toBe('auto');
    localStorage.setItem('overtime-theme', 'dark');
    expect(readSetting('theme', 'auto', ['light', 'dark'])).toBe('dark');
    expect(readSetting('heatmap', null, ['cost', 'tokens'])).toBeNull();
  });

  test('JSON round trips, and what doesn’t parse (or fails the check) falls back', () => {
    writeJson('plans', { claude: { usd: 100, plan: 'max5' } });
    expect(localStorage.getItem('overtime-plans')).toBe('{"claude":{"usd":100,"plan":"max5"}}');
    expect(readJson('plans', {})).toEqual({ claude: { usd: 100, plan: 'max5' } });
    localStorage.setItem('overtime-plans', '{not json');
    expect(readJson('plans', { none: true })).toEqual({ none: true });
    localStorage.setItem('overtime-plans', 'null');
    expect(readJson('plans', { none: true })).toEqual({ none: true });
    localStorage.setItem('overtime-plans', '0');
    expect(readJson('plans', { none: true })).toEqual({ none: true });
    localStorage.setItem('overtime-pinned', '{"a":1}');
    expect(readJson('pinned', [], Array.isArray)).toEqual([]);
    writeJson('pinned', null);
    expect(localStorage.getItem('overtime-pinned')).toBeNull();
  });

  test('a write says so on the bus when asked, and always tells the sync', () => {
    const topics: string[] = [];
    const stop = onChange((t) => topics.push(t));
    writeSetting('page', 'cost');
    writeJson('projects', { shop: { hue: 40 } }, 'labels');
    removeSetting('theme', 'appearance');
    stop();
    expect(topics).toEqual(['labels', 'appearance']);
    expect(settingsChanged).toHaveBeenCalledTimes(3);
  });

  test('storage that throws reads as nothing saved, and a write doesn’t break', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(readSetting('clock')).toBeNull();
    expect(readJson('plans', 'fallback')).toBe('fallback');
    expect(() => writeSetting('clock', '24', 'prefs')).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  test('another tab’s change comes with its key, without the prefix', () => {
    const heard: [string, string | null][] = [];
    const stop = onOtherTab((key, value) => heard.push([key, value]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'overtime-provider', newValue: 'codex' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: '1' }));
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: 'overtime-provider', newValue: 'all' }));
    expect(heard).toEqual([['provider', 'codex']]);
  });

  test('forgetting them all stops the sync first, and leaves other keys alone', () => {
    localStorage.setItem('overtime-clock', '24');
    localStorage.setItem('overtime-nav', '{}');
    localStorage.setItem('other', 'x');
    forgetAllSettings();
    expect(stopSettingsSync).toHaveBeenCalled();
    expect(Object.keys(localStorage)).toEqual(['other']);
  });
});

describe('the settings sync', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('a change on this page goes at once, not at the next check, and none once it has stopped', async () => {
    vi.useFakeTimers();
    const sent: Record<string, string | null>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body).set);
        return { ok: true };
      }),
    );
    // The page starts with what the file has.
    (window as unknown as { overtimeSettings: unknown }).overtimeSettings = {
      initialized: true,
      values: { 'overtime-clock': '12' },
    };
    localStorage.setItem('overtime-clock', '12');
    const sync = await vi.importActual<typeof import('@shared/settings.js')>('@shared/settings.js');
    sync.startSettingsSync();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);

    localStorage.setItem('overtime-clock', '24');
    localStorage.setItem('overtime-theme', 'dark');
    sync.settingsChanged();
    sync.settingsChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([{ 'overtime-clock': '24', 'overtime-theme': 'dark' }]);

    // Starting again from the file: clearing the browser's copy mustn't clear the file's.
    sync.stopSettingsSync();
    localStorage.clear();
    sync.settingsChanged();
    await vi.advanceTimersByTimeAsync(5000);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
  });
});
