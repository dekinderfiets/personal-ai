import { UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';

function createMockContext(headers: Record<string, string> = {}) {
    return {
        switchToHttp: () => ({
            getRequest: () => ({ headers }),
        }),
    } as any;
}

describe('ApiKeyGuard', () => {
    describe('when no API key is configured', () => {
        it('should allow access', () => {
            const configService = { get: jest.fn().mockReturnValue(undefined) } as any;
            const guard = new ApiKeyGuard(configService);

            const result = guard.canActivate(createMockContext());

            expect(result).toBe(true);
        });

        it('should allow access when apiKey is empty string', () => {
            const configService = { get: jest.fn().mockReturnValue('') } as any;
            const guard = new ApiKeyGuard(configService);

            const result = guard.canActivate(createMockContext());

            expect(result).toBe(true);
        });
    });

    describe('when API key is configured', () => {
        const API_KEY = 'test-secret-key';
        let guard: ApiKeyGuard;

        beforeEach(() => {
            const configService = { get: jest.fn().mockReturnValue(API_KEY) } as any;
            guard = new ApiKeyGuard(configService);
        });

        it('should allow access with valid x-api-key header', () => {
            const context = createMockContext({ 'x-api-key': API_KEY });

            const result = guard.canActivate(context);

            expect(result).toBe(true);
        });

        it('should throw UnauthorizedException when x-api-key header is missing', () => {
            const context = createMockContext({});

            expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        });

        it('should throw UnauthorizedException when x-api-key header is wrong', () => {
            const context = createMockContext({ 'x-api-key': 'wrong-key' });

            expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
        });
    });
});
