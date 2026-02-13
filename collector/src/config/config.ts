import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '8087', 10),
    globalApiPrefix: process.env.GLOBAL_API_PREFIX || 'api/v1',
    apiKey: process.env.API_KEY,
    companyDomains: process.env.COMPANY_DOMAINS || '',
}));

export const redisConfig = registerAs('redis', () => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: parseInt(process.env.REDIS_DB || '0', 10),
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}/${process.env.REDIS_DB || '0'}`,
}));



export const jiraConfig = registerAs('jira', () => ({
    baseUrl: process.env.ATLASSIAN_BASE_URL,
    username: process.env.ATLASSIAN_EMAIL,
    apiToken: process.env.ATLASSIAN_API_TOKEN,
    sprintFieldId: process.env.JIRA_SPRINT_FIELD_ID || 'customfield_10020',
    projectsToIndex: [],
}));

export const slackConfig = registerAs('slack', () => ({
    userToken: process.env.SLACK_USER_TOKEN,
    channelsToIndex: [],
}));

export const googleConfig = registerAs('google', () => ({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    userEmail: process.env.GOOGLE_USER_EMAIL || '',
    gmailLabelsToIndex: [],
    gmailDomainsToIndex: [],
    driveFoldersToIndex: [],
    calendarIdsToIndex: [],
}));

export const confluenceConfig = registerAs('confluence', () => ({
    baseUrl: process.env.ATLASSIAN_BASE_URL,
    username: process.env.ATLASSIAN_EMAIL,
    apiToken: process.env.ATLASSIAN_API_TOKEN,
    spacesToIndex: [],
}));

export const githubConfig = registerAs('github', () => ({
    token: process.env.GITHUB_TOKEN,
    username: process.env.GITHUB_USERNAME,
}));

export const elasticsearchConfig = registerAs('elasticsearch', () => ({
    node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
    index: process.env.ELASTICSEARCH_INDEX || 'collector_documents',
}));

export const openaiConfig = registerAs('openai', () => ({
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large',
}));

export const cohereConfig = registerAs('cohere', () => ({
    apiKey: process.env.COHERE_API_KEY || '',
}));

export const temporalConfig = registerAs('temporal', () => ({
    address: process.env.TEMPORAL_ADDRESS,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE || 'collector-indexing',
}));