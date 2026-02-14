import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
    constructor(private readonly configService: ConfigService) {}

    canActivate(
        context: ExecutionContext,
    ): boolean | Promise<boolean> | Observable<boolean> {
        const apiKey = this.configService.get<string>('app.apiKey');
        if (!apiKey) {
            // If no API key is configured, allow access
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const headerApiKey = request.headers['x-api-key'];

        if (headerApiKey === apiKey) {
            return true;
        }

        throw new UnauthorizedException('Invalid API Key');
    }
}
