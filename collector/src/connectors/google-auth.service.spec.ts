import { GoogleAuthService } from './google-auth.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GoogleAuthService', () => {
    let service: GoogleAuthService;
    let mockConfigService: Partial<ConfigService>;

    const googleConfig: Record<string, string> = {
        'google.clientId': 'test-client-id',
        'google.clientSecret': 'test-client-secret',
        'google.refreshToken': 'test-refresh-token',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockConfigService = {
            get: jest.fn((key: string) => googleConfig[key as keyof typeof googleConfig]),
        };
        service = new GoogleAuthService(mockConfigService as ConfigService);
    });

    describe('getAccessToken', () => {
        it('should fetch a new token via OAuth2 refresh', async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'new-access-token', expires_in: 3600 },
            });

            const token = await service.getAccessToken(['https://www.googleapis.com/auth/gmail.readonly']);

            expect(token).toBe('new-access-token');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://oauth2.googleapis.com/token',
                {
                    client_id: 'test-client-id',
                    client_secret: 'test-client-secret',
                    refresh_token: 'test-refresh-token',
                    grant_type: 'refresh_token',
                },
            );
        });

        it('should return cached token when not expired', async () => {
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'cached-token', expires_in: 3600 },
            });

            const token1 = await service.getAccessToken(['scope1']);
            const token2 = await service.getAccessToken(['scope1']);

            expect(token1).toBe('cached-token');
            expect(token2).toBe('cached-token');
            expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        });

        it('should refresh token when expired', async () => {
            // First call: token with expires_in=0 makes tokenExpiry = now - 60000 (already expired)
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'expired-token', expires_in: 0 },
            });
            await service.getAccessToken(['scope1']);

            // Second call should fetch a new token
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'fresh-token', expires_in: 3600 },
            });
            const token = await service.getAccessToken(['scope1']);

            expect(token).toBe('fresh-token');
            expect(mockedAxios.post).toHaveBeenCalledTimes(2);
        });

        it('should throw when credentials are missing', async () => {
            const emptyConfig = { get: jest.fn().mockReturnValue(undefined) };
            const svc = new GoogleAuthService(emptyConfig as any);

            await expect(svc.getAccessToken(['scope1'])).rejects.toThrow(
                'Google OAuth2 credentials not configured',
            );
            expect(mockedAxios.post).not.toHaveBeenCalled();
        });

        it('should throw when OAuth2 request fails', async () => {
            mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

            await expect(service.getAccessToken(['scope1'])).rejects.toThrow('Network error');
        });
    });
});
