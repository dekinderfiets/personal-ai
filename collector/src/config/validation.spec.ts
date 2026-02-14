import 'reflect-metadata';

import { validate } from './validation';

const REQUIRED_CONFIG = {
    TEMPORAL_ADDRESS: 'localhost:7233',
};

function buildConfig(overrides: Record<string, unknown> = {}) {
    return { ...REQUIRED_CONFIG, ...overrides };
}

describe('validate', () => {
    describe('valid configurations', () => {
        it('accepts config with all required fields and defaults', () => {
            const result = validate(buildConfig());

            expect(result).toBeDefined();
            expect(result.TEMPORAL_ADDRESS).toBe('localhost:7233');
        });

        it('applies default values when fields are omitted', () => {
            const result = validate(buildConfig());

            expect(result.NODE_ENV).toBe('development');
            expect(result.PORT).toBe(8087);
            expect(result.REDIS_HOST).toBe('redis');
            expect(result.REDIS_PORT).toBe(6379);
            expect(result.REDIS_DB).toBe(2);
            expect(result.JIRA_SPRINT_FIELD_ID).toBe('customfield_10020');
        });

        it('accepts all valid NODE_ENV values', () => {
            for (const env of ['development', 'production', 'test']) {
                const result = validate(buildConfig({ NODE_ENV: env }));
                expect(result.NODE_ENV).toBe(env);
            }
        });

        it('accepts explicit PORT number', () => {
            const result = validate(buildConfig({ PORT: 3000 }));
            expect(result.PORT).toBe(3000);
        });

        it('converts string PORT via implicit conversion', () => {
            const result = validate(buildConfig({ PORT: '9090' }));
            expect(result.PORT).toBe(9090);
        });

        it('accepts a valid ATLASSIAN_BASE_URL', () => {
            const result = validate(
                buildConfig({ ATLASSIAN_BASE_URL: 'https://myorg.atlassian.net' }),
            );
            expect(result.ATLASSIAN_BASE_URL).toBe('https://myorg.atlassian.net');
        });

        it('accepts ATLASSIAN_BASE_URL without TLD (require_tld: false)', () => {
            const result = validate(
                buildConfig({ ATLASSIAN_BASE_URL: 'http://localhost:8080' }),
            );
            expect(result.ATLASSIAN_BASE_URL).toBe('http://localhost:8080');
        });

        it('accepts config with all optional fields provided', () => {
            const full = buildConfig({
                NODE_ENV: 'production',
                PORT: 3000,
                REDIS_HOST: 'redis-prod',
                REDIS_PORT: 6380,
                REDIS_DB: 5,
                ATLASSIAN_BASE_URL: 'https://myorg.atlassian.net',
                ATLASSIAN_EMAIL: 'user@example.com',
                ATLASSIAN_API_TOKEN: 'token-123',
                JIRA_SPRINT_FIELD_ID: 'customfield_99999',
                SLACK_USER_TOKEN: 'xoxp-slack-token',
                GOOGLE_CLIENT_ID: 'google-client-id',
                GOOGLE_CLIENT_SECRET: 'google-secret',
                GOOGLE_REFRESH_TOKEN: 'google-refresh',
                API_KEY: 'my-api-key',
                ELASTICSEARCH_URL: 'http://es:9200',
                OPENAI_API_KEY: 'sk-openai',
                TEMPORAL_NAMESPACE: 'default',
                TEMPORAL_TASK_QUEUE: 'collector-queue',
            });

            const result = validate(full);

            expect(result.NODE_ENV).toBe('production');
            expect(result.ATLASSIAN_EMAIL).toBe('user@example.com');
            expect(result.SLACK_USER_TOKEN).toBe('xoxp-slack-token');
            expect(result.OPENAI_API_KEY).toBe('sk-openai');
            expect(result.TEMPORAL_NAMESPACE).toBe('default');
        });

        it('allows all optional fields to be omitted', () => {
            const result = validate(buildConfig());

            expect(result.ATLASSIAN_BASE_URL).toBeUndefined();
            expect(result.ATLASSIAN_EMAIL).toBeUndefined();
            expect(result.SLACK_USER_TOKEN).toBeUndefined();
            expect(result.GOOGLE_CLIENT_ID).toBeUndefined();
            expect(result.API_KEY).toBeUndefined();
            expect(result.OPENAI_API_KEY).toBeUndefined();
        });
    });

    describe('returns validated config object', () => {
        it('returns an instance with applied defaults, not the raw input', () => {
            const input = { TEMPORAL_ADDRESS: 'localhost:7233' };
            const result = validate(input);

            // Result has defaults that were not in the input
            expect(result.PORT).toBe(8087);
            expect(result.REDIS_HOST).toBe('redis');
            expect((input as any).PORT).toBeUndefined();
        });

        it('preserves overridden values in returned object', () => {
            const result = validate(buildConfig({ REDIS_HOST: 'custom-redis', REDIS_DB: 10 }));

            expect(result.REDIS_HOST).toBe('custom-redis');
            expect(result.REDIS_DB).toBe(10);
        });
    });

    describe('invalid configurations', () => {
        it('throws when NODE_ENV is invalid', () => {
            expect(() => validate(buildConfig({ NODE_ENV: 'staging' }))).toThrow();
        });

        it('throws when TEMPORAL_ADDRESS is missing', () => {
            expect(() => validate({})).toThrow();
        });

        it('throws when ATLASSIAN_BASE_URL is not a valid URL', () => {
            expect(() =>
                validate(buildConfig({ ATLASSIAN_BASE_URL: 'not a valid url' })),
            ).toThrow();
        });
    });
});
