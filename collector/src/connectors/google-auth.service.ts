import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class GoogleAuthService {
    private readonly logger = new Logger(GoogleAuthService.name);
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    constructor(private configService: ConfigService) { }

    async getAccessToken(_scopes: string[]): Promise<string> {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const clientId = this.configService.get<string>('google.clientId');
        const clientSecret = this.configService.get<string>('google.clientSecret');
        const refreshToken = this.configService.get<string>('google.refreshToken');

        if (!clientId || !clientSecret || !refreshToken) {
            throw new Error('Google OAuth2 credentials not configured. Provide GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.');
        }

        try {
            this.logger.log('Using OAuth2 authentication');
            const response = await axios.post('https://oauth2.googleapis.com/token', {
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            });
            this.accessToken = response.data.access_token;
            this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000;
            return this.accessToken!;
        } catch (error) {
            this.logger.error(`Failed to get Google access token: ${error.message}`);
            throw error;
        }
    }
}
