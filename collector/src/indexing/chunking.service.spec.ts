import { ChunkingService } from './chunking.service';

// Mock tiktoken before importing the module under test
jest.mock('tiktoken', () => ({
    encoding_for_model: jest.fn().mockReturnValue({
        encode: jest.fn().mockImplementation((text: string) => {
            // Simple mock: ~1 token per 4 chars (rough approximation)
            const len = Math.ceil(text.length / 4);
            return new Array(len);
        }),
    }),
}));

jest.mock('@langchain/textsplitters', () => {
    const mockCreateDocs = jest.fn();
    const MockSplitter: any = jest.fn().mockImplementation(() => ({
        createDocuments: mockCreateDocs,
    }));
    MockSplitter.fromLanguage = jest.fn().mockImplementation(() => ({
        createDocuments: mockCreateDocs,
    }));
    // Attach the shared mock so tests can access it
    MockSplitter._mockCreateDocuments = mockCreateDocs;
    return { RecursiveCharacterTextSplitter: MockSplitter };
});

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// Access the shared mock via the attached property
const mockCreateDocuments: jest.Mock = (RecursiveCharacterTextSplitter as any)._mockCreateDocuments;

describe('ChunkingService', () => {
    let service: ChunkingService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new ChunkingService();
        mockCreateDocuments.mockResolvedValue([
            { pageContent: 'chunk-1' },
            { pageContent: 'chunk-2' },
        ]);
    });

    describe('chunkCode', () => {
        it('should return short content as a single chunk (below MIN_CONTENT_FOR_CHUNKING)', async () => {
            const content = 'const x = 1;';
            const result = await service.chunkCode(content, 'file.ts');
            expect(result).toEqual([content]);
            expect(mockCreateDocuments).not.toHaveBeenCalled();
        });

        it('should return content below token threshold as a single chunk', async () => {
            // 2396 chars / 4 = 599 tokens, below MIN_CONTENT_FOR_CHUNKING (600)
            const content = 'a'.repeat(2396);
            const result = await service.chunkCode(content, 'file.ts');
            expect(result).toEqual([content]);
        });

        it('should use language-aware splitting for known extensions', async () => {
            // 2400 chars / 4 = 600 tokens, at MIN_CONTENT_FOR_CHUNKING threshold
            const content = 'a'.repeat(2400);
            const result = await service.chunkCode(content, 'src/app.ts');

            expect(RecursiveCharacterTextSplitter.fromLanguage).toHaveBeenCalledWith('js', {
                chunkSize: 512,
                chunkOverlap: 64,
                lengthFunction: expect.any(Function),
            });
            expect(mockCreateDocuments).toHaveBeenCalledWith([content]);
            expect(result).toEqual(['chunk-1', 'chunk-2']);
        });

        it('should detect Python language from .py extension', async () => {
            const content = 'a'.repeat(2400);
            await service.chunkCode(content, 'script.py');
            expect(RecursiveCharacterTextSplitter.fromLanguage).toHaveBeenCalledWith('python', expect.any(Object));
        });

        it('should detect Go language from .go extension', async () => {
            const content = 'a'.repeat(2400);
            await service.chunkCode(content, 'main.go');
            expect(RecursiveCharacterTextSplitter.fromLanguage).toHaveBeenCalledWith('go', expect.any(Object));
        });

        it('should fall back to text chunking for unknown extensions', async () => {
            const content = 'a'.repeat(2400);
            const result = await service.chunkCode(content, 'data.xyz');

            expect(RecursiveCharacterTextSplitter.fromLanguage).not.toHaveBeenCalled();
            expect(RecursiveCharacterTextSplitter).toHaveBeenCalledWith({
                chunkSize: 512,
                chunkOverlap: 64,
                lengthFunction: expect.any(Function),
            });
            expect(result).toEqual(['chunk-1', 'chunk-2']);
        });

        it('should fall back to text chunking when fromLanguage throws', async () => {
            (RecursiveCharacterTextSplitter.fromLanguage as jest.Mock).mockReturnValueOnce({
                createDocuments: jest.fn().mockRejectedValue(new Error('Unsupported')),
            });

            const content = 'a'.repeat(2400);
            const result = await service.chunkCode(content, 'file.ts');

            expect(RecursiveCharacterTextSplitter).toHaveBeenCalledWith({
                chunkSize: 512,
                chunkOverlap: 64,
                lengthFunction: expect.any(Function),
            });
            expect(result).toEqual(['chunk-1', 'chunk-2']);
        });

        it('should pass custom chunk options', async () => {
            const content = 'a'.repeat(2400);
            await service.chunkCode(content, 'file.ts', { chunkSize: 2000, chunkOverlap: 100 });

            expect(RecursiveCharacterTextSplitter.fromLanguage).toHaveBeenCalledWith('js', {
                chunkSize: 2000,
                chunkOverlap: 100,
                lengthFunction: expect.any(Function),
            });
        });
    });

    describe('chunkText', () => {
        it('should return short content as a single chunk', async () => {
            const content = 'Hello world';
            const result = await service.chunkText(content);
            expect(result).toEqual([content]);
            expect(mockCreateDocuments).not.toHaveBeenCalled();
        });

        it('should chunk long content using RecursiveCharacterTextSplitter', async () => {
            const content = 'a'.repeat(2400);
            const result = await service.chunkText(content);

            expect(RecursiveCharacterTextSplitter).toHaveBeenCalledWith({
                chunkSize: 512,
                chunkOverlap: 64,
                lengthFunction: expect.any(Function),
            });
            expect(mockCreateDocuments).toHaveBeenCalledWith([content]);
            expect(result).toEqual(['chunk-1', 'chunk-2']);
        });

        it('should pass custom options to the splitter', async () => {
            const content = 'a'.repeat(2400);
            await service.chunkText(content, { chunkSize: 1000, chunkOverlap: 50 });

            expect(RecursiveCharacterTextSplitter).toHaveBeenCalledWith({
                chunkSize: 1000,
                chunkOverlap: 50,
                lengthFunction: expect.any(Function),
            });
        });
    });

    describe('isCodeFile', () => {
        it.each([
            ['.ts', true], ['.tsx', true], ['.js', true], ['.jsx', true],
            ['.py', true], ['.go', true], ['.java', true], ['.rs', true],
            ['.rb', true], ['.c', true], ['.cpp', true], ['.cs', true],
            ['.swift', true], ['.scala', true], ['.php', true],
            ['.md', true], ['.html', true], ['.proto', true],
            ['.kt', true], ['.lua', true], ['.ex', true],
        ])('should return true for known extension %s', (ext, expected) => {
            expect(service.isCodeFile(`file${ext}`)).toBe(expected);
        });

        it.each([
            '.xyz', '.txt', '.csv', '.json', '.yaml', '.toml', '.sql',
        ])('should return false for unknown extension %s', (ext) => {
            expect(service.isCodeFile(`file${ext}`)).toBe(false);
        });
    });

    describe('getLanguage', () => {
        it.each([
            ['.ts', 'js'], ['.tsx', 'js'], ['.js', 'js'], ['.mjs', 'js'], ['.cjs', 'js'],
            ['.py', 'python'], ['.go', 'go'], ['.java', 'java'], ['.rs', 'rust'],
            ['.rb', 'ruby'], ['.c', 'cpp'], ['.h', 'cpp'], ['.cpp', 'cpp'],
            ['.cs', 'java'], ['.swift', 'swift'], ['.scala', 'scala'],
            ['.php', 'php'], ['.sol', 'sol'], ['.md', 'markdown'],
            ['.html', 'html'], ['.htm', 'html'], ['.xml', 'html'],
            ['.proto', 'proto'], ['.rst', 'rst'],
            ['.lua', 'python'], ['.hs', 'scala'],
            ['.ex', 'markdown'], ['.exs', 'markdown'],
            ['.kt', 'java'], ['.kts', 'java'],
        ])('should map %s to language %s', (ext, lang) => {
            expect(service.getLanguage(`file${ext}`)).toBe(lang);
        });

        it('should return null for unknown extensions', () => {
            expect(service.getLanguage('file.xyz')).toBeNull();
            expect(service.getLanguage('file.txt')).toBeNull();
            expect(service.getLanguage('file.csv')).toBeNull();
        });
    });
});
