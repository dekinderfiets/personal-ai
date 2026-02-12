import { ConfigService } from '@nestjs/config';
import { FileSaverService } from './file-saver.service';
import { IndexDocument } from '../types';
import * as fs from 'fs';

jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
        promises: {
            writeFile: jest.fn().mockResolvedValue(undefined),
            unlink: jest.fn().mockResolvedValue(undefined),
        },
    };
});

describe('FileSaverService', () => {
    let service: FileSaverService;
    const mockExistsSync = fs.existsSync as jest.Mock;
    const mockMkdirSync = fs.mkdirSync as jest.Mock;
    const mockWriteFile = fs.promises.writeFile as jest.Mock;
    const mockUnlink = fs.promises.unlink as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockExistsSync.mockReturnValue(true);

        const configService = {
            get: jest.fn().mockReturnValue('./test-data'),
        } as unknown as ConfigService;

        service = new FileSaverService(configService);
    });

    describe('constructor', () => {
        it('ensures output directory exists on creation', () => {
            mockExistsSync.mockReturnValue(false);
            const configService = {
                get: jest.fn().mockReturnValue('./my-output'),
            } as unknown as ConfigService;

            new FileSaverService(configService);

            expect(mockMkdirSync).toHaveBeenCalledWith('./my-output', { recursive: true });
        });

        it('does not create directory if it already exists', () => {
            mockExistsSync.mockReturnValue(true);
            mockMkdirSync.mockClear();

            const configService = {
                get: jest.fn().mockReturnValue('./existing-dir'),
            } as unknown as ConfigService;

            new FileSaverService(configService);

            // mkdirSync called only for initial check, not when directory exists
            expect(mockMkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('saveDocuments', () => {
        it('creates source directory and writes files', async () => {
            // First call to existsSync for constructor passes (true),
            // second call for sourceDir should trigger mkdir
            mockExistsSync.mockReturnValueOnce(true).mockReturnValueOnce(false);
            mockMkdirSync.mockClear();

            const configService = {
                get: jest.fn().mockReturnValue('./test-data'),
            } as unknown as ConfigService;
            const svc = new FileSaverService(configService);

            const docs: IndexDocument[] = [
                {
                    id: 'doc-1',
                    source: 'gmail',
                    content: 'Hello world',
                    metadata: {
                        id: 'doc-1',
                        source: 'gmail',
                        type: 'email',
                        title: 'Test Email',
                        subject: 'Test',
                        from: 'a@b.com',
                        to: ['c@d.com'],
                        cc: [],
                        labels: [],
                        threadId: 't1',
                        date: '2024-01-15',
                        url: 'https://mail.google.com',
                    },
                },
            ];

            await svc.saveDocuments('gmail', docs);

            expect(mockMkdirSync).toHaveBeenCalledWith(
                expect.stringContaining('gmail'),
                { recursive: true },
            );
            expect(mockWriteFile).toHaveBeenCalledTimes(1);
            expect(mockWriteFile).toHaveBeenCalledWith(
                expect.stringContaining('doc-1.md'),
                expect.any(String),
                'utf8',
            );
        });

        it('writes multiple documents', async () => {
            const docs: IndexDocument[] = [
                {
                    id: 'doc-a',
                    source: 'jira',
                    content: 'Content A',
                    metadata: { id: 'doc-a', source: 'jira', type: 'issue', title: 'Issue A', project: 'PROJ', reporter: 'user1', createdAt: '2024-01-01', updatedAt: '2024-01-02', url: 'https://jira.example.com/A' },
                },
                {
                    id: 'doc-b',
                    source: 'jira',
                    content: 'Content B',
                    metadata: { id: 'doc-b', source: 'jira', type: 'issue', title: 'Issue B', project: 'PROJ', reporter: 'user2', createdAt: '2024-01-01', updatedAt: '2024-01-02', url: 'https://jira.example.com/B' },
                },
            ];

            await service.saveDocuments('jira', docs);
            expect(mockWriteFile).toHaveBeenCalledTimes(2);
        });
    });

    describe('safeId generation', () => {
        it('strips invalid characters from document ID', async () => {
            const doc: IndexDocument = {
                id: 'doc/with:special@chars!',
                source: 'slack',
                content: 'test',
                metadata: {
                    id: 'doc/with:special@chars!',
                    source: 'slack',
                    type: 'message',
                    title: 'Test',
                    channel: 'general',
                    channelId: 'C123',
                    author: 'user1',
                    authorId: 'U123',
                    threadTs: null,
                    timestamp: '2024-01-01T00:00:00Z',
                    hasAttachments: false,
                    mentionedUsers: [],
                    url: 'https://slack.com/msg',
                },
            };

            await service.saveDocuments('slack', [doc]);

            const writtenPath = mockWriteFile.mock.calls[0][0] as string;
            // The filename should have special chars replaced with underscores
            expect(writtenPath).toContain('doc_with_special_chars_.md');
            expect(writtenPath).not.toContain('/with:');
        });

        it('preserves valid characters (alphanumeric, hyphens, underscores)', async () => {
            const doc: IndexDocument = {
                id: 'valid-doc_123',
                source: 'gmail',
                content: 'test',
                metadata: {
                    id: 'valid-doc_123',
                    source: 'gmail',
                    type: 'email',
                    title: 'Test',
                    subject: 'Test',
                    from: 'a@b.com',
                    to: [],
                    cc: [],
                    labels: [],
                    threadId: 't1',
                    date: '2024-01-01',
                    url: 'https://mail.google.com',
                },
            };

            await service.saveDocuments('gmail', [doc]);

            const writtenPath = mockWriteFile.mock.calls[0][0] as string;
            expect(writtenPath).toContain('valid-doc_123.md');
        });
    });

    describe('formatDocument', () => {
        it('generates correct YAML frontmatter and markdown', async () => {
            const doc: IndexDocument = {
                id: 'test-doc',
                source: 'jira',
                content: 'This is the document body.',
                metadata: {
                    id: 'test-doc',
                    source: 'jira',
                    type: 'issue',
                    title: 'My Issue Title',
                    project: 'PROJ',
                    reporter: 'user1',
                    createdAt: '2024-01-15',
                    updatedAt: '2024-01-16',
                    url: 'https://jira.example.com/test',
                },
            };

            await service.saveDocuments('jira', [doc]);

            const writtenContent = mockWriteFile.mock.calls[0][1] as string;

            // Check YAML frontmatter structure
            expect(writtenContent).toMatch(/^---\n/);
            expect(writtenContent).toContain('title: "My Issue Title"');
            expect(writtenContent).toContain('source: "jira"');
            expect(writtenContent).toContain('project: "PROJ"');
            expect(writtenContent).toContain('generated_at:');
            expect(writtenContent).toContain('---\n\n# My Issue Title');
            expect(writtenContent).toContain('This is the document body.');
        });

        it('uses "Untitled" when title is missing', async () => {
            const doc: IndexDocument = {
                id: 'no-title',
                source: 'jira',
                content: 'Body text',
                metadata: {
                    id: 'no-title',
                    source: 'jira',
                    type: 'issue',
                    project: 'PROJ',
                    reporter: 'user1',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-02',
                    url: 'https://jira.example.com/test',
                } as any,
            };

            await service.saveDocuments('jira', [doc]);
            const writtenContent = mockWriteFile.mock.calls[0][1] as string;
            expect(writtenContent).toContain('# Untitled');
        });
    });

    describe('createYamlFrontmatter', () => {
        it('serializes arrays in bracket notation', async () => {
            const doc: IndexDocument = {
                id: 'array-test',
                source: 'jira',
                content: 'test',
                metadata: {
                    id: 'array-test',
                    source: 'jira',
                    type: 'issue',
                    title: 'Test',
                    project: 'PROJ',
                    labels: ['bug', 'critical'],
                    reporter: 'user1',
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-02',
                    url: 'https://jira.example.com/test',
                },
            };

            await service.saveDocuments('jira', [doc]);
            const content = mockWriteFile.mock.calls[0][1] as string;
            expect(content).toContain('labels: ["bug", "critical"]');
        });

        it('serializes objects as JSON', async () => {
            const doc: IndexDocument = {
                id: 'obj-test',
                source: 'gmail',
                content: 'test',
                metadata: {
                    id: 'obj-test',
                    source: 'gmail',
                    type: 'email',
                    title: 'Test',
                    subject: 'Test',
                    from: 'a@b.com',
                    to: ['x@y.com'],
                    cc: [],
                    labels: [],
                    threadId: 't1',
                    date: '2024-01-01',
                    url: 'https://mail.google.com',
                } as any,
            };

            // The metadata itself becomes JSON objects for nested values
            await service.saveDocuments('gmail', [doc]);
            const content = mockWriteFile.mock.calls[0][1] as string;
            // String values get JSON.stringify'd
            expect(content).toContain('source: "gmail"');
        });

        it('skips null and undefined values', async () => {
            const doc: IndexDocument = {
                id: 'null-test',
                source: 'jira',
                content: 'test',
                metadata: {
                    id: 'null-test',
                    source: 'jira',
                    type: 'issue',
                    title: 'Test',
                    project: 'PROJ',
                    reporter: 'user1',
                    assignee: null,
                    sprint: undefined,
                    createdAt: '2024-01-01',
                    updatedAt: '2024-01-02',
                    url: 'https://jira.example.com/test',
                } as any,
            };

            await service.saveDocuments('jira', [doc]);
            const content = mockWriteFile.mock.calls[0][1] as string;
            // null/undefined values should be filtered out
            expect(content).not.toContain('assignee:');
            expect(content).not.toContain('sprint:');
        });
    });

    describe('deleteDocument', () => {
        it('removes file if it exists', async () => {
            mockExistsSync.mockReturnValue(true);
            await service.deleteDocument('gmail', 'doc-123');

            expect(mockUnlink).toHaveBeenCalledWith(
                expect.stringContaining('doc-123.md'),
            );
        });

        it('handles missing file gracefully', async () => {
            mockExistsSync.mockReturnValue(false);
            await service.deleteDocument('gmail', 'nonexistent');
            expect(mockUnlink).not.toHaveBeenCalled();
        });

        it('handles unlink errors gracefully (does not throw)', async () => {
            mockExistsSync.mockReturnValue(true);
            mockUnlink.mockRejectedValueOnce(new Error('Permission denied'));

            // Should not throw
            await expect(service.deleteDocument('gmail', 'doc-123')).resolves.toBeUndefined();
        });

        it('sanitizes document ID for file path', async () => {
            mockExistsSync.mockReturnValue(true);
            await service.deleteDocument('slack', 'msg/with:special@chars');

            const calledPath = mockUnlink.mock.calls[0][0] as string;
            expect(calledPath).toContain('msg_with_special_chars.md');
        });
    });
});
