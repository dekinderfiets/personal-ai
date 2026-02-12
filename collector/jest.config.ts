import type { Config } from 'jest';

const config: Config = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: 'src',
    testRegex: '.*\\.spec\\.ts$',
    transform: {
        '^.+\\.ts$': ['ts-jest', { diagnostics: false }],
    },
    collectCoverageFrom: ['**/*.ts', '!main.ts', '!**/*.d.ts'],
    coverageDirectory: '../coverage',
    testEnvironment: 'node',
};

export default config;
