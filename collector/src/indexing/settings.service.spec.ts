import { ConfigService } from '@nestjs/config';
import { SettingsService } from './settings.service';
import { DataSource, SourceSettings, JiraSettings, GmailSettings } from '../types';

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
            await expect(service.deleteSettings('github')).resolves.toBeUndefined();
        });
    });
});
