import { Injectable, Logger } from '@nestjs/common';
import { RecursiveCharacterTextSplitter, SupportedTextSplitterLanguage } from '@langchain/textsplitters';
import { encoding_for_model } from 'tiktoken';
import * as path from 'path';

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 64;
const MIN_CONTENT_FOR_CHUNKING = 600;

let _tokenizer: ReturnType<typeof encoding_for_model> | null = null;
function getTokenizer() {
    if (!_tokenizer) _tokenizer = encoding_for_model('gpt-4o');
    return _tokenizer;
}

function tokenLength(text: string): number {
    return getTokenizer().encode(text).length;
}

const EXTENSION_TO_LANGUAGE: Record<string, SupportedTextSplitterLanguage> = {
    '.ts': 'js',
    '.tsx': 'js',
    '.js': 'js',
    '.jsx': 'js',
    '.mjs': 'js',
    '.cjs': 'js',
    '.py': 'python',
    '.go': 'go',
    '.java': 'java',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.c': 'cpp',
    '.h': 'cpp',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.cs': 'java',
    '.swift': 'swift',
    '.scala': 'scala',
    '.php': 'php',
    '.sol': 'sol',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.html': 'html',
    '.htm': 'html',
    '.xml': 'html',
    '.proto': 'proto',
    '.rst': 'rst',
    '.lua': 'python',
    '.hs': 'scala',
    '.ex': 'markdown',
    '.exs': 'markdown',
    '.kt': 'java',
    '.kts': 'java',
};

export interface ChunkOptions {
    chunkSize?: number;
    chunkOverlap?: number;
}

@Injectable()
export class ChunkingService {
    private readonly logger = new Logger(ChunkingService.name);

    /**
     * Chunk code content using language-aware splitting.
     * Returns the original content as a single-element array if it's too short to chunk.
     */
    async chunkCode(content: string, filePath: string, options?: ChunkOptions): Promise<string[]> {
        const { chunkSize = DEFAULT_CHUNK_SIZE, chunkOverlap = DEFAULT_CHUNK_OVERLAP } = options || {};

        if (tokenLength(content) < MIN_CONTENT_FOR_CHUNKING) {
            return [content];
        }

        const ext = path.extname(filePath).toLowerCase();
        const language = EXTENSION_TO_LANGUAGE[ext];

        if (!language) {
            return this.chunkText(content, options);
        }

        try {
            const splitter = RecursiveCharacterTextSplitter.fromLanguage(language, {
                chunkSize,
                chunkOverlap,
                lengthFunction: tokenLength,
            });
            const docs = await splitter.createDocuments([content]);
            return docs.map(d => d.pageContent);
        } catch (error) {
            this.logger.warn(`Language-aware splitting failed for ${filePath}, falling back to text: ${(error as Error).message}`);
            return this.chunkText(content, options);
        }
    }

    /**
     * Chunk text content using generic character-based splitting.
     */
    async chunkText(content: string, options?: ChunkOptions): Promise<string[]> {
        const { chunkSize = DEFAULT_CHUNK_SIZE, chunkOverlap = DEFAULT_CHUNK_OVERLAP } = options || {};

        if (tokenLength(content) < MIN_CONTENT_FOR_CHUNKING) {
            return [content];
        }

        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize,
            chunkOverlap,
            lengthFunction: tokenLength,
        });
        const docs = await splitter.createDocuments([content]);
        return docs.map(d => d.pageContent);
    }

    /**
     * Check if a file path maps to a known code language.
     */
    isCodeFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return ext in EXTENSION_TO_LANGUAGE;
    }

    /**
     * Get the language name for a file path, or null if unknown.
     */
    getLanguage(filePath: string): string | null {
        const ext = path.extname(filePath).toLowerCase();
        return EXTENSION_TO_LANGUAGE[ext] || null;
    }
}
