import { ConfigService } from '@nestjs/config';

import { DataSource, GmailSettings,JiraSettings, SourceSettings } from '../types';
import { SettingsService } from './settings.service';

function createRedisMock() {
    const store = new Map<string, string>();

    return {
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        set: jest.fn(async (key: string, value: string) => {
            store.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (...keys: string[]) => {
            let count = 0;
            for (const key of keys) {
                if (store.delete(key)) count++;
            }
            return count;
        }),
        quit: jest.fn(async () => 'OK'),
        _store: store,
    };
}

describe('SettingsService', () => {
    let service: SettingsService;
    let redisMock: ReturnType<typeof createRedisMock>;

    beforeEach(() => {
        redisMock = createRedisMock();
        const configService = {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
        } as unknown as ConfigService;

        service = new SettingsService(configService);
        // Inject mock Redis
        (service as any).redis = redisMock as any;
    });

    describe('key generation', () => {
        it('uses correct settings prefix', async () => {
            await service.getSettings('jira');
            expect(redisMock.get).toHaveBeenCalledWith('index:settings:jira');
        });

        it('generates unique keys per source', async () => {
            await service.getSettings('gmail');
            await service.getSettings('slack');
            expect(redisMock.get).toHaveBeenCalledWith('index:settings:gmail');
            expect(redisMock.get).toHaveBeenCalledWith('index:settings:slack');
        });
    });

    describe('getSettings / saveSettings round-trip', () => {
        it('stores and retrieves JiraSettings', async () => {
            const settings: JiraSettings = { projectKeys: ['PROJ', 'DEV'] };
            await service.saveSettings('jira', settings);

            const retrieved = await service.getSettings('jira');
            expect(retrieved).toEqual(settings);
        });

        it('stores and retrieves GmailSettings', async () => {
            const settings: GmailSettings = {
                domains: ['example.com'],
                senders: ['boss@example.com'],
                labels: ['INBOX', 'IMPORTANT'],
            };
            await service.saveSettings('gmail', settings);

            const retrieved = await service.getSettings('gmail');
            expect(retrieved).toEqual(settings);
        });

        it('serializes to JSON in Redis', async () => {
            const settings: JiraSettings = { projectKeys: ['PROJ'] };
            await service.saveSettings('jira', settings);

            expect(redisMock.set).toHaveBeenCalledWith(
                'index:settings:jira',
                JSON.stringify(settings),
            );
        });

        it('overwrites existing settings', async () => {
            const v1: JiraSettings = { projectKeys: ['PROJ'] };
            const v2: JiraSettings = { projectKeys: ['PROJ', 'OTHER'] };

            await service.saveSettings('jira', v1);
            await service.saveSettings('jira', v2);

            const retrieved = await service.getSettings('jira');
            expect(retrieved).toEqual(v2);
        });
    });

    describe('getSettings edge cases', () => {
        it('returns null for missing key', async () => {
            const result = await service.getSettings('confluence');
            expect(result).toBeNull();
        });

        it('returns null for invalid JSON', async () => {
            // Manually inject invalid JSON into the store
            redisMock._store.set('index:settings:slack', '{invalid json}}}');

            const result = await service.getSettings('slack');
            expect(result).toBeNull();
        });
    });

    describe('deleteSettings', () => {
        it('removes the key from Redis', async () => {
            const settings: JiraSettings = { projectKeys: ['PROJ'] };
            await service.saveSettings('jira', settings);

            await service.deleteSettings('jira');

            expect(redisMock.del).toHaveBeenCalledWith('index:settings:jira');
            const result = await service.getSettings('jira');
            expect(result).toBeNull();
        });

        it('does not error when deleting nonexistent key', async () => {
            await expect(service.deleteSettings('confluence')).resolves.toBeUndefined();
        });
    });

    describe('disabled sources', () => {
        it('returns empty array when no sources are disabled', async () => {
            const result = await service.getDisabledSources();
            expect(result).toEqual([]);
        });

        it('returns all sources as enabled when none are disabled', async () => {
            const result = await service.getEnabledSources();
            expect(result).toEqual(['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar']);
        });

        it('disabling a source adds it to the disabled list', async () => {
            await service.setSourceEnabled('calendar', false);
            const disabled = await service.getDisabledSources();
            expect(disabled).toContain('calendar');
        });

        it('disabling a source removes it from enabled list', async () => {
            await service.setSourceEnabled('calendar', false);
            const enabled = await service.getEnabledSources();
            expect(enabled).not.toContain('calendar');
            expect(enabled).toHaveLength(5);
        });

        it('re-enabling a source removes it from disabled list', async () => {
            await service.setSourceEnabled('calendar', false);
            await service.setSourceEnabled('calendar', true);
            const disabled = await service.getDisabledSources();
            expect(disabled).not.toContain('calendar');
        });

        it('disabling an already-disabled source is idempotent', async () => {
            await service.setSourceEnabled('slack', false);
            await service.setSourceEnabled('slack', false);
            const disabled = await service.getDisabledSources();
            expect(disabled.filter(s => s === 'slack')).toHaveLength(1);
        });

        it('isSourceEnabled returns true for enabled source', async () => {
            expect(await service.isSourceEnabled('jira')).toBe(true);
        });

        it('isSourceEnabled returns false for disabled source', async () => {
            await service.setSourceEnabled('jira', false);
            expect(await service.isSourceEnabled('jira')).toBe(false);
        });

        it('can disable multiple sources', async () => {
            await service.setSourceEnabled('calendar', false);
            await service.setSourceEnabled('confluence', false);
            const disabled = await service.getDisabledSources();
            expect(disabled).toContain('calendar');
            expect(disabled).toContain('confluence');
            const enabled = await service.getEnabledSources();
            expect(enabled).toHaveLength(4);
        });

        it('setDisabledSources replaces the entire list', async () => {
            await service.setSourceEnabled('jira', false);
            await service.setDisabledSources(['gmail', 'drive'] as DataSource[]);
            const disabled = await service.getDisabledSources();
            expect(disabled).toEqual(['gmail', 'drive']);
            expect(disabled).not.toContain('jira');
        });

        it('stores disabled sources in the correct Redis key', async () => {
            await service.setSourceEnabled('slack', false);
            expect(redisMock.set).toHaveBeenCalledWith(
                'index:disabled-sources',
                expect.any(String),
            );
        });

        it('returns empty array for corrupted Redis data', async () => {
            redisMock._store.set('index:disabled-sources', '{invalid}');
            const result = await service.getDisabledSources();
            expect(result).toEqual([]);
        });
    });
});
