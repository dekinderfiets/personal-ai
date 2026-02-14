import { ConfigService } from '@nestjs/config';
import axios from 'axios';

import { ConnectorHealthService } from './health.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ConnectorHealthService', () => {
    let service: ConnectorHealthService;
    let configValues: Record<string, string | undefined>;

    beforeEach(() => {
        jest.clearAllMocks();

        configValues = {};

        const configService = {
            get: jest.fn((key: string) => configValues[key]),
        } as unknown as ConfigService;

        service = new ConnectorHealthService(configService);
    });

    describe('unconfigured connectors', () => {
        it('returns configured: false for Jira when credentials missing', async () => {
            const result = await service.checkHealth('jira');

            expect(result.source).toBe('jira');
            expect(result.configured).toBe(false);
            expect(result.connected).toBe(false);
            expect(result.authenticated).toBe(false);
            expect(result.latencyMs).toBeNull();
        });

        it('returns configured: false for Confluence when credentials missing', async () => {
            const result = await service.checkHealth('confluence');
            expect(result.configured).toBe(false);
        });

        it('returns configured: false for Slack when token missing', async () => {
            const result = await service.checkHealth('slack');
            expect(result.configured).toBe(false);
        });

        it('returns configured: false for GitHub when token or username missing', async () => {
            configValues['github.token'] = 'some-token';
            // username is missing
            const result = await service.checkHealth('github');
            expect(result.configured).toBe(false);
        });

        it('returns configured: false for Google sources when credentials missing', async () => {
            for (const source of ['gmail', 'drive', 'calendar'] as const) {
                const result = await service.checkHealth(source);
                expect(result.source).toBe(source);
                expect(result.configured).toBe(false);
            }
        });
    });

    describe('successful health checks', () => {
        it('returns all true flags for Jira with valid response', async () => {
            configValues['jira.baseUrl'] = 'https://jira.example.com';
            configValues['jira.username'] = 'user@example.com';
            configValues['jira.apiToken'] = 'api-token-123';

            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: {} });

            const result = await service.checkHealth('jira');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(true);
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
            expect(result.error).toBeUndefined();

            // Verify correct URL and auth header
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://jira.example.com/rest/api/3/myself',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: expect.stringMatching(/^Basic /),
                    }),
                    timeout: 10000,
                }),
            );
        });

        it('returns all true flags for Confluence with valid response', async () => {
            configValues['confluence.baseUrl'] = 'https://confluence.example.com';
            configValues['confluence.username'] = 'user@example.com';
            configValues['confluence.apiToken'] = 'api-token-456';

            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: {} });

            const result = await service.checkHealth('confluence');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(true);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://confluence.example.com/wiki/rest/api/space?limit=1',
                expect.any(Object),
            );
        });

        it('returns all true flags for Slack with ok response', async () => {
            configValues['slack.userToken'] = 'xoxp-slack-token';

            mockedAxios.post.mockResolvedValueOnce({
                status: 200,
                data: { ok: true, user_id: 'U123' },
            });

            const result = await service.checkHealth('slack');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(true);
            expect(result.error).toBeUndefined();
        });

        it('returns authenticated: false for Slack with ok: false response', async () => {
            configValues['slack.userToken'] = 'xoxp-invalid-token';

            mockedAxios.post.mockResolvedValueOnce({
                status: 200,
                data: { ok: false, error: 'invalid_auth' },
            });

            const result = await service.checkHealth('slack');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(false);
            expect(result.error).toBe('invalid_auth');
        });

        it('returns all true flags for GitHub with valid response', async () => {
            configValues['github.token'] = 'ghp_token123';
            configValues['github.username'] = 'octocat';

            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: { login: 'octocat' } });

            const result = await service.checkHealth('github');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(true);

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://api.github.com/user',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer ghp_token123',
                    }),
                }),
            );
        });

        it('returns all true flags for Google sources with valid token response', async () => {
            configValues['google.clientId'] = 'client-id';
            configValues['google.clientSecret'] = 'client-secret';
            configValues['google.refreshToken'] = 'refresh-token';

            mockedAxios.post.mockResolvedValueOnce({
                status: 200,
                data: { access_token: 'ya29.access-token' },
            });

            const result = await service.checkHealth('gmail');

            expect(result.source).toBe('gmail');
            expect(result.configured).toBe(true);
            expect(result.connected).toBe(true);
            expect(result.authenticated).toBe(true);
        });
    });

    describe('failed connections', () => {
        it('returns error with latency when Jira request fails', async () => {
            configValues['jira.baseUrl'] = 'https://jira.example.com';
            configValues['jira.username'] = 'user@example.com';
            configValues['jira.apiToken'] = 'api-token';

            mockedAxios.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const result = await service.checkHealth('jira');

            expect(result.source).toBe('jira');
            expect(result.configured).toBe(true);
            expect(result.connected).toBe(false);
            expect(result.authenticated).toBe(false);
            expect(result.latencyMs).toBeGreaterThanOrEqual(0);
            expect(result.error).toBe('ECONNREFUSED');
        });

        it('returns error when GitHub request fails', async () => {
            configValues['github.token'] = 'ghp_token';
            configValues['github.username'] = 'octocat';

            mockedAxios.get.mockRejectedValueOnce(new Error('Request timeout'));

            const result = await service.checkHealth('github');

            expect(result.configured).toBe(true);
            expect(result.connected).toBe(false);
            expect(result.error).toBe('Request timeout');
        });

        it('handles non-Error throw', async () => {
            configValues['jira.baseUrl'] = 'https://jira.example.com';
            configValues['jira.username'] = 'user';
            configValues['jira.apiToken'] = 'token';

            mockedAxios.get.mockRejectedValueOnce('string error');

            const result = await service.checkHealth('jira');
            expect(result.error).toBe('string error');
        });
    });

    describe('unknown source', () => {
        it('returns configured: false with error for unknown source', async () => {
            const result = await service.checkHealth('unknown' as any);

            expect(result.configured).toBe(false);
            expect(result.error).toBe('Unknown source: unknown');
        });
    });

    describe('checkAllHealth', () => {
        it('calls all 7 sources in parallel', async () => {
            // All connectors unconfigured - will return configured: false quickly
            const results = await service.checkAllHealth();

            expect(results).toHaveLength(7);
            const sources = results.map(r => r.source);
            expect(sources).toContain('jira');
            expect(sources).toContain('slack');
            expect(sources).toContain('gmail');
            expect(sources).toContain('drive');
            expect(sources).toContain('confluence');
            expect(sources).toContain('calendar');
            expect(sources).toContain('github');
        });

        it('returns mix of configured and unconfigured connectors', async () => {
            configValues['jira.baseUrl'] = 'https://jira.example.com';
            configValues['jira.username'] = 'user';
            configValues['jira.apiToken'] = 'token';

            mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
            mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

            const results = await service.checkAllHealth();

            const jira = results.find(r => r.source === 'jira');
            const slack = results.find(r => r.source === 'slack');

            expect(jira!.configured).toBe(true);
            expect(slack!.configured).toBe(false);
        });
    });

    describe('Jira auth encoding', () => {
        it('correctly base64 encodes username:apiToken', async () => {
            configValues['jira.baseUrl'] = 'https://jira.example.com';
            configValues['jira.username'] = 'user@example.com';
            configValues['jira.apiToken'] = 'my-secret-token';

            mockedAxios.get.mockResolvedValueOnce({ status: 200, data: {} });

            await service.checkHealth('jira');

            const expectedToken = Buffer.from('user@example.com:my-secret-token').toString('base64');
            expect(mockedAxios.get).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: `Basic ${expectedToken}`,
                    }),
                }),
            );
        });
    });
});
