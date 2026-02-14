// Mock tiktoken before any imports that use it
jest.mock('tiktoken', () => ({
    encoding_for_model: jest.fn().mockReturnValue({
        encode: jest.fn().mockReturnValue([]),
        free: jest.fn(),
    }),
}));

import { FileProcessorService } from './file-processor.service';

// Mock child_process for markitdown
jest.mock('child_process', () => ({
    exec: jest.fn(),
}));
import { exec } from 'child_process';

// Mock fs for temp file handling
jest.mock('fs', () => ({
    writeFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    unlinkSync: jest.fn(),
}));

const mockChunkingService = {
    isCodeFile: jest.fn(),
    chunkCode: jest.fn(),
    chunkText: jest.fn(),
    getLanguage: jest.fn(),
} as any;

describe('FileProcessorService', () => {
    let service: FileProcessorService;

    beforeEach(() => {
        service = new FileProcessorService(mockChunkingService);
        jest.clearAllMocks();
    });

    describe('process', () => {
        it('should process plain text file and chunk it', async () => {
            mockChunkingService.isCodeFile.mockReturnValue(false);
            mockChunkingService.chunkText.mockResolvedValue(['chunk1']);
            mockChunkingService.getLanguage.mockReturnValue(null);

            const result = await service.process('hello world', 'readme.txt');

            expect(result).not.toBeNull();
            expect(result!.content).toBe('hello world');
            expect(result!.chunks).toBeUndefined(); // single chunk = no preChunked
            expect(result!.language).toBeUndefined();
        });

        it('should process code file with language-aware chunking', async () => {
            mockChunkingService.isCodeFile.mockReturnValue(true);
            mockChunkingService.chunkCode.mockResolvedValue(['chunk1', 'chunk2']);
            mockChunkingService.getLanguage.mockReturnValue('js');

            const result = await service.process('const x = 1;\n'.repeat(100), 'index.ts');

            expect(result).not.toBeNull();
            expect(result!.chunks).toEqual(['chunk1', 'chunk2']);
            expect(result!.language).toBe('js');
            expect(mockChunkingService.chunkCode).toHaveBeenCalled();
        });

        it('should return null for unsupported binary MIME types', async () => {
            const result = await service.process(Buffer.from('binary'), 'photo.png', 'image/png');
            expect(result).toBeNull();
        });

        it('should return null for archive MIME types', async () => {
            const result = await service.process(Buffer.from('data'), 'file.zip', 'application/zip');
            expect(result).toBeNull();
        });

        it('should convert PDF buffer to markdown via markitdown', async () => {
            const pdfBuffer = Buffer.from('fake-pdf');
            (exec as unknown as jest.Mock).mockImplementation((_cmd, cb) => cb(null, { stdout: 'extracted text', stderr: '' }));
            mockChunkingService.isCodeFile.mockReturnValue(false);
            mockChunkingService.chunkText.mockResolvedValue(['extracted text']);
            mockChunkingService.getLanguage.mockReturnValue(null);

            const result = await service.process(pdfBuffer, 'doc.pdf', 'application/pdf');

            expect(result).not.toBeNull();
            expect(result!.content).toBe('extracted text');
        });

        it('should convert DOCX buffer to markdown via markitdown', async () => {
            const docxBuffer = Buffer.from('fake-docx');
            (exec as unknown as jest.Mock).mockImplementation((_cmd, cb) => cb(null, { stdout: '# Title\n\nContent', stderr: '' }));
            mockChunkingService.isCodeFile.mockReturnValue(false);
            mockChunkingService.chunkText.mockResolvedValue(['# Title\n\nContent']);
            mockChunkingService.getLanguage.mockReturnValue(null);

            const result = await service.process(docxBuffer, 'doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

            expect(result).not.toBeNull();
            expect(result!.content).toBe('# Title\n\nContent');
        });

        it('should detect binary content via null bytes when no mimeType given', async () => {
            const binaryContent = 'hello\0world';
            const result = await service.process(binaryContent, 'mystery.bin');
            expect(result).toBeNull();
        });

        it('should not set chunks when content produces single chunk', async () => {
            mockChunkingService.isCodeFile.mockReturnValue(true);
            mockChunkingService.chunkCode.mockResolvedValue(['single chunk']);
            mockChunkingService.getLanguage.mockReturnValue('python');

            const result = await service.process('x = 1', 'main.py');

            expect(result).not.toBeNull();
            expect(result!.chunks).toBeUndefined();
        });
    });
});
