import {
    appConfig,
    cohereConfig,
    confluenceConfig,
    elasticsearchConfig,
    googleConfig,
    jiraConfig,
    openaiConfig,
    redisConfig,
    slackConfig,
    temporalConfig,
} from './config';

describe('Config factories', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('appConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.NODE_ENV;
            delete process.env.PORT;
            delete process.env.GLOBAL_API_PREFIX;
            delete process.env.API_KEY;
            delete process.env.COMPANY_DOMAINS;

            const config = appConfig();
            expect(config).toEqual({
                nodeEnv: 'development',
                port: 8087,
                globalApiPrefix: 'api/v1',
                apiKey: undefined,
                companyDomains: '',
            });
        });

        it('uses env vars when set', () => {
            process.env.NODE_ENV = 'production';
            process.env.PORT = '3000';
            process.env.GLOBAL_API_PREFIX = 'api/v2';
            process.env.API_KEY = 'secret-key';
            process.env.COMPANY_DOMAINS = 'example.com,test.com';

            const config = appConfig();
            expect(config).toEqual({
                nodeEnv: 'production',
                port: 3000,
                globalApiPrefix: 'api/v2',
                apiKey: 'secret-key',
                companyDomains: 'example.com,test.com',
            });
        });

        it('converts PORT to a number', () => {
            process.env.PORT = '4000';
            const config = appConfig();
            expect(config.port).toBe(4000);
            expect(typeof config.port).toBe('number');
        });
    });

    describe('redisConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.REDIS_HOST;
            delete process.env.REDIS_PORT;
            delete process.env.REDIS_DB;
            delete process.env.REDIS_URL;

            const config = redisConfig();
            expect(config).toEqual({
                host: 'localhost',
                port: 6379,
                db: 0,
                url: 'redis://localhost:6379/0',
            });
        });

        it('uses env vars when set', () => {
            process.env.REDIS_HOST = 'redis-server';
            process.env.REDIS_PORT = '6380';
            process.env.REDIS_DB = '2';
            process.env.REDIS_URL = 'redis://redis-server:6380/2';

            const config = redisConfig();
            expect(config).toEqual({
                host: 'redis-server',
                port: 6380,
                db: 2,
                url: 'redis://redis-server:6380/2',
            });
        });

        it('constructs url from host, port, db when REDIS_URL is not set', () => {
            delete process.env.REDIS_URL;
            process.env.REDIS_HOST = 'myhost';
            process.env.REDIS_PORT = '6381';
            process.env.REDIS_DB = '3';

            const config = redisConfig();
            expect(config.url).toBe('redis://myhost:6381/3');
        });

        it('converts REDIS_PORT to a number', () => {
            process.env.REDIS_PORT = '7000';
            const config = redisConfig();
            expect(config.port).toBe(7000);
            expect(typeof config.port).toBe('number');
        });

        it('converts REDIS_DB to a number', () => {
            process.env.REDIS_DB = '5';
            const config = redisConfig();
            expect(config.db).toBe(5);
            expect(typeof config.db).toBe('number');
        });
    });

    describe('jiraConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.ATLASSIAN_BASE_URL;
            delete process.env.ATLASSIAN_EMAIL;
            delete process.env.ATLASSIAN_API_TOKEN;
            delete process.env.JIRA_SPRINT_FIELD_ID;

            const config = jiraConfig();
            expect(config).toEqual({
                baseUrl: undefined,
                username: undefined,
                apiToken: undefined,
                sprintFieldId: 'customfield_10020',
                projectsToIndex: [],
            });
        });

        it('uses env vars when set', () => {
            process.env.ATLASSIAN_BASE_URL = 'https://myorg.atlassian.net';
            process.env.ATLASSIAN_EMAIL = 'user@example.com';
            process.env.ATLASSIAN_API_TOKEN = 'jira-token';
            process.env.JIRA_SPRINT_FIELD_ID = 'customfield_99999';

            const config = jiraConfig();
            expect(config).toEqual({
                baseUrl: 'https://myorg.atlassian.net',
                username: 'user@example.com',
                apiToken: 'jira-token',
                sprintFieldId: 'customfield_99999',
                projectsToIndex: [],
            });
        });
    });

    describe('slackConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.SLACK_USER_TOKEN;

            const config = slackConfig();
            expect(config).toEqual({
                userToken: undefined,
                channelsToIndex: [],
            });
        });

        it('uses env vars when set', () => {
            process.env.SLACK_USER_TOKEN = 'xoxp-slack-token';

            const config = slackConfig();
            expect(config.userToken).toBe('xoxp-slack-token');
        });
    });

    describe('googleConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.GOOGLE_CLIENT_ID;
            delete process.env.GOOGLE_CLIENT_SECRET;
            delete process.env.GOOGLE_REFRESH_TOKEN;
            delete process.env.GOOGLE_USER_EMAIL;

            const config = googleConfig();
            expect(config).toEqual({
                clientId: undefined,
                clientSecret: undefined,
                refreshToken: undefined,
                userEmail: '',
                gmailLabelsToIndex: [],
                gmailDomainsToIndex: [],
                driveFoldersToIndex: [],
                calendarIdsToIndex: [],
            });
        });

        it('uses env vars when set', () => {
            process.env.GOOGLE_CLIENT_ID = 'client-id-123';
            process.env.GOOGLE_CLIENT_SECRET = 'client-secret-456';
            process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token-789';
            process.env.GOOGLE_USER_EMAIL = 'user@gmail.com';

            const config = googleConfig();
            expect(config.clientId).toBe('client-id-123');
            expect(config.clientSecret).toBe('client-secret-456');
            expect(config.refreshToken).toBe('refresh-token-789');
            expect(config.userEmail).toBe('user@gmail.com');
        });

        it('initializes all array fields as empty arrays', () => {
            const config = googleConfig();
            expect(config.gmailLabelsToIndex).toEqual([]);
            expect(config.gmailDomainsToIndex).toEqual([]);
            expect(config.driveFoldersToIndex).toEqual([]);
            expect(config.calendarIdsToIndex).toEqual([]);
        });
    });

    describe('confluenceConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.ATLASSIAN_BASE_URL;
            delete process.env.ATLASSIAN_EMAIL;
            delete process.env.ATLASSIAN_API_TOKEN;

            const config = confluenceConfig();
            expect(config).toEqual({
                baseUrl: undefined,
                username: undefined,
                apiToken: undefined,
                spacesToIndex: [],
            });
        });

        it('shares Atlassian env vars with jiraConfig', () => {
            process.env.ATLASSIAN_BASE_URL = 'https://myorg.atlassian.net';
            process.env.ATLASSIAN_EMAIL = 'user@example.com';
            process.env.ATLASSIAN_API_TOKEN = 'shared-token';

            const jira = jiraConfig();
            const confluence = confluenceConfig();

            expect(confluence.baseUrl).toBe(jira.baseUrl);
            expect(confluence.username).toBe(jira.username);
            expect(confluence.apiToken).toBe(jira.apiToken);
        });
    });

    describe('elasticsearchConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.ELASTICSEARCH_URL;
            delete process.env.ELASTICSEARCH_INDEX;

            const config = elasticsearchConfig();
            expect(config).toEqual({
                node: 'http://localhost:9200',
                index: 'collector_documents',
            });
        });

        it('uses env vars when set', () => {
            process.env.ELASTICSEARCH_URL = 'http://es-host:9201';
            process.env.ELASTICSEARCH_INDEX = 'custom_index';

            const config = elasticsearchConfig();
            expect(config).toEqual({
                node: 'http://es-host:9201',
                index: 'custom_index',
            });
        });
    });

    describe('openaiConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.OPENAI_API_KEY;
            delete process.env.OPENAI_EMBEDDING_MODEL;

            const config = openaiConfig();
            expect(config).toEqual({
                apiKey: undefined,
                embeddingModel: 'text-embedding-3-large',
            });
        });

        it('uses env vars when set', () => {
            process.env.OPENAI_API_KEY = 'sk-openai-key';
            process.env.OPENAI_EMBEDDING_MODEL = 'text-embedding-ada-002';

            const config = openaiConfig();
            expect(config).toEqual({
                apiKey: 'sk-openai-key',
                embeddingModel: 'text-embedding-ada-002',
            });
        });
    });

    describe('cohereConfig', () => {
        it('returns empty string apiKey as default', () => {
            delete process.env.COHERE_API_KEY;

            const config = cohereConfig();
            expect(config).toEqual({ apiKey: '' });
        });

        it('uses env var when set', () => {
            process.env.COHERE_API_KEY = 'cohere-key-123';

            const config = cohereConfig();
            expect(config.apiKey).toBe('cohere-key-123');
        });
    });

    describe('temporalConfig', () => {
        it('returns correct defaults when env vars are not set', () => {
            delete process.env.TEMPORAL_ADDRESS;
            delete process.env.TEMPORAL_NAMESPACE;
            delete process.env.TEMPORAL_TASK_QUEUE;

            const config = temporalConfig();
            expect(config).toEqual({
                address: undefined,
                namespace: 'default',
                taskQueue: 'collector-indexing',
            });
        });

        it('uses env vars when set', () => {
            process.env.TEMPORAL_ADDRESS = 'temporal:7233';
            process.env.TEMPORAL_NAMESPACE = 'my-namespace';
            process.env.TEMPORAL_TASK_QUEUE = 'custom-queue';

            const config = temporalConfig();
            expect(config).toEqual({
                address: 'temporal:7233',
                namespace: 'my-namespace',
                taskQueue: 'custom-queue',
            });
        });
    });
});
