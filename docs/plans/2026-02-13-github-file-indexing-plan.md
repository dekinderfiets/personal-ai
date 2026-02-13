# GitHub File Indexing + Shared FileProcessorService — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix GitHub file indexing bug, remove the 500-file limit with paginated fetching, and extract shared file processing into a reusable service used by both GitHub and Drive connectors.

**Architecture:** Create a `FileProcessorService` that handles file-type detection, binary conversion (PDF/DOCX via pdftotext/pandoc), and intelligent chunking (code-aware vs text). Both GitHub and Drive connectors delegate to this service instead of having their own processing logic. Fix the cursor state bug that prevents files from being indexed. Add paginated file fetching to handle repos with unlimited files.

**Tech Stack:** NestJS (Injectable services), LangChain text splitters, tiktoken, pdftotext, pandoc

---

### Task 1: Create FileProcessorService with tests

**Files:**
- Create: `collector/src/indexing/file-processor.service.ts`
- Create: `collector/src/indexing/file-processor.service.spec.ts`

This service consolidates file conversion and chunking from both Drive and GitHub connectors.

**Step 1: Write the test file**

```typescript
// collector/src/indexing/file-processor.service.spec.ts

import { FileProcessorService } from './file-processor.service';

// Mock child_process for pdftotext/pandoc
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

        it('should convert PDF buffer to text via pdftotext', async () => {
            const pdfBuffer = Buffer.from('fake-pdf');
            (exec as unknown as jest.Mock).mockImplementation((_cmd, cb) => cb(null, { stdout: 'extracted text', stderr: '' }));
            mockChunkingService.isCodeFile.mockReturnValue(false);
            mockChunkingService.chunkText.mockResolvedValue(['extracted text']);
            mockChunkingService.getLanguage.mockReturnValue(null);

            const result = await service.process(pdfBuffer, 'doc.pdf', 'application/pdf');

            expect(result).not.toBeNull();
            expect(result!.content).toBe('extracted text');
        });

        it('should convert DOCX buffer to markdown via pandoc', async () => {
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/indexing/file-processor.service.spec.ts --no-coverage`
Expected: FAIL — module not found

**Step 3: Write the FileProcessorService implementation**

```typescript
// collector/src/indexing/file-processor.service.ts

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
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/indexing/file-processor.service.spec.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add collector/src/indexing/file-processor.service.ts collector/src/indexing/file-processor.service.spec.ts
git commit -m "feat: add FileProcessorService for shared file conversion and chunking"
```

---

### Task 2: Register FileProcessorService in AppModule

**Files:**
- Modify: `collector/src/app.module.ts:45,80`

**Step 1: Add import and provider**

Add import at line 45 (after ChunkingService import):
```typescript
import { FileProcessorService } from './indexing/file-processor.service';
```

Add to providers array (after ChunkingService at line 80):
```typescript
FileProcessorService,
```

**Step 2: Run existing tests to verify nothing breaks**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest --no-coverage --testPathIgnorePatterns='e2e' 2>&1 | tail -20`
Expected: All existing tests still PASS

**Step 3: Commit**

```bash
git add collector/src/app.module.ts
git commit -m "feat: register FileProcessorService in AppModule"
```

---

### Task 3: Move preChunked to BaseDocument type

**Files:**
- Modify: `collector/src/types/index.ts:5,180`

Currently `preChunked` is only on `GitHubDocument` (line 180). Move it to `BaseDocument` so Drive (and any future connector) can use it.

**Step 1: Add preChunked to BaseDocument**

At `collector/src/types/index.ts` line 5-10, change:
```typescript
export interface BaseDocument {
    id: string;
    source: DataSource;
    content: string;
    metadata: Record<string, unknown>;
}
```
to:
```typescript
export interface BaseDocument {
    id: string;
    source: DataSource;
    content: string;
    metadata: Record<string, unknown>;
    preChunked?: { chunks: string[] };
}
```

**Step 2: Remove preChunked from GitHubDocument**

At line 180, remove:
```typescript
    preChunked?: { chunks: string[] };
```

**Step 3: Run tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest --no-coverage --testPathIgnorePatterns='e2e' 2>&1 | tail -20`
Expected: All tests PASS (field is still available via inheritance)

**Step 4: Commit**

```bash
git add collector/src/types/index.ts
git commit -m "refactor: move preChunked to BaseDocument for cross-connector use"
```

---

### Task 4: Refactor Drive connector to use FileProcessorService

**Files:**
- Modify: `collector/src/connectors/drive.connector.ts`
- Modify: `collector/src/connectors/drive.connector.spec.ts`

**Step 1: Update Drive connector spec to mock FileProcessorService**

In `drive.connector.spec.ts`, add mock for FileProcessorService alongside existing mocks:
```typescript
const mockFileProcessor = {
    process: jest.fn(),
} as any;
```

Update connector instantiation:
```typescript
connector = new DriveConnector(mockConfigService as any, mockGoogleAuth, mockFileProcessor);
```

Update existing tests to configure `mockFileProcessor.process` return values as needed (it should return `{ content: '...', chunks: undefined, language: undefined }` for text content, or `null` for skipped files).

**Step 2: Run tests to see them fail**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/drive.connector.spec.ts --no-coverage`
Expected: FAIL — constructor signature mismatch

**Step 3: Update Drive connector implementation**

In `drive.connector.ts`:

1. Add import:
```typescript
import { FileProcessorService } from '../indexing/file-processor.service';
```

2. Add to constructor:
```typescript
constructor(
    private configService: ConfigService,
    private googleAuthService: GoogleAuthService,
    private fileProcessorService: FileProcessorService,
) {
    super();
}
```

3. Replace the `getFileContent()` method body. Keep the Google Apps export logic (lines 219-235 — the export URLs for Google Docs/Sheets/Slides) but delegate conversion and chunking to FileProcessorService.

Replace `getFileContent()` (lines 183-274) with:
```typescript
private async getFileContent(token: string, file: DriveFile): Promise<{ content: string; preChunked?: { chunks: string[] } } | null> {
    // Handle Google Apps exports (API-specific, stays here)
    const isGoogleDoc = file.mimeType === 'application/vnd.google-apps.document';
    const isGoogleSheet = file.mimeType === 'application/vnd.google-apps.spreadsheet';
    const isGoogleSlide = file.mimeType === 'application/vnd.google-apps.presentation';
    const isGoogleApp = file.mimeType.startsWith('application/vnd.google-apps');

    let url: string;
    let responseType: 'text' | 'arraybuffer' = 'text';
    let effectiveMimeType = file.mimeType;

    if (isGoogleDoc) {
        url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
        effectiveMimeType = 'text/plain';
    } else if (isGoogleSheet) {
        url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`;
        effectiveMimeType = 'text/csv';
    } else if (isGoogleSlide) {
        url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf`;
        responseType = 'arraybuffer';
        effectiveMimeType = 'application/pdf';
    } else if (isGoogleApp) {
        this.logger.warn(`Skipping unsupported Google App type: ${file.mimeType} (${file.name})`);
        return null;
    } else {
        url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
        const needsBinary = ['application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ].includes(file.mimeType);
        if (needsBinary) responseType = 'arraybuffer';
    }

    try {
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            responseType,
            maxContentLength: 20 * 1024 * 1024,
        });

        const rawContent = responseType === 'arraybuffer' ? Buffer.from(response.data) : response.data;
        const result = await this.fileProcessorService.process(rawContent, file.name, effectiveMimeType);
        if (!result) return null;

        return {
            content: result.content,
            preChunked: result.chunks ? { chunks: result.chunks } : undefined,
        };
    } catch (error) {
        this.logger.error(`Failed to fetch/convert content for file ${file.name}: ${(error as Error).message}`);
        return null;
    }
}
```

4. Update the `fetch()` method where it calls `getFileContent` — the return value now includes `preChunked`. Around lines 98-132, update the document building:
```typescript
const fileResult = await this.getFileContent(token, file);
if (!fileResult) return null;

const filePath = await this.getFilePath(token, file);
const lastSlash = filePath.lastIndexOf('/');
const folderPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : '/';
const doc: DriveDocument = {
    id: `drive_${file.id}`,
    source: 'drive',
    content: `File: ${file.name}\nPath: ${filePath}\n\n${fileResult.content}`,
    metadata: {
        id: file.id,
        source: 'drive',
        type: this.getFileType(file.mimeType),
        title: file.name,
        name: file.name,
        mimeType: file.mimeType,
        path: filePath,
        folderPath,
        owner: file.owners?.[0]?.displayName || 'Unknown',
        createdAt: file.createdTime,
        modifiedAt: file.modifiedTime,
        url: file.webViewLink,
    },
};
if (fileResult.preChunked) {
    doc.preChunked = fileResult.preChunked;
}
return doc;
```

5. Delete `extractTextFromPdf()` method (lines 276-296).
6. Delete `usePandoc()` method (lines 298-323).

**Step 4: Run tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/drive.connector.spec.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add collector/src/connectors/drive.connector.ts collector/src/connectors/drive.connector.spec.ts
git commit -m "refactor: Drive connector uses FileProcessorService for file conversion and chunking"
```

---

### Task 5: Fix cursor state bug + remove file limit in GitHub connector

**Files:**
- Modify: `collector/src/connectors/github.connector.ts:122-123,178,240,572-592`
- Modify: `collector/src/connectors/github.connector.spec.ts`

**Step 1: Write test for the cursor bug fix**

Add to `github.connector.spec.ts`, in the files phase describe block:

```typescript
it('should respect request.indexFiles even when cursor has stale value', async () => {
    // Simulate cursor from a previous run where indexFiles was false
    const staleState = {
        phase: 'issues',
        repoIdx: 0,
        page: 1,
        repos: ['testuser/repo1'],
        repoDefaultBranches: { 'testuser/repo1': 'main' },
        indexFiles: false,
    };

    // Mock issues response with no more pages
    mockAxios.get.mockResolvedValueOnce({
        data: [], // no issues
    });

    const result = await connector.fetch(
        { source: 'github', lastSync: '', syncToken: JSON.stringify(staleState) },
        { indexFiles: true }, // user now wants files
    );

    // Should transition to files phase, not skip it
    const newState = JSON.parse(result.newCursor.syncToken!);
    expect(newState.phase).toBe('files');
    expect(newState.indexFiles).toBe(true);
});
```

**Step 2: Run test to see it fail**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/github.connector.spec.ts --no-coverage -t 'should respect request.indexFiles'`
Expected: FAIL — phase is 'issues' (next repo) instead of 'files'

**Step 3: Fix the cursor state bug**

In `github.connector.ts`, after line 178 (state deserialization), add:
```typescript
if (cursor?.syncToken) {
    try {
        state = JSON.parse(cursor.syncToken);
        // Always respect the current request setting, not stale cursor value
        state.indexFiles = request.indexFiles !== false;
    } catch {
        state = { phase: 'repos', repoIdx: 0, page: 1, repos: [], repoDefaultBranches: {} };
    }
}
```

**Step 4: Remove the 500 file limit**

In `github.connector.ts`:

1. Delete the `MAX_FILES_PER_REPO` constant (line 123).
2. Remove `.slice(0, MAX_FILES_PER_REPO)` from line 592.

**Step 5: Add paginated file fetching**

Add a `fileOffset` field to the state interface (line 167-174):
```typescript
let state: {
    phase: 'repos' | 'issues' | 'files';
    repoIdx: number;
    page: number;
    repos: string[];
    repoDefaultBranches: Record<string, string>;
    indexFiles?: boolean;
    fileOffset?: number;
};
```

Update `fetchRepoFiles` to accept and return offset for pagination:
```typescript
private async fetchRepoFiles(
    repoFullName: string,
    branch: string,
    offset: number = 0,
): Promise<{ documents: GitHubDocument[]; hasMore: boolean; nextOffset: number }> {
    const BATCH_SIZE = 50;
    const documents: GitHubDocument[] = [];

    try {
        const response = await this.api.get<{ tree: GitHubTreeItem[]; truncated: boolean }>(
            `/repos/${repoFullName}/git/trees/${branch}`,
            { params: { recursive: 1 } },
        );

        const tree = response.data.tree;
        if (response.data.truncated) {
            this.logger.warn(`File tree for ${repoFullName} was truncated by GitHub API`);
        }

        const candidateFiles = tree
            .filter(item => item.type === 'blob')
            .filter(item => this.isIndexableFile(item));

        const batch = candidateFiles.slice(offset, offset + BATCH_SIZE);

        this.logger.log(
            `Fetching files ${offset + 1}-${offset + batch.length} of ${candidateFiles.length} in ${repoFullName}`,
        );

        for (let i = 0; i < batch.length; i += FILE_FETCH_BATCH_SIZE) {
            const chunk = batch.slice(i, i + FILE_FETCH_BATCH_SIZE);
            const batchResults = await Promise.allSettled(
                chunk.map(item => this.fetchFileContent(repoFullName, item, ...repoFullName.split('/') as [string, string], branch)),
            );

            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value) {
                    documents.push(result.value);
                }
            }

            if (i + FILE_FETCH_BATCH_SIZE < batch.length) {
                await new Promise(resolve => setTimeout(resolve, FILE_FETCH_BATCH_DELAY));
            }
        }

        const nextOffset = offset + BATCH_SIZE;
        const hasMore = nextOffset < candidateFiles.length;

        return { documents, hasMore, nextOffset };
    } catch (error) {
        this.logger.error(`Failed to fetch file tree for ${repoFullName}: ${(error as Error).message}`);
        return { documents, hasMore: false, nextOffset: offset };
    }
}
```

Update the files phase handler (lines 267-296) to use pagination:
```typescript
if (state.phase === 'files') {
    const branch = state.repoDefaultBranches[repoFullName] || 'main';
    const { documents: fileDocs, hasMore: moreFiles, nextOffset } =
        await this.fetchRepoFiles(repoFullName, branch, state.fileOffset || 0);
    documents.push(...fileDocs);

    this.logger.log(`Indexed ${fileDocs.length} files from ${repoFullName} (offset ${state.fileOffset || 0})`);

    if (moreFiles) {
        // More files in this repo
        state.fileOffset = nextOffset;
    } else {
        // Done with this repo's files, move to next repo
        state.repoIdx++;
        state.phase = 'issues';
        state.page = 1;
        state.fileOffset = 0;

        if (state.repoIdx >= state.repos.length) {
            state.phase = 'repos';
            state.repoIdx = 0;
        }
    }

    const hasMore = state.phase !== 'repos' || moreFiles;

    return {
        documents,
        newCursor: {
            source: 'github' as DataSource,
            syncToken: hasMore ? JSON.stringify(state) : undefined,
        },
        hasMore,
        batchLastSync: new Date().toISOString(),
    };
}
```

**Step 6: Run tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/github.connector.spec.ts --no-coverage`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add collector/src/connectors/github.connector.ts collector/src/connectors/github.connector.spec.ts
git commit -m "fix: cursor state bug preventing file indexing + remove 500 file limit with pagination"
```

---

### Task 6: Refactor GitHub connector to use FileProcessorService

**Files:**
- Modify: `collector/src/connectors/github.connector.ts:1-8,130-140,647-729`
- Modify: `collector/src/connectors/github.connector.spec.ts`

**Step 1: Update test mocks**

In `github.connector.spec.ts`, add FileProcessorService mock:
```typescript
const mockFileProcessor = {
    process: jest.fn(),
} as any;
```

Update connector instantiation:
```typescript
connector = new GitHubConnector(mockConfigService as any, mockChunkingService, mockFileProcessor);
```

Wait — actually the GitHub connector can drop its direct ChunkingService dependency entirely since FileProcessorService handles chunking. Update:
```typescript
connector = new GitHubConnector(mockConfigService as any, mockFileProcessor);
```

Update file indexing tests to mock `mockFileProcessor.process` instead of `mockChunkingService.chunkCode/chunkText`.

**Step 2: Run tests to see them fail**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/github.connector.spec.ts --no-coverage`
Expected: FAIL — constructor mismatch

**Step 3: Update GitHub connector**

1. Replace ChunkingService import with FileProcessorService:
```typescript
import { FileProcessorService, ProcessedFile } from '../indexing/file-processor.service';
```

2. Update constructor:
```typescript
constructor(
    private configService: ConfigService,
    private fileProcessorService: FileProcessorService,
) {
    super();
    // ... existing axios setup
}
```

3. Simplify `fetchFileContent()` — delegate processing to FileProcessorService:
```typescript
private async fetchFileContent(
    repoFullName: string,
    item: GitHubTreeItem,
    owner: string,
    repo: string,
    branch: string,
): Promise<GitHubDocument | null> {
    try {
        const response = await this.api.get<string>(
            `/repos/${repoFullName}/contents/${item.path}`,
            {
                headers: { Accept: 'application/vnd.github.raw+json' },
                responseType: 'text',
                params: { ref: branch },
            },
        );

        const content = response.data;
        const result = await this.fileProcessorService.process(content, item.path);
        if (!result) return null;

        const ext = path.extname(item.path).toLowerCase();
        const sha7 = item.sha.substring(0, 7);
        const pathHash = crypto.createHash('md5').update(item.path).digest('hex').substring(0, 12);
        const docId = `github_file_${owner}_${repo}_${sha7}_${pathHash}`;
        const now = new Date().toISOString();

        const fileHeader = [
            `# ${item.path}`,
            `Repository: ${repoFullName}`,
            result.language ? `Language: ${result.language}` : '',
            '',
        ].filter(Boolean).join('\n');

        const fullContent = fileHeader + result.content;

        const doc: GitHubDocument = {
            id: docId,
            source: 'github',
            content: fullContent,
            metadata: {
                id: docId,
                source: 'github',
                type: 'file',
                title: item.path,
                repo: repoFullName,
                author: owner,
                createdAt: now,
                updatedAt: now,
                url: `https://github.com/${repoFullName}/blob/${sha7}/${item.path}`,
                parentId: `github_repo_${repoFullName.replace('/', '_')}`,
                filePath: item.path,
                fileExtension: ext,
                fileLanguage: result.language,
                fileSha: item.sha,
                fileSize: item.size,
            },
        };

        if (result.chunks && result.chunks.length > 1) {
            doc.preChunked = { chunks: result.chunks };
        }

        return doc;
    } catch (error) {
        this.logger.warn(`Failed to fetch file ${item.path} from ${repoFullName}: ${(error as Error).message}`);
        return null;
    }
}
```

**Step 4: Run tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest src/connectors/github.connector.spec.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add collector/src/connectors/github.connector.ts collector/src/connectors/github.connector.spec.ts
git commit -m "refactor: GitHub connector uses FileProcessorService, drops direct ChunkingService dependency"
```

---

### Task 7: Run full test suite and verify

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `cd /Volumes/projects/personal-ai/collector && npx jest --no-coverage --testPathIgnorePatterns='e2e' 2>&1 | tail -30`
Expected: All tests PASS

**Step 2: Build check**

Run: `cd /Volumes/projects/personal-ai/collector && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit if any fixups needed**

Only commit if fixes were required in previous steps.
