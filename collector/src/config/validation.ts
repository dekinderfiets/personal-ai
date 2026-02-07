import { plainToClass } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IsEnum, IsNumber, IsString, IsOptional, IsUrl } from 'class-validator';

enum NodeEnv {
    Development = 'development',
    Production = 'production',
    Test = 'test',
}

class EnvironmentVariables {
    @IsEnum(NodeEnv)
    NODE_ENV: NodeEnv = NodeEnv.Development;

    @IsNumber()
    PORT: number = 8087;

    @IsString()
    REDIS_HOST: string = 'redis';

    @IsNumber()
    REDIS_PORT: number = 6379;

    @IsNumber()
    REDIS_DB: number = 2;



    @IsUrl({ require_tld: false })
    @IsOptional()
    ATLASSIAN_BASE_URL: string;

    @IsString()
    @IsOptional()
    ATLASSIAN_EMAIL: string;

    @IsString()
    @IsOptional()
    ATLASSIAN_API_TOKEN: string;

    @IsString()
    @IsOptional()
    JIRA_SPRINT_FIELD_ID: string = 'customfield_10020';

    @IsString()
    @IsOptional()
    SLACK_USER_TOKEN: string;

    @IsString()
    @IsOptional()
    GOOGLE_CLIENT_ID: string;

    @IsString()
    @IsOptional()
    GOOGLE_CLIENT_SECRET: string;

    @IsString()
    @IsOptional()
    GOOGLE_REFRESH_TOKEN: string;

    @IsString()
    @IsOptional()
    API_KEY: string;
}

export function validate(config: Record<string, unknown>) {
    const validatedConfig = plainToClass(EnvironmentVariables, config, {
        enableImplicitConversion: true,
    });
    const errors = validateSync(validatedConfig, {
        skipMissingProperties: false,
    });

    if (errors.length > 0) {
        throw new Error(errors.toString());
    }
    return validatedConfig;
}
