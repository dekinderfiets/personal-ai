import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

import { ChunkingService } from './chunking.service';

const execAsync = promisify(exec);

export interface ProcessedFile {
    content: string;
    chunks?: string[];
    language?: string;
}

const UNSUPPORTED_MIME_PREFIXES = [
    'image/',
    'video/',
    'audio/',
];

const UNSUPPORTED_MIME_TYPES = new Set([
    'application/zip',
    'application/x-zip-compressed',
    'application/x-compress',
    'application/x-compressed',
    'application/octet-stream',
    'application/x-tar',
    'application/x-gzip',
    'application/x-bzip2',
    'application/x-7z-compressed',
]);

const CONVERTIBLE_MIME_EXTENSIONS: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/pdf': '.pdf',
    'text/html': '.html',
    'text/csv': '.csv',
};

@Injectable()
export class FileProcessorService {
    private readonly logger = new Logger(FileProcessorService.name);

    constructor(private readonly chunkingService: ChunkingService) {}

    async process(content: string | Buffer, filePath: string, mimeType?: string): Promise<ProcessedFile | null> {
        // Check unsupported MIME types
        if (mimeType) {
            if (UNSUPPORTED_MIME_TYPES.has(mimeType)) return null;
            if (UNSUPPORTED_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return null;
        }

        // Convert binary formats to text
        let text: string;
        if (Buffer.isBuffer(content)) {
            const ext = mimeType ? CONVERTIBLE_MIME_EXTENSIONS[mimeType] : null;
            if (!ext) return null;
            text = await this.useMarkitdown(content, ext, filePath);
        } else {
            // Null-byte check for binary content that slipped through
            if (content.includes('\0')) return null;

            // Check if text content needs conversion (e.g. HTML)
            if (mimeType && CONVERTIBLE_MIME_EXTENSIONS[mimeType]) {
                text = await this.useMarkitdown(content, CONVERTIBLE_MIME_EXTENSIONS[mimeType], filePath);
            } else if (content.includes('<html') || content.includes('<body')) {
                text = await this.useMarkitdown(content, '.html', filePath);
            } else {
                text = content;
            }
        }

        // Chunk the content
        const language = this.chunkingService.getLanguage(filePath);
        let chunks: string[];
        if (this.chunkingService.isCodeFile(filePath)) {
            chunks = await this.chunkingService.chunkCode(text, filePath);
        } else {
            chunks = await this.chunkingService.chunkText(text);
        }

        return {
            content: text,
            chunks: chunks.length > 1 ? chunks : undefined,
            language: language || undefined,
        };
    }

    private async useMarkitdown(content: string | Buffer, ext: string, fileName: string): Promise<string> {
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `input_${Date.now()}${ext}`);

        try {
            fs.writeFileSync(inputPath, content);
            const { stdout, stderr } = await execAsync(`markitdown "${inputPath}"`);
            if (stderr) {
                this.logger.warn(`markitdown stderr for ${fileName}: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`markitdown conversion failed for ${fileName}: ${(error as Error).message}`);
            return Buffer.isBuffer(content) ? '' : content;
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        }
    }
}
