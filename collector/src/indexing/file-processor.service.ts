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

const MIME_TO_PANDOC_FORMAT: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/html': 'html',
    'text/csv': 'csv',
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
            const converted = await this.convertToText(content, filePath, mimeType);
            if (converted === null) return null;
            text = converted;
        } else {
            // Null-byte check for binary content that slipped through
            if (content.includes('\0')) return null;

            // Check if text content needs pandoc conversion (e.g. HTML)
            if (mimeType && MIME_TO_PANDOC_FORMAT[mimeType]) {
                text = await this.usePandoc(content, MIME_TO_PANDOC_FORMAT[mimeType], filePath);
            } else if (content.includes('<html') || content.includes('<body')) {
                text = await this.usePandoc(content, 'html', filePath);
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

    private async convertToText(buffer: Buffer, filePath: string, mimeType?: string): Promise<string | null> {
        const ext = path.extname(filePath).toLowerCase();
        const isPdf = mimeType === 'application/pdf' || ext === '.pdf';

        if (isPdf) {
            return this.extractTextFromPdf(buffer, filePath);
        }

        if (mimeType && MIME_TO_PANDOC_FORMAT[mimeType]) {
            return this.usePandoc(buffer, MIME_TO_PANDOC_FORMAT[mimeType], filePath);
        }

        // Unknown binary buffer — skip
        return null;
    }

    private async extractTextFromPdf(buffer: Buffer, fileName: string): Promise<string> {
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `input_${Date.now()}.pdf`);

        try {
            fs.writeFileSync(inputPath, buffer);
            const { stdout, stderr } = await execAsync(`pdftotext -layout "${inputPath}" -`);
            if (stderr) {
                this.logger.warn(`pdftotext stderr for ${fileName}: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`PDF extraction failed for ${fileName}: ${(error as Error).message}`);
            return `[PDF content could not be extracted: ${(error as Error).message}]`;
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        }
    }

    private async usePandoc(content: string | Buffer, fromFormat: string, fileName: string): Promise<string> {
        const tempDir = os.tmpdir();
        const extension = fromFormat === 'html' ? 'html' :
            fromFormat === 'csv' ? 'csv' :
                fromFormat === 'docx' ? 'docx' :
                    fromFormat === 'xlsx' ? 'xlsx' :
                        fromFormat === 'pptx' ? 'pptx' : 'txt';
        const inputPath = path.join(tempDir, `input_${Date.now()}.${extension}`);

        try {
            fs.writeFileSync(inputPath, content);
            const { stdout, stderr } = await execAsync(`pandoc "${inputPath}" -f ${fromFormat} -t markdown`);
            if (stderr) {
                this.logger.warn(`Pandoc stderr for ${fileName}: ${stderr}`);
            }
            return stdout;
        } catch (error) {
            this.logger.error(`Pandoc conversion failed for ${fileName}: ${(error as Error).message}`);
            return content.toString();
        } finally {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        }
    }
}
