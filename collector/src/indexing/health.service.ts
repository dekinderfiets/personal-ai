import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from '../types';

export interface ConnectorHealth {
    source: DataSource;
    configured: boolean;
    connected: boolean;
    authenticated: boolean;
    latencyMs: number | null;
    error?: string;
    checkedAt: string;
}

@Injectable()
export class ConnectorHealthService {
    private readonly logger = new Logger(ConnectorHealthService.name);

    constructor(private configService: ConfigService) {}

    async checkHealth(source: DataSource): Promise<ConnectorHealth> {
        const checkedAt = new Date().toISOString();
        const startTime = Date.now();

        try {
            switch (source) {
                case 'jira':
                    return await this.checkJira(startTime, checkedAt);
                case 'confluence':
                    return await this.checkConfluence(startTime, checkedAt);
                case 'slack':
                    return await this.checkSlack(startTime, checkedAt);
                case 'gmail':
                case 'drive':
                case 'calendar':
                    return await this.checkGoogle(source, startTime, checkedAt);
                case 'github':
                    return await this.checkGitHub(startTime, checkedAt);
                default:
                    return {
                        source,
                        configured: false,
                        connected: false,
                        authenticated: false,
                        latencyMs: null,
                        error: `Unknown source: ${source}`,
                        checkedAt,
                    };
            }
        } catch (error: unknown) {
            return {
                source,
                configured: true,
                connected: false,
                authenticated: false,
                latencyMs: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error),
                checkedAt,
            };
        }
    }

    async checkAllHealth(): Promise<ConnectorHealth[]> {
        const sources: DataSource[] = ['jira', 'slack', 'gmail', 'drive', 'confluence', 'calendar', 'github'];
        return Promise.all(sources.map(s => this.checkHealth(s)));
    }

    private async checkJira(startTime: number, checkedAt: string): Promise<ConnectorHealth> {
        const baseUrl = this.configService.get<string>('jira.baseUrl');
        const username = this.configService.get<string>('jira.username');
        const apiToken = this.configService.get<string>('jira.apiToken');

        if (!baseUrl || !username || !apiToken) {
            return { source: 'jira', configured: false, connected: false, authenticated: false, latencyMs: null, checkedAt };
        }

        const token = Buffer.from(`${username}:${apiToken}`).toString('base64');
        const response = await axios.get(`${baseUrl}/rest/api/3/myself`, {
            headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' },
            timeout: 10000,
        });

        return {
            source: 'jira',
            configured: true,
            connected: true,
            authenticated: response.status === 200,
            latencyMs: Date.now() - startTime,
            checkedAt,
        };
    }

    private async checkConfluence(startTime: number, checkedAt: string): Promise<ConnectorHealth> {
        const baseUrl = this.configService.get<string>('confluence.baseUrl');
        const username = this.configService.get<string>('confluence.username');
        const apiToken = this.configService.get<string>('confluence.apiToken');

        if (!baseUrl || !username || !apiToken) {
            return { source: 'confluence', configured: false, connected: false, authenticated: false, latencyMs: null, checkedAt };
        }

        const token = Buffer.from(`${username}:${apiToken}`).toString('base64');
        const response = await axios.get(`${baseUrl}/wiki/rest/api/space?limit=1`, {
            headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' },
            timeout: 10000,
        });

        return {
            source: 'confluence',
            configured: true,
            connected: true,
            authenticated: response.status === 200,
            latencyMs: Date.now() - startTime,
            checkedAt,
        };
    }

    private async checkSlack(startTime: number, checkedAt: string): Promise<ConnectorHealth> {
        const token = this.configService.get<string>('slack.userToken');

        if (!token) {
            return { source: 'slack', configured: false, connected: false, authenticated: false, latencyMs: null, checkedAt };
        }

        const response = await axios.post('https://slack.com/api/auth.test', null, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 10000,
        });

        const data = response.data;
        return {
            source: 'slack',
            configured: true,
            connected: true,
            authenticated: data.ok === true,
            latencyMs: Date.now() - startTime,
            error: data.ok ? undefined : data.error,
            checkedAt,
        };
    }

    private async checkGitHub(startTime: number, checkedAt: string): Promise<ConnectorHealth> {
        const token = this.configService.get<string>('github.token');
        const username = this.configService.get<string>('github.username');

        if (!token || !username) {
            return { source: 'github', configured: false, connected: false, authenticated: false, latencyMs: null, checkedAt };
        }

        const response = await axios.get('https://api.github.com/user', {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' },
            timeout: 10000,
        });

        return {
            source: 'github',
            configured: true,
            connected: true,
            authenticated: response.status === 200,
            latencyMs: Date.now() - startTime,
            checkedAt,
        };
    }

    private async checkGoogle(source: DataSource, startTime: number, checkedAt: string): Promise<ConnectorHealth> {
        const clientId = this.configService.get<string>('google.clientId');
        const clientSecret = this.configService.get<string>('google.clientSecret');
        const refreshToken = this.configService.get<string>('google.refreshToken');

        if (!clientId || !clientSecret || !refreshToken) {
            return { source, configured: false, connected: false, authenticated: false, latencyMs: null, checkedAt };
        }

        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }, { timeout: 10000 });

        return {
            source,
            configured: true,
            connected: true,
            authenticated: !!tokenResponse.data.access_token,
            latencyMs: Date.now() - startTime,
            checkedAt,
        };
    }
}
